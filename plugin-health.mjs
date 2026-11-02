// Plugin health check (optional, off by default): list plugin entries that are enabled but not running, notify
// once when new ones appear. It checks once DSH has finished starting, then only when plugin state changes (no
// polling: plugins only fail at load, reload, install or enable time), and serve /dsh-sentinel/health (a plain page that works even when the chat UI does
// not) plus /dsh-sentinel/health.json for the settings section. It only reads the Loader; it changes nothing.
import { spawn } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mask } from './crash-report.mjs'

export const name = 'dsh-sentinel-health'
export const inject = ['webServer', 'connection']

// debounceMs: several plugins change state together during a reload; check once after they settle.
const DEFAULTS = { notify: true, settleSeconds: 5, debounceMs: 2000 }
// Cordis fiber states, as the official plugin inventory reads them.
const PENDING = 0, FAILED = 3
const prefix = '/dsh-sentinel'
const notifier = fileURLToPath(new URL('./notify-windows.sh', import.meta.url))

const entryId = (id) => String(id ?? '').replace(/^include:/, '')
const firstLine = (text) => mask(String(text ?? '').split('\n')[0]).slice(0, 300)

/** Enabled entries that are not running, with what the Loader knows about why. */
export function findProblems(entries) {
  const problems = []
  for (const entry of entries ?? []) {
    if (entry.options?.group || entry.disabled) continue
    const base = { id: entryId(entry.id ?? entry.options?.id), module: String(entry.options?.name ?? '') }
    const fiber = entry.fiber
    if (fiber === undefined) problems.push({ ...base, kind: 'not-started', reason: '没有启动（通常是导入失败），原因见 DSH 的启动日志' })
    else if (fiber.state === FAILED) problems.push({ ...base, kind: 'failed', reason: firstLine(fiber._error) || '启动时出错' })
    else if (fiber.state === PENDING) problems.push({ ...base, kind: 'waiting', reason: '在等它依赖的服务，可能那个服务没有装或没启动' })
  }
  return problems
}

const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const KIND = { failed: '启动出错', 'not-started': '没有启动', waiting: '等待依赖' }

export function healthPage(report) {
  const rows = report.problems.map((p) => `<tr><td><code>${esc(p.id)}</code><div class="muted">${esc(p.module)}</div></td><td>${esc(KIND[p.kind] ?? p.kind)}</td><td>${esc(p.reason)}</td></tr>`).join('')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>插件健康</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6b6b70;--card:#f5f5f7;--line:#dcdce0;--ok:#1f7a3a;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececf0;--muted:#a0a0a8;--card:#222226;--line:#3a3a40;--ok:#6fd38d;--bad:#ff8a80}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 48px}
table{width:100%;border-collapse:collapse;background:var(--card);border-radius:10px;overflow:hidden}
th,td{padding:9px 12px;border-top:1px solid var(--line);text-align:left;vertical-align:top}
th{border-top:0;color:var(--muted);font-weight:500}
code{font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
.muted{color:var(--muted);font-size:13px;word-break:break-all}.ok{color:var(--ok)}.bad{color:var(--bad)}
</style></head><body><main>
<h1>插件健康</h1>
<p class="muted">检查时间：${esc(new Date(report.checkedAt).toLocaleString())}　已启用的插件：${report.enabled} 个</p>
${report.problems.length === 0
    ? '<p class="ok">所有已启用的插件都在正常运行。</p>'
    : `<p class="bad">${report.problems.length} 个已启用的插件没有正常运行：</p><table><tr><th>插件</th><th>状态</th><th>原因</th></tr>${rows}</table>
<p class="muted">处理办法：按原因修正配置，或在 <code>cordis.patch.yml</code> 里给它写 <code>disabled: true</code> 先停用，再重启 DSH。</p>`}
<p class="muted">只看服务端（DSH 主程序）里的插件。浏览器端没加载上的，DSH 自己会显示 Failed to load plugins。dsh-sentinel 插件健康检查</p>
</main></body></html>
`
}

export function apply(ctx, config) {
  const c = { ...DEFAULTS, ...config }
  const logDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'logs', 'dsh-sentinel')
  const log = (entry) => { void mkdir(logDir, { recursive: true, mode: 0o700 }).then(() => appendFile(join(logDir, 'health.log'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 })).catch(() => {}) }

  const check = () => {
    const entries = [...(ctx.loader?.entries?.() ?? [])]
    return { checkedAt: Date.now(), enabled: entries.filter((e) => !e.options?.group && !e.disabled).length, problems: findProblems(entries) }
  }

  const authorized = (request, response) => {
    const admission = ctx.connection.admit(request)
    if (!('rejection' in admission)) return true
    response.writeHead(admission.rejection, { 'content-type': 'application/json' })
    response.end('{"error":"Unauthorized"}')
    return false
  }
  for (const [path, type, body] of [
    ['/health', 'text/html; charset=utf-8', (r) => healthPage(r)],
    ['/health.json', 'application/json', (r) => JSON.stringify(r)],
  ]) {
    const dispose = ctx.webServer.register({
      kind: 'exact', path: prefix + path,
      handler: (request, response) => {
        if (!authorized(request, response)) return
        response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
        response.end(body(check()))
      },
    })
    ctx.effect(() => dispose, `dsh-sentinel health route ${path}`)
  }

  // Notify only about problems not seen before, so a broken plugin does not notify every minute.
  const seen = new Set()
  const scan = () => {
    let report
    try { report = check() } catch (error) { log({ event: 'check-failed', error: String(error).slice(0, 300) }); return }
    const fresh = report.problems.filter((p) => !seen.has(`${p.id}|${p.kind}`))
    for (const p of report.problems) seen.add(`${p.id}|${p.kind}`)
    if (fresh.length === 0) return
    log({ event: 'problems', problems: fresh })
    ctx.logger.warn(`dsh-sentinel: ${fresh.length} plugin(s) not running: ${fresh.map((p) => p.id).join(', ')} (see ${prefix}/health)`)
    if (c.notify && process.platform === 'linux') {
      try { spawn('bash', [notifier, 'plugins'], { detached: true, stdio: 'ignore' }).unref() } catch {}
    }
  }
  let timer, started = false, stopped = false
  const schedule = (ms) => { if (stopped) return; clearTimeout(timer); timer = setTimeout(scan, ms) }
  ;(async () => {
    try { await ctx.loader?.await?.() } catch {}
    started = true
    schedule(c.settleSeconds * 1000)
  })()
  // Cordis emits internal/status on every plugin state change (including a failure), and loader/entry-init when
  // a reload or install adds an entry; an entry that fails on import emits nothing else.
  for (const event of ['internal/status', 'loader/entry-init']) {
    try { ctx.on(event, () => { if (started) schedule(c.debounceMs) }) } catch {}
  }
  ctx.effect(() => () => { stopped = true; clearTimeout(timer) }, 'dsh-sentinel health scan')
}
