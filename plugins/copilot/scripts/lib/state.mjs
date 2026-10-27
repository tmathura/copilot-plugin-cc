// Changed from upstream codex-plugin-cc (Apache-2.0): the fallback state root is in the home folder;
// updateState holds a lock file and writes through a rename; saveState is removed, so no writer saves
// an earlier snapshot; pruning keeps every active job and also removes a job's review patch folder;
// state records closed Claude sessions; on Windows, a file replace or read that meets another process
// is retried; a companion that a hook starts counts from the hook's start for the closed-session check; a caller's deadline also
// limits the Windows retries of an update; the companion's own data folder export wins over
// CLAUDE_PLUGIN_DATA; a lock file is linked into place with its owner already written.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
// The SessionStart hook exports the data folder under this name for Claude's Bash tool. Another
// plugin, such as the Codex plugin, exports CLAUDE_PLUGIN_DATA there too, and the last export wins.
export const COMPANION_PLUGIN_DATA_ENV = "COPILOT_COMPANION_PLUGIN_DATA";
const FALLBACK_DIR_NAME = ".copilot-companion";
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const MAX_JOBS = 50;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 25;
const WINDOWS_RETRY_MS = 2000;
const WINDOWS_RETRY_STEP_MS = 5;
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

// A hook gets CLAUDE_PLUGIN_DATA from Claude Code for this plugin, or none, which means the fallback.
// A companion export inherited from the shell that started Claude must not win over either, also in
// the companion that the hook starts.
export function useHookPluginData(env = process.env) {
  if (env[PLUGIN_DATA_ENV]) {
    env[COMPANION_PLUGIN_DATA_ENV] = env[PLUGIN_DATA_ENV];
  } else {
    delete env[COMPANION_PLUGIN_DATA_ENV];
  }
}

export function resolvePluginDataDir(env = process.env) {
  return env[COMPANION_PLUGIN_DATA_ENV] || env[PLUGIN_DATA_ENV] || fallbackDir();
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), STATE_FILE_NAME);
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), JOBS_DIR_NAME);
}

