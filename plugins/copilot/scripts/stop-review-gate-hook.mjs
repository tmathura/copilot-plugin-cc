#!/usr/bin/env node
// Changed from upstream codex-plugin-cc (Apache-2.0): ported from stop-review-gate-hook.mjs for the
// Copilot CLI. The prompt holds the working-tree context, with the exact patches in a folder above the
// inline limit, and reaches the companion on stdin. The run limit is 840 s from the hook's start; on
// the limit, or when the hook itself is stopped, the hook stops the companion's process tree and
// cancels its job, which stops the job's Copilot process; it also cancels the job of a companion that
// ended before its job did.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cancelJob, withReviewPatches } from "./copilot-companion.mjs";
import { getCopilotAvailability } from "./lib/copilot.mjs";
import { readStdinSync } from "./lib/fs.mjs";
import { collectReviewContext, resolveReviewTarget } from "./lib/git.mjs";
import { terminateProcessTree } from "./lib/process.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import { LAUNCHED_AT_ENV, listJobs, loadState, processStartedAtMs, resolveJobsDir } from "./lib/state.mjs";
import { sortJobsNewestFirst } from "./lib/job-control.mjs";
import { SESSION_ID_ENV, STOP_GATE_RUN_ENV } from "./lib/tracked-jobs.mjs";
import { findGitMarkerRoot, resolveWorkspaceRoot } from "./lib/workspace.mjs";

// The hook's own timeout is 900 s. The rest is for the stop, the cleanup and the answer.
const STOP_REVIEW_TIMEOUT_MS = 14 * 60 * 1000;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
const GATE_FOLDER_PATTERN = /^stop-gate-(\d+)-[a-z0-9]+\.patches$/;

