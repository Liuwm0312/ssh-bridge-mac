# SSH Bridge Mac

Mac-only Codex plugin for real PTY-backed interactive SSH terminal sessions.

This repository is separate from the cross-platform `ssh-bridge` plugin. It keeps the same plugin name, `ssh-bridge`, but focuses on terminal-like interaction on macOS by running `ssh -tt` behind a small Python `pty` helper, which gives the remote process a real pseudo-terminal.

## Why Mac Only

macOS provides Unix-like SSH tooling and Python's standard `pty` module out of the box. That lets the plugin support interactive programs more naturally than a plain `spawn("ssh")` pipe.

This version is intended for workflows such as:

- opening an interactive SSH shell
- running commands that expect a TTY
- using `top`, `less`, REPLs, installers, and menu-driven commands
- reading terminal output incrementally
- sending raw keystrokes such as `q`, `Ctrl-C`, or arrow/control sequences

## Tools

- `ssh_mac_list_hosts`
- `ssh_mac_open_terminal`
- `ssh_mac_send`
- `ssh_mac_read`
- `ssh_mac_screen`
- `ssh_mac_key`
- `ssh_mac_wait_for_text`
- `ssh_mac_terminal_state`
- `ssh_mac_show_terminal`
- `ssh_mac_hide_terminal`
- `ssh_mac_resize`
- `ssh_mac_list_sessions`
- `ssh_mac_close`

## Quick Start

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

## Keystrokes

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

## Screen Snapshots

`ssh_mac_screen` keeps a best-effort terminal screen model from ANSI output. It tracks rows, columns, cursor position, screen clears, line clears, and common cursor movement sequences. This makes Codex behave more like it is looking at the current terminal screen instead of only reading an output log.

## Terminal State Detection

`ssh_mac_terminal_state` classifies the current screen and returns hints for what Codex should do next. It can identify common states such as:

- `shell`
- `pager` for `less`, `more`, and `man`
- `editor` for `vim` and `nano`
- `monitor` for `top` and `htop`
- `repl` for database and programming language shells
- `prompt` for password, yes/no, and other interactive prompts
- `blank`, `closed`, or `unknown`

The result includes `mode`, `detectedProgram`, `confidence`, `hints`, `recommendedKeys`, and the current `screen` snapshot.

## Optional Local Terminal Mirror

Mirroring is off by default. Codex can open a local Terminal.app window only when requested:

```json
{
  "session": "dev"
}
```

Use `ssh_mac_show_terminal` to open a read-only Terminal.app mirror for an existing session. Or pass `"show": true` when calling `ssh_mac_open_terminal`.

The mirror tails a session transcript under `state/mirrors/`. Codex still controls the real PTY input through MCP tools; the Terminal.app window is for watching, not typing. Use `ssh_mac_hide_terminal` to stop writing new output to the mirror transcript. The Terminal tail window may remain open until you close it.

Set `SSH_BRIDGE_MAC_SHOW_ON_OPEN=true` only if you want every new session to request a mirror window automatically.

## Safety Notes

This plugin is intentionally closer to a real terminal than the original structured SSH Bridge. It is therefore more powerful and easier to misuse.

Prefer the original cross-platform `ssh-bridge` for audited file writes, deploy plans, production approvals, and policy-heavy operations. Use this Mac PTY version when the task genuinely needs interactive terminal behavior.
