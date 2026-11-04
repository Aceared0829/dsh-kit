# dsh-turn-autocontinue

轮级自动续跑插件，作为 DSH 的**兜底网**：当前一轮因模型侧异常中止时，有限次自动续跑；到上限就老实停下并如实说明。

它与「模型请求重试」是两件不同的事：

| | 层级 | 干什么 | 在哪 |
|---|---|---|---|
| 请求级重试（A） | 一次采样 | 同一步内的同一次模型请求重发 | `@deepseek-ai/dsh-llm-retry` 的 `agent/request-error` 白名单 |
| 轮级续跑（本插件） | 一整轮 | 整轮已经结束（`turn/end`）后，重新开一轮接着干 | `agent/error` + `session/event` |

DSH 内核本身没有轮级续跑能力（`autoContinue` / `continueTurn` / `resumeTurn` 在 core 包里搜索为空），所以必须由插件补。

---

## 四条底线（缺一不可）

### 底线 1：只续「当前轮异常中止」

触发条件**同时**满足才续跑：

- `turn/end` 的 `reason.kind === 'error'`（这一轮真的失败了）；
- 失败原因不属于「再开一轮也解决不了」的那一类。

以下一律**不续**：

| 情况 | 判定依据 | 为什么不续 |
|---|---|---|
| 用户取消 | `turn/end` 的 `reason.kind === 'aborted'`（`reason.reason.kind` 为 `user` / `parent` / `disposed` / `hook`） | 用户明确要停，续跑就是抗命，且会死循环 |
| 权限拒绝 / 审批拒绝 | 错误码属于 `DENIED`、`PERMISSION_DENIED`、`APPROVAL_DENIED`、`FORBIDDEN`、`UNAUTHORIZED`、`AUTO_REVIEW_DENIED` | 同样的请求再发一次还是会被拒 |
| AbortError | `error.name === 'AbortError'`，或错误码为 `ABORT` / `ABORTED` / `ABORT_ERR` | 是取消，不是故障 |
| 模型不支持 | `MODEL_DOES_NOT_SUPPORT`、`MODEL_DOES_NOT_SUPPORT_IMAGES`、`UNSUPPORTED_MODEL`、`NO_ADAPTER`、`MODEL_UNAVAILABLE` | 换个轮次也还是同一个模型 |
| 凭据有问题 | `MISSING_CREDENTIAL`、`INVALID_CREDENTIAL` | 每次尝试都会一模一样地失败 |
| 上下文/额度爆了 | `CONTEXT_WINDOW_EXCEEDED`、`QUOTA`、`ACCOUNT_QUOTA` | 再开一轮只会更满/更贵 |
| 正常结束 | `completed` / `blocked` / `max-tokens` / `interrupted` / `forked` | 不是异常中止 |

另外还有两条运行时护栏：

- **绝不插队**：续跑发出前会等 agent 变成 `idle` 且 inbox 为空（有上限等待）；等不到就放弃，并在会话里留一条 `skipped` 记录。所以人类新开的一轮永远不会被自动续跑打断。
- **人类一轮就重置**：如果失败链中间插进了一轮不是本插件发起的 turn，计数清零。用户等于是拿到了一个全新的预算。

### 底线 2：硬上限 3 次 + 退避 + 每次留痕

- 上限硬编码为 `HARD_MAX_CONTINUES = 3`（`lib/index.js`）。配置只能调低，**不能调高**：`normalizeConfig({ maxContinues: 99 }).maxContinues === 3`（用例 C3 实测）。
- 退避：默认 2s / 5s / 10s（第 1/2/3 次），最后一档重复。
- 每次留痕，且是**双份**：
  1. 会话日志里的 `ctx.logger.warn`：`turn-autocontinue: delivered continuation 2/3 for session "..." after MALFORMED_RESPONSE`；
  2. 续跑消息本身就是一个带 `source` 的持久 `user/message` 事件，里面写清「第几次 / 共几次 / 真实错因」。它在会话里可见，不是悄悄重来。

