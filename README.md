# SSH Bridge Mac

中文 | [English](#english)

## 中文

`SSH Bridge Mac` 是一个 macOS 专用的 Codex 插件，用于创建真正 PTY 支持的交互式 SSH 终端会话。

它和跨平台版 `ssh-bridge` 是两个独立仓库。这个仓库里的插件名称仍然是 `ssh-bridge`，但重点是 macOS 下接近真实终端的交互体验：插件通过一个小型 Python `pty` helper 运行 `ssh -tt`，让远程 Linux 进程看到真正的伪终端。

### 为什么是 Mac 专用

macOS 自带类 Unix 的 SSH 工具和 Python 标准库 `pty` 模块。相比普通的 `spawn("ssh")` 管道，这种方式更适合支持交互式程序。

适合的场景包括：

- 打开交互式 SSH shell
- 运行需要 TTY 的命令
- 使用 `top`、`less`、REPL、交互式安装器、菜单式命令
- 分段读取终端输出
- 发送 `q`、`Ctrl-C`、方向键等原始按键

### 工具列表

- `ssh_mac_list_hosts`
- `ssh_mac_open_terminal`
- `ssh_mac_send`
- `ssh_mac_read`
- `ssh_mac_screen`
- `ssh_mac_key`
- `ssh_mac_wait_for_text`
- `ssh_mac_type_and_wait`
- `ssh_mac_run_visible`
- `ssh_mac_expect`
- `ssh_mac_terminal_state`
- `ssh_mac_show_terminal`
- `ssh_mac_hide_terminal`
- `ssh_mac_resize`
- `ssh_mac_list_sessions`
- `ssh_mac_host_profile`
- `ssh_mac_fleet_summary`
- `ssh_mac_session_record`
- `ssh_mac_session_replay`
- `ssh_mac_read_file`
- `ssh_mac_backup_file`
- `ssh_mac_diff_file`
- `ssh_mac_write_file`
- `ssh_mac_close`

### 快速开始

1. 修改 [hosts.json](./hosts.json)。
2. 确认这台 Mac 可以免密码登录目标主机：

```bash
ssh user@host
```

3. 在 Codex 中启用插件并重新加载。
4. 打开一个会话：

```json
{
  "session": "dev",
  "host": "example",
  "cols": 120,
  "rows": 40
}
```

5. 用 `ssh_mac_send` 发送命令：

```json
{
  "session": "dev",
  "input": "pwd\n"
}
```

6. 用 `ssh_mac_read` 读取输出。
7. 需要接近终端操作时，优先用 `ssh_mac_screen` 查看当前屏幕，用 `ssh_mac_key` 发送常用按键。
8. 想旁观 Codex 操作时，对该会话调用 `ssh_mac_show_terminal`。

### 按键

需要时可以发送原始控制字符：

- Enter: `\n`
- Ctrl-C: `\u0003`
- Ctrl-D: `\u0004`
- Escape: `\u001b`
- 退出很多全屏工具：`q`

也可以用 `ssh_mac_key` 发送具名按键：

- `enter`
- `tab`
- `escape`
- `ctrl-c`
- `ctrl-d`
- `ctrl-o`
- `ctrl-x`
- `up`
- `down`
- `left`
- `right`
- `home`
- `end`
- `page-up`
- `page-down`
- `delete`
- `backspace`

### 屏幕快照

`ssh_mac_screen` 会根据 ANSI 输出维护一个尽力而为的终端屏幕模型。它会跟踪行列数、光标位置、清屏、清行和常见光标移动序列，让 Codex 更像是在看当前终端屏幕，而不是只读原始输出日志。

### 终端状态识别

`ssh_mac_terminal_state` 会判断当前屏幕状态，并返回 Codex 下一步操作提示。它可以识别：

- `shell`
- `pager`，例如 `less`、`more`、`man`
- `editor`，例如 `vim`、`nano`
- `monitor`，例如 `top`、`htop`
- `repl`，例如数据库 shell 或语言 REPL
- `prompt`，例如密码、yes/no、y/n 等交互提示
- `blank`、`closed` 或 `unknown`

返回结果包含 `mode`、`detectedProgram`、`confidence`、`hints`、`recommendedKeys` 和当前 `screen` 快照。

`screen` 是对当前终端画面的最佳近似解析。它会处理常见 ANSI/xterm 控制序列，包括光标移动、清屏/清行、保存/恢复光标、滚动区域、插入/删除字符、插入/删除行、alternate screen，以及 OSC 窗口标题。它仍然不是完整图形终端模拟器，但对 `less`、`top`、`vim`、菜单程序和普通 shell 已经更接近真实 Terminal 画面。

### 终端式工作流工具

- `ssh_mac_type_and_wait`：发送任意输入，然后等待指定文本或短暂等待，返回当前屏幕和状态。
- `ssh_mac_run_visible`：发送一条 shell 命令并回车，镜像窗口会显示 `$ command`，然后返回当前屏幕和状态。
- `ssh_mac_expect`：等待多个候选文本之一出现，适合菜单、提示符和交互安装流程。
- `ssh_mac_session_record`：导出当前会话 transcript，可用于复盘或生成操作记录。
- `ssh_mac_session_replay`：导出一个本地 shell replay 脚本，用于近似回放会话 transcript。

### 多主机与硬件画像

- `ssh_mac_host_profile`：对单台主机做非交互巡检，采集 OS、CPU、内存、磁盘、网络和硬件线索。
- `ssh_mac_fleet_summary`：对配置中的多台主机批量巡检，返回结构化结果和 TSV 表格。

硬件画像会尽量识别 Jetson、Raspberry Pi、x86 Intel/AMD 和普通 ARM Linux。Jetson 会探测 `jtop`、`tegrastats`，Raspberry Pi 会探测 `vcgencmd` 和设备树型号。

### 安全文件操作

- `ssh_mac_read_file`：读取远端文本文件。
- `ssh_mac_backup_file`：创建带时间戳的远端文件备份。
- `ssh_mac_diff_file`：比较远端当前内容和拟写入内容。
- `ssh_mac_write_file`：写入远端文件，默认要求先看过 diff 并传入 `diffAck: true`，默认会先备份。

这些工具要求远端路径是绝对路径，避免误写当前目录下的未知位置。

### 可选本地 Terminal 镜像

镜像默认关闭。只有在你要求时，Codex 才会打开本机 Terminal.app 窗口：

```json
{
  "session": "dev"
}
```

对已有会话调用 `ssh_mac_show_terminal`，可以打开一个只读的 Terminal.app 镜像窗口。也可以在调用 `ssh_mac_open_terminal` 时传入 `"show": true`。

同一个会话重复调用 `ssh_mac_show_terminal` 时，默认会复用已有镜像状态，不会再开新窗口。如果你已经手动关闭了原来的 Terminal.app 窗口，并且想重新打开一个旁观窗口，可以传入：

```json
{
  "session": "dev",
  "reopen": true
}
```

镜像窗口会 `tail -f` 查看 `state/mirrors/` 下的会话 transcript。Codex 仍然通过 MCP 工具控制真正的 PTY 输入；Terminal.app 窗口只是给你旁观，不建议在里面输入。用 `ssh_mac_hide_terminal` 可以停止继续写入镜像 transcript。传入 `"closeTail": true` 会尝试停止 tail 进程；传入 `"closeWindow": true` 会尝试关闭插件记录到的 Terminal.app tab/window。

镜像 transcript 会显示 Codex 发送的命令，例如 `$ ls -la ~`。通过 `ssh_mac_key` 发送的特殊按键会显示成 `[ssh-bridge-mac key] ctrl-c` 这类可读标记。

只有当你想让每个新会话都自动请求镜像窗口时，才设置：

```text
SSH_BRIDGE_MAC_SHOW_ON_OPEN=true
```

### 安全说明

这个插件比原来的结构化 `ssh-bridge` 更接近真实终端，因此能力更强，也更容易误操作。

涉及审计文件写入、部署计划、生产审批、策略控制时，优先使用原来的跨平台 `ssh-bridge`。只有任务确实需要交互式终端行为时，再使用这个 Mac PTY 版本。

## English

`SSH Bridge Mac` is a macOS-only Codex plugin for real PTY-backed interactive SSH terminal sessions.

This repository is separate from the cross-platform `ssh-bridge` plugin. It keeps the same plugin name, `ssh-bridge`, but focuses on terminal-like interaction on macOS by running `ssh -tt` behind a small Python `pty` helper, which gives the remote process a real pseudo-terminal.

### Why Mac Only

macOS provides Unix-like SSH tooling and Python's standard `pty` module out of the box. That lets the plugin support interactive programs more naturally than a plain `spawn("ssh")` pipe.

This version is intended for workflows such as:

- opening an interactive SSH shell
- running commands that expect a TTY
- using `top`, `less`, REPLs, installers, and menu-driven commands
- reading terminal output incrementally
- sending raw keystrokes such as `q`, `Ctrl-C`, or arrow/control sequences

### Tools

- `ssh_mac_list_hosts`
- `ssh_mac_open_terminal`
- `ssh_mac_send`
- `ssh_mac_read`
- `ssh_mac_screen`
- `ssh_mac_key`
- `ssh_mac_wait_for_text`
- `ssh_mac_type_and_wait`
- `ssh_mac_run_visible`
- `ssh_mac_expect`
- `ssh_mac_terminal_state`
- `ssh_mac_show_terminal`
- `ssh_mac_hide_terminal`
- `ssh_mac_resize`
- `ssh_mac_list_sessions`
- `ssh_mac_host_profile`
- `ssh_mac_fleet_summary`
- `ssh_mac_session_record`
- `ssh_mac_session_replay`
- `ssh_mac_read_file`
- `ssh_mac_backup_file`
- `ssh_mac_diff_file`
- `ssh_mac_write_file`
- `ssh_mac_close`

### Quick Start

1. Edit [hosts.json](./hosts.json).
2. Make sure your Mac can SSH to the target without a password prompt:

```bash
ssh user@host
```

3. Enable the plugin in Codex and reload.
4. Open a session:

```json
{
  "session": "dev",
  "host": "example",
  "cols": 120,
  "rows": 40
}
```

5. Send commands with `ssh_mac_send`:

```json
{
  "session": "dev",
  "input": "pwd\n"
}
```

6. Read output with `ssh_mac_read`.
7. For terminal-like operation, prefer `ssh_mac_screen` for the current screen and `ssh_mac_key` for common keys.
8. When you want to watch Codex operate, call `ssh_mac_show_terminal` for the session.

### Keystrokes

Send raw control characters when needed:

- Enter: `\n`
- Ctrl-C: `\u0003`
- Ctrl-D: `\u0004`
- Escape: `\u001b`
- Quit many full-screen tools: `q`

Or use `ssh_mac_key` with names such as:

- `enter`
- `tab`
- `escape`
- `ctrl-c`
- `ctrl-d`
- `ctrl-o`
- `ctrl-x`
- `up`
- `down`
- `left`
- `right`
- `home`
- `end`
- `page-up`
- `page-down`
- `delete`
- `backspace`

### Screen Snapshots

`ssh_mac_screen` keeps a best-effort terminal screen model from ANSI output. It tracks rows, columns, cursor position, screen clears, line clears, and common cursor movement sequences. This makes Codex behave more like it is looking at the current terminal screen instead of only reading an output log.

### Terminal State Detection

`ssh_mac_terminal_state` classifies the current screen and returns hints for what Codex should do next. It can identify common states such as:

- `shell`
- `pager` for `less`, `more`, and `man`
- `editor` for `vim` and `nano`
- `monitor` for `top` and `htop`
- `repl` for database and programming language shells
- `prompt` for password, yes/no, and other interactive prompts
- `blank`, `closed`, or `unknown`

The result includes `mode`, `detectedProgram`, `confidence`, `hints`, `recommendedKeys`, and the current `screen` snapshot.

`screen` is a best-effort parse of the current terminal display. It handles common ANSI/xterm controls including cursor movement, erase screen/line, save/restore cursor, scroll regions, insert/delete characters, insert/delete lines, alternate screen, and OSC window titles. It is still not a complete graphical terminal emulator, but it is much closer to Terminal.app behavior for `less`, `top`, `vim`, menu programs, and normal shells.

### Terminal Workflow Tools

- `ssh_mac_type_and_wait`: send arbitrary input, then wait for text or briefly pause, returning the current screen and state.
- `ssh_mac_run_visible`: send a shell command with Enter, show `$ command` in the mirror, then return the current screen and state.
- `ssh_mac_expect`: wait for one of several candidate text fragments, useful for menus, prompts, and interactive installers.
- `ssh_mac_session_record`: export the current session transcript for review or operation records.
- `ssh_mac_session_replay`: export a local shell replay script that approximates the session transcript.

### Fleet And Hardware Profiles

- `ssh_mac_host_profile`: collect a non-interactive OS, CPU, memory, disk, network, and hardware profile for one host.
- `ssh_mac_fleet_summary`: inspect multiple configured hosts and return structured results plus a TSV table.

Hardware detection tries to identify Jetson, Raspberry Pi, x86 Intel/AMD, and generic ARM Linux. Jetson probes include `jtop` and `tegrastats`; Raspberry Pi probes include `vcgencmd` and the device-tree model.

### Safer File Operations

- `ssh_mac_read_file`: read a remote text file.
- `ssh_mac_backup_file`: create a timestamped remote backup.
- `ssh_mac_diff_file`: compare current remote content with proposed replacement content.
- `ssh_mac_write_file`: write a remote file, requiring `diffAck: true` after reviewing the diff and backing up by default.

These tools require absolute remote paths to avoid writing to an unexpected working directory.

### Optional Local Terminal Mirror

Mirroring is off by default. Codex can open a local Terminal.app window only when requested:

```json
{
  "session": "dev"
}
```

Use `ssh_mac_show_terminal` to open a read-only Terminal.app mirror for an existing session. Or pass `"show": true` when calling `ssh_mac_open_terminal`.

Repeated `ssh_mac_show_terminal` calls for the same session reuse the existing mirror state by default and do not open another window. If you manually closed the original Terminal.app window and want to open a new watcher, pass:

```json
{
  "session": "dev",
  "reopen": true
}
```

The mirror tails a session transcript under `state/mirrors/`. Codex still controls the real PTY input through MCP tools; the Terminal.app window is for watching, not typing. Use `ssh_mac_hide_terminal` to stop writing new output to the mirror transcript. Pass `"closeTail": true` to try to stop the tail process, and `"closeWindow": true` to try to close the tracked Terminal.app tab/window.

The mirror transcript shows commands sent by Codex, such as `$ ls -la ~`. Special keys sent through `ssh_mac_key` are shown as readable markers like `[ssh-bridge-mac key] ctrl-c`.

Set `SSH_BRIDGE_MAC_SHOW_ON_OPEN=true` only if you want every new session to request a mirror window automatically.

### Safety Notes

This plugin is intentionally closer to a real terminal than the original structured SSH Bridge. It is therefore more powerful and easier to misuse.

Prefer the original cross-platform `ssh-bridge` for audited file writes, deploy plans, production approvals, and policy-heavy operations. Use this Mac PTY version when the task genuinely needs interactive terminal behavior.
