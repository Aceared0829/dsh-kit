/**
 * 能力使用证据的**读侧**：从 DSH 会话日志里解析「哪个能力在什么时候被调用过」。
 *
 * 为什么单独一个文件：这份解析有两个已经踩过的坑，都属「静默少一大截」型——
 *   · **zstd 是多帧的**：`zlib.zstdDecompressSync(buf)` 只返回**第一帧**，不报错、不警告。
 *     实测一个 1.5 MB 的会话文件只解出 291 字节，99% 的内容没被扫到，于是得出
 *     「零命中」的假结论。必须自己按 magic `28 b5 2f fd` 切帧逐帧解。
 *   · **tool-call 的参数在 `arguments`，值是 JSON 字符串**（不是对象，也不是
 *     `parameters`）：形如 `{"type":"tool-call","name":"skill","arguments":"{\"name\":\"agent-reach\"}"}`。
 *     取错字段会得到 null，看着像「调用了但没记参数」。
 * 把它们关在一个模块里，是为了让 `capabilities.js` 只负责「调用 + 投影」，不碰这些细节。
 *
 * **只读**：不解压到磁盘、不写任何文件、不改库。
 *
 * 与 `src/pipeline.js` 的 `deriveState` 同一套语汇：使用状态由**运行记录**推出来，
 * 不由人写死——没记录就是 `candidate`（实话：不知道用过没有），有记录是 `trusted`，
 * 久未用是 `stale`。
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import zlib from "node:zlib";

/** zstd 帧头 magic。多帧文件里每帧都以此开头，切帧就靠它。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * 会话日志文件名前缀。
 *
 * **不是只认 `session.v4`** —— 本机实测同一会话树下并存三种格式：
 *   · `session.v4.jsonl.zstd`（219 个）
 *   · `session.v3.jsonl.zstd`（218 个）
 *   · `session.jsonl.zstd`（72 个，无版本号的最早期形态）
 * 只认 v4 会**静默漏掉一半以上的历史**（实测漏掉 50 次技能调用，其中 `euthyna` 44 次；
 * `brainstorming` / `writing-plans` / `subagent-driven-development` 三个技能明明用过
 * 却被报成 `candidate`）。所以这里只要求「文件名以 `session` 开头」——宁可多读几个
 * 非会话文件（解析时自然会被 `tool-call` 过滤掉），也不要漏掉真实记录。
 */
const SESSION_FILE_PREFIX = "session";

/** 单次扫描最多读多少个文件——目录膨胀时宁可报错，也不要把一次面板刷新变成全盘扫描。 */
const MAX_SESSION_FILES = 2000;

/** 判定 `stale` 的默认天数。与 pipeline.js 的 90 天同源：都是「久未使用」的经验阈值。 */
export const STALE_AFTER_DAYS = 90;

/**
 * 使用状态**三值**。
 *
 * **这是对 `pipeline.js` 四态（`candidate`/`trusted`/`stale`/`refuted`）的有意收敛，
 * 不是遗漏**：`refuted` 在工作流里的含义是「这一步被运行记录判定为不成立」，而能力
 * 的「被使用」记录**推不出**任何等价结论——一个能力被调用过，只能说「用过」，不能
 * 因此说它「已被推翻」。能力的弃用要另立判据（比如「用它之后任务失败了」），那是
 * 另一件事，**不能从调用次数硬凑**。所以这里只保留能从运行记录直接推出的三态；
 * 少了的那一态宁可不做，也不拿 `candidate` 或 `stale` 冒充。
 */
export const USAGE_STATES = ["candidate", "trusted", "stale"];

/**
 * 会话根目录。默认由 `DSH_HOME` 推导，**不写死本机路径**——仓库里出现盘符是红线。
 * 传 `dshHome` 可覆盖（测试用临时目录，生产用环境变量）。
 */
export function resolveSessionDir({ dshHome = process.env.DSH_HOME || join(homedir(), ".dsh") } = {}) {
  return join(String(dshHome), "sessions");
}

