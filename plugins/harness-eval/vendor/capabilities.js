/**
 * M.O.（Modus Operandi · 手法）能力清单的**读侧**。
 *
 * 能力清单 = 「这台机器上、这个项目里，agent 能拿到哪些外部增强」的一份可复核投影。
 * 三类：技能（注入文本指令）／MCP（注册可执行工具）／插件（加载单元）。三者在 DSH 里
 * 同源——都是 Cordis 插件，只往不同 seam 注入——但**可见性完全不同**，这份文件的核心
 * 职责就是把这个差异如实说出来，而不是抹平成一张「都有」的清单。
 *
 * 三条纪律抄自 src/pipeline.js（理由见那边注释，这里只重申最要命的一条）：
 *   ① **读到什么说什么**：本清单里只有技能是「读到即事实」；插件的 bundles 是**声明**、
 *      MCP 的 catalog 是**可选目录**，两者都不等于「已生效」。把三者都说成「可用」，
 *      就是在造 api.js:1661 警告过的那类「看起来一切正常」的假面。
 *   ② 来源随身带（origin）：scope 是「从哪读出来的」，不是谁写的。
 *   ③ **绝不回退到进程 cwd**：拿不到项目根就如实标 project: null，别去读一个碰巧在
 *      旁边的工作区——那会把「读不到」变成「读到别的地方」。
 *
 * 为什么手写 YAML 子集：本包运行时依赖只有 morphicons 一个，为读一个补丁清单引 YAML
 * 解析器不划算（pipeline.js 拒绝 YAML 是同一个理由）。而 cordis.patch.yml 里我们真正
 * 需要的只有顶层数组的 `- id:` / `name:` / `disabled:` 三个标量，**不解析嵌套 config**
 * ——那是用户的任意结构，猜错了比不读更糟。所以下面只认这三个键，其余一律不碰。
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { collectUsage, summarizeUsage, resolveSessionDir, STALE_AFTER_DAYS } from "./session-usage.js";

/**
 * 三类能力的**带命名空间 kind**。顺序即清单展示顺序，也是实现难度顺序（技能最易、
 * 插件次之、MCP 最需运行时）。
 *
 * 为什么带 `capability:` 前缀：裸的「plugin」是 DSH 消息来源的保留 kind，V4 写入准入
 * 会整条拒绝，仓库用静态 grep 锁死了全 src/ 不许出现那个字面量（issue #326，见
 * `test/llm-message-source.test.js:190`）。用同一个前缀把三类统一下来，输出自洽。
 */
export const CAPABILITY_KINDS = ["capability:skill", "capability:mcp", "capability:plugin"];

/**
 * 可见性四态。**这是本清单最该被读懂的一列**：
 *   read          — 文件层读到即事实（技能条目的存在与元数据）
 *   declared      — 读到的是**声明**，未验证生效（插件的 bundles 列表、MCP 的连接项）
 *   catalog       — 读到的是**可选目录**，不是已连接（MCP 的远程 connector 清单）
 *   runtime-only  — 只有宿主运行时知道，文件层拿不到（插件的加载结果、MCP 的连接状态）
 *   absent        — 根不存在（不是错，是实话）
 */
export const VISIBILITIES = ["read", "declared", "catalog", "runtime-only", "absent"];

/** 单根最多收多少条技能。目录被塞满时报错，不要把它变成一次磁盘全扫。 */
const MAX_SKILLS_PER_ROOT = 500;

/**
 * 技能根（顺序即优先级，数值小的赢）。与 `@deepseek-ai/dsh-skill-filesystem` 的
 * `roots()` 保持同一套 rank——**抄它的数不是为了好看，是因为不抄就会和宿主的实际
 * 优先级不一致**，那时清单会指着一个实际不生效的技能说「这个是生效的」。
 *
 * **七个 rank，不是四个。** 宿主 `roots()` 还会给出 `custom`（用户配置的自定义目录）
 * 与 `bundled`（插件包自带），另有 `runtime`（插件在运行时注册的技能，250）无对应目录。
 * 本模块实现其中五个**有目录的**（四个默认根 + custom），bundled/runtime 的情况见
 * `skillRoots()` 的说明——它们要么需要宿主才知道目录，要么根本没有文件。
 */
export const SKILL_RANKS = {
  projectDsh: 100,
  projectAgents: 200,
  runtime: 250,
  custom: 300,
  userDsh: 400,
  userAgents: 500,
  bundled: 600
};

/**
 * 解析运行环境。全部可注入——测试要能造临时目录，不该去读真机器的家目录。
 *
 * 环境变量取法对齐宿主：`DSH_HOME` / `DSH_AGENTS_HOME` / `DSH_PROFILE_DIR` 都是
 * DSH 自己就在用的（本机实测三者均存在），所以读它们不是猜。
 */
