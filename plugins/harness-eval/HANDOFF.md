# dsh-harness-eval 交接包

> 生成时间：2026-10-19
> 仓库：你的 DSH 检出（DSH 0.2.1-rc.2）
> 插件：本库的 `plugins/harness-eval`
> 运行实例：Desktop（Electron），profile = `desktop`

---

## 一、这个插件是什么

会话内的 `Harness` 标签页（在「看板」右侧），回答三个问题：

1. **这次运行在第几轮开始不再收敛？**
2. **如果只重跑断点之后的部分，要花多少代价？**（决定「分叉 + 尾部重跑」是否划算）
3. **这一轮成在哪里、败在哪里？**（人工标记）

数据来源是**已有的会话事件**，不新增任何 session event，不改 `SESSION_FORMAT_VERSION`，模型完全看不到。

**背景**：这个插件是为了验证两篇论文（Harness² / Dream-RSI）的核心假设而做的前置探针——
先采集真实数据，再决定要不要投入做完整的 RSI harness 方案。

---

## 二、当前状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M0** | 插件能装、tab 出现在「看板」右侧 | ✅ 完成 |
| **M1** | 投影折叠会话事件，产出逐轮证据 | ✅ 完成 |
| **M2** | 失败点时间线 + 分叉代价卡 | ✅ 完成 |
| **M3a** | 标记的存储域 + 读取路径 + 渲染 | ✅ 完成 |
| **M3b** | Remote 写入 + 标记按钮 | ✅ 完成（真实 UI 创建、刷新保留、删除验证） |
| **M4** | 导出 JSONL（三天后评估用） | ✅ 完成 |

**测试**：81 项，全绿（`npm test`）。

M3b 已在真实 Desktop 实例中验证：`harnessMarks` 服务注册成功，Harness
标签页可加载，标记可创建并在刷新后保留，也可通过真实 UI 删除。

运行时曾出现会话历史不可用：

```
failed to project session "...": cannot get property "harnessMarks" without inject
```

根因是 `wire.view` 直接读取 `ctx.harnessMarks`，而 `harnessMarks` 是插件自己
挂载的子服务、不在 `inject` 中；Cordis 的严格访问器在 `?.` 之前就抛错。
修复后统一用 `ctx.get('harnessMarks')`，并把整个读取包在 `readMarks()` 的
异常隔离里。client 异步 `$mount` 后的 `ctx.remote.harnessMarks` 也改为
`ctx.get('remote.harnessMarks')`。

真实导出结果（2026-10-19 13:52）：5 个有轮次的会话、32 轮、891 steps、
981 次工具调用、45 次工具错误、0 条人工标记。`harness_marks.json` 当前
为空只表示还没有留下有效人工观察，不是读取失败。

---

## 三、文件位置与职责

```
plugins/harness-eval/
├── package.json              # bundle 声明 + dsh.client + scripts
├── cordis.patch.yml          # bundle 装载层（insert 一行）
├── tsconfig.service.json     # 只编译 marks-service.ts 的独立编译面
├── README.md                 # 包说明（含两条铁律）
│
├── src\                      # 源码
│   ├── index.js              # 宿主入口：投影单元 + 挂载服务（免构建，手抄到 lib）
│   ├── marks-service.ts      # harnessMarks 服务（@Remote），需编译
│   ├── marks.js              # harness_marks 存储域 + zod schema（复制到 lib）
│   └── remote-spec.js        # Remote 描述符 spec（免构建，手抄到 lib）
│
├── lib\                      # 运行时实际加载的产物
│   ├── index.js              # = src/index.js
│   ├── marks.js              # = src/marks.js
│   ├── marks-service.js      # ← tsc 编译产物，不要手改
│   ├── typert.remote-client.js # = src/remote-spec.js
│   └── client.js             # 浏览器半边（手写，无需构建）
│
├── node_modules\             # ⚠️ 本地测试用的链接，不要提交
│   └── @deepseek-ai\         # dsh-typert-protocol / dsh-storage-domain / dsh-storage / cordis
│
└── 测试
    ├── test.mjs              # 折叠逻辑 + 投影不变量
    ├── marks.test.mjs        # 标记 schema
    ├── client.test.mjs       # bundle 形状 / slot / 字典 / 渲染
    ├── remote-spec.test.mjs  # spec ↔ @Remote 漂移护栏
    ├── deploy.test.mjs       # src↔lib 一致性 + files 清单
    ├── export.test.mjs       # 导出的过滤、视图转换、标记合并
    ├── verify.mjs            # 运行时探针（读投影缓存）
    └── export.mjs            # 投影缓存 + 标记 → JSONL
```

