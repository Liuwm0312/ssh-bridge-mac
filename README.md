# SSH Bridge Mac

Mac-only Codex plugin for real PTY-backed interactive SSH terminal sessions.

This repository is separate from the cross-platform `ssh-bridge` plugin. It keeps the same plugin name, `ssh-bridge`, but focuses on terminal-like interaction on macOS by wrapping `ssh -tt` with `/usr/bin/script`, which gives the remote process a real pseudo-terminal.

## Why Mac Only

macOS provides Unix-like SSH tooling and `/usr/bin/script` out of the box. That lets the plugin support interactive programs more naturally than a plain `spawn("ssh")` pipe.

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

## Keystrokes

Send raw control characters when needed:

- Enter: `\n`
- Ctrl-C: `\u0003`
- Ctrl-D: `\u0004`
- Escape: `\u001b`
- Quit many full-screen tools: `q`

## Safety Notes

This plugin is intentionally closer to a real terminal than the original structured SSH Bridge. It is therefore more powerful and easier to misuse.

Prefer the original cross-platform `ssh-bridge` for audited file writes, deploy plans, production approvals, and policy-heavy operations. Use this Mac PTY version when the task genuinely needs interactive terminal behavior.
