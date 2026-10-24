# 这几天怎么用（最短版）

> 你只需要记住三件事。

---

## 1. 正常用就行，不用刻意

不需要「为了采样去跑 GUI」。你平时怎么用，日志就在记。判定层要的是**会话数量**，不是特定任务。

只有一个前提：**S3 那个改动是 GUI 相关的**，所以 after 侧最好有碰过 GUI 的会话。你要是不碰 GUI，判定会一直是 inconclusive——那也没问题，说明这个改动对你不重要，可以回滚。

---

## 2. 想知道结果时，跑这一条

```powershell
cd <本库路径>\plugins\harness-eval
npm run loop -- --judge chg-1468790f
```

三种输出：

| 看到 | 意思 | 你要做什么 |
|---|---|---|
| `decision: inconclusive` | 样本还不够 | 继续用，它下面会写还缺几个会话 |
| `decision: kept` | 改动有效 | 什么都不用做，它留在生效状态 |
| `decision: reverted` | 改动无效 | 什么都不用做，它已经自动回滚了 |

**它不会问你要不要回滚，也不会在你没看的时候乱动。** inconclusive 时它绝不动作。

---

## 3. 我改过你的环境，这里是清单

| 改了什么 | 位置 | 怎么撤销 |
|---|---|---|
| 新增了 skill `gui-observation` | `packages/preset/agent-preset/skills/gui-observation/` | `npm run loop -- --judge` 会自动滚；或手动删那个目录 |
| 账本记录 | `reports/harness-eval-ledger/changes.jsonl` | 不用管，是历史 |

**除此之外没有动任何东西。** 没有改 profile，没有改 cordis.patch.yml，没有装新包。

---

## 4. 如果哪天想推倒重来

```powershell
cd <本库路径>\plugins\harness-eval
$env:DSH_CHECKOUT = '<你的 DSH 检出目录>'
npm run loop -- --status
npm run loop -- --revert <id>
```

跑完你的 skill 目录就回到我改之前的样子。

---

## 5. 一个你会遇到的疑惑

**「为什么它有时候说 inconclusive 又好像什么都没做？」**

因为它真的什么都没做。这是设计，不是故障。它的价值在于：**当你问「我上次改的到底有没有用」，它能给出一个不是靠感觉的答案。** 如果证据不够，它宁可说「不知道」，也不猜。

---

## 6. 真想看数据长什么样

```powershell
npm run export -- --out D:\tmp\evidence.jsonl   # 每个会话一行
```

打开看，里面是 token、错误码、重复调用、harness 签名。这就是这套系统的全部原料。
