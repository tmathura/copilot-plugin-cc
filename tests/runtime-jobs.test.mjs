// Changed from upstream codex-plugin-cc (Apache-2.0): split out of tests/runtime.test.mjs;
// the job tests run the Copilot companion against the fake copilot CLI.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import { readFakeChildPids } from "./fake-copilot-fixture.mjs";
import { run } from "./helpers.mjs";
import {
  SCRIPT,
  findJob,
  isAlive,
  makeQueuedTask,
  setUpTasks,
  waitFor,
  waitForCopilotStart,
  withCompanionEnv
} from "./runtime-helpers.mjs";

test("a worker that finishes before its pid is saved leaves the job completed", async () => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async ({ enqueueBackgroundTask }) => {
    const { job, request } = makeQueuedTask(tasks.cwd);

    await enqueueBackgroundTask(tasks.cwd, job, request, {
      spawnWorkerImpl: (cwd, jobId) => {
        const worker = run(process.execPath, [SCRIPT, "task-worker", "--cwd", cwd, "--job-id", jobId], { cwd, env: tasks.env });
        assert.equal(worker.status, 0, worker.stderr);
        return { pid: 424242 };
      }
    });

    const finished = findJob(tasks.dataDir, job.id);
    assert.equal(finished.status, "completed");
    assert.equal(finished.pid, null);
    assert.equal(tasks.runs().length, 1);
  });
});

test("a job cancelled before its worker claims it never runs and stays cancelled", async () => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async ({ enqueueBackgroundTask }) => {
    const { job, request } = makeQueuedTask(tasks.cwd);

    await enqueueBackgroundTask(tasks.cwd, job, request, {
      spawnWorkerImpl: (cwd, jobId) => {
        const cancel = tasks.companion(["cancel", jobId]);
        assert.equal(cancel.status, 0, cancel.stderr);
        const worker = run(process.execPath, [SCRIPT, "task-worker", "--cwd", cwd, "--job-id", jobId], { cwd, env: tasks.env });
        assert.equal(worker.status, 0, worker.stderr);
        return { pid: 424242 };
      }
    });

    assert.equal(findJob(tasks.dataDir, job.id).status, "cancelled");
    assert.equal(findJob(tasks.dataDir, job.id).pid, null);
    assert.deepEqual(tasks.runs(), []);
  });
});

test("a started worker still counts as a launch when its pid cannot be saved, even with no log", async () => {
  for (const breakLog of [false, true]) {
    const tasks = setUpTasks();
    await withCompanionEnv(tasks.env, async ({ enqueueBackgroundTask }) => {
      const { job, request } = makeQueuedTask(tasks.cwd);
      const standIn = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      let lockFile = null;
      try {
        const { payload } = await enqueueBackgroundTask(tasks.cwd, job, request, {
          spawnWorkerImpl: () => {
            // A live process holds the state lock past the save's 5 second wait.
            const workspaceDir = path.join(tasks.dataDir, "state", fs.readdirSync(path.join(tasks.dataDir, "state"))[0]);
            lockFile = path.join(workspaceDir, "state.json.lock");
            fs.writeFileSync(lockFile, JSON.stringify({ pid: standIn.pid, token: "held-by-test" }));
            if (breakLog) {
              const logFile = path.join(workspaceDir, "jobs", `${job.id}.log`);
              fs.rmSync(logFile);
              fs.mkdirSync(logFile);
            }
            return standIn;
          }
        });

        assert.equal(payload.status, "queued");
        if (!breakLog) {
          assert.match(fs.readFileSync(payload.logFile, "utf8"), /Could not save the worker pid: Timed out/);
        }
      } finally {
        if (lockFile) {
          fs.rmSync(lockFile, { force: true });
        }
        standIn.kill("SIGKILL");
      }
      assert.deepEqual([findJob(tasks.dataDir, job.id).status, findJob(tasks.dataDir, job.id).pid], ["queued", null]);
    });
  }
});

test("a worker that cannot start fails the job with the spawn error", async () => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async ({ enqueueBackgroundTask }) => {
    const { job, request } = makeQueuedTask(tasks.cwd);

    await assert.rejects(
      enqueueBackgroundTask(tasks.cwd, job, request, {
        spawnWorkerImpl: () => {
          const child = new EventEmitter();
          process.nextTick(() => child.emit("error", new Error("spawn EACCES")));
          return child;
        }
      }),
      /The background worker could not start: spawn EACCES/
    );

    const failed = findJob(tasks.dataDir, job.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorMessage, "The background worker could not start: spawn EACCES");
  });
});