### 底线 3：续跑提示必须写明「先查看当前状态，不要盲目重做」

续跑消息的正文（中文版）逐字包含：

> 请继续把原来那件事做完。动手之前先查看当前状态：已经存在哪些文件、当前工作目录是什么、上一条命令是否已经执行过以及它打印了什么。
>
> 不要盲目重做上一条命令 —— 它可能已经跑了一半（写过文件、跑过迁移、启动过后台任务），盲目重放会造成重复写入或损坏。
>
> 如果检查后发现事情其实已经完成，或者已经无法继续，就直接如实说明现状，不要重复执行。

英文版（`language: 'en'`）是同一份意思的对照文本，同样包含 "inspect the current state" 与 "Do not blindly redo"。

必须这么写的原因：上一条命令可能已经半跑完（写过文件、跑过迁移、起来过后台任务）。续跑如果直接重放，会造成重复写入或数据损坏。

### 底线 4：到上限就老实停下，明说次数与最后一次真实错因

第 4 次失败时不再排续跑，而是追加一条持久可见的 `stopped` 记录：

> 【自动续跑已停止】已连续自动续跑 3 次，每次都失败，不再自动重试。
> 最后一次真实错因：MALFORMED_RESPONSE: broken json attempt #4。
> 现在需要人工检查后手动继续；不要假设任务已经完成。

次数是实际用掉的次数，错因取自该轮 `agent/error` 上报的真实失败对象（不是猜的、不是兜底串）。用例 A3 / I2 都对这一点做了断言。

---

## 实现

### 失败钩子

按任务要求使用 `ctx.on('agent/error', ...)`（签名见 `packages/core/agent/src/runtime-types.ts:429`）：

```ts
'agent/error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; error: unknown }): void
```

它只用来**捕获真实失败对象**（保留 `error.failure` 的 `code` / `message`）。真正的触发点是 `session/event` 里的 `turn/end`：只有这一轮真的结束了，才谈得上「续跑一轮」。两者按 `turn` 匹配；`turn/end` 的 `reason.error` 作为回退与交叉校验。

### 续发消息：用的是真实可用的 API，不是臆造别名

第一版任务书写的是 `SessionController.prompt` → `commands.prompt`。读过源码后确认那**不是插件侧该走的路**：

- `packages/api/session-controller/src/index.ts:451` 的 `@Remote('prompt')` 是给前端 RPC 用的门面；`commands.ts:305` 的 `prompt(request, source)` 会 `resolveAgent`、校验附件、然后 `agent.followup(message)`（`commands.ts:339-340`）。它要求 `SessionPromptRequest`（RPC 请求体）、`Attachment` 服务、`fileUploads` 绑定等一整串只在 controller 里成立的上下文。
- 插件侧直接可用的最小真接口是 **`Agent.followup(message)`**（`packages/core/agent/src/runtime-types.ts:251`）：
  > Queue an ordinary follow-up turn and wake the driver. The item becomes the sole ordinary message of its own turn.

  这恰好就是「续跑一整轮」的语义。`ctx.agents.get(sessionId)` 拿 agent（`ctx.agents` 已在 `inject` 里声明）。

因此本插件的调用链是：`ctx.agents.get(id)` → `agent.status` / `agent.inbox.hasPending` 判空 → `agent.followup(createNoticeMessage(...))`。这条链在 `test/integration.mjs` 里对**真实 AgentLoop**跑通了（I1/I2/I6）。

### 留痕方式：surface `user/message`，不是不可见的 plugin record

三条记录（`continue` / `skipped` / `stopped`）都写成 `type: 'user/message'` 的 surface 事件，`source.kind === 'turn-autocontinue'`：

```js
session.append('user/message', { id, role: 'user', content: [{ type: 'text', text }], source }, { surfaceOp: 'append' })
```

