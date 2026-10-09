#!/usr/bin/env node
// Changed from upstream codex-plugin-cc (Apache-2.0): ported from codex-companion.mjs for the Copilot
// CLI. Setup checks the Copilot version and runs a login check; there is no transfer subcommand.
// Reviews send the diff in the prompt, write large diffs to a patch folder, and check the
// adversarial review's JSON against the schema. A background task's record is written before its
// worker starts, the worker claims the job under the state lock, every run starts Copilot under that
// lock, and cancel marks the job cancelled under it before it stops the job's processes. Resume stays
// in one mode, and there is no spark model alias.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  buildPersistentTaskThreadName,
  CHECK_HINT,
  DEFAULT_CONTINUE_PROMPT,
  ensureCopilotAvailable,
  findLatestTaskThread,
  getCopilotAuthStatus,
  getCopilotAvailability,
  getSessionRuntimeStatus,
  interruptPromptModeTurn,
  parseStructuredOutput,
  readOutputSchema,
  runPromptModeReview,
  runPromptModeTurn,
  UPDATE_HINT,
  validateReviewOutput
} from "./lib/copilot.mjs";
import { readStdinIfPiped } from "./lib/fs.mjs";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget, writeReviewPatches } from "./lib/git.mjs";
import { binaryAvailable, terminateProcessTree } from "./lib/process.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import {
  generateJobId,
  getConfig,
  hasPendingStop,
  listJobs,
  resolveJobPatchDir,
  setConfig,
  updateState,
  upsertJob,
  writeJobFile
} from "./lib/state.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "./lib/job-control.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  guardCopilotStart,
  nowIso,
  runTrackedJob,
  SESSION_ID_ENV
} from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderNativeReviewResult,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult
} from "./lib/render.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_SCHEMA = path.join(ROOT_DIR, "schemas", "review-output.schema.json");
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;
const VALID_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
// Copilot has no short model names to map yet.
const MODEL_ALIASES = new Map();
const STOP_REVIEW_TASK_MARKER = "Run a stop-gate review of the previous Claude turn.";

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/copilot-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  node scripts/copilot-companion.mjs review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>]",
      "  node scripts/copilot-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [focus text]",
      "  node scripts/copilot-companion.mjs task [--background] [--write] [--resume-last|--resume|--fresh] [--model <model>] [--effort <none|minimal|low|medium|high|xhigh>] [prompt]",
      "  node scripts/copilot-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/copilot-companion.mjs result [job-id] [--json]",
      "  node scripts/copilot-companion.mjs cancel [job-id] [--json]"
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function outputCommandResult(payload, rendered, asJson) {
  outputResult(asJson ? payload : rendered, asJson);
}

function normalizeRequestedModel(model) {
  if (model == null) {
    return null;
  }
  const normalized = String(model).trim();
  if (!normalized) {
    return null;
  }
  return MODEL_ALIASES.get(normalized.toLowerCase()) ?? normalized;
}

function normalizeReasoningEffort(effort) {
  if (effort == null) {
    return null;
  }
  const normalized = String(effort).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!VALID_REASONING_EFFORTS.has(normalized)) {
    throw new Error(
      `Unsupported reasoning effort "${effort}". Use one of: none, minimal, low, medium, high, xhigh.`
    );
  }
  return normalized;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

async function buildSetupReport(cwd, actionsTaken = []) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const npmStatus = binaryAvailable("npm", ["--version"], { cwd });
  const copilotStatus = await getCopilotAvailability(cwd);
  const authStatus = await getCopilotAuthStatus(cwd, { availability: copilotStatus });
  const config = getConfig(workspaceRoot);

  const nextSteps = [];
  if (copilotStatus.missing) {
    nextSteps.push("Install Copilot with `npm install -g @github/copilot`.");
  } else if (copilotStatus.version && !copilotStatus.available) {
    nextSteps.push(`Copilot CLI ${copilotStatus.version} is too old. ${UPDATE_HINT}`);
  } else if (!copilotStatus.available) {
    nextSteps.push(CHECK_HINT);
  }
  if (copilotStatus.available && !authStatus.loggedIn && authStatus.requiresGithubAuth) {
    nextSteps.push("Run `!copilot login`.");
    nextSteps.push("If browser login is blocked, retry with `!copilot login --device-code`.");
    nextSteps.push(
      "On a system without a credential store, `copilot login` saves the token in a file that the plugin cannot read. Set `COPILOT_GITHUB_TOKEN` to a fine-grained token with the \"Copilot Requests\" permission instead."
    );
  }
  if (!config.stopReviewGate) {
    nextSteps.push("Optional: run `/copilot:setup --enable-review-gate` to require a fresh review before stop.");
  }

  return {
    ready: nodeStatus.available && copilotStatus.available && authStatus.loggedIn,
    node: nodeStatus,
    npm: npmStatus,
    copilot: copilotStatus,
    auth: authStatus,
    sessionRuntime: getSessionRuntimeStatus(),
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken,
    nextSteps
  };
}

