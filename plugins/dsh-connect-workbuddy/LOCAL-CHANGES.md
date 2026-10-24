# 本机定制（升级时必读）

这个目录是 `dsh-connect-workbuddy` 的**本地定制版**，通过 `link:` 挂进 profile：

```
dsh-connect-workbuddy: link:<本库路径>/plugins/dsh-connect-workbuddy
```

上游升级时**不要**用 `plugin_manager install_bundle` 直接覆盖（那会把 source 从 `link:` 换成 registry 版本，
本文件描述的定制会丢失）。正确做法见文末「升级流程」。

## 定制内容（相对上游的差异，仅两个文件）

相对上游 npm 包，本目录只有两处不同：

1. `package.json` — `version` 加 `-zh.N` 后缀（当前 `5.7.0-zh.1`）。
2. `lib/host-heartbeat-<hash>.js` — **系统提示词捕获/替换逻辑换成本机版本**。

上游 5.7.0 的做法是「在命中指纹的消息**前面追加**一条英文中性头 `You are a helpful assistant.`」。
本机改成本机做法：

- `WORKBUDDY_FALLBACK_SYSTEM_PROMPT = "你乃AI辅助软件也。"`（占位中性头换成中文短句）
- 新增 `WEB_GUI_PROMPT_ZH`：把 DeepSeek Harness Web GUI 那段英文换成等价中文
- `UNAPPROVED_CHANNEL_OPENINGS` 从「字符串前缀数组」改成 `{ prefix, replacement }` 数组
- `isUnapprovedChannelOpening()` 拆成 `unapprovedChannelOpeningOf()`（返回命中项）+ 布尔包装
- `neutralizeChannelFingerprints()` 改为**逐行原地替换**（`neutralizeText()`），而不是只在开头追加；
  原因是实测 glm-5.3-flash 对这段英文即使在正文中段也会被网关拒

上游 5.7.0 新增的机制**全部保留**，未做改动：

- `scansOpening()`（system + assistant 两个角色都扫）
- 数组 content 的逐 text part 处理
- `forceNeutralHead()` 一次性自愈重试
- `perturbChannelFingerprints()` 零宽空格扰动（稀疏 / 密集两档）
- `openingEvidenceOfBody()` 失败证据回显
- 新增 `channelPerturbation` 配置项（`off` / `failure` / `always`）

## 升级流程

```powershell
cd $env:TEMP\wb-diff   # 任意空目录
npm pack dsh-connect-workbuddy@<新版本>            # 下载 tarball
mkdir aN; tar -xzf dsh-connect-workbuddy-<新版本>.tgz -C aN   # 解包到 aN\package
# 先看上游改了什么，再决定补丁锚点是否还成立：
python %TEMP%\dl.py aN\package\lib\host-heartbeat-*.js <bundle>\lib\host-heartbeat-*.js
robocopy .\aN\package <bundle> /E /XD node_modules   # 覆盖（保留本目录 node_modules）
rm <bundle>\lib\host-heartbeat-<旧 hash>.js          # 删掉上一个版本的 chunk
python <bundle>\local\apply_local.py <bundle>\lib\host-heartbeat-<新 hash>.js
node <bundle>\local\verify_local.mjs                 # 8 条行为断言必须全绿
# 再手改 package.json 的 version 后缀，重启 DSH 桌面端生效
```

`local/apply_local.py` 是**锚点式**补丁：每个锚点在目标文件里必须**恰好命中一次**，否则直接报错退出，
不会写出半成品文件。上游把这几段代码重构掉时它会失败——那正是需要人工看一眼的时候，
不要改成模糊匹配。

`local/verify_local.mjs` 自己发现 `lib/host-heartbeat-*.js`（**不写死 hash**，升级换了 chunk 名也能跑），
直接 import `prepareChatBody`（导出名是 `$`），跑 8 条断言：
1. Web GUI 英文段落整行被换成中文
2. `you are an ai agent powered by deepseek harness` 开头被换成中文占位
3. `Claude Code` 开头被换掉
4. assistant 历史消息同样被扫
5. 数组 content 的每个 text part 都被处理
6. 干净提示词**逐字节不变**
7. 缺 system 消息时补中文占位头
8. `developer` 角色先改 `system` 再中性化

**注意**：`node <file>` 直接跑会报 `ERR_MODULE_NOT_FOUND: @deepseek-ai/cosmokit`——因为
`node_modules/@deepseek-ai/schemastery` 里那份依赖不完整。这是本目录的既有状态（4.14.1 时代同样报），
不影响宿主加载，只是命令行冒烟跑 index.js 会失败。`verify_local.mjs` 只 import chunk 文件（纯 node 内置依赖），
所以能跑。

## 升级历史

- `4.14.1-zh.2` → `5.7.0-zh.1`（2026-10-23）：上游从 2 条指纹前缀扩到「双角色扫描 + 数组 part + 三级重试」，
  本机定制按上面的锚点重放到 5.7.0 的 chunk 上。升级前完整备份在
  `probe/wb-diff/backup-4.14.1-zh.2`（31 个文件）。

  升级后的核对结果：与上游 5.7.0 解包比对，26 个文件里**只有两个不同**——
  `lib/host-heartbeat-CVz2J0Xt.js`（本机定制）和 `package.json`（version 后缀）；
  没有多出、也没有少掉任何上游文件；`dependencies` / `peerDependencies` 两版逐条相同，
  所以目录里的 `node_modules` 不用重装。

  注意 profile 里的插件配置块（`cordis.patch.yml` 中 `- id: dsh-connect-workbuddy`）只用到
  `accounts` / `regions` 两个键，5.7.0 的配置 schema 仍然认这两个键，配置文件无需迁移。
