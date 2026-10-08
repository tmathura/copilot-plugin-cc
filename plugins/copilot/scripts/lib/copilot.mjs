// Changed from upstream codex-plugin-cc (Apache-2.0): ported from codex.mjs for the Copilot CLI in
// prompt mode. This module alone builds Copilot arguments and decides permissions. It has no broker,
// no session transfer and no thread list; the login check is one tiny read-only prompt.
/**
 * @typedef {import("./prompt-mode-protocol").PromptModeEvent} PromptModeEvent
 * @typedef {import("./prompt-mode-protocol").ResultEvent} ResultEvent
 * @typedef {((update: string | { message: string, phase: string | null, threadId?: string | null, turnId?: string | null, stderrMessage?: string | null, logTitle?: string | null, logBody?: string | null }) => void)} ProgressReporter
 * @typedef {{
 *   sessionId: string,
 *   write: boolean,
 *   turnId: string | null,
 *   result: ResultEvent | null,
 *   lastAgentMessage: string,
 *   reasoningSummary: string[],
 *   error: Error | null,
 *   stderr: string,
 *   tools: Map<string, { toolName: string, command: string }>,
 *   commandExecutions: Array<{ command: string, success: boolean }>,
 *   onProgress: ProgressReporter | null
 * }} TurnCaptureState
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { CopilotPromptModeClient } from "./prompt-mode.mjs";
import { binaryAvailable, resolveLauncher } from "./process.mjs";
import { ensurePluginDataDir, resolvePluginDataDir } from "./state.mjs";

const MIN_COPILOT_VERSION = [1, 0, 93];
const INSTALL_HINT = "Install it with `npm install -g @github/copilot`, then rerun `/copilot:setup`.";
const READ_ONLY_TOOLS = ["view", "glob", "grep"];
const WRITE_TOOLS = ["create", "edit", "apply_patch"];
const SHELL_TOOLS = new Set(["bash", "powershell"]);
// Copilot redacts GITHUB_TOKEN and COPILOT_GITHUB_TOKEN by itself, but not these.
const SECRET_ENV_VARS = ["GH_TOKEN", "COPILOT_PROVIDER_API_KEY", "COPILOT_PROVIDER_BEARER_TOKEN"];
// An inherited allow-all or prompt-mode opt-in would widen every run, read-only runs too.
const SCRUBBED_ENV_VARS = [
  "COPILOT_ALLOW_ALL",
  "GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS",
  "GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP",
  "GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS"
];
const TOKEN_ENV_VARS = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];
const LOGIN_CHECK_PROMPT = "Reply with the single word OK.";
// A stalled model request must not hang setup; the check answers in a few seconds when it works.
const LOGIN_CHECK_TIMEOUT_MS = 60 * 1000;
const NOT_LOGGED_IN_PATTERN = /No authentication information found/i;
const BUILTIN_PROVIDER_LABELS = new Map([
  ["openai", "OpenAI"],
  ["azure", "Azure"],
  ["anthropic", "Anthropic"]
]);

export function cleanCopilotStderr(stderr) {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join("\n");
}

function shorten(text, limit = 72) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function looksLikeVerificationCommand(command) {
  return /\b(test|tests|lint|build|typecheck|type-check|check|verify|validate|pytest|jest|vitest|cargo test|npm test|pnpm test|yarn test|go test|mvn test|gradle test|tsc|eslint|ruff)\b/i.test(
    command
  );
}

function normalizeReasoningText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function mergeReasoningSections(existingSections, nextSections) {
  const merged = [];
  for (const section of [...existingSections, ...nextSections]) {
    const normalized = normalizeReasoningText(section);
    if (!normalized || merged.includes(normalized)) {
      continue;
    }
    merged.push(normalized);
  }
  return merged;
}

/**
 * @param {ProgressReporter | null | undefined} onProgress
 * @param {string | null | undefined} message
 * @param {string | null | undefined} [phase]
 */
function emitProgress(onProgress, message, phase = null, extra = {}) {
  if (!onProgress || !message) {
    return;
  }
  if (!phase && Object.keys(extra).length === 0) {
    onProgress(message);
    return;
  }
  onProgress({ message, phase, ...extra });
}

function emitLogEvent(onProgress, options = {}) {
  if (!onProgress) {
    return;
  }

  onProgress({
    message: options.message ?? "",
    phase: options.phase ?? null,
    stderrMessage: options.stderrMessage ?? null,
    logTitle: options.logTitle ?? null,
    logBody: options.logBody ?? null
  });
}

function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? match.slice(1, 4).map(Number) : null;
}

