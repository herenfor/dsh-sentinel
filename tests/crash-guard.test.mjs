import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { after, test } from 'node:test'
import { buildReport, guessCulprit, isCrash, mask, profileFromArgv, reportMarkdown, warningPage } from '../crash-report.mjs'
import { watch } from '../crash-watchdog.mjs'
import { parseArgs, rescueCommand } from '../bin/dsh-sentinel-run.mjs'
import { sweepStaleRuns } from '../crash-guard.mjs'

// Temporary directories are removed once this file's tests finish.
const tempDirs = []
after(() => { for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true }) })
const tempDir = (prefix) => { const dir = mkdtempSync(join(tmpdir(), prefix)); tempDirs.push(dir); return dir }

const posix = sep === '/'

test('only abnormal exit codes count as crashes; Ctrl+C, the tray stop and a missing record do not', () => {
  for (const code of [0, 130, 143]) assert.equal(isCrash({ code }), false)
  assert.equal(isCrash({ code: 1 }), true)
  assert.equal(isCrash(undefined), false)
  assert.equal(isCrash({}), false)
})

test('sign-in tokens, API keys and bearer headers are masked in reports', () => {
  assert.equal(mask('dsh web: http://127.0.0.1:3080/?token=abc123&x=1'), 'dsh web: http://127.0.0.1:3080/?token=***&x=1')
  assert.equal(mask('key sk-abcdefghijkl used'), 'key sk-*** used')
  assert.equal(mask('Authorization: Bearer abcdefghijkl'), 'Authorization: Bearer ***')
  assert.equal(mask('api_key=hunter22 ok'), 'api_key=*** ok')
})

test('the culprit is the first stack frame outside Node and DSH itself', { skip: !posix }, () => {
  const stack = [
    'Error: boom',
    '    at node:internal/timers:585:17',
    '    at Hook.run (/s/.pnpm/@deepseek-ai+dsh-tools@1_x/node_modules/@deepseek-ai/dsh-tools/lib/index.js:10:5)',
    '    at Timeout._onTimeout (file:///h/.dsh/profiles/web/node_modules/.pnpm/some-plugin@1/node_modules/some-plugin/index.mjs:3:9)',
    '    at other (/h/.dsh/profiles/web/node_modules/@acme/later/x.js:1:1)',
  ].join('\n')
  assert.deepEqual(guessCulprit(stack), { package: 'some-plugin', file: '/h/.dsh/profiles/web/node_modules/.pnpm/some-plugin@1/node_modules/some-plugin/index.mjs' })
  assert.equal(guessCulprit('    at x (/h/node_modules/@acme/tool/a.js:1:1)').package, '@acme/tool')
  // A plugin loaded from a local path: the nearest package.json names it.
  const fs = { existsSync: (p) => p === '/w/my-plugin/package.json', readFileSync: () => '{"name":"my-plugin"}' }
  assert.equal(guessCulprit('    at apply (file:///w/my-plugin/src/a.mjs:2:3)', fs).package, 'my-plugin')
  assert.equal(guessCulprit('Error: x\n    at node:internal/x:1:1'), undefined)
})

test('the profile comes from --profile or the first bare argument', () => {
  assert.equal(profileFromArgv(['bin.js', 'web', '--port', '3080']), 'web')
  assert.equal(profileFromArgv(['dsh', '--profile', 'tui']), 'tui')
  assert.equal(profileFromArgv(['dsh', '--port', '3080', 'daily']), 'daily')
  assert.equal(profileFromArgv(['dsh']), 'web')
})

test('the warning page says DSH crashed, where the user is now, and what to do; secrets stay masked', () => {
  const r = buildReport({
    exit: { code: 1, at: 0, error: { message: 'boom token=abc123', stack: 'Error: boom\n    at x (/a.js:1:1)' } },
    run: { profile: 'web', profileDir: '/h/.dsh/profiles/web' },
    culprit: { package: 'some-plugin', file: '/a.js' },
  })
  const page = warningPage(r, { rescueUrl: 'http://127.0.0.1:4000/?token=t&a=1', rescuePid: 42, reportFile: '/r/report.md' })
  assert.match(page, /DSH 刚才崩溃了/)
  assert.match(page, /紧急 DSH/)
  assert.match(page, /some-plugin/)
  assert.match(page, /没有被修改/)
  assert.match(page, /kill 42/)
  assert.match(page, /href="http:\/\/127\.0\.0\.1:4000\/\?token=t&amp;a=1"/)  // the link must carry the sign-in token
  assert.doesNotMatch(page, /abc123/)
  const failed = warningPage(r, { rescueError: 'no dsh', reportFile: '/r/report.md' })
  assert.match(failed, /没有启动/)
  assert.doesNotMatch(failed, /打开紧急 DSH<\/a>/)
  const selfTest = buildReport({ exit: { code: 1, at: 0, error: { message: 'x', selfTest: true } }, run: {}, culprit: { package: 'dsh-sentinel' }, selfTest: true })
  assert.match(reportMarkdown(selfTest), /自测/)
})