export function resolveContext({
  projectRoot = null,
  dshHome = process.env.DSH_HOME || join(homedir(), ".dsh"),
  agentsHome = process.env.DSH_AGENTS_HOME || join(homedir(), ".agents"),
  profileDir = process.env.DSH_PROFILE_DIR || null,
  customSkillDirs = []
} = {}) {
  const root = typeof projectRoot === "string" ? projectRoot.trim() : "";
  return {
    projectRoot: root === "" ? null : root,
    dshHome: String(dshHome),
    agentsHome: String(agentsHome),
    profileDir: profileDir ? String(profileDir) : null,
    // 自定义技能目录由用户/宿主配置给出；本模块没有读取那处配置的途径（它在宿主的
    // config 里），所以**由调用方注入**——不猜、不去别处翻。
    customSkillDirs: Array.isArray(customSkillDirs) ? customSkillDirs.filter((d) => typeof d === "string" && d.trim() !== "") : []
  };
}

/**
 * 技能根清单。项目级两个根要有项目根才给——**没有项目根时返回的数组里就没有它们**，
 * 而不是拿进程 cwd 顶替（纪律 ③）。
 *
 * 覆盖宿主 `roots()` 里**有目录的**五类：project-dsh / project-agents / custom /
 * user-dsh / user-agents。另两类**故意不在返回值里**，因为它们的目录本模块拿不到或不存在：
 *   · `runtime`（rank 250）——插件在运行时把技能注册进 `ctx.skills`，**没有目录**，
 *     文件层无从发现；
 *   · `bundled`（rank 600）——来自插件包自带的 assets，目录由宿主按包解析，
 *     除非调用方显式给出，否则文件层不知道它在哪里。
 * 这两类的缺席是**如实的**：清单的 sources 里看不到它们，就说明本模块没读到，
 * 而不是「它们不存在」——`runtimeOnly` 那段会把这一点写出来。
 */
export function skillRoots({ projectRoot = null, dshHome, agentsHome, customSkillDirs = [] } = {}) {
  const roots = [];
  if (projectRoot) {
    roots.push({
      dir: join(projectRoot, ".dsh", "skills"),
      source: "project-dsh",
      rank: SKILL_RANKS.projectDsh,
      scope: "project",
      label: basename(projectRoot) || projectRoot
    });
    roots.push({
      dir: join(projectRoot, ".agents", "skills"),
      source: "project-agents",
      rank: SKILL_RANKS.projectAgents,
      scope: "project",
      label: basename(projectRoot) || projectRoot
    });
  }
  for (const dir of customSkillDirs) {
    roots.push({ dir: String(dir), source: "custom", rank: SKILL_RANKS.custom, scope: "custom", label: null });
  }
  roots.push({ dir: join(dshHome, "skills"), source: "user-dsh", rank: SKILL_RANKS.userDsh, scope: "user", label: null });
  roots.push({
    dir: join(agentsHome, "skills"),
    source: "user-agents",
    rank: SKILL_RANKS.userAgents,
    scope: "user",
    label: null
  });
  return roots.sort((a, b) => a.rank - b.rank);
}

/**
 * 技能名是否合法：kebab-case。抄宿主 `@deepseek-ai/dsh-skill` 的 `SKILL_NAME`——
 * 清单里出现一个宿主根本不会加载的名字，比不显示它更坏。
 */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 宿主对 description 的展示上限。超了会被截断，尾部触发词直接消失（实测过）。 */
const DESCRIPTION_DISPLAY_LIMIT = 497;

/**
 * 轻量 frontmatter 解析：取 `---` 包围块里的**顶层**键值。
 *
 * 支持三种形态，覆盖实测遇到的绝大多数 SKILL.md：
 *   ① 单行标量        `name: foo`
 *   ② 块标量          `description: |` ＋ 后续更深缩进的行（多行原样拼接）
 *   ③ 嵌套映射/数组    `metadata:` 之后更深缩进的行——**只记「有这块」，不进去**
 *
 * 不做完整 YAML：本包运行时依赖只有 morphicons，为读 frontmatter 引解析器不划算。
 * 但②③必须分开处理——最初把 `|` 当成「不解析就丢弃」，结果 55 个技能被误报成
 * 「没有 description」（实为块标量）。**清单里一条假警报会让人去改一个没坏的技能**，
 * 所以块标量要真读出来，嵌套结构才放弃。
 */
