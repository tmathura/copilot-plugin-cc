#!/usr/bin/env node
// Changed from upstream codex-plugin-cc (Apache-2.0): ported from session-lifecycle-hook.mjs for the
// Copilot CLI, with no broker and no transcript path. SessionStart exports the data folder under the
// companion's own name, not CLAUDE_PLUGIN_DATA, and both events use Claude Code's own
// CLAUDE_PLUGIN_DATA over an inherited export. SessionEnd closes the session and marks its
// active jobs cancelled in one locked update, stops their companions and Copilot processes by one
// shared deadline, and then removes the session's finished jobs and the jobs it stopped, all inside the
// hook's 5 s timeout. A pid whose stop shows it has exited counts as stopped.

import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readStdinSync } from "./lib/fs.mjs";
import { terminateProcessTree } from "./lib/process.mjs";
import {
  COMPANION_PLUGIN_DATA_ENV,
  hasPendingStop,
  readJobFile,
  resolveJobFile,
  resolvePluginDataDir,
  updateState,
  useHookPluginData,
  writeJobFile
} from "./lib/state.mjs";
import { nowIso, SESSION_ID_ENV } from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

// The hook's timeout is 5 s, and Node's start and a slow machine come out of it.
const SESSION_END_BUDGET_MS = 3500;
const STOP_WAIT_MS = 2000;
// The stop wait leaves this much for the last update, which removes the stopped jobs.
const FINAL_UPDATE_RESERVE_MS = 500;
// A job file is only a copy of the state entry. All job files of one update share this much Windows
// retry time, so they can never use up the time that the state save and the stops need.
const JOB_FILE_RETRY_MS = 200;

