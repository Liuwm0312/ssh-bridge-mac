#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SERVER_INFO = { name: "ssh-bridge", version: "0.4.0" };
const PROTOCOL_VERSION = "2025-03-26";
const sessions = new Map();

const toolDefinitions = [
  {
    name: "ssh_mac_list_hosts",
    description: "List configured SSH host profiles for the Mac PTY bridge.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "ssh_mac_open_terminal",
    description: "Open a real macOS PTY-backed interactive SSH terminal session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session name." },
        host: { type: "string", description: "Host alias, hostname, or IP address." },
        user: { type: "string", description: "Remote username override." },
        port: { type: "integer", description: "SSH port override." },
        identityFile: { type: "string", description: "Local private key path override." },
        cols: { type: "integer", description: "Terminal columns.", default: 120 },
        rows: { type: "integer", description: "Terminal rows.", default: 40 },
        command: { type: "string", description: "Optional initial remote command." },
        show: { type: "boolean", description: "Open a local Terminal.app mirror window for this session.", default: false }
      },
      required: ["session", "host"]
    }
  },
  {
    name: "ssh_mac_send",
    description: "Send raw text or keystrokes to an open PTY SSH terminal session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session name." },
        input: { type: "string", description: "Text to write. Include \\n for Enter." }
      },
      required: ["session", "input"]
    }
  },
  {
    name: "ssh_mac_read",
    description: "Read buffered terminal output from an open PTY SSH session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session name." },
        sinceSeq: { type: "integer", description: "Return chunks after this sequence number.", default: 0 },
        maxBytes: { type: "integer", description: "Maximum bytes of text to return.", default: 20000 },
        stripAnsi: { type: "boolean", description: "Remove ANSI escape sequences from returned text.", default: false }
      },
      required: ["session"]
    }
  },
  {
    name: "ssh_mac_screen",
    description: "Return the current best-effort terminal screen snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session name." },
        trimRight: { type: "boolean", description: "Trim trailing spaces from each screen row.", default: true }
      },
      required: ["session"]
    }
  },
  {
    name: "ssh_mac_key",
    description: "Send a named terminal key or key sequence to an open PTY SSH session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session name." },
        key: {
          type: "string",
          description: "Named key such as enter, tab, escape, ctrl-c, ctrl-d, up, down, left, right, home, end, page-up, page-down, delete, backspace, q."
        },
        repeat: { type: "integer", description: "Number of times to send the key.", default: 1 }
      },
      required: ["session", "key"]
    }
  },
  {
    name: "ssh_mac_wait_for_text",
    description: "Wait until text appears in the current screen or buffered terminal output.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session name." },
        text: { type: "string", description: "Text to wait for." },
        timeoutMs: { type: "integer", description: "Maximum wait in milliseconds.", default: 5000 },
        includeBuffer: { type: "boolean", description: "Also search buffered output chunks.", default: true }
      },
      required: ["session", "text"]
    }
  },
  {
    name: "ssh_mac_terminal_state",
    description: "Classify the current terminal state, including likely full-screen programs and recommended keys.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session name." }
      },
      required: ["session"]
    }
  },
  {
    name: "ssh_mac_show_terminal",
    description: "Open a local Terminal.app mirror window for an existing PTY SSH session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session name." }
      },
      required: ["session"]
    }
  },
  {
    name: "ssh_mac_hide_terminal",
    description: "Stop writing new output to the local Terminal.app mirror transcript for a session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session name." }
      },
      required: ["session"]
    }
  },
  {
    name: "ssh_mac_resize",
    description: "Resize the remote terminal by sending stty rows/cols to the PTY session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session name." },
        cols: { type: "integer", description: "Terminal columns." },
        rows: { type: "integer", description: "Terminal rows." }
      },
      required: ["session", "cols", "rows"]
    }
  },
  {
    name: "ssh_mac_list_sessions",
    description: "List open Mac PTY SSH terminal sessions.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "ssh_mac_close",
    description: "Close an open PTY SSH terminal session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session name." },
        force: { type: "boolean", description: "Kill immediately instead of sending exit.", default: false }
      },
      required: ["session"]
    }
  }
];

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function getServerRoot() {
  return path.resolve(__dirname, "..");
}