export function parseFrontmatter(text) {
  const out = { fields: {}, problems: [] };
  if (typeof text !== "string" || text === "") {
    out.problems.push("文件为空");
    return out;
  }
  const normalized = text.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) {
    out.problems.push("没有 frontmatter（文件未以 --- 开头）");
    return out;
  }
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) {
    out.problems.push("frontmatter 未闭合（找不到结尾的 ---）");
    return out;
  }
  const block = normalized.slice(normalized.indexOf("\n", 3) + 1, end);

  /** 记一个标量值；引号包裹的去掉引号。 */
  const put = (key, raw) => {
    let value = raw.trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out.fields[key] = value;
  };

  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    // 顶层键的缩进必须为 0——更深的是上一个键的续行/子结构，已在下面消费掉。
    if (indent > 0) continue;
    const m = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();

    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      // 块标量：收后续更深缩进的行，按原行的相对缩进拼回去。
      const blockLines = [];
      let j = i + 1;
      let blockIndent = -1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === "") {
          blockLines.push("");
          continue;
        }
        const ci = l.length - l.trimStart().length;
        if (ci === 0) break;
        if (blockIndent === -1) blockIndent = ci;
        blockLines.push(l.slice(Math.min(blockIndent, ci)));
      }
      i = j - 1;
      // 折叠标量（>）按 YAML 规则把换行折成空格；字面标量（|）保留换行。
      const joined = value.startsWith(">")
        ? blockLines.join("\n").replace(/\n(?!\n)/g, " ").trim()
        : blockLines.join("\n").replace(/\s+$/, "");
      put(key, joined);
      continue;
    }

    if (value === "") {
      // 嵌套映射/数组：只记「有这个键」，不解析其内部结构。
      out.fields[key] = "";
      continue;
    }

    put(key, value);
  }
  return out;
}

/**
 * 扫一个技能根（一层深：`<name>/SKILL.md` 或 `<name>.md`，与宿主一致）。
 *
 * **坏与警告必须分开**，这是本函数最容易做错的地方（第一版就做错了）：
 *   · `broken`   = 宿主**不会加载**它（没有 SKILL.md / 没有 name / 没有 description /
 *                  名字不是 kebab-case / 读不出来）。这些要从清单的技能列表里拿掉。
 *   · `warnings` = 宿主**照常加载**，只是有值得知道的事。**留在技能列表里**。
 *
 * 判据来自宿主行为，不是我的口味：
 *   - name 与目录名不一致 **不是错**——宿主以 frontmatter 的 `name` 为身份。实测
 *     `react-three-fiber/` 目录里声明的是 `threejs-scene-builder`，而技能目录里出现的
 *     正是后者；`superpowers-*` 一整批同理。第一版把它当错，一次报案 20 例假警报——
 *     **一条假警报会让人去改一个没坏的技能**，比漏报更坏。
 *   - description 超过展示上限会被截断（尾部触发词直接看不见），但技能能用。
 *     计为警告并报出长度，让人自己决定要不要缩。
 */
export function scanSkillRoot(root, { source, rank, scope, label } = {}) {
  // 键名用 `root`（扫的是哪个目录）。**下游一律读 `r.root`**——早期版本这里写成 `root`
  // 而下游读 `r.dir`，结果 175 条技能的 `origin.dir` 全是 undefined，而这种错在
  // 「看着有值」的样本里不会暴露（dir 为空不影响别的字段，只是位置丢了）。
  const result = { root, source, rank, scope, label: label ?? null, present: false, skills: [], broken: [], warnings: [] };
  if (!existsSync(root)) return result;
  result.present = true;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    result.broken.push({ file: null, detail: `目录读失败：${error.message}` });
    return result;
  }
  if (entries.length > MAX_SKILLS_PER_ROOT) {
    result.broken.push({ file: null, detail: `目录里有 ${entries.length} 项，超过上限 ${MAX_SKILLS_PER_ROOT}` });
    return result;
  }
  for (const entry of entries) {
    const entryName = entry.name;
    if (entryName.startsWith(".")) continue;

    // 符号链接要单独认：`Dirent.isDirectory()` 对 symlink 返回 **false**（它描述的是
    // 链接自身，不是目标），所以只判断 isDirectory()/isFile() 会把链接进来的技能
    // **静默丢掉**——实测本机某用户级技能根里就有一个链接进来的技能，8 个目录只扫出
    // 7 个，且它既不在 skills 也不在 broken 里。宿主的扫描器
    // （dsh-skill-filesystem/lib/index.js:409）正是显式处理 isSymbolicLink 的。
    let isDir = entry.isDirectory();
    let isMdFile = entry.isFile() && entryName.endsWith(".md");
    let viaLink = false;
    const full = join(root, entryName);
    if (entry.isSymbolicLink()) {
      viaLink = true;
      try {
        const st = statSync(full); // 跟随链接看目标
        isDir = st.isDirectory();
        isMdFile = st.isFile() && entryName.endsWith(".md");
      } catch (error) {
        // 悬空链接：目标不存在。**如实报**，不静默跳过。
        result.broken.push({ file: entryName, detail: `符号链接目标不可达：${error.message}` });
        continue;
      }
    }

    let file = null;
    let dirName = null;
    if (isDir) {
      file = join(root, entryName, "SKILL.md");
      dirName = entryName;
    } else if (isMdFile) {
      file = join(root, entryName);
      dirName = entryName.slice(0, -3);
    } else continue;
    if (!existsSync(file)) {
      result.broken.push({ file: dirName, detail: viaLink ? "符号链接指向的目录里没有 SKILL.md" : "目录里没有 SKILL.md" });
      continue;
    }
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      result.broken.push({ file: dirName, detail: `读失败：${error.message}` });
      continue;
    }
    const fm = parseFrontmatter(text);
    const declared = String(fm.fields.name ?? "").trim();
    const description = String(fm.fields.description ?? "").trim();

    // --- 真·不可加载：这些会让宿主跳过整个技能 ---
    const fatal = [...fm.problems];
    if (declared === "") fatal.push("frontmatter 里没有 name（宿主不会加载）");
    else if (!SKILL_NAME_RE.test(declared)) fatal.push(`name 不是 kebab-case（${declared}）`);
    if (description === "") fatal.push("frontmatter 里没有 description（宿主不会加载）");
    if (fatal.length) {
      result.broken.push({ file: dirName, detail: fatal.join("；") });
      continue;
    }

    // --- 警告：能加载，但有值得知道的事 ---
    const warnings = [];
    if (declared !== dirName) {
      // 不是错，但要说清「以哪个名字调用」——否则按目录名去调会找不到。
      warnings.push({
        kind: "name-mismatch",
        detail: `以 frontmatter 的 name「${declared}」调用；目录名是「${dirName}」`
      });
    }
    if (description.length > DESCRIPTION_DISPLAY_LIMIT) {
      warnings.push({
        kind: "description-too-long",
        detail: `description ${description.length} 字符，超过展示上限 ${DESCRIPTION_DISPLAY_LIMIT}——超出的尾部会被截断，写在后面的触发词看不到`
      });
    }

    const entryOut = {
      name: declared,
      dirName,
      description,
      descriptionLength: description.length,
      file,
      // 链接进来的技能要标出来：文件其实在别处，改它等于改那边。
      viaSymlink: viaLink,
      // 技能是三类里唯一「读到即事实」的：文件在、必填字段齐，宿主就会加载它。
      visibility: "read"
    };
    if (warnings.length) entryOut.warnings = warnings;
    result.skills.push(entryOut);
  }
  result.skills.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/** 读 `storages/mcp_connector.json`。只取 catalog 与连接表的**有无**，不解释业务含义。 */