test('launcher arguments and the command used to start the emergency DSH', () => {
  assert.deepEqual(parseArgs(['--no-open', '--', 'dsh', 'web']), { command: ['dsh', 'web'], options: { rescue: true, open: false, notify: true } })
  assert.deepEqual(parseArgs(['dsh', 'web']).command, [])
  assert.deepEqual(rescueCommand(['dsh', 'web'], undefined), ['dsh'])
  assert.deepEqual(rescueCommand(['/usr/bin/node', '/x/dsh/lib/bin.js', 'web'], undefined), ['/usr/bin/node', '/x/dsh/lib/bin.js'])
  assert.deepEqual(rescueCommand(['my-launcher', 'web'], ['/n', '/b.js']), ['/n', '/b.js'])  // the plugin's record wins
  assert.deepEqual(rescueCommand(['my-launcher', 'web'], undefined, () => true), ['dsh'])
  assert.equal(rescueCommand(['my-launcher', 'web'], undefined, () => false), undefined)
})

function fakeRun(t, exit) {
  const home = tempDir('sentinel-home-')
  const runs = join(home, 'logs', 'dsh-sentinel', 'runs')
  mkdirSync(runs, { recursive: true })
  const host = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400)'], { stdio: 'ignore' })
  t.after(() => host.kill())
  const runFile = join(runs, `${host.pid}-1.json`)
  writeFileSync(runFile, JSON.stringify({ pid: host.pid, dshHome: home, profile: 'web', profileDir: join(home, 'profiles', 'web'), options: { rescue: false, open: false, notify: false } }))
  if (exit) writeFileSync(join(runs, `${host.pid}.exit.json`), JSON.stringify(exit))
  return { home, runFile, host }
}

test('watchdog: after a crash it writes the report and the warning page', async (t) => {
  const { home, runFile } = fakeRun(t, { code: 1, at: Date.now(), error: { message: 'boom', stack: 'Error: boom\n    at x (/p/node_modules/bad-plugin/a.js:1:1)' } })
  const result = await watch(runFile, { poll: 50 })
  assert.equal(result.outcome, 'rescued')
  assert.ok(result.dir.startsWith(join(home, 'logs', 'dsh-sentinel', 'crashes')))
  assert.match(readFileSync(result.reportFile, 'utf8'), /bad-plugin/)
  assert.match(readFileSync(result.page, 'utf8'), /DSH 刚才崩溃了/)
  assert.equal(existsSync(runFile), false)
})

test('watchdog: a clean exit or a host that vanished without a record does nothing', async (t) => {
  assert.equal((await watch(fakeRun(t, { code: 130, at: Date.now() }).runFile, { poll: 50 })).outcome, 'clean-exit')
  assert.equal((await watch(fakeRun(t).runFile, { poll: 50 })).outcome, 'vanished')
})

test('watchdog: plugin turned off while DSH keeps running → the watchdog quits', async (t) => {
  const home = tempDir('sentinel-home-')
  const runs = join(home, 'runs')
  mkdirSync(runs)
  const runFile = join(runs, `${process.pid}-1.json`)
  writeFileSync(runFile, JSON.stringify({ pid: process.pid, dshHome: home }))
  writeFileSync(join(runs, `${process.pid}-1.disposed`), '')
  assert.equal((await watch(runFile, { poll: 20, grace: 100 })).outcome, 'turned-off')
})

test('records of runs whose DSH is gone are swept at startup; live and recent ones stay', () => {
  const runs = tempDir('sentinel-runs-')
  const dead = 2 ** 22 + 12345  // above Linux pid_max defaults: never a live process
  const files = {
    [`${dead}-1.json`]: { pid: dead }, [`${dead}-1.disposed`]: '', [`${dead}.exit.json`]: { code: 130 },
    [`${process.pid}-1.json`]: { pid: process.pid }, [`${process.pid}.exit.json`]: {},
    'lone.exit.json': { code: 0 }, 'fresh-1.json': { pid: dead },
  }
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(runs, name), typeof body === 'string' ? body : JSON.stringify(body))
    if (name !== 'fresh-1.json') utimesSync(join(runs, name), new Date(0), new Date(0))
  }
  sweepStaleRuns(runs)
  assert.deepEqual(readdirSync(runs).sort(), [`${process.pid}-1.json`, `${process.pid}.exit.json`, 'fresh-1.json'])
})