async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"]
  });

  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken = [];

  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actionsTaken.push(`Enabled the stop-time review gate for ${workspaceRoot}.`);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actionsTaken.push(`Disabled the stop-time review gate for ${workspaceRoot}.`);
  }

  const finalReport = await buildSetupReport(cwd, actionsTaken);
  outputResult(options.json ? finalReport : renderSetupReport(finalReport), options.json);
}

function buildNativeReviewPrompt(context, reviewInput) {
  const template = loadPromptTemplate(ROOT_DIR, "review");
  return interpolateTemplate(template, {
    TARGET_LABEL: context.target.label,
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: reviewInput
  });
}

function buildAdversarialReviewPrompt(context, focusText, reviewInput, schema) {
  const template = loadPromptTemplate(ROOT_DIR, "adversarial-review");
  return interpolateTemplate(template, {
    REVIEW_KIND: "Adversarial Review",
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: reviewInput,
    OUTPUT_SCHEMA: JSON.stringify(schema, null, 2)
  });
}

function validateNativeReviewRequest(target, focusText) {
  if (focusText.trim()) {
    throw new Error(
      `\`/copilot:review\` now maps directly to the built-in reviewer and does not support custom focus text. Retry with \`/copilot:adversarial-review ${focusText.trim()}\` for focused review instructions.`
    );
  }

  if (target.mode !== "working-tree" && target.mode !== "branch") {
    throw new Error("This `/copilot:review` target is not supported by the built-in reviewer. Retry with `/copilot:adversarial-review` for custom targeting.");
  }
}

