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

const liveClients = new Set();

// A companion that is stopped must not leave its Copilot process group running.
function stopLiveClientsAndExit(signal) {
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
  liveClients.delete(client);
  if (liveClients.size === 0) {
    process.off("SIGTERM", stopLiveClientsAndExit);
    process.off("SIGINT", stopLiveClientsAndExit);
  }
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
