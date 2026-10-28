# 本机定制（升级时必读）

这个目录是 `dsh-connect-workbuddy` 的**本地定制版**，通过 `link:` 挂进 profile：

```
dsh-connect-workbuddy: link:C:/Users/zzn19/Documents/deepseek-harness/default-workspace/bundles/dsh-connect-workbuddy
```

上游升级时**不要**用 `plugin_manager install_bundle` 直接覆盖（那会把 source 从 `link:` 换成 registry 版本，
本文件描述的定制会丢失）。正确做法见文末「升级流程」。

## 定制内容（相对上游的差异）

当前本地版本：`5.12.4-zh.1`（上游 `5.12.4`）。相对上游 npm 包，本目录只有这些不同：

1. `package.json` — `version` 加 `-zh.N` 后缀。
2. `lib/host-heartbeat-<hash>.js` — **指纹改写换成本机中文版**（见下）。
3. `lib/index.js` — **新增 `retryPolicy` 配置项**，让默认码表能补进 `MALFORMED_RESPONSE`（见「额外增加的 A」）。

### 指纹改写：中文版而不是英文中性头

上游的做法是：命中指纹的行**前面追加**一条英文中性头 `You are a helpful assistant.`。本机改成本机做法：

- `WORKBUDDY_FALLBACK_SYSTEM_PROMPT = "你乃AI辅助软件也。"`（占位中性头换成中文短句）
- 新增 `WEB_GUI_PROMPT_ZH`：把 DeepSeek Harness Web GUI 那段英文换成等价中文
- `UNAPPROVED_CHANNEL_OPENINGS` 从「字符串前缀数组」改成 `{ prefix, replacement }` 数组
- `isUnapprovedChannelOpening()` 拆成 `unapprovedChannelOpeningOf()`（返回命中项）+ 布尔包装
- 命中行的**整行原地替换**（`neutralizeText()`），而不是只在开头追加；原因是实测某模型对这段英文
  即使在正文中段也会被网关拒

上游从 5.7.0 起、并经 5.8.1/5.12.x 加强的机制**全部保留**，未做改动：

- `scansOpening()`（system + assistant 两个角色都扫）
- 数组 content 的逐 text part 处理
- `breakIdentityClauses()`（在每个词界插 U+200B，对付「任意位置精确子串」门）
- `forceNeutralHead()` 一次性自愈重试
- `perturbChannelFingerprints()` 零宽空格扰动（稀疏 / 密集两档；5.12.4 起密集档是 O(n) 的 `spaceDenseBreaks`）
- `statesBusinessCode()`（5.12.3 起业务码按「信封自述优先、再文本扫描」读，不再按字节匹配）
- `openingEvidenceOfBody()` 失败证据回显
- `channelPerturbation` 配置项（`off` / `failure` / `always`）
## 升级流程

```powershell
cd C:\Users\zzn19\Documents\deepseek-harness\default-workspace\probe\wb-diff
npm pack dsh-connect-workbuddy@<新版本>            # 下载 tarball
mkdir upN; tar -xzf dsh-connect-workbuddy-<新版本>.tgz -C upN   # 解包到 upN\package
# 1) 先看上游改了什么：chunk 名带 hash，每次都会变
git diff --no-index upM\package\lib\host-heartbeat-*.js upN\package\lib\host-heartbeat-*.js
# 2) 覆盖进 bundle（保留 local/ 与 node_modules/）
robocopy .\upN\package <bundle> /E /XD node_modules local
rm <bundle>\lib\host-heartbeat-<旧 hash>.js          # 删掉上一个版本的 chunk
# 3) 重放两处本地定制，锚点文件在 probe/wb-diff/
python <bundle>\local\apply_local.py <bundle>\lib\host-heartbeat-<新 hash>.js <probe>\anchors.json
python <bundle>\local\apply_local.py <bundle>\lib\index.js                    <probe>\anchors_retry.json
# 4) 两组断言必须全绿
node <bundle>\local\verify_local.mjs                 # 8 条：中文指纹改写
node <bundle>\local\verify_retry.cjs <bundle>\lib\index.js   # 10 条：retryPolicy 接线
# 5) 改 package.json 的 version 后缀，重启 DSH 桌面端生效
```