### 三种产物的构建方式

| 文件 | 方式 | 命令 |
|---|---|---|
| `lib/marks-service.js` | **编译** | `npm run build` |
| `lib/index.js` | **复制** | `cp src/index.js lib/index.js` |
| `lib/marks.js` | **复制** | `cp src/marks.js lib/marks.js` |
| `lib/typert.remote-client.js` | **复制** | `cp src/remote-spec.js lib/typert.remote-client.js` |
| `lib/client.js` | **手写** | 直接编辑 |

---

## 四、必须遵守的规范（踩过的坑）

### 铁律 1：投影的 state 和 wire view 必须是 lossless JSON

`undefined` 不是 JSON，会在两个地方炸：

| 位置 | 后果（真实发生过） |
|---|---|
| 投影缓存持久化 **state** | 校验失败，**整行写不进去**，界面永远空 |
| gateway 转发 **wire view** | 拒绝 `api-session/added` → **整个新建会话回滚**：侧边栏有条目，输入框却显示 `placeholder.unavailable`，无法新建会话 |

**规则**：可选值缺失一律**省略键**，绝不写 `key: undefined`。
内部状态用 `null` 表示「尚未结束」，view 层再省略。

`test.mjs` 用递归 `undefined` 扫描 + JSON round-trip 强制这一点。

### 铁律 2：`wire.view` 里绝不能抛异常

`wire.view` 由投影注册表对**每个会话**调用。抛一次 = 整个会话投影失败 = **历史加载不出来**。

真实事故：
```
failed to project session "...": cannot get property "harnessMarks" without inject
```

根因：`ctx.<service>` 是**严格访问器**，插件未在 `inject` 里声明该服务时直接读就会抛。

**规则**：
- 读可选服务用 `ctx.get('name')`，不要用 `ctx.name`
- 任何外部读取都包在 `readMarks()` 的 try/catch 里，失败即视为「没有标记」

已有回归测试锁定该行为。

### 铁律 3：从 `src/` 部署，不要直接改 `lib/`

`lib/index.js` 才是运行时装的东西。只改 `src/` 会留着旧代码跑；只改 `lib/` 下次复制就丢了。

`deploy.test.mjs` 用 SHA 对比强制 `src` ↔ `lib` 逐字节一致。

### 铁律 4：改 wire view 结构必须升 `stateVersion`

`stateVersion` 是缓存失效信号。不升 = 旧行被当成当前值**静默使用**（不报错，只显示陈旧数据）。

`test.mjs` 里有契约锁测试。

### 铁律 5：插件不在 workspace 内，不要试图跑 generator

`@deepseek-ai/dsh-typert-generator` 要求根目录同时有 `tsconfig.host.json` 和 `packages/`。
插件在 `plugins/` 下，**永远找不到根**。

Remote 产物因此**手写**，并通过 `remote-spec.test.mjs` 与 `@Remote` 元数据比对防漂移。

---

## 五、关键技术事实

### 投影机制（M1/M2 的基础）

- 服务：`ctx.sessionProjections.register(definition)`
- 单元契约：`{ key, stateVersion, stateSchema, init, apply, wire: { viewSchema, view } }`
- `apply(state, event)` 必须**同步**，无变化时**返回同一个引用**（`Object.is` 门控）
- `wire.view` 接收 state，**拿不到 header** → sessionId/指纹必须由 `init(header)` 存进 state
- 客户端读取：`props.useProjection('harnessEvidence')`（**标准 seat**，不要自定义 hooks）

### Remote 机制（M3b 的基础）

- 宿主发现**不读** `remote-spec`：`api-gateway` 反射 `typertRemote` 绑定 + `@Remote` 元数据
- `@Remote` 元数据在**实例构造时**由 `addInitializer` 写入 prototype，**不在类上**
- 客户端挂载：`ctx.remote.$mount({ package, descriptors })`
- 模块表只剥 `/client` 后缀，`/remote` 子路径**解析不了** → spec 必须内联进 client bundle

### 存储

- `ctx.storageDomain.open(marksDomain)` → `domain.table('marks')`，同步读、写完才 resolve
- 域名必须匹配 `^[a-z][a-z0-9_]*$` → `harness_marks`（**有数据后不可改**）

### 部署

