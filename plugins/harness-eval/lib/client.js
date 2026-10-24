/**
 * Build the marks Remote contribution.
 *
 * This mirrors `createTypertRemoteInfo` from
 * `@deepseek-ai/dsh-typert-protocol/remote-info`: it turns a method spec into
 * the descriptors `ctx.remote.$mount()` accepts. The protocol module is not in
 * the shell's module table, so the construction is reproduced here instead of
 * requested; the spec below is the same one `src/remote-spec.js` declares.
 *
 * @param z - the shell's zod runtime.
 * @returns a contribution with `package`, `descriptors`, and `methods`.
 */
function createMarksRemote(z) {
  const markSchema = z.object({
    id: z.string(),
    turn: z.number(),
    kind: z.enum(['failure', 'success', 'note']),
    reason: z.string(),
    createdAt: z.number(),
  })
  const createRequest = z.object({
    sessionId: z.string(),
    turn: z.number(),
    kind: z.enum(['failure', 'success', 'note']),
    reason: z.string(),
  })
  const listRequest = z.object({ sessionId: z.string() })
  const discardRequest = z.object({ id: z.string() })

  /** One parameter's ordinary and strict codec pair. */
  const codecs = (factory, typeSymbol, jsonSchema) => ({
    codec: { mode: 'strict', typeSymbol, create: () => factory, jsonSchema },
    strictCodec: { mode: 'strict', typeSymbol, create: () => factory, jsonSchema },
  })

  const methods = {
    'harnessMarks/ping': {
      service: 'harnessMarks',
      description: 'Prove the marks service is reachable over the Remote boundary.',
      invocation: { kind: 'direct' },
      parameters: [],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-harness-eval#harnessMarks/ping:result',
        create: () => z.string(),
        description: 'a fixed acknowledgment.',
        jsonSchema: { type: 'string' },
      },
    },
    'harnessMarks/create': {
      service: 'harnessMarks',
      description: 'Record one observation about a turn.',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        description: 'session, turn, kind, and reason.',
        ...codecs(createRequest, 'dsh-harness-eval#CreateMarkRequest', {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            turn: { type: 'number' },
            kind: { type: 'string', enum: ['failure', 'success', 'note'] },
            reason: { type: 'string' },
          },
          required: ['sessionId', 'turn', 'kind', 'reason'],
        }),
      }],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-harness-eval#harnessMarks/create:result',
        create: () => markSchema,
        description: 'the stored mark.',
        jsonSchema: { type: 'object' },
      },
    },
    'harnessMarks/list': {
      service: 'harnessMarks',
      description: 'Read every mark recorded for one session.',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        description: 'the session to read.',
        ...codecs(listRequest, 'dsh-harness-eval#ListMarksRequest', {
          type: 'object',
          properties: { sessionId: { type: 'string' } },
          required: ['sessionId'],
        }),
      }],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-harness-eval#harnessMarks/list:result',
        create: () => z.array(markSchema),
        description: 'the marks in creation order.',
        jsonSchema: { type: 'array' },
      },
    },
    'harnessMarks/discard': {
      service: 'harnessMarks',
      description: 'Delete one mark.',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        description: 'the mark id to discard.',
        ...codecs(discardRequest, 'dsh-harness-eval#DiscardMarkRequest', {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        }),
      }],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-harness-eval#harnessMarks/discard:result',
        create: () => z.boolean(),
        description: 'whether a record was discarded.',
        jsonSchema: { type: 'boolean' },
      },
    },
  }

  const packageName = 'dsh-harness-eval'
  /** Project one method spec plus its endpoint into a mount descriptor. */
  const descriptorOf = (endpoint, definition) => {
    const slash = endpoint.indexOf('/')
    return {
      ...definition,
      id: `${packageName}#${endpoint}`,
      namespace: endpoint.slice(0, slash),
      method: endpoint.slice(slash + 1),
      parameters: definition.parameters.map(parameter => ({
        ...parameter,
        wire: parameter.wire ?? parameter.name,
      })),
    }
  }

  return {
    package: packageName,
    get descriptors() {
      return Object.entries(methods).map(([endpoint, definition]) => descriptorOf(endpoint, definition))
    },
    get methods() {
      return Object.fromEntries(Object.entries(methods).map(([endpoint, definition]) =>
        [endpoint, { ...definition, id: `${packageName}#${endpoint}` }]))
    },
  }
}