// Copilot has no shell in a review, so above the inline limit it reads the exact patches from a folder
// in the job's own storage. The folder is removed after the run, whatever the outcome.
async function withReviewPatches(context, request, run) {
  if (context.inputMode !== "self-collect") {
    return run({ reviewInput: context.content, addDirs: [] });
  }

  const patchDir = resolveJobPatchDir(request.workspaceRoot, request.jobId);
  fs.mkdirSync(patchDir, { mode: 0o700 });
  const removePatchDir = () => fs.rmSync(patchDir, { recursive: true, force: true });
  // A stopped companion exits from a signal handler, where finally does not run. While Copilot or its
  // version check runs, prompt-mode's handler stops it and exits; before that, nothing else would.
  const onSignal = (signal) => {
    removePatchDir();
    if (process.listenerCount(signal) === 1) {
      process.exit(SIGNAL_EXIT_CODES[signal]);
    }
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  try {
    const files = writeReviewPatches(context, patchDir);
    const reviewInput = [context.content.trimEnd(), "", "## Patch Files", "", ...files.map((file) => `- ${file}`), ""].join("\n");
    return await run({ reviewInput, addDirs: [patchDir] });
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    removePatchDir();
  }
}

// The run's own error comes first; Copilot's stderr is added unless the error already quotes it.
function describeRunFailure(result) {
  const message = result.error?.message ?? "";
  return message.includes(result.stderr) ? message : [message, result.stderr].filter(Boolean).join("\n");
}

async function executeReviewRun(request) {
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });
  const focusText = request.focusText?.trim() ?? "";
  const reviewName = request.reviewName ?? "Review";
  if (reviewName === "Review") {
    validateNativeReviewRequest(target, focusText);
    const context = collectReviewContext(request.cwd, target);
    const result = await withReviewPatches(context, request, ({ reviewInput, addDirs }) =>
      runPromptModeReview(context.repoRoot, {
        prompt: buildNativeReviewPrompt(context, reviewInput),
        addDirs,
        model: request.model,
        onProgress: request.onProgress,
        guardStart: guardCopilotStart(request.workspaceRoot, request.jobId)
      })
    );
    const payload = {
      review: reviewName,
      target,
      threadId: result.threadId,
      // Copilot has no separate review thread.
      sourceThreadId: result.threadId,
      copilot: {
        status: result.status,
        stderr: result.stderr,
        stdout: result.reviewText,
        reasoning: result.reasoningSummary
      }
    };
    const rendered = renderNativeReviewResult(
      {
        status: result.status,
        stdout: result.reviewText,
        stderr: describeRunFailure(result)
      },
      { reviewLabel: reviewName, targetLabel: target.label, reasoningSummary: result.reasoningSummary }
    );

    return {
      exitStatus: result.status,
      threadId: result.threadId,
      turnId: result.turnId,
      payload,
      rendered,
      summary: firstMeaningfulLine(result.reviewText, `${reviewName} completed.`),
      jobTitle: `Copilot ${reviewName}`,
      jobClass: "review",
      targetLabel: target.label
    };
  }

  const context = collectReviewContext(request.cwd, target);
  const schema = readOutputSchema(REVIEW_SCHEMA);
  const result = await withReviewPatches(context, request, ({ reviewInput, addDirs }) =>
    runPromptModeTurn(context.repoRoot, {
      prompt: buildAdversarialReviewPrompt(context, focusText, reviewInput, schema),
      addDirs,
      model: request.model,
      onProgress: request.onProgress,
      guardStart: guardCopilotStart(request.workspaceRoot, request.jobId)
    })
  );
  const failureMessage = describeRunFailure(result);
  let parsed = parseStructuredOutput(result.finalMessage, {
    status: result.status,
    failureMessage
  });
  // A failed or stopped run failed, even if it sent JSON first. Codex enforced the schema; here an
  // answer of the wrong shape fails the job like broken JSON.
  let reviewError = parsed.parseError;
  if (result.status !== 0) {
    reviewError = failureMessage || `Copilot reported a failed run (exit code ${result.result?.exitCode ?? "unknown"}).`;
  } else if (!reviewError) {
    const schemaError = validateReviewOutput(parsed.parsed, schema);
    reviewError = schemaError && `The JSON does not match the review schema: ${schemaError}`;
  }
  if (reviewError !== parsed.parseError) {
    parsed = { ...parsed, parsed: null, parseError: reviewError };
  }
  const payload = {
    review: reviewName,
    target,
    threadId: result.threadId,
    context: {
      repoRoot: context.repoRoot,
      branch: context.branch,
      summary: context.summary
    },
    copilot: {
      status: result.status,
      stderr: result.stderr,
      stdout: result.finalMessage,
      reasoning: result.reasoningSummary
    },
    result: parsed.parsed,
    rawOutput: parsed.rawOutput,
    parseError: parsed.parseError,
    reasoningSummary: result.reasoningSummary
  };

  return {
    exitStatus: result.status !== 0 ? result.status : parsed.parseError ? 1 : 0,
    threadId: result.threadId,
    turnId: result.turnId,
    payload,
    rendered: renderReviewResult(parsed, {
      reviewLabel: reviewName,
      targetLabel: context.target.label,
      reasoningSummary: result.reasoningSummary
    }),
    summary: parsed.parsed?.summary ?? parsed.parseError ?? firstMeaningfulLine(result.finalMessage, `${reviewName} finished.`),
    jobTitle: `Copilot ${reviewName}`,
    jobClass: "review",
    targetLabel: context.target.label
  };
}

function renderStatusPayload(report, asJson) {
  return asJson ? report : renderStatusReport(report);
}

function isActiveJobStatus(status) {
  return status === "queued" || status === "running";
}

function getCurrentClaudeSessionId() {
  return process.env[SESSION_ID_ENV] ?? null;
}

