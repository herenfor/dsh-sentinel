// Pure helpers for crash protection: classify an exit, guess which plugin caused it, and render the report,
// the help prompt for the rescue agent, and the warning page. Nothing here touches processes or the network.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Ctrl+C (SIGINT) and the tray's stop (SIGTERM) end DSH with these codes; they are not crashes.
const CLEAN_EXIT_CODES = new Set([0, 130, 143])

/** Whether an exit record describes a crash. A host that vanished without any record (SIGKILL, OOM) is not counted. */
export function isCrash(exit) {
  return exit !== undefined && exit !== null && typeof exit.code === 'number' && !CLEAN_EXIT_CODES.has(exit.code)
}

// Credentials that can end up in error messages or logs: sign-in tokens in URLs, API keys, bearer headers.
const SECRET_PATTERNS = [
  [/(\b(?:token|api[_-]?key|password|secret)\s*[=:]\s*)[^&\s"'<>,]+/gi, '$1***'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***'],
]
export function mask(text) {
  let out = String(text ?? '')
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement)
  return out
}

/** File paths named in a V8 stack, in order. */
export function stackFiles(stack) {
  const files = []
  for (const line of String(stack ?? '').split('\n')) {
    const m = /^\s*at (?:.*?\()?((?:file:\/\/)?\/[^():]+|[A-Za-z]:\\[^():]+):\d+:\d+\)?\s*$/.exec(line)
    if (m === null) continue
    let file = m[1]
    if (file.startsWith('file://')) { try { file = fileURLToPath(file) } catch { continue } }
    files.push(file)
  }
  return files
}

const isDshOwn = (file) => file.includes(`${sep}@deepseek-ai${sep}`) || file.includes(`${sep}dsh-cli${sep}`)

/** Package name for a file: the segment after the last node_modules, else the nearest package.json. */
export function packageOf(file, fs = { existsSync, readFileSync }) {
  const parts = file.split(sep)
  const at = parts.lastIndexOf('node_modules')
  if (at >= 0 && at + 1 < parts.length) return parts[at + 1].startsWith('@') ? `${parts[at + 1]}/${parts[at + 2] ?? ''}` : parts[at + 1]
  let dir = dirname(file)
  for (let i = 0; i < 8; i++) {
    const manifest = join(dir, 'package.json')
    if (fs.existsSync(manifest)) {
      try { return JSON.parse(fs.readFileSync(manifest, 'utf8')).name ?? undefined } catch { return undefined }
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return undefined
}

/** The first stack frame outside Node and DSH itself points at the plugin most likely at fault. */
export function guessCulprit(stack, fs) {
  for (const file of stackFiles(stack)) {
    if (isDshOwn(file)) continue
    return { package: packageOf(file, fs), file }
  }
  return undefined
}

/** Profile name from the dsh command line: `--profile <name>`, or the first bare argument (`dsh web`). */
export function profileFromArgv(argv) {
  const at = argv.indexOf('--profile')
  if (at >= 0 && argv[at + 1]) return argv[at + 1]
  return argv.find((a, i) => i > 0 && !a.startsWith('-') && argv[i - 1] !== '--port' && argv[i - 1] !== '--host') ?? 'web'
}

const fmtTime = (ms) => new Date(ms).toLocaleString()

/** Everything the warning page, the report file and the help prompt need, with secrets masked. */
export function buildReport({ exit, run, error, stderrTail, culprit, selfTest = false }) {
  const message = mask(error?.message ?? exit?.error?.message ?? '')
  const stack = mask(error?.stack ?? exit?.error?.stack ?? '').split('\n').slice(0, 30).join('\n')
  return {
    at: exit?.at ?? Date.now(),
    code: exit?.code,
    origin: error?.origin ?? exit?.error?.origin,
    message,
    stack,
    stderrTail: mask(stderrTail ?? '').split('\n').slice(-60).join('\n'),
    culprit: selfTest ? undefined : culprit,
    selfTest,
    profile: run?.profile,
    profileDir: run?.profileDir,
    dshHome: run?.dshHome,
  }
}

export function reportMarkdown(r) {
  const lines = [
    `# DSH 崩溃报告`, '',
    `- 时间：${fmtTime(r.at)}`,
    `- 退出码：${r.code ?? '未知'}`,
    `- profile：${r.profile ?? '未知'}（目录 ${r.profileDir ?? '未知'}）`,
    `- 疑似原因：${r.selfTest ? '崩溃防护自测（DSH_SENTINEL_CRASH_TEST），不是真的故障' : r.culprit?.package ? `插件 ${r.culprit.package}（${r.culprit.file}）` : '无法从堆栈判断'}`,
  ]
  if (r.message) lines.push('', '## 错误', '', '```', r.message, '```')
  if (r.stack) lines.push('', '## 堆栈', '', '```', r.stack, '```')
  if (r.stderrTail) lines.push('', '## DSH 最后的输出', '', '```', r.stderrTail, '```')
  return lines.join('\n') + '\n'
}

/** What the user pastes into the rescue session. */
export function helpPrompt(r, reportFile) {
  return [
    `我的 DSH（profile：${r.profile ?? 'web'}）刚才崩溃了。崩溃报告在 ${reportFile}，出问题的配置目录是 ${r.profileDir ?? '（见报告）'}，也是当前工作区。`,
    '请先读报告判断原因。需要改配置时先备份原文件，改动尽量小（比如先停用疑似出问题的插件），改完告诉我改了什么、怎么撤销。不要读取或输出凭据文件。',
  ].join('\n')
}

const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** The page opened right after a crash: what happened, where the user is now, and what to do next. */
export function warningPage(r, { rescueUrl, rescuePid, rescueError, reportFile }) {
  const cause = r.selfTest ? '崩溃防护自测，不是真的故障' : r.culprit?.package ? `插件 <code>${esc(r.culprit.package)}</code>` : '无法从堆栈判断'
  const rescue = rescueUrl
    ? `<span class="ok">运行中</span>（进程 ${esc(rescuePid)}）`
    : `<span class="bad">没有启动</span>${rescueError ? `：${esc(rescueError)}` : ''}`
  const prompt = helpPrompt(r, reportFile)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH 崩溃了</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6b6b70;--card:#f5f5f7;--line:#dcdce0;--warn-bg:#fff4e5;--warn-fg:#8a4b00;--warn-line:#f0b45c;--ok:#1f7a3a;--bad:#b42318;--btn:#1d1d1f;--btn-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececf0;--muted:#a0a0a8;--card:#222226;--line:#3a3a40;--warn-bg:#3a2a12;--warn-fg:#ffcf8a;--warn-line:#a0681c;--ok:#6fd38d;--bad:#ff8a80;--btn:#ececf0;--btn-fg:#161618}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}
.banner{background:var(--warn-bg);color:var(--warn-fg);border:1px solid var(--warn-line);border-radius:10px;padding:16px 18px}
.banner h1{margin:0 0 4px;font-size:22px}
.banner p{margin:0}
h2{font-size:17px;margin:28px 0 10px}
table{width:100%;border-collapse:collapse;background:var(--card);border-radius:10px;overflow:hidden}
td{padding:9px 12px;border-top:1px solid var(--line);vertical-align:top}
tr:first-child td{border-top:0}
td:first-child{color:var(--muted);white-space:nowrap;width:7em}
.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad);font-weight:600}
code,pre,textarea{font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
pre{background:var(--card);border-radius:10px;padding:12px;overflow:auto;max-height:280px;white-space:pre-wrap;word-break:break-all}
textarea{width:100%;box-sizing:border-box;min-height:110px;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:10px}
ol{padding-left:22px}li{margin:6px 0}
.btn{display:inline-block;background:var(--btn);color:var(--btn-fg);border:0;border-radius:8px;padding:8px 14px;font-size:14px;text-decoration:none;cursor:pointer}
.muted{color:var(--muted);font-size:13px}
</style></head><body><main>
<div class="banner"><h1>DSH 刚才崩溃了</h1><p>${rescueUrl ? '已经为你打开一个<strong>紧急 DSH</strong>：它用官方默认配置启动，不带任何第三方插件，可以用来修复出问题的配置。' : '紧急 DSH 没能启动，请按下面的报告手动处理。'}</p></div>
<h2>现状</h2>
<table>
<tr><td>原来的 DSH</td><td><span class="bad">已停止</span>（${esc(fmtTime(r.at))}，退出码 ${esc(r.code ?? '未知')}）</td></tr>
<tr><td>紧急 DSH</td><td>${rescue}</td></tr>
<tr><td>疑似原因</td><td>${cause}</td></tr>
<tr><td>你的配置</td><td>没有被修改（<code>${esc(r.profileDir ?? '未知')}</code>）</td></tr>
</table>
${r.message ? `<h2>错误</h2><pre>${esc(r.message)}</pre>` : ''}
<h2>接下来</h2>
<ol>
${rescueUrl ? `<li><a class="btn" href="${esc(rescueUrl)}">打开紧急 DSH</a>　它的工作区就是出问题的配置目录。</li>` : ''}
<li>把下面这段求助说明发给${rescueUrl ? '紧急 DSH 里的 agent' : '你用来修复的 agent'}：<br><textarea id="prompt" readonly>${esc(prompt)}</textarea><br><button class="btn" id="copy">复制求助说明</button> <span class="muted" id="copied"></span></li>
<li>修好后${rescueUrl ? `关闭紧急 DSH（在终端运行 <code>kill ${esc(rescuePid)}</code>），` : ''}再像平时一样启动 DSH。</li>
</ol>
<h2>完整报告</h2>
<p class="muted"><code>${esc(reportFile)}</code></p>
${r.stack ? `<pre>${esc(r.stack)}</pre>` : ''}
${r.stderrTail ? `<h2>DSH 最后的输出</h2><pre>${esc(r.stderrTail)}</pre>` : ''}
<p class="muted">dsh-sentinel 崩溃防护</p>
</main>
<script>
document.getElementById('copy').addEventListener('click', async () => {
  const box = document.getElementById('prompt'), note = document.getElementById('copied')
  try { await navigator.clipboard.writeText(box.value); note.textContent = '已复制' }
  catch { box.select(); note.textContent = '已选中，按 Ctrl+C 复制' }
})
</script>
</body></html>
`
}