test("a cancel that leaves a child whose parent exited names it and asks for a retry only when one can help", async () => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async ({ cancelJob }) => {
    const { updateState } = await import("../plugins/copilot/scripts/lib/state.mjs");
    const orphan = (pid = 4321) =>
      Object.assign(new Error(`taskkill /PID 222222 /T /F: exit=128\nStill running: PID ${pid}.`), { orphans: true, stillRunning: [pid] });
    const cases = [
      ["task-orphan-only", { 111111: null, 222222: orphan() }, true, false],
      ["task-orphan-twice", { 111111: orphan(), 222222: orphan() }, true, false],
      ["task-orphan-and-root", { 111111: new Error("taskkill failed"), 222222: orphan() }, true, true],
      ["task-undefined-reason", { 111111: undefined, 222222: orphan() }, true, true],
      // The job's own Copilot pid is left after its companion exits. Its own stop worked, so the cancel
      // succeeds.
      ["task-orphan-is-stopped-copilot", { 111111: orphan(222222), 222222: null }, null, null],
      // Its own stop left only its child, so it is gone too; only that child is named.
      ["task-orphan-is-gone-copilot", { 111111: orphan(222222), 222222: orphan() }, true, false],
      // Its own stop failed with Copilot still alive, so a new cancel can reach it.
      ["task-orphan-is-live-copilot", { 111111: orphan(222222), 222222: new Error("taskkill failed") }, false, true]
    ];
    for (const [jobId, errors, named, retry] of cases) {
      updateState(tasks.cwd, (state) => {
        state.jobs.unshift({ id: jobId, status: "running", jobClass: "task", write: false, pid: 111111, copilotPid: 222222 });
      });
      const terminateImpl = async (pid) => {
        if (errors[pid] !== null) {
          throw errors[pid];
        }
        return { attempted: true, delivered: false, method: "taskkill" };
      };

      if (named === null) {
        assert.equal((await cancelJob(tasks.cwd, jobId, { terminateImpl })).job.status, "cancelled", jobId);
      } else {
        await assert.rejects(cancelJob(tasks.cwd, jobId, { terminateImpl }), (error) => {
          assert.equal(
            /The parent of PID 4321 has exited, so a new cancel cannot reach it\. If Task Manager still shows it as a Copilot or gh process, end it there\./.test(error.message),
            named,
            jobId
          );
          assert.equal(/PID 222222/.test(error.message.replace(/^[^(]*\([^)]*\)/, "")), false, jobId);
          assert.equal(/PID 4321, PID 4321/.test(error.message), false, jobId);
          assert.equal(/\(no error detail;/.test(error.message), errors[111111] === undefined, jobId);
          assert.equal(/Run \/copilot:cancel .* again\.$/.test(error.message), retry, jobId);
          return true;
        });
      }
      // A pid that stopped, or whose own stop shows it has exited, is cleared; any other stays for a retry.
      const job = findJob(tasks.dataDir, jobId);
      for (const [key, pid] of [["pid", 111111], ["copilotPid", 222222]]) {
        assert.equal(job[key], errors[pid] === null || errors[pid]?.orphans ? null : pid, `${jobId} ${key}`);
      }
    }

    const jobId = "task-two-orphans";
    updateState(tasks.cwd, (state) => {
      state.jobs.unshift({ id: jobId, status: "running", jobClass: "task", write: false, pid: 111111, copilotPid: 222222 });
    });
    const two = { 111111: orphan(4321), 222222: orphan(8765) };
    await assert.rejects(
      cancelJob(tasks.cwd, jobId, { terminateImpl: async (pid) => Promise.reject(two[pid]) }),
      /The parents of PID 4321, PID 8765 have exited, so a new cancel cannot reach them\. If Task Manager still shows them as Copilot or gh processes, end them there\.$/
    );
  });
});

test("a cancel whose record cannot be cleared after an orphan-only stop names the child and asks for a retry", async (t) => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async ({ cancelJob }) => {
    const { updateState } = await import("../plugins/copilot/scripts/lib/state.mjs");
    const jobId = "task-orphan-unclearable";
    updateState(tasks.cwd, (state) => {
      state.jobs.unshift({ id: jobId, status: "running", jobClass: "task", write: false, pid: null, copilotPid: 222222 });
    });
    const renameSync = fs.renameSync;
    const terminateImpl = async (pid) => {
      if (pid === 222222) {
        // From here on the state cannot be saved, so the pid cannot be cleared.
        t.mock.method(fs, "renameSync", () => {
          throw Object.assign(new Error("disk error"), { code: "EIO" });
        });
        throw Object.assign(new Error("Still running: PID 4321."), { orphans: true, stillRunning: [4321] });
      }
      return { attempted: false, delivered: false, method: null };
    };

    await assert.rejects(cancelJob(tasks.cwd, jobId, { terminateImpl }), (error) => {
      assert.match(error.message, /The job record could not be updated: disk error/);
      assert.match(error.message, /The parent of PID 4321 has exited/);
      assert.match(error.message, /Run \/copilot:cancel task-orphan-unclearable again\.$/);
      return true;
    });
    t.mock.restoreAll();
    assert.equal(fs.renameSync, renameSync);
    assert.equal(findJob(tasks.dataDir, jobId).copilotPid, 222222);
  });
});

