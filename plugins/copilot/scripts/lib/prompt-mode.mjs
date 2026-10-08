// Changed from upstream codex-plugin-cc (Apache-2.0): ported from app-server.mjs for Copilot prompt
// mode. Each run is one process that gets the prompt on stdin and prints one JSON event per line.
// There is no JSON-RPC client and no broker, and the process never starts through a shell.
/**
 * @typedef {import("./prompt-mode-protocol").CopilotPromptModeClientOptions} CopilotPromptModeClientOptions
 * @typedef {import("./prompt-mode-protocol").PromptModeEvent} PromptModeEvent
 * @typedef {import("./prompt-mode-protocol").PromptModeEventHandler} PromptModeEventHandler
 * @typedef {import("./prompt-mode-protocol").PromptModeExit} PromptModeExit
 * @typedef {import("./prompt-mode-protocol").ResultEvent} ResultEvent
 */
import { spawn } from "node:child_process";
import process from "node:process";
import readline from "node:readline";

import { terminateProcessTree } from "./process.mjs";

const DEFAULT_RESULT_GRACE_MS = 5000;
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

const STOPPING_ERROR = "The companion is stopping, so Copilot was not started.";

const liveClients = new Set();
let shuttingDown = false;

// A companion that is stopped must not leave its Copilot process group running. The caller may go on
// to start another process while the stop waits, so nothing new starts after the first signal.
function stopLiveClientsAndExit(signal) {
  shuttingDown = true;
  const stops = [...liveClients].map((client) => client.close().catch(() => {}));
  Promise.all(stops).finally(() => process.exit(SIGNAL_EXIT_CODES[signal] ?? 1));
}

function trackClient(client) {
  if (liveClients.size === 0) {
    process.on("SIGTERM", stopLiveClientsAndExit);
    process.on("SIGINT", stopLiveClientsAndExit);
  }
  liveClients.add(client);
}

function untrackClient(client) {
  if (!liveClients.delete(client)) {
    return;
  }
  if (liveClients.size === 0) {
    process.off("SIGTERM", stopLiveClientsAndExit);
    process.off("SIGINT", stopLiveClientsAndExit);
  }
}

// A short command such as --version: its whole output, a time limit, and the same stop on SIGTERM and
// SIGINT as a run. The npm loader runs the native binary with inherited pipes, so the limit stops the
// whole tree; killing the loader alone would leave the pipes open.
export function runShortCommand(cwd, options) {
  if (shuttingDown) {
    return Promise.resolve({
      exitCode: null,
      signal: null,
      error: new Error(STOPPING_ERROR),
      stdout: "",
      stderr: "",
      timedOut: false
    });
  }

  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    let stopping = null;
    const handle = {
      close() {
        stopping ??= terminateProcessTree(child.pid).then(() => {});
        return stopping;
      }
    };
    trackClient(handle);

    const finish = (outcome) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      untrackClient(handle);
      resolve({ exitCode: null, signal: null, error: null, ...outcome, stdout, stderr, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      handle
        .close()
        .catch(() => {})
        .finally(() => finish({}));
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish({ error }));
    child.on("close", (code, signal) => finish({ exitCode: code, signal }));
  });
}

export class CopilotPromptModeClient {
  /**
   * @param {string} cwd
   * @param {CopilotPromptModeClientOptions} options
   */
  static start(cwd, options) {
    const client = new CopilotPromptModeClient(cwd, options);
    client.spawn();
    return client;
  }

  /**
   * @param {string} cwd
   * @param {CopilotPromptModeClientOptions} options
   */
  constructor(cwd, options) {
    this.cwd = cwd;
    this.options = options;
    this.stderr = "";
    /** @type {ResultEvent | null} */
    this.result = null;
    /** @type {Error | null} */
    this.protocolError = null;
    this.forcedExit = false;
    /** @type {PromptModeEventHandler | null} */
    this.eventHandler = options.onEvent ?? null;
    /** @type {Promise<void> | null} */
    this.stopping = null;
    this.resultTimer = null;
    this.timeoutTimer = null;
    this.exited = false;
    /** @type {Promise<PromptModeExit>} */
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  /** @param {PromptModeEventHandler | null} handler */
  setEventHandler(handler) {
    this.eventHandler = handler;
  }

  spawn() {
    if (shuttingDown) {
      this.finish({ exitCode: null, signal: null, error: new Error(STOPPING_ERROR) });
      return;
    }
    this.proc = spawn(this.options.command, this.options.args, {
      cwd: this.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      // A group of its own lets the tree kill reach Copilot's children on macOS and Linux.
      detached: process.platform !== "win32",
      windowsHide: true
    });
    trackClient(this);

    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });

    this.proc.on("error", (error) => {
      this.finish({ exitCode: null, signal: null, error });
    });
    this.proc.on("close", (code, signal) => {
      this.finish({ exitCode: code, signal, error: null });
    });

    this.readline = readline.createInterface({ input: this.proc.stdout });
    this.readline.on("line", (line) => {
      this.handleLine(line);
    });

    // Copilot can exit before it reads the prompt, for example when nobody is logged in.
    this.proc.stdin.on("error", () => {});
    this.proc.stdin.end(this.options.prompt);

    if (this.options.timeoutMs) {
      this.timeoutTimer = setTimeout(() => {
        this.protocolError ??= new Error(`Copilot did not finish within ${this.options.timeoutMs / 1000} seconds.`);
        this.close().catch(() => {});
      }, this.options.timeoutMs);
    }
  }

  handleLine(line) {
    if (this.protocolError || !line.trim()) {
      return;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      this.protocolError = new Error(`Failed to parse Copilot JSON output: ${error.message}\n${line}`);
      this.close().catch(() => {});
      return;
    }
    // Valid JSON that is not an event object is ignored, like an event type the adapter does not read.
    if (!event || typeof event !== "object" || typeof event.type !== "string") {
      return;
    }

    if (event.type === "result") {
      this.result = event;
      this.scheduleResultGrace();
    }
    this.eventHandler?.(event);
  }

  // The result event ends the run. A process that stays alive after it must not hold the job.
  scheduleResultGrace() {
    if (this.resultTimer) {
      return;
    }
    this.resultTimer = setTimeout(() => {
      if (!this.exited) {
        this.forcedExit = true;
        this.close().catch(() => {});
      }
    }, this.options.resultGraceMs ?? DEFAULT_RESULT_GRACE_MS);
  }

  finish(exit) {
    if (this.exited) {
      return;
    }
    this.exited = true;
    clearTimeout(this.resultTimer);
    clearTimeout(this.timeoutTimer);
    this.readline?.close();
    untrackClient(this);
    this.resolveExit(exit);
  }

  async close() {
    if (!this.stopping) {
      this.stopping = this.exited ? Promise.resolve() : terminateProcessTree(this.proc.pid).then(() => {});
    }
    await this.stopping;
    await this.exitPromise;
  }
}
