// Changed from upstream codex-plugin-cc (Apache-2.0): the fallback state root is in the home folder;
// updateState holds a lock file and writes through a rename; saveState is removed, so no writer saves
// an earlier snapshot; pruning keeps every active job and also removes a job's review patch folder;
// state records closed Claude sessions.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_DIR_NAME = ".copilot-companion";
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const MAX_JOBS = 50;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 25;
const CLOSED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    version: STATE_VERSION,
    config: {
      stopReviewGate: false
    },
    jobs: [],
    closedSessions: []
  };
}

// Each lookup starts git, and a locked update makes several. The root of a folder does not change
// while a companion runs.
const workspaceRoots = new Map();

function resolveWorkspaceRoots(cwd) {
  if (!workspaceRoots.has(cwd)) {
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    let canonicalWorkspaceRoot = workspaceRoot;
    try {
      canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
    } catch {
      canonicalWorkspaceRoot = workspaceRoot;
    }
    workspaceRoots.set(cwd, { workspaceRoot, canonicalWorkspaceRoot });
  }
  return workspaceRoots.get(cwd);
}

export function resolveStateDir(cwd) {
  const { workspaceRoot, canonicalWorkspaceRoot } = resolveWorkspaceRoots(cwd);
  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonicalWorkspaceRoot).digest("hex").slice(0, 16);
  return path.join(resolvePluginDataDir(), "state", `${slug}-${hash}`);
}

// Not the shared temp folder: another local user could create it first and plant job records.
function fallbackDir() {
  return path.join(os.homedir(), FALLBACK_DIR_NAME);
}

export function resolvePluginDataDir(env = process.env) {
  return env[PLUGIN_DATA_ENV] || fallbackDir();
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), STATE_FILE_NAME);
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), JOBS_DIR_NAME);
}

export function ensurePluginDataDir(env = process.env) {
  if (!env[PLUGIN_DATA_ENV] && process.platform !== "win32") {
    // Others must not read the logs, or change the pids that cancel signals. A folder that already
    // exists keeps its old mode unless it is changed here. A Windows profile folder is private already.
    fs.mkdirSync(fallbackDir(), { recursive: true, mode: 0o700 });
    fs.chmodSync(fallbackDir(), 0o700);
  }
  const dataDir = resolvePluginDataDir(env);
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

export function ensureStateDir(cwd) {
  ensurePluginDataDir();
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

export function loadState(cwd, options = {}) {
  const stateFile = resolveStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not a JSON object");
    }
    return {
      ...defaultState(),
      ...parsed,
      config: {
        ...defaultState().config,
        ...(parsed.config ?? {})
      },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      closedSessions: Array.isArray(parsed.closedSessions) ? parsed.closedSessions : []
    };
  } catch (error) {
    // An update must not save the empty default over job records that cancel still needs.
    if (options.strict) {
      throw new Error(
        `Cannot read the job state ${stateFile} (${error.message}). It was not changed. Fix or delete it and retry.`
      );
    }
    return defaultState();
  }
}

function isActiveJob(job) {
  return job.status === "queued" || job.status === "running";
}

// The cap counts finished jobs only: pruning a running job would lose the pids that cancel needs.
function pruneJobs(jobs) {
  let finishedJobs = 0;
  return [...jobs]
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .filter((job) => isActiveJob(job) || ++finishedJobs <= MAX_JOBS);
}

function pruneClosedSessions(closedSessions) {
  const cutoff = Date.now() - CLOSED_SESSION_TTL_MS;
  return closedSessions.filter((entry) => Date.parse(entry?.closedAt ?? "") >= cutoff);
}

function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function readLockOwner(lockFile) {
  try {
    const owner = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    // A pid of 0 or below names a process group, not an owner, so such a lock counts as unreadable.
    const valid = Number.isInteger(owner?.pid) && owner.pid > 0 && typeof owner.token === "string" && owner.token;
    return valid ? owner : null;
  } catch {
    return null;
  }
}