test("a cancel whose signal fails keeps that pid and blocks a resume, and a second cancel stops the process", async () => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async ({ cancelJob }) => {
    const { updateState } = await import("../plugins/copilot/scripts/lib/state.mjs");
    const { resolveCancelableJob } = await import("../plugins/copilot/scripts/lib/job-control.mjs");
    const [worker, copilot] = [0, 1].map(() =>
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    );
    const jobId = "task-cancel-retry";
    updateState(tasks.cwd, (state) => {
      state.jobs.unshift({
        id: jobId,
        status: "running",
        jobClass: "task",
        write: false,
        threadId: "session-of-the-cancelled-task",
        pid: worker.pid,
        copilotPid: copilot.pid
      });
    });
    try {
      const { terminateProcessTree } = await import("../plugins/copilot/scripts/lib/process.mjs");
      // The companion stops; Copilot does not.
      const failing = async (pid) => {
        if (pid === copilot.pid) {
          throw new Error("taskkill failed");
        }
        return terminateProcessTree(pid);
      };
      await assert.rejects(cancelJob(tasks.cwd, jobId, { terminateImpl: failing }), /could not be stopped \(taskkill failed\)\. Run \/copilot:cancel task-cancel-retry again\./);
      await waitFor(() => !isAlive(worker.pid));
      const pending = findJob(tasks.dataDir, jobId);
      assert.deepEqual([pending.status, pending.pid, pending.copilotPid], ["cancelled", null, copilot.pid]);
      assert.equal(resolveCancelableJob(tasks.cwd, jobId).job.id, jobId);
      const blocked = tasks.companion(["task", "--resume-last", "next step"]);
      assert.equal(blocked.status, 1);
      assert.match(blocked.stderr, /Task task-cancel-retry is still running/);
      assert.equal(JSON.parse(tasks.companion(["task-resume-candidate", "--json"]).stdout).available, false);

      await cancelJob(tasks.cwd, jobId);

      await waitFor(() => !isAlive(worker.pid) && !isAlive(copilot.pid));
      const done = findJob(tasks.dataDir, jobId);
      assert.deepEqual([done.status, done.pid, done.copilotPid], ["cancelled", null, null]);
      assert.throws(() => resolveCancelableJob(tasks.cwd, jobId), /already cancelled/);
      assert.equal(JSON.parse(tasks.companion(["task-resume-candidate", "--json"]).stdout).candidate.id, jobId);
      assert.deepEqual(tasks.runs(), []);
    } finally {
      worker.kill("SIGKILL");
      copilot.kill("SIGKILL");
    }
  });
});

test("a run whose Copilot cannot be stopped keeps the Copilot pid, so a cancel can still stop it", async () => {
  const tasks = setUpTasks("hang-after-result");
  await withCompanionEnv(tasks.env, async ({ cancelJob }) => {
    const { guardCopilotStart, runTrackedJob } = await import("../plugins/copilot/scripts/lib/tracked-jobs.mjs");
    const { runPromptModeTurn } = await import("../plugins/copilot/scripts/lib/copilot.mjs");
    const { resolveCancelableJob } = await import("../plugins/copilot/scripts/lib/job-control.mjs");
    const job = { id: "task-stuck-copilot", jobClass: "task", workspaceRoot: tasks.cwd };

    await assert.rejects(
      runTrackedJob(job, () =>
        runPromptModeTurn(tasks.cwd, {
          prompt: "x",
          resultGraceMs: 100,
          guardStart: guardCopilotStart(tasks.cwd, job.id),
          terminateImpl: async () => {
            throw new Error("taskkill failed");
          }
        })
      ),
      /Copilot \(process \d+\) could not be stopped: taskkill failed/
    );
    const failed = findJob(tasks.dataDir, job.id);
    const [[copilotPid, childPid]] = readFakeChildPids(tasks.binDir);
    assert.deepEqual([failed.status, failed.pid, failed.copilotPid], ["failed", null, copilotPid]);
    assert.ok(isAlive(copilotPid));
    assert.equal(resolveCancelableJob(tasks.cwd, job.id).job.id, job.id);

    await cancelJob(tasks.cwd, job.id);

    await waitFor(() => !isAlive(copilotPid) && !isAlive(childPid));
    const stopped = findJob(tasks.dataDir, job.id);
    assert.deepEqual([stopped.status, stopped.copilotPid], ["failed", null]);
  });
});

