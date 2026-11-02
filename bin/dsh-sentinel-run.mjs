#!/usr/bin/env node
// Crash protection, launcher half: run DSH as a child so every abnormal exit is seen, including failures before
// any plugin loads (a broken cordis.patch.yml, a plugin that fails to install). Output passes through unchanged.
// Usage: dsh-sentinel-run [--no-rescue] [--no-open] [--no-notify] -- dsh web --no-open --port 3080
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildReport, guessCulprit, isCrash, profileFromArgv } from '../crash-report.mjs'
import { handleCrash, stateDir } from '../rescue.mjs'

const TAIL_LINES = 200
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP']

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined } }
const onPath = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0

/** How to start an emergency DSH: the plugin's record knows the exact node and dsh; otherwise the same `dsh`
 *  (or `node …/bin.js`) as the wrapped command, else `dsh` on PATH. A wrapper script of your own is not reused. */
export function rescueCommand(command, recorded, hasDsh = () => onPath('dsh')) {
  if (recorded?.length) return recorded
  if (basename(command[0] ?? '') === 'dsh') return [command[0]]
  if (/^node(\.exe)?$/.test(basename(command[0] ?? '')) && /bin\.js$/.test(command[1] ?? '')) return command.slice(0, 2)
  return hasDsh() ? ['dsh'] : undefined
}

export function parseArgs(argv) {
  const at = argv.indexOf('--')
  const flags = new Set(at < 0 ? [] : argv.slice(0, at))
  return {
    command: at < 0 ? [] : argv.slice(at + 1),
    options: { rescue: !flags.has('--no-rescue'), open: !flags.has('--no-open'), notify: !flags.has('--no-notify') },
  }
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (command.length === 0) {
    process.stderr.write('usage: dsh-sentinel-run [--no-rescue] [--no-open] [--no-notify] -- <dsh command...>\n')
    process.exit(2)
  }
  const runId = randomUUID()
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const lines = []
  const keep = (chunk) => {
    for (const line of chunk.toString('utf8').split('\n')) if (line) lines.push(line)
    if (lines.length > TAIL_LINES) lines.splice(0, lines.length - TAIL_LINES)
  }
  const child = spawn(command[0], command.slice(1), {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, DSH_SENTINEL_SUPERVISED: '1', DSH_SENTINEL_RUN_ID: runId },
  })
  child.stdout.on('data', (chunk) => { keep(chunk); process.stdout.write(chunk) })
  child.stderr.on('data', (chunk) => { keep(chunk); process.stderr.write(chunk) })
  for (const signal of FORWARDED) process.on(signal, () => child.kill(signal))
  child.on('error', (error) => {
    process.stderr.write(`dsh-sentinel-run: could not start ${command[0]}: ${error.message}\n`)
    process.exit(127)
  })
  child.on('exit', async (code, signal) => {
    const exitCode = code ?? 128 + (({ SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 })[signal] ?? 0)
    const runs = join(stateDir(dshHome), 'runs')
    const exitFile = join(runs, `${runId}.exit.json`)
    const exit = readJson(exitFile) ?? { code: exitCode, at: Date.now() }
    // The plugin's files for this run: its record (it knows the exact node and dsh), exit record, disposal marker.
    let recorded
    try {
      for (const f of readdirSync(runs)) {
        if (!f.startsWith(`${runId}`)) continue
        if (f.endsWith('.json') && f !== `${runId}.exit.json`) recorded ??= readJson(join(runs, f))?.command
        rmSync(join(runs, f), { force: true })
      }
    } catch {}
    // Killed by a signal we did not forward (SIGKILL, OOM): not reported, same as the watchdog.
    if (signal !== null && !FORWARDED.includes(signal)) process.exit(exitCode)
    if (!isCrash(exit)) process.exit(exitCode)
    const stderrTail = lines.join('\n')
    const profile = profileFromArgv(command)
    const run = { dshHome, profile, profileDir: join(dshHome, 'profiles', profile) }
    run.command = rescueCommand(command, recorded)
    const report = buildReport({
      exit, run, stderrTail,
      culprit: guessCulprit(exit.error?.stack) ?? guessCulprit(stderrTail),
      selfTest: exit.error?.selfTest === true,
    })
    try {
      const result = await handleCrash(report, run, options)
      process.stderr.write(`dsh-sentinel: DSH crashed (exit ${exitCode}); report: ${result.reportFile}; warning page: ${result.page}\n`)
    } catch (error) {
      process.stderr.write(`dsh-sentinel: crash handling failed: ${error.message}\n`)
    }
    process.exit(exitCode)
  })
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch { return false } })()
if (isMain) main()