export function readMcpStore(dshHome) {
  const out = { file: join(dshHome, "storages", "mcp_connector.json"), present: false, catalog: [], connections: [], unreadable: null };
  if (!existsSync(out.file)) return out;
  out.present = true;
  let raw;
  try {
    raw = JSON.parse(readFileSync(out.file, "utf8"));
  } catch (error) {
    out.unreadable = `JSON 解析失败：${error.message}`;
    return out;
  }
  const tables = raw?.tables ?? {};
  const connectors = tables?.catalog?.remote?.connectors;
  if (Array.isArray(connectors)) {
    for (const c of connectors) {
      if (!c || typeof c !== "object") continue;
      out.catalog.push({
        id: String(c.id ?? ""),
        name: String(c.name ?? ""),
        vendor: String(c.vendor ?? ""),
        category: String(c.category ?? ""),
        summary: String(c.summary ?? ""),
        // servers 里带 url/transport，但**不输出 url**：它可能是私有端点，而清单会被截图。
        servers: Array.isArray(c.servers) ? c.servers.length : 0,
        // **serverName 必须留下来**：会话日志里的 MCP 工具名是 mcp__<serverName>__<tool>，
        // 而 serverName 与 catalog 的 `id` **不保证相同**——实测本机就有两例对不上
        // （`baidu-maps`↔`baidu-map`、`bazhuayu-cloud-collection`↔`bazhuayu`）。
        // 只拿 id 去匹配使用记录，那些 server 的真实调用会被显示成 `candidate`。
        serverNames: Array.isArray(c.servers)
          ? c.servers.map((s) => String(s?.serverName ?? "").trim()).filter((s) => s !== "")
          : [],
        authMode: String(c?.auth?.mode ?? ""),
        probeStatus: String(c.probeStatus ?? ""),
        visibility: "catalog"
      });
    }
  }
  const toRows = (table) =>
    Object.entries(table && typeof table === "object" ? table : {}).map(([key, value]) => ({
      key,
      name: String(value?.name ?? value?.serverName ?? key),
      visibility: "declared"
    }));
  out.connections = [...toRows(tables.connections), ...toRows(tables.grants)];
  return out;
}

/**
 * 保守解析 cordis.patch.yml 的**顶层数组条目**：只认 `- id:` / `name:` / `disabled:`。
 *
 * 见到块级 `config:` 就跳过它之后所有更深缩进的行——**不解析用户的任意配置结构**。
 * 缩进判断一律用「行首空格数比条目行多」，不引 YAML 语义。
 *
 * 值要去引号：实测本机 `cordis.patch.yml` 里写的是 `name: "@deepseek-ai/..."`，
 * 带着引号拿去比对包名会一个都匹配不上（这个 bug 是被测试逼出来的）。
 */