function filterJobsForCurrentClaudeSession(jobs) {
  const sessionId = getCurrentClaudeSessionId();
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

// A session stays in the Copilot home of the mode that made it, so a resume only picks a task of the
// same mode. Without a mode, any finished task counts.
function findLatestResumableTaskJob(jobs, write = null) {
  return (
    jobs.find(
      (job) =>
        job.jobClass === "task" &&
        job.threadId &&
        job.status !== "queued" &&
        job.status !== "running" &&
        !hasPendingStop(job) &&
        (write === null || Boolean(job.write) === write)
    ) ?? null
  );
}

async function waitForSingleJobSnapshot(cwd, reference, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || DEFAULT_STATUS_WAIT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || DEFAULT_STATUS_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  let snapshot = buildSingleJobSnapshot(cwd, reference);

  while (isActiveJobStatus(snapshot.job.status) && Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    snapshot = buildSingleJobSnapshot(cwd, reference);
  }

  return {
    ...snapshot,
    waitTimedOut: isActiveJobStatus(snapshot.job.status),
    timeoutMs
  };
}

async function resolveLatestTrackedTaskThread(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const sessionId = getCurrentClaudeSessionId();
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot)).filter((job) => job.id !== options.excludeJobId);
  const visibleJobs = filterJobsForCurrentClaudeSession(jobs);
  // A cancelled task whose processes may still run counts too: a resume would share its session.
  const activeTask = visibleJobs.find(
    (job) => job.jobClass === "task" && (job.status === "queued" || job.status === "running" || hasPendingStop(job))
  );
  if (activeTask) {
    throw new Error(`Task ${activeTask.id} is still running. Use /copilot:status before continuing it.`);
  }

  const trackedTask = findLatestResumableTaskJob(visibleJobs, Boolean(options.write));
  if (trackedTask) {
    return { id: trackedTask.threadId };
  }

  if (sessionId) {
    return null;
  }

  return findLatestTaskThread(workspaceRoot, { write: options.write });
}

async function executeTaskRun(request) {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);

  const taskMetadata = buildTaskRunMetadata({
    prompt: request.prompt,
    resumeLast: request.resumeLast
  });

  let resumeThreadId = null;
  if (request.resumeLast) {
    const latestThread = await resolveLatestTrackedTaskThread(workspaceRoot, {
      excludeJobId: request.jobId,
      write: request.write
    });
    if (!latestThread) {
      throw new Error(
        `No previous Copilot task thread was found for this repository. A ${request.write ? "--write" : "read-only"} task resumes only a ${request.write ? "--write" : "read-only"} task; use --fresh to start a new task.`
      );
    }
    resumeThreadId = latestThread.id;
  }

  if (!request.prompt && !resumeThreadId) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume-last.");
  }

  const result = await runPromptModeTurn(workspaceRoot, {
    resumeSessionId: resumeThreadId,
    prompt: request.prompt,
    defaultPrompt: resumeThreadId ? DEFAULT_CONTINUE_PROMPT : "",
    model: request.model,
    effort: request.effort,
    write: Boolean(request.write),
    onProgress: request.onProgress,
    threadName: resumeThreadId ? null : buildPersistentTaskThreadName(request.prompt || DEFAULT_CONTINUE_PROMPT),
    guardStart: guardCopilotStart(workspaceRoot, request.jobId)
  });

  const rawOutput = typeof result.finalMessage === "string" ? result.finalMessage : "";
  const failureMessage = describeRunFailure(result);
  // A run can fail after Copilot answered, for example when a read-only run starts a write tool, and
  // the answer alone would read like a success.
  const failureNote =
    result.status !== 0 && rawOutput ? `\nThe Copilot run failed${failureMessage ? `: ${failureMessage}` : "."}\n` : "";
  const rendered =
    renderTaskResult(
      {
        rawOutput,
        failureMessage,
        reasoningSummary: result.reasoningSummary
      },
      {
        title: taskMetadata.title,
        jobId: request.jobId ?? null,
        write: Boolean(request.write)
      }
    ) + failureNote;
  const payload = {
    status: result.status,
    threadId: result.threadId,
    rawOutput,
    touchedFiles: result.touchedFiles,
    reasoningSummary: result.reasoningSummary
  };

  return {
    exitStatus: result.status,
    threadId: result.threadId,
    turnId: result.turnId,
    payload,
    rendered,
    summary: firstMeaningfulLine(rawOutput, firstMeaningfulLine(failureMessage, `${taskMetadata.title} finished.`)),
    jobTitle: taskMetadata.title,
    jobClass: "task",
    write: Boolean(request.write)
  };
}

