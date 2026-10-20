// Changed from upstream codex-plugin-cc (Apache-2.0): split out of tests/runtime.test.mjs;
// the Stop gate tests run the plugin's hooks against the fake copilot CLI.
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import { readFakeChildPids } from "./fake-copilot-fixture.mjs";
import {
  GATE_HOOK,
  GATE_TITLE,
  findJob,
  findPatchDirs,
  isAlive,
  makeLargeRepo,
  makeRepo,
  readJobs,
  setUpGate,
  setUpTasks,
  waitFor,
  withCompanionEnv
} from "./runtime-helpers.mjs";

function findJobByTitle(dataDir, title) {
  try {
    return readJobs(dataDir).find((job) => job.title === title) ?? null;
  } catch {
    return null;
  }
}

test("the whole gate hook, with a short limit, prints the block decision and cleans up before its own timeout", async () => {
  const { repo, env, dataDir, binDir } = setUpGate("hang", { repo: makeLargeRepo() });
  const timeoutMs = 8000;
  const script = `import(${JSON.stringify(pathToFileURL(GATE_HOOK).href)}).then((hook) => hook.main({ timeoutMs: ${timeoutMs} }))`;
  const hook = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: repo, env });
  let stdout = "";
  hook.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  const exited = new Promise((resolve) => hook.on("exit", (code) => resolve(code)));
  // Stands in for Claude Code's own hook timeout, which is 60 s after the run limit.
  const hookTimeout = setTimeout(() => hook.kill("SIGKILL"), timeoutMs + 20000);
  hook.stdin.end(JSON.stringify({ cwd: repo, last_assistant_message: "Edited the text files." }));

  const code = await exited;
  clearTimeout(hookTimeout);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), {
    decision: "block",
    reason:
      "The stop-time Copilot review task timed out after 14 minutes. Run /copilot:review --wait manually or bypass the gate."
  });
  const job = findJobByTitle(dataDir, GATE_TITLE);
  assert.equal(job.status, "cancelled");
  await waitFor(() => readFakeChildPids(binDir).flat().every((pid) => !isAlive(pid)), 5000);
  assert.deepEqual(findPatchDirs(dataDir), []);
});

test("a gate run past its limit blocks, stops the companion, Copilot and its child, and removes the patch folder", async () => {
  for (const behavior of ["hang", "hang-ignore-sigterm"]) {
    const repo = makeLargeRepo();
    const tasks = setUpTasks(behavior, { cwd: repo });
    await withCompanionEnv(tasks.env, async () => {
      const { runStopReview } = await import(pathToFileURL(GATE_HOOK).href);
      const timeoutMs = 8000;
      const started = Date.now();

      const pending = runStopReview(repo, { last_assistant_message: "Edited." }, { timeoutMs });
      let job = null;
      await waitFor(() => {
        job = findJobByTitle(tasks.dataDir, GATE_TITLE);
        return job?.copilotPid && readFakeChildPids(tasks.binDir).length > 0;
      }, timeoutMs);
      const [[copilotPid, childPid]] = readFakeChildPids(tasks.binDir);
      assert.equal(findPatchDirs(tasks.dataDir).length, 1);
      if (behavior === "hang-ignore-sigterm") {
        // A signal in the kill wait, where a Copilot that ignores SIGTERM keeps the companion alive,
        // must not end the cleanup halfway; with no handler left, it would end this test process.
        await waitFor(() => Date.now() - started > timeoutMs + 300, timeoutMs + 5000);
        process.emit("SIGTERM", "SIGTERM");
      }
      const review = await pending;

      assert.deepEqual(review, {
        ok: false,
        reason:
          "The stop-time Copilot review task timed out after 14 minutes. Run /copilot:review --wait manually or bypass the gate."
      });
      // The hook keeps 60 s for this part; the stop and the cleanup need far less.
      assert.ok(Date.now() - started < timeoutMs + 15000, behavior);
      await waitFor(() => [job.pid, copilotPid, childPid].every((pid) => !isAlive(pid)), 5000);
      const stopped = findJob(tasks.dataDir, job.id);
      assert.deepEqual([stopped.status, stopped.pid, stopped.copilotPid], ["cancelled", null, null]);
      assert.equal(stopped.errorMessage, "The stop-time review timed out.");
      assert.deepEqual(findPatchDirs(tasks.dataDir), [], behavior);
    });
  }
});

test("a gate run past its limit still cancels its job and stops Copilot when the companion's own stop fails", async () => {
  const tasks = setUpTasks("hang", { cwd: makeRepo() });
  await withCompanionEnv(tasks.env, async () => {
    const { runStopReview } = await import(pathToFileURL(GATE_HOOK).href);
    const timeoutMs = 8000;

    const pending = runStopReview(tasks.cwd, { last_assistant_message: "Edited." }, {
      timeoutMs,
      terminateImpl: async () => {
        throw new Error("taskkill failed");
      }
    });
    let job = null;
    await waitFor(() => {
      job = findJobByTitle(tasks.dataDir, GATE_TITLE);
      return job?.copilotPid && readFakeChildPids(tasks.binDir).length > 0;
    }, timeoutMs);
    const [[copilotPid, childPid]] = readFakeChildPids(tasks.binDir);
    const review = await pending;

    assert.equal(review.ok, false);
    assert.match(review.reason, /timed out after 14 minutes\. taskkill failed Run \/copilot:review/);
    await waitFor(() => [job.pid, copilotPid, childPid].every((pid) => !isAlive(pid)), 10000);
    const stopped = findJob(tasks.dataDir, job.id);
    assert.deepEqual([stopped.status, stopped.pid, stopped.copilotPid], ["cancelled", null, null]);
  });
});