export function parsePatchEntries(text) {
  const entries = [];
  const problems = [];
  if (typeof text !== "string" || text.trim() === "") return { entries, problems };

  /** 去引号：单双引号成对才剥，避免吃掉值里的正常引号。 */
  const unquote = (v) => {
    const s = v.trim();
    if (s.length > 1 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
      return s.slice(1, -1);
    }
    return s;
  };

  let cur = null;
  let skipDeeper = false;
  let entryIndent = 0;
  let blockIndent = -1;
  for (const rawLine of text.split(/\r?\n/)) {
    const noComment = rawLine.replace(/\s+#.*$/, "");
    if (noComment.trim() === "") continue;
    if (noComment.trimStart().startsWith("#")) continue;
    const indent = noComment.length - noComment.trimStart().length;
    const line = noComment.trim();
    if (line.startsWith("- ")) {
      // **嵌套列表不是新条目。** 只有缩进不比当前条目更深的 `- ` 才算顶层条目；
      // 更深的属于上一个条目的 config 内部（实测本机 patch 里 `allowedModels:`
      // 这类嵌套列表下也写着自己的 - id / name，若一律当成新条目，30 个顶层条目
      // 会被数成 69 条）。
      if (cur !== null && indent > entryIndent) continue;
      if (cur) entries.push(cur);
      cur = { id: null, name: null, disabled: null };
      skipDeeper = false;
      blockIndent = -1;
      entryIndent = indent;
      const rest = line.slice(2).trim();
      const m = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(rest);
      if (m) {
        if (m[1] === "id") cur.id = unquote(m[2]);
        else if (m[1] === "name") cur.name = unquote(m[2]);
        else if (m[1] === "disabled") cur.disabled = unquote(m[2]) === "true";
      }
      continue;
    }
    if (!cur) {
      problems.push(`顶层不是数组条目（遇到「${line.slice(0, 40)}」）`);
      continue;
    }
    // 条目自身的键缩进与 `- ` 同层；比 `- ` 更深的才是被跳过的嵌套结构。
    //
    // 判据是**相对于「打开嵌套块那个键」的缩进**，不是「比 `- ` 深就跳过」。两边的
    // 用例都必须成立，缺一会踩坑：
    //   · `disabled:` 写在 `config:` 块**之后**、且与 `config:` 同缩进 —— 必须认出来
    //     （实测本机 patch 里就有这种写法，一律跳过会让 disabled 静默变成「未声明」）；
    //   · 嵌套**列表**里的 `name:`（实测 `allowedModels` 下就有）缩进更深 —— 必须跳过
    //     （否则它会被当成顶层条目的 name，实测就是这么错的）。
    // 所以记下 `blockIndent` = 打开嵌套块那个键的缩进：比它深的才跳。
    const m = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const isScalarWeWant = key === "id" || key === "name" || key === "disabled";
    if (skipDeeper && indent > blockIndent) continue;
    const value = unquote(m[2]);
    if (value === "") {
      // 形如 `config:` 的嵌套块：只记录「有这块」，不进去。
      if (!isScalarWeWant) {
        skipDeeper = true;
        blockIndent = indent;
      }
      continue;
    }
    if (key === "id") cur.id = value;
    else if (key === "name") cur.name = value;
    else if (key === "disabled") cur.disabled = value === "true";
    else if (indent <= entryIndent) {
      // 与条目同层的、我们不认识的键：**说出来**。补丁文件格式一变（比如以后多了
      // `enabled:`），静默忽略会让清单显示一份「看起来正常」的旧理解——这正是本仓
      // 反复踩的那类错（api.js:1661 的「忽略了会静默退成全局，而全局看起来
      // 一切正常」是同一族）。只在同层报：更深的是 config 内部，本就不该解析。
      problems.push(`未识别的顶层键「${key}」（只认 id / name / disabled，其余不解析）`);
    }
  }
  if (cur) entries.push(cur);
  return { entries, problems };
}

/** 读 profile 的插件声明：`package.json` 的 `dsh.profile.bundles` + `cordis.patch.yml`。 */
export function readPluginDeclarations(profileDir) {
  const out = {
    dir: profileDir,
    present: false,
    bundles: [],
    patches: [],
    patchProblems: [],
    unreadable: []
  };
  if (!profileDir || !existsSync(profileDir)) return out;
  out.present = true;

  const pkgFile = join(profileDir, "package.json");
  if (existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
      const bundles = pkg?.dsh?.profile?.bundles;
      if (Array.isArray(bundles)) {
        for (const b of bundles) {
          if (typeof b === "string" && b.trim() !== "") {
            out.bundles.push({ id: b.trim(), visibility: "declared" });
          }
        }
      }
    } catch (error) {
      out.unreadable.push({ file: "package.json", detail: `JSON 解析失败：${error.message}` });
    }
  } else {
    out.unreadable.push({ file: "package.json", detail: "不存在" });
  }

  const patchFile = join(profileDir, "cordis.patch.yml");
  if (existsSync(patchFile)) {
    try {
      const parsed = parsePatchEntries(readFileSync(patchFile, "utf8"));
      out.patches = parsed.entries
        .filter((e) => e.id !== null || e.name !== null)
        .map((e) => ({
          id: e.id,
          name: e.name,
          disabled: e.disabled === true,
          visibility: "declared"
        }));
      out.patchProblems = parsed.problems;
    } catch (error) {
      out.unreadable.push({ file: "cordis.patch.yml", detail: `读失败：${error.message}` });
    }
  } else {
    out.unreadable.push({ file: "cordis.patch.yml", detail: "不存在" });
  }
  return out;
}