function buildReviewJobMetadata(reviewName, target) {
  return {
    kind: reviewName === "Adversarial Review" ? "adversarial-review" : "review",
    title: reviewName === "Review" ? "Copilot Review" : `Copilot ${reviewName}`,
    summary: `${reviewName} ${target.label}`
  };
}

function getJobKindLabel(kind, jobClass) {
  if (kind === "adversarial-review") {
    return "adversarial-review";
  }
  return jobClass === "review" ? "review" : "rescue";
}

function createCompanionJob({ prefix, kind, title, workspaceRoot, jobClass, summary, write = false }) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: getJobKindLabel(kind, jobClass),
    title,
    workspaceRoot,
    jobClass,
    summary,
    write
  });
}

function createTrackedProgress(job, options = {}) {
  const logFile = options.logFile ?? createJobLogFile(job.workspaceRoot, job.id, job.title);
  return {
    logFile,
    progress: createProgressReporter({
      stderr: Boolean(options.stderr),
      logFile,
      onEvent: createJobProgressUpdater(job.workspaceRoot, job.id)
    })
  };
}

function buildTaskRunMetadata({ prompt, resumeLast = false }) {
  if (!resumeLast && String(prompt ?? "").includes(STOP_REVIEW_TASK_MARKER)) {
    return {
      title: "Copilot Stop Gate Review",
      summary: "Stop-gate review of previous Claude turn"
    };
  }

  const title = resumeLast ? "Copilot Resume" : "Copilot Task";
  const fallbackSummary = resumeLast ? DEFAULT_CONTINUE_PROMPT : "Task";
  return {
    title,
    summary: shorten(prompt || fallbackSummary)
  };
}

function renderQueuedTaskLaunch(payload) {
  return `${payload.title} started in the background as ${payload.jobId}. Check /copilot:status ${payload.jobId} for progress.\n`;
}

function buildTaskJob(workspaceRoot, taskMetadata, write) {
  return createCompanionJob({
    prefix: "task",
    kind: "task",
    title: taskMetadata.title,
    workspaceRoot,
    jobClass: "task",
    summary: taskMetadata.summary,
    write
  });
}

function buildTaskRequest({ cwd, model, effort, prompt, write, resumeLast, jobId }) {
  return {
    cwd,
    model,
    effort,
    prompt,
    write,
    resumeLast,
    jobId
  };
}

function readTaskPrompt(cwd, options, positionals) {
  if (options["prompt-file"]) {
    return fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8");
  }

  const positionalPrompt = positionals.join(" ");
  return positionalPrompt || readStdinIfPiped();
}

function requireTaskRequest(prompt, resumeLast) {
  if (!prompt && !resumeLast) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume-last.");
  }
}