function isBelowMinimum(version) {
  for (let index = 0; index < MIN_COPILOT_VERSION.length; index += 1) {
    if (version[index] !== MIN_COPILOT_VERSION[index]) {
      return version[index] < MIN_COPILOT_VERSION[index];
    }
  }
  return false;
}

// Windows treats environment names without case, so a lowercase copy must not slip through.
function withoutEnvVars(env, names) {
  const blocked = new Set(names);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !blocked.has(key.toUpperCase())));
}

export function resolveCopilotHome(env = process.env) {
  return path.join(resolvePluginDataDir(env), "copilot-home");
}

export function buildCopilotEnv(options = {}) {
  const env = options.env ?? process.env;
  if (options.write) {
    return withoutEnvVars(env, SCRUBBED_ENV_VARS);
  }
  // The plugin home has no trusted folders, hooks, saved approvals or MCP servers of the user.
  return {
    ...withoutEnvVars(env, [...SCRUBBED_ENV_VARS, "COPILOT_HOME"]),
    COPILOT_HOME: resolveCopilotHome(env)
  };
}

export function buildCopilotArgs(options = {}) {
  const platform = options.platform ?? process.platform;
  const args = [
    "--output-format",
    "json",
    "--no-ask-user",
    "--no-auto-update",
    `--secret-env-vars=${SECRET_ENV_VARS.join(",")}`
  ];

  if (options.write) {
    const shellTool = platform === "win32" ? "powershell" : "bash";
    args.push(
      `--available-tools=${[...READ_ONLY_TOOLS, ...WRITE_TOOLS, shellTool].join(",")}`,
      "--allow-tool=write,shell",
      "--deny-tool=shell(git push)",
      "--sandbox"
    );
  } else {
    args.push(`--available-tools=${READ_ONLY_TOOLS.join(",")}`, "--deny-tool=write,shell,memory");
  }

  args.push(options.resumeSessionId ? `--resume=${options.resumeSessionId}` : `--session-id=${options.sessionId}`);
  if (options.model) {
    args.push(`--model=${options.model}`);
  }
  if (options.effort) {
    args.push(`--reasoning-effort=${options.effort}`);
  }
  if (options.name) {
    args.push(`--name=${options.name}`);
  }
  return args;
}

function describeToolStart(toolName, command) {
  if (SHELL_TOOLS.has(toolName)) {
    return {
      message: `Running command: ${shorten(command, 96)}`,
      phase: looksLikeVerificationCommand(command) ? "verifying" : "running"
    };
  }
  return {
    message: `Running tool: ${toolName}.`,
    phase: WRITE_TOOLS.includes(toolName) ? "editing" : "investigating"
  };
}

function describeToolComplete(toolName, command, data) {
  const outcome = data?.success ? "completed" : "failed";
  const errorText = data?.error?.message ? `: ${shorten(data.error.message, 96)}` : "";
  if (SHELL_TOOLS.has(toolName)) {
    return {
      message: `Command ${outcome}: ${shorten(command, 96)}${errorText}`,
      phase: looksLikeVerificationCommand(command) ? "verifying" : "running"
    };
  }
  return {
    message: `Tool ${toolName} ${outcome}${errorText}.`,
    phase: WRITE_TOOLS.includes(toolName) ? "editing" : "investigating"
  };
}

/** @returns {TurnCaptureState} */
function createTurnCaptureState(sessionId, options = {}) {
  return {
    sessionId,
    write: Boolean(options.write),
    turnId: null,
    result: null,
    lastAgentMessage: "",
    reasoningSummary: [],
    error: null,
    stderr: "",
    tools: new Map(),
    commandExecutions: [],
    onProgress: options.onProgress ?? null
  };
}

/**
 * @param {TurnCaptureState} state
 * @param {PromptModeEvent} event
 * @param {CopilotPromptModeClient} client
 */
