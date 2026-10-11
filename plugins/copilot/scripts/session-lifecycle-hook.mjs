#!/usr/bin/env node
// Changed from upstream codex-plugin-cc (Apache-2.0): ported from session-lifecycle-hook.mjs for the
// Copilot CLI, with no broker and no transcript path. SessionEnd closes the session and marks its
// active jobs cancelled in one locked update, stops their companions and Copilot processes with one
// shared wait, and then removes the session's finished jobs and the jobs it stopped, all inside the
// hook's 5 s timeout.

import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { terminateProcessTree } from "./lib/process.mjs";
import { hasPendingStop, updateState } from "./lib/state.mjs";
import { nowIso, SESSION_ID_ENV } from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
// The hook's timeout is 5 s, and Node's start and a slow machine come out of it.
const SESSION_END_BUDGET_MS = 3500;
const STOP_WAIT_MS = 2000;

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
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
        return { ...job, status: "cancelled", phase: "cancelled", completedAt: closedAt, updatedAt: closedAt };
      });
    },
    { lockTimeoutMs: timeLeft(), deadline }
  );

  // One shared wait, then SIGKILL, so three jobs cost no more time than one. A job whose processes
  // could not all be stopped keeps its record, so /copilot:cancel can try again; as in cancel, only
  // the pids whose stop failed stay in it, because a stopped pid can be reused.
  const forceKillAfterMs = Math.min(STOP_WAIT_MS, timeLeft());
  const stoppedPids = new Map();
  await Promise.all(
    stopping.map(async (job) => {
      const keys = ["pid", "copilotPid"].filter((key) => job[key]);
      const outcomes = await Promise.allSettled(keys.map((key) => terminate(job[key], { forceKillAfterMs })));
      if (outcomes.every((outcome) => outcome.status === "fulfilled")) {
        removedIds.add(job.id);
      } else {
        stoppedPids.set(
          job.id,
          keys.filter((_, index) => outcomes[index].status === "fulfilled").map((key) => [key, job[key]])
        );
      }
    })
  );

  if (removedIds.size > 0 || stoppedPids.size > 0) {
    updateState(
      workspaceRoot,
      (state) => {
        state.jobs = state.jobs
          .filter((job) => !removedIds.has(job.id))
          .map((job) => {
            const cleared = (stoppedPids.get(job.id) ?? []).filter(([key, pid]) => job[key] === pid);
            return { ...job, ...Object.fromEntries(cleared.map(([key]) => [key, null])) };
          });
      },
      { lockTimeoutMs: timeLeft(), deadline }
    );
  }
}

function handleSessionStart(input) {
  appendEnvVar(SESSION_ID_ENV, input.session_id);
  appendEnvVar(PLUGIN_DATA_ENV, process.env[PLUGIN_DATA_ENV]);
}

async function handleSessionEnd(input) {
  const cwd = input.cwd || process.cwd();
  await cleanupSessionJobs(cwd, input.session_id || process.env[SESSION_ID_ENV]);
}

async function main() {
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