function spawnDetachedTaskWorker(cwd, jobId) {
  const scriptPath = path.join(ROOT_DIR, "scripts", "copilot-companion.mjs");
  const child = spawn(process.execPath, [scriptPath, "task-worker", "--cwd", cwd, "--job-id", jobId], {
    cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child;
}

// The record is written before the worker starts, because a worker that finds no record exits and the
// job would stay queued. The worker can claim and even finish the job before its pid is saved here, so
// the pid is saved only while the job is still queued.
export async function enqueueBackgroundTask(cwd, job, request, options = {}) {
  const spawnWorker = options.spawnWorkerImpl ?? spawnDetachedTaskWorker;
  const { logFile } = createTrackedProgress(job);
  appendLogLine(logFile, "Queued for background execution.");

  const queuedRecord = {
    ...job,
    status: "queued",
    phase: "queued",
    pid: null,
    logFile,
    request
  };
  writeJobFile(job.workspaceRoot, job.id, queuedRecord);
  upsertJob(job.workspaceRoot, queuedRecord);

  let startError = null;
  let child = null;
  try {
    child = spawnWorker(cwd, job.id);
    if (!child.pid) {
      startError = await new Promise((resolve) => child.once("error", resolve));
    }
  } catch (error) {
    startError = error;
  }

  const errorMessage = startError
    ? `The background worker could not start: ${startError instanceof Error ? startError.message : String(startError)}`
    : null;
  const patch = errorMessage
    ? { status: "failed", phase: "failed", pid: null, errorMessage, completedAt: nowIso() }
    : { pid: child.pid };
  try {
    updateState(job.workspaceRoot, (state) => {
      const index = state.jobs.findIndex((entry) => entry.id === job.id);
      if (index === -1 || state.jobs[index].status !== "queued") {
        return;
      }
      writeJobFile(job.workspaceRoot, job.id, { ...queuedRecord, ...patch });
      state.jobs[index] = { ...state.jobs[index], ...patch, updatedAt: nowIso() };
    });
  } catch (saveError) {
    // A started worker runs the queued job and saves its own pid when it claims it, so the launch
    // still counts; only a worker that never started must be reported.
    if (!errorMessage) {
      try {
        appendLogLine(logFile, `Could not save the worker pid: ${saveError.message}`);
      } catch {
        // The log can fail with the state; the launch has still happened.
      }
    } else {
      throw new Error(`${errorMessage} The job could not be marked failed either: ${saveError.message}`);
    }
  }
  if (errorMessage) {
    appendLogLine(logFile, errorMessage);
    throw new Error(errorMessage);
  }

  return {
    payload: {
      jobId: job.id,
      status: "queued",
      title: job.title,
      summary: job.summary,
      logFile
    },
    logFile
  };
}

async function runForegroundCommand(job, runner, options = {}) {
  const { logFile, progress } = createTrackedProgress(job, {
    logFile: options.logFile,
    stderr: !options.json
  });
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
  return execution;
}

async function handleReviewCommand(argv, config) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd"],
    booleanOptions: ["json", "background", "wait"],
    aliasMap: {
      m: "model"
    }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();
  const target = resolveReviewTarget(cwd, {
    base: options.base,
    scope: options.scope
  });

  config.validateRequest?.(target, focusText);
  const metadata = buildReviewJobMetadata(config.reviewName, target);
  const job = createCompanionJob({
    prefix: "review",
    kind: metadata.kind,
    title: metadata.title,
    workspaceRoot,
    jobClass: "review",
    summary: metadata.summary
  });
  await runForegroundCommand(
    job,
    (progress) =>
      executeReviewRun({
        cwd,
        base: options.base,
        scope: options.scope,
        model: options.model,
        focusText,
        reviewName: config.reviewName,
        workspaceRoot,
        jobId: job.id,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleReview(argv) {
  return handleReviewCommand(argv, {
    reviewName: "Review",
    validateRequest: validateNativeReviewRequest
  });
}

async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "effort", "cwd", "prompt-file"],
    booleanOptions: ["json", "write", "resume-last", "resume", "fresh", "background"],
    aliasMap: {
      m: "model"
    }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const model = normalizeRequestedModel(options.model);
  const effort = normalizeReasoningEffort(options.effort);
  const prompt = readTaskPrompt(cwd, options, positionals);

  const resumeLast = Boolean(options["resume-last"] || options.resume);
  const fresh = Boolean(options.fresh);
  if (resumeLast && fresh) {
    throw new Error("Choose either --resume/--resume-last or --fresh.");
  }
  const write = Boolean(options.write);
  const taskMetadata = buildTaskRunMetadata({
    prompt,
    resumeLast
  });

  if (options.background) {
    await ensureCopilotAvailable(cwd);
    requireTaskRequest(prompt, resumeLast);

    const job = buildTaskJob(workspaceRoot, taskMetadata, write);
    const request = buildTaskRequest({
      cwd,
      model,
      effort,
      prompt,
      write,
      resumeLast,
      jobId: job.id
    });
    const { payload } = await enqueueBackgroundTask(cwd, job, request);
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), options.json);
    return;
  }

  const job = buildTaskJob(workspaceRoot, taskMetadata, write);
  await runForegroundCommand(
    job,
    (progress) =>
      executeTaskRun({
        cwd,
        model,
        effort,
        prompt,
        write,
        resumeLast,
        jobId: job.id,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleTaskWorker(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "job-id"]
  });

  if (!options["job-id"]) {
    throw new Error("Missing required --job-id for task-worker.");
  }

  const workspaceRoot = resolveCommandWorkspace(options);
  const jobId = options["job-id"];
  try {
    await runClaimedTask(workspaceRoot, jobId);
  } catch (error) {
    failWorkerJob(workspaceRoot, jobId, error);
    throw error;
  }
  // The run's final status write can fail and be logged only; the job must not stay running.
  failWorkerJob(workspaceRoot, jobId, new Error("its final status could not be saved; the job log has its output"));
}

async function runClaimedTask(workspaceRoot, jobId) {
  const storedJob = readStoredJob(workspaceRoot, jobId);
  if (!storedJob) {
    throw new Error(`No stored job found for ${jobId}.`);
  }

  const request = storedJob.request;
  if (!request || typeof request !== "object") {
    throw new Error(`Stored job ${jobId} is missing its task request payload.`);
  }

  // A cancel and this claim both change the job under the state lock, so only one of them wins.
  let claimed = false;
  updateState(workspaceRoot, (state) => {
    const index = state.jobs.findIndex((job) => job.id === jobId);
    if (index === -1 || state.jobs[index].status !== "queued") {
      return;
    }
    state.jobs[index] = { ...state.jobs[index], status: "running", pid: process.pid, updatedAt: nowIso() };
    claimed = true;
  });
  if (!claimed) {
    appendLogLine(storedJob.logFile, "Not started: the job was cancelled or removed before its worker claimed it.");
    return;
  }

  const { logFile, progress } = createTrackedProgress(
    {
      ...storedJob,
      workspaceRoot
    },
    {
      logFile: storedJob.logFile ?? null
    }
  );
  await runTrackedJob(
    {
      ...storedJob,
      workspaceRoot,
      logFile
    },
    () =>
      executeTaskRun({
        ...request,
        onProgress: progress
      }),
    { logFile }
  );
}

// The worker's output goes nowhere, and nothing else watches it. A worker that stops early must not
// leave its job queued or running, but a cancel or a finished run stays as it is.
function failWorkerJob(workspaceRoot, jobId, error) {
  const errorMessage = `The background worker stopped: ${error instanceof Error ? error.message : String(error)}`;
  try {
    updateJobRecord(workspaceRoot, jobId, (job) =>
      job?.status === "queued" || (job?.status === "running" && job.pid === process.pid)
        ? {
            ...job,
            status: "failed",
            phase: "failed",
            pid: null,
            copilotPid: error?.copilotStillRunning ? job.copilotPid : null,
            errorMessage,
            completedAt: nowIso()
          }
        : null
    );
  } catch {
    // The job stays active; /copilot:cancel still clears it.
  }
}

async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"],
    booleanOptions: ["json", "all", "wait"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  if (reference) {
    const snapshot = options.wait
      ? await waitForSingleJobSnapshot(cwd, reference, {
          timeoutMs: options["timeout-ms"],
          pollIntervalMs: options["poll-interval-ms"]
        })
      : buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), options.json);
    return;
  }

  if (options.wait) {
    throw new Error("`status --wait` requires a job id.");
  }

  const report = buildStatusSnapshot(cwd, { all: options.all });
  outputResult(renderStatusPayload(report, options.json), options.json);
}

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  const payload = {
    job,
    storedJob
  };

  outputCommandResult(payload, renderStoredJobResult(job, storedJob), options.json);
}

