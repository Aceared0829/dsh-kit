# dsh-kit

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-dsh--plugin-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows_%7C_macOS_%7C_Linux-lightgrey)](#装到你的机器上)

这是我的 DeepSeek Harness 插件套装，也是我日常在用的一套。

我把它们整理成了一个可以直接安装的仓库：你在自己的 Harness 上跑一条命令，就能装上我配置的这些插件和版本。想改什么，fork 我这个仓库自己维护，或者只装其中几个。

> 找更多 Harness 插件？GitHub 上搜 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题。

[English](#english)

## 这里有什么

**我自己写的这几个**（源码在这个仓库里）：

| 插件 | 做什么 |
|---|---|
| `dsh-connect-grok` | 用你的 xAI 账号登录，把 Grok 模型走 SuperGrok 额度。设置页里登录一次就能用 |
| `desktop-extras` | 一次开三个 Desktop 能力：Git worktree、有头 Playwright 浏览器、桌面控制 |
| `dsh-pet-bridge` | 把 agent 状态事件写到本地 jsonl，给桌宠用。纯本地，不发网络请求 |
| `dsh-pet-lifecycle` | 让桌宠跟着 Harness 一起起停，退出时自动关掉 |

**别人做的这些**（从 npm 装，清单里锁了版本，我没把源码再拷一份）：

`dsh-graph`（目标看板）、`dsh-context`、`@modusensus/dsh-mneme`（长期记忆）、`dsh-diff-approval`、`dsh-planning-with-files`、`dsh-better-sidebar`、`@changfenhuang/dsh-genui`（界面组件）、`@goodandready/*` 三个、`@linxin666/*` 六个、`dsh-connect-workbuddy`。

完整清单和版本在 [`manifest.json`](manifest.json)。

**Harness 自带、默认关着的实验包**，我这套里也开了：agent team、语音输入、自动评审、inspector、worktree 工具、CoT 翻译、终端、会话搜索、会话标题、badge skill、ralph、插件市场。装的时候会自动检查你那边有没有这些包，没有就跳过，不会为了装上而改你的 Harness。

## 装到你的机器上

前提：你已经装好 DeepSeek Harness，`dsh` 能在终端里跑。这个仓库不装 Harness 本身。

**Desktop 用户注意**：先在应用里注册「管理 dsh 命令」，然后从托盘**完全退出**。只关窗口不够——Host 还在后台跑的时候装不了 desktop profile。

```powershell
git clone https://github.com/Aceared0829/dsh-kit.git
cd dsh-kit
.\install.ps1
```

macOS / Linux：

```sh
git clone https://github.com/Aceared0829/dsh-kit.git
cd dsh-kit
chmod +x install.sh
./install.sh --profile web
```

装完重新打开 Harness。

常用参数：

- `-Profile desktop` / `--profile desktop`：装进 Desktop 的 profile。没找到 Desktop 自带的 dsh 会拒绝，免得用普通 CLI 把 desktop profile 改坏
- `-Profile web`：装进 Web / 终端 profile
- `-DryRun`：只打印要跑的命令，不动 profile。想先看看会改什么就用这个
- `-SkipPreferences`：不套用我的设置模板
- `-Home <dir>`：指定 Harness home。默认用 `DSH_HOME`，再没有就是 `~/.dsh`

### 安装器会往你的 profile 里补几个 pnpm 设置

第一次装的时候，安装器会往 profile 的 `pnpm-workspace.yaml` 里补几项，不然装不上：

- `allowBuilds`：放行 `ssh2`、`cpu-features`（`dsh-ssh` 要用）和 Harness 运行时的原生包（`node-pty`、`koffi`、`protobufjs`、`@deepseek-ai/dsh-subprocess-local`、`@google/genai`）。pnpm 11 只要见到没批准的构建脚本就整次中止
- `nodeLinker: hoisted` 和 `autoInstallPeers: false`：跟 Harness 自己的 profile 布局保持一致

只补你没有的。已经在用的 profile 不会被重写，改之前会备份成 `pnpm-workspace.yaml.bak-dsh-kit`。

## 想自己维护

fork 这个仓库，或者直接改你 clone 下来的那份。

**改插件源码**：`plugins/` 下面就是。装的时候是 `link:` 到 clone 的目录，所以改完 `git pull`（别人）或直接重启（你自己）就生效，不用重新打包。

**改装哪些插件**：编辑 `manifest.json`。`npm` 里放包名和版本，`local` 里放 `plugins/` 下的相对路径，`shippedOptional` 里放 Harness 自带的可选包名。

**改我的设置模板**：`settings/preferences.patch.yml`。现在里面是中文界面、详细对话视图、默认 `grok-4.7` + `xhigh` 推理、加了一个插件市场索引。只在你的 `cordis.patch.yml` 还是空模板时才写入，你已经配置过就不动。

发布前跑一下公开检查，它会把本机路径、账号令牌这类不该进仓库的东西拦下来：

```powershell
pwsh -File scripts/check-public.ps1
git add -A
git commit -m "更新插件清单"
git push
```

## 需要注意的

- **`cordis.patch.yml` 不在这里**。那是你自己的运行时配置，需要的话单独拷
- **WorkBuddy 要自己登录**。形状看 `settings/workbuddy.example.yml`，填好的别提交
- **桌宠本体不在这个库**。要装 [dsh-pet](https://github.com/MerZlin/dsh-pet-indesktop)，然后按 `settings/pet.example.yml` 写 `petDir`
- **版本是按我这台机器锁的**。你那边 Harness 如果缺某个实验包，会跳过；版本不兼容时 dsh 会拒绝安装，安装器不会自动做版本豁免——真要装得自己处理
- **Desktop 和官方包 appId 一样**。已经在用自建包的机器，别再装官方安装包，会盖掉自建那份

## 不会放进来的

整个 profile、`node_modules`、锁文件、WorkBuddy 账号、本机绝对路径、Harness 源码，都不在这个库。

我 fork 的 Harness 是 [Aceared0829/deepseek-harness](https://github.com/Aceared0829/deepseek-harness)，引擎相关的改动在那里；这个库只管插件。

## English

This is my DeepSeek Harness plugin set, packaged so you can install it on your own Harness with one command.

It ships nine plugins I wrote or adapted — a Grok subscription connector, desktop extras (worktrees, headed browser, native control), and a desktop-pet bridge plus lifecycle — alongside a pinned list of third-party plugins I use daily, plus the experimental bundles Harness ships disabled but I keep switched on.

`git clone` it, run `./install.ps1` (Windows) or `./install.sh` (macOS/Linux), then reopen Harness. Quit Desktop completely first if you are installing into its profile.

Fork it and keep your own list: `manifest.json` says which packages and versions, `plugins/` holds the sources I wrote, `settings/preferences.patch.yml` is the configuration template mine uses.

Accounts, tokens, and machine paths are deliberately not in this repo. Run `scripts/check-public.ps1` before you push your fork.