/**
 * 逐帧解一个多帧 zstd buffer，**边解边回调**，不把全文拼成一个字符串。
 *
 * 用回调而不是返回字符串：实测一次读上百个会话文件会 OOM（`FATAL ERROR: Reached
 * heap limit`）。逐帧交给回调，内存只保留一帧。
 */
/**
 * 多帧 zstd 逐帧解压，**边解边回调**。
 *
 * 返回 `{ frames, failed, bytes }`——`failed` 是**解不出来**的帧数。
 *
 * **关于「残缺帧」的一个实测结论**：zstd 是流式格式，**尾部被截断的帧会解出「部分
 * 文本」而不抛错**（实测截断到一半的帧解出 `"这一帧会被截"`）。我试过两种完整性判据
 * 都不可靠：①「截掉末字节再解、比对是否相同」——对短截断失效；②流式 API 的
 * `end` 事件——截断帧照样正常结束、不报错。Node 的 zstd 绑定没有暴露「还有多少输入
 * 未被消费」。
 *
 * 所以**不猜帧的完整性**，改在**行这一层**兜底：残缺帧解出来的尾部一定是半行，而
 * jsonl 的解析器本来就要求整行是合法 JSON —— 半行会 `JSON.parse` 失败被丢掉。
 * 代价是：**一条调用记录若正好被截在中间，会被丢弃**（而不是被当成完整记录误用）。
 * 这个取舍是明确的：**宁可少一条，不要错一条**。
 *
 * 另外，**只有最后一帧可能被截断**（中间帧的边界由下一个 magic 保证），所以
 * `failed` 只在真的解不出来时增长，不把「末帧可能是半行」计进去——那样会天天报警。
 */
export function forEachFrame(buf, onText) {
  let offset = 0;
  let frames = 0;
  let failed = 0;
  while (offset < buf.length) {
    const start = buf.indexOf(ZSTD_MAGIC, offset);
    if (start === -1) break;
    let end = buf.indexOf(ZSTD_MAGIC, start + 4);
    if (end === -1) end = buf.length;
    try {
      onText(zlib.zstdDecompressSync(buf.subarray(start, end)).toString("utf8"));
      frames += 1;
    } catch {
      // 帧头都坏了：计入 failed，继续后面的帧。
      failed += 1;
    }
    offset = end;
  }
  return { frames, failed };
}

/**
 * 递归找出所有会话日志文件。
 *
 * 返回 `{ files, unreadable, truncated }`——**目录读不动时必须留痕**。
 *
 * 为什么这是关键：早期版本用 `existsSync` 定 `present`、`readdirSync` 失败直接 `return`，
 * 于是「目录存在但不可读（ACL 拒绝、权限不足）」与「目录存在且为空」产出**逐字段相同**
 * 的读数（`present=true, scannedFiles=0, unreadable=[]`），清单上 175 条技能全 `candidate`。
 * 那正是本仓库反复防的那类错：**读不到被显示成「读到但没有」**。所以 readdir 失败要
 * 记进 `unreadable`，让上层能把它与「空目录」分辨开。
 *
 * `limit` 可注入（默认 `MAX_SESSION_FILES`）。**早期版本把上限写死在遍历里**，于是
 * 调用方传 `maxFiles: 5000` 也只拿到 2000 个——上限在内层生效、外层无从知道，
 * 又是「静默截断」。现在上限只在这里生效，且**超限时 `truncated` 为 true**。
 */
export function findSessionFiles(dir, { limit = MAX_SESSION_FILES } = {}) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : MAX_SESSION_FILES;
  const result = { files: [], unreadable: [], present: false, truncated: false };
  if (!existsSync(dir)) return result;
  result.present = true;
  const walk = (current) => {
    if (result.files.length >= cap) {
      result.truncated = true;
      return;
    }
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      // 读不动就说出来——不静默 return（那会与「空目录」同形）。
      result.unreadable.push({ dir: current, detail: `目录读失败：${error.message}` });
      return;
    }
    for (const entry of entries) {
      if (result.files.length >= cap) {
        result.truncated = true;
        return;
      }
      const full = join(current, entry.name);
      // 符号链接要单独认：Dirent 对 symlink 的 isDirectory() 返回 false（踩过一次）。
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          // 悬空链接：计入 unreadable（目标不可达也是「读不到」的一种）。
          result.unreadable.push({ dir: full, detail: "符号链接目标不可达" });
          continue;
        }
      }
      if (isDir) walk(full);
      else if (entry.name.startsWith(SESSION_FILE_PREFIX)) result.files.push(full);
    }
  };
  walk(dir);
  result.files.sort();
  return result;
}

