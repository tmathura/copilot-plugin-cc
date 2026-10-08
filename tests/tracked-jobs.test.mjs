import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { createJobLogFile, createJobProgressUpdater, runTrackedJob } from "../plugins/copilot/scripts/lib/tracked-jobs.mjs";
import { listJobs, readJobFile, resolveJobFile, updateState, upsertJob } from "../plugins/copilot/scripts/lib/state.mjs";

process.env.CLAUDE_PLUGIN_DATA = makeTempDir();

function findJob(workspace, id) {
  return listJobs(workspace).find((job) => job.id === id);
}

function cancelJob(workspace, id) {
  updateState(workspace, (state) => {
    const job = state.jobs.find((entry) => entry.id === id);
    job.status = "cancelled";
    job.phase = "cancelled";
  });
}

const execution = { exitStatus: 0, threadId: "sess-1", payload: { ok: true }, rendered: "done\n", summary: "Done" };

test("runTrackedJob creates and completes a new foreground job", async () => {
  const workspace = makeTempDir();

  await runTrackedJob({ id: "task-new", workspaceRoot: workspace, title: "Copilot Task" }, async () => execution);

  const job = findJob(workspace, "task-new");
  assert.equal(job.status, "completed");
  assert.equal(job.threadId, "sess-1");
  assert.equal(job.pid, null);
  assert.equal(readJobFile(resolveJobFile(workspace, "task-new")).rendered, "done\n");
});

test("runTrackedJob never runs a job that was cancelled before it started", async () => {
  const workspace = makeTempDir();
  upsertJob(workspace, { id: "task-cancelled", status: "cancelled", phase: "cancelled" });
  let ran = false;

  await assert.rejects(
    runTrackedJob({ id: "task-cancelled", workspaceRoot: workspace, status: "queued" }, async () => {
      ran = true;
      return execution;
    }),
    /Job task-cancelled was cancelled or removed before it started, so it did not run\./
  );

  assert.equal(ran, false);
  assert.equal(findJob(workspace, "task-cancelled").status, "cancelled");
});

test("runTrackedJob never revives a stored job whose record is gone", async () => {
  const workspace = makeTempDir();
  let ran = false;

  await assert.rejects(
    runTrackedJob({ id: "task-gone", workspaceRoot: workspace, status: "queued" }, async () => {
      ran = true;
      return execution;
    }),
    /cancelled or removed before it started/
  );

  assert.equal(ran, false);
  assert.equal(findJob(workspace, "task-gone"), undefined);
  assert.equal(fs.existsSync(resolveJobFile(workspace, "task-gone")), false);
});

test("a cancel during the run is not overwritten by the final write or by progress", async () => {
  const workspace = makeTempDir();
  const progress = createJobProgressUpdater(workspace, "task-race");

  await runTrackedJob({ id: "task-race", workspaceRoot: workspace }, async () => {
    cancelJob(workspace, "task-race");
    progress({ phase: "editing", threadId: "sess-2" });
    return execution;
  });

  const job = findJob(workspace, "task-race");
  assert.equal(job.status, "cancelled");
  assert.equal(job.phase, "cancelled");
  assert.equal(readJobFile(resolveJobFile(workspace, "task-race")).status, "running");
});

test("a cancel during a failing run is not overwritten by the failed write", async () => {
  const workspace = makeTempDir();

  await assert.rejects(
    runTrackedJob({ id: "task-fail", workspaceRoot: workspace }, async () => {
      cancelJob(workspace, "task-fail");
      throw new Error("copilot exited");
    }),
    /copilot exited/
  );

  assert.equal(findJob(workspace, "task-fail").status, "cancelled");
});

test("a progress write that fails keeps the job file, and the run still completes", async (t) => {
  const workspace = makeTempDir();
  const progress = createJobProgressUpdater(workspace, "task-full");

  await runTrackedJob({ id: "task-full", workspaceRoot: workspace }, async () => {
    const writeFileSync = fs.writeFileSync;
    const failingWrite = t.mock.method(fs, "writeFileSync", (filePath, ...rest) => {
      if (String(filePath).endsWith(".tmp")) {
        writeFileSync(filePath, "{ half", "utf8");
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      }
      return writeFileSync(filePath, ...rest);
    });
    progress({ phase: "editing" });
    failingWrite.mock.restore();
    assert.equal(readJobFile(resolveJobFile(workspace, "task-full")).status, "running");
    return execution;
  });

  const job = findJob(workspace, "task-full");
  assert.equal(job.status, "completed");
  assert.equal(job.pid, null);
  assert.equal(readJobFile(resolveJobFile(workspace, "task-full")).rendered, "done\n");
});

test("a progress value whose write failed is written by the next event", async (t) => {
  const workspace = makeTempDir();
  const progress = createJobProgressUpdater(workspace, "task-retry");

  await runTrackedJob({ id: "task-retry", workspaceRoot: workspace }, async () => {
    const failingRename = t.mock.method(fs, "renameSync", () => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    });
    progress({ phase: "editing" });
    failingRename.mock.restore();
    assert.equal(findJob(workspace, "task-retry").phase, "starting");

    progress({ phase: "editing" });
    assert.equal(findJob(workspace, "task-retry").phase, "editing");
    return execution;
  });
});

test("a failed final status write still returns the finished run and logs the error", async (t) => {
  const workspace = makeTempDir();
  const logFile = createJobLogFile(workspace, "task-final", "Copilot Task");

  const result = await runTrackedJob({ id: "task-final", workspaceRoot: workspace }, async () => {
    t.mock.method(fs, "renameSync", () => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    });
    return execution;
  }, { logFile });
  t.mock.restoreAll();

  assert.equal(result, execution);
  const log = fs.readFileSync(logFile, "utf8");
  assert.match(log, /Could not save the final job status: disk full/);
  assert.match(log, /Final output\ndone/);
});

test("a finished run returns its result even when the state and the log cannot be written", async (t) => {
  const workspace = makeTempDir();
  const logFile = createJobLogFile(workspace, "task-full-disk", "Copilot Task");

  const result = await runTrackedJob({ id: "task-full-disk", workspaceRoot: workspace }, async () => {
    for (const method of ["renameSync", "appendFileSync"]) {
      t.mock.method(fs, method, () => {
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      });
    }
    return execution;
  }, { logFile });
  t.mock.restoreAll();

  assert.equal(result, execution);
});

test("a broken job file does not stop the final status write", async () => {
  const workspace = makeTempDir();

  await runTrackedJob({ id: "task-broken", workspaceRoot: workspace }, async () => {
    fs.writeFileSync(resolveJobFile(workspace, "task-broken"), "", "utf8");
    return execution;
  });

  assert.equal(findJob(workspace, "task-broken").status, "completed");
  assert.equal(readJobFile(resolveJobFile(workspace, "task-broken")).rendered, "done\n");
});

test("runTrackedJob refuses a new job for a Claude session that has ended", async () => {
  const workspace = makeTempDir();
  updateState(workspace, (state) => {
    state.closedSessions = [{ id: "ended", closedAt: new Date().toISOString() }];
  });

  await assert.rejects(
    runTrackedJob({ id: "task-ended", workspaceRoot: workspace, sessionId: "ended" }, async () => execution),
    /Claude session ended has ended/
  );
  assert.equal(findJob(workspace, "task-ended"), undefined);
});