function applyTurnEvent(state, event, client) {
  switch (event.type) {
    case "assistant.turn_start":
      state.turnId = event.data?.turnId ?? state.turnId;
      emitProgress(state.onProgress, `Turn started (${state.turnId}).`, "starting", {
        threadId: state.sessionId,
        turnId: state.turnId
      });
      break;
    case "assistant.message": {
      const text = event.data?.content ?? "";
      if (text) {
        state.lastAgentMessage = text;
        emitLogEvent(state.onProgress, {
          message: `Assistant message captured: ${shorten(text, 96)}`,
          logTitle: "Assistant message",
          logBody: text
        });
      }
      break;
    }
    case "assistant.reasoning": {
      const section = normalizeReasoningText(event.data?.content);
      if (section) {
        state.reasoningSummary = mergeReasoningSections(state.reasoningSummary, [section]);
        emitLogEvent(state.onProgress, {
          message: `Reasoning summary captured: ${shorten(section, 96)}`,
          logTitle: "Reasoning summary",
          logBody: `- ${section}`
        });
      }
      break;
    }
    case "tool.execution_start": {
      const toolName = event.data?.toolName ?? "unknown";
      const command = String(event.data?.arguments?.command ?? "");
      state.tools.set(event.data?.toolCallId, { toolName, command });
      // The tool flags should make this impossible; this guards against a change in Copilot.
      if (!state.write && !READ_ONLY_TOOLS.includes(toolName)) {
        state.error ??= new Error(
          `Copilot started the tool "${toolName}", which a read-only run does not allow. The run was stopped.`
        );
        client.close().catch(() => {});
        break;
      }
      const update = describeToolStart(toolName, command);
      emitProgress(state.onProgress, update.message, update.phase);
      break;
    }
    case "tool.execution_complete": {
      const tool = state.tools.get(event.data?.toolCallId) ?? { toolName: "unknown", command: "" };
      if (SHELL_TOOLS.has(tool.toolName)) {
        state.commandExecutions.push({ command: tool.command, success: Boolean(event.data?.success) });
      }
      const update = describeToolComplete(tool.toolName, tool.command, event.data);
      emitProgress(state.onProgress, update.message, update.phase);
      break;
    }
    case "result":
      state.result = event;
      emitProgress(state.onProgress, `Turn ${event.exitCode === 0 ? "completed" : "failed"}.`, "finalizing");
      break;
    default:
      break;
  }
}

/** @param {CopilotPromptModeClient} client */
async function captureTurn(client, sessionId, options = {}) {
  const state = createTurnCaptureState(sessionId, options);
  client.setEventHandler((event) => applyTurnEvent(state, event, client));

  const exit = await client.exitPromise;
  state.stderr = cleanCopilotStderr(client.stderr);
  if (!state.error) {
    if (exit.error) {
      state.error = exit.error;
    } else if (client.protocolError) {
      state.error = client.protocolError;
    } else if (!state.result) {
      const how = exit.signal ? `signal ${exit.signal}` : `exit ${exit.exitCode}`;
      state.error = new Error(
        `Copilot stopped before it sent a result (${how}).${state.stderr ? `\n${state.stderr}` : ""}`
      );
    }
  }
  if (state.error) {
    emitProgress(state.onProgress, `Copilot error: ${state.error.message}`, "failed");
  }
  return state;
}

