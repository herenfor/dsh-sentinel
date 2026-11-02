// Rescue after a crash: write the report and warning page, start an emergency DSH from the official web template,
// then open the page. Shared by the in-process watchdog and the dsh-sentinel-run launcher.
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { helpPrompt, mask, reportMarkdown, warningPage } from './crash-report.mjs'

// Its own profile name: `--from-default-profile` replaces the profile it boots, so never reuse a user's `rescue`.
export const RESCUE_PROFILE = 'sentinel-rescue'
const URL_TIMEOUT_MS = 60_000

export const stateDir = (dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')) => join(dshHome, 'logs', 'dsh-sentinel')

const alive = (pid) => { try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** One rescue at a time: the lock names the emergency DSH while it runs. Returns the live lock, if any. */
export function liveRescue(dir) {
  try {
    const lock = JSON.parse(readFileSync(join(dir, 'rescue.json'), 'utf8'))
    if (lock.pid && alive(lock.pid)) return lock
  } catch {}
  return undefined
}

const isWsl = () => Boolean(process.env.WSL_DISTRO_NAME) || (() => { try { return /microsoft/i.test(readFileSync('/proc/sys/kernel/osrelease', 'utf8')) } catch { return false } })()
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0

// Start the browser registered for http links with the page. Opening the .html file itself goes through the
// .html file association, which many machines leave unset, so Windows asks which app to use.
const DEFAULT_BROWSER_PS = `
$id = (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice' -ErrorAction Stop).ProgId
$c = (Get-ItemProperty -LiteralPath "Registry::HKEY_CLASSES_ROOT\\$id\\shell\\open\\command" -ErrorAction Stop).'(default)'
if ($c -match '^\\s*"([^"]+)"\\s*(.*)$') { $exe = $Matches[1]; $rest = $Matches[2] } else { $exe, $rest = $c -split ' ', 2 }
if ($rest -match '%1') { $rest = $rest.Replace('%1', $page) } else { $rest = "$rest \`"$page\`"" }
Start-Process -FilePath $exe -ArgumentList $rest
`
function openWithDefaultBrowser(winPath) {
  const script = `$page = '${winPath.replaceAll("'", "''")}'\n${DEFAULT_BROWSER_PS}`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { cwd: '/mnt/c', stdio: 'ignore', timeout: 15_000 })
  return r.status === 0
}

/** Open a file in the default browser. Best effort; returns whether an opener was started. */
export function openInBrowser(file) {
  let cmd, args
  if (process.platform === 'win32') [cmd, args] = ['cmd.exe', ['/c', 'start', '', file]]
  else if (process.platform === 'darwin') [cmd, args] = ['open', [file]]
  else if (isWsl() && has('explorer.exe')) {
    const win = spawnSync('wslpath', ['-w', file], { encoding: 'utf8' }).stdout?.trim()
    if (!win) return false
    if (has('powershell.exe') && openWithDefaultBrowser(win)) return true
    ;[cmd, args] = ['explorer.exe', [win]]
  } else if (has('xdg-open')) [cmd, args] = ['xdg-open', [file]]
  else return false
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); return true } catch { return false }
}

function toast() {
  const script = fileURLToPath(new URL('./notify-windows.sh', import.meta.url))
  if (process.platform !== 'linux' || !isWsl() || !existsSync(script)) return
  try { spawn('bash', [script, 'crashed'], { detached: true, stdio: 'ignore' }).unref() } catch {}
}

async function startEmergencyDsh({ command, dshHome, profileDir, dir }) {
  const log = join(dir, 'rescue.log')
  const out = openSync(log, 'w', 0o600)
  const env = { ...process.env, DSH_HOME: dshHome, DSH_SENTINEL_RESCUE: '1' }
  delete env.DSH_SENTINEL_SUPERVISED
  delete env.DSH_SENTINEL_CRASH_TEST
  let child
  try {
    child = spawn(command[0], [...command.slice(1), RESCUE_PROFILE, '--from-default-profile', 'web', '--no-open', '--port', '0'], {
      cwd: existsSync(profileDir ?? '') ? profileDir : homedir(), env, detached: true, stdio: ['ignore', out, out],
    })
  } finally { closeSync(out) }
  child.unref()
  const deadline = Date.now() + URL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const url = /dsh web: (https?:\/\/\S+)/.exec(readFileSync(log, 'utf8'))?.[1]
    if (url) return { url, pid: child.pid }
    if (child.exitCode !== null || !alive(child.pid)) break
    await sleep(300)
  }
  const tail = mask(readFileSync(log, 'utf8')).trim().split('\n').slice(-3).join(' / ')
  return { error: tail || 'emergency DSH did not report its address in time', pid: alive(child.pid) ? child.pid : undefined }
}

/**
 * Handle one crash. `report` comes from buildReport; `run` carries dshHome, profileDir and `command`, the way to
 * start dsh (`[node, bin.js]` or `['dsh']`); without a command only the report and page are written.
 * Options: rescue (start the emergency DSH), open (open the page), notify (Windows toast).
 */
export async function handleCrash(report, run, { rescue = true, open = true, notify = true } = {}) {
  const base = stateDir(run.dshHome)
  const dir = join(base, 'crashes', new Date(report.at).toISOString().replaceAll(':', '-'))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const reportFile = join(dir, 'report.md')
  writeFileSync(reportFile, reportMarkdown(report), { mode: 0o600 })
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  writeFileSync(join(dir, 'help-prompt.txt'), helpPrompt(report, reportFile), { mode: 0o600 })

  // A crash while an emergency DSH is still running (DSH restarted and crashed again) reuses it.
  let state = liveRescue(base)
  const reused = state !== undefined
  if (state === undefined && rescue && run.command?.length) {
    const started = await startEmergencyDsh({ ...run, dir })
    state = { ...started, startedAt: Date.now() }
    if (started.url) writeFileSync(join(base, 'rescue.json'), JSON.stringify({ pid: started.pid, url: started.url, startedAt: state.startedAt, dir }), { mode: 0o600 })
    else rmSync(join(base, 'rescue.json'), { force: true })
  }
  const page = join(dir, 'warning.html')
  writeFileSync(page, warningPage(report, { rescueUrl: state?.url, rescuePid: state?.pid, rescueError: state?.error, reportFile }), { mode: 0o600 })
  const opened = open ? openInBrowser(page) : false
  if (notify) toast()
  return { dir, page, reportFile, rescue: state && { pid: state.pid, url: state.url ? mask(state.url) : undefined, error: state.error }, opened, reused }
}