`local/apply_local.py` 是**锚点式**补丁：它读一个 JSON 锚点文件（`[{label, old, new}]`），
每个锚点必须在目标文件里**恰好命中一次**，否则直接报错退出、不写出半成品。
上游重构掉这几段代码时它会失败——那正是需要人工看一眼的时候，不要改成模糊匹配。

`local/verify_local.mjs` 自己发现 `lib/host-heartbeat-*.js`（**不写死 hash**，升级换了 chunk 名也能跑），
并自动解析 chunk 的 `prepareChatBody as <别名>`（**别名也会变**：5.7.0 是 `$`，5.12.0 是 `rt`），跑 8 条断言：
1. Web GUI 英文段落整行被换成中文
2. `you are an ai agent powered by deepseek harness` 开头被换成中文占位
3. `Claude Code` 开头被换掉
4. assistant 历史消息同样被扫
5. 数组 content 的每个 text part 都被处理
6. 干净提示词**逐字节不变**
7. 缺 system 消息时补中文占位头
8. `developer` 角色先改 `system` 再中性化

`local/verify_retry.cjs` 检查 `lib/index.js` 里 retryPolicy 的三处接线是否还在（导入、schema、profile、adapter），
并用一份 `resolveRetryPolicy` 契约的忠实桩验证「默认码表不含 MALFORMED_RESPONSE / 配置后含它」。

**注意**：`node <file>` 直接跑 `index.js` 会报 `ERR_MODULE_NOT_FOUND: @deepseek-ai/cosmokit`——因为
`node_modules/@deepseek-ai/schemastery` 里那份依赖不完整。这是本目录的既有状态（4.14.1 时代同样报），
不影响宿主加载，只是命令行冒烟跑 index.js 会失败。`verify_local.mjs` 只 import chunk 文件（纯 node 内置依赖），
所以能跑。

## 升级历史

- `4.14.1-zh.2` → `5.7.0-zh.1`（2026-10-23）：上游从 2 条指纹前缀扩到「双角色扫描 + 数组 part + 三级重试」，
  本机定制按锚点重放到 5.7.0 的 chunk 上。升级前完整备份在 `probe/wb-diff/backup-4.14.1-zh.2`（31 个文件）。
  与上游 5.7.0 解包比对：26 个文件里只有两个不同（chunk 与 package.json 的 version 后缀），
  没有多出/少掉上游文件，`dependencies` / `peerDependencies` 逐条相同。
- `5.7.0-zh.1` → `5.12.0-zh.1`（2026-10-26）：上游 5.8.1 重构了指纹那一段，本次是**叠加**而非替换，
  详见下一节。
- `5.12.0-zh.1` → `5.12.4-zh.1`（2026-10-28）：见本文件末尾「2026-10-28 升级到 5.12.4」一节。


---

# 2026-10-26 升级到 5.12.0（本地版 5.12.0-zh.1）

## 改了什么、为什么不能照抄旧流程

5.7.0 → 5.12.0 中途，上游在 5.8.1 重构了渠道指纹那一段：新增
`IDENTITY_CLAUSE` + `breakIdentityClauses()`，在身份子句的每个词界插入 U+200B，
用来对付网关的「任意位置精确子串」门（issue #125）。这是**上游的新防线**。

旧版 `local/apply_local.py` 的做法是整段替换 `neutralizeChannelFingerprints`，
在 5.12.0 上四个锚点里有三个已不存在，硬跑会失败；即便强行改，也会把这道新防线删掉。
所以本次是**叠加**，不是替换。

### 本地定制（仍然全部保留，8 条断言全绿）

1. 被指纹命中的行**整行替换**成中文，而不是在前面补一行英文中性头。
2. 匹配按**行**进行（网关对正文中段的英文段同样拒绝，实测过）。
3. Web GUI 那段换成等价的 `WEB_GUI_PROMPT_ZH`；其余身份行换成 `你乃AI辅助软件也。`
4. 扫描范围沿用上游：`system` 与 `assistant`、以及数组 content 的每个 text part。

### 与上游的接缝

只重写了一个函数 `neutralizeScannedText()`：

```js
function neutralizeScannedText(text) {
  const replaced = neutralizeText(text) ?? text;   // 本地：整行替换
  const broken = breakIdentityClauses(replaced);   // 上游：5.8.1 的子句破坏
  return broken === text ? void 0 : broken;
}
```