export function ensurePluginDataDir(env = process.env) {
  const dataDir = resolvePluginDataDir(env);
  // The SessionStart hook can export the fallback folder too, so the check is on the folder itself.
  if (path.resolve(dataDir) === path.resolve(fallbackDir()) && process.platform !== "win32") {
    // Others must not read the logs, or change the pids that cancel signals. A folder that already
    // exists keeps its old mode unless it is changed here. A Windows profile folder is private already.
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dataDir, 0o700);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

export function ensureStateDir(cwd) {
  ensurePluginDataDir();
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

export function loadState(cwd, options = {}) {
  const stateFile = resolveStateFile(cwd);
  try {
    const parsed = JSON.parse(readTextFile(stateFile, `${stateFile}.lock`, options.deadline));
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
    if (error?.code === "ENOENT") {
      return defaultState();
    }
    // An update must not save the empty default over job records that cancel still needs.
    if (options.strict) {
      throw new Error(
        `Cannot read the job state ${stateFile} (${error.message}). It was not changed. Fix or delete it and retry.`
      );
    }
    return defaultState();
  }
}

// A finished job names a pid only when a stop did not finish, a cancel's or its own: its processes
// may still run, and a cancel needs the pids.
export function hasPendingStop(job) {
  return (job.status === "cancelled" || job.status === "failed") && Boolean(job.pid || job.copilotPid);
}
function isActiveJob(job) {
  return job.status === "queued" || job.status === "running" || hasPendingStop(job);
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

// A lock with no readable owner is never reclaimed, so a lock name appears only as a link to an owner
// file that is already written. An owner file left by a killed process has a unique name and blocks
// nothing.
function writeOwnerFile(lockFile, owner) {
  const ownerFile = `${lockFile}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(ownerFile, "wx");
  try {
    try {
      fs.writeFileSync(fd, JSON.stringify(owner), "utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    removeOwnerFile(ownerFile);
    throw error;
  }
  return ownerFile;
}

function removeOwnerFile(ownerFile) {
  try {
    fs.rmSync(ownerFile, { force: true });
  } catch {
    // A leftover owner file blocks nothing; the lock result must not be lost over it.
  }
}

function tryLinkLock(ownerFile, lockFile) {
  try {
    fs.linkSync(ownerFile, lockFile);
    return true;
  } catch (error) {
    // Windows reports EPERM while another process is still deleting the old lock file.
    if (error?.code === "EEXIST" || (error?.code === "EPERM" && process.platform === "win32")) {
      return false;
    }
    throw error;
  }
}

function releaseLock(lockFile, token) {
  if (readLockOwner(lockFile)?.token === token) {
    fs.rmSync(lockFile, { force: true });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The reclaim locks form a chain. A level whose owner has died is never removed: it points to the next
// level, named by that owner's token, so every reclaimer, also one that read the chain a while ago,
// contends on the same first free level. The token becomes part of a file name, so only a UUID is used.
function nextReclaimLevel(lockFile, owner, seen, isAlive) {
  const token = owner?.token.toLowerCase();
  if (!owner || !UUID.test(token) || seen.has(token) || isAlive(owner.pid)) {
    return null;
  }
  seen.add(token);
  return `${lockFile}.reclaim.${token}`;
}

// Age alone never frees a lock: a long update by a live process must keep it.
function reclaimDeadLock(lockFile, options) {
  const isAlive = options.isPidAliveImpl ?? isPidAlive;
  const holder = readLockOwner(lockFile);
  if (!holder || isAlive(holder.pid)) {
    return;
  }

  const reclaimer = { pid: process.pid, token: randomUUID() };
  const ownerFile = writeOwnerFile(`${lockFile}.reclaim`, reclaimer);
  const passed = [];
  const seen = new Set();
  let reclaimFile = `${lockFile}.reclaim`;
  try {
    while (!tryLinkLock(ownerFile, reclaimFile)) {
      const other = readLockOwner(reclaimFile);
      const next = nextReclaimLevel(lockFile, other, seen, isAlive);
      if (!next) {
        return;
      }
      passed.push([reclaimFile, other.token]);
      reclaimFile = next;
    }
  } finally {
    removeOwnerFile(ownerFile);
  }

  try {
    // A passed level read while its live owner still held it may have been released and taken since.
    if (passed.some(([file, token]) => readLockOwner(file)?.token !== token)) {
      return;
    }
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
  if (!holder) {
    return "The lock has no readable owner; if no Copilot companion is running, delete it and retry.";
  }
  if (isAlive(holder.pid)) {
    return `Process ${holder.pid} holds the lock; retry when it finishes.`;
  }
  const seen = new Set();
  let reclaimFile = `${lockFile}.reclaim`;
  for (;;) {
    const level = readReclaimLevel(reclaimFile);
    if (level.gone) {
      return `Process ${holder.pid} has ended; retry.`;
    }
    if (level.owner && isAlive(level.owner.pid)) {
      return `Process ${level.owner.pid} is freeing the lock of ended process ${holder.pid}; retry when it finishes.`;
    }
    const next = nextReclaimLevel(lockFile, level.owner, seen, () => false);
    if (!next) {
      // A damaged reclaim file, or one that an older version left without its owner, names no process
      // to check, so no one can free it.
      return `Process ${holder.pid} has ended, but ${reclaimFile} blocks freeing its lock; if no Copilot companion is running, delete ${reclaimFile} and retry.`;
    }
    reclaimFile = next;
  }
}

// A live reclaimer hands a level over by a release and a new link, so a read can fall in the moment the
// level is gone. Each try checks that the level exists, then reads it, so only a level that stays
// unreadable counts as damaged.
function readReclaimLevel(reclaimFile) {
  for (let tries = 0; tries < 3; tries += 1) {
    if (!fs.existsSync(reclaimFile)) {
      return { gone: true };
    }
    const owner = readLockOwner(reclaimFile);
    if (owner) {
      return { owner };
    }
  }
  return {};
}

function acquireStateLock(cwd, options) {
  const lockFile = `${resolveStateFile(cwd)}.lock`;
  const timeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const owner = { pid: process.pid, token: randomUUID() };
  const deadline = Date.now() + timeoutMs;
  ensureStateDir(cwd);
  const ownerFile = writeOwnerFile(lockFile, owner);
  try {
    for (;;) {
      if (tryLinkLock(ownerFile, lockFile)) {
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
  } finally {
    removeOwnerFile(ownerFile);
  }
}

// On Windows a rename cannot replace a file that another process has open, and a reader can miss the
// file for the moment it is replaced. Each lasts about as long as one read or one rename. A caller with
// its own time limit, such as a hook, passes an earlier deadline.
function retryOnWindows(action, isTransient, callerDeadline = Infinity) {
  const deadline = Math.min(Date.now() + WINDOWS_RETRY_MS, callerDeadline);
  for (;;) {
    try {
      return action();
    } catch (error) {
      if (process.platform !== "win32" || !isTransient(error) || Date.now() >= deadline) {
        throw error;
      }
      sleepSync(WINDOWS_RETRY_STEP_MS);
    }
  }
}

function isBusyFileError(error) {
  return ["EPERM", "EACCES", "EBUSY"].includes(error?.code);
}

// State and job files are replaced only under the state lock, so a missing file is only worth a retry
// while another process holds that lock. A lock with no readable owner may be one that an older version
// was still writing.
function isLockHeldByOther(lockFile) {
  return fs.existsSync(lockFile) && readLockOwner(lockFile)?.pid !== process.pid;
}

// The writer may also have finished, and released the lock, by the time the reader checks.
function readTextFile(filePath, lockFile, deadline) {
  return retryOnWindows(
    () => fs.readFileSync(filePath, "utf8"),
    (error) =>
      isBusyFileError(error) || (error?.code === "ENOENT" && (isLockHeldByOther(lockFile) || fs.existsSync(filePath))),
    deadline
  );
}

// A reader must never see half a file, and a failed write must keep the old one.
function writeJsonAtomic(filePath, value, deadline) {
  const tempFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    retryOnWindows(() => fs.renameSync(tempFile, filePath), isBusyFileError, deadline);
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw error;
  }
}

function writeStateFile(cwd, state, deadline) {
  writeJsonAtomic(resolveStateFile(cwd), state, deadline);
}

// options.deadline, an absolute time in ms, also limits the Windows retries of the read and the save.
export function updateState(cwd, mutate, options = {}) {
  const lock = acquireStateLock(cwd, options);
  try {
    const state = loadState(cwd, { strict: true, deadline: options.deadline });
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

    writeStateFile(cwd, nextState, options.deadline);

    // Only after the save: a failed save must keep the files that the old state still names.
    const retainedIds = new Set(nextJobs.map((job) => job.id));
    for (const job of [...previousJobs, ...(state.jobs ?? [])]) {
      if (retainedIds.has(job.id)) {
        continue;
      }
      // The update is saved; a file that cannot be removed now is only left behind, and must not keep
      // the job's other files from going.
      for (const remove of [
        () => removeJobFile(resolveJobFile(cwd, job.id)),
        () => removeFileIfExists(job.logFile),
        () => fs.rmSync(resolveJobPatchDir(cwd, job.id), { recursive: true, force: true })
      ]) {
        try {
          remove();
        } catch {
          // Left behind.
        }
      }
    }
    return nextState;
  } finally {
    releaseLock(lock.lockFile, lock.token);
  }
}

export const LAUNCHED_AT_ENV = "COPILOT_COMPANION_LAUNCHED_AT";

// A companion that a hook starts counts from the hook's own start: a session that ends while the hook
// still prepares must refuse that companion too.
export function processStartedAtMs() {
  const ownStart = Date.now() - process.uptime() * 1000;
  const launchedAt = Number(process.env[LAUNCHED_AT_ENV]);
  return launchedAt > 0 ? Math.min(ownStart, launchedAt) : ownStart;
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

export function writeJobFile(cwd, jobId, payload, options = {}) {
  ensureStateDir(cwd);
  const jobFile = resolveJobFile(cwd, jobId);
  writeJsonAtomic(jobFile, payload, options.deadline);
  return jobFile;
}

export function readJobFile(jobFile, options = {}) {
  const lockFile = path.join(path.dirname(path.dirname(jobFile)), `${STATE_FILE_NAME}.lock`);
  return JSON.parse(readTextFile(jobFile, lockFile, options.deadline));
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