function readHookInput() {
  // Claude's last message makes this input large.
  const raw = readStdinSync().trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function emitDecision(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function logNote(message) {
  if (!message) {
    return;
  }
  process.stderr.write(`${message}\n`);
}

function filterJobsForCurrentSession(jobs, input = {}) {
  const sessionId = input.session_id || process.env[SESSION_ID_ENV] || null;
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

function buildStopReviewPrompt(input = {}, reviewInput = "") {
  const lastAssistantMessage = String(input.last_assistant_message ?? "").trim();
  const template = loadPromptTemplate(ROOT_DIR, "stop-review-gate");
  const claudeResponseBlock = lastAssistantMessage
    ? ["Previous Claude response:", lastAssistantMessage].join("\n")
    : "";
  return interpolateTemplate(template, {
    CLAUDE_RESPONSE_BLOCK: claudeResponseBlock,
    REVIEW_INPUT: reviewInput
  });
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

// No job record names the gate's patch folder, so pruning never removes it. A hook killed outright
// leaves it behind; its name holds the hook's pid, so a later gate removes it.
function removeStaleGateFolders(workspaceRoot) {
  const jobsDir = resolveJobsDir(workspaceRoot);
  for (const name of fs.existsSync(jobsDir) ? fs.readdirSync(jobsDir) : []) {
    const match = GATE_FOLDER_PATTERN.exec(name);
    if (match && !isPidAlive(Number(match[1]))) {
      fs.rmSync(path.join(jobsDir, name), { recursive: true, force: true });
    }
  }
}

// Git's own error text can be translated, so a folder counts as outside Git only when no folder above
// it holds .git. Any other git failure must block the stop, not pass as "no diff".
function isOutsideGit(cwd) {
  return !process.env.GIT_DIR && findGitMarkerRoot(cwd) === null;
}

// The read-only profile has no shell, so Copilot cannot run git to see the changes. Above the inline
// limit the exact patches go to a folder in the plugin's job storage, which is removed after the run.
async function withStopReviewContext(cwd, workspaceRoot, run) {
  removeStaleGateFolders(workspaceRoot);
  if (isOutsideGit(cwd)) {
    return run({ reviewInput: "The working folder is not a Git repository, so there is no diff.", addDirs: [] });
  }
  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, { scope: "working-tree" }));
  const folderId = `stop-gate-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  return withReviewPatches(context, { workspaceRoot, jobId: folderId }, ({ reviewInput, addDirs }) =>
    run({ reviewInput: `${context.collectionGuidance}\n\n${reviewInput}`, addDirs })
  );
}

function buildSetupNote(availability) {
  if (availability.available) {
    return null;
  }

  const detail = availability.detail ? ` ${availability.detail}.` : "";
  return `Copilot is not set up for the review gate.${detail} Run /copilot:setup.`;
}

function parseStopReviewOutput(rawOutput) {
  const text = String(rawOutput ?? "").trim();
  if (!text) {
    return {
      ok: false,
      reason:
        "The stop-time Copilot review task returned no final output. Run /copilot:review --wait manually or bypass the gate."
    };
  }

  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (firstLine.startsWith("ALLOW:")) {
    return { ok: true, reason: null };
  }
  if (firstLine.startsWith("BLOCK:")) {
    const reason = firstLine.slice("BLOCK:".length).trim() || text;
    return {
      ok: false,
      reason: `Copilot stop-time review found issues that still need fixes before ending the session: ${reason}`
    };
  }

  return {
    ok: false,
    reason:
      "The stop-time Copilot review task returned an unexpected answer. Run /copilot:review --wait manually or bypass the gate."
  };
}

// A companion that dies outright cannot stop its Copilot, and its record stays running, so its job is
// cancelled, which stops the Copilot of the record. The record is read once the companion is gone,
// when no new Copilot can start. It is found by the gate's run id, which a pid or a prompt cannot
// fake, and read strictly, so a state that cannot be read is an error, not "no job".
async function cancelCompanionJob(workspaceRoot, runId, reason) {
  const job = loadState(workspaceRoot, { strict: true }).jobs.find(
    (entry) => entry.stopGateRunId === runId && entry.status === "running"
  );
  if (job) {
    await cancelJob(workspaceRoot, job.id, { reason });
  }
}

// The prompt goes on stdin, because Claude's last message can pass the Windows command-line limit. On
// macOS and Linux the companion leads its own process group, so a stop reaches all it started. That
// group gets no signal sent to the hook's group, so the hook stops it itself.
async function runCompanionTask(cwd, prompt, options) {
  const terminate = options.terminateImpl ?? terminateProcessTree;
  const args = [path.join(SCRIPT_DIR, "copilot-companion.mjs"), "task", "--json"];
  if (options.contextDir) {
    args.push("--context-dir", options.contextDir);
  }
  let stop;
  const stopped = new Promise((resolve) => {
    stop = resolve;
  });
  const onSignal = (signal) => stop({ signal });
  // The handlers come before the spawn, so no signal can leave the companion running, and they stay
  // until the cleanup is done, so a second signal cannot end the hook halfway.
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  try {
    const child = spawn(process.execPath, args, {
      cwd,
      env: options.env,
      detached: process.platform !== "win32",
      stdio: "pipe",
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    // A companion that exits before it reads the whole prompt closes the pipe; its exit says why.
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);

    const timer = setTimeout(() => stop({ timedOut: true }), options.timeoutMs);
    const outcome = await Promise.race([
      new Promise((resolve) => child.on("close", (status) => resolve({ status }))),
      new Promise((_, reject) => child.on("error", reject)),
      stopped
    ]).finally(() => clearTimeout(timer));

    if (outcome.timedOut || outcome.signal) {
      const reason = outcome.signal ? "The stop-time review was stopped." : "The stop-time review timed out.";
      // A companion that could not be stopped says nothing about its Copilot, so the job is cancelled
      // either way; the cancel stops the companion again too.
      const errors = [];
      const keepError = (error) => errors.push(error instanceof Error ? error.message : String(error));
      await terminate(child.pid).catch(keepError);
      await cancelCompanionJob(options.workspaceRoot, options.runId, reason).catch(keepError);
      return errors.length > 0 ? { ...outcome, stopError: errors.join(" ") } : outcome;
    }
    try {
      await cancelCompanionJob(
        options.workspaceRoot,
        options.runId,
        "The stop-time review's companion ended before its job did."
      );
    } catch (error) {
      stderr += `\n${error instanceof Error ? error.message : String(error)}`;
    }
    return { status: outcome.status, stdout, stderr };
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }
}

export async function runStopReview(cwd, input = {}, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? STOP_REVIEW_TIMEOUT_MS);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const runId = randomUUID();
  const childEnv = {
    ...process.env,
    ...(input.session_id ? { [SESSION_ID_ENV]: input.session_id } : {}),
    [LAUNCHED_AT_ENV]: String(processStartedAtMs()),
    [STOP_GATE_RUN_ENV]: runId
  };
  const result = await withStopReviewContext(cwd, workspaceRoot, ({ reviewInput, addDirs }) =>
    runCompanionTask(cwd, buildStopReviewPrompt(input, reviewInput), {
      contextDir: addDirs[0],
      env: childEnv,
      timeoutMs: Math.max(0, deadline - Date.now()),
      workspaceRoot,
      runId,
      terminateImpl: options.terminateImpl
    })
  );

  if (result.signal) {
    return { ok: false, signal: result.signal, reason: result.stopError ?? null };
  }

  if (result.timedOut) {
    const stopNote = result.stopError ? ` ${result.stopError}` : "";
    return {
      ok: false,
      reason: `The stop-time Copilot review task timed out after 14 minutes.${stopNote} Run /copilot:review --wait manually or bypass the gate.`
    };
  }

  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      reason: detail
        ? `The stop-time Copilot review task failed: ${detail}`
        : "The stop-time Copilot review task failed. Run /copilot:review --wait manually or bypass the gate."
    };
  }

  try {
    const payload = JSON.parse(result.stdout);
    return parseStopReviewOutput(payload?.rawOutput);
  } catch {
    return {
      ok: false,
      reason:
        "The stop-time Copilot review task returned invalid JSON. Run /copilot:review --wait manually or bypass the gate."
    };
  }
}

// Tests pass a short limit to run the whole hook in a child process.
export async function main(options = {}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? STOP_REVIEW_TIMEOUT_MS;
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  // Whether the gate is on is unknown when the state cannot be read. Blocking would stop every user,
  // also those who never turned the gate on, so the hook says why it did not run.
  let config;
  try {
    config = loadState(workspaceRoot, { strict: true }).config;
  } catch (error) {
    logNote(`The review gate did not run. ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const jobs = sortJobsNewestFirst(filterJobsForCurrentSession(listJobs(workspaceRoot), input));
  const runningJob = jobs.find((job) => job.status === "queued" || job.status === "running");
  const runningTaskNote = runningJob
    ? `Copilot task ${runningJob.id} is still running. Check /copilot:status and use /copilot:cancel ${runningJob.id} if you want to stop it before ending the session.`
    : null;

  if (!config.stopReviewGate) {
    logNote(runningTaskNote);
    return;
  }

  const setupNote = buildSetupNote(await getCopilotAvailability(cwd));
  if (setupNote) {
    logNote(setupNote);
    logNote(runningTaskNote);
    return;
  }

  // The gate is on, so a run that cannot even start must block, not let Claude stop unreviewed.
  const review = await runStopReview(cwd, input, { timeoutMs: timeoutMs - (Date.now() - startedAt) }).catch(
    (error) => ({
      ok: false,
      reason: `The stop-time Copilot review task failed: ${error instanceof Error ? error.message : String(error)}`
    })
  );
  if (review.signal) {
    logNote(review.reason);
    process.exitCode = SIGNAL_EXIT_CODES[review.signal];
    return;
  }
  if (!review.ok) {
    emitDecision({
      decision: "block",
      reason: runningTaskNote ? `${runningTaskNote} ${review.reason}` : review.reason
    });
    return;
  }

  logNote(runningTaskNote);
}

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