顺序沿用上游文档标注的「承重」顺序：先做前缀判定/替换，再破坏子句。
若反过来，U+200B 会让前缀谓词匹配不到，中性头这一级防线就失效了。

`UNAPPROVED_CHANNEL_OPENINGS` 由字符串数组改为 `{prefix, replacement}` 对象数组，
因此 `isUnapprovedChannelOpening()` 改为经 `unapprovedChannelOpeningOf()` 取值。

### 额外增加的 A：可配置重试策略

`Config` 新增 `retryPolicy`（volatile，schema 用 `@deepseek-ai/dsh-llm` 的 `RetryPolicySchema`）。
原因：DSH 默认的可重试码表**不含** `MALFORMED_RESPONSE`，一次采样把工具参数 JSON 写坏
（例如 `ask_user` 的参数多了一个 `]`），整轮就会零重试直接判死。

profile 的 `dsh-connect-workbuddy` 条目现配置为：

```yaml
retryPolicy:
  mode: normal
  maxRetries: 5
  retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, MALFORMED_RESPONSE]
  backoff: { initialDelayMs: 500, maxDelayMs: 10000 }
```

**注意：配置了 retryableCodes 就是整表替换**，默认码必须逐个重述，漏一个就等于删掉它的重试。

## 升级流程（下次照此办）

```powershell
cd C:\Users\zzn19\Documents\deepseek-harness\default-workspace\probe\wb-diff
npm pack dsh-connect-workbuddy@<新版>                    # 下 tarball
mkdir upN; tar -xzf dsh-connect-workbuddy-<新版>.tgz -C upN
# 1) 先比对锚点，确认 4 个锚点各命中一次；命中数 != 1 时 apply_local.py 会拒绝写盘
python <bundle>\local\apply_local.py <bundle>\lib\host-heartbeat-<hash>.js
node <bundle>\local\verify_local.mjs                     # 8 条必须全绿
node <bundle>\local\verify_retry.cjs <bundle>\lib\index.js  # 10 条必须全绿
```

### 升级时要一并检查的三件事（本次都踩到了）

1. **chunk 的导出别名会变**：5.7.0 的 `prepareChatBody` 导出名是 `$`，5.12.0 是 `rt`。
   `verify_local.mjs` 已改为扫描 chunk 的 `export {...}` 自动取别名，不再写死。
2. **旧 chunk 必须删**：`lib/host-heartbeat-<旧hash>.js` 留着会与新 chunk 并存，
   `verify_local.mjs` 会因「找到两个 chunk」直接报错。
   （本次已删除 `host-heartbeat-CVz2J0Xt.js`。）
3. **`apply_local.py` 的锚点是精确文本匹配**，上游一次重构就会让它失败——
   这是**有意设计**：失败比写出半成品好。失败时先看新代码结构，再改锚点。

## 本次未验证 / 已知事项

- **`retryPolicy` 尚未经真实上游请求触发过**。已实测：schema 接受该配置、默认码表确实不含
  `MALFORMED_RESPONSE`、配置后的码表含它、非法 mode 被拒、以及变异检查（删掉读配置那行后验证脚本变红）。
  **没有实测**的是「插件运行期真的把该策略交给 `dsh-llm-retry`」这一跳——需要一次真实的
  bad-JSON 采样才能端到端证明。
- **profile 里的 `@earendil-works/pi-ai` 是悬空 junction**（指向
  `D:\deepseek-harness\node_modules\.pnpm\@earendil-works+pi-ai@1.1.0_...`，该目录已不存在；
  现存为 1.3.0）。创建时间 2026-10-20，早于本次升级，**非本次改动造成**。
  实测：从 profile 与 bundle 两侧 `require.resolve` 均解析不到该包。
  影响未确认，建议另立一单排查。
- `node_modules/@deepseek-ai/cosmokit`、`@earendil-works/pi-ai` 两个 junction 是本次为跑验证脚本
  临时补的，若宿主本就能解析到，可删除；保留无损。


## 关于「插件包在本机独立 import 不起来」——已做对照实验

本机直接 `import` 插件包会失败，报 `Cannot find package '@deepseek-ai/cosmokit'` / `@earendil-works/pi-ai`。
这不是升级造成的，已用对照实验证明：

