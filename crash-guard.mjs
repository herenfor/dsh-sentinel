// Crash protection, in-process half. A plugin dies with its host, so this only records: the run, the last
// uncaught error, and the exit code. A detached watchdog (crash-watchdog.mjs) outlives the host and does the
// rescue. Under dsh-sentinel-run (DSH_SENTINEL_SUPERVISED=1) the launcher is the parent and rescues instead.
import { spawn } from 'node:child_process'
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { profileFromArgv } from './crash-report.mjs'
import { stateDir } from './rescue.mjs'

export const name = 'dsh-sentinel-crash-guard'

const DEFAULTS = { enabled: true, rescue: true, openPage: true, notify: true }
const watchdogScript = fileURLToPath(new URL('./crash-watchdog.mjs', import.meta.url))

const describe = (error, origin) => ({
  message: String(error?.message ?? error).slice(0, 2000),
  stack: typeof error?.stack === 'string' ? error.stack.slice(0, 8000) : undefined,
  origin,
  selfTest: error?.sentinelCrashTest === true || undefined,
})

// Process hooks are installed once per process, so enabling the plugin again after HMR does not stack them.
// They never change how the process exits: the monitor is passive, and the rejection listener is added only
// when DSH already handles rejections (otherwise Node's default crash reaches the monitor anyway).
const hooks = { installed: false, lastError: undefined, exitFile: undefined }
function installProcessHooks() {
  if (hooks.installed) return
  hooks.installed = true
  process.on('uncaughtExceptionMonitor', (error, origin) => { hooks.lastError = describe(error, origin) })
  if (process.listenerCount('unhandledRejection') > 0) process.on('unhandledRejection', (reason) => { hooks.lastError = describe(reason, 'unhandledRejection') })
  process.on('exit', (code) => {
    if (hooks.exitFile === undefined) return
    try { writeFileSync(hooks.exitFile, JSON.stringify({ code, at: Date.now(), error: hooks.lastError }), { mode: 0o600 }) } catch {}
  })
}

let applies = 0

export function apply(ctx, config) {
  const c = { ...DEFAULTS, ...config }
  if (!c.enabled || process.env.DSH_SENTINEL_RESCUE === '1') return
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const runs = join(stateDir(dshHome), 'runs')
  // The launcher names the run so it can find this exit record; otherwise the pid does.
  const runId = process.env.DSH_SENTINEL_RUN_ID ?? String(process.pid)
  const applyId = `${runId}-${++applies}`
  let dshEntry
  try { dshEntry = realpathSync(process.argv[1]) } catch {}
  const profile = profileFromArgv(process.argv.slice(1))
  const run = {
    pid: process.pid, startedAt: Date.now(), dshHome, profile, profileDir: join(dshHome, 'profiles', profile),
    command: dshEntry ? [process.execPath, dshEntry] : undefined,
    options: { rescue: c.rescue, open: c.openPage, notify: c.notify },
  }
  const runFile = join(runs, `${applyId}.json`)
  try {
    mkdirSync(runs, { recursive: true, mode: 0o700 })
    writeFileSync(runFile, JSON.stringify(run), { mode: 0o600 })
  } catch (error) {
    ctx.logger.warn(`dsh-sentinel crash guard is off: ${String(error)}`)
    return
  }
  hooks.exitFile = join(runs, `${runId}.exit.json`)
  installProcessHooks()

  if (process.env.DSH_SENTINEL_SUPERVISED !== '1') {
    try {
      spawn(process.execPath, [watchdogScript, runFile], { detached: true, stdio: 'ignore' }).unref()
    } catch (error) {
      ctx.logger.warn(`dsh-sentinel crash watchdog could not start: ${String(error)}`)
    }
  }

  // Self-test: DSH_SENTINEL_CRASH_TEST=<seconds> crashes DSH on purpose to check that protection works.
  const seconds = Number(process.env.DSH_SENTINEL_CRASH_TEST)
  let timer
  if (seconds > 0) {
    timer = setTimeout(() => { throw Object.assign(new Error('dsh-sentinel crash test (DSH_SENTINEL_CRASH_TEST)'), { sentinelCrashTest: true }) }, seconds * 1000)
  }

  // Disposal also happens on the way to a crash exit, so it must not stop the watchdog. It leaves a marker;
  // the watchdog quits only if the host is still running a while after it (the plugin was turned off).
  ctx.effect(() => () => {
    clearTimeout(timer)
    try { writeFileSync(join(runs, `${applyId}.disposed`), '', { mode: 0o600 }) } catch {}
    if (process.env.DSH_SENTINEL_SUPERVISED === '1') rmSync(runFile, { force: true })
  }, 'dsh-sentinel crash guard')
}
