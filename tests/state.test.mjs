// Changed from upstream codex-plugin-cc (Apache-2.0): renamed for the copilot plugin; the fallback
// state root is in the home folder; adds tests for the state lock, pruning and closed sessions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { resolveCancelableJob } from "../plugins/copilot/scripts/lib/job-control.mjs";
import {
  listJobs,
  loadState,
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  resolveStateFile,
  updateState,
  upsertJob
} from "../plugins/copilot/scripts/lib/state.mjs";

const STATE_MODULE_URL = new URL("../plugins/copilot/scripts/lib/state.mjs", import.meta.url).href;

// Tests that write state never touch the real fallback folder in the home folder.
process.env.CLAUDE_PLUGIN_DATA = makeTempDir();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deadPid() {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

function writeLock(lockFile, owner) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify(owner), "utf8");
}

function addJobWithFiles(workspace, job) {
  const logFile = resolveJobLogFile(workspace, job.id);
  fs.writeFileSync(logFile, `log ${job.id}\n`, "utf8");
  fs.writeFileSync(resolveJobFile(workspace, job.id), JSON.stringify({ id: job.id }), "utf8");
  return { ...job, logFile };
}

test("resolveStateDir falls back to a per-workspace folder under the home folder", () => {
  const workspace = makeTempDir();
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;

  try {
    const stateDir = resolveStateDir(workspace);
    const fallbackRoot = path.join(os.homedir(), ".copilot-companion", "state");

    assert.equal(path.dirname(stateDir), fallbackRoot);
    assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
    assert.equal(stateDir.startsWith(os.tmpdir()), false);
  } finally {
    process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
  }
});

test("resolveStateDir uses CLAUDE_PLUGIN_DATA when it is provided", () => {
  const workspace = makeTempDir();
  const pluginDataDir = makeTempDir();
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;

  try {
    const stateDir = resolveStateDir(workspace);

    assert.equal(stateDir.startsWith(path.join(pluginDataDir, "state")), true);
    assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
    assert.match(stateDir, new RegExp(`^${escapeRegExp(path.join(pluginDataDir, "state"))}`));
  } finally {
    process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
  }
});

test("updateState prunes dropped job artifacts when indexed jobs exceed the cap", () => {
  const workspace = makeTempDir();
  const stateFile = resolveStateFile(workspace);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });

  const jobs = Array.from({ length: 51 }, (_, index) => {
    const jobId = `job-${index}`;
    const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
    const logFile = resolveJobLogFile(workspace, jobId);
    const jobFile = resolveJobFile(workspace, jobId);
    fs.writeFileSync(logFile, `log ${jobId}\n`, "utf8");
    fs.writeFileSync(jobFile, JSON.stringify({ id: jobId, status: "completed" }, null, 2), "utf8");
    return {
      id: jobId,
      status: "completed",
      logFile,
      updatedAt,
      createdAt: updatedAt
    };
  });

  fs.writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        version: 1,
        config: { stopReviewGate: false },
        jobs
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  updateState(workspace, (state) => {
    state.jobs = jobs;
  });

  const prunedJobFile = resolveJobFile(workspace, "job-0");
  const retainedJobFile = resolveJobFile(workspace, "job-50");
  const retainedLogFile = resolveJobLogFile(workspace, "job-50");
  const jobsDir = path.dirname(prunedJobFile);

  assert.equal(fs.existsSync(retainedJobFile), true);
  assert.equal(fs.existsSync(retainedLogFile), true);

  const savedState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(savedState.jobs.length, 50);
  assert.deepEqual(
    savedState.jobs.map((job) => job.id),
    Array.from({ length: 50 }, (_, index) => `job-${50 - index}`)
  );
  assert.deepEqual(
    fs.readdirSync(jobsDir).sort(),
    Array.from({ length: 50 }, (_, index) => `job-${index + 1}`)
      .flatMap((jobId) => [`${jobId}.json`, `${jobId}.log`])
      .sort()
  );
});