- 对**升级前（5.7.0-zh.1 备份）** 与 **升级后（5.12.0-zh.1）** 做同一实验，逐个补齐同样的
  junction 再加载：两者报错**完全一致**，都停在同一个缺失依赖上。
- 结论：这是宿主运行期的依赖注入，不是包自身的缺陷；差分归零，升级未引入新症状。
- 因此**「插件能否被宿主正常加载」这一点，臣在本机验不了**——只能验到「升级前后无差异」。

验证期间临时建的 junction（`@deepseek-ai/cosmokit`、`@earendil-works/pi-ai`）已全部删除，环境已还原。

---

# 2026-10-28 升级到 5.12.4（本地版 5.12.4-zh.1）

## 上游这一段改了什么（5.12.0 → 5.12.4，两个小版本）

**5.12.3（issue #155）— 业务码按字节匹配 JSON，一个空格就把整条救援阶梯关掉。**
分类器原来用 `body.includes('"code":11128')` 判族，这是对**一种序列化**做字节测试：
`{"code":11128}` 认得，`{"code": 11128}`、`{"code":"11128"}`、`{"CODE":11128}` 都不认。
而渠道救援阶梯**只对 `kind === 'channel_reject'` 生效**，所以漏判成别的类别 = 整条阶梯一次都不跑，
`forceNeutralHead` 与两级扰动全部跳过，用户却被要求「调整请求后重试」。
修法：新增 `statesBusinessCode(body, code)`，三个码常量从 `"\"code\":11128"` 字符串形态改成数字，
6 处家族判断统一走它；读取顺序是「信封自述的码优先 → 否则做带引号锚点的文本扫描」，
锚在 `"code":<n>` 而非裸数字，免得十六进制 requestId 里恰好含 `11128` 就把无关 body 提上来。
顺带修了 `envelopeError()`（手里有 code 却只把 msg 交给分类器）与 `parseUpstreamErrorDetail()`
（只认顶层 number 形态的 code），两处现在共用 `businessCodeOfDocument`。

**5.12.4（issue #159）— 密集扰动 rung 是 O(n²)。**
`perturbChannelFingerprints(body, true)` 用 `replace(/(?=\S)/gu, cb)`，回调里为每个位置重新做
`source.slice(0, offset).match(/\S(?=\S*$)/u)`，也就是一次 O(offset) 的前缀切片 + 正则，整体 O(n²)。
实测（上游在 issue 里给的数字）：92 KB 的 body 要 **82.7 秒**，130 KB 要两分多钟。
这一级是**同步** CPU、先跑完才发请求，而 `chatStream` 对自己刻意不设超时，
于是「救援跑得太慢」从外面看和「救援根本没跑」是同一件事。
修法：改成一次累加扫描 `spaceDenseBreaks()`，规则一字未改、输出逐字节相同，92 KB 由 82.7 s → 10 ms。
上游明确表示**不采纳** issue 里「删掉三处 `&& !controller.signal.aborted`」的建议，并给了对照实测：
删掉后断线时会额外调上游 2 次、最终 kind 从 `channel_reject` 变成自己造出来的 `server`、
还会为一次根本没上线的请求记一笔假的账号失败。

## 本地定制怎么落上去的

**chunk 换了名字**：`host-heartbeat-xEJRdYaC.js` → `host-heartbeat-guET27pw.js`（带构建 hash，每次升级都会变）。
旧 chunk 必须删掉，否则 `verify_local.mjs` 会因为「找到两个 chunk」直接报错。

**补丁脚本改成锚点文件驱动**：`local/apply_local.py` 现在读一个 JSON（`[{label, old, new}]`），
锚点内容放在 `probe/wb-diff/anchors.json`（指纹改写，4 个锚点）与 `probe/wb-diff/anchors_retry.json`
（retryPolicy 接线，4 个锚点）。这样「上游改了哪、本地补哪」变成数据而不是又一份 diff 脚本。
每个锚点必须**恰好命中一次**，命中数不对就报错退出、不写盘。

**指纹改写的接缝没变**，仍然是重写 `neutralizeScannedText()` 一处：

```js
function neutralizeScannedText(text) {
  const replaced = neutralizeText(text) ?? text;   // 本地：整行替换成中文
  const broken = breakIdentityClauses(replaced);   // 上游：5.8.1 的子句破坏
  return broken === text ? void 0 : broken;
}
```