function getStateRoot() {
  return path.join(getServerRoot(), "state");
}

function getMirrorDir() {
  return path.join(getStateRoot(), "mirrors");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeFilePart(value) {
  return String(value || "session").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
}

function expandLocalPath(value) {
  if (!value) return value;
  const expanded = String(value)
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => process.env[name] || "")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => process.env[name] || "")
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_match, name) => process.env[name] || "");
  if (expanded === "~") return os.homedir();
  if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    return path.join(os.homedir(), expanded.slice(2));
  }
  return expanded;
}

function hostsFilePath() {
  const explicit = getEnv("SSH_BRIDGE_MAC_HOSTS_FILE", "");
  return explicit ? path.resolve(getServerRoot(), expandLocalPath(explicit)) : path.join(getServerRoot(), "hosts.json");
}

function loadHosts() {
  const filePath = hostsFilePath();
  if (!fs.existsSync(filePath)) return {};
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return parsed && typeof parsed === "object" ? parsed : {};
}

function normalizeHost(alias, profile) {
  const raw = profile && typeof profile === "object" ? profile : {};
  return {
    alias,
    host: String(raw.host || alias || "").trim(),
    user: String(raw.user || "").trim(),
    port: Number.isInteger(raw.port) ? raw.port : 22,
    identityFile: expandLocalPath(String(raw.identityFile || getEnv("SSH_BRIDGE_MAC_DEFAULT_IDENTITY_FILE", "")).trim()),
    description: String(raw.description || "").trim(),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : []
  };
}

function resolveTarget(args) {
  const hosts = loadHosts();
  const requested = String(args.host || "").trim();
  const profile = hosts[requested] ? normalizeHost(requested, hosts[requested]) : null;
  return {
    alias: profile?.alias || "",
    host: profile?.host || requested,
    user: String(args.user || profile?.user || "").trim(),
    port: Number.isInteger(args.port) ? args.port : profile?.port || 22,
    identityFile: expandLocalPath(String(args.identityFile || profile?.identityFile || getEnv("SSH_BRIDGE_MAC_DEFAULT_IDENTITY_FILE", "")).trim()),
    description: profile?.description || "",
    tags: profile?.tags || []
  };
}

function sshArgs(target, args) {
  const remote = target.user ? `${target.user}@${target.host}` : target.host;
  const result = [
    "-tt",
    "-o", `StrictHostKeyChecking=${getEnv("SSH_BRIDGE_MAC_STRICT_HOST_KEY_CHECKING", "accept-new")}`,
    "-o", "ServerAliveInterval=30",
    "-p", String(target.port)
  ];
  if (target.identityFile) result.push("-i", target.identityFile);
  result.push(remote);
  if (args.command) result.push(String(args.command));
  return result;
}

function maxBufferBytes() {
  const value = Number.parseInt(getEnv("SSH_BRIDGE_MAC_MAX_BUFFER_BYTES", "200000"), 10);
  return Number.isFinite(value) && value > 10000 ? value : 200000;
}

function appendChunk(session, stream, text) {
  const chunk = {
    seq: ++session.seq,
    at: new Date().toISOString(),
    stream,
    text
  };
  session.chunks.push(chunk);
  if (stream === "stdout" || stream === "stderr") {
    feedScreen(session.screen, text);
    appendMirrorOutput(session, text);
  }
  session.bufferBytes += Buffer.byteLength(text, "utf8");
  const limit = maxBufferBytes();
  while (session.bufferBytes > limit && session.chunks.length > 1) {
    const removed = session.chunks.shift();
    session.bufferBytes -= Buffer.byteLength(removed.text, "utf8");
  }
}

function shouldShowOnOpen(args) {
  if (args.show !== undefined) return Boolean(args.show);
  return getEnv("SSH_BRIDGE_MAC_SHOW_ON_OPEN", "false").toLowerCase() === "true";
}