test("a gate run that it stops cancels its job even when the companion saved the job as failed while it was being stopped", async () => {
  for (const [stopBy, timeoutMs, reason] of [
    ["limit", 8000, "The stop-time review timed out."],
    ["signal", 60000, "The stop-time review was stopped."]
  ]) {
    const tasks = setUpTasks("hang", { cwd: makeRepo() });
    await withCompanionEnv(tasks.env, async () => {
      const { runStopReview } = await import(pathToFileURL(GATE_HOOK).href);
      const { updateState } = await import("../plugins/copilot/scripts/lib/state.mjs");
      const { terminateProcessTree } = await import("../plugins/copilot/scripts/lib/process.mjs");
      // Stands in for taskkill stopping Copilot before the companion: the companion's runner fails and
      // saves the job as failed before the gate's cancel reads it.
      const terminateImpl = async (pid) => {
        await terminateProcessTree(pid);
        updateState(tasks.cwd, (state) => {
          const job = state.jobs.find((entry) => entry.title === GATE_TITLE);
          Object.assign(job, { status: "failed", phase: "failed", pid: null, copilotPid: null, errorMessage: "Copilot exited." });
        });
      };

      const pending = runStopReview(tasks.cwd, { last_assistant_message: "Edited." }, { timeoutMs, terminateImpl });
      let job = null;
      await waitFor(() => {
        job = findJobByTitle(tasks.dataDir, GATE_TITLE);
        return job?.copilotPid && readFakeChildPids(tasks.binDir).length > 0;
      }, Math.min(timeoutMs, 30000));
      const [[copilotPid, childPid]] = readFakeChildPids(tasks.binDir);
      if (stopBy === "signal") {
        process.emit("SIGTERM", "SIGTERM");
      }
      const review = await pending;

      assert.equal(review.ok, false, stopBy);
      await waitFor(() => [job.pid, copilotPid, childPid].every((pid) => !isAlive(pid)), 10000);
      const stopped = findJob(tasks.dataDir, job.id);
      assert.deepEqual([stopped.status, stopped.errorMessage, stopped.pid, stopped.copilotPid], ["cancelled", reason, null, null], stopBy);
      assert.deepEqual(findPatchDirs(tasks.dataDir), [], stopBy);
    });
  }
});

test("a gate whose companion is killed outright cancels its job, stops Copilot and its child, and blocks", async () => {
  const repo = makeLargeRepo();
  const tasks = setUpTasks("hang", { cwd: repo });
  await withCompanionEnv(tasks.env, async () => {
    const { runStopReview } = await import(pathToFileURL(GATE_HOOK).href);

    const pending = runStopReview(repo, { last_assistant_message: "Edited." }, { timeoutMs: 60000 });
    let job = null;
    await waitFor(() => {
      job = findJobByTitle(tasks.dataDir, GATE_TITLE);
      return job?.copilotPid && readFakeChildPids(tasks.binDir).length > 0;
    }, 30000);
    const [[copilotPid, childPid]] = readFakeChildPids(tasks.binDir);
    process.kill(job.pid, "SIGKILL");
    const review = await pending;

    assert.equal(review.ok, false);
    assert.match(review.reason, /^The stop-time Copilot review task failed/);
    await waitFor(() => [job.pid, copilotPid, childPid].every((pid) => !isAlive(pid)), 10000);
    const stopped = findJob(tasks.dataDir, job.id);
    assert.deepEqual([stopped.status, stopped.copilotPid], ["cancelled", null]);
    assert.equal(stopped.errorMessage, "The stop-time review's companion ended before its job did.");
    assert.deepEqual(findPatchDirs(tasks.dataDir), []);
  });
});

test(
  "a gate hook stopped with SIGTERM stops its companion, Copilot and Copilot's child, and removes its patch folder",
  { skip: process.platform === "win32" && "Windows has no SIGTERM that a process can handle" },
  async () => {
    const { repo, env, dataDir, binDir } = setUpGate("hang", { repo: makeLargeRepo() });
    const hook = spawn(process.execPath, [GATE_HOOK], { cwd: repo, env, stdio: ["pipe", "ignore", "ignore"] });
    const exited = new Promise((resolve) => hook.on("exit", (code) => resolve(code)));
    hook.stdin.end(JSON.stringify({ cwd: repo, last_assistant_message: "Edited." }));
    let job = null;
    await waitFor(() => {
      job = findJobByTitle(dataDir, GATE_TITLE);
      return job?.copilotPid && readFakeChildPids(binDir).length > 0;
    }, 30000);
    const [[copilotPid, childPid]] = readFakeChildPids(binDir);
    assert.equal(findPatchDirs(dataDir).length, 1);

    hook.kill("SIGTERM");

    assert.equal(await exited, 143);
    await waitFor(() => [job.pid, copilotPid, childPid].every((pid) => !isAlive(pid)), 5000);
    const stopped = findJob(dataDir, job.id);
    assert.deepEqual([stopped.status, stopped.errorMessage], ["cancelled", "The stop-time review was stopped."]);
    assert.deepEqual(findPatchDirs(dataDir), []);
  }
);