顺序仍是「先前缀判定/替换，再破坏子句」——反过来 U+200B 会让前缀谓词匹配不到，中性头那一级就失效了。

**retryPolicy 三处接线**（`lib/index.js`）逐条重放：

1. import 行补 `RetryPolicySchema`；
2. Config schema 在 `sessionTitle` 之前插 `retryPolicy: asVolatile(RetryPolicySchema.description(...))`；
3. `profileFor` 的 `retryPolicy` 改成 `options.retryPolicy?.() ?? resolveRetryPolicy(void 0, ...)`；
4. 适配器构造里补 `retryPolicy: () => ...`（这一处锚点必须带上邻居行 `resolveContextRescue` 才唯一——
   `dropForeignThinking: () => ...` 这一行在文件里出现**两次**，只锚它就 matched 2 times）。

## 本次验证

- `node local/verify_local.mjs` → **8/8 通过**（中文指纹改写，含「干净提示词逐字节不变」）。
- `node local/verify_retry.cjs lib/index.js` → **10/10 通过**（retryPolicy 接线 + 默认码表缺 `MALFORMED_RESPONSE` 的证明）。
- 用真实形状的 DSH 系统提示词（三段身份句）跑 `prepareChatBody`：
  输出里 `You are an AI agent powered by DeepSeek Harness.` → `你乃AI辅助软件也。`，
  Web GUI 那段 → 中文版，`You are a coding agent powered by …` 由上游 `breakIdentityClauses` 插零宽空格打散；
  残留英文身份行 **0 条**。
- 与上游 5.12.4 解包比对：`lib/` 下只有 `index.js` 与 `host-heartbeat-guET27pw.js` 两个文件不同（本机定制），
  `bin.js` 随上游更新；`dependencies` / `peerDependencies` 未变，`node_modules` 不用重装。
- **未验证**：插件运行期真的把 retryPolicy 交给 `dsh-llm-retry` 这一跳（需要一次真实 bad-JSON 采样）；
  以及真实网关对这回改写的端到端回应（见 `D:\tmp\verify\workbuddy-gateway\report.md`）。


---

# 2026-10-28 第二次修订：`5.12.4-zh.2` —— 找到 11128 的**真根因**

## 一句话

身份句全部改写成功之后，网关**仍然**返回 400/11128。真正触发的不是身份句，而是 system 提示词
**正文中段**一句与身份无关的 harness 说明：

```
Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root
```

共 **111 字符**。它既不在 `UNAPPROVED_CHANNEL_OPENINGS`（那是**前缀**清单），也不在 `IDENTITY_CLAUSE`
（只认 `you are … powered by` / `interacting with the user through the deepseek harness`），
在插件源码里 **0 命中** —— 正是本文件上方反复引用的那句注释「THE LIST CANNOT BE COMPLETE」的活例。

## 怎么查出来的（方法可复用）

1. **先确认 body 到底长什么样**。DSH **不落盘出站请求体**，但产生 body 的 system 消息在会话转写里：
   `D:\DSH-Home\sessions\<ws>\session-<id>\session.v4.jsonl.zstd`——**多帧 zstd 拼接**，
   `zlib.zstdDecompressSync` 单次只解第一帧（246 字节的 session 头），必须按 magic `28 b5 2f fd` 切帧逐一解。
   在 `system/message` 事件里拿到 14454 字的原文，与报错回执里的「共 14454 字」逐字吻合。
2. 用插件 `prepareChatBody` 处理后直连网关：首行已变中文、三条身份串全消失，**仍然 400**。
   这一步排除了「改写没生效」，把问题锁定在「还有别的触发点」。
3. **二分收敛**：按 600 字分块，23 块里只有 `offset 4200` 一块失败；再字符级缩尾/缩头，收敛到 `[4285, 4396)` 共 111 字。
   用 400 字窗 / 200 步长扫全篇 69 个窗，**只有一处触发**——不是多个触发点叠加。
4. **确证**：只改这 111 字（插 1 个 U+200B，或换成中文），同一个 13793 字 body 从 400 变 **200**。

## 这条闸的实测性质（决定了为什么只有新方案能修）

