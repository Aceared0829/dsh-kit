# dsh-kit

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-dsh--plugin-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows_%7C_macOS_%7C_Linux-lightgrey)](#别人怎么装)

把一套 DeepSeek Harness 插件装到另一台已经有 Harness 的机器上，并且可以反复更新。

这个库不是 Harness 本身。官方仓库或你自己的 fork 继续管引擎；这里只放插件、版本清单和安装器。

> 想找更多 Harness 插件？在 GitHub 上搜索 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题。

[English](#english)

## 别人怎么装

前提：对方已经装好 DeepSeek Harness，并且 `dsh` 能在终端里运行。安装器不会安装桌面端，也不会克隆 Harness 源码。

Desktop 用户要先在应用里注册「管理 dsh 命令」，然后从托盘**完全退出**。只关窗口不够，Host 还在跑的时候不能改 desktop profile。

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

常用参数：

- `-Profile desktop` 或 `--profile desktop`：装进 Desktop 的 profile。没有 Desktop 自带的 dsh 时会拒绝，避免用普通 CLI 去改它。
- `-Profile web`：装进 Web / 终端 profile。
- `-DryRun`：只打印将要执行的 `dsh plugin` 命令，不改 profile。
- `-SkipPreferences`：不写入设置模板。
- `-Home <dir>`：指定 Harness home。未传时用环境变量 `DSH_HOME`，再没有就用 `~/.dsh`。

装完重新打开 Harness。

### 安装器会改动 profile 的 pnpm 设置

第一次安装会往 profile 的 `pnpm-workspace.yaml` 补几个必要项，否则 pnpm 会拒绝安装整个依赖树（`ERR_PNPM_IGNORED_BUILDS`）：

- `allowBuilds`：放行 `ssh2`、`cpu-features`（来自 `dsh-ssh`）和 DSH 运行时的原生包（`node-pty`、`koffi`、`protobufjs`、`@deepseek-ai/dsh-subprocess-local`、`@google/genai`）的构建脚本
- `nodeLinker: hoisted` 与 `autoInstallPeers: false`：与 DSH 自身的 profile 布局一致

只补缺失项。已经在用的 profile 保持原样，改动前备份为 `pnpm-workspace.yaml.bak-dsh-kit`。


## 以后怎么更新

你改这个库并推送。别人：

```powershell
git pull
.\install.ps1
```

同一条命令，第一次是安装，以后是按清单对齐版本。本库里的插件是 `link:` 到克隆下来的目录，所以 `git pull` 之后重启 Harness 就会用到新源码。第三方插件只有 `manifest.json` 里的版本变了才会重装。

作者发布更新时：改 `plugins/` 或 `manifest.json`，先跑检查，再提交推送。

```powershell
pwsh -File scripts/check-public.ps1
git add -A
git commit -m "更新插件清单"
git push
```

检查会拒绝用户主目录、引擎源码目录这类本机路径，以及写死的浏览器路径。账号和令牌不要进这个库。

## 库里有什么

| 内容 | 处理 |
|---|---|
| `plugins/dsh-connect-grok` | 自有源码，安装时链接进 profile |
| `plugins/desktop-extras` | 自有源码。启用 worktree、有头浏览器、桌面控制。不写本机 Chrome 路径 |
| `plugins/dsh-pet-bridge` | 桌宠桥接，MIT，来自 [dsh-pet](https://github.com/MerZlin/dsh-pet-indesktop) |
| `plugins/dsh-pet-lifecycle` | 随 Harness 起停桌宠。公开版不写死目录，没配置就跳过 |
| `manifest.json` | 第三方插件的包名和当时装上的版本 |
| `settings/preferences.patch.yml` | 语言、详细对话、默认 Grok 模型、插件市场。不含账号 |

第三方插件从 npm 安装，不把别人的源码再拷一份。随 Harness 自带、默认关闭的实验包，只有当前安装里真的有，才会写进 profile 的 bundle 列表。

## 不会放进来的东西

- 整个 profile、`node_modules`、锁文件
- WorkBuddy 账号、令牌、登录态
- 本机绝对路径
- Harness 源码。`dsh-harness-eval` 和 fork 里的 `@deepseek-ai/dsh-subagent-claude-code` 留在引擎仓库，不在这里

WorkBuddy 装上之后要自己登录。形状示例在 `settings/workbuddy.example.yml`，填好的文件不要提交。

桌宠本体不在这个库。需要的话另装 [dsh-pet](https://github.com/MerZlin/dsh-pet-indesktop)，再按 `settings/pet.example.yml` 写 `petDir`。

## 设置模板

只在 profile 的 `cordis.patch.yml` 还是空模板时写入。已经有自己的设置就不会覆盖。

模板把默认模型设为 `grok-4.7`。Grok 插件要在设置页登录之后才能用。不想套用模板就加 `-SkipPreferences`。

## 兼容

清单按作者当时的自建 Desktop 锁定。官方安装包如果缺某个实验包，安装器会跳过那一项，不会为了装上而改你的 Harness。版本不兼容时，dsh 会拒绝安装；安装器不会自动做版本豁免。

Desktop 和官方包的 appId 相同。已经在用自建包的机器，不要再装官方安装包，否则会盖掉自建安装。

## English

This repo installs a pinned DeepSeek Harness plugin set onto a machine that already has Harness. It does not install the app.

```sh
git clone https://github.com/Aceared0829/dsh-kit.git
cd dsh-kit
./install.sh --profile web
```

Quit Desktop completely before installing into the `desktop` profile, and use the Desktop-bundled `dsh`. Re-run the installer after `git pull` to update. Accounts, tokens, and machine paths are not in this repo.
