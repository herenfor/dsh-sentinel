import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { apply, findProblems, healthPage } from '../plugin-health.mjs'

// Temporary directories are removed once this file's tests finish.
const tempDirs = []
after(() => { for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true }) })
const tempDir = (prefix) => { const dir = mkdtempSync(join(tmpdir(), prefix)); tempDirs.push(dir); return dir }

const row = (id, fiber, extra = {}) => ({ id: `include:${id}`, options: { id, name: `pkg-${id}` }, fiber, ...extra })

test('only enabled, non-group entries that are not running are problems, each with a reason', () => {
  const problems = findProblems([
    row('ok', { state: 2 }),
    row('off', undefined, { disabled: true }),
    { id: 'grp', options: { group: true } },
    row('boom', { state: 3, _error: new Error('tool "x" is already registered\n    at stack') }),
    row('secret', { state: 3, _error: new Error('bad api_key=abc123') }),
    row('missing', undefined),
    row('waits', { state: 0 }),
  ])
  assert.deepEqual(problems.map((p) => [p.id, p.kind]), [['boom', 'failed'], ['secret', 'failed'], ['missing', 'not-started'], ['waits', 'waiting']])
  assert.equal(problems[0].reason, 'Error: tool "x" is already registered')
  assert.equal(problems[1].reason, 'Error: bad api_key=***')
  assert.match(problems[2].reason, /启动日志/)
  assert.equal(problems[0].module, 'pkg-boom')
})

test('the health page lists problems, or says all is well', () => {
  const bad = healthPage({ checkedAt: 0, enabled: 3, problems: [{ id: 'boom', module: 'm', kind: 'failed', reason: '<x>' }] })
  assert.match(bad, /1 个已启用的插件没有正常运行/)
  assert.match(bad, /&lt;x&gt;/)
  assert.match(healthPage({ checkedAt: 0, enabled: 3, problems: [] }), /都在正常运行/)
})

function fakeCtx(entries, admitted = true) {
  const routes = new Map(), effects = [], warnings = [], listeners = new Map()
  return {
    routes, effects, warnings, listeners,
    on: (event, fn) => listeners.set(event, fn),
    loader: { await: async () => {}, entries: () => entries },
    connection: { admit: () => (admitted ? { peer: {} } : { rejection: 401 }) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => routes.delete(route.path) } },
    logger: { warn: (m) => warnings.push(m) },
    effect: (fn) => effects.push(fn()),
  }
}
const call = (handler) => {
  const res = { status: 0, headers: {}, body: '' }
  handler({}, { writeHead(s, h) { res.status = s; res.headers = h }, end(b) { res.body = b } })
  return res
}

test('routes need DSH sign-in; checks once after start, then only when plugin state changes', async () => {
  process.env.DSH_HOME = tempDir('sentinel-health-')
  const entries = [row('ok', { state: 2 }), row('boom', { state: 3, _error: 'Error: x' })]
  const ctx = fakeCtx(entries)
  apply(ctx, { notify: false, settleSeconds: 0.01, debounceMs: 10 })
  const json = call(ctx.routes.get('/dsh-sentinel/health.json'))
  assert.equal(json.status, 200)
  assert.deepEqual(JSON.parse(json.body).problems.map((p) => p.id), ['boom'])
  assert.match(call(ctx.routes.get('/dsh-sentinel/health')).headers['content-type'], /text\/html/)
  const denied = fakeCtx(entries, false)
  apply(denied, { notify: false, settleSeconds: 60 })
  assert.equal(call(denied.routes.get('/dsh-sentinel/health.json')).status, 401)
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0], /boom/)
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(ctx.warnings.length, 1)  // no polling: nothing changed, nothing checked
  entries.push(row('late', { state: 3, _error: 'Error: y' }))
  for (const i of [1, 2, 3]) ctx.listeners.get('internal/status')()  // a reload: several changes, one check
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(ctx.warnings.length, 2)
  assert.match(ctx.warnings[1], /late/)
  assert.doesNotMatch(ctx.warnings[1], /boom/)  // already reported
  assert.ok(ctx.listeners.has('loader/entry-init'))
  for (const fn of [...ctx.effects, ...denied.effects]) if (typeof fn === 'function') fn()
  assert.equal(ctx.routes.size, 0)
})
