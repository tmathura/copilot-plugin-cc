import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  resolveCancelableJob,
  resolveResultJob
} from "../plugins/copilot/scripts/lib/job-control.mjs";
import { updateState } from "../plugins/copilot/scripts/lib/state.mjs";

process.env.CLAUDE_PLUGIN_DATA = makeTempDir();
delete process.env.COPILOT_COMPANION_SESSION_ID;

function workspaceWithJobs(jobs) {
  const workspace = makeTempDir();
  updateState(workspace, (state) => {
    state.jobs = jobs.map((job, index) => ({
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      ...job
    }));
  });
  return workspace;
}

test("job lookup finds a job by exact id and by unique prefix", () => {
  const workspace = workspaceWithJobs([
    { id: "task-abc", status: "completed" },
    { id: "task-abcdef", status: "completed" },
    { id: "review-xyz", status: "completed" }
  ]);

  assert.equal(buildSingleJobSnapshot(workspace, "task-abc").job.id, "task-abc");
  assert.equal(buildSingleJobSnapshot(workspace, "review-x").job.id, "review-xyz");
  assert.equal(resolveResultJob(workspace, "review").job.id, "review-xyz");
});

test("job lookup rejects an ambiguous prefix and an unknown reference", () => {
  const workspace = workspaceWithJobs([
    { id: "task-abc1", status: "completed" },
    { id: "task-abc2", status: "completed" }
  ]);

  assert.throws(() => buildSingleJobSnapshot(workspace, "task-abc"), /Job reference "task-abc" is ambiguous\. Use a longer job id\./);
  assert.throws(() => buildSingleJobSnapshot(workspace, "nope"), /No job found for "nope"\. Run \/copilot:status/);
});

test("result refuses a job that is still running", () => {
  const workspace = workspaceWithJobs([{ id: "task-live", status: "running" }]);

  assert.throws(
    () => resolveResultJob(workspace),
    /Job task-live is still running\. Check \/copilot:status and try again once it finishes\./
  );
});

test("result reports when no job has finished", () => {
  const workspace = workspaceWithJobs([]);

  assert.throws(() => resolveResultJob(workspace), /No finished Copilot jobs found for this repository yet\./);
});

test("cancel picks the only active job and refuses when there are none or several", () => {
  const single = workspaceWithJobs([
    { id: "task-done", status: "completed" },
    { id: "task-live", status: "running" }
  ]);
  const several = workspaceWithJobs([
    { id: "task-one", status: "running" },
    { id: "task-two", status: "queued" }
  ]);
  const none = workspaceWithJobs([{ id: "task-done", status: "completed" }]);

  assert.equal(resolveCancelableJob(single).job.id, "task-live");
  assert.throws(() => resolveCancelableJob(several), /Multiple Copilot jobs are active\. Pass a job id to \/copilot:cancel\./);
  assert.throws(() => resolveCancelableJob(none), /No active Copilot jobs to cancel\./);
  assert.throws(() => resolveCancelableJob(none, "task-done"), /Job task-done is already completed, so there is nothing to cancel\./);
  assert.throws(() => resolveCancelableJob(none, "task-gone"), /No job found for "task-gone"\. Run \/copilot:status/);
});

test("cancel with the exact id of a finished job refuses it instead of a running job with that prefix", () => {
  const workspace = workspaceWithJobs([
    { id: "task-abc", status: "completed" },
    { id: "task-abcdef", status: "running" }
  ]);

  assert.throws(() => resolveCancelableJob(workspace, "task-abc"), /Job task-abc is already completed/);
  assert.equal(resolveCancelableJob(workspace, "task-abcd").job.id, "task-abcdef");
});

test("status reports direct startup and filters jobs by the Claude session", () => {
  const workspace = workspaceWithJobs([
    { id: "task-mine", status: "running", sessionId: "session-a" },
    { id: "task-other", status: "running", sessionId: "session-b" }
  ]);

  const snapshot = buildStatusSnapshot(workspace, { env: { COPILOT_COMPANION_SESSION_ID: "session-a" } });

  assert.equal(snapshot.sessionRuntime.label, "direct startup");
  assert.deepEqual(snapshot.running.map((job) => job.id), ["task-mine"]);
});