function createMirror(session) {
  ensureDir(getMirrorDir());
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const filePath = path.join(getMirrorDir(), `${safeFilePart(session.name)}-${stamp}.log`);
  const title = `SSH Bridge ${session.name}`;
  fs.writeFileSync(filePath, [
    `SSH Bridge mirror: ${session.name}`,
    `Target: ${session.target.user ? `${session.target.user}@` : ""}${session.target.host}:${session.target.port}`,
    `Started: ${session.createdAt}`,
    "",
    "This is a read-only mirror of Codex's PTY session. Type in Codex tools, not this window.",
    ""
  ].join("\n"), "utf8");
  session.mirror = {
    enabled: false,
    filePath,
    title,
    openedAt: "",
    lastError: ""
  };
}

function appendMirrorOutput(session, text) {
  if (!session.mirror?.enabled) return;
  try {
    fs.appendFileSync(session.mirror.filePath, text, "utf8");
  } catch (error) {
    session.mirror.lastError = error.message;
    session.mirror.enabled = false;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(value) {
  return JSON.stringify(String(value));
}

function openTerminalMirror(session) {
  if (process.platform !== "darwin") {
    throw new Error("Terminal.app mirroring is available only on macOS.");
  }
  if (!session.mirror) createMirror(session);
  session.mirror.enabled = true;
  session.mirror.openedAt = new Date().toISOString();
  const tailCommand = [
    `printf '\\\\033]0;${session.mirror.title}\\\\007'`,
    "clear",
    `tail -n +1 -f ${shellQuote(session.mirror.filePath)}`
  ].join("; ");
  const script = [
    'tell application "Terminal"',
    "activate",
    `do script ${appleScriptString(tailCommand)}`,
    "end tell"
  ].join("\n");
  const result = spawn("osascript", ["-e", script], {
    cwd: getServerRoot(),
    stdio: ["ignore", "pipe", "pipe"]
  });
  result.stdout.on("data", () => {});
  result.stderr.on("data", (data) => {
    session.mirror.lastError = data.toString("utf8");
  });
  return {
    enabled: session.mirror.enabled,
    filePath: session.mirror.filePath,
    title: session.mirror.title,
    note: "A read-only Terminal.app mirror window was requested. Codex still controls the PTY input."
  };
}

function stopTerminalMirror(session) {
  if (!session.mirror) createMirror(session);
  session.mirror.enabled = false;
  try {
    fs.appendFileSync(session.mirror.filePath, "\n[ssh-bridge-mac mirror disabled; close this Terminal window when finished]\n", "utf8");
  } catch (error) {
    session.mirror.lastError = error.message;
  }
  return {
    enabled: false,
    filePath: session.mirror.filePath,
    title: session.mirror.title,
    note: "New PTY output will no longer be mirrored. The Terminal tail window may remain open until closed."
  };
}

function sessionSummary(session) {
  return {
    session: session.name,
    target: session.target,
    pid: session.child.pid,
    open: !session.closed,
    exitCode: session.exitCode,
    signal: session.signal,
    seq: session.seq,
    cols: session.cols,
    rows: session.rows,
    createdAt: session.createdAt,
    closedAt: session.closedAt || "",
    mirror: session.mirror ? {
      enabled: session.mirror.enabled,
      filePath: session.mirror.filePath,
      title: session.mirror.title,
      openedAt: session.mirror.openedAt,
      lastError: session.mirror.lastError
    } : null
  };
}

function requireSession(name) {
  const session = sessions.get(String(name || "").trim());
  if (!session) throw new Error(`Session "${name}" is not open.`);
  return session;
}

function stripAnsi(value) {
  return String(value).replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "");
}

function createScreen(rows, cols) {
  return {
    rows,
    cols,
    cursorRow: 0,
    cursorCol: 0,
    lines: Array.from({ length: rows }, () => Array(cols).fill(" "))
  };
}

function resizeScreen(screen, rows, cols) {
  const oldLines = screen.lines;
  screen.rows = rows;
  screen.cols = cols;
  screen.cursorRow = Math.min(screen.cursorRow, rows - 1);
  screen.cursorCol = Math.min(screen.cursorCol, cols - 1);
  screen.lines = Array.from({ length: rows }, (_unused, row) => {
    const old = oldLines[row] || [];
    const next = Array(cols).fill(" ");
    for (let col = 0; col < Math.min(cols, old.length); col += 1) {
      next[col] = old[col];
    }
    return next;
  });
}

function scrollScreen(screen) {
  screen.lines.shift();
  screen.lines.push(Array(screen.cols).fill(" "));
  screen.cursorRow = screen.rows - 1;
}

function clearLine(screen, mode = 0) {
  const line = screen.lines[screen.cursorRow];
  if (mode === 1) {
    for (let col = 0; col <= screen.cursorCol; col += 1) line[col] = " ";
  } else if (mode === 2) {
    line.fill(" ");
  } else {
    for (let col = screen.cursorCol; col < screen.cols; col += 1) line[col] = " ";
  }
}

function clearScreen(screen, mode = 0) {
  if (mode === 2 || mode === 3) {
    for (const line of screen.lines) line.fill(" ");
    screen.cursorRow = 0;
    screen.cursorCol = 0;
    return;
  }
  if (mode === 1) {
    for (let row = 0; row <= screen.cursorRow; row += 1) {
      const end = row === screen.cursorRow ? screen.cursorCol + 1 : screen.cols;
      for (let col = 0; col < end; col += 1) screen.lines[row][col] = " ";
    }
    return;
  }
  for (let row = screen.cursorRow; row < screen.rows; row += 1) {
    const start = row === screen.cursorRow ? screen.cursorCol : 0;
    for (let col = start; col < screen.cols; col += 1) screen.lines[row][col] = " ";
  }
}

function moveCursor(screen, row, col) {
  screen.cursorRow = Math.max(0, Math.min(screen.rows - 1, row));
  screen.cursorCol = Math.max(0, Math.min(screen.cols - 1, col));
}

function putChar(screen, char) {
  if (screen.cursorCol >= screen.cols) {
    screen.cursorCol = 0;
    screen.cursorRow += 1;
  }
  if (screen.cursorRow >= screen.rows) scrollScreen(screen);
  screen.lines[screen.cursorRow][screen.cursorCol] = char;
  screen.cursorCol += 1;
}

function handleCsi(screen, paramsText, command) {
  const clean = paramsText.replace(/[?=]/g, "");
  const params = clean.split(";").filter(Boolean).map((item) => Number.parseInt(item, 10));
  const first = Number.isFinite(params[0]) ? params[0] : 0;
  if (command === "A") moveCursor(screen, screen.cursorRow - (first || 1), screen.cursorCol);
  if (command === "B") moveCursor(screen, screen.cursorRow + (first || 1), screen.cursorCol);
  if (command === "C") moveCursor(screen, screen.cursorRow, screen.cursorCol + (first || 1));
  if (command === "D") moveCursor(screen, screen.cursorRow, screen.cursorCol - (first || 1));
  if (command === "G") moveCursor(screen, screen.cursorRow, (first || 1) - 1);
  if (command === "H" || command === "f") {
    const row = Number.isFinite(params[0]) && params[0] > 0 ? params[0] - 1 : 0;
    const col = Number.isFinite(params[1]) && params[1] > 0 ? params[1] - 1 : 0;
    moveCursor(screen, row, col);
  }
  if (command === "J") clearScreen(screen, first);
  if (command === "K") clearLine(screen, first);
}

function feedScreen(screen, text) {
  let index = 0;
  const value = String(text || "");
  while (index < value.length) {
    const char = value[index];
    if (char === "\x1b") {
      const next = value[index + 1];
      if (next === "[") {
        let end = index + 2;
        while (end < value.length && !/[A-Za-z~]/.test(value[end])) end += 1;
        if (end < value.length) {
          handleCsi(screen, value.slice(index + 2, end), value[end]);
          index = end + 1;
          continue;
        }
      }
      if (next === "]") {
        const bell = value.indexOf("\x07", index + 2);
        const st = value.indexOf("\x1b\\", index + 2);
        const end = bell === -1 ? st : st === -1 ? bell : Math.min(bell, st);
        if (end !== -1) {
          index = end + (value[end] === "\x1b" ? 2 : 1);
          continue;
        }
      }
      index += 2;
      continue;
    }
    if (char === "\r") {
      screen.cursorCol = 0;
    } else if (char === "\n") {
      screen.cursorRow += 1;
      if (screen.cursorRow >= screen.rows) scrollScreen(screen);
    } else if (char === "\b" || char === "\x7f") {
      screen.cursorCol = Math.max(0, screen.cursorCol - 1);
    } else if (char >= " ") {
      putChar(screen, char);
    }
    index += 1;
  }
}

function screenSnapshot(session, trimRight = true) {
  const lines = session.screen.lines.map((line) => {
    const value = line.join("");
    return trimRight ? value.replace(/\s+$/g, "") : value;
  });
  return {
    rows: session.screen.rows,
    cols: session.screen.cols,
    cursor: {
      row: session.screen.cursorRow + 1,
      col: session.screen.cursorCol + 1
    },
    text: lines.join("\n"),
    lines
  };
}

function compactLines(lines) {
  return lines.map((line) => line.trim()).filter(Boolean);
}

function lastNonEmptyLine(lines) {
  const compact = compactLines(lines);
  return compact.length ? compact[compact.length - 1] : "";
}

function confidence(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function terminalState(session) {
  const screen = screenSnapshot(session, true);
  const text = screen.text;
  const lower = text.toLowerCase();
  const lines = screen.lines;
  const compact = compactLines(lines);
  const lastLine = lastNonEmptyLine(lines);
  const bottom = lines.slice(Math.max(0, lines.length - 4)).join("\n");
  const hints = [];
  const recommendedKeys = [];
  let mode = "unknown";
  let detectedProgram = "";
  let score = 0.35;

  const setState = (nextMode, program, nextScore, nextHints, keys) => {
    mode = nextMode;
    detectedProgram = program;
    score = nextScore;
    hints.splice(0, hints.length, ...nextHints);
    recommendedKeys.splice(0, recommendedKeys.length, ...keys);
  };

  if (/--more--|less\s+\d+|press h for help or q to quit|\(end\)|^:$/im.test(text) || /manual page|^man\(/im.test(text)) {
    setState("pager", lower.includes("man(") || lower.includes("manual page") ? "man/less" : "less/more", 0.86, [
      "This looks like a pager. Use q to quit, page-up/page-down to navigate, or slash search if needed.",
      "Prefer ssh_mac_key for q/page-up/page-down instead of raw input."
    ], ["q", "page-up", "page-down", "up", "down"]);
  } else if (/^\s*(top|htop)\s+-|load average:|tasks:\s+\d+|%cpu|^\s*pid\s+user\s+/im.test(text)) {
    setState("monitor", lower.includes("htop") ? "htop" : "top", 0.88, [
      "This looks like a live monitor. Use q or ctrl-c to exit before running normal shell commands.",
      "Use ssh_mac_screen after key presses to confirm the monitor exited."
    ], ["q", "ctrl-c"]);
  } else if (/--\s*(insert|visual|replace)\s*--|^~\s*$/im.test(text) || /"\S+" \d+L, \d+B|E\d{2,3}:|^\s*\d+,\d+\s+All$/m.test(text)) {
    setState("editor", "vim", 0.82, [
      "This looks like Vim. Use escape before command keys, :wq to save and quit, or :q! to quit without saving.",
      "For normal-mode actions, send escape first if insert/visual mode is visible."
    ], ["escape"]);
  } else if (/GNU nano|^\s*\^G Help\s+\^O Write Out|^\s*\^X Exit/im.test(text)) {
    setState("editor", "nano", 0.9, [
      "This looks like nano. Use ctrl-o to write, ctrl-x to exit, and follow prompts at the bottom.",
      "If Codex needs to cancel, use ctrl-c or answer the bottom prompt deliberately."
    ], ["ctrl-o", "ctrl-x", "ctrl-c"]);
  } else if (/mysql>|postgres=#|postgres=>|psql \(|redis(?:\s+\S+)?>|sqlite>/i.test(text)) {
    setState("repl", "database shell", 0.82, [
      "This looks like an interactive database shell. Use the tool's quit command before returning to normal shell work.",
      "Prefer short commands and read the screen after each command."
    ], ["ctrl-c", "ctrl-d"]);
  } else if (/python \d|node\.js|irb\(|pry\(|^\s*>>> |^\s*\.\.\. |^\s*> $/im.test(text)) {
    setState("repl", "language repl", 0.76, [
      "This looks like a programming REPL. Use ctrl-d or the language-specific exit command to leave it.",
      "Read the screen after each expression because prompts may change."
    ], ["ctrl-d", "ctrl-c"]);
  } else if (/password:|passphrase|are you sure you want to continue connecting|yes\/no|\[y\/n\]|\(y\/n\)/i.test(text)) {
    setState("prompt", "interactive prompt", 0.8, [
      "This looks like an interactive prompt. Answer only if the requested action is expected.",
      "For SSH host-key prompts, verify the host before typing yes."
    ], ["enter", "ctrl-c"]);
  } else if (/\$ $|# $|% $|> $/.test(lastLine) || /\n.*[\w.-]+@[\w.-]+.*[$#%] $/.test(bottom)) {
    setState("shell", "shell prompt", 0.72, [
      "This looks like a shell prompt. It is likely ready for the next command.",
      "Send shell commands with ssh_mac_send and a trailing newline."
    ], ["enter", "tab", "ctrl-c"]);
  } else if (session.closed) {
    setState("closed", "closed session", 0.95, [
      "The PTY process has exited. Open a new terminal session before sending more input."
    ], []);
  } else if (compact.length === 0) {
    setState("blank", "blank screen", 0.55, [
      "The screen is currently blank. The process may still be starting, waiting silently, or using an alternate screen.",
      "Use ssh_mac_read or ssh_mac_wait_for_text if you expect a prompt soon."
    ], ["enter", "ctrl-c"]);
  }

  return {
    mode,
    detectedProgram,
    confidence: confidence(score),
    hints,
    recommendedKeys,
    cursor: screen.cursor,
    screen
  };
}

const KEY_SEQUENCES = {
  enter: "\r",
  return: "\r",
  tab: "\t",
  escape: "\x1b",
  esc: "\x1b",
  "ctrl-c": "\x03",
  interrupt: "\x03",
  "ctrl-d": "\x04",
  eof: "\x04",
  "ctrl-z": "\x1a",
  "ctrl-o": "\x0f",
  "ctrl-x": "\x18",
  q: "q",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  "page-up": "\x1b[5~",
  "page-down": "\x1b[6~",
  delete: "\x1b[3~",
  backspace: "\x7f",
  space: " "
};

function keySequence(key) {
  const normalized = String(key || "").trim().toLowerCase();
  if (KEY_SEQUENCES[normalized] !== undefined) return KEY_SEQUENCES[normalized];
  if (/^f([1-9]|1[0-2])$/.test(normalized)) {
    const values = {
      f1: "\x1bOP", f2: "\x1bOQ", f3: "\x1bOR", f4: "\x1bOS",
      f5: "\x1b[15~", f6: "\x1b[17~", f7: "\x1b[18~", f8: "\x1b[19~",
      f9: "\x1b[20~", f10: "\x1b[21~", f11: "\x1b[23~", f12: "\x1b[24~"
    };
    return values[normalized];
  }
  throw new Error(`Unsupported key "${key}". Use ssh_mac_send for custom raw input.`);
}

function openTerminal(args) {
  const name = String(args.session || "").trim();
  if (!name) throw new Error("session is required.");
  if (sessions.has(name)) throw new Error(`Session "${name}" is already open.`);
  if (process.platform !== "darwin") {
    throw new Error("ssh-bridge-mac requires macOS because it uses a local PTY helper for terminal allocation.");
  }

  const target = resolveTarget(args);
  if (!target.host) throw new Error("host is required.");
  const cols = Number.isInteger(args.cols) ? args.cols : 120;
  const rows = Number.isInteger(args.rows) ? args.rows : 40;
  const env = {
    ...process.env,
    COLUMNS: String(cols),
    LINES: String(rows),
    TERM: process.env.TERM || "xterm-256color"
  };
  const helperPath = path.join(getServerRoot(), "scripts", "pty-ssh-bridge.py");
  const pythonPath = getEnv("SSH_BRIDGE_MAC_PYTHON", "python3");
  const childArgs = [helperPath, "--rows", String(rows), "--cols", String(cols), "--", "ssh", ...sshArgs(target, args)];
  const child = spawn(pythonPath, childArgs, {
    cwd: getServerRoot(),
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  const session = {
    name,
    child,
    target,
    cols,
    rows,
    seq: 0,
    chunks: [],
    bufferBytes: 0,
    createdAt: new Date().toISOString(),
    closed: false,
    exitCode: null,
    signal: null,
    screen: createScreen(rows, cols),
    mirror: null
  };
  createMirror(session);
  sessions.set(name, session);

  child.stdout.on("data", (data) => appendChunk(session, "stdout", data.toString("utf8")));
  child.stderr.on("data", (data) => appendChunk(session, "stderr", data.toString("utf8")));
  child.on("exit", (code, signal) => {
    session.closed = true;
    session.exitCode = code;
    session.signal = signal || "";
    session.closedAt = new Date().toISOString();
    appendChunk(session, "status", `\n[ssh-bridge-mac session exited code=${code} signal=${signal || ""}]\n`);
  });

  const mirror = shouldShowOnOpen(args) ? openTerminalMirror(session) : {
    enabled: false,
    filePath: session.mirror.filePath,
    title: session.mirror.title
  };

  return { ok: true, session: sessionSummary(session), command: pythonPath, args: childArgs, mirror };
}

function sendInput(args) {
  const session = requireSession(args.session);
  if (session.closed || session.child.stdin.destroyed) {
    throw new Error(`Session "${session.name}" is closed.`);
  }
  const input = String(args.input ?? "");
  session.child.stdin.write(input);
  return { ok: true, writtenBytes: Buffer.byteLength(input, "utf8"), session: sessionSummary(session) };
}

function readOutput(args) {
  const session = requireSession(args.session);
  const sinceSeq = Number.isInteger(args.sinceSeq) ? args.sinceSeq : 0;
  const maxBytes = Number.isInteger(args.maxBytes) ? args.maxBytes : 20000;
  const chunks = session.chunks.filter((chunk) => chunk.seq > sinceSeq);
  let bytes = 0;
  const selected = [];
  for (const chunk of chunks) {
    const chunkBytes = Buffer.byteLength(chunk.text, "utf8");
    if (selected.length && bytes + chunkBytes > maxBytes) break;
    selected.push(chunk);
    bytes += chunkBytes;
    if (bytes >= maxBytes) break;
  }
  const text = selected.map((chunk) => chunk.text).join("");
  return {
    ok: true,
    session: sessionSummary(session),
    chunks: selected.map((chunk) => ({
      ...chunk,
      text: args.stripAnsi ? stripAnsi(chunk.text) : chunk.text
    })),
    text: args.stripAnsi ? stripAnsi(text) : text,
    nextSeq: selected.length ? selected[selected.length - 1].seq : sinceSeq
  };
}

function readScreen(args) {
  const session = requireSession(args.session);
  return { ok: true, session: sessionSummary(session), screen: screenSnapshot(session, args.trimRight !== false) };
}

function readTerminalState(args) {
  const session = requireSession(args.session);
  return { ok: true, session: sessionSummary(session), state: terminalState(session) };
}

function showTerminal(args) {
  const session = requireSession(args.session);
  return { ok: true, session: sessionSummary(session), mirror: openTerminalMirror(session) };
}

function hideTerminal(args) {
  const session = requireSession(args.session);
  return { ok: true, session: sessionSummary(session), mirror: stopTerminalMirror(session) };
}

function sendKey(args) {
  const repeat = Number.isInteger(args.repeat) && args.repeat > 0 ? Math.min(args.repeat, 100) : 1;
  const input = keySequence(args.key).repeat(repeat);
  return { ...sendInput({ session: args.session, input }), key: args.key, repeat };
}

function hasText(session, text, includeBuffer) {
  const wanted = String(text || "");
  if (!wanted) return true;
  if (screenSnapshot(session, true).text.includes(wanted)) return true;
  if (includeBuffer) {
    return session.chunks.some((chunk) => stripAnsi(chunk.text).includes(wanted));
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForText(args) {
  const session = requireSession(args.session);
  const text = String(args.text || "");
  const timeoutMs = Number.isInteger(args.timeoutMs) ? Math.max(0, Math.min(args.timeoutMs, 60000)) : 5000;
  const includeBuffer = args.includeBuffer !== false;
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (hasText(session, text, includeBuffer)) {
      return { ok: true, found: true, elapsedMs: Date.now() - startedAt, session: sessionSummary(session), screen: screenSnapshot(session, true) };
    }
    await sleep(100);
  }
  return { ok: true, found: false, elapsedMs: Date.now() - startedAt, session: sessionSummary(session), screen: screenSnapshot(session, true) };
}

function resizeTerminal(args) {
  const session = requireSession(args.session);
  const cols = Number.isInteger(args.cols) ? args.cols : session.cols;
  const rows = Number.isInteger(args.rows) ? args.rows : session.rows;
  session.cols = cols;
  session.rows = rows;
  resizeScreen(session.screen, rows, cols);
  if (!session.closed) {
    session.child.stdin.write(`stty rows ${rows} cols ${cols} 2>/dev/null || true\n`);
  }
  return { ok: true, session: sessionSummary(session) };
}

function closeTerminal(args) {
  const session = requireSession(args.session);
  if (!session.closed) {
    if (args.force) {
      session.child.kill("SIGTERM");
    } else {
      session.child.stdin.write("\x03");
      session.child.stdin.write("exit\n");
      setTimeout(() => {
        if (!session.closed) session.child.kill("SIGTERM");
      }, 1000).unref();
    }
  }
  sessions.delete(session.name);
  return { ok: true, session: sessionSummary(session) };
}

async function callTool(name, args = {}) {
  switch (name) {
    case "ssh_mac_list_hosts":
      return { ok: true, hostsFile: hostsFilePath(), hosts: Object.fromEntries(Object.entries(loadHosts()).map(([alias, profile]) => [alias, normalizeHost(alias, profile)])) };
    case "ssh_mac_open_terminal":
      return openTerminal(args);
    case "ssh_mac_send":
      return sendInput(args);
    case "ssh_mac_read":
      return readOutput(args);
    case "ssh_mac_screen":
      return readScreen(args);
    case "ssh_mac_key":
      return sendKey(args);
    case "ssh_mac_wait_for_text":
      return waitForText(args);
    case "ssh_mac_terminal_state":
      return readTerminalState(args);
    case "ssh_mac_show_terminal":
      return showTerminal(args);
    case "ssh_mac_hide_terminal":
      return hideTerminal(args);
    case "ssh_mac_resize":
      return resizeTerminal(args);
    case "ssh_mac_list_sessions":
      return { ok: true, sessions: [...sessions.values()].map(sessionSummary) };
    case "ssh_mac_close":
      return closeTerminal(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function sendMessage(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

let inputBuffer = Buffer.alloc(0);
process.stdin.on("data", (data) => {
  inputBuffer = Buffer.concat([inputBuffer, data]);
  while (true) {
    const separator = inputBuffer.indexOf("\r\n\r\n");
    if (separator === -1) return;
    const headerText = inputBuffer.slice(0, separator).toString("utf8");
    const match = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      inputBuffer = inputBuffer.slice(separator + 4);
      continue;
    }
    const length = Number.parseInt(match[1], 10);
    const bodyStart = separator + 4;
    const bodyEnd = bodyStart + length;
    if (inputBuffer.length < bodyEnd) return;
    const body = inputBuffer.slice(bodyStart, bodyEnd).toString("utf8");
    inputBuffer = inputBuffer.slice(bodyEnd);
    handleMessage(JSON.parse(body));
  }
});

async function handleMessage(message) {
  if (!message || typeof message !== "object") return;
  try {
    if (message.method === "initialize") {
      sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO
        }
      });
      return;
    }
    if (message.method === "notifications/initialized") return;
    if (message.method === "tools/list") {
      sendMessage({ jsonrpc: "2.0", id: message.id, result: { tools: toolDefinitions } });
      return;
    }
    if (message.method === "tools/call") {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false
        }
      });
      return;
    }
    sendMessage({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unknown method: ${message.method}` } });
  } catch (error) {
    sendMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: error.stack || error.message }],
        isError: true
      }
    });
  }
}

process.on("exit", () => {
  for (const session of sessions.values()) {
    if (!session.closed) session.child.kill("SIGTERM");
  }
});
