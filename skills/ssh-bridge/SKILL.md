---
name: ssh-bridge
description: Use when Codex should operate an interactive macOS PTY-backed SSH terminal session through the ssh-bridge-mac plugin.
---

# SSH Bridge Mac

Use this skill for the Mac-only interactive PTY version of SSH Bridge.

## Tool Preference

- Use `ssh_mac_list_hosts` to inspect configured aliases.
- Use `ssh_mac_open_terminal` to start a named interactive SSH session.
- Use `ssh_mac_send` to send commands or raw keystrokes.
- Use `ssh_mac_read` after every send to observe the terminal state.
- Use `ssh_mac_screen` when you need the current terminal screen rather than raw output history.
- Use `ssh_mac_key` for named keys such as `enter`, `tab`, `ctrl-c`, `ctrl-d`, `escape`, arrows, `page-up`, and `page-down`.
- Use `ssh_mac_wait_for_text` after sending input when waiting for a prompt, menu, login banner, or command output.
- Use `ssh_mac_terminal_state` before acting inside full-screen or ambiguous terminal states.
- Use `ssh_mac_show_terminal` only when the user asks to watch the session locally.
- Do not call `ssh_mac_show_terminal` repeatedly for the same session unless the user closed the previous mirror and asks to reopen it; use `reopen: true` in that case.
- Use `ssh_mac_hide_terminal` when the user asks to stop showing local terminal output.
- Use `ssh_mac_resize` when full-screen output wraps badly.
- Use `ssh_mac_close` when the session is no longer needed.

## Interaction Rules

- Always read the terminal output after opening a session.
- Prefer `ssh_mac_screen` after opening or changing full-screen programs.
- Prefer `ssh_mac_terminal_state` when the screen may be a pager, editor, monitor, REPL, or interactive prompt.
- Do not enable local Terminal.app mirroring unless the user asks; the default is headless PTY operation.
- Send shell commands with a trailing newline, for example `pwd\n`.
- Prefer `ssh_mac_key` over raw control characters when a named key exists.
- For full-screen programs, use raw keystrokes deliberately:
  - `q` to quit many pagers and monitors.
  - `\u0003` for Ctrl-C.
  - `\u0004` for Ctrl-D.
  - `\u001b` for Escape.
- Prefer short, observable steps. Do not send a long destructive command chain into an interactive terminal.
- Close idle sessions when finished.

## Safety

This plugin is closer to a real terminal than the structured cross-platform SSH Bridge. Use extra care on production hosts. For audited file writes, deploys, approvals, and policy-heavy changes, prefer the structured SSH Bridge tools instead.
