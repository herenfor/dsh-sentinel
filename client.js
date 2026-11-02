// Register the browser half using DSH's client module contract.
window.__ModuleLoader__.load({
  id: 'dsh-sentinel',  // must equal the package name: the client module loader looks the bundle up by it
  factory: (require) => {
    const React = require('react')
    return {
    name: 'dsh-task-notify-browser',
    inject: ['sessions', 'slots'],
    apply(ctx) {
      ctx.effect(() => {
        let disposed = false
        const disposers = []
        const observers = new Set()
        const enabledKey = 'dsh.task-notify.browser-enabled'
        const supported = Boolean(window.isSecureContext && window.navigator?.serviceWorker &&
          typeof window.Notification === 'function' && typeof window.MessageChannel === 'function')
        let enabled = true
        try { enabled = window.localStorage?.getItem(enabledKey) !== 'false' } catch {}
        let registration, initializing, reportStatus = () => {}, busy = false, failed = false
        const workerUrl = supported ? new URL('dsh-task-notify/sw.js', window.document.baseURI) : null
        const ready = () => Boolean(enabled && !failed && registration?.active && window.Notification?.permission === 'granted')
        const publish = () => {
          if (disposed) return
          for (const observer of observers) observer()
          reportStatus()
        }
        const activateWorker = (reg) => new Promise((resolve, reject) => {
          const worker = reg.active ?? reg.installing ?? reg.waiting
          if (!worker) return reject(new Error('No notification worker'))
          const finish = (error) => {
            window.clearTimeout(timer)
            worker.removeEventListener('statechange', changed)
            error ? reject(error) : resolve(reg)
          }
          const changed = () => {
            if (worker.state === 'activated') finish()
            else if (worker.state === 'redundant') finish(new Error('Notification worker was replaced'))
          }
          const timer = window.setTimeout(() => finish(new Error('Notification worker timed out')), 5000)
          worker.addEventListener('statechange', changed)
          changed()
        })
        const initialize = () => {
          if (!supported || !enabled || window.Notification.permission !== 'granted') return Promise.resolve()
          if (initializing) return initializing
          initializing = window.navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' })
            .then(activateWorker).then((reg) => { if (!disposed) { registration = reg; failed = false } })
            .catch((error) => { failed = true; console.warn('[dsh-task-notify] Could not prepare browser notifications:', error) })
            .finally(() => { initializing = null; publish() })
          return initializing
        }
        const showNotification = (data) => new Promise((resolve) => {
          if (!ready() || disposed || Date.now() >= data.deadline) return resolve(false)
          const channel = new window.MessageChannel()
          let done = false
          const finish = (handled) => {
            if (done) return
            done = true
            window.clearTimeout(timer)
            channel.port1.close()
            resolve(handled)
          }
          const timer = window.setTimeout(() => finish(false), Math.max(1, data.deadline - Date.now()))
          channel.port1.onmessage = (event) => finish(event.data?.handled === true)
          try { registration.active.postMessage({ ...data, type: 'dsh-task-notify/show' }, [channel.port2]) }
          catch { channel.port2.close(); finish(false) }
        })

        // Settings styling follows the official guidance for plugins: no Harness UI package imports; markup and CSS
        // copied from the host's settings rows, Switch and Button, renamed under our prefix, colors only from the
        // host theme tokens (--dsw-alias-*), so light/dark switching keeps working.
        const css = [
          '.dsh-sentinel-section{display:flex;flex-direction:column;width:100%;color:var(--dsw-alias-label-primary)}',
          '.dsh-sentinel-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
          '.dsh-sentinel-row:last-child{border-bottom:none}',
          '.dsh-sentinel-title{font-size:14px;line-height:20px}',
          '.dsh-sentinel-description{margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
          '.dsh-sentinel-status{display:inline-flex;align-items:center;gap:6px;margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
          '.dsh-sentinel-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}',
          '.dsh-sentinel-dot[data-tone=ok]{background:var(--dsw-alias-state-success-primary)}',
          '.dsh-sentinel-dot[data-tone=error]{background:var(--dsw-alias-state-error-primary)}',
          '.dsh-sentinel-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}',
          '.dsh-sentinel-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}',
          '.dsh-sentinel-switch:disabled{cursor:default;opacity:.5}',
          '.dsh-sentinel-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
          '.dsh-sentinel-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}',
          '.dsh-sentinel-switch[aria-checked=false] .dsh-sentinel-thumb{background:var(--dsw-alias-switch-thumb)}',
          '.dsh-sentinel-switch[aria-checked=true] .dsh-sentinel-thumb{transform:translate(16px)}',
          '.dsh-sentinel-button{box-sizing:border-box;display:inline-flex;flex:none;align-items:center;justify-content:center;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;text-decoration:none;white-space:nowrap;cursor:pointer}',
          '.dsh-sentinel-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
          '.dsh-sentinel-button:disabled{cursor:not-allowed;opacity:.4}',
          '.dsh-sentinel-list{display:flex;flex-direction:column;gap:8px;margin:0 0 16px;padding:0;list-style:none}',
          '.dsh-sentinel-card{padding:10px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill)}',
          '.dsh-sentinel-card code,.dsh-sentinel-code{font-family:var(--ds-font-family-code);font-size:12px}',
          '.dsh-sentinel-code{display:block;margin:8px 0 0;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-settings-card-fill);color:var(--dsw-alias-label-primary);white-space:pre}',
        ].join('')
        // Same pattern as the host's own plugin CSS: one tagged <style> in <head>; ours is removed on unload so a
        // reloaded version brings its own.
        if (window.document.head && typeof window.document.createElement === 'function') {
          const style = window.document.createElement('style')
          style.dataset.plugin = 'dsh-sentinel'
          style.textContent = css
          window.document.head.appendChild(style)
          disposers.push(() => style.remove())
        }
        const h = React.createElement
        const row = (title, description, control, extra) => h('div', { className: 'dsh-sentinel-row' },
          h('div', null, h('div', { className: 'dsh-sentinel-title' }, title),
            description ? h('div', { className: 'dsh-sentinel-description' }, description) : null, extra ?? null),
          control ?? null)
        const status = (text, tone) => h('div', { className: 'dsh-sentinel-status', role: 'status' },
          h('span', { className: 'dsh-sentinel-dot', 'data-tone': tone }), text)
        const button = (text, onClick, disabled = false) => h('button', { type: 'button', className: 'dsh-sentinel-button', onClick, disabled }, text)

        function NotificationSettings() {
          const [, refresh] = React.useState(0)
          React.useEffect(() => {
            const update = () => refresh((value) => value + 1)
            observers.add(update)
            return () => observers.delete(update)
          }, [])
          const permission = window.Notification?.permission
          const [text, tone] = !supported ? ['当前页面无法使用浏览器通知，会用 Windows 通知。'] : !enabled ? ['已关闭，会用 Windows 通知。'] :
            ready() ? ['已启用', 'ok'] : permission === 'denied' ? ['通知权限被浏览器阻止，请在网站设置里允许通知。', 'error'] :
            failed ? ['暂不可用，会用 Windows 通知。', 'error'] : permission === 'granted' ? ['正在准备…'] : ['尚未允许通知，打开开关时浏览器会询问。']
          const on = supported && enabled && permission === 'granted'
          return h('div', { className: 'dsh-sentinel-section' },
            row('浏览器通知', '任务完成、等你回答或需要审批时弹出系统通知。没有打开的浏览器页面时，用 Windows 通知保底。',
              h('button', {
                type: 'button', role: 'switch', 'aria-checked': on, 'aria-label': '浏览器通知', className: 'dsh-sentinel-switch',
                disabled: busy || !supported || (!on && permission === 'denied'),
                onClick: async () => {
                  if (on) {
                    enabled = false
                    try { window.localStorage.setItem(enabledKey, 'false') } catch {}
                    return publish()
                  }
                  busy = true; publish()
                  try {
                    // Request permission directly from the human's click.
                    if (await window.Notification.requestPermission() === 'granted') {
                      enabled = true
                      try { window.localStorage.setItem(enabledKey, 'true') } catch {}
                      await initialize()
                    }
                  } catch { failed = true }
                  finally { busy = false; publish() }
                },
              }, h('span', { className: 'dsh-sentinel-thumb' })),
              status(text, tone)),
            row('测试通知', '发一条测试通知，确认能收到。', button('发送', async () => {
              busy = true; publish()
              try {
                failed = !await showNotification({ test: true, ticket: window.crypto.randomUUID(), deadline: Date.now() + 2500 })
              } finally { busy = false; publish() }
            }, busy || !ready())))
        }
        disposers.push(ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'task-notify', order: 90, label: () => '任务通知',
        }, NotificationSettings)))

        // Plugin health: reads /dsh-sentinel/health.json, served only while the optional health check is enabled.
        function HealthSettings() {
          const [state, setState] = React.useState({ loading: true })
          React.useEffect(() => {
            let alive = true
            window.fetch(new URL('dsh-sentinel/health.json', window.document.baseURI), { credentials: 'same-origin', cache: 'no-store' })
              .then(async (r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? { report: await r.json() } : { off: true }))
              .catch(() => ({ error: true }))
              .then((next) => { if (alive) setState(next) })
            return () => { alive = false }
          }, [])
          const what = 'DSH 启动完成时检查一次已启用的插件，之后插件状态有变化（热重载、安装或启停插件）时再查。'
          if (state.off) {
            return h('div', { className: 'dsh-sentinel-section' },
              row('插件健康检查', `${what}有插件没正常运行时发 Windows 通知。`, null, status('没有启用')),
              row('启用方法', '在 cordis.patch.yml 里加上下面两行，然后重启 DSH。', null,
                h('code', { className: 'dsh-sentinel-code' }, '- id: sentinel-health\n  disabled: false')))
          }
          const problems = state.report?.problems ?? []
          const summary = state.loading ? status('正在检查…') : state.error ? status('读取失败，请刷新页面再试。', 'error')
            : problems.length === 0 ? status(`已启用的 ${state.report.enabled} 个插件都在正常运行`, 'ok')
            : status(`${problems.length} 个已启用的插件没有正常运行`, 'error')
          const page = state.report ? h('a', { className: 'dsh-sentinel-button', href: new URL('dsh-sentinel/health', window.document.baseURI).href, target: '_blank', rel: 'noopener' }, '打开健康页') : null
          return h('div', { className: 'dsh-sentinel-section' },
            row('插件状态', `${what}聊天界面坏了时，健康页也能直接打开。`, page, summary),
            problems.length > 0 ? h('ul', { className: 'dsh-sentinel-list' }, problems.map((item) =>
              h('li', { key: `${item.id}|${item.kind}`, className: 'dsh-sentinel-card' },
                h('div', { className: 'dsh-sentinel-title' }, h('code', null, item.id)),
                h('div', { className: 'dsh-sentinel-description' }, item.reason)))) : null)
        }
        disposers.push(ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'sentinel-health', order: 91, label: () => '插件健康',
        }, HealthSettings)))

        if (supported) {
          const storageChanged = (event) => {
            if (event.key !== enabledKey) return
            enabled = event.newValue !== 'false'
            if (enabled) void initialize()
            publish()
          }
          window.addEventListener('storage', storageChanged)
          disposers.push(() => window.removeEventListener('storage', storageChanged))
          void initialize()
        }

        // Report notification capability and receive completion events.
        if (typeof window.EventSource === 'function') {
          const clientId = window.crypto.randomUUID()
          const eventsUrl = new URL('dsh-task-notify/events', window.document.baseURI)
          eventsUrl.searchParams.set('client', clientId)
          const clientUrl = new URL('dsh-task-notify/client', window.document.baseURI)
          const events = new window.EventSource(eventsUrl)
          const sendStatus = (extra = {}) => {
            if (disposed) return Promise.resolve()
            return window.fetch(clientUrl, {
              method: 'POST', credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                clientId,
                focused: window.document.visibilityState === 'visible' && window.document.hasFocus(),
                browserNotifications: ready(),
                ...extra,
              }),
            }).catch(() => {})
          }
          const status = () => { void sendStatus() }
          reportStatus = status
          events.onopen = status
          events.onmessage = (event) => {
            try {
              const { type, ticket, sessionId, kind, deadline } = JSON.parse(event.data)
              if (type !== 'notify' || typeof ticket !== 'string' || typeof sessionId !== 'string' ||
                  !Number.isFinite(deadline)) return
              const title = ctx.sessions.list.getSnapshot().byId?.[sessionId]?.title
              void showNotification({ ticket, title, kind, deadline })
                .then((handled) => sendStatus({ ticket, handled }))
            } catch (error) { console.warn('[dsh-task-notify] Invalid notification event:', error) }
          }
          window.addEventListener('focus', status)
          window.addEventListener('blur', status)
          window.document.addEventListener('visibilitychange', status)
          const timer = window.setInterval(status, 15000)
          disposers.push(() => {
            events.close()
            window.clearInterval(timer)
            window.removeEventListener('focus', status)
            window.removeEventListener('blur', status)
            window.document.removeEventListener('visibilitychange', status)
          })
        }
        return () => {
          disposed = true
          for (const dispose of disposers) dispose()
          observers.clear()
        }
      }, 'dsh-task-notify: browser notifications')
    },
    }
  },
})