test("a worker that stops before it runs its job marks the job failed", () => {
  const tasks = setUpTasks();
  const jobId = "task-no-request";
  const stateDir = path.join(tasks.dataDir, "state");
  // A real job gives the folder its name, so the broken one goes in the same workspace.
  assert.equal(tasks.companion(["task", "first"]).status, 0);
  const [workspace] = fs.readdirSync(stateDir);
  const stateFile = path.join(stateDir, workspace, "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.jobs.unshift({ id: jobId, status: "queued", jobClass: "task", updatedAt: new Date().toISOString() });
  fs.writeFileSync(stateFile, JSON.stringify(state));
  fs.writeFileSync(path.join(stateDir, workspace, "jobs", `${jobId}.json`), JSON.stringify({ id: jobId }));

  const worker = tasks.companion(["task-worker", "--job-id", jobId]);

  assert.equal(worker.status, 1);
  const failed = findJob(tasks.dataDir, jobId);
  assert.equal(failed.status, "failed");
  assert.match(failed.errorMessage, /The background worker stopped: Stored job task-no-request is missing its task request payload\./);
});

test("a cancel that picked a queued job still stops the Copilot that its worker started since", async () => {
  const tasks = setUpTasks("hang");
  await withCompanionEnv(tasks.env, async ({ enqueueBackgroundTask, cancelJob }) => {
    const { resolveCancelableJob } = await import("../plugins/copilot/scripts/lib/job-control.mjs");
    const { job, request } = makeQueuedTask(tasks.cwd);
    // A stand-in that never claims the job, so the cancel below picks it while it is queued.
    const standIn = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      await enqueueBackgroundTask(tasks.cwd, job, request, { spawnWorkerImpl: () => standIn });
      const { workspaceRoot, job: picked } = resolveCancelableJob(tasks.cwd, job.id);
      assert.equal(picked.status, "queued");
      assert.equal(picked.pid, standIn.pid);

      const worker = spawn(process.execPath, [SCRIPT, "task-worker", "--cwd", tasks.cwd, "--job-id", job.id], {
        cwd: tasks.cwd,
        env: tasks.env,
        detached: true,
        stdio: "ignore"
      });
      const { copilotPid } = await waitForCopilotStart(tasks.dataDir, tasks.binDir, job.id);
      const [[, childPid]] = readFakeChildPids(tasks.binDir);

      await cancelJob(workspaceRoot, picked.id);

      await waitFor(() => [worker.pid, copilotPid, childPid].every((pid) => !isAlive(pid)), 10000);
      assert.equal(findJob(tasks.dataDir, job.id).status, "cancelled");
    } finally {
      standIn.kill("SIGKILL");
    }
  });
});

test("overrideFailed cancels a failed job and stops the Copilot it kept; a finished job is refused without it, and a completed one always", async () => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async ({ cancelJob }) => {
    const { updateState } = await import("../plugins/copilot/scripts/lib/state.mjs");
    const stopped = [];
    const terminateImpl = async (pid) => {
      if (pid) {
        stopped.push(pid);
      }
      return { attempted: false, delivered: false, method: null };
    };
    updateState(tasks.cwd, (state) => {
      state.jobs.unshift(
        { id: "task-failed-kept", status: "failed", jobClass: "task", write: false, pid: null, copilotPid: 333333, errorMessage: "Copilot exited." },
        { id: "task-failed-done", status: "failed", jobClass: "task", write: false, pid: null, copilotPid: null, errorMessage: "Copilot exited." },
        { id: "task-completed", status: "completed", jobClass: "task", write: false, pid: null, copilotPid: null }
      );
    });

    await assert.rejects(cancelJob(tasks.cwd, "task-failed-done", { terminateImpl }), /Job task-failed-done is already failed, so there is nothing to cancel\./);
    await assert.rejects(cancelJob(tasks.cwd, "task-completed", { terminateImpl, overrideFailed: true }), /Job task-completed is already completed/);
    await cancelJob(tasks.cwd, "task-failed-kept", { terminateImpl, reason: "The stop-time review timed out.", overrideFailed: true });

    const job = findJob(tasks.dataDir, "task-failed-kept");
    assert.deepEqual([job.status, job.errorMessage, job.copilotPid], ["cancelled", "The stop-time review timed out.", null]);
    assert.deepEqual(stopped, [333333]);
  });
});