async function withPromptMode(cwd, options, fn) {
  const launcher = resolveLauncher("copilot", { env: options.env });
  if (!launcher.command) {
    throw new Error(`Copilot CLI is not installed (${launcher.detail}). ${INSTALL_HINT}`);
  }

  const client = CopilotPromptModeClient.start(cwd, {
    command: launcher.command,
    args: [...launcher.args, ...options.args],
    env: options.env,
    prompt: options.prompt,
    resultGraceMs: options.resultGraceMs,
    timeoutMs: options.timeoutMs
  });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/** @param {TurnCaptureState} turnState */
export function buildResultStatus(turnState) {
  return !turnState.error && turnState.result?.exitCode === 0 ? 0 : 1;
}

async function runCopilotTurn(cwd, options = {}) {
  const prompt = options.prompt?.trim() || options.defaultPrompt || "";
  if (!prompt) {
    throw new Error("A prompt is required for this Copilot run.");
  }

  const write = Boolean(options.write);
  // A new session gets its id before Copilot starts, so the job knows it at once.
  const sessionId = options.resumeSessionId ?? crypto.randomUUID();
  const env = buildCopilotEnv({ write, env: options.env });
  if (!write) {
    ensurePluginDataDir(options.env);
    fs.mkdirSync(env.COPILOT_HOME, { recursive: true, mode: 0o700 });
  }
  const args = buildCopilotArgs({
    write,
    sessionId,
    resumeSessionId: options.resumeSessionId,
    model: options.model,
    effort: options.effort,
    name: options.threadName
  });

  emitProgress(
    options.onProgress,
    options.resumeSessionId ? `Resuming session ${sessionId}.` : "Starting Copilot run.",
    "starting"
  );
  emitProgress(options.onProgress, `Session ready (${sessionId}).`, "starting", { threadId: sessionId });

  const launch = { args, env, prompt, resultGraceMs: options.resultGraceMs, timeoutMs: options.timeoutMs };
  return withPromptMode(cwd, launch, async (client) => {
    const turnState = await captureTurn(client, sessionId, { write, onProgress: options.onProgress });
    return {
      status: buildResultStatus(turnState),
      threadId: turnState.result?.sessionId ?? sessionId,
      turnId: turnState.turnId,
      finalMessage: turnState.lastAgentMessage,
      reasoningSummary: turnState.reasoningSummary,
      result: turnState.result,
      error: turnState.error,
      stderr: turnState.stderr,
      touchedFiles: turnState.result?.usage?.codeChanges?.filesModified ?? [],
      commandExecutions: turnState.commandExecutions
    };
  });
}

function formatUnavailableError(availability) {
  if (availability.version) {
    return `Copilot CLI ${availability.version} is not supported. Update it with \`npm install -g @github/copilot\`, then rerun \`/copilot:setup\`.`;
  }
  return `Copilot CLI is not installed or cannot start (${availability.detail}). ${INSTALL_HINT}`;
}

function buildAuthStatus(fields = {}) {
  return {
    available: true,
    loggedIn: false,
    detail: "not authenticated",
    source: "unknown",
    authMethod: null,
    verified: null,
    requiresGithubAuth: null,
    provider: null,
    ...fields
  };
}

// The version check runs the same launch as a real run: --no-auto-update makes Copilot ignore a newer
// build in its package cache, which a bare --version could report.
export function getCopilotAvailability(cwd, options = {}) {
  const status = binaryAvailable("copilot", ["--no-auto-update", "--version"], { cwd, env: options.env });
  if (!status.available) {
    return { available: false, detail: status.detail, version: null };
  }

  const firstLine = status.detail.split(/\r?\n/)[0].trim().replace(/\.$/, "");
  const version = parseVersion(firstLine);
  if (!version) {
    return { available: false, detail: `cannot read the Copilot version from "${firstLine}"`, version: null };
  }
  if (isBelowMinimum(version)) {
    return {
      available: false,
      detail: `${firstLine} is not supported; Copilot CLI ${MIN_COPILOT_VERSION.join(".")} or later is needed`,
      version: version.join(".")
    };
  }
  return { available: true, detail: firstLine, version: version.join(".") };
}

export function getSessionRuntimeStatus() {
  return {
    mode: "direct",
    label: "direct startup",
    detail: "Each review or task command starts its own Copilot process.",
    endpoint: null
  };
}

export async function getCopilotAuthStatus(cwd, options = {}) {
  const env = options.env ?? process.env;
  const availability = getCopilotAvailability(cwd, { env });
  if (!availability.available) {
    return buildAuthStatus({ available: false, detail: availability.detail, source: "availability" });
  }

  if (env.COPILOT_PROVIDER_BASE_URL?.trim()) {
    const providerId = env.COPILOT_PROVIDER_TYPE?.trim().toLowerCase() || "openai";
    const providerLabel = BUILTIN_PROVIDER_LABELS.get(providerId) ?? providerId;
    return buildAuthStatus({
      loggedIn: true,
      detail: `${providerLabel} provider (BYOK) is configured and does not require GitHub authentication`,
      source: "byok",
      authMethod: "byok",
      verified: false,
      requiresGithubAuth: false,
      provider: providerId
    });
  }

  try {
    // A neutral folder: the check must not read the workspace or trust it.
    const checkDir = ensurePluginDataDir(env);
    const run = await runCopilotTurn(checkDir, {
      prompt: LOGIN_CHECK_PROMPT,
      env,
      resultGraceMs: options.resultGraceMs,
      timeoutMs: options.timeoutMs ?? LOGIN_CHECK_TIMEOUT_MS
    });
    if (run.status === 0) {
      // Copilot falls back to a stored login when a token is invalid, so a set token proves nothing.
      const tokenVar = TOKEN_ENV_VARS.find((name) => env[name]?.trim()) ?? null;
      return buildAuthStatus({
        loggedIn: true,
        detail: tokenVar ? `logged in; ${tokenVar} is set` : "logged in",
        source: "login-check",
        verified: true,
        requiresGithubAuth: true
      });
    }
    if (NOT_LOGGED_IN_PATTERN.test(run.stderr)) {
      return buildAuthStatus({ detail: "not logged in", source: "login-check", requiresGithubAuth: true });
    }
    return buildAuthStatus({ detail: oneLine(run.error?.message || run.stderr || "login check failed"), source: "login-check" });
  } catch (error) {
    return buildAuthStatus({
      detail: oneLine(error instanceof Error ? error.message : String(error)),
      source: "login-check"
    });
  }
}

// The setup report shows the detail as one list item.
function oneLine(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" ");
}

export async function runPromptModeTurn(cwd, options = {}) {
  const availability = getCopilotAvailability(cwd, { env: options.env });
  if (!availability.available) {
    throw new Error(formatUnavailableError(availability));
  }
  return runCopilotTurn(cwd, options);
}