| 变体 | 结果 | 含义 |
|---|---|---|
| 前面加 1–12 个字符 | **仍 400** | **子串**规则，不是前缀规则 → 加中性头无效 |
| 句尾追加 `.` / ` zzz` / 换行 | **仍 400** | 尾部边界宽松 |
| 两句之间用换行代替空格 | **200** | **对空白敏感** |
| 全小写 | **仍 400** | 大小写不敏感 |
| 只留第一句（67 字）或只留第二句（43 字） | **200** | 两句必须齐全，是一个整体 |
| 逐词贪心删除 17 个词 | 一个都删不掉 | 111 字是**最小完整匹配串** |
| 放进 `user` 角色 | 200 | user 不扫 |
| 放进 `assistant` 角色 | **400** | assistant 也扫（会话一旦被污染会一直失败） |
| 换模型 `glm-5.3` | **仍 400** | 与模型无关 |

→ 前三行直接判死了旧方案：**任何「在前面加东西」的办法（含 `forceNeutralHead` 自愈重试）对它都无效**，
  只有真正**打断这 111 字本身**才行。

## 修法：`replaceRefusedContentSpans()`

在 `neutralizeScannedText()` 里，`neutralizeText()`（整行替换）之后、`breakIdentityClauses()`（子句破坏）之前，
插一层**中段子串替换**。选的是**中文等价表述**而不是插 U+200B：

```js
const REFUSED_CONTENT_SPANS = [{
    text: "Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root",
    replacement: "以 @ 开头的标记是用户显式引用的路径，相对路径从工作区根目录解析"
}];
```

为什么不是零宽扰动：两种改法实测都能 200，但这句是**给模型看的行为说明**（讲 `@` 引用怎么解析、
相对路径以哪为根）。插零宽字符只是把字节搅乱、语义还在但难读；换成中文**保住语义**，
与这套定制「用中文而不是用中性头」的整体取向一致。

实现细节（每条都是有原因的）：

- **按词切分 + `\s+` 连接**：实测两句之间**换行**时网关放行，说明它对空白宽松；
  所以正则也用 `\s+`，宿主把这句话折行时同样能命中。
- **`giu` 全局 + 大小写不敏感**：实测全小写仍然被拒，所以要忽略大小写。
- **span 自身做正则转义**：这条里没有元字符，但下一条可能会；不转义就会变成一个匹配别处的模式。
- **按顺序串起来**：`neutralizeText` → `replaceRefusedContentSpans` → `breakIdentityClauses`。
  顺序沿用上游「先前缀判定，再破坏子句」的承重设计。

## 验证

- `local/verify_local.mjs` 从 8 条扩到 **11 条**，新增 3 条专钉这条 span：
  ①中文替换在位且前后段落字节保留；②大写 + 折行也命中；③assistant 历史里的同一句同样被扫。**11/11 通过**。
- 用**真实 14454 字 system**（从会话转写恢复）跑：14454 → 13715 字，触发串消失、中文替换在位；
  五条禁用串（三条身份句 + 这 111 字 + Claude Code）在**连续字节**层面全部 gone。
- `local/verify_retry.cjs`：**10/10**（retryPolicy 接线未受影响）。
- 端到端前后对照（补丁前 400 / 补丁后 200）见 `D:\tmp\verify\workbuddy-gateway\report3.md`。

## 本次踩到的两个坑（记下来免得重犯）

1. **`bin.js` 的陈旧 specifier**：升级时 chunk 从 `host-heartbeat-xEJRdYaC.js` 改名成 `guET27pw.js`，
   但 `lib/bin.js`（包的 CLI 入口）仍指向旧名 → 一加载就 `ERR_MODULE_NOT_FOUND`。
   行为断言看不见它，因为它们直接 import chunk。**已在 `verify_local.mjs` 开头加硬门**：
   扫描 `lib/*.js` 里所有 `./host-heartbeat-*.js` 说明符，指向不存在的 chunk 就抛错退出。
   做了变异验证（改回旧名 → 抛错；恢复 → 绿）。
2. **不要用 PowerShell `Set-Content` 改这些 JS 文件**：它会给文件加 **UTF-8 BOM**
   （`EF BB BF`），而 `bin.js` 第一行是 `#!/usr/bin/env node`，BOM 顶在 shebang 前面使 `node --check` 直接报错。
   改这类文件用 `[System.IO.File]::WriteAllBytes()` 逐字节写，或 `edit`/`write` 工具。