function readHookInput() {
  const raw = readStdinSync().trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function appendEnvVar(name, value) {
  if (!process.env.CLAUDE_ENV_FILE || value == null || value === "") {
    return;
  }
  fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export ${name}=${shellEscape(value)}\n`, "utf8");
}

// The job file should agree with the state, also for a job that is kept after a failed stop. The
// state is what closes the session and stops the jobs, so a job file that cannot be written must not
// stop that; the state entry still holds the outcome.
function writeJobRecord(workspaceRoot, job, deadline) {
  let stored = {};
  try {
    stored = readJobFile(resolveJobFile(workspaceRoot, job.id), { deadline });
  } catch {
    // A missing or broken job file is rebuilt from the state entry.
  }
  try {
    writeJobFile(workspaceRoot, job.id, { ...stored, ...job }, { deadline });
  } catch {
    // Left as it was.
  }
}

// Job creation, the worker claim and the Copilot start all run under the state lock and refuse a
// closed session, so after the first step no job of this session can start anything new. A resumed
// session keeps its id, so only the jobs captured here are removed.
export async function cleanupSessionJobs(cwd, sessionId, options = {}) {
  const terminate = options.terminateImpl ?? terminateProcessTree;
  if (!cwd || !sessionId) {
    return;
  }

  const deadline = Date.now() + SESSION_END_BUDGET_MS;
  const timeLeft = () => Math.max(0, deadline - Date.now());
  // The close is recorded even with no state yet: a companion may still be preparing the first job.
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  // A job whose earlier stop did not finish keeps its record for a later cancel; its pids may be old.
  const removedIds = new Set();
  const stopping = [];
  updateState(
    workspaceRoot,
    (state) => {
      const jobFilesDeadline = Math.min(deadline, Date.now() + JOB_FILE_RETRY_MS);
      const closedAt = nowIso();
      state.closedSessions.push({ id: sessionId, closedAt });
      state.jobs = state.jobs.map((job) => {
        if (job.sessionId !== sessionId || hasPendingStop(job)) {
          return job;
        }
        if (job.status !== "queued" && job.status !== "running") {
          removedIds.add(job.id);
          return job;
        }
        stopping.push(job);
        const cancelled = {
          ...job,
          status: "cancelled",
          phase: "cancelled",
          completedAt: closedAt,
          errorMessage: "The Claude session ended.",
          updatedAt: closedAt
        };
        writeJobRecord(workspaceRoot, cancelled, jobFilesDeadline);
        return cancelled;
      });
    },
    { lockTimeoutMs: timeLeft(), deadline }
  );

  // One shared wait, then SIGKILL, so three jobs cost no more time than one. A job keeps its record
  // while one of its own pids may still be alive, so /copilot:cancel can try again; as in cancel, a pid
  // that stopped or has exited is cleared, because it can be reused. The deadline also bounds each
  // taskkill, and a stop that runs out of time keeps its pids.
  const stopDeadline = Date.now() + Math.max(0, Math.min(STOP_WAIT_MS, timeLeft() - FINAL_UPDATE_RESERVE_MS));
  const stoppedPids = new Map();
  await Promise.all(
    stopping.map(async (job) => {
      const keys = ["pid", "copilotPid"].filter((key) => job[key]);
      const outcomes = await Promise.allSettled(keys.map((key) => terminate(job[key], { deadline: stopDeadline })));
      // A stop that leaves only children of an exited pid is done with that pid: a cancel cannot reach
      // the children, and the pid may be reused. The job then keeps a note that names those children.
      const done = outcomes.map((outcome) => outcome.status === "fulfilled" || Boolean(outcome.reason?.orphans));
      const stored = keys.map((key) => job[key]);
      const children = [
        ...new Set(outcomes.flatMap((outcome) => (outcome.reason?.orphans ? outcome.reason.stillRunning : [])))
      ].filter((pid) => !stored.includes(pid));
      if (done.every(Boolean) && children.length === 0) {
        removedIds.add(job.id);
      } else {
        stoppedPids.set(job.id, {
          cleared: keys.filter((_, index) => done[index]).map((key) => [key, job[key]]),
          children
        });
      }
    })
  );

  if (removedIds.size > 0 || stoppedPids.size > 0) {
    updateState(
      workspaceRoot,
      (state) => {
        const jobFilesDeadline = Math.min(deadline, Date.now() + JOB_FILE_RETRY_MS);
        state.jobs = state.jobs
          .filter((job) => !removedIds.has(job.id))
          .map((job) => {
            const { cleared = [], children = [] } = stoppedPids.get(job.id) ?? {};
            const clearedNow = cleared.filter(([key, pid]) => job[key] === pid);
            if (clearedNow.length === 0 && children.length === 0) {
              return job;
            }
            const kept = { ...job, ...Object.fromEntries(clearedNow.map(([key]) => [key, null])) };
            if (children.length > 0) {
              const note =
                children.length === 1
                  ? `PID ${children[0]} kept running after its parent exited, so a cancel cannot reach it. If Task Manager still shows it as a Copilot or gh process, end it there.`
                  : `${children.map((pid) => `PID ${pid}`).join(", ")} kept running after their parents exited, so a cancel cannot reach them. If Task Manager still shows them as Copilot or gh processes, end them there.`;
              kept.errorMessage = `${job.errorMessage ?? "The Claude session ended."} ${note}`;
            }
            writeJobRecord(workspaceRoot, kept, jobFilesDeadline);
            return kept;
          });
      },
      { lockTimeoutMs: timeLeft(), deadline }
    );
  }
}

function handleSessionStart(input) {
  appendEnvVar(SESSION_ID_ENV, input.session_id);
  // Not CLAUDE_PLUGIN_DATA: an export of that name would point another plugin's companion here. The
  // fallback is exported too, so the commands do not keep a folder inherited from another session.
  appendEnvVar(COMPANION_PLUGIN_DATA_ENV, resolvePluginDataDir());
}

async function handleSessionEnd(input) {
  const cwd = input.cwd || process.cwd();
  await cleanupSessionJobs(cwd, input.session_id || process.env[SESSION_ID_ENV]);
}

async function main() {
  useHookPluginData();
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";

  if (eventName === "SessionStart") {
    handleSessionStart(input);
    return;
  }

  if (eventName === "SessionEnd") {
    await handleSessionEnd(input);
  }
}

// Tests import this module to give the cleanup a stop that fails.
function isMainModule() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
