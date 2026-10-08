// Changed from upstream codex-plugin-cc (Apache-2.0): renamed for the copilot plugin; job status and
// progress writes go through one locked update and never revive a cancelled or missing job.
import fs from "node:fs";
import process from "node:process";

import { assertSessionOpen, readJobFile, resolveJobFile, resolveJobLogFile, updateState, writeJobFile } from "./state.mjs";

export const SESSION_ID_ENV = "COPILOT_COMPANION_SESSION_ID";

export function nowIso() {
  return new Date().toISOString();
}

function normalizeProgressEvent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      message: String(value.message ?? "").trim(),
      phase: typeof value.phase === "string" && value.phase.trim() ? value.phase.trim() : null,
      threadId: typeof value.threadId === "string" && value.threadId.trim() ? value.threadId.trim() : null,
      turnId: typeof value.turnId === "string" && value.turnId.trim() ? value.turnId.trim() : null,
      stderrMessage: value.stderrMessage == null ? null : String(value.stderrMessage).trim(),
      logTitle: typeof value.logTitle === "string" && value.logTitle.trim() ? value.logTitle.trim() : null,
      logBody: value.logBody == null ? null : String(value.logBody).trimEnd()
    };
  }

  return {
    message: String(value ?? "").trim(),
    phase: null,
    threadId: null,
    turnId: null,
    stderrMessage: String(value ?? "").trim(),
    logTitle: null,
    logBody: null
  };
}

export function appendLogLine(logFile, message) {
  const normalized = String(message ?? "").trim();
  if (!logFile || !normalized) {
    return;
  }
  fs.appendFileSync(logFile, `[${nowIso()}] ${normalized}\n`, "utf8");
}

export function appendLogBlock(logFile, title, body) {
  if (!logFile || !body) {
    return;
  }
  fs.appendFileSync(logFile, `\n[${nowIso()}] ${title}\n${String(body).trimEnd()}\n`, "utf8");
}

export function createJobLogFile(workspaceRoot, jobId, title) {
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  fs.writeFileSync(logFile, "", "utf8");
  if (title) {
    appendLogLine(logFile, `Starting ${title}.`);
  }
  return logFile;
}

export function createJobRecord(base, options = {}) {
  const env = options.env ?? process.env;
  const sessionId = env[options.sessionIdEnv ?? SESSION_ID_ENV];
  return {
    ...base,
    createdAt: nowIso(),
    ...(sessionId ? { sessionId } : {})
  };
}

// A missing or broken job file must not stop the final status write; it is rebuilt from the run.
function readJobFileOrNull(jobFile) {
  try {
    return readJobFile(jobFile);
  } catch {
    return null;
  }
}

// Writes the job file and its state entry only while the job is still running, so a cancel stays.
function updateRunningJob(workspaceRoot, jobId, buildRecord, statePatch) {
  updateState(workspaceRoot, (state) => {
    const index = state.jobs.findIndex((job) => job.id === jobId);
    if (index === -1 || state.jobs[index].status !== "running") {
      return;
    }
    const jobFile = resolveJobFile(workspaceRoot, jobId);
    const record = buildRecord(readJobFileOrNull(jobFile));
    if (record) {
      writeJobFile(workspaceRoot, jobId, record);
    }
    state.jobs[index] = {
      ...state.jobs[index],
      ...statePatch,
      updatedAt: nowIso()
    };
  });
}