function tryCreateLock(lockFile, owner) {
  let fd;
  try {
    fd = fs.openSync(lockFile, "wx");
  } catch (error) {
    // Windows reports EPERM while another process is still deleting the old lock file.
    if (error?.code === "EEXIST" || (error?.code === "EPERM" && process.platform === "win32")) {
      return false;
    }
    throw error;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify(owner), "utf8");
  } catch (error) {
    // A lock with no readable owner is never reclaimed, so this attempt must not leave one.
    fs.closeSync(fd);
    fs.rmSync(lockFile, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  return true;
}

function releaseLock(lockFile, token) {
  if (readLockOwner(lockFile)?.token === token) {
    fs.rmSync(lockFile, { force: true });
  }
}

// Age alone never frees a lock: a long update by a live process must keep it.
function reclaimDeadLock(lockFile, options) {
  const isAlive = options.isPidAliveImpl ?? isPidAlive;
  const holder = readLockOwner(lockFile);
  if (!holder || isAlive(holder.pid)) {
    return;
  }

  const reclaimFile = `${lockFile}.reclaim`;
  const reclaimer = { pid: process.pid, token: randomUUID() };
  if (!tryCreateLock(reclaimFile, reclaimer)) {
    const other = readLockOwner(reclaimFile);
    if (other && !isAlive(other.pid)) {
      throw new Error(
        `The state lock ${reclaimFile} belongs to process ${other.pid}, which is no longer running. Delete ${reclaimFile} and retry.`
      );
    }
    return;
  }

  try {
    // Another reclaimer may have freed the dead lock and a live process taken it since the check above.
    const current = readLockOwner(lockFile);
    if (current && !isAlive(current.pid)) {
      fs.rmSync(lockFile, { force: true });
    }
  } finally {
    releaseLock(reclaimFile, reclaimer.token);
  }
}

function describeLockBlocker(lockFile, options) {
  const isAlive = options.isPidAliveImpl ?? isPidAlive;
  const holder = readLockOwner(lockFile);
  const reclaimFile = `${lockFile}.reclaim`;
  if (!holder) {
    return "The lock has no readable owner; if no Copilot companion is running, delete it and retry.";
  }
  // A reclaimer that died before it wrote its owner leaves a reclaim file that no one can free.
  if (!isAlive(holder.pid) && fs.existsSync(reclaimFile)) {
    return `Process ${holder.pid} has ended, but ${reclaimFile} blocks freeing its lock; if no Copilot companion is running, delete ${reclaimFile} and retry.`;
  }
  return `Process ${holder.pid} holds the lock; retry when it finishes.`;
}

function acquireStateLock(cwd, options) {
  const lockFile = `${resolveStateFile(cwd)}.lock`;
  const timeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const owner = { pid: process.pid, token: randomUUID() };
  const deadline = Date.now() + timeoutMs;
  ensureStateDir(cwd);
  for (;;) {
    if (tryCreateLock(lockFile, owner)) {
      return { lockFile, token: owner.token };
    }
    reclaimDeadLock(lockFile, options);
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs} ms waiting for the state lock ${lockFile}. The state was not changed. ` +
          describeLockBlocker(lockFile, options)
      );
    }
    sleepSync(LOCK_RETRY_MS);
  }
}

// A reader must never see half a file, and a failed write must keep the old one.
function writeJsonAtomic(filePath, value) {
  const tempFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempFile, filePath);
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw error;
  }
}

function writeStateFile(cwd, state) {
  writeJsonAtomic(resolveStateFile(cwd), state);
}

export function updateState(cwd, mutate, options = {}) {
  const lock = acquireStateLock(cwd, options);
  try {
    const state = loadState(cwd, { strict: true });
    const previousJobs = state.jobs.map((job) => ({ id: job.id, logFile: job.logFile }));
    mutate(state);

    const nextJobs = pruneJobs(state.jobs ?? []);
    const nextState = {
      version: STATE_VERSION,
      config: {
        ...defaultState().config,
        ...(state.config ?? {})
      },
      jobs: nextJobs,
      closedSessions: pruneClosedSessions(state.closedSessions ?? [])
    };

    writeStateFile(cwd, nextState);

    // Only after the save: a failed save must keep the files that the old state still names.
    const retainedIds = new Set(nextJobs.map((job) => job.id));
    for (const job of [...previousJobs, ...(state.jobs ?? [])]) {
      if (retainedIds.has(job.id)) {
        continue;
      }
      try {
        removeJobFile(resolveJobFile(cwd, job.id));
        removeFileIfExists(job.logFile);
        fs.rmSync(resolveJobPatchDir(cwd, job.id), { recursive: true, force: true });
      } catch {
        // The update is saved; a file that cannot be removed now is only left behind.
      }
    }
    return nextState;
  } finally {
    releaseLock(lock.lockFile, lock.token);
  }
}

function processStartedAtMs() {
  return Date.now() - process.uptime() * 1000;
}

// A resumed Claude session keeps its id, so only companions from before the close are refused.
export function assertSessionOpen(state, sessionId, startedAtMs = processStartedAtMs()) {
  if (!sessionId) {
    return;
  }
  const closedSinceStart = (state.closedSessions ?? []).some(
    (entry) => entry?.id === sessionId && Date.parse(entry.closedAt) > startedAtMs
  );
  if (closedSinceStart) {
    throw new Error(`Claude session ${sessionId} has ended. Start a new Copilot job from the current session.`);
  }
}

export function generateJobId(prefix = "job") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function upsertJob(cwd, jobPatch, options = {}) {
  return updateState(
    cwd,
    (state) => {
      const timestamp = nowIso();
      const existingIndex = state.jobs.findIndex((job) => job.id === jobPatch.id);
      if (existingIndex === -1) {
        assertSessionOpen(state, jobPatch.sessionId);
        state.jobs.unshift({
          createdAt: timestamp,
          updatedAt: timestamp,
          ...jobPatch
        });
        return;
      }
      state.jobs[existingIndex] = {
        ...state.jobs[existingIndex],
        ...jobPatch,
        updatedAt: timestamp
      };
    },
    options
  );
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

export function setConfig(cwd, key, value) {
  return updateState(cwd, (state) => {
    state.config = {
      ...state.config,
      [key]: value
    };
  });
}

export function getConfig(cwd) {
  return loadState(cwd).config;
}

export function writeJobFile(cwd, jobId, payload) {
  ensureStateDir(cwd);
  const jobFile = resolveJobFile(cwd, jobId);
  writeJsonAtomic(jobFile, payload);
  return jobFile;
}

export function readJobFile(jobFile) {
  return JSON.parse(fs.readFileSync(jobFile, "utf8"));
}

function removeJobFile(jobFile) {
  if (fs.existsSync(jobFile)) {
    fs.unlinkSync(jobFile);
  }
}

export function resolveJobLogFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function resolveJobFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}

// A review above the inline limit keeps its patches here while it runs.
export function resolveJobPatchDir(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.patches`);
}
