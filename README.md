# DSH Sentinel

[![MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-blue)](#使用环境)
[![测试](https://github.com/herenfor/dsh-sentinel/actions/workflows/test.yml/badge.svg)](https://github.com/herenfor/dsh-sentinel/actions/workflows/test.yml)

中文 | [English](README.en.md)

在 DeepSeek Harness 主程序之外照看它：一轮对话结束时提醒你，用托盘启动和停止 DSH。DSH 崩溃时打开紧急 DSH 和说明页面，帮你把它修好；可选的插件健康检查会告诉你哪些插件没加载上。

本仓库接替 [dsh-task-notify](https://github.com/herenfor/dsh-task-notify)，那边不再更新。

插件优先使用浏览器通知。如果浏览器没有打开、没有通知权限，或者发送失败，就改用 Windows 系统通知。你可以切到别的窗口做事，收到提醒后再回来查看结果。

这是一个社区插件，目前主要在 **Windows 11 + WSL2** 环境下使用。

![DSH 执行任务，切到其他窗口后收到完成通知](https://raw.githubusercontent.com/herenfor/dsh-sentinel/v0.0.1/assets/demo.gif)

## 功能

- 一轮对话正常结束时发送通知，取消、出错和委派的子任务结束时不提醒。
- 本轮启动的后台任务（比如编译）还在跑时，结束的这一轮不提醒；等任务结束、AI 处理完结果后再提醒一次。
- 需要你出面时也会提醒：有操作等你审批、AI 向你提了问题，或者本轮结束时还有问题没回答。5 秒内就处理掉的不提醒。
- 支持 Web 模式里的 minimal 预设，AI 没有工具也能触发。
- Windows 通知使用 DSH 名称、鲸鱼图标和默认提示音。
- 通知失败不会影响任务运行。

通知只负责说明发生了什么，暂不支持点击通知后跳转到对应对话。

## 使用环境

支持 DSH `0.2.0-rc.2` 及之后的 `0.2.x` 版本（`>=0.2.0-rc.2 <0.3.0-0`），小版本更新不用等插件发新版；实际验证过 `0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.3` 和 `0.2.1-rc.4`。主要在 Windows 11 + WSL2 下使用，DSH 运行在 WSL 中；`rc.3`、`rc.4` 兼容验证使用 Node.js `22.23.4`。

使用前需要：

- DSH 的 `web` profile，以及 DSH 支持的 Node.js 版本。
- 安装插件时，WSL 能找到 `pnpm`。
- WSL 能运行 Windows 程序，以便发送 Windows 通知。

Web 里的 minimal 预设可以使用。独立的 `headless`、`sdk` 和 `sdk-minimal` profile 暂不支持。

## 安装

在 WSL 终端运行：

```bash
dsh plugin --profile web add github:herenfor/dsh-sentinel#v0.3.0
```

安装后，等当前任务结束，再重启 DSH 并刷新浏览器页面。插件会自动加载，无需手动添加源码路径。

如果之前用本地路径手动加载过测试版，请删除 profile 中旧的 `task-notify` 条目，避免它覆盖新安装的版本。

以前装过 dsh-task-notify 的，先卸载它再安装本包，通知设置会保留：

```bash
dsh plugin --profile web remove dsh-task-notify
```

## 开启浏览器通知

1. 打开 DSH 的 **设置 → 任务通知**。
2. 点击 **启用浏览器通知**，在浏览器提示中选择允许。
3. 点击 **测试通知**，确认能收到提醒。

浏览器通知的标题说明发生了什么：`DSH · 本轮已完成`、`DSH · 等你回答`（本轮结束，还有问题没回答）、`DSH · 需要审批` 或 `DSH · 需要你回答`，能获取到对话标题时会一起显示。测试通知会标为 `DSH · 通知测试`。

浏览器通知需要有一个 DSH 页面保持连接。关闭所有页面、关闭浏览器通知，或未授予权限时，插件会使用 Windows 通知。

通知权限按浏览器和网站地址分别保存。换了浏览器、端口或域名，需要重新允许通知。页面应通过本机 `localhost` / `127.0.0.1` 或 HTTPS 打开。

## Windows 通知

默认使用 Windows 自带的 **PowerShell 5.1**，支持中文，不需要额外安装模块。通知会显示 `DeepSeek Harness` 和鲸鱼图标，提示“任务已完成”“等你回答”“需要审批”或“需要你回答”。

如果这条路径失败，插件会再尝试 **pwsh + BurntToast 1.1.0**。想启用这条备用路径，可以在 Windows 的 pwsh 中运行：

```powershell
Install-Module BurntToast -RequiredVersion 1.1.0 -Scope CurrentUser
```

浏览器通知的声音取决于浏览器和 Windows 设置；Windows 保底通知使用默认提示音。如果没有看到通知或听到声音，也可以检查系统通知设置和勿扰模式。

## 托盘图标（可选）

插件包里还带了一个可选的 Windows 托盘图标，把 DSH 当成一个普通应用来用：

- 双击启动：DSH 没在运行就先启动它，然后打开网页；已经在运行就直接打开网页；
- 单击图标打开网页；右键菜单“重启 DSH”先停再启动（改了插件或配置后用，会中断正在运行的任务，所以先确认），启动后重新打开网页；“停止 DSH”会停掉 DSH，图标也一起退出；
- 菜单跟随 Windows 的深色/浅色模式。

它不是 DSH 插件，需要单独安装一次。在 WSL 里运行：

```bash
bash ~/.dsh/profiles/web/node_modules/dsh-sentinel/tray/install.sh
```

文件会复制到 `%USERPROFILE%\DshTray`。安装时会问两件事：要不要在桌面创建“DSH”快捷方式（默认要），以及要不要开机时显示托盘图标（默认不要；开机只显示图标，不启动 DSH）。也可以直接用 `--desktop` / `--no-desktop`、`--autostart` / `--no-autostart` 指定；DSH 不在 3080 端口时用 `--port`。之后双击桌面上的“DSH”，或者 `%USERPROFILE%\DshTray` 里的 `start-dsh-tray.vbs` 启动。

托盘默认用 `dsh web --no-open` 启动 DSH，它只负责启动和停止，不会升级 DSH。如果你有自己的启动脚本，可以在 `~/.config/dsh-tray/env` 里改用它：

```bash
DSH_TRAY_START='my-launcher --no-open'   # 需要自己转入后台
DSH_TRAY_STOP='my-launcher stop'
DSH_TRAY_LOG="$HOME/.cache/my-launcher.log"   # 启动脚本写入 "dsh web: <地址>" 的日志
```

不想要了，删掉 `%USERPROFILE%\DshTray`、桌面上的“DSH”快捷方式和“启动”文件夹里的 `DSH tray.vbs` 即可。

## 崩溃防护

DSH 崩溃后（比如某个插件抛出没人处理的错误，整个进程退出），自动做三件事：

- 把崩溃报告写到 `~/.dsh/logs/dsh-sentinel/crashes/<时间>/`：退出码、错误、堆栈，以及从堆栈判断的疑似插件；令牌和密钥会打码。
- 启动一个**紧急 DSH**：用官方默认配置（profile 名 `sentinel-rescue`），不带任何第三方插件，工作区就是出问题的配置目录，可以让里面的 agent 帮你修。
- 在浏览器里打开一个说明页面，告诉你 DSH 崩溃了、现在打开的是紧急 DSH、疑似原因是什么，并给出一段可以直接发给 agent 的求助说明；在 WSL 下还会发一条 Windows 通知。

说明页面是一个本地文件，浏览器地址栏显示 `file:///…`：DSH 已经停了也能打开，不依赖任何服务。WSL 下直接用 Windows 的默认浏览器打开，不经过 `.html` 文件的打开方式设置（很多电脑没设，Windows 会问用什么程序打开）。

它不会改你的任何配置。修好之后，按页面上的命令关掉紧急 DSH，再像平时一样启动。

### 怎样才能生效

崩溃防护分两层，覆盖范围不同：

| 你怎么启动 DSH | 运行中崩溃 | 启动就失败（配置写错、插件装坏） |
|---|---|---|
| 装好插件、照常启动 | ✅ | ❌ 插件还没加载，看不到 |
| 通过启动器 `dsh-sentinel-run` 启动 | ✅ | ✅ |

1. **装好插件并重启 DSH**：运行中的崩溃就有保护了，不用做别的。
2. **想把"启动就失败"也覆盖上**，DSH 要由启动器启动：
   - 用托盘图标启动的：托盘默认已经通过启动器启动，不用改（在 `~/.config/dsh-tray/env` 里换成了自己的启动脚本的除外，见下一条）。
   - 在终端里自己启动的：把命令前面加上启动器，例如
     ```bash
     node ~/.dsh/profiles/web/node_modules/dsh-sentinel/bin/dsh-sentinel-run.mjs -- dsh web --port 3080
     ```
   - 用自己的启动脚本的：把脚本里调用 `dsh web` 的那一行同样加上 `node ~/.dsh/profiles/web/node_modules/dsh-sentinel/bin/dsh-sentinel-run.mjs --` 前缀。

   启动器会把 DSH 的输出原样转出来，按 Ctrl+C 或托盘的“停止 DSH”正常停止时不会报警。

### 试一下

```bash
DSH_SENTINEL_CRASH_TEST=10 dsh web
```

先停掉正在运行的 DSH（或者换个端口，比如加 `--port 3090`）。DSH 会在 10 秒后故意崩溃，应该会看到说明页面和紧急 DSH，报告里标明这是自测。试完按页面上的命令关掉紧急 DSH。

### 设置

在自己的 `cordis.patch.yml` 里改：

```yaml
- id: sentinel-crash-guard
  config:
    rescue: true     # 崩溃后启动紧急 DSH
    openPage: true   # 打开说明页面
    notify: true     # 发 Windows 通知
```

整个关掉写 `disabled: true`。启动器也可以加 `--no-rescue`、`--no-open`、`--no-notify`。

### 限制

- 被 `kill -9` 或系统因内存不足强制结束时，DSH 没有机会留下记录，不会报警。
- 疑似插件是从堆栈推断的，错误发生在 DSH 自己的代码里时会写"无法判断"。
- 紧急 DSH 和原来的 DSH 共用 `~/.dsh`（会话、登录、API key 都在），需要 `dsh` 命令行；桌面版 DSH 不支持。
- 同一时间只有一个紧急 DSH：它还开着时再次崩溃，只会更新报告和页面。
- 在 DSH `0.2.1-rc.5`（WSL）下实测过：运行中崩溃、配置写坏后启动失败、正常停止不报警。

## 插件健康检查（可选，默认关闭）

DSH 里某个插件没加载上时（比如两个插件注册了同名工具、插件导入就报错、它依赖的服务不存在），DSH 只在终端日志里留一条警告，照常运行，你往往发现不了。这个检查会把它们找出来：

- DSH 启动完成时检查一次已启用的插件，列出没有正常运行的，并尽量给出原因；之后只在插件状态变化时（热重载配置、安装或启停插件）再查，不定时轮询——插件只会在这些时候出问题；
- 出现新的问题时发一条 Windows 通知（同一个问题只提醒一次）；
- 在 设置 → 插件健康 里查看；也可以直接打开 `http://127.0.0.1:<端口>/dsh-sentinel/health`。这是一个独立页面，聊天界面坏了也能打开，需要先在同一个浏览器里登录过 DSH。

它只读取插件的状态，不会停用或修改任何插件。

启用：在自己的 `cordis.patch.yml` 里加上下面两行，然后重启 DSH。

```yaml
- id: sentinel-health
  disabled: false
```

不要 Windows 通知可以再加 `config: { notify: false }`。

做不到的：

- 插件导入就失败时，DSH 不保存原因，这里只能写“没有启动”，原因要看 DSH 的启动日志。
- 只看服务端（DSH 主程序）的插件。浏览器端没加载上的，DSH 自己会显示 Failed to load plugins。
- 不报错的冲突看不出来，比如两个插件改了同一样东西、结果互相覆盖。
- DSH 整个崩溃时由上面的崩溃防护处理，不归它管。

## 卸载

```bash
dsh plugin --profile web remove dsh-sentinel
```

卸载后重启 DSH。Windows 中已经登记的通知名称和图标会保留。

## 遇到问题

- **浏览器没有通知**：先点击设置里的“测试通知”，检查网站通知权限。这一步只测试浏览器通知。
- **想单独测试 Windows 通知**：在插件源码目录中，从 WSL 运行 `./notify-windows.sh`。
- **安装后看不到“任务通知”设置**：确认正在使用 `web` profile，已重启 DSH 并刷新页面；检查是否还留有旧测试版的手动配置。

仍有问题，可以到 [Issues](https://github.com/herenfor/dsh-sentinel/issues) 反馈，附上 DSH 版本、浏览器和复现步骤。分享日志前，请去掉凭证、私有启动链接和会话信息。

## 参与开发

想了解实现细节、从本地安装或打包，可以看 [开发说明](DEVELOPING.md)。提交修改前可以参考 [贡献指南](CONTRIBUTING.md)，版本变化记在 [更新记录](CHANGELOG.md) 中。

## 许可证

代码采用 [MIT](LICENSE) 许可证。鲸鱼图标来自 DeepSeek Harness，出处和原始许可见 [第三方声明](THIRD_PARTY_NOTICES.md)。本项目不是 DeepSeek 官方插件。