/**
 * 总入口：按三类各读一遍，投影成 `mneme.capability/v1`。
 *
 * 每类的处理态度**故意不同**，理由各自写在上面三个函数里：技能坏一条记一条、MCP 的
 * catalog 缺失不算错、插件声明读不到就如实说。**没有一处会抛**——清单是只读视图，
 * 它自己挂掉只会让人更看不清现状。
 */
export function discoverCapabilities(options = {}) {
  const ctx = resolveContext(options);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const staleAfterDays = Number.isFinite(options.staleAfterDays) ? options.staleAfterDays : STALE_AFTER_DAYS;

  // --- 使用证据 ---
  // 会话日志里的 tool-call 记录：**唯一能回答「这个能力用过没」的来源**。
  // 注意它的语义边界：读到的只是**本机现存日志**里的调用，日志被清理后旧记录就没了，
  // 所以 `candidate` 的含义是「现存日志里没有记录」，不是「从未使用」——这句话会
  // 随结果一起输出（usage.scopeNote），否则最容易被读错。
  let usageSummary = { skills: [], mcp: [] };
  let usageCollection = null;
  try {
    usageCollection = collectUsage({ sessionDir: options.sessionDir ?? resolveSessionDir(ctx), maxFiles: options.maxUsageFiles });
    usageSummary = summarizeUsage(usageCollection, { now, staleAfterDays });
  } catch (error) {
    // 清单是只读视图，使用证据拿不到不该让它整个挂掉——如实记下来，继续输出其余部分。
    usageCollection = {
      dir: options.sessionDir ?? resolveSessionDir(ctx),
      present: false,
      scannedFiles: 0,
      frames: 0,
      failedFrames: 0,
      skillCalls: 0,
      mcpCalls: 0,
      unmatched: 0,
      skills: new Map(),
      mcp: new Map(),
      unreadable: [{ file: null, detail: `会话日志扫描失败：${error.message}` }]
    };
  }
  const usageBySkill = new Map(usageSummary.skills.map((r) => [r.name, r]));
  const usageByMcp = new Map(usageSummary.mcp.map((r) => [r.name, r]));

  // --- 技能 ---
  // 这里有两个不同的键名，别混（混过一次，见 scanSkillRoot 的注释）：
  //   · `skillRoots()` 的返回值用 **dir** → 所以下面读 `r.dir`，正确；
  //   · `scanSkillRoot()` 的返回值用 **root** → 下游一律读 `scannedRoot.root`。
  const roots = skillRoots(ctx);
  const scanned = roots.map((r) => scanSkillRoot(r.dir, r));
  const skillEntries = [];
  const seenNames = new Map();
  const shadowed = [];
  for (const scannedRoot of scanned) {
    for (const skill of scannedRoot.skills) {
      // 去重按 **name**（宿主以 frontmatter 的 name 为身份），不是目录名。
      const prior = seenNames.get(skill.name);
      if (prior) {
        // 优先级高的先扫（roots 已按 rank 升序），所以后到的被压住是**安排好的**，
        // 记下来免得以后有人以为技能丢了。
        shadowed.push({ name: skill.name, hidden: scannedRoot.source, by: prior.source });
        continue;
      }
      seenNames.set(skill.name, { source: scannedRoot.source, rank: scannedRoot.rank });
      skillEntries.push({
        kind: "capability:skill",
        id: skill.name,
        name: skill.name,
        dirName: skill.dirName,
        summary: skill.description,
        descriptionLength: skill.descriptionLength,
        // 链接进来的技能要标出来：文件其实在别处，改它等于改那边。
        viaSymlink: skill.viaSymlink === true,
        warnings: skill.warnings ?? [],
        // 使用证据：**没有记录就是 `candidate`**，不由人写死（照 pipeline.js 的 deriveState）。
        usage: usageBySkill.get(skill.name) ?? { name: skill.name, uses: 0, lastUsedAt: null, sessions: 0, state: "candidate" },
        origin: {
          scope: scannedRoot.scope,
          label: scannedRoot.label,
          source: scannedRoot.source,
          rank: scannedRoot.rank,
          // 是 `root`（scanSkillRoot 的键名），不是 `dir`——写错会静默变成 undefined。
          dir: scannedRoot.root,
          file: skill.file
        },
        visibility: "read"
      });
    }
  }

  // 有使用记录、但清单里没有对应技能名的调用：**如实报出来**。
  // 实测有一例（一个曾用过、现已不在扫描范围内的技能）——它是真信息，
  // 说明「能力消失但使用痕迹还在」，不该被静默丢弃。
  const knownSkillNames = new Set(skillEntries.map((s) => s.name));
  const usageNotInManifest = usageSummary.skills
    .filter((r) => !knownSkillNames.has(r.name))
    .map((r) => ({ name: r.name, uses: r.uses, lastUsedAt: r.lastUsedAt, state: r.state }));

  // --- MCP ---
  const mcp = readMcpStore(ctx.dshHome);

  // --- 插件 ---
  const plugins = readPluginDeclarations(ctx.profileDir);

  const brokenSkills = scanned.flatMap((r) =>
    r.broken.map((b) => ({ source: r.source, dir: r.root, file: b.file, detail: b.detail }))
  );
  const skillWarnings = skillEntries.flatMap((s) =>
    (s.warnings || []).map((w) => ({ source: s.origin.source, name: s.name, kind: w.kind, detail: w.detail }))
  );

  // 用投影后的 catalog（带 usage）算计数——**不能拿原始的 mcp.catalog**，那份没挂使用记录。
  //
  // **按 serverName 找使用记录，不是按 id。** 会话日志里的 MCP 工具名是
  // `mcp__<serverName>__<tool>`，而 serverName 与 catalog 的 `id` 不保证相同
  // （实测 `baidu-maps`↔`baidu-map`、`bazhuayu-cloud-collection`↔`bazhuayu`）。
  // 只按 id 匹配会让那些 server 的真实调用显示成 candidate。
  // 一条 catalog 可能有多个 serverName：逐个试，命中即用；都没有才回退到 id。
  const usageForCatalogEntry = (c) => {
    for (const sn of c.serverNames ?? []) {
      const hit = usageByMcp.get(sn);
      if (hit) return hit;
    }
    return usageByMcp.get(c.id) ?? { name: c.id, uses: 0, lastUsedAt: null, sessions: 0, state: "candidate" };
  };
  const mcpCatalogWithUsage = mcp.catalog.map((c) => ({ ...c, usage: usageForCatalogEntry(c) }));

  return {
    contract: "mneme.capability/v1",
    generatedAt: new Date(now).toISOString(),
    context: {
      projectRoot: ctx.projectRoot,
      projectLabel: ctx.projectRoot ? basename(ctx.projectRoot) || ctx.projectRoot : null,
      dshHome: ctx.dshHome,
      agentsHome: ctx.agentsHome,
      profileDir: ctx.profileDir,
      customSkillDirs: ctx.customSkillDirs
    },
    /**
     * **本模块没覆盖的技能来源**，如实列出而不是让人以为清单是全的。
     * 两条都是宿主 `roots()` 里真实存在的 rank，但它们的目录本模块拿不到：
     *   · runtime（rank 250）：插件运行时注册进 `ctx.skills`，没有目录；
     *   · bundled（rank 600）：插件包自带 assets，目录由宿主按包解析。
     * 想看到它们，得由调用方把目录经 `customSkillDirs` 注入，或去问宿主。
     */
    uncoveredSkillSources: [
      { source: "runtime", rank: SKILL_RANKS.runtime, why: "插件运行时注册进 ctx.skills，没有目录可供文件层扫描" },
      { source: "bundled", rank: SKILL_RANKS.bundled, why: "插件包自带 assets，目录由宿主按包解析；需要时经 customSkillDirs 注入" }
    ],
    sources: [
      ...scanned.map((r) => ({
        // `kind` 一律带 `capability:` 前缀。这是**规避仓库的保留字**，不是装饰：
        // 裸的「plugin」是 DSH 消息来源的保留 kind，V4 写入准入会整条拒绝，而
        // `test/llm-message-source.test.js:190` 用静态 grep 锁死了全 src/ 不许再出现
        // 那个字面量（issue #326）。三类统一加前缀，既避开保留字，也让「这是能力清单
        // 自己的分类」一眼可辨——真实来源由 source 字段说清。
        kind: "capability:skill",
        source: r.source,
        scope: r.scope,
        label: r.label,
        dir: r.root,
        present: r.present,
        rank: r.rank,
        count: r.skills.length
      })),
      {
        kind: "capability:mcp",
        source: "mcp-store",
        scope: "user",
        label: null,
        dir: mcp.file,
        present: mcp.present,
        rank: null,
        count: mcp.catalog.length
      },
      {
        kind: "capability:plugin",
        source: "profile-declarations",
        scope: "user",
        label: null,
        dir: plugins.dir,
        present: plugins.present,
        rank: null,
        count: plugins.bundles.length + plugins.patches.length
      }
    ],
    skills: skillEntries,
    shadowed,
    usageNotInManifest,
    usage: {
      // 使用证据的来源与口径。**这段必须和数字一起读**：`candidate` 只是「现存日志里
      // 没有记录」，不等于「从未使用」——日志会被清理，越久远的能力越容易退化成 candidate。
      source: usageCollection?.dir ?? null,
      sourcePresent: usageCollection?.present === true,
      scannedFiles: usageCollection?.scannedFiles ?? 0,
      frames: usageCollection?.frames ?? 0,
      // 解不出来的帧数要报出来：它直接决定「有没有漏看调用」。
      failedFrames: usageCollection?.failedFrames ?? 0,
      skillCalls: usageCollection?.skillCalls ?? 0,
      mcpCalls: usageCollection?.mcpCalls ?? 0,
      // 对不上名字的调用数（技能没记 name、或 MCP server 名为空）。如实报，不硬凑。
      unmatchedCalls: usageCollection?.unmatched ?? 0,
      // **读不到要与「没有」可分辨**：`sourcePresent` 只说目录在不在，
      // `sourceReadable` 说它是不是真能列出来。两者都为 true 而记录为空，
      // 才是「确实没有调用记录」；任何一个为 false 时，数字都不可信。
      sourceReadable: usageCollection?.readable === true,
      // 文件数被上限截断时要报出来，否则「只扫了一部分」看不出来。
      filesTruncated: usageCollection?.truncated === true,
      staleAfterDays,
      scopeNote:
        "使用记录只覆盖本机现存的会话日志。`candidate` 的含义是「在这些日志里没有记录」，不是「从未使用」——日志被清理后，久未用的能力会退化成 candidate；反过来，若 sourceReadable 为 false，则所有 candidate 都不可信。另注意：`stale` 只在现存日志覆盖的时间跨度**超过** staleAfterDays 时才可能出现；本机实测窗口 63.5 天 < 90 天，故 stale 结构性不可达——此时「久未用」与「从未用」在读数上不可区分。这是读数的边界，不是「能力都还在用」。",
      unreadable: usageCollection?.unreadable ?? []
    },
    mcp: {
      // 关键区分：catalog 是「可选目录」，connections 是「已连接的声明」。两者都不是
      // 「此刻真的连上了」——那个只有宿主运行时知道，所以下面单列 runtimeOnly。
      catalogSource: mcp.file,
      catalogCount: mcp.catalog.length,
      // catalog 每条挂上使用记录（按 server id 对）。**这是把「可选目录」与「真用过」
      // 分开的关键一列**：109 条目录里，只有 github 这一条有调用痕迹。
      catalog: mcpCatalogWithUsage,
      connections: mcp.connections,
      runtimeOnly: {
        what: "MCP 连接的真实状态与工具清单",
        why: "由 @deepseek-ai/dsh-mcp-client 在运行时把工具注册到 ctx.tools（public name 形如 mcp__<serverName>__<rawName>），不落盘",
        howToAsk: "宿主侧读 Loader / ctx.tools；文件层拿不到时不猜"
      },
      unreadable: mcp.unreadable
    },
    plugins: {
      bundles: plugins.bundles,
      patches: plugins.patches,
      patchProblems: plugins.patchProblems,
      unreadable: plugins.unreadable,
      runtimeOnly: {
        what: "插件的真实加载结果（某个包可能加载失败）",
        why: "bundles 与 patch 是**声明**；加载状态由 Cordis Loader 在内存中持有（dsh-host-plugin-inventory 直读 Loader）",
        howToAsk: "宿主侧读 pluginInventory 服务；文件层拿不到时不猜"
      }
    },
    brokenSkills,
    skillWarnings,
    counts: {
      skills: skillEntries.length,
      mcpCatalog: mcp.catalog.length,
      mcpConnections: mcp.connections.length,
      pluginBundles: plugins.bundles.length,
      pluginPatches: plugins.patches.length,
      // broken = 宿主不会加载；warnings = 能加载但有值得知道的事（**不计入 broken**）。
      broken: brokenSkills.length,
      warnings: skillWarnings.length,
      // 使用侧：有记录的技能数 / 被用过的 MCP server 数 / 用了但已不在清单里的条数。
      skillsWithUsage: skillEntries.filter((s) => s.usage.state !== "candidate").length,
      mcpServersWithUsage: mcpCatalogWithUsage.filter((c) => c.usage.state !== "candidate").length,
      usageNotInManifest: usageNotInManifest.length
    }
  };
}
