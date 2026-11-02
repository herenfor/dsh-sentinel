// Crash watchdog: started detached by crash-guard.mjs, it outlives the DSH host. When the host is gone and its
// exit record shows a crash, it writes the report, starts the emergency DSH and opens the warning page.
// Usage: node crash-watchdog.mjs <run file>
import { appendFileSync, existsSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildReport, guessCulprit, isCrash } from './crash-report.mjs'
import { handleCrash } from './rescue.mjs'

const POLL_MS = 500
// After the plugin is disposed, wait this long for the host to exit before treating it as "turned off".
const DISPOSE_GRACE_MS = 15_000

const alive = (pid) => { try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined } }

export async function watch(runFile, { poll = POLL_MS, grace = DISPOSE_GRACE_MS } = {}) {
  const run = readJson(runFile)
  if (run === undefined) return { outcome: 'no-run' }
  const disposed = runFile.replace(/\.json$/, '.disposed')
  const exitFile = runFile.replace(/-\d+\.json$/, '.exit.json')
  let disposedAt
  while (alive(run.pid)) {
    if (existsSync(disposed)) {
      disposedAt ??= Date.now()
      if (Date.now() - disposedAt > grace) { cleanup(runFile, disposed); return { outcome: 'turned-off' } }
    }
    await sleep(poll)
  }
  await sleep(200)  // the exit hook writes synchronously, but give the filesystem a moment
  const exit = readJson(exitFile)
  cleanup(runFile, disposed)
  rmSync(exitFile, { force: true })
  if (!isCrash(exit)) return { outcome: exit ? 'clean-exit' : 'vanished', code: exit?.code }
  const report = buildReport({ exit, run, culprit: guessCulprit(exit.error?.stack), selfTest: exit.error?.selfTest === true })
  const result = await handleCrash(report, run, run.options)
  return { outcome: 'rescued', ...result }
}

function cleanup(runFile, disposed) {
  rmSync(runFile, { force: true })
  rmSync(disposed, { force: true })
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch { return false } })()
if (isMain && process.argv[2]) {
  const log = join(dirname(dirname(process.argv[2])), 'watchdog.log')
  const note = (entry) => { try { appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 }) } catch {} }
  watch(process.argv[2])
    .then((result) => note({ run: process.argv[2].split('/').pop(), ...result }))
    .catch((error) => note({ outcome: 'failed', error: String(error).slice(0, 300) }))
    .finally(() => process.exit(0))
}