/**
 * 从一行 jsonl 里抽出所有 tool-call。
 *
 * 返回 `{ name, args, turn, time }`——`args` 是**二次解析后的对象**，取不到就是 null
 * （调用记录本身仍保留，只是参数缺失，这种要能看出来而不是丢掉整条）。
 */
export function toolCallsInLine(line) {
  if (typeof line !== "string" || !line.includes('"tool-call"')) return [];
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return [];
  }
  const content = obj?.data?.message?.content;
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const item of content) {
    if (item?.type !== "tool-call" || typeof item.name !== "string") continue;
    let args = null;
    if (typeof item.arguments === "string") {
      try {
        args = JSON.parse(item.arguments);
      } catch {
        args = null;
      }
    } else if (item.arguments && typeof item.arguments === "object") {
      args = item.arguments;
    }
    out.push({
      name: item.name,
      args,
      turn: obj?.data?.turn ?? null,
      time: Number.isFinite(obj?.time) ? obj.time : null
    });
  }
  return out;
}

/**
 * 一次调用对应哪个能力。三类能力的判定方式**故意不同**：
 *   · `skill` 工具 → 参数里的 `name` 就是技能名（照宿主 `skill` 工具的契约）；
 *   · MCP 工具 → 公共名形如 `mcp__<serverName>__<rawName>`，取中间那段为 server；
 *   · 其余内置工具（read / pwsh 等）**不是能力清单里的东西**，返回 null 丢掉。
 *
 * 拿不到名字时返回 `{ kind, name: null }`，让上层能统计「对不上的条数」——
 * 对不上是要报出来的事实，不是可以静默丢弃的噪音。
 */
export function identifyCapability(call) {
  if (!call || typeof call.name !== "string") return null;
  if (call.name === "skill") {
    const name = call.args && typeof call.args.name === "string" ? call.args.name.trim() : "";
    return { kind: "skill", name: name === "" ? null : name };
  }
  if (call.name.startsWith("mcp__")) {
    const parts = call.name.split("__");
    // mcp__<server>__<tool>：server 为空也算 MCP 调用，只是名字不可用。
    const server = typeof parts[1] === "string" ? parts[1].trim() : "";
    return { kind: "mcp", name: server === "" ? null : server, tool: parts.slice(2).join("__") || null };
  }
  return null;
}

/**
 * 扫全部会话日志，产出「按能力聚合的使用记录」。
 *
 * 返回结构里的 `skills` / `mcp` 是 Map（能力名 → { uses, lastUsedAt, sessions }），
 * 由上层投影成清单字段。`unmatched` 记对不上名字的调用数——如实报，不硬凑。
 *
 * `maxFiles` 现在**真的管用**（透传给 `findSessionFiles` 的 `limit`）：早期版本把上限
 * 写死在遍历里，传 5000 也只拿到 2000 个且不报截断——调用方以为扫全了。
 */
