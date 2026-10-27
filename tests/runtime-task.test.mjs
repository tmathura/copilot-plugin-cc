// Changed from upstream codex-plugin-cc (Apache-2.0): split out of tests/runtime.test.mjs;
// the task tests run the Copilot companion against the fake copilot CLI.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import { readFakeChildPids } from "./fake-copilot-fixture.mjs";
import { makeTempDir } from "./helpers.mjs";
import {
  SCRIPT,
  assertReadOnlyRun,
  findJob,
  isAlive,
  makeRepo,
  readJobs,
  runReview,
  setUpGate,
  setUpTasks,
  snapshot,
  waitFor,
  waitForCopilotStart
} from "./runtime-helpers.mjs";

const WRITE_ARGS = ["--allow-tool=write,shell", "--deny-tool=shell(git push)", "--sandbox"];

function sessionIdOf(copilotRun) {
  return copilotRun.args.find((arg) => arg.startsWith("--session-id=")).slice("--session-id=".length);
}

test("a rescue task with a missing or too old Copilot fails with an error that names /copilot:setup", () => {
  // An empty PATH, because a real copilot can sit next to node (nvm, Homebrew).
  const missing = setUpTasks("ok", { env: { PATH: makeTempDir() } });
  const old = setUpTasks("old-version");

  for (const [name, { companion, runs }, expected] of [
    ["missing", missing, /Copilot CLI is not installed .*rerun `\/copilot:setup`\./],
    ["old", old, /Copilot CLI 1\.0\.92 is not supported\. .*rerun `\/copilot:setup`\./]
  ]) {
    for (const mode of [[], ["--background"]]) {
      const result = companion(["task", "--write", ...mode, "fix the bug"]);

      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, expected, name);
    }
    assert.equal(runs().filter((record) => !record.args.includes("--version")).length, 0, name);
  }
});

test("a rescue task without a Copilot login prints Copilot's login steps, at once in the foreground and later in a background result", async () => {
  const { companion, dataDir } = setUpTasks("not-logged-in");
  const result = companion(["task", "--write", "fix the bug"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /No authentication information found\./);
  assert.match(result.stdout, /run the '\/login' command/);
  assert.match(result.stdout, /\nRun `\/copilot:setup` to check the login and see how to log in\./);

  // A background run starts first; its login failure shows later in /copilot:status and /copilot:result.
  const background = companion(["task", "--write", "--background", "--json", "fix the bug"]);
  assert.equal(background.status, 0, background.stderr);
  const { jobId } = JSON.parse(background.stdout);
  await waitFor(() => findJob(dataDir, jobId)?.status === "failed", 30000);
  assert.match(companion(["status", jobId]).stdout, new RegExp(`${jobId} \\| failed`));
  assert.match(companion(["result", jobId]).stdout, /No authentication information found\.[\s\S]*run the '\/login' command[\s\S]*Run `\/copilot:setup`/);
});

test("a failed task's JSON output gives its reason, and a finished one gives none", () => {
  const failed = setUpTasks("fail").companion(["task", "--json", "look at it"]);
  assert.equal(failed.status, 1);
  assert.match(JSON.parse(failed.stdout).failureMessage, /fake copilot: model request failed/);

  const done = setUpTasks("ok").companion(["task", "--json", "look at it"]);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(JSON.parse(done.stdout).failureMessage, null);
});

test("a review and the review gate without a Copilot login name /copilot:setup", () => {
  const { result } = runReview("adversarial-review", makeRepo(), { behavior: "not-logged-in", args: ["--json"] });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).parseError, /No authentication information found[\s\S]*Run `\/copilot:setup`/);
  const native = runReview("review", makeRepo(), { behavior: "not-logged-in" }).result;
  assert.equal(native.status, 1);
  assert.match(native.stdout, /No authentication information found[\s\S]*Run `\/copilot:setup`/);
  const nativeJson = runReview("review", makeRepo(), { behavior: "not-logged-in", args: ["--json"] }).result;
  assert.match(JSON.parse(nativeJson.stdout).copilot.stderr, /No authentication information found[\s\S]*Run `\/copilot:setup`/);

  const { gate } = setUpGate("not-logged-in");
  const blocked = gate({ last_assistant_message: "Edited src/app.js." });
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.match(JSON.parse(blocked.stdout).reason, /^The stop-time Copilot review task failed: [\s\S]*Run `\/copilot:setup`/);
});

