# 相对本机源码的改动（升级时必读）

这个目录是 `@dsh-pet/lifecycle` 的**可发布副本**。本机实际在跑的那份在
`pet-src/.pet-ctl`（它属于桌宠项目，不在本库），两边只差一处，就是下面这条。

## 唯一的差异：`index.js` 里去掉写死的本机桌宠目录

源码版第 24 行：

```js
/** 默认安装目录（源码运行方式安装的桌宠）。 */
const DEFAULT_PET_DIR = 'C:\\Users\\<本机账号>\\Documents\\deepseek-harness\\default-workspace\\pet-src'
```

本库版：

```js
const DEFAULT_PET_DIR = process.env.DSH_PET_DIR ?? ''

export function apply(ctx, config = {}) {
  const petDir = String(config.petDir || DEFAULT_PET_DIR)
  if (!petDir) {
    console.warn(`[${PLUGIN_ID}] 没有配置 petDir（也没设 DSH_PET_DIR），跳过自动启动`)
    return
  }
```

为什么改：一条写死的 `C:\\Users\\...` 既过不了 `scripts/check-public.ps1`（本机路径
不许进公共仓库），装到别人机器上也必然指错地方。改成"配置项 `petDir` 优先、
没有就 `DSH_PET_DIR`、两者都没有就跳过启动并提示一句"之后，插件不再含任何机器路径，
行为与本机保持一致——本机 profile 的 `cordis.patch.yml` 本来就显式写了 `petDir`。

## 从本机源码重新导入

```powershell
# 在仓库根目录
robocopy <pet-src>\.pet-ctl plugins\dsh-pet-lifecycle /E /XD node_modules | Out-Null
# 然后手工重做上面那处改动（源码的 DEFAULT_PET_DIR 是写死的），再跑
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-public.ps1
node --check plugins\dsh-pet-lifecycle\index.js
```