为什么不用 `appendPluginRecord`：DSH 自己的插件开发规范（`packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md:25`）明确说 `appendPluginRecord()` 只留给 DSH 的 experimental 包，因为 session 格式迁移对它只是 best-effort 保留。而 `kind` 不能写成 `'plugin'`：`packages/session/session-format-v3-to-v4/src/message-sources.ts:9` 会拒绝。所以用 producer 自有的 `kind: 'turn-autocontinue'`，客户端按未知 producer 兜底渲染（`packages/client/ui-trajectory/src/client/trajectory-event-projection.ts:74` 的 default 分支）。

### 重入安全

`turn/end` 是在 `Session.append` 的 publication 期间派发的，此时再 `append` 会被 Session 拒绝（reentrant publication）。所以 `stopped` 记录是**延后到下一个 tick** 写的（`later(..., 0)`）。单测里的假 Session 会把重入 append 直接判为错误（`verify.mjs` 的 `reentrant Session.append during session/event publication`），所以这条约束每次跑测试都在被检查。

### 生命周期

`ctx.effect(() => dispose)` 里：摘掉两个监听器、清掉所有待触发的退避定时器、丢弃所有 per-session 状态。I5 用例实测：在 5 秒退避还没到的时候卸载插件，之后模型再也不会被调用、也不会有任何写入。

### 配置

在 profile 的 `cordis.patch.yml` 里按 id `turn-autocontinue` 覆盖：

```yaml
- id: turn-autocontinue
  name: '@local/dsh-turn-autocontinue'
  config:
    maxContinues: 3          # 只能 ≤ 3，调高会被夹到 3
    backoffMs: [2000, 5000, 10000]
    language: zh             # zh | en
    neverContinueCodes: []   # 额外拉黑一些错误码（自动大写）
    idleWaitMs: 3000         # 等 agent 空闲的上限
    idlePollMs: 100
```

---

## 安装

这个插件跟 dsh-kit 一起装。安装器会把它 `link:` 到本库的 `plugins/dsh-turn-autocontinue`，装完重启 Harness。

只想单独挂进已有 profile 时：

```
dsh plugin add link:<本库路径>/plugins/dsh-turn-autocontinue
```

这个插件不修改 `dsh-connect-workbuddy`。

---

## 验证

```
cd plugins/dsh-turn-autocontinue
node test/run-all.mjs
```

三套，共 **31** 条断言全部通过（exit 0）：

| 套件 | 环境 | 条数 | 作用 |
|---|---|---|---|
| `test/verify.mjs` | **零 DSH 依赖**：假 ctx / 假 agent / 假 session / 假时钟 | 23 | 四条底线的行为规格，秒级、确定性 |
| `test/integration.mjs` | **真实 AgentLoop**（从检出挂载 LlmRuntime、SessionStore、SessionProjectionRegistry、SystemPrompt、ToolRuntime、AgentRegistry、AgentLoop） | 7 | 真 `agent/error`、真 `turn/end`、真 `followup` 走通 |
| `test/persistence.mjs` | **真实 JSONL 持久化后端** | 1 | 留痕事件真的能落盘并原样读回 |

### 关键实测结论

- **连续 3 次后停止并明说**：`verify.mjs` A3（假事件驱动）与 `integration.mjs` I2（真 AgentLoop，脚本化 adapter 连续 5 次 `MALFORMED_RESPONSE`）都证明了：恰好 3 次续跑、模型总共被调用 4 次、第 4 次失败后写出 1 条 `stopped` 记录、正文含「已连续自动续跑 3 次」与最后一次真实错因 `broken json attempt #4`。
- **用户取消不触发续跑**：`verify.mjs` B1/B2/B3 覆盖 `aborted`（user / hook）与 AbortError；`integration.mjs` I3 用真实 AgentLoop 在流式进行中 `agent.cancel({ kind: 'user' })`，断言 `turn/end.reason.kind === 'aborted'`、零续跑记录、模型只被调用 1 次。
- **退避与留痕**：A4 断言延迟恰为 `[2000, 5000, 10000]`，且 3 次续跑各带自己的 `attempt` 编号与 `ctx.logger.warn` 痕迹。
- **上限不可突破**：C3 断言 `maxContinues: 99` 被夹到 3。
- **不插队**：C5 断言 agent 正忙时续跑被丢弃，且丢弃本身留痕。
- **卸载即停**：C4（假时钟）与 I5（真 AgentLoop + 真 fiber dispose）都断言待触发的续跑被取消。
- **预算不会泄漏**：C8/C9 分开验证了 inbox 生命周期的两条分支——续跑消息被 claim（真正开跑）则计数继续累加到上限；被 discard（还没跑就被取消清空）则整条失败链归零。I7 用真实 AgentLoop 复现了那个竞态：续跑刚入队、用户立刻按 Stop，真循环抛 `agent/inbox/discarded`，插件随之重置。