function handleTaskResumeCandidate(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const workspaceRoot = resolveCommandWorkspace(options);
  const sessionId = getCurrentClaudeSessionId();
  const jobs = filterJobsForCurrentClaudeSession(sortJobsNewestFirst(listJobs(workspaceRoot)));
  // The mode of the next run is not known yet, so any mode counts; the caller sees which one it is.
  const candidate = findLatestResumableTaskJob(jobs);

  const payload = {
    available: Boolean(candidate),
    sessionId,
    candidate:
      candidate == null
        ? null
        : {
            id: candidate.id,
            status: candidate.status,
            title: candidate.title ?? null,
            summary: candidate.summary ?? null,
            threadId: candidate.threadId,
            write: Boolean(candidate.write),
            completedAt: candidate.completedAt ?? null,
            updatedAt: candidate.updatedAt ?? null
          }
  };

  const rendered = candidate
    ? `Resumable task found: ${candidate.id} (${candidate.status}).\n`
    : "No resumable task found for this session.\n";
  outputCommandResult(payload, rendered, options.json);
}

function readStoredJobOrEmpty(workspaceRoot, jobId) {
  try {
    return readStoredJob(workspaceRoot, jobId) ?? {};
  } catch {
    return {};
  }
}

// Changes the job record and its state entry in one locked step.
function updateJobRecord(workspaceRoot, jobId, change) {
  updateState(workspaceRoot, (state) => {
    const index = state.jobs.findIndex((job) => job.id === jobId);
    const next = change(index === -1 ? null : state.jobs[index]);
    if (next) {
      writeJobFile(workspaceRoot, jobId, { ...readStoredJobOrEmpty(workspaceRoot, jobId), ...next });
      state.jobs[index] = { ...next, updatedAt: nowIso() };
    }
  });
}