test("a read-only task cannot write, and a --write task gets the write profile with the sandbox", () => {
  const readOnly = setUpTasks("write-attempt");
  const readOnlyResult = readOnly.companion(["task", "fix the bug"]);

  assert.equal(readOnlyResult.status, 0, readOnlyResult.stderr);
  assert.equal(readOnlyResult.stdout, "Fake Copilot answer.\n");
  assertReadOnlyRun(readOnly.runs()[0], readOnly.dataDir);
  assert.equal(fs.existsSync(path.join(readOnly.cwd, "fake-write.txt")), false);

  const write = setUpTasks("write-attempt");
  const writeResult = write.companion(["task", "--write", "fix the bug"]);

  assert.equal(writeResult.status, 0, writeResult.stderr);
  const [writeRun] = write.runs();
  for (const arg of WRITE_ARGS) {
    assert.ok(writeRun.args.includes(arg), arg);
  }
  assert.equal(writeRun.env.COPILOT_HOME, undefined);
  assert.ok(fs.existsSync(path.join(write.cwd, "fake-write.txt")));
  assert.equal(readJobs(write.dataDir)[0].write, true);
});

test("--model and --effort become Copilot arguments, and a bad --effort fails before Copilot starts", () => {
  const { companion, runs } = setUpTasks();

  const result = companion(["task", "--model", "gpt-5.4", "--effort", "HIGH", "fix the bug"]);

  assert.equal(result.status, 0, result.stderr);
  const [taskRun] = runs();
  assert.ok(taskRun.args.includes("--model=gpt-5.4"));
  assert.ok(taskRun.args.includes("--reasoning-effort=high"));
  assert.ok(taskRun.args.includes("--name=Copilot Companion Task: fix the bug"));
  assert.equal(taskRun.prompt, "fix the bug");

  const bad = companion(["task", "--effort", "max", "fix the bug"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unsupported reasoning effort "max"\. Use one of: none, minimal, low, medium, high, xhigh\./);
  assert.equal(runs().length, 1);
});

const QUOTED_PROMPT = 'Add the comment line "// Checked by the release run." at the top of math.js. Change no other file.';
const QUOTED_PROMPT_NAME = "--name=Copilot Companion Task: Add the comment line // Checked by the release run. a...";

// With a flag next to it, the prompt is not split again as one raw argument string, which drops quotes.
test("a task whose prompt holds double quotes runs, and only its session name loses them", () => {
  for (const modeArgs of [["--fresh"], ["--write"]]) {
    const { companion, runs } = setUpTasks();

    const result = companion(["task", ...modeArgs, QUOTED_PROMPT]);

    assert.equal(result.status, 0, result.stderr);
    const [taskRun] = runs();
    assert.ok(taskRun.args.includes(QUOTED_PROMPT_NAME), taskRun.args.join(" "));
    assert.equal(taskRun.prompt, QUOTED_PROMPT);
  }
});

// An apostrophe opens a quoted span in the one-string split, so the double quotes reach the name.
test("a one-string task prompt that keeps its double quotes through the split runs", () => {
  const { companion, runs } = setUpTasks();

  const result = companion(["task", 'Don\'t add "x" here']);

  assert.equal(result.status, 0, result.stderr);
  const [taskRun] = runs();
  assert.ok(taskRun.args.includes("--name=Copilot Companion Task: Dont add x here"), taskRun.args.join(" "));
  assert.equal(taskRun.prompt, 'Dont add "x" here');
});

test("a background task whose prompt holds double quotes completes", () => {
  const { companion, runs } = setUpTasks();

  const launch = companion(["task", "--background", "--json", QUOTED_PROMPT]);

  assert.equal(launch.status, 0, launch.stderr);
  const { jobId } = JSON.parse(launch.stdout);
  const waited = JSON.parse(
    companion(["status", jobId, "--wait", "--timeout-ms", "30000", "--poll-interval-ms", "100", "--json"]).stdout
  );
  assert.equal(waited.job.status, "completed");
  const result = companion(["result", jobId]);
  assert.match(result.stdout, /^Fake Copilot answer\.\n/);
  assert.doesNotMatch(result.stdout, /Session name/);
  assert.equal(runs()[0].prompt, QUOTED_PROMPT);
});

test("--resume-last with no earlier task fails with upstream's message", () => {
  const { companion, runs } = setUpTasks();

  const result = companion(["task", "--resume-last"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /No previous Copilot task thread was found for this repository\./);
  assert.match(result.stdout + result.stderr, /use --fresh/);
  assert.deepEqual(runs(), []);
});

test("resume passes --resume with the session of the last task and the profile of the new run", () => {
  for (const modeArgs of [[], ["--write"]]) {
    const { companion, runs, dataDir } = setUpTasks();
    assert.equal(companion(["task", ...modeArgs, "first"]).status, 0);
    const sessionId = sessionIdOf(runs()[0]);

    const resumed = companion(["task", ...modeArgs, "--resume", "next step"]);

    assert.equal(resumed.status, 0, resumed.stderr);
    const second = runs()[1];
    assert.ok(second.args.includes(`--resume=${sessionId}`), second.args.join(" "));
    assert.ok(!second.args.some((arg) => arg.startsWith("--session-id=") || arg.startsWith("--name=")));
    assert.equal(second.prompt, "next step");
    if (modeArgs.length === 0) {
      assertReadOnlyRun(second, dataDir);
    } else {
      assert.ok(second.args.includes("--sandbox"));
    }
  }
});

test("resume does not cross modes in either direction, and the error says to use --fresh", () => {
  for (const [firstArgs, secondArgs] of [
    [[], ["--write"]],
    [["--write"], []]
  ]) {
    const { companion, runs } = setUpTasks();
    assert.equal(companion(["task", ...firstArgs, "first"]).status, 0);

    const resumed = companion(["task", ...secondArgs, "--resume-last", "next step"]);

    assert.equal(resumed.status, 1, secondArgs.join(" "));
    assert.match(resumed.stdout + resumed.stderr, /use --fresh/);
    assert.equal(runs().length, 1);
  }
});

test("task-resume-candidate reports the latest finished task and its write value", () => {
  const { companion } = setUpTasks();
  assert.deepEqual(JSON.parse(companion(["task-resume-candidate", "--json"]).stdout).candidate, null);
  assert.equal(companion(["task", "--write", "first"]).status, 0);

  const payload = JSON.parse(companion(["task-resume-candidate", "--json"]).stdout);

  assert.equal(payload.available, true);
  assert.equal(payload.candidate.write, true);
  assert.equal(payload.candidate.status, "completed");
});

test("a background task is queued, then completes, and status and result show it", () => {
  for (const modeArgs of [[], ["--write"]]) {
    const { companion, dataDir } = setUpTasks();

    const launch = companion(["task", "--background", "--json", ...modeArgs, "fix the bug"]);

    assert.equal(launch.status, 0, launch.stderr);
    const { jobId, status } = JSON.parse(launch.stdout);
    assert.equal(status, "queued");
    const waited = JSON.parse(
      companion(["status", jobId, "--wait", "--timeout-ms", "30000", "--poll-interval-ms", "100", "--json"]).stdout
    );
    assert.equal(waited.waitTimedOut, false);
    assert.equal(waited.job.status, "completed");

    const report = companion(["status"]);
    assert.match(report.stdout, /^# Copilot Status\n/);
    assert.ok(report.stdout.includes(jobId));

    const result = companion(["result", jobId]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Fake Copilot answer\.\n\nCopilot session ID: /);
    const resumeLine = `Resume in Copilot: copilot --resume=${findJob(dataDir, jobId).threadId}`;
    assert.equal(result.stdout.includes(resumeLine), modeArgs.length > 0, result.stdout);
  }
});

test("cancel stops a background task's worker, its Copilot and Copilot's child within 10 seconds", async () => {
  for (const behavior of ["hang", "hang-ignore-sigterm"]) {
    const { companion, dataDir, binDir } = setUpTasks(behavior);
    const launch = companion(["task", "--background", "--json", "--write", "run forever"]);
    assert.equal(launch.status, 0, launch.stderr);
    const { jobId } = JSON.parse(launch.stdout);
    const { pid: workerPid, copilotPid } = await waitForCopilotStart(dataDir, binDir, jobId);
    const [[fakePid, childPid]] = readFakeChildPids(binDir);
    assert.equal(fakePid, copilotPid);

    const started = Date.now();
    const cancel = companion(["cancel", jobId, "--json"]);

    assert.equal(cancel.status, 0, cancel.stderr);
    assert.deepEqual(JSON.parse(cancel.stdout), {
      jobId,
      status: "cancelled",
      title: "Copilot Task",
      turnInterruptAttempted: false,
      turnInterrupted: false
    });
    await waitFor(() => [workerPid, copilotPid, childPid].every((pid) => !isAlive(pid)), 10000);
    assert.ok(Date.now() - started < 10000, behavior);
    assert.equal(findJob(dataDir, jobId).status, "cancelled");
  }
});

test("a forbidden tool fails the task and a grace kill after the result keeps its success, with no Copilot left", async () => {
  for (const [behavior, exitStatus, jobStatus] of [
    ["forbidden-tool", 1, "failed"],
    ["hang-after-result", 0, "completed"]
  ]) {
    const { companion, dataDir, binDir } = setUpTasks(behavior);

    const result = companion(["task", "run it"]);

    assert.equal(result.status, exitStatus, `${behavior}: ${result.stderr}`);
    assert.equal(readJobs(dataDir)[0].status, jobStatus, behavior);
    const pids = readFakeChildPids(binDir).flat();
    assert.equal(pids.length, 2, behavior);
    await waitFor(() => pids.every((pid) => !isAlive(pid)));
  }
});

test("a task that fails after Copilot answered says so, in its output and in its stored result", () => {
  const { companion, dataDir } = setUpTasks("forbidden-tool", { env: { FAKE_COPILOT_ANSWER: "Partial answer." } });

  const task = companion(["task", "look at it"]);

  assert.equal(task.status, 1);
  const failure = /^Partial answer\.\n\nThe Copilot run failed: Copilot started the tool "create", which a read-only run does not allow/;
  assert.match(task.stdout, failure);
  const [job] = readJobs(dataDir);
  assert.equal(job.status, "failed");
  assert.match(companion(["result", job.id]).stdout, failure);
});

test("cancel stops a review whose companion leads no process group, also after that companion was killed", async () => {
  for (const killFirst of [false, true]) {
    const repo = makeRepo();
    const { binDir, dataDir, env, companion } = setUpTasks("hang", { cwd: repo });
    // Like a review that Claude's Bash tool starts: the companion leads no process group.
    const review = spawn(process.execPath, [SCRIPT, "review"], { cwd: repo, env, stdio: "ignore" });
    const exited = new Promise((resolve) => review.on("exit", resolve));
    await waitFor(() => {
      try {
        return readJobs(dataDir)[0]?.copilotPid && readFakeChildPids(binDir).length > 0;
      } catch {
        return false;
      }
    }, 30000);
    const [job] = readJobs(dataDir);
    const [[copilotPid, childPid]] = readFakeChildPids(binDir);
    assert.equal(job.copilotPid, copilotPid);
    if (killFirst) {
      review.kill("SIGKILL");
      await exited;
    }

    const cancel = companion(["cancel", job.id]);

    assert.equal(cancel.status, 0, cancel.stderr);
    await waitFor(() => [review.pid, copilotPid, childPid].every((pid) => !isAlive(pid)), 10000);
    await exited;
  }
});

test("status --wait --timeout-ms returns waitTimedOut for a job that keeps running", async () => {
  const { companion, dataDir, binDir } = setUpTasks("hang");
  const { jobId } = JSON.parse(companion(["task", "--background", "--json", "run forever"]).stdout);
  await waitForCopilotStart(dataDir, binDir, jobId);

  const snapshot = JSON.parse(companion(["status", jobId, "--wait", "--timeout-ms", "300", "--json"]).stdout);

  assert.equal(snapshot.waitTimedOut, true);
  assert.equal(snapshot.timeoutMs, 300);
  assert.equal(snapshot.job.status, "running");
  assert.equal(companion(["cancel", jobId]).status, 0);
});

test("status shows only the jobs of the current Claude session", () => {
  const { companion } = setUpTasks();
  for (const sessionId of ["session-a", "session-b"]) {
    assert.equal(companion(["task", `task for ${sessionId}`], { COPILOT_COMPANION_SESSION_ID: sessionId }).status, 0);
  }

  for (const sessionId of ["session-a", "session-b"]) {
    const report = JSON.parse(companion(["status", "--json"], { COPILOT_COMPANION_SESSION_ID: sessionId }).stdout);
    const jobs = [report.latestFinished, ...report.recent, ...report.running].filter(Boolean);
    assert.deepEqual(jobs.map((job) => job.sessionId), [sessionId]);
  }
  const all = JSON.parse(companion(["status", "--json"]).stdout);
  assert.equal([all.latestFinished, ...all.recent].length, 2);
});

test("no state, job or log file holds the value of GH_TOKEN", () => {
  const marker = "gh-token-marker-6f1d";
  const { companion, dataDir, runs } = setUpTasks("ok", { env: { GH_TOKEN: marker } });

  assert.equal(companion(["task", "--write", "fix it"]).status, 0);
  const { jobId } = JSON.parse(companion(["task", "--background", "--json", "check it"]).stdout);
  const waited = companion(["status", jobId, "--wait", "--timeout-ms", "30000", "--poll-interval-ms", "100", "--json"]);
  assert.equal(JSON.parse(waited.stdout).job.status, "completed");

  assert.equal(runs()[0].env.GH_TOKEN, marker);
  const files = Object.entries(snapshot(dataDir));
  assert.ok(files.some(([name]) => name.endsWith(".log")));
  for (const [name, data] of files) {
    assert.ok(!Buffer.from(data, "base64").includes(marker), name);
  }
});
