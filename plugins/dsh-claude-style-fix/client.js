/**
 * Browser half of the dsh-claude-style sidebar gap fix.
 *
 * The skin turns the sidebar's New Session button and panel rows into compact
 * 28px rows with a 6px bottom margin, but the host sidebar still reserves a
 * 4px top margin plus an 8px grid spacer above the panel list. Between the two
 * the New Session row sits ~18px above the first panel row, three times the
 * skin's row rhythm. Zero both while the skin is active; the collapsed rail
 * already zeroes them itself, so the override is safe in both widths.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-claude-style-fix',
  factory() {
    const CSS = [
      'body[data-dsh-claude-style] [data-dsh-claude-part~="sidebar-root"] > [class*="scrollRegion"]{margin-top:0}',
      'body[data-dsh-claude-style] [data-dsh-claude-part~="sidebar-root"] > [class*="scrollRegion"] > [class*="scrollArea"]{grid-template-rows:0 max-content 2px max-content}',
    ].join('')

    return {
      inject: [],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshClaudeStyleFix = ''
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        })
      },
    }
  },
})
