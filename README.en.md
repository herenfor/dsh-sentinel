# DSH Sentinel

[![MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-blue)](#requirements)
[![Tests](https://github.com/herenfor/dsh-sentinel/actions/workflows/test.yml/badge.svg)](https://github.com/herenfor/dsh-sentinel/actions/workflows/test.yml)

[中文](README.md) | English

Looks after DeepSeek Harness from outside its main process: notifies you when a turn finishes and starts or stops DSH from a tray icon. When DSH crashes, it opens an emergency DSH and a page that explains what happened.

This repository succeeds [dsh-task-notify](https://github.com/herenfor/dsh-task-notify), which is no longer updated.

The plugin tries browser notifications first. If no connected page can send one, or delivery fails, it falls back to a Windows notification. You can work in another window and come back when the notification arrives.

This community plugin currently targets **Windows 11 + WSL2**, with DSH running in WSL.

![A DSH task completes and a notification appears after switching to another window](https://raw.githubusercontent.com/herenfor/dsh-sentinel/v0.0.1/assets/demo.gif)

## Features

- Notifies after a turn finishes normally. Cancelled turns, errors, and delegated child sessions do not trigger notifications.
- A turn that ends while background jobs it started (such as a build) are still running does not notify; you are notified once the jobs finish and the AI has handled the results.
- Also notifies when you are needed: an action is waiting for your approval, the AI asked you a question, or a turn ended with a question still unanswered. Anything you handle within 5 seconds is not announced.
- Works with the Minimal agent preset in the Web profile, even when the AI has no tools.
- Windows notifications use the DSH name, whale icon, and default notification sound.
- Notification failures do not affect the task.

Notifications only say what happened. Clicking a notification does not take you to the conversation.

## Requirements

Supports DSH `0.2.0-rc.2` and later `0.2.x` releases (`>=0.2.0-rc.2 <0.3.0-0`), so small DSH updates do not need a new plugin release; tested on `0.2.0-rc.2`, `0.2.1-rc.2`, `0.2.1-rc.3`, and `0.2.1-rc.4`. The plugin mainly targets Windows 11 + WSL2, with DSH running in WSL. Compatibility checks for `rc.3` and `rc.4` use Node.js `22.23.4`.

You need:

- DSH's `web` profile and a Node.js version supported by DSH.
- `pnpm` available in WSL when installing the plugin.
- WSL interoperability with Windows programs for the Windows fallback.

The Minimal preset within the Web profile is supported. The separate `headless`, `sdk`, and `sdk-minimal` profiles are not currently supported.

## Install

Run this in WSL:

```bash
dsh plugin --profile web add github:herenfor/dsh-sentinel#v0.2.2
```

Wait for active tasks to finish, restart DSH, and refresh its browser page. The plugin loads automatically; no source path needs to be added by hand.

If you previously loaded a test version through a local path, remove the old `task-notify` entry from your profile patch so it does not override the installed version.

If you installed dsh-task-notify before, remove it first, then install this package; your notification settings are kept:

```bash
dsh plugin --profile web remove dsh-task-notify
```

## Enable browser notifications

1. Open **Settings → 任务通知** in DSH.
2. Click **启用浏览器通知** and allow notifications in the browser prompt.
3. Click **测试通知** to check that a notification appears.

The title says what happened: `DSH · 本轮已完成` (turn completed), `DSH · 等你回答` (turn ended with a question unanswered), `DSH · 需要审批` (approval needed) or `DSH · 需要你回答` (question asked), with the conversation title when available. Test notifications are labelled `DSH · 通知测试`.

At least one DSH page must stay connected to receive new browser notifications. If you close all pages, turn browser notifications off, or deny permission, the plugin uses Windows notifications instead.

Permission is saved for each browser profile and website address. Changing the browser, port, or domain requires permission again. Open DSH through local `localhost` / `127.0.0.1` or HTTPS.

## Windows notifications

The default sender uses the built-in **Windows PowerShell 5.1**, with Chinese support and no extra module required. Notifications show `DeepSeek Harness`, the whale icon, and a message saying what happened.

If that sender fails, the plugin tries **pwsh with BurntToast 1.1.0**. To enable this backup, run the following in Windows pwsh:

```powershell
Install-Module BurntToast -RequiredVersion 1.1.0 -Scope CurrentUser
```

Browser notification sound depends on the browser and Windows settings. The Windows fallback requests the default notification sound. If notifications or sound are missing, check Windows notification settings and Do Not Disturb.

## Tray icon (optional)

The package also ships an optional Windows tray icon that treats DSH like an ordinary app:

- Launch it: DSH starts if it is not running, then the page opens; if DSH is already running, the page opens.
- Click the icon to open the page. "停止 DSH" in the right-click menu stops DSH and removes the icon.
- The menu follows the Windows dark/light setting.

It is not a DSH plugin, so install it once from WSL:

```bash
bash ~/.dsh/profiles/web/node_modules/dsh-sentinel/tray/install.sh
```

The files go to `%USERPROFILE%\DshTray`. The installer asks whether to add a "DSH" desktop shortcut (default yes) and whether to show the icon at sign-in (default no; it only shows the icon and does not start DSH). `--desktop` / `--no-desktop` and `--autostart` / `--no-autostart` answer these up front, and `--port` sets the port when DSH does not listen on 3080. Then start it from the "DSH" desktop shortcut or `start-dsh-tray.vbs` in `%USERPROFILE%\DshTray`.

By default the tray starts DSH with `dsh web --no-open`. It only starts and stops DSH and never updates it. To use your own launcher instead, set it in `~/.config/dsh-tray/env`:

```bash
DSH_TRAY_START='my-launcher --no-open'   # must put itself in the background
DSH_TRAY_STOP='my-launcher stop'
DSH_TRAY_LOG="$HOME/.cache/my-launcher.log"   # where the launcher writes "dsh web: <url>"
```

To remove it, delete `%USERPROFILE%\DshTray`, the "DSH" desktop shortcut, and `DSH tray.vbs` in the Startup folder.

## Crash protection

When DSH crashes (for example a plugin throws an error nobody handles and the whole process exits), three things happen:

- A crash report is written to `~/.dsh/logs/dsh-sentinel/crashes/<time>/`: exit code, error, stack, and the plugin the stack points at. Tokens and keys are masked.
- An **emergency DSH** starts from the official default configuration (profile `sentinel-rescue`) with no third-party plugins. Its workspace is the broken profile directory, so its agent can help you fix it.
- A page opens in your browser: it says DSH crashed, that you are now in the emergency DSH, what the likely cause is, and gives a help prompt you can paste to the agent. Under WSL a Windows notification is shown too.

The page is a local file, so the address bar shows `file:///…`: it opens even though DSH has stopped and needs no server. Under WSL it opens in the Windows default browser directly, without going through the `.html` file association (often unset, in which case Windows asks which app to use).

It never changes your configuration. Once fixed, stop the emergency DSH with the command on the page and start DSH as usual.

### Making it work

Crash protection has two layers with different coverage:

| How you start DSH | Crash while running | Fails at startup (bad config, broken plugin install) |
|---|---|---|
| Plugin installed, started as usual | ✅ | ❌ the plugin has not loaded yet |
| Started through the `dsh-sentinel-run` launcher | ✅ | ✅ |

1. **Install the plugin and restart DSH**: crashes while running are covered, nothing else to do.
2. **To also cover startup failures**, start DSH through the launcher:
   - From the tray icon: the tray already uses the launcher (unless you set your own start script in `~/.config/dsh-tray/env`; see the next item).
   - From a terminal: put the launcher in front, for example
     ```bash
     node ~/.dsh/profiles/web/node_modules/dsh-sentinel/bin/dsh-sentinel-run.mjs -- dsh web --port 3080
     ```
   - From your own start script: prefix the line that runs `dsh web` with `node ~/.dsh/profiles/web/node_modules/dsh-sentinel/bin/dsh-sentinel-run.mjs --` in the same way.

   The launcher passes DSH output through unchanged. Stopping with Ctrl+C or the tray's "Stop DSH" does not raise an alarm.

### Try it

```bash
DSH_SENTINEL_CRASH_TEST=10 dsh web
```

Stop the DSH you are running first (or use another port, such as `--port 3090`). DSH crashes on purpose after 10 seconds; you should see the page and the emergency DSH, and the report marks it as a self-test. Stop the emergency DSH with the command on the page afterwards.

### Settings

In your own `cordis.patch.yml`:

```yaml
- id: sentinel-crash-guard
  config:
    rescue: true     # start the emergency DSH after a crash
    openPage: true   # open the page
    notify: true     # show a Windows notification
```

Use `disabled: true` to turn it off. The launcher also accepts `--no-rescue`, `--no-open` and `--no-notify`.

### Limits

- When DSH is killed with `kill -9` or by the out-of-memory killer it cannot leave a record, so nothing is reported.
- The likely plugin is inferred from the stack; when the error comes from DSH's own code the report says it cannot tell.
- The emergency DSH shares `~/.dsh` with the original (sessions, sign-in and API keys) and needs the `dsh` command line; the DSH desktop app is not supported.
- Only one emergency DSH runs at a time; another crash while it is open updates the report and page.
- Tested on DSH `0.2.1-rc.5` under WSL: crash while running, startup failure from a broken config, and no alarm on a normal stop.

## Uninstall

```bash
dsh plugin --profile web remove dsh-sentinel
```

Restart DSH after removal. The display name and icon already registered in Windows remain in place.

## Troubleshooting

- **No browser notification:** Try the test button in settings and check the site's notification permission. This button only tests browser notifications.
- **Test Windows notifications separately:** Run `./notify-windows.sh` from the plugin source directory in WSL.
- **Notification settings are missing:** Check that you are using the `web` profile, have restarted DSH and refreshed the page, and have removed any old test-version profile entry.

For other problems, open an [issue](https://github.com/herenfor/dsh-sentinel/issues) with your DSH version, browser, and reproduction steps. Remove credentials, private startup links, and session information before sharing logs.

## Development

Implementation details, local installation, packaging, and verification notes are in [DEVELOPING.md](DEVELOPING.md) (Chinese). See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and [CHANGELOG.md](CHANGELOG.md) for version history.

## License

Code is licensed under [MIT](LICENSE). The whale icon comes from DeepSeek Harness; its source and original license are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This is not an official DeepSeek plugin.