export function createJobProgressUpdater(workspaceRoot, jobId) {
  const saved = { phase: null, threadId: null, turnId: null };

  return (event) => {
    const normalized = normalizeProgressEvent(event);
    const patch = {};
    for (const key of Object.keys(saved)) {
      if (normalized[key] && normalized[key] !== saved[key]) {
        patch[key] = normalized[key];
      }
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    try {
      updateRunningJob(workspaceRoot, jobId, (storedJob) => storedJob && { ...storedJob, ...patch }, patch);
      // Only a saved value is skipped next time, so a failed write is retried by the next event.
      Object.assign(saved, patch);
    } catch {
      // A status write that cannot take the state lock must not fail the run; the log keeps the line.
    }
  };
}

export function createProgressReporter({ stderr = false, logFile = null, onEvent = null } = {}) {
  if (!stderr && !logFile && !onEvent) {
    return null;
  }

  return (eventOrMessage) => {
    const event = normalizeProgressEvent(eventOrMessage);
    const stderrMessage = event.stderrMessage ?? event.message;
    if (stderr && stderrMessage) {
      process.stderr.write(`[copilot] ${stderrMessage}\n`);
    }
    appendLogLine(logFile, event.message);
    appendLogBlock(logFile, event.logTitle, event.logBody);
    onEvent?.(event);
  };
}

// A new foreground job has no status yet. A stored job runs only while queued, or once this process
// has claimed it; a cancelled or removed job must never start.
function canStartJob(job, existing) {
  if (!existing) {
    return job.status === undefined;
  }
  return existing.status === "queued" || (existing.status === "running" && existing.pid === process.pid);
}

export async function runTrackedJob(job, runner, options = {}) {
  const runningRecord = {
    ...job,
    status: "running",
    startedAt: nowIso(),
    phase: "starting",
    pid: process.pid,
    logFile: options.logFile ?? job.logFile ?? null
  };
  let started = false;
  updateState(job.workspaceRoot, (state) => {
    const index = state.jobs.findIndex((entry) => entry.id === job.id);
    const existing = index === -1 ? null : state.jobs[index];
    if (!canStartJob(job, existing)) {
      return;
    }
    assertSessionOpen(state, job.sessionId);
    writeJobFile(job.workspaceRoot, job.id, runningRecord);
    const timestamp = nowIso();
    if (existing) {
      state.jobs[index] = { ...existing, ...runningRecord, updatedAt: timestamp };
    } else {
      state.jobs.unshift({ createdAt: timestamp, ...runningRecord, updatedAt: timestamp });
    }
    started = true;
  });
  if (!started) {
    throw new Error(`Job ${job.id} was cancelled or removed before it started, so it did not run.`);
  }

  let execution;
  try {
    execution = await runner();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const completedAt = nowIso();
    updateRunningJob(
      job.workspaceRoot,
      job.id,
      (storedJob) => {
        const existing = storedJob ?? runningRecord;
        return {
          ...existing,
          status: "failed",
          phase: "failed",
          errorMessage,
          pid: null,
          completedAt,
          logFile: options.logFile ?? job.logFile ?? existing.logFile ?? null
        };
      },
      {
        status: "failed",
        phase: "failed",
        pid: null,
        errorMessage,
        completedAt
      }
    );
    throw error;
  }

  // A failed status write must not turn a finished run into a failed one, or hide its result.
  const logFile = options.logFile ?? job.logFile ?? null;
  const completionStatus = execution.exitStatus === 0 ? "completed" : "failed";
  const completedAt = nowIso();
  try {
    updateRunningJob(
      job.workspaceRoot,
      job.id,
      () => ({
        ...runningRecord,
        status: completionStatus,
        threadId: execution.threadId ?? null,
        turnId: execution.turnId ?? null,
        pid: null,
        phase: completionStatus === "completed" ? "done" : "failed",
        completedAt,
        result: execution.payload,
        rendered: execution.rendered
      }),
      {
        status: completionStatus,
        threadId: execution.threadId ?? null,
        turnId: execution.turnId ?? null,
        summary: execution.summary,
        phase: completionStatus === "completed" ? "done" : "failed",
        pid: null,
        completedAt
      }
    );
  } catch (error) {
    try {
      appendLogLine(logFile, `Could not save the final job status: ${error instanceof Error ? error.message : error}`);
    } catch {
      // The log lives on the same storage; the result below matters more.
    }
  }
  try {
    appendLogBlock(logFile, "Final output", execution.rendered);
  } catch {
    // As above: a log write never hides a finished run's result.
  }
  return execution;
}
