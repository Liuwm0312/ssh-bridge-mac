#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SERVER_INFO = { name: "ssh-bridge", version: "0.1.0" };
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
        command: { type: "string", description: "Optional initial remote command." }
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
  session.bufferBytes += Buffer.byteLength(text, "utf8");
  const limit = maxBufferBytes();
  while (session.bufferBytes > limit && session.chunks.length > 1) {
    const removed = session.chunks.shift();
    session.bufferBytes -= Buffer.byteLength(removed.text, "utf8");
  }
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
    closedAt: session.closedAt || ""
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

function openTerminal(args) {
  const name = String(args.session || "").trim();
  if (!name) throw new Error("session is required.");
  if (sessions.has(name)) throw new Error(`Session "${name}" is already open.`);
  if (process.platform !== "darwin") {
    throw new Error("ssh-bridge-mac requires macOS because it uses /usr/bin/script for PTY allocation.");
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
  const childArgs = ["-q", "/dev/null", "ssh", ...sshArgs(target, args)];
  const child = spawn("/usr/bin/script", childArgs, {
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
    signal: null
  };
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

  child.stdin.write(`stty rows ${rows} cols ${cols} 2>/dev/null || true\n`);
  return { ok: true, session: sessionSummary(session), command: "/usr/bin/script", args: childArgs };
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

function resizeTerminal(args) {
  const session = requireSession(args.session);
  const cols = Number.isInteger(args.cols) ? args.cols : session.cols;
  const rows = Number.isInteger(args.rows) ? args.rows : session.rows;
  session.cols = cols;
  session.rows = rows;
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

function callTool(name, args = {}) {
  switch (name) {
    case "ssh_mac_list_hosts":
      return { ok: true, hostsFile: hostsFilePath(), hosts: Object.fromEntries(Object.entries(loadHosts()).map(([alias, profile]) => [alias, normalizeHost(alias, profile)])) };
    case "ssh_mac_open_terminal":
      return openTerminal(args);
    case "ssh_mac_send":
      return sendInput(args);
    case "ssh_mac_read":
      return readOutput(args);
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

function handleMessage(message) {
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
      const result = callTool(message.params?.name, message.params?.arguments || {});
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
