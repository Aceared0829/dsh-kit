window.__ModuleLoader__.load({
  id: '@local/dsh-chatgpt-account',
  factory: (require) => {
    var module = { exports: {} };
    var React = require('react');
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    var Button = primitives.Button;
    var CHANNEL = '/dsh-chatgpt';

    var en = { title: 'ChatGPT account', signedOut: 'Sign in to ChatGPT from Model settings to see usage.', refresh: 'Refresh', signOut: 'Sign out', unavailable: 'Usage unavailable', used: 'used', reset: 'Resets', credits: 'Credits' };
    var zh = { title: 'ChatGPT 账号', signedOut: '请在模型设置中登录 ChatGPT 后查看额度。', refresh: '刷新额度', signOut: '退出登录', unavailable: '额度获取失败', used: '已用', reset: '重置', credits: '余额' };

    function call(ctx, method) {
      var c = ctx.connection;
      if (!c || !c.rpc || typeof c.rpc.call !== 'function') return Promise.resolve({ ok: false, error: { code: 'no-connection' } });
      return c.rpc.call(CHANNEL, method, {});
    }

    function Card(props) {
      var ctx = props.ctx;
      var t = props.t;
      var s1 = React.useState(null);
      var view = s1[0], setView = s1[1];
      var s2 = React.useState(false);
      var busy = s2[0], setBusy = s2[1];
      var s3 = React.useState(0);
      var rev = s3[0], setRev = s3[1];
      React.useEffect(function () {
        var alive = true;
        setBusy(true);
        call(ctx, 'read').then(function (r) {
          if (!alive) return;
          setView(r && r.ok ? r.value : { status: 'unavailable' });
        }).catch(function () {
          if (alive) setView({ status: 'unavailable' });
        }).then(function () {
          if (alive) setBusy(false);
        });
        return function () { alive = false; };
      }, [rev]);

      var status = view ? view.status : 'loading';
      function refresh() { setRev(rev + 1); }
      function logout() {
        call(ctx, 'signOut').then(function () { setRev(rev + 1); });
      }

      var head = React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        React.createElement('strong', null, t.title),
        React.createElement('button', { type: 'button', onClick: refresh, disabled: busy, style: { marginLeft: 'auto' } }, t.refresh),
        status === 'ready' ? React.createElement('button', { type: 'button', onClick: logout }, t.signOut) : null
      );

      if (status === 'loading') return React.createElement('div', { style: { padding: 12 } }, head);

      if (status === 'signed-out') return React.createElement('div', { style: { padding: 12 } }, head, React.createElement('p', { style: { color: '#888', margin: '8px 0 0' } }, t.signedOut));
      if (status !== 'ready') return React.createElement('div', { style: { padding: 12 } }, head, React.createElement('p', { style: { color: '#c96', margin: '8px 0 0' } }, t.unavailable));

      var rows = (view.quotas || []).map(function (q) {
        var w = q.primary || q.secondary;
        if (!w) return null;
        var pct = Math.max(0, Math.min(100, 100 - (w.usedPercent || 0)));
        var when = w.resetsAt ? new Date(w.resetsAt * 1000).toLocaleString() : '';
        return React.createElement('div', { key: q.name, style: { marginTop: 10 } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12 } },
            React.createElement('span', null, q.name + ' ' + pct.toFixed(0) + '%'),
            React.createElement('span', { style: { color: '#888' } }, when ? (t.reset + ' ' + when) : '')
          ),
          React.createElement('div', { style: { height: 6, background: '#eee', borderRadius: 3, marginTop: 4 } },
            React.createElement('div', { style: { width: pct + '%', height: 6, background: '#3b82f6', borderRadius: 3 } })
          )
        );
      });

      var info = [];
      if (view.email) info.push(view.email);
      if (view.plan) info.push(view.plan);
      if (view.credits) info.push(t.credits + ': ' + (view.credits.unlimited ? 'unlimited' : String(view.credits.balance)));
      return React.createElement('div', { style: { padding: 12 } }, head,
        info.length ? React.createElement('p', { style: { color: '#666', margin: '6px 0 0', fontSize: 12 } }, info.join(' | ')) : null,
        rows
      );
    }

    module.exports.inject = ['slots', 'locale'];
    module.exports.apply = function apply(ctx) {
      try { ctx.locale.register('chatgpt-account', { en: en, zh: zh }); } catch (e) { }
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section', id: 'chatgpt-account', order: 5,
          label: function () { return ctx.locale.bind('chatgpt-account')('title'); },
          locale: 'chatgpt-account',
          inject: function () { return { ctx: ctx, t: ctx.locale.bind('chatgpt-account') }; }
        }, Card);
      });
    };
    return module.exports;
  }
});