- profile：`desktop`（Electron 独占管理）
- 安装：走 Web 的 Plugins 页面 / `plugin_manager` 工具
- **HMR 忽略 `node_modules`** → 改了宿主代码必须**重启进程**

---

## 六、接下来要开发什么

### 第 1 步：M4 —— 导出 JSONL

这是**整个项目的最终目的**：三天后把数据交给评估。脚本版已完成并通过
真实数据导出；下面的结构保留为交付格式说明。

导出内容（每行一个会话）：

```jsonl
{"session":"…","turns":19,"steps":232,"toolCalls":245,"toolErrors":18,
 "firstIncompleteTurn":7,
 "bifurcate":{"turn":7,"tailSteps":82,"tailShare":35},
 "idleTurns":1,
 "harness":{"cwd":"…","agentPreset":"cordis","parentSession":"…"},
 "marks":[{"turn":7,"kind":"failure","reason":"反复读同一个文件"}]}
```

导出方式二选一：
- 在 tab 里加一个「导出」按钮，走新 Remote 方法 `export`（复用 M3b 通道）
- 或写成独立 `node` 脚本直接读投影缓存 + storage（更简单，不需要构建）

已采用脚本版：

```powershell
cd <本库路径>\plugins\harness-eval
npm run export -- --out .\harness-evidence-export.jsonl
```

脚本默认 `DSH_HOME` 为你的运行实例 home（缺省 `~/.dsh`，可用环境变量覆盖），并：

- 只接受 `identity.formatVersion === 4` 且 `harnessEvidence.ver === 4`；
- 用 `stateSchema.parse` 校验缓存状态，再调用 `wire.view` 生成导出字段；
- 从 `storages/harness_marks.json` 合并标记；
- 按 `sessions/<workspace>/<sessionId>/` 过滤已删除会话的孤儿缓存；
- 默认跳过零轮会话，`--include-empty` 可包含；
- 没有可导出记录时非零退出，避免评估拿到静默空文件。

### 第 2 步：评估（不是开发）

拿到导出数据后回答：

1. **失败点轮次分布** —— 集中在靠后 → 分叉方案经济上成立；集中在前 3 轮 → 方案不划算
2. **重试指纹是否相同** —— 相同 = 「重试没有长进」是真的
3. **空转比例** —— 衡量成本失控
4. **标记的失败里有多少无法构造确定性判据** —— 直接决定 RSI 上限
5. **同类失败重复次数** —— 「经验不累积」的硬证据

---

## 七、常用命令

```powershell
cd <本库路径>\plugins\harness-eval

npm test                          # 81 项测试
npm run build                     # 编译 marks-service.ts
npm run verify                    # 探针：投影缓存里有 harnessEvidence 吗
npm run export -- --out .\harness-evidence-export.jsonl

# 手动同步（改了 src 之后）
Copy-Item src\index.js lib\index.js -Force
Copy-Item src\marks.js lib\marks.js -Force
Copy-Item src\remote-spec.js lib\typert.remote-client.js -Force
```

---

## 八、已知限制

| 限制 | 说明 |
|---|---|
| `node_modules` 是本地测试用的 junction | 不要提交；运行时由 profile 解析 |
| 旧 `ver=2/3` 缓存行不会消失 | 版本不匹配即丢弃，不影响正确性 |
| `harness` 指纹目前为空对象 | `marks-service.ts` 的 `create()` 还没从 session header 取指纹，需要补 |
| 标记不能编辑，只能删除 | M3 范围内可接受 |
| 客户端 spec 与宿主服务是两份声明 | 靠 `remote-spec.test.mjs` 保一致 |

---

## 九、设计决策记录（为什么这么做）

| 决策 | 理由 |
|---|---|
| 用投影而非 session event | 不碰 `SESSION_FORMAT_VERSION`，模型不可见，卸载无残留 |
| 用 storage 域而非 dsh-graph 卡片 | card 是目标看板语义，塞会话标注会污染它 |
| Remote 产物手写而非跑 generator | 插件在 workspace 外，generator 找不到根；手写 + 漂移测试等价 |
| `bifurcate.turn` 用 `null` 而非缺省 | 区分「没有断点」和「宿主没发布这个字段」 |
| `tailShare` 为 `null` 当 0 步 | 0/0 无意义，不报误导性的 0% |
| 标记带 `harness` 指纹快照 | 会话被清理后，标记仍能回答「同类失败是否在同 harness 下重复」 |
