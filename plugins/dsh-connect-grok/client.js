/**
 * Client half of `dsh-connect-grok`: one settings section for signing in with
 * an xAI account and reading the SuperGrok allowance it consumes.
 *
 * The Host owns every credential and every upstream call; this file only talks
 * to it over the plugin's own web routes and renders what comes back. No
 * token, code or password ever crosses into the page.
 *
 * @module dsh-connect-grok/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-connect-grok',
  factory: (require) => {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement

    /** Base path of the Host routes this card calls. */
    var ROUTE_PREFIX = '/plugins/dsh-connect-grok'

    /** How often a pending device-code login is polled. */
    var LOGIN_POLL_MS = 2000

    var en = {
      title: 'Grok (xAI)',
      subtitle: 'Use your SuperGrok subscription quota to run Grok models in DSH.',
      loading: 'Reading your account…',
      signedOutTitle: 'Not signed in',
      signedOutBody: 'Sign in with the xAI account that holds your SuperGrok subscription. DSH runs the agent loop; this only routes model requests through your quota.',
      noVault: 'This profile mounts no credential store, so a sign-in cannot be kept. Sign in from the Web or Desktop profile.',
      signIn: 'Sign in with SuperGrok',
      signingIn: 'Starting…',
      deviceTitle: 'Finish signing in',
      deviceBody: 'Open this page and enter the code:',
      copy: 'Copy',
      copied: 'Copied',
      open: 'Open',
      cancel: 'Cancel',
      waiting: 'Waiting for confirmation…',
      expired: 'This sign-in expired. Start again.',
      failed: 'Sign-in failed',
      cancelled: 'Sign-in cancelled',
      authorized: 'Signed in',
      signOut: 'Sign out',
      refresh: 'Refresh',
      plan: 'Plan',
      usedThisPeriod: 'Used this period',
      resets: 'Resets',
      noReset: 'Upstream did not state a reset time',
      weekly: 'Weekly',
      monthly: 'Monthly',
      period: 'Period',
      onDemand: 'On-demand',
      prepaid: 'Prepaid credits',
      unavailableTitle: 'Quota unavailable',
      unavailableBody: 'Signed in, but the subscription service did not answer. Grok models still work.',
      rateLimit: 'Request limit',
      ofTokens: 'tokens',
      remaining: 'remaining',
      errorTitle: 'Something went wrong',
      unknownPeriod: 'Current period',
      expiresSoon: 'The stored token is close to expiry; the next request refreshes it automatically.',
      signedOutNotice: 'Signed out.',
      modelsTitle: 'Models',
      modelsHint: 'Grok only',
      modelsSave: 'Save',
      modelsReset: 'Discard',
      modelsNeedOne: 'Keep at least one model enabled.',
      contextHint: 'context',
      effortsLabel: 'Reasoning',
      effortsNone: 'off',
      effortsHint: 'Levels shown here are the only ones offered in the chat composer. Everything else stays with DSH.',
    }

    var zh = {
      title: 'Grok (xAI)',
      subtitle: '用你的 SuperGrok 订阅额度在 DSH 里运行 Grok 模型。',
      loading: '正在读取账号…',
      signedOutTitle: '未登录',
      signedOutBody: '用持有 SuperGrok 订阅的 xAI 账号登录。Agent Loop 仍由 DSH 自己跑，这里只负责把模型请求走你的额度。',
      noVault: '当前 profile 没有挂载凭据存储，登录结果无处保存。请从 Web 或 Desktop profile 登录。',
      signIn: '用 SuperGrok 登录',
      signingIn: '正在启动…',
      deviceTitle: '完成登录',
      deviceBody: '在浏览器打开下面的页面并输入代码：',
      copy: '复制',
      copied: '已复制',
      open: '打开',
      cancel: '取消',
      waiting: '等待确认…',
      expired: '本次登录已过期，请重新开始。',
      failed: '登录失败',
      cancelled: '已取消登录',
      authorized: '已登录',
      signOut: '退出登录',
      refresh: '刷新',
      plan: '订阅档位',
      usedThisPeriod: '本周期已用',
      resets: '重置时间',
      noReset: '上游未给出重置时间',
      weekly: '每周',
      monthly: '每月',
      period: '周期',
      onDemand: '按需付费',
      prepaid: '预付额度',
      unavailableTitle: '额度不可用',
      unavailableBody: '已登录，但订阅服务没有响应。Grok 模型本身仍可使用。',
      rateLimit: '请求限额',
      ofTokens: 'tokens',
      remaining: '剩余',
      errorTitle: '出错了',
      unknownPeriod: '当前周期',
      expiresSoon: '已保存的令牌即将过期，下一次请求会自动刷新。',
      signedOutNotice: '已退出登录。',
      modelsTitle: '模型',
      modelsHint: '仅 Grok',
      modelsSave: '保存',
      modelsReset: '放弃改动',
      modelsNeedOne: '至少要保留一个模型。',
      contextHint: '上下文',
      effortsLabel: '推理',
      effortsNone: '不推理',
      effortsHint: '这里勾选的档位就是聊天框里可选的推理强度，其余交给 DSH 自己决定。',
    }

    // -----------------------------------------------------------------------
    // Styles
    //
    // Inline objects keyed by a small palette resolved from the host theme, so
    // the card reads correctly in both light and dark without shipping a
    // stylesheet of its own.
    // -----------------------------------------------------------------------

    /** Theme-aware surfaces. Values are CSS custom properties where the host supplies one. */
    var S = {
      // `paddingTop` pushes the whole section down, away from the dialog's own
      // top edge; the gap values are the 1:1 rhythm between title, account line
      // and the quota/inventory blocks.
      root: { padding: '16px 0 4px', display: 'flex', flexDirection: 'column', gap: 14 },
      head: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
      title: { fontSize: 14, fontWeight: 600 },
      subtitle: { fontSize: 12, opacity: 0.65 },
      spacer: { marginLeft: 'auto' },
      body: { fontSize: 12, lineHeight: 1.6, opacity: 0.8, margin: 0 },
      /** The one-line account identity under the header. */
      account: { fontSize: 12, opacity: 0.65, margin: 0 },
      card: {
        border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.25))',
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      label: { fontSize: 12, opacity: 0.65, minWidth: 72 },
      value: { fontSize: 12, fontWeight: 500 },
      /** One model line: checkbox, name, capacities. */
      modelRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 0',
        cursor: 'pointer',
        userSelect: 'none',
      },
      modelName: { fontSize: 12, fontWeight: 500, minWidth: 78 },
      modelMeta: { fontSize: 11, opacity: 0.55, marginLeft: 'auto' },
      sectionTitle: { fontSize: 12, fontWeight: 600, margin: 0 },
      /** One model plus its reasoning chips. */
      modelBlock: { display: 'flex', flexDirection: 'column', gap: 2 },
      chipRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingLeft: 24, paddingBottom: 4 },
      chipLabel: { fontSize: 11, opacity: 0.55, marginRight: 2 },
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))',
        cursor: 'pointer',
        userSelect: 'none',
      },
      chipOn: {
        borderColor: 'var(--dsw-alias-fill-accent, #247bbf)',
        background: 'var(--dsw-alias-fill-secondary, rgba(36,123,191,0.12))',
      },
      button: {
        font: 'inherit',
        fontSize: 12,
        padding: '4px 12px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
      primary: {
        font: 'inherit',
        fontSize: 12,
        padding: '6px 14px',
        borderRadius: 6,
        border: '1px solid transparent',
        background: 'var(--dsw-alias-fill-accent, #247bbf)',
        color: '#fff',
        cursor: 'pointer',
        alignSelf: 'flex-start',
      },
      code: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 18,
        letterSpacing: 2,
        fontWeight: 600,
        padding: '6px 10px',
        borderRadius: 6,
        background: 'var(--dsw-alias-fill-secondary, rgba(128,128,128,0.12))',
      },
      link: { fontSize: 12, color: 'var(--dsw-alias-text-link, #247bbf)', wordBreak: 'break-all' },
      bar: {
        height: 6,
        borderRadius: 3,
        background: 'var(--dsw-alias-fill-secondary, rgba(128,128,128,0.18))',
        overflow: 'hidden',
      },
      barFill: { height: 6, borderRadius: 3, background: 'var(--dsw-alias-fill-accent, #247bbf)' },
      muted: { fontSize: 12, opacity: 0.6 },
      warn: { fontSize: 12, color: 'var(--dsw-alias-text-warning, #b7791f)' },
      error: { fontSize: 12, color: 'var(--dsw-alias-text-danger, #c0392b)' },
      notice: {
        fontSize: 12,
        padding: '8px 10px',
        borderRadius: 6,
        background: 'var(--dsw-alias-fill-secondary, rgba(128,128,128,0.12))',
      },
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Call one Host endpoint.
     *
     * `transport` is a plain function, never the plugin context: a Cordis
     * context is a service proxy that refuses properties the plugin did not
     * declare, so touching it during render throws and takes the whole card
     * down with it — the registry then retires the entry, which is exactly how
     * the settings page ended up showing a nav tab with an empty body. The Host
     * is reached once, while `apply` runs, and only that closure crosses into
     * the component's props.
     * @param transport - bound RPC caller, or undefined when the page has none.
     * @param method - endpoint name.
     * @param payload - request payload.
     * @returns the RPC result, or a synthetic failure when no transport exists.
     */
    function call(transport, method, payload) {
      if (typeof transport !== 'function') {
        return Promise.resolve({ ok: false, error: { code: 'no-connection', message: 'no connection' } })
      }
      return transport(method, payload || {})
    }

    /** Format an epoch-ms instant in the viewer's locale, or null when absent. */
    function formatWhen(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
      try {
        return new Date(ms).toLocaleString()
      } catch (e) {
        return null
      }
    }

    /** Human period name. */
    function periodName(t, period) {
      if (period === 'weekly') return t('weekly')
      if (period === 'monthly') return t('monthly')
      return t('unknownPeriod')
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /** A labelled line inside the quota card. */
    function Row(props) {
      return h('div', { style: S.row },
        h('span', { style: S.label }, props.label),
        h('span', { style: S.value }, props.value),
      )
    }

    /**
     * The signed-in quota block.
     *
     * `usedPercent` is rendered as a *used* gauge with no invented countdown:
     * the only reset instant shown is the one the upstream stated, and when it
     * states none the card says so rather than counting down to a guess.
     */
    function QuotaView(props) {
      var t = props.t
      var view = props.view
      var quota = view.quota
      var rows = []

      if (view.plan) rows.push(h(Row, { key: 'plan', label: t('plan'), value: view.plan }))

      if (quota) {
        var pct = typeof quota.usedPercent === 'number'
          ? Math.max(0, Math.min(100, quota.usedPercent))
          : null
        if (pct !== null) {
          rows.push(h('div', { key: 'gauge', style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h('div', { style: S.row },
              h('span', { style: S.label }, t('usedThisPeriod')),
              h('span', { style: S.value }, pct.toFixed(1) + '%'),
              h('span', { style: Object.assign({}, S.muted, S.spacer) }, periodName(t, quota.period)),
            ),
            h('div', { style: S.bar }, h('div', { style: Object.assign({}, S.barFill, { width: pct + '%' }) })),
          ))
        }
        var when = formatWhen(quota.resetsAtMs)
        rows.push(h(Row, { key: 'reset', label: t('resets'), value: when || t('noReset') }))
        if (quota.onDemandUsed !== null || quota.onDemandCap !== null) {
          rows.push(h(Row, {
            key: 'ondemand',
            label: t('onDemand'),
            value: (quota.onDemandUsed === null ? '?' : String(quota.onDemandUsed))
              + ' / ' + (quota.onDemandCap === null ? '?' : String(quota.onDemandCap)),
          }))
        }
        if (typeof quota.prepaidBalance === 'number' && quota.prepaidBalance !== 0) {
          rows.push(h(Row, { key: 'prepaid', label: t('prepaid'), value: String(quota.prepaidBalance) }))
        }
      }

      if (view.limits && typeof view.limits.remainingTokens === 'number' && typeof view.limits.limitTokens === 'number') {
        rows.push(h(Row, {
          key: 'ratelimit',
          label: t('rateLimit'),
          value: view.limits.remainingTokens.toLocaleString() + ' / '
            + view.limits.limitTokens.toLocaleString() + ' ' + t('ofTokens'),
        }))
      }

      if (rows.length === 0) {
        rows.push(h('p', { key: 'none', style: S.muted }, t('noReset')))
      }

      return h('div', { style: S.card }, rows)
    }

    /**
     * The device-code panel: a URL, a code, and a copy button.
     *
     * Both are rendered from the Host's own notices rather than assembled here,
     * so the page never has to know the shape of a device-code response.
     */
    function DeviceCodeView(props) {
      var t = props.t
      var notice = props.notice
      var s = React.useState(false)
      var copied = s[0]
      var setCopied = s[1]

      React.useEffect(function () {
        if (!copied) return undefined
        var timer = setTimeout(function () { setCopied(false) }, 1800)
        return function () { clearTimeout(timer) }
      }, [copied])

      function copy() {
        try {
          Promise.resolve(navigator.clipboard.writeText(notice.code || '')).then(
            function () { setCopied(true) },
            function () { setCopied(false) },
          )
        } catch (e) { /* clipboard is best-effort */ }
      }

      return h('div', { style: S.card },
        h('div', { style: S.title }, t('deviceTitle')),
        h('p', { style: S.body }, t('deviceBody')),
        notice.url
          ? h('div', { style: S.row },
            h('a', { href: notice.url, target: '_blank', rel: 'noreferrer noopener', style: S.link }, notice.url),
          )
          : null,
        notice.code
          ? h('div', { style: S.row },
            h('span', { style: S.code }, notice.code),
            h('button', { type: 'button', style: S.button, onClick: copy }, copied ? t('copied') : t('copy')),
          )
          : null,
        h('p', { style: S.muted }, t('waiting')),
      )
    }

    /**
     * The Grok model inventory.
     *
     * This is a manager for Grok alone: it lists exactly the models this plugin
     * knows and offers no way to add a provider. Toggling a row saves the whole
     * selection, because the Host writes it as the route's complete `models`
     * list — a norrowed list is what removes a model from the picker.
     *
     * Edits are held locally until saved, so an accidental click is observable
     * and reversible before it reaches the live route.
     */
    function ModelPicker(props) {
      var t = props.t
      var transport = props.transport
      var selection = props.selection
      var onSaved = props.onSaved
      var onError = props.onError

      var draftState = React.useState(null)
      var draft = draftState[0]
      var setDraft = draftState[1]
      var effortsState = React.useState(null)
      var draftEfforts = effortsState[0]
      var setDraftEfforts = effortsState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]

      // Fetch the inventory once, when the card has a signed-in account.
      React.useEffect(function () {
        var alive = true
        if (selection !== null && selection !== undefined) return undefined
        call(transport, 'models').then(function (result) {
          if (!alive) return
          if (result && result.ok) onSaved(result.value)
        }).catch(function () { /* the picker simply stays empty */ })
        return function () { alive = false }
      }, [])

      var models = selection && Array.isArray(selection.models) ? selection.models : []
      if (models.length === 0) return null

      var enabled = draft !== null ? draft : (selection.enabledModelIds || [])
      var dirty = draft !== null

      function toggle(id) {
        var next = enabled.indexOf(id) >= 0
          ? enabled.filter(function (entry) { return entry !== id })
          : enabled.concat([id])
        setDraft(next)
      }

      /** Turn one reasoning level on or off for one model. */
      function toggleEffort(id, level) {
        var base = draftEfforts !== null && Object.prototype.hasOwnProperty.call(draftEfforts, id)
          ? draftEfforts[id]
          : currentEffortsOf(models, id)
        var next = base.indexOf(level) >= 0
          ? base.filter(function (entry) { return entry !== level })
          : base.concat([level])
        var merged = Object.assign({}, draftEfforts === null ? {} : draftEfforts)
        merged[id] = next
        setDraftEfforts(merged)
      }

      /** Drop every local edit, returning to what the route currently serves. */
      function discard() {
        setDraft(null)
        setDraftEfforts(null)
      }

      /** Every level this model currently declares, as the starting point of an edit. */
      function currentEffortsOf(list, id) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].id !== id) continue
          var declared = list[i].declaredEfforts
          if (declared === null || declared === undefined) return (list[i].reasonings || []).slice()
          return declared.slice()
        }
        return []
      }

      function save() {
        if (enabled.length === 0) {
          onError(t('modelsNeedOne'))
          return
        }
        setBusy(true)
        var payload = { enabledModelIds: enabled }
        if (draftEfforts !== null) payload.reasoningEffortsByModel = draftEfforts
        call(transport, 'setModels', payload).then(function (result) {
          setBusy(false)
          if (result && result.ok) {
            setDraft(null)
            setDraftEfforts(null)
            onSaved(result.value)
          } else {
            onError(result && result.error ? result.error.message : 'failed')
          }
        }).catch(function () {
          setBusy(false)
          onError('failed')
        })
      }

      var rows = models.map(function (model) {
        var on = enabled.indexOf(model.id) >= 0
        var declared = draftEfforts !== null && Object.prototype.hasOwnProperty.call(draftEfforts, model.id)
          ? draftEfforts[model.id]
          : (model.declaredEfforts !== null && model.declaredEfforts !== undefined
            ? model.declaredEfforts
            : (model.reasonings || []))
        // Chips are shown only for an enabled model: offering a reasoning
        // ladder for a model the route does not serve would be a dead control.
        return h('div', { key: model.id, style: S.modelBlock },
          h('label', { style: S.modelRow },
            h('input', {
              type: 'checkbox',
              checked: on,
              onChange: function () { toggle(model.id) },
              disabled: busy,
            }),
            h('span', { style: S.modelName }, model.name),
            h('span', { style: S.modelMeta },
              Math.round(model.contextWindow / 1000) + 'K ' + t('contextHint')),
          ),
          on
            ? h('div', { style: S.chipRow },
              h('span', { style: S.chipLabel }, t('effortsLabel')),
              (model.reasonings || []).map(function (level) {
                var picked = declared.indexOf(level) >= 0
                return h('label', {
                  key: level,
                  style: Object.assign({}, S.chip, picked ? S.chipOn : null),
                },
                  h('input', {
                    type: 'checkbox',
                    checked: picked,
                    disabled: busy,
                    onChange: function () { toggleEffort(model.id, level) },
                    style: { marginRight: 5 },
                  }),
                  level,
                )
              }),
              declared.length === 0
                ? h('span', { style: S.muted }, t('effortsNone'))
                : null,
            )
            : null,
        )
      })

      return h('div', { style: S.card },
        h('div', { style: S.row },
          h('p', { style: S.sectionTitle }, t('modelsTitle')),
          h('span', { style: Object.assign({}, S.muted, S.spacer) }, t('modelsHint')),
        ),
        rows,
        dirty
          ? h('div', { style: S.row },
            h('button', { type: 'button', style: S.primary, onClick: save, disabled: busy }, t('modelsSave')),
            h('button', { type: 'button', style: S.button, onClick: discard, disabled: busy }, t('modelsReset')),
          )
          : null,
        h('p', { style: S.muted }, t('effortsHint')),
      )
    }

    /** The card. */
    function GrokCard(props) {
      var transport = props.transport
      var t = props.t

      var v = React.useState(null)
      var view = v[0]
      var setView = v[1]

      var b = React.useState(false)
      var busy = b[0]
      var setBusy = b[1]

      var l = React.useState(null)
      var login = l[0]
      var setLogin = l[1]

      var m = React.useState(null)
      var models = m[0]
      var setModels = m[1]

      var e = React.useState(null)
      var error = e[0]
      var setError = e[1]

      var r = React.useState(0)
      var rev = r[0]
      var setRev = r[1]

      // Initial read plus every manual refresh.
      React.useEffect(function () {
        var alive = true
        setBusy(true)
        call(transport, 'read').then(function (result) {
          if (!alive) return
          if (result && result.ok) {
            setView(result.value)
            setError(null)
          } else {
            setError(result && result.error ? result.error.message : 'failed')
          }
        }).catch(function () {
          if (alive) setError('failed')
        }).then(function () {
          if (alive) setBusy(false)
        })
        return function () { alive = false }
      }, [rev])

      // Poll one pending login until it reaches a terminal status.
      React.useEffect(function () {
        if (!login || login.status !== 'pending') return undefined
        var alive = true
        var timer = setInterval(function () {
          call(transport, 'loginPoll', { loginId: login.loginId }).then(function (result) {
            if (!alive) return
            if (!result || !result.ok) {
              setLogin({ status: 'failed', error: result && result.error ? result.error.message : 'failed', notices: [] })
              return
            }
            var value = result.value
            setLogin(value)
            if (value.status === 'authorized') {
              clearInterval(timer)
              setRev(function (n) { return n + 1 })
            } else if (value.status !== 'pending') {
              clearInterval(timer)
            }
          }).catch(function () {
            if (alive) setLogin({ status: 'failed', error: 'poll failed', notices: [] })
          })
        }, LOGIN_POLL_MS)
        return function () {
          alive = false
          clearInterval(timer)
        }
      }, [login && login.loginId, login && login.status])

      function startLogin() {
        setError(null)
        setBusy(true)
        call(transport, 'loginStart').then(function (result) {
          setBusy(false)
          if (!result || !result.ok) {
            setError(result && result.error ? result.error.message : 'failed')
            return
          }
          setLogin({ status: 'pending', loginId: result.value.loginId, notices: result.value.notices || [] })
        }).catch(function () {
          setBusy(false)
          setError('failed')
        })
      }

      function signOut() {
        setBusy(true)
        call(transport, 'signOut').then(function () {
          setBusy(false)
          setLogin(null)
          setRev(function (n) { return n + 1 })
        }).catch(function () { setBusy(false) })
      }

      var status = view ? view.state : 'loading'

      var head = h('div', { style: S.head },
        h('span', { style: S.title }, t('title')),
        h('span', { style: S.subtitle }, t('subtitle')),
        h('span', { style: S.spacer }),
        status === 'ready' || status === 'unavailable'
          ? h('button', { type: 'button', style: S.button, onClick: function () { setRev(function (n) { return n + 1 }) }, disabled: busy }, t('refresh'))
          : null,
        status === 'ready' || status === 'unavailable'
          ? h('button', { type: 'button', style: S.button, onClick: signOut, disabled: busy }, t('signOut'))
          : null,
      )

      var body = []

      if (error) body.push(h('p', { key: 'err', style: S.error }, t('errorTitle') + ': ' + error))

      if (status === 'loading') {
        body.push(h('p', { key: 'loading', style: S.muted }, t('loading')))
      } else if (login && login.status === 'pending') {
        var latest = (login.notices || []).filter(function (n) { return n.code || n.url })
        var notice = latest.length > 0 ? latest[latest.length - 1] : null
        body.push(notice
          ? h(DeviceCodeView, { key: 'device', t: t, notice: notice })
          : h('p', { key: 'starting', style: S.muted }, t('signingIn')))
      } else if (login && login.status === 'authorized') {
        body.push(h('p', { key: 'ok', style: S.notice }, t('authorized')))
      } else if (login && login.status === 'cancelled') {
        body.push(h('p', { key: 'cancelled', style: S.muted }, t('cancelled')))
      } else if (login && login.status === 'failed') {
        body.push(h('p', { key: 'failed', style: S.error }, t('failed') + (login.error ? ': ' + login.error : '')))
      } else if (login && login.status === 'expired') {
        body.push(h('p', { key: 'expired', style: S.warn }, t('expired')))
      }

      if (status === 'no-vault') {
        body.push(h('p', { key: 'vault', style: S.warn }, t('noVault')))
      } else if (status === 'signed-out') {
        body.push(h('div', { key: 'out', style: S.card },
          h('div', { style: S.title }, t('signedOutTitle')),
          h('p', { style: S.body }, t('signedOutBody')),
          h('button', { type: 'button', style: S.primary, onClick: startLogin, disabled: busy }, t('signIn')),
        ))
      } else if (status === 'unavailable') {
        body.push(h('div', { key: 'unavail', style: S.card },
          h('div', { style: S.title }, t('unavailableTitle')),
          h('p', { style: S.body }, t('unavailableBody')),
          view.email ? h(Row, { label: 'Email', value: view.email }) : null,
        ))
      } else if (status === 'ready') {
        if (view.email) body.push(h('p', { key: 'email', style: S.account }, view.email))
        body.push(h(QuotaView, { key: 'quota', t: t, view: view }))
        body.push(h(ModelPicker, {
          key: 'models',
          t: t,
          transport: transport,
          selection: models,
          onSaved: setModels,
          onError: setError,
        }))
      }

      return h('div', { style: S.root }, head, body)
    }

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    module.exports.inject = ['slots', 'locale']
    module.exports.apply = function apply(ctx) {
      try {
        ctx.locale.register('dsh-connect-grok', { en: en, zh: zh })
      } catch (err) {
        // A locale collision must not stop the card from registering.
      }
      var t = ctx.locale.bind('dsh-connect-grok')

      // One plain function, bound here and closed over — never the plugin
      // context. A Cordis context is a service proxy that refuses properties
      // the plugin did not declare, so a context reaching render throws and the
      // registry retires the slot entry to a blank page.
      //
      // The Host is reached over the plugin's own web route, not over
      // `ctx.connection`: that service exists on the Host half only, so asking
      // the page for it yields nothing at all. The browser carries its own
      // cookie, which is what both shipped connectors rely on.
      var transport = function (method, payload) {
        return fetch(ROUTE_PREFIX + '/' + method, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
          credentials: 'same-origin',
        }).then(function (response) {
          if (!response.ok) {
            return { ok: false, error: { code: 'http/' + response.status, message: 'HTTP ' + response.status } }
          }
          return response.json()
        }).then(function (body) {
          // A Host that answered with something unexpected still yields a
          // shaped failure, so the card renders an explanation rather than
          // throwing on `body.ok`.
          if (body && typeof body === 'object' && typeof body.ok === 'boolean') return body
          return { ok: false, error: { code: 'grok/bad-response', message: 'unexpected reply' } }
        }).catch(function (err) {
          return { ok: false, error: { code: 'grok/transport', message: (err && err.message) || 'transport failed' } }
        })
      }

      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-connect-grok',
          order: 6,
          label: function () { return t('title') },
          locale: 'dsh-connect-grok',
          inject: function () { return { transport: transport, t: t } },
        }, GrokCard)
      })
    }

    return module.exports
  },
})