---

## 未验证 / 局限（如实标注）

以下**没有**做实测，属于推断或受环境限制：

1. **没有在真实 Web GUI 里跑过完整的人工场景**（真人对话 → workbuddy 把 JSON 写坏 → 看到续跑提示与停止提示）。集成用例用的是脚本化 adapter 走真实的 `LlmError` 路径，形状一致，但没有经过真实 workbuddy 上游。真实 GUI 下的**渲染样式**（续跑消息作为「未知 producer 的上下文行」怎么显示）也只是读了客户端源码（`trajectory-event-projection.ts` 的 default 分支）推断的，没截图核对。
2. **GUI 渲染样式没有截图核对**。插件已链进作者的 desktop profile；续跑消息作为未知 producer 的上下文行怎么显示，仍只是读了客户端源码推断的，没截图核对。
3. **`MALFORMED_RESPONSE` 具体会不会走到 `agent/error`** 是按 Lead 已实证的链路（`llm-pi-ai/src/stream.ts:218` → `llm-retry/src/index.ts:212` 放行 → `agent-loop/src/agent.ts:554` 抛 `LlmError` → `agent.ts:411` 的 `throwError` 发 `agent/error`）读源码推出来的；I1 用脚本 adapter 抛出同一个 `LlmError('...', 'MALFORMED_RESPONSE')` 验证了这条路径后面的行为，但没有让 workbuddy 真的吐一次坏 JSON。
4. **`agent/error` 与 `turn/end` 的先后顺序**：源码上 `throwError` 在 `turn()` 的 catch 里先发 `agent/error`，`turn/end` 在 `finally` 里写，所以顺序是确定的；但如果将来内核把顺序改掉，`pending` 会匹配不上，插件会退回用 `turn/end.reason.error`（行为不退化，只丢一点保真度）。这一点没有针对未来版本的兼容测试。
5. **多进程 / 多个 DSH 实例同时驱动同一 session**：没有测。插件状态是进程内的 `Map`，理论上一个 session 只由一个进程驱动，但这没验证。
6. **`ctx.effect` 的确切契约**（传函数还是 `function*`）在 `llm-retry` 与 `goal-round-driver` 里写法不同；本插件用最朴素的「返回 disposer」形式，并在 I5 里用真实 fiber dispose 验证了它确实会被调用。但这是实测出的一个形状，不是文档保证的全集。
7. **`test/integration.mjs` 与 `test/persistence.mjs` 依赖 `node_modules` 里的开发用 junction**（指向 `<你的 DSH 检出>` 的检出）。这些 junction 是本地开发便利，不是本包声明的运行时依赖；在别人的机器上需要重新指，或者只跑 `test/verify.mjs`。

## 与 A 的关系

A（给 workbuddy 路由的重试白名单补 `MALFORMED_RESPONSE`）是**首选**修法：它在同一步内就把问题解决了，用户完全无感。本插件是它失效时的兜底：一次采样失败了，至少整轮不会白跑，模型会带着「先看状态」的提醒接着干，而且最多 3 次就老实交代。

两者互补，不冲突。本插件不修改 `dsh-connect-workbuddy`。