export function collectUsage({ sessionDir = resolveSessionDir(), maxFiles = MAX_SESSION_FILES } = {}) {
  const found = findSessionFiles(sessionDir, { limit: maxFiles });
  // 透传后 found.files 已按上限截好，slice 只是防御（limit 非法时）。
  const files = found.files.slice(0, maxFiles);
  const result = {
    dir: sessionDir,
    // `present` = 目录在；`readable` = 目录真能列出来。**两者必须分开报**，
    // 否则「不可读」与「空目录」在读数上同形（那正是本仓库反复防的那类错）。
    present: found.present,
    readable: found.present && found.unreadable.length === 0,
    // 文件数被上限截断时要说出来，否则「只扫了一部分」看不出来。
    // 两个来源：内层遍历到上限（found.truncated），或调用方给的 maxFiles 更小。
    truncated: found.truncated === true || found.files.length > files.length,
    totalFiles: found.files.length,
    scannedFiles: 0,
    frames: 0,
    failedFrames: 0,
    skillCalls: 0,
    mcpCalls: 0,
    unmatched: 0,
    skills: new Map(),
    mcp: new Map(),
    // 目录读不动、悬空链接、单文件读失败都记在这里——**读不到要有痕**。
    unreadable: [...found.unreadable]
  };

  const record = (map, name, time, sessionId) => {
    const entry = map.get(name) || { uses: 0, lastUsedAt: null, sessions: new Set() };
    entry.uses += 1;
    if (Number.isFinite(time) && (entry.lastUsedAt === null || time > entry.lastUsedAt)) entry.lastUsedAt = time;
    if (sessionId) entry.sessions.add(sessionId);
    map.set(name, entry);
  };

  for (const file of files) {
    let buf;
    try {
      buf = readFileSync(file);
    } catch (error) {
      result.unreadable.push({ file, detail: `读失败：${error.message}` });
      continue;
    }
    result.scannedFiles += 1;
    const sessionId = file.split(/[\\/]/).slice(-2, -1)[0] || null;
    const stat = forEachFrame(buf, (text) => {
      for (const line of text.split("\n")) {
        if (!line.trim() || !line.includes('"tool-call"')) continue;
        // time 在行的外层，toolCallsInLine 已带上；这里从整行再取一次 session 级信息。
        for (const call of toolCallsInLine(line)) {
          const identified = identifyCapability(call);
          if (!identified) continue;
          if (identified.name === null) {
            result.unmatched += 1;
            continue;
          }
          if (identified.kind === "skill") {
            result.skillCalls += 1;
            record(result.skills, identified.name, call.time, sessionId);
          } else {
            result.mcpCalls += 1;
            // MCP 按 **server** 聚合（清单里的 MCP 条目是 server 粒度），不是按工具。
            record(result.mcp, identified.name, call.time, sessionId);
          }
        }
      }
    });
    result.frames += stat.frames;
    result.failedFrames += stat.failed;
    buf.fill(0);
  }

  return result;
}

/**
 * 由使用记录推使用状态。**照 `pipeline.js` 的 `deriveState` 写**：
 *   · 没有记录 → `candidate`（不知道用过没有，这是实话）；
 *   · 有记录、最近一次在 `staleAfterDays` 天内 → `trusted`；
 *   · 有记录但最近一次早于阈值 → `stale`。
 *
 * 保留期会限制这个判定的可靠度：会话日志被清理后，久未用的能力会**退化成 candidate**
 * （看起来像从没用过）。所以「candidate」的含义是「本机现存日志里没有记录」，
 * 而不是「从未使用」——这句话必须由上层写进输出，否则会被读错。
 */
export function deriveUsageState(entry, { now = Date.now(), staleAfterDays = STALE_AFTER_DAYS } = {}) {
  if (!entry || !Number.isFinite(entry.uses) || entry.uses === 0) return "candidate";
  if (Number.isFinite(entry.lastUsedAt)) {
    const ageDays = (now - entry.lastUsedAt) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > staleAfterDays) return "stale";
  }
  return "trusted";
}

/** 把 Map 里的聚合记录投影成清单友好的纯数组（含状态），按使用次数降序。 */
export function summarizeUsage(collection, { now = Date.now(), staleAfterDays = STALE_AFTER_DAYS } = {}) {
  const toRows = (map) =>
    [...map.entries()]
      .map(([name, entry]) => ({
        name,
        uses: entry.uses,
        lastUsedAt: Number.isFinite(entry.lastUsedAt) ? new Date(entry.lastUsedAt).toISOString() : null,
        sessions: entry.sessions.size,
        state: deriveUsageState(entry, { now, staleAfterDays })
      }))
      .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  return { skills: toRows(collection.skills), mcp: toRows(collection.mcp) };
}