// The job is marked cancelled and its pids are read in one locked step, as the worker claim and the
// Copilot start use the same lock: a job either started before this step, and its pids are stopped, or
// finds itself cancelled and never starts. The signals come only after the lock is released. The pids
// stay in the record until every signal is sent, so a cancel that fails or is stopped can run again.
export async function cancelJob(workspaceRoot, jobId, options = {}) {
  const terminate = options.terminateImpl ?? terminateProcessTree;
  const completedAt = nowIso();
  let cancelled = null;
  updateJobRecord(workspaceRoot, jobId, (current) => {
    if (!current || !(isActiveJobStatus(current.status) || hasPendingStop(current))) {
      throw new Error(
        current
          ? `Job ${jobId} is already ${current.status}, so there is nothing to cancel.`
          : `No job found for "${jobId}". Run /copilot:status to list known jobs.`
      );
    }
    // A finished job whose stop did not finish keeps its outcome; only its processes are stopped.
    cancelled = isActiveJobStatus(current.status)
      ? {
          ...current,
          status: "cancelled",
          phase: "cancelled",
          completedAt,
          cancelledAt: completedAt,
          errorMessage: "Cancelled by user."
        }
      : current;
    return cancelled;
  });

  const interrupt = await interruptPromptModeTurn();
  // Copilot is stopped as well as the companion, because a companion killed outright cannot stop its
  // Copilot. Both waits run at once, so a process that ignores SIGTERM costs one wait, not two. Each
  // pid is cleared once its own stop is done, so a retry never signals a stopped process again.
  const outcomes = await Promise.allSettled(
    ["pid", "copilotPid"].map(async (key) => {
      const pid = cancelled[key];
      await terminate(pid ?? Number.NaN);
      if (pid) {
        updateJobRecord(workspaceRoot, jobId, (current) => (current?.[key] === pid ? { ...current, [key]: null } : null));
      }
    })
  );
  try {
    appendLogLine(cancelled.logFile, "Cancelled by user.");
  } catch {
    // The log is only a record; the processes are what matter.
  }
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure) {
    throw new Error(
      `Job ${jobId} is ${cancelled.status}, but a process could not be stopped (${failure.reason?.message ?? failure.reason}). Run /copilot:cancel ${jobId} again.`
    );
  }
  return { job: { ...cancelled, pid: null, copilotPid: null }, interrupt };
}

async function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job: selected } = resolveCancelableJob(cwd, reference, { env: process.env });
  const { job, interrupt } = await cancelJob(workspaceRoot, selected.id);

  const payload = {
    jobId: job.id,
    status: job.status,
    title: job.title,
    turnInterruptAttempted: interrupt.attempted,
    turnInterrupted: interrupt.interrupted
  };

  outputCommandResult(payload, renderCancelReport(job), options.json);
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      await handleSetup(argv);
      break;
    case "review":
      await handleReview(argv);
      break;
    case "adversarial-review":
      await handleReviewCommand(argv, {
        reviewName: "Adversarial Review"
      });
      break;
    case "task":
      await handleTask(argv);
      break;
    case "task-worker":
      await handleTaskWorker(argv);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "task-resume-candidate":
      handleTaskResumeCandidate(argv);
      break;
    case "cancel":
      await handleCancel(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

// Tests import this module to give the background start a stand-in worker. Both paths are resolved,
// because Node runs the script from its real path when the plugin folder is a link.
function isMainModule() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