test("an older running job survives 55 newer finished jobs and can still be cancelled", () => {
  const workspace = makeTempDir();
  const runningJob = addJobWithFiles(workspace, {
    id: "task-running",
    status: "running",
    pid: process.pid,
    updatedAt: new Date(Date.UTC(2026, 0, 1)).toISOString()
  });
  const finishedJobs = Array.from({ length: 55 }, (_, index) =>
    addJobWithFiles(workspace, {
      id: `task-done-${index}`,
      status: "completed",
      updatedAt: new Date(Date.UTC(2026, 1, 1, 0, index)).toISOString()
    })
  );

  updateState(workspace, (state) => {
    state.jobs = [runningJob, ...finishedJobs];
  });

  const jobs = listJobs(workspace);
  assert.equal(jobs.filter((job) => job.status === "completed").length, 50);
  assert.ok(jobs.some((job) => job.id === "task-running"));
  assert.equal(fs.existsSync(resolveJobFile(workspace, "task-running")), true);
  assert.equal(fs.existsSync(runningJob.logFile), true);
  assert.equal(resolveCancelableJob(workspace, "task-running").job.id, "task-running");
});

test("processes that add jobs at the same time all keep their records and logs", async () => {
  const workspace = makeTempDir();
  const processCount = 6;
  const jobsPerProcess = 5;
  const script = `
import fs from "node:fs";
const { resolveJobLogFile, upsertJob, writeJobFile } = await import(${JSON.stringify(STATE_MODULE_URL)});
const [workspace, tag] = process.argv.slice(1);
for (let index = 0; index < ${jobsPerProcess}; index += 1) {
  const id = "task-" + tag + "-" + index;
  const logFile = resolveJobLogFile(workspace, id);
  fs.writeFileSync(logFile, "log\\n");
  writeJobFile(workspace, id, { id });
  upsertJob(workspace, { id, status: "running", pid: process.pid, logFile }, { lockTimeoutMs: 20000 });
}`;

  const exits = Array.from({ length: processCount }, (_, index) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, workspace, `p${index}`], {
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    return new Promise((resolve) => child.once("exit", (code) => resolve({ code, stderr })));
  });
  for (const { code, stderr } of await Promise.all(exits)) {
    assert.equal(code, 0, stderr);
  }

  const jobs = listJobs(workspace);
  assert.equal(jobs.length, processCount * jobsPerProcess);
  for (const job of jobs) {
    assert.equal(fs.existsSync(resolveJobFile(workspace, job.id)), true);
    assert.equal(fs.existsSync(job.logFile), true);
    assert.equal(resolveCancelableJob(workspace, job.id).job.id, job.id);
  }
});

test("updateState reclaims a lock whose owner is dead", () => {
  const workspace = makeTempDir();
  const lockFile = `${resolveStateFile(workspace)}.lock`;
  writeLock(lockFile, { pid: deadPid(), token: "dead-owner" });

  updateState(workspace, (state) => {
    state.config.stopReviewGate = true;
  });

  assert.equal(loadState(workspace).config.stopReviewGate, true);
  assert.equal(fs.existsSync(lockFile), false);
});

test("a lock held by a live process stays, however old, and the waiting update changes nothing", async () => {
  const workspace = makeTempDir();
  updateState(workspace, (state) => {
    state.config.stopReviewGate = false;
  });
  const stateFile = resolveStateFile(workspace);
  const before = fs.readFileSync(stateFile, "utf8");
  const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const lockFile = `${stateFile}.lock`;
  writeLock(lockFile, { pid: holder.pid, token: "live-owner" });
  const longAgo = new Date(Date.now() - 24 * 3600 * 1000);
  fs.utimesSync(lockFile, longAgo, longAgo);

  try {
    assert.throws(
      () =>
        updateState(
          workspace,
          (state) => {
            state.config.stopReviewGate = true;
          },
          { lockTimeoutMs: 300 }
        ),
      new RegExp(`Timed out after 300 ms waiting for the state lock .*Process ${holder.pid} holds the lock`)
    );

    assert.equal(fs.readFileSync(stateFile, "utf8"), before);
    assert.equal(JSON.parse(fs.readFileSync(lockFile, "utf8")).token, "live-owner");
  } finally {
    holder.kill();
    fs.rmSync(lockFile, { force: true });
  }
});