/**
 * dsh-harness-eval v0.0.4 — browser half.
 *
 * Renders the `harnessEvidence` projection the host half folds — a failure
 * timeline, the cost of re-running only the tail, the harness fingerprint, and
 * the marks a person recorded — and lets a turn be marked through the
 * `harnessMarks` Remote namespace.
 *
 * Written as a bundle directly: tsdown emits this same shape
 * (window.__ModuleLoader__.load({ id, factory })), and the factory body needs
 * no transformation, so this package carries no build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-harness-eval',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    // `@deepseek-ai/dsh-typert-protocol/remote-info` is not in the shell's
    // module table and the module graph only normalizes a trailing `/client`
    // subpath, so this bundle builds its own descriptors from an inline spec
    // rather than requesting one. `src/remote-spec.js` is the same spec in the
    // generator's output shape; `remote-spec.test.mjs` keeps the two in step.
    const REMOTE = createMarksRemote(require('zod'))

    const NS = 'harness-eval'

    const zh = {
      'view.harness': 'Harness',
      'empty.title': 'Harness 证据',
      'empty.body': '这个会话还没有可读的轮次。发出第一条消息后，这里会显示它走到第几轮、花了多少、哪一轮开始不再收敛。',
      'summary.brokeAt': '首次未完成的轮次',
      'summary.brokeAtNone': '全部完成',
      'summary.turns': '轮次',
      'summary.steps': '步骤',
      'summary.toolCalls': '工具调用',
      'summary.toolErrors': '工具错误',
      'summary.idle': '空转轮',
      'summary.tokensIn': '输入 token',
      'summary.tokensOut': '输出 token',
      'summary.cacheRead': '缓存命中',
      'summary.repeats': '重复调用',
      'summary.retries': '传输重试',
      'harness.cwd': '工作目录',
      'harness.preset': '预设',
      'harness.parent': '分叉自',
      'harness.created': '创建于',
      'timeline.title': '失败点时间线',
      'timeline.hint': '每格一轮，从左到右。红色是这一轮没有正常完成。',
      'timeline.fork': '分叉点',
      'timeline.open': '进行中',
      'timeline.legendOk': '完成',
      'timeline.legendBad': '未完成',
      'timeline.legendOpen': '进行中',
      'fork.title': '分叉代价',
      'fork.none': '这次运行没有断点，不存在需要分叉的位置。用户主动中断的轮次不算断点。',
      'fork.turn': '从第 {turn} 轮之后分叉',
      'fork.tail': '尾部 {steps} 步 / 全程 {total} 步',
      'fork.tailTokens': '尾部 {tokens} token / 全程 {total} token',
      'fork.share': '重跑尾部只需 {share}% 的步数',
      'fork.cheap': '尾部占比低，分叉重跑划算。',
      'fork.expensive': '尾部占比高，分叉重跑接近重做，收益有限。',
      'mark.add': '标记这一轮',
      'mark.kind': '类型',
      'mark.reason': '原因',
      'mark.reasonHint': '这一轮成在哪里、败在哪里',
      'mark.save': '保存',
      'mark.cancel': '取消',
      'mark.remove': '删除',
      'mark.saving': '保存中…',
      'mark.failed': '保存失败：{message}',
      'marks.title': '标记',
      'marks.none': '还没有标记。点某一轮右侧的记录按钮，写下这一轮成在哪里、败在哪里。',
      'marks.count': '{count} 条',
      'marks.turn': '第 {turn} 轮',
      'mark.failure': '失败',
      'mark.success': '成功',
      'mark.note': '备注',
      'turns.title': '逐轮明细',
      'turns.turn': '轮',
      'turns.outcome': '结局',
      'turns.steps': '步骤',
      'turns.calls': '调用',
      'turns.errors': '错误',
      'outcome.completed': '完成',
      'outcome.aborted': '用户中止',
      'outcome.interrupted': '用户打断',
      'outcome.failed': '失败',
      'outcome.truncated': '截断',
      'outcome.other': '其他',
      'outcome.open': '进行中',
      'note.why': '这张表回答一个问题：这类失败能不能被「分叉 + 尾部重跑」救回来。失败点越靠后，重跑越便宜。',
      // 改动面板。只读：循环负责报告，人负责决定。
      'changes.title': 'Harness 改动',
      'changes.loading': '加载中…',
      'changes.refresh': '刷新',
      'changes.idle': '读取改动账本和按覆盖率排序的信号。',
      'changes.none': '账本里还没有改动。循环尚未应用过任何东西。',
      'changes.unavailable': '不可用：{message}。Host 可能还没注册这些只读路由。',
      'changes.col.target': '改动',
      'changes.col.hypothesis': '为什么改',
      'changes.col.verdict': '判定',
      'changes.unjudged': '未判定',
      'changes.reverted': '已回滚',
      'changes.revertHint': '回滚：npm run loop -- --revert {id}',
      'changes.candidates': '值得做下一个实验的信号',
      'changes.candidatesHint': '{sessions} 个会话里有多少可能出现该信号。占比低的攒不出证据。',
    }

    const en = {
      'view.harness': 'Harness',
      'empty.title': 'Harness evidence',
      'empty.body': 'No turns yet. Once this session runs, this page shows which turn it reached, what it cost, and where it stopped converging.',
      'summary.brokeAt': 'First incomplete turn',
      'summary.brokeAtNone': 'all completed',
      'summary.turns': 'Turns',
      'summary.steps': 'Steps',
      'summary.toolCalls': 'Tool calls',
      'summary.toolErrors': 'Tool errors',
      'summary.idle': 'Idle turns',
      'summary.tokensIn': 'Input tokens',
      'summary.tokensOut': 'Output tokens',
      'summary.cacheRead': 'Cache read',
      'summary.repeats': 'Repeated calls',
      'summary.retries': 'Transport retries',
      'harness.cwd': 'Working directory',
      'harness.preset': 'Preset',
      'harness.parent': 'Forked from',
      'harness.created': 'Created',
      'timeline.title': 'Failure timeline',
      'timeline.hint': 'One cell per turn, oldest first. Red means the turn did not complete.',
      'timeline.fork': 'fork point',
      'timeline.open': 'open',
      'timeline.legendOk': 'completed',
      'timeline.legendBad': 'incomplete',
      'timeline.legendOpen': 'open',
      'fork.title': 'Cost of a fork',
      'fork.none': 'This run never broke, so there is nothing to fork from. A turn the person interrupted is not a break.',
      'fork.turn': 'Fork after turn {turn}',
      'fork.tail': 'tail {steps} of {total} steps',
      'fork.tailTokens': 'tail {tokens} of {total} tokens',
      'fork.share': 'Re-running the tail costs {share}% of the steps',
      'fork.cheap': 'A small tail makes a forked re-run cheap.',
      'fork.expensive': 'A large tail makes a forked re-run nearly a full redo, so the gain is limited.',
      'mark.add': 'Mark this turn',
      'mark.kind': 'Kind',
      'mark.reason': 'Reason',
      'mark.reasonHint': 'what worked or what went wrong here',
      'mark.save': 'Save',
      'mark.cancel': 'Cancel',
      'mark.remove': 'Delete',
      'mark.saving': 'Saving…',
      'mark.failed': 'Could not save: {message}',
      'marks.title': 'Marks',
      'marks.none': 'No marks yet. Use the mark control on a turn row to record what worked or what went wrong there.',
      'marks.count': '{count}',
      'marks.turn': 'Turn {turn}',
      'mark.failure': 'failure',
      'mark.success': 'success',
      'mark.note': 'note',
      'turns.title': 'Per-turn detail',
      'turns.turn': 'Turn',
      'turns.outcome': 'Outcome',
      'turns.steps': 'Steps',
      'turns.calls': 'Calls',
      'turns.errors': 'Errors',
      'outcome.completed': 'completed',
      'outcome.aborted': 'stopped by user',
      'outcome.interrupted': 'interrupted by user',
      'outcome.failed': 'failed',
      'outcome.truncated': 'truncated',
      'outcome.other': 'other',
      'outcome.open': 'open',
      'note.why': 'This table answers one question: can this kind of failure be rescued by branching and re-running only the tail? The later the break, the cheaper the re-run.',
      // The change panel. Read-only by design: the loop reports, the person decides.
      'changes.title': 'Harness changes',
      'changes.loading': 'Loading…',
      'changes.refresh': 'Refresh',
      'changes.idle': 'Load the change ledger and the ranked signals.',
      'changes.none': 'No change is on record. The loop has not applied anything yet.',
      'changes.unavailable': 'Unavailable: {message}. The Host may not have registered the read routes yet.',
      'changes.col.target': 'Change',
      'changes.col.hypothesis': 'Why it was made',
      'changes.col.verdict': 'Verdict',
      'changes.unjudged': 'not judged',
      'changes.reverted': 'reverted',
      'changes.revertHint': 'Revert: npm run loop -- --revert {id}',
      'changes.candidates': 'Signals worth a next experiment',
      'changes.candidatesHint': 'How many of {sessions} session(s) could produce each signal. A low share cannot accumulate evidence.',
    }

    const styles = {
      page: {
        boxSizing: 'border-box',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        padding: '24px clamp(20px, 4vw, 44px) 40px',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: 1.6,
      },
      title: { margin: 0, fontSize: 18, fontWeight: 500, lineHeight: '26px' },
      sectionTitle: { margin: '0 0 10px', fontSize: 13, fontWeight: 600 },
      subtitle: { margin: '6px 0 20px', color: 'var(--dsw-alias-label-secondary)' },
      cards: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
        gap: 10,
        marginBottom: 22,
        maxWidth: 860,
      },
      card: {
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        borderRadius: 10,
        padding: '10px 12px',
      },
      cardLabel: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, lineHeight: '16px' },
      cardValue: { fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: '28px' },
      cardValueWarn: { color: 'var(--dsw-alias-state-warn-primary)' },
      cardValueQuiet: { color: 'var(--dsw-alias-label-secondary)', fontSize: 15, fontWeight: 500 },
      block: { maxWidth: 860, marginBottom: 22 },
      facts: {
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        gap: '3px 14px',
        margin: 0,
        fontSize: 12,
      },
      factKey: { color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
      factValue: {
        margin: 0,
        fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
        overflowWrap: 'anywhere',
      },
      timeline: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        gap: 3,
        padding: '2px 0 6px',
      },
      cell: {
        boxSizing: 'border-box',
        width: 18,
        border: 0,
        borderRadius: 3,
        padding: 0,
        cursor: 'default',
        display: 'block',
      },
      forkMark: {
        marginLeft: 4,
        color: 'var(--dsw-alias-state-error-primary)',
        fontSize: 14,
        lineHeight: 1,
        alignSelf: 'center',
      },
      legend: {
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        marginTop: 4,
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
      },
      legendItem: { display: 'inline-flex', alignItems: 'center', gap: 5 },
      legendSwatch: { width: 10, height: 10, borderRadius: 2, display: 'inline-block' },
      forkCard: {
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        borderRadius: 10,
        padding: '12px 14px',
        maxWidth: 720,
      },
      forkRow: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
      forkStrong: { fontWeight: 600 },
      forkNote: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, margin: '6px 0 0' },
      bar: {
        height: 6,
        borderRadius: 999,
        background: 'color-mix(in srgb, var(--dsw-alias-label-secondary) 18%, transparent)',
        overflow: 'hidden',
        marginTop: 10,
        maxWidth: 420,
      },
      editor: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        padding: '4px 0 2px',
        maxWidth: 720,
      },
      select: {
        boxSizing: 'border-box',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 6,
        padding: '2px 6px',
        font: 'inherit',
        fontSize: 12,
      },
      input: {
        boxSizing: 'border-box',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 6,
        padding: '3px 8px',
        font: 'inherit',
        fontSize: 12,
        flex: '1 1 260px',
        minWidth: 0,
      },
      btn: {
        boxSizing: 'border-box',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 6,
        padding: '2px 10px',
        font: 'inherit',
        fontSize: 12,
        lineHeight: '18px',
        cursor: 'pointer',
      },
      btnPrimary: {
        borderColor: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent)',
        color: 'var(--dsw-alias-brand-primary)',
      },
      btnQuiet: {
        border: 0,
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        background: 'transparent',
        font: 'inherit',
        fontSize: 11,
        padding: '0 4px',
      },
      editorError: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 11, flexBasis: '100%' },
      markList: { margin: 0, padding: 0, listStyle: 'none', maxWidth: 720 },
      markItem: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        padding: '6px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        flexWrap: 'wrap',
      },
      markTurn: {
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
      },
      markReason: { overflowWrap: 'anywhere', minWidth: 0, flex: '1 1 240px' },
      markRemove: {
        border: 0,
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        background: 'transparent',
        font: 'inherit',
        fontSize: 11,
        padding: '0 4px',
      },
      markDot: { color: 'var(--dsw-alias-state-warn-primary)', marginLeft: 6, fontSize: 14 },
      barFill: { height: '100%', display: 'block', borderRadius: 999 },
      table: {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
      },
      th: {
        textAlign: 'left',
        color: 'var(--dsw-alias-label-secondary)',
        fontWeight: 500,
        padding: '5px 10px 5px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l2)',
        whiteSpace: 'nowrap',
      },
      thNum: { textAlign: 'right', padding: '5px 0 5px 10px' },
      td: { padding: '5px 10px 5px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      tdNum: {
        textAlign: 'right',
        padding: '5px 0 5px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontVariantNumeric: 'tabular-nums',
      },
      pill: {
        display: 'inline-block',
        borderRadius: 999,
        padding: '0 7px',
        fontSize: 11,
        lineHeight: '17px',
        border: '1px solid var(--dsw-alias-border-l2)',
      },
      pillOk: {
        color: 'var(--dsw-alias-state-success-primary)',
        borderColor: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent)',
      },
      pillBad: {
        color: 'var(--dsw-alias-state-error-primary)',
        borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent)',
      },
      pillWarn: {
        color: 'var(--dsw-alias-state-warn-primary)',
        borderColor: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent)',
      },
      note: { marginTop: 22, color: 'var(--dsw-alias-label-secondary)', fontSize: 12, maxWidth: 720 },
      // The change panel's header: title and its one action share a row, so the
      // refresh button reads as belonging to the table below it.
      panelHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexWrap: 'wrap',
      },
      changeCandidates: {
        marginTop: 14,
        paddingTop: 12,
        borderTop: '1px solid var(--dsw-alias-border-l2)',
      },
      changeList: {
        margin: '6px 0 0',
        paddingLeft: 18,
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
        lineHeight: 1.7,
      },
    }

    /** Fill colours for the timeline, derived from the outcome vocabulary. */
    const CELL_FILL = {
      completed: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 62%, transparent)',
      failed: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 72%, transparent)',
      aborted: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent)',
      truncated: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 62%, transparent)',
      other: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 42%, transparent)',
      open: 'color-mix(in srgb, var(--dsw-alias-label-secondary) 30%, transparent)',
    }

    /**
     * Pick the pill style for an outcome.
     * @param outcome - published outcome tag, or undefined while the turn is open.
     * @returns the style for that tag.
     */
    function outcomeStyle(outcome) {
      if (outcome === 'completed') return { ...styles.pill, ...styles.pillOk }
      if (outcome === 'failed' || outcome === 'aborted') return { ...styles.pill, ...styles.pillBad }
      if (outcome === 'truncated' || outcome === 'other') return { ...styles.pill, ...styles.pillWarn }
      return { ...styles.pill, color: 'var(--dsw-alias-label-secondary)' }
    }

    /**
     * Pill style for one mark kind.
     * @param kind - published mark kind.
     * @returns the pill style for that kind.
     */
    function markPillStyle(kind) {
      if (kind === 'failure') return styles.pillBad
      if (kind === 'success') return styles.pillOk
      return styles.pillWarn
    }

    /**
     * Inline editor for one turn's mark.
     *
     * Rendered inside the turn's table row so the mark always carries the turn
     * it describes; there is no separate "which turn?" step to get wrong.
     *
     * @param props - locale translate, the turn number, the create callback, and a close callback.
     * @returns the editor element.
     */
    function MarkEditor(props) {
      const { t, turn } = props
      const [kind, setKind] = React.useState('failure')
      const [reason, setReason] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)

      const submit = async () => {
        if (busy || reason.trim() === '') return
        setBusy(true)
        setError(undefined)
        try {
          await props.onCreate({ turn, kind, reason: reason.trim() })
          props.onClose()
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
          setBusy(false)
        }
      }

      return h('div', { style: styles.editor },
        h('select', {
          style: styles.select,
          value: kind,
          disabled: busy,
          'aria-label': t('mark.kind'),
          onChange: event => setKind(event.target.value),
        },
        ['failure', 'success', 'note'].map(option =>
          h('option', { key: option, value: option }, t(`mark.${option}`)))),
        h('input', {
          style: styles.input,
          type: 'text',
          value: reason,
          disabled: busy,
          placeholder: t('mark.reasonHint'),
          'aria-label': t('mark.reason'),
          onChange: event => setReason(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter') void submit()
            if (event.key === 'Escape') props.onClose()
          },
        }),
        h('button', {
          style: { ...styles.btn, ...styles.btnPrimary },
          type: 'button',
          disabled: busy || reason.trim() === '',
          onClick: () => void submit(),
        }, busy ? t('mark.saving') : t('mark.save')),
        h('button', {
          style: styles.btn,
          type: 'button',
          disabled: busy,
          onClick: props.onClose,
        }, t('mark.cancel')),
        error === undefined
          ? null
          : h('span', { style: styles.editorError }, t('mark.failed', { message: error })))
    }

    /**
     * One labelled figure.
     * @param props - label, value text, and an optional emphasis style.
     * @returns the card element.
     */
    function Stat(props) {
      return h('div', { style: styles.card },
        h('div', { style: styles.cardLabel }, props.label),
        h('div', { style: { ...styles.cardValue, ...(props.emphasis ?? {}) } }, props.value))
    }

    /**
     * Compact token counts, because a session can run into the hundreds of
     * millions of cache-read tokens and a raw figure is unreadable in a card.
     * @param value - the raw count.
     * @returns a short human figure.
     */
    function formatTokens(value) {
      const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
      if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
      return String(n)
    }

    /**
     * One timeline cell. Height encodes relative cost, so a tall red cell is
     * both where the run broke and where most of the work went.
     * @param props - turn row, whether it is the fork point, and the tallest step count.
     * @returns the cell element.
     */
    function TimelineCell(props) {
      const { turn, isFork, maxSteps } = props
      const tag = turn.outcome === undefined ? 'open' : turn.outcome
      const share = maxSteps === 0 ? 0 : turn.steps / maxSteps
      const height = 10 + Math.round(share * 30)
      const title = [
        `#${turn.turn}`,
        props.labelOf(tag),
        `${turn.steps} ${props.stepsLabel}`,
        `${turn.toolCalls} ${props.callsLabel}`,
      ].join(' · ')
      return h('span', { style: { display: 'inline-flex', flexDirection: 'column', alignItems: 'center' } },
        h('span', {
          style: { ...styles.cell, height, background: CELL_FILL[tag] },
          title,
          'aria-label': title,
        }),
        isFork ? h('span', { style: styles.forkMark, title: props.forkLabel }, '▾') : null)
    }

    /**
     * Render the Harness evidence page.
     * @param props - slot props; `useProjection` reads the host projection.
     * @returns the page element.
     */
    function HarnessView(props) {
      const t = props.t
      // `useProjection` is a standard Session seat: `undefined` means the host
      // unit is unmounted or no baseline has carried the key yet.
      const evidence = props.useProjection('harnessEvidence')

      // The turn whose editor is open, or undefined when none is.
      const [editingTurn, setEditingTurn] = React.useState(undefined)

      // Marking needs both the Remote callback and a session identity.
      const canMark = typeof props.createMark === 'function' && typeof props.sessionId === 'string' && props.sessionId !== ''
      // The projection carries marks from its last fold. Refold after a write
      // when the framework exposes the standard invalidation seat.
      const refreshEvidence = () => {
        if (typeof props.invalidateProjection === 'function') props.invalidateProjection('harnessEvidence')
      }

      /**
       * Record one mark for the current session.
       * @param input - turn, kind, and reason from the editor.
       * @returns resolution after the host stored it.
       */
      const onCreateMark = async input => {
        const mark = await props.createMark({
          sessionId: props.sessionId,
          turn: input.turn,
          kind: input.kind,
          reason: input.reason,
        })
        refreshEvidence()
        return mark
      }

      /**
       * Delete one mark and refold the evidence that carried it.
       * @param id - stored mark id.
       * @returns whether the host removed the record.
       */
      const onRemoveMark = async id => {
        const removed = await props.removeMark(id)
        refreshEvidence()
        return removed
      }

      if (evidence === undefined || evidence.totals.turns === 0) {
        return h('div', { style: styles.page },
          h('h2', { style: styles.title }, t('empty.title')),
          h('p', { style: styles.subtitle }, t('empty.body')))
      }

      const brokeAt = evidence.firstIncompleteTurn === undefined
        ? t('summary.brokeAtNone')
        : String(evidence.firstIncompleteTurn)
      // `bifurcate` is always present in a v2 payload; treat a missing one as
      // "this host cannot say", which renders the same as "nothing to fork".
      const fork = evidence.bifurcate === undefined
        ? { turn: null, tailSteps: 0, tailToolCalls: 0, tailShare: null, tailTokens: null, totalTokens: 0 }
        : {
          ...evidence.bifurcate,
          // A v5 payload reports the tail's tokens; a v4 one does not, so the
          // token line is simply absent rather than shown as zero.
          tailTokens: evidence.bifurcate.tailInputTokens === undefined
            ? null
            : evidence.bifurcate.tailInputTokens + evidence.bifurcate.tailOutputTokens,
          totalTokens: (evidence.totals.inputTokens ?? 0) + (evidence.totals.outputTokens ?? 0),
        }

      const harnessRows = [
        ['cwd', evidence.harness.cwd],
        ['preset', evidence.harness.agentPreset],
        ['parent', evidence.harness.parentSession],
        ['created', evidence.harness.createdAt === 0
          ? undefined
          : new Date(evidence.harness.createdAt).toLocaleString()],
      ].filter(row => row[1] !== undefined)

      // marks is always published, but treat an older payload as markless.
      const marks = Array.isArray(evidence.marks) ? evidence.marks : []
      const maxSteps = evidence.turns.reduce((peak, turn) => Math.max(peak, turn.steps), 0)
      const labelOf = tag => t(`outcome.${tag}`)

      return h('div', { style: styles.page },
        h('div', { style: styles.cards },
          h(Stat, {
            label: t('summary.brokeAt'),
            value: brokeAt,
            emphasis: evidence.firstIncompleteTurn === undefined ? styles.cardValueQuiet : styles.cardValueWarn,
          }),
          h(Stat, { label: t('summary.turns'), value: String(evidence.totals.turns) }),
          h(Stat, { label: t('summary.steps'), value: String(evidence.totals.steps) }),
          h(Stat, { label: t('summary.toolCalls'), value: String(evidence.totals.toolCalls) }),
          h(Stat, {
            label: t('summary.toolErrors'),
            value: String(evidence.totals.toolErrors),
            emphasis: evidence.totals.toolErrors > 0 ? styles.cardValueWarn : undefined,
          }),
          h(Stat, {
            label: t('summary.idle'),
            value: String(evidence.idleTurns),
            emphasis: evidence.idleTurns > 0 ? styles.cardValueWarn : undefined,
          }),
          // Cost. These come from `assistant/message` usage, summed per turn.
          // `totalTokens` is a running total in real logs and is never summed.
          h(Stat, { label: t('summary.tokensIn'), value: formatTokens(evidence.totals.inputTokens) }),
          h(Stat, { label: t('summary.tokensOut'), value: formatTokens(evidence.totals.outputTokens) }),
          h(Stat, { label: t('summary.cacheRead'), value: formatTokens(evidence.totals.cacheReadTokens) }),
          // The "experience did not accumulate" signal: the same call re-issued.
          h(Stat, {
            label: t('summary.repeats'),
            value: String(evidence.repeats ?? 0),
            emphasis: (evidence.repeats ?? 0) > 0 ? styles.cardValueWarn : undefined,
          }),
          // Infrastructure retries are NOT agent mistakes, so they get their own
          // card rather than inflating the tool-error count.
          h(Stat, { label: t('summary.retries'), value: String(evidence.retries ?? 0) })),

        h('div', { style: styles.block },
          h('h3', { style: styles.sectionTitle }, t('timeline.title')),
          h('div', { style: styles.timeline },
            evidence.turns.map(turn => h(TimelineCell, {
              key: turn.turn,
              turn,
              isFork: fork.turn === turn.turn,
              maxSteps,
              labelOf,
              stepsLabel: t('turns.steps'),
              callsLabel: t('turns.calls'),
              forkLabel: t('timeline.fork'),
            }))),
          h('div', { style: styles.legend },
            h('span', { style: styles.legendItem },
              h('span', { style: { ...styles.legendSwatch, background: CELL_FILL.completed } }),
              t('timeline.legendOk')),
            h('span', { style: styles.legendItem },
              h('span', { style: { ...styles.legendSwatch, background: CELL_FILL.failed } }),
              t('timeline.legendBad')),
            h('span', { style: styles.legendItem },
              h('span', { style: { ...styles.legendSwatch, background: CELL_FILL.open } }),
              t('timeline.legendOpen'))),
          h('p', { style: styles.forkNote }, t('timeline.hint'))),

        h('div', { style: styles.block },
          h('h3', { style: styles.sectionTitle }, t('fork.title')),
          h('div', { style: styles.forkCard },
            fork.turn === null
              ? h('div', { style: styles.forkNote }, t('fork.none'))
              : h(React.Fragment, null,
                h('div', { style: styles.forkRow },
                  h('span', { style: styles.forkStrong }, t('fork.turn', { turn: fork.turn })),
                  h('span', null, t('fork.tail', { steps: fork.tailSteps, total: evidence.totals.steps }))),
                // Tokens are what a re-run actually costs; steps are only a
                // proxy. Both are shown so a cheap-looking tail with a heavy
                // cache-read bill is still visible.
                fork.tailTokens === null
                  ? null
                  : h('div', { style: styles.forkRow },
                    h('span', { style: styles.forkNote },
                      t('fork.tailTokens', {
                        tokens: formatTokens(fork.tailTokens),
                        total: formatTokens(fork.totalTokens),
                      }))),
                fork.tailShare === null
                  ? null
                  : h('div', { style: styles.bar },
                    h('span', {
                      style: {
                        ...styles.barFill,
                        width: `${Math.max(2, Math.min(100, fork.tailShare))}%`,
                        background: fork.tailShare <= 50 ? CELL_FILL.completed : CELL_FILL.truncated,
                      },
                    })),
                h('p', { style: styles.forkNote },
                  fork.tailShare === null
                    ? t('fork.cheap')
                    : t('fork.share', { share: fork.tailShare }) + ' ' +
                      (fork.tailShare <= 50 ? t('fork.cheap') : t('fork.expensive')))))),

        harnessRows.length > 0 && h('div', { style: styles.block },
          h('h3', { style: styles.sectionTitle }, t('view.harness')),
          h('dl', { style: styles.facts },
            harnessRows.map(([key, value]) => h(React.Fragment, { key },
              h('dt', { style: styles.factKey }, t(`harness.${key}`)),
              h('dd', { style: styles.factValue }, String(value)))))),

        marks.length > 0 && h('div', { style: styles.block },
          h('h3', { style: styles.sectionTitle },
            `${t('marks.title')} · ${t('marks.count', { count: marks.length })}`),
          h('ul', { style: styles.markList },
            marks.map(mark => h('li', { key: mark.id, style: styles.markItem },
              h('span', { style: { ...styles.pill, ...markPillStyle(mark.kind) } }, t(`mark.${mark.kind}`)),
              h('span', { style: styles.markTurn }, t('marks.turn', { turn: mark.turn })),
              h('span', { style: styles.markReason }, mark.reason),
              h('button', {
                type: 'button',
                style: styles.markRemove,
                'aria-label': t('mark.remove'),
                title: t('mark.remove'),
                onClick: () => { void onRemoveMark(mark.id) },
              }, t('mark.remove')))))),

        h('div', { style: styles.block },
          h('h3', { style: styles.sectionTitle }, t('turns.title')),
          h('table', { style: styles.table },
            h('thead', null,
              h('tr', null,
                h('th', { style: styles.th }, t('turns.turn')),
                h('th', { style: styles.th }, t('turns.outcome')),
                h('th', { style: styles.thNum }, t('turns.steps')),
                h('th', { style: styles.thNum }, t('turns.calls')),
                h('th', { style: styles.thNum }, t('turns.errors')),
                h('th', { style: styles.th }, ''))),
            h('tbody', null,
              // Both surfaces read newest-first: the evidence a reader wants is
              // usually at the end of the run.
              evidence.turns.slice().reverse().map(turn => {
                const marked = marks.filter(mark => mark.turn === turn.turn)
                const editing = editingTurn === turn.turn
                return h(React.Fragment, { key: turn.turn },
                  h('tr', null,
                    h('td', { style: styles.td },
                      String(turn.turn),
                      // A turn carrying a mark gets a dot, so the table and the
                      // mark list agree without the reader matching numbers.
                      marked.length === 0
                        ? null
                        : h('span', {
                          style: styles.markDot,
                          title: marked.map(mark => mark.reason).join('\n'),
                        }, '•')),
                    h('td', { style: styles.td },
                      h('span', { style: outcomeStyle(turn.outcome) },
                        turn.outcome === undefined ? t('outcome.open') : t(`outcome.${turn.outcome}`))),
                    h('td', { style: styles.tdNum }, String(turn.steps)),
                    h('td', { style: styles.tdNum }, String(turn.toolCalls)),
                    h('td', { style: { ...styles.tdNum, ...(turn.toolErrors > 0 ? { color: 'var(--dsw-alias-state-error-primary)' } : {}) } },
                      String(turn.toolErrors)),
                    h('td', { style: styles.td },
                      canMark
                        ? h('button', {
                          style: styles.btnQuiet,
                          type: 'button',
                          onClick: () => setEditingTurn(editing ? undefined : turn.turn),
                        }, editing ? t('mark.cancel') : t('mark.add'))
                        : null)),
                  editing
                    ? h('tr', null,
                      h('td', { colSpan: 6, style: styles.td },
                        h(MarkEditor, {
                          t,
                          turn: turn.turn,
                          onCreate: mark => onCreateMark(mark),
                          onClose: () => setEditingTurn(undefined),
                        })))
                    : null)
              })))),

        h('p', { style: styles.note }, t('note.why')),

        // The change panel comes last: it is about the harness itself rather
        // than about this session, so it should not push the evidence down.
        h(ChangePanel, { t }))
    }

    /**
     * The API root for this plugin's read endpoints.
     *
     * Same origin as the page: these routes are registered by the Host that is
     * serving the shell, so no host or port has to be known here.
     */
    const API_ROOT = '/api/harness-eval'

    /**
     * Fetch one JSON endpoint.
     *
     * Failures are returned rather than thrown: this panel is informational, and
     * an unreachable endpoint must render as "unavailable" instead of blanking
     * the whole tab.
     * @param path - endpoint name under the API root.
     * @returns `{ ok, data, error }`.
     */
    async function fetchJson(path) {
      try {
        const response = await fetch(`${API_ROOT}/${path}`, { headers: { accept: 'application/json' } })
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
        return { ok: true, data: await response.json() }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    /**
     * Which changes are in force, and how the signals rank.
     *
     * Deliberately read-only. The judgement — keep or revert — is the person's,
     * so this panel shows everything needed to make it and provides no button
     * that would make it automatically. Reverting is one command, and it is
     * spelled out in the panel for that reason.
     * @param props - `{ t }`.
     * @returns the panel element.
     */
    function ChangePanel(props) {
      const t = props.t
      const [state, setState] = React.useState({ phase: 'idle' })
      const [candidates, setCandidates] = React.useState(undefined)

      /**
       * Load both endpoints. Kept manual rather than on an interval: a figure
       * that refreshes on its own invites reading a number as a verdict.
       */
      const load = async () => {
        setState({ phase: 'loading' })
        const status = await fetchJson('status')
        if (!status.ok) {
          setState({ phase: 'error', error: status.error })
          return
        }
        setState({ phase: 'ready', changes: status.data.changes ?? [] })
        const ranked = await fetchJson('candidates')
        if (ranked.ok) setCandidates(ranked.data)
      }

      const changes = state.changes ?? []
      return h('div', { style: styles.block },
        h('div', { style: styles.panelHead },
          h('h3', { style: styles.sectionTitle }, t('changes.title')),
          h('button', {
            type: 'button',
            style: styles.btnQuiet,
            onClick: load,
          }, state.phase === 'loading' ? t('changes.loading') : t('changes.refresh'))),

        state.phase === 'error'
          ? h('p', { style: styles.forkNote }, t('changes.unavailable', { message: state.error }))
          : null,

        state.phase === 'idle'
          ? h('p', { style: styles.forkNote }, t('changes.idle'))
          : null,

        state.phase === 'ready' && changes.length === 0
          ? h('p', { style: styles.forkNote }, t('changes.none'))
          : null,

        changes.length > 0
          ? h('table', { style: styles.table },
            h('thead', null,
              h('tr', null,
                h('th', { style: styles.th }, t('changes.col.target')),
                h('th', { style: styles.th }, t('changes.col.hypothesis')),
                h('th', { style: styles.th }, t('changes.col.verdict')))),
            h('tbody', null, changes.map(makeChangeRow(t))))
          : null,

        candidates === undefined
          ? null
          : h('div', { style: styles.changeCandidates },
            h('h4', { style: styles.sectionTitle }, t('changes.candidates')),
            h('p', { style: styles.forkNote }, t('changes.candidatesHint', { sessions: candidates.sessions })),
            h('ul', { style: styles.changeList },
              (candidates.rows ?? []).filter(row => row.sessions > 0).slice(0, 5).map(row =>
                h('li', { key: row.key },
                  `${row.signal} — ${row.sessions}/${candidates.sessions} (${row.coverage}%)`)))))
    }

    /**
     * One row of the change table.
     *
     * The revert COMMAND is shown rather than a button: deciding to undo is the
     * person's call, and a button invites the opposite reading — that the loop is
     * entitled to make that decision.
     * @param t - dictionary lookup.
     * @returns a function turning one status entry into a row.
     */
    function makeChangeRow(t) {
      return change => {
        const name = String(change.target ?? '').split(/[\\/]/).slice(-2).join('/')
        const judged = change.verdict !== null && change.verdict !== undefined
        return h('tr', { key: change.id },
          h('td', { style: styles.td },
            h('div', null, name),
            h('div', { style: styles.forkNote }, String(change.appliedAt ?? ''))),
          h('td', { style: styles.td },
            h('div', null, String(change.hypothesis ?? '').slice(0, 140)),
            change.reason === null || change.reason === undefined
              ? null
              : h('div', { style: styles.forkNote }, String(change.reason).slice(0, 200))),
          h('td', { style: styles.td },
            h('span', { style: outcomeStyle(verdictOutcome(change.verdict)) },
              judged ? String(change.verdict) : t('changes.unjudged')),
            h('div', { style: styles.forkNote },
              change.inForce === false
                ? t('changes.reverted')
                : t('changes.revertHint', { id: String(change.id ?? '') }))))
      }
    }

    /**
     * Map a verdict onto an outcome word the existing colour helper understands.
     * @param verdict - `kept`, `reverted`, `inconclusive`, or absent.
     * @returns the outcome vocabulary member.
     */
    function verdictOutcome(verdict) {
      if (verdict === 'kept') return 'completed'
      if (verdict === 'reverted') return 'failed'
      return 'other'
    }

    /**
     * Mount the browser half.
     * @param ctx - the plugin's Cordis context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'harness-eval: dictionaries')
      const t = ctx.locale.bind(NS)

      // The Remote contribution is mounted through the public `$mount` seam,
      // which `api-remotes` uses for its own selected namespaces. The call is
      // fiber-owned, so unloading this plugin withdraws the endpoints; it
      // resolves to a disposer, and mounting installs `remote.harnessMarks`.
      const mounted = ctx.remote === undefined
        ? undefined
        : ctx.remote.$mount({ package: 'dsh-harness-eval', descriptors: REMOTE.descriptors })
      if (mounted !== undefined) mounted.catch((error) => {
        console.warn('[harness-eval] could not mount the marks namespace:', error)
      })

      /**
       * Call one marks endpoint through the mounted namespace.
       * @param name - exported endpoint method.
       * @param request - named request.
       * @returns the endpoint's result value.
       */
      const call = async (name, request) => {
        if (mounted === undefined) throw new Error('the marks service is unavailable')
        await mounted
        // The mounted namespace is published after async installation and is
        // not declared in this plugin's inject list. Reading it through the
        // context proxy throws even with optional chaining; `ctx.get` reports
        // an unmounted namespace as undefined instead.
        const namespace = ctx.get('remote.harnessMarks')
        if (namespace === undefined) throw new Error('the marks service is not mounted')
        const outcome = await namespace[name](request)
        // A mounted method answers with a RemoteResult envelope.
        if (outcome?.ok !== true) throw new Error(outcome?.error?.message ?? 'the call failed')
        return outcome.value
      }

      // The label reads through the bound translate as a thunk so it follows
      // the active locale without re-registration.
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'harness-eval',
        // After the board tab (dsh-graph registers it at 80): this view sits last.
        order: 90,
        locale: NS,
        label: () => t('view.harness'),
        // Data and callbacks only: the component never reaches for ctx.
        inject: () => ({
          createMark: request => call('create', request),
          removeMark: id => call('discard', { id }),
        }),
      }, HarnessView))
    }

    return { name: 'harness-eval', inject: ['slots', 'locale', 'remote'], apply }
  },
})