test("a lock with no readable owner stays, and the error says how to clear it", () => {
  const workspace = makeTempDir();
  const lockFile = `${resolveStateFile(workspace)}.lock`;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, "", "utf8");

  assert.throws(
    () => updateState(workspace, () => {}, { lockTimeoutMs: 200 }),
    /The lock has no readable owner; if no Copilot companion is running, delete it and retry\./
  );
  assert.equal(fs.existsSync(lockFile), true);
});

test("a lock holder never removes a lock that holds another token", () => {
  const workspace = makeTempDir();
  const lockFile = `${resolveStateFile(workspace)}.lock`;

  updateState(workspace, () => {
    writeLock(lockFile, { pid: process.pid, token: "someone-else" });
  });

  assert.equal(JSON.parse(fs.readFileSync(lockFile, "utf8")).token, "someone-else");
  fs.rmSync(lockFile, { force: true });
});

test("a reclaimer that saw a dead owner does not remove the lock that a live process took since", () => {
  const workspace = makeTempDir();
  const lockFile = `${resolveStateFile(workspace)}.lock`;
  const deadOwnerPid = 999999;
  writeLock(lockFile, { pid: deadOwnerPid, token: "dead-owner" });
  let firstReclaimerDone = false;

  assert.throws(
    () =>
      updateState(workspace, () => {}, {
        lockTimeoutMs: 200,
        isPidAliveImpl(pid) {
          if (pid !== deadOwnerPid) {
            return true;
          }
          if (!firstReclaimerDone) {
            // While this reclaimer is paused, another one frees the dead lock and a live process takes it.
            fs.rmSync(lockFile);
            writeLock(lockFile, { pid: process.pid, token: "live-holder" });
            firstReclaimerDone = true;
          }
          return false;
        }
      }),
    /Timed out after 200 ms waiting for the state lock/
  );

  assert.equal(JSON.parse(fs.readFileSync(lockFile, "utf8")).token, "live-holder");
  assert.equal(fs.existsSync(`${lockFile}.reclaim`), false);
  fs.rmSync(lockFile, { force: true });
});

test("a reclaim lock whose owner is dead gives a clear error that names it", () => {
  const workspace = makeTempDir();
  const lockFile = `${resolveStateFile(workspace)}.lock`;
  const pid = deadPid();
  writeLock(lockFile, { pid, token: "dead-owner" });
  writeLock(`${lockFile}.reclaim`, { pid, token: "dead-reclaimer" });

  assert.throws(
    () => updateState(workspace, () => {}, { lockTimeoutMs: 200 }),
    new RegExp(`${escapeRegExp(`${lockFile}.reclaim`)} belongs to process ${pid}, which is no longer running\\. Delete`)
  );
  assert.equal(fs.existsSync(lockFile), true);
});

test("upsertJob refuses a new job for a Claude session that closed after this process started", () => {
  const workspace = makeTempDir();
  updateState(workspace, (state) => {
    state.closedSessions = [{ id: "closed-session", closedAt: new Date().toISOString() }];
  });

  assert.throws(
    () => upsertJob(workspace, { id: "task-late", status: "running", sessionId: "closed-session" }),
    /Claude session closed-session has ended/
  );
  assert.deepEqual(listJobs(workspace), []);
});

test("upsertJob accepts a job from a resumed session whose companion started after the close", () => {
  const workspace = makeTempDir();
  const processStartedAt = Date.now() - process.uptime() * 1000;
  updateState(workspace, (state) => {
    state.closedSessions = [{ id: "resumed-session", closedAt: new Date(processStartedAt - 60000).toISOString() }];
  });

  upsertJob(workspace, { id: "task-resumed", status: "running", sessionId: "resumed-session" });

  assert.deepEqual(listJobs(workspace).map((job) => job.id), ["task-resumed"]);
});

test("closed sessions are kept for 30 days", () => {
  const workspace = makeTempDir();
  const day = 24 * 3600 * 1000;

  updateState(workspace, (state) => {
    state.closedSessions = [
      { id: "recent", closedAt: new Date(Date.now() - 29 * day).toISOString() },
      { id: "expired", closedAt: new Date(Date.now() - 31 * day).toISOString() }
    ];
  });

  assert.deepEqual(loadState(workspace).closedSessions.map((entry) => entry.id), ["recent"]);
});
