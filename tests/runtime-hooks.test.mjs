// Changed from upstream codex-plugin-cc (Apache-2.0): split out of tests/runtime.test.mjs;
// the Stop gate and session hook tests run the plugin's hooks against the fake copilot CLI.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import { readFakeChildPids } from "./fake-copilot-fixture.mjs";
import { makeTempDir, run } from "./helpers.mjs";
import {
  GATE_HOOK,
  GATE_TITLE,
  PLUGIN_ROOT,
  addDirsOf,
  assertReadOnlyRun,
  findJob,
  findPatchDirs,
  isAlive,
  makeLargeRepo,
  makeQueuedTask,
  patchListEntry,
  patchesOf,
  readJobs,
  setUpGate,
  setUpTasks,
  waitFor,
  waitForCopilotStart,
  withCompanionEnv
} from "./runtime-helpers.mjs";

const SESSION_HOOK = path.join(PLUGIN_ROOT, "scripts", "session-lifecycle-hook.mjs");
test("the review gate is off by default and runs nothing", () => {
  const { gate, runs } = setUpGate("ok", { enable: false });

  const result = gate({ last_assistant_message: "Edited src/app.js." });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.deepEqual(runs(), []);
});

test("the gate reads its setting from Claude's CLAUDE_PLUGIN_DATA, not from an inherited companion export", () => {
  const { gate, runs } = setUpGate("ok", { env: { FAKE_COPILOT_ANSWER: "ALLOW: nothing to fix" } });
  const before = runs().length;

  const result = gate({ last_assistant_message: "Edited src/app.js." }, { COPILOT_COMPANION_PLUGIN_DATA: makeTempDir() });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(runs().length, before + 1);
});

test("the gate lets Claude stop on ALLOW, with a 100 KB message on stdin, the diff in the prompt and the read-only profile", () => {
  const { gate, gateRun, dataDir, companion } = setUpGate("ok", { env: { FAKE_COPILOT_ANSWER: "ALLOW: nothing to fix" } });
  // Far past the Windows command-line limit of about 32 KB.
  const message = `Edited src/app.js. ${"x".repeat(100 * 1024)} END_OF_MESSAGE`;

  const result = gate({ last_assistant_message: message });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const copilotRun = gateRun();
  assertReadOnlyRun(copilotRun, dataDir);
  assert.ok(copilotRun.prompt.includes(`Previous Claude response:\n${message}\n`));
  assert.match(copilotRun.prompt, /<repository_context>\nUse the repository context below as primary evidence\./);
  assert.match(copilotRun.prompt, /\+export const value = items\[0\]\.id;/);
  assert.deepEqual(addDirsOf(copilotRun), []);
  assert.equal(readJobs(dataDir).find((job) => job.title === GATE_TITLE).status, "completed");
  // The gate's session reviews Claude's turn; a rescue must not continue it.
  assert.equal(JSON.parse(companion(["task-resume-candidate", "--json"]).stdout).candidate, null);
});

test("the gate blocks on BLOCK, and on an answer that is neither ALLOW nor BLOCK", () => {
  for (const [answer, reason] of [
    [
      "BLOCK: the empty-list guard is missing\nMore detail.",
      "Copilot stop-time review found issues that still need fixes before ending the session: the empty-list guard is missing"
    ],
    [
      "Looks fine to me.",
      "The stop-time Copilot review task returned an unexpected answer. Run /copilot:review --wait manually or bypass the gate."
    ]
  ]) {
    const { gate } = setUpGate("ok", { env: { FAKE_COPILOT_ANSWER: answer } });

    const result = gate({ last_assistant_message: "Edited src/app.js." });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { decision: "block", reason });
  }
});

test("the gate blocks when git fails in a repository, also when git is missing", () => {
  const sep = process.platform === "win32" ? ";" : ":";
  for (const [label, breakRepo, detail] of [
    ["unreadable index", (repo) => fs.writeFileSync(path.join(repo, ".git", "index"), "not an index"), /failed: /],
    [
      "broken .git link",
      (repo) => {
        fs.rmSync(path.join(repo, ".git"), { recursive: true, force: true });
        fs.writeFileSync(path.join(repo, ".git"), "gitdir: missing-folder\n");
      },
      /must run inside a Git repository/
    ],
    ["git missing", () => {}, /git is not installed/]
  ]) {
    const { gate, repo, runs, binDir } = setUpGate("ok");
    const before = runs().length;
    breakRepo(repo);
    // Only the fake Copilot and Node stay on the path, so git cannot be found.
    const env = label === "git missing" ? { PATH: `${binDir}${sep}${path.dirname(process.execPath)}` } : {};

    const result = gate({ last_assistant_message: "Edited src/app.js." }, env);

    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    const { decision, reason } = JSON.parse(result.stdout);
    assert.equal(decision, "block", label);
    assert.match(reason, /^The stop-time Copilot review task failed: /, label);
    assert.match(reason, detail, label);
    assert.equal(runs().length, before, label);
  }
});

test("with git broken, the gate in a subfolder still finds its setting and blocks, and SessionEnd still closes the session", () => {
  const { gate, repo, runs, env, dataDir } = setUpGate("ok");
  const before = runs().length;
  fs.rmSync(path.join(repo, ".git"), { recursive: true, force: true });
  fs.writeFileSync(path.join(repo, ".git"), "gitdir: missing-folder\n");
  const subfolder = path.join(repo, "src");

  const result = gate({ cwd: subfolder, last_assistant_message: "Edited src/app.js." });

  assert.equal(result.status, 0, result.stderr);
  const { decision, reason } = JSON.parse(result.stdout);
  assert.equal(decision, "block");
  assert.match(reason, /^The stop-time Copilot review task failed: /);
  assert.equal(runs().length, before);

  const end = run(process.execPath, [SESSION_HOOK, "SessionEnd"], {
    cwd: subfolder,
    env,
    input: JSON.stringify({ session_id: "broken-git-session", cwd: subfolder })
  });
  assert.equal(end.status, 0, end.stderr);
  // One workspace folder: the one that setup made for the repository root.
  assert.equal(fs.readdirSync(path.join(dataDir, "state")).length, 1);
  assert.deepEqual(readClosedSessions(dataDir).map((entry) => entry.id), ["broken-git-session"]);
});

test("a .git link whose target is gone still marks the repository root", async () => {
  const { findGitMarkerRoot } = await import("../plugins/copilot/scripts/lib/workspace.mjs");
  const root = fs.realpathSync.native(makeTempDir());
  fs.mkdirSync(path.join(root, "sub"));
  // A junction needs no extra rights on Windows.
  fs.symlinkSync(path.join(root, "gone"), path.join(root, ".git"), process.platform === "win32" ? "junction" : "dir");

  assert.equal(findGitMarkerRoot(path.join(root, "sub")), root);
});

test("outside Git, the gate runs with a note that there is no diff, and still removes stale folders", () => {
  const { gate, gateRun, dataDir } = setUpGate("ok", {
    repo: makeTempDir(),
    env: { FAKE_COPILOT_ANSWER: "ALLOW: nothing to fix" }
  });
  const jobsDir = path.join(dataDir, "state", fs.readdirSync(path.join(dataDir, "state"))[0], "jobs");
  const ended = path.join(jobsDir, `stop-gate-${run(process.execPath, ["-e", ""]).pid}-old1.patches`);
  fs.mkdirSync(ended);

  const result = gate({ last_assistant_message: "Edited notes.txt." });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(gateRun().prompt, /<repository_context>\nThe working folder is not a Git repository, so there is no diff\.\n/);
  assert.equal(fs.existsSync(ended), false);
});

test("the gate reviews a repository that Claude opened through a link", () => {
  const { gate, gateRun, repo } = setUpGate("ok", { env: { FAKE_COPILOT_ANSWER: "ALLOW: nothing to fix" } });
  fs.mkdirSync(path.join(repo, "src", "deep"));
  const link = path.join(makeTempDir(), "linked-src");
  // A junction needs no extra rights on Windows.
  fs.symlinkSync(path.join(repo, "src"), link, process.platform === "win32" ? "junction" : "dir");

  const result = gate({ cwd: link, last_assistant_message: "Edited src/app.js." });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(gateRun().prompt, /not a Git repository/);
  assert.match(gateRun().prompt, /\+export const value = items\[0\]\.id;/);
});

test("the gate says why it did not run when the job state cannot be read", () => {
  const { gate, dataDir, runs } = setUpGate("ok");
  const before = runs().length;
  const stateFile = path.join(dataDir, "state", fs.readdirSync(path.join(dataDir, "state"))[0], "state.json");
  fs.writeFileSync(stateFile, "{ not json");

  const result = gate({ last_assistant_message: "Edited src/app.js." });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^The review gate did not run\. Cannot read the job state /m);
  assert.equal(runs().length, before);
});

test("a running gate job does not block --resume-last", () => {
  const { companion, dataDir } = setUpTasks();
  assert.equal(companion(["task", "first"]).status, 0);
  const stateFile = path.join(dataDir, "state", fs.readdirSync(path.join(dataDir, "state"))[0], "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.jobs.unshift({
    id: "task-gate",
    status: "running",
    jobClass: "task",
    title: GATE_TITLE,
    stopGateRunId: "gate-run",
    threadId: "gate-session",
    updatedAt: new Date().toISOString()
  });
  fs.writeFileSync(stateFile, JSON.stringify(state));

  const resumed = companion(["task", "--resume-last", "next step"]);

  assert.equal(resumed.status, 0, resumed.stderr);
});

test("a user task that quotes the gate's marker sentence can still be resumed", () => {
  const { companion } = setUpTasks();
  const prompt = "Explain this line: Run a stop-gate review of the previous Claude turn.";
  assert.equal(companion(["task", prompt]).status, 0);

  const payload = JSON.parse(companion(["task-resume-candidate", "--json"]).stdout);

  assert.equal(payload.available, true);
  assert.equal(payload.candidate.title, GATE_TITLE);
});

test("the gate with no Copilot gives a setup note and lets Claude stop", () => {
  const { gate, runs } = setUpGate("ok");
  const before = runs().length;

  const result = gate({ last_assistant_message: "Edited src/app.js." }, { PATH: path.dirname(process.execPath) });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^Copilot is not set up for the review gate\. not found\. Run \/copilot:setup\.$/m);
  assert.equal(runs().length, before);
});

test("above the inline limit, the gate passes the patch folder to Copilot and removes it after success and failure", () => {
  for (const [behavior, blocked] of [
    ["ok", false],
    ["fail", true]
  ]) {
    const { gate, gateRun, dataDir } = setUpGate(behavior, {
      repo: makeLargeRepo(),
      env: { FAKE_COPILOT_ANSWER: "ALLOW: nothing to fix" }
    });
    // Left by gate hooks that were killed outright: one has ended, one still runs.
    const jobsDir = path.join(dataDir, "state", fs.readdirSync(path.join(dataDir, "state"))[0], "jobs");
    const endedPid = run(process.execPath, ["-e", ""]).pid;
    const ended = path.join(jobsDir, `stop-gate-${endedPid}-old1.patches`);
    const live = path.join(jobsDir, `stop-gate-${process.pid}-live1.patches`);
    fs.mkdirSync(ended);
    fs.mkdirSync(live);

    const result = gate({ last_assistant_message: "Edited the text files." });

    assert.equal(fs.existsSync(ended), false);
    assert.equal(fs.existsSync(live), true);
    fs.rmSync(live, { recursive: true });

    assert.equal(result.status, 0, result.stderr);
    if (blocked) {
      assert.match(JSON.parse(result.stdout).reason, /^The stop-time Copilot review task failed: /);
    } else {
      assert.equal(result.stdout, "");
    }
    const copilotRun = gateRun();
    const [patchDir] = addDirsOf(copilotRun);
    assert.ok(patchDir.startsWith(path.join(dataDir, "state")), patchDir);
    // One patch per changed file, and none for the empty staged diff.
    const patches = patchesOf(copilotRun);
    assert.deepEqual(Object.keys(patches).sort(), ["unstaged-001.patch", "unstaged-002.patch", "unstaged-003.patch", "untracked.md"]);
    assert.match(patches["unstaged-003.patch"].toString("utf8"), /^diff --git a\/c\.txt b\/c\.txt\n[\s\S]*\+c\.txt v2\n/);
    const entry = (name, label) => patchListEntry(patchDir, patches, name, label);
    assert.ok(
      copilotRun.prompt.includes(
        [
          "## Patch Files",
          "",
          entry("unstaged-001.patch", "diff --git a/a.txt b/a.txt"),
          entry("unstaged-002.patch", "diff --git a/b.txt b/b.txt"),
          entry("unstaged-003.patch", "diff --git a/c.txt b/c.txt"),
          entry("untracked.md", "untracked files"),
          ""
        ].join("\n")
      ),
      copilotRun.prompt
    );
    assert.match(copilotRun.prompt, /Read every file listed below with the view tool/);
    assert.match(copilotRun.prompt, /read each file to its last line, in line ranges where needed/);
    assert.deepEqual(findPatchDirs(dataDir), [], behavior);
    // A run that ended by itself keeps its outcome; only the gate's own stop turns a failure into a cancel.
    assert.equal(readJobs(dataDir).find((job) => job.title === GATE_TITLE).status, blocked ? "failed" : "completed", behavior);
  }
});

test("SessionStart writes the session id and the plugin data folder to CLAUDE_ENV_FILE under the companion's own name", () => {
  const envFile = path.join(makeTempDir(), "claude-env");

  const result = run(process.execPath, [SESSION_HOOK, "SessionStart"], {
    env: { ...process.env, CLAUDE_ENV_FILE: envFile, CLAUDE_PLUGIN_DATA: "/data dir" },
    input: JSON.stringify({ session_id: "it's-1" })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.readFileSync(envFile, "utf8"),
    "export COPILOT_COMPANION_SESSION_ID='it'\"'\"'s-1'\nexport COPILOT_COMPANION_PLUGIN_DATA='/data dir'\n"
  );
});

test("SessionEnd uses Claude's CLAUDE_PLUGIN_DATA, not an inherited companion export", () => {
  const dataDir = makeTempDir();
  const inherited = makeTempDir();
  const cwd = makeTempDir();

  const result = run(process.execPath, [SESSION_HOOK, "SessionEnd"], {
    cwd,
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir, COPILOT_COMPANION_PLUGIN_DATA: inherited },
    input: JSON.stringify({ session_id: "ended-session", cwd })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readClosedSessions(dataDir).map((entry) => entry.id), ["ended-session"]);
  assert.equal(fs.existsSync(path.join(inherited, "state")), false);
});

test("without CLAUDE_PLUGIN_DATA the hooks use and export the fallback folder, not an inherited companion export", () => {
  const home = makeTempDir();
  const inherited = makeTempDir();
  const cwd = makeTempDir();
  const envFile = path.join(makeTempDir(), "claude-env");
  const env = {
    ...process.env,
    CLAUDE_ENV_FILE: envFile,
    CLAUDE_PLUGIN_DATA: "",
    COPILOT_COMPANION_PLUGIN_DATA: inherited,
    HOME: home,
    USERPROFILE: home
  };
  const fallback = path.join(home, ".copilot-companion");

  const start = run(process.execPath, [SESSION_HOOK, "SessionStart"], { cwd, env, input: JSON.stringify({ session_id: "s-1" }) });
  const end = run(process.execPath, [SESSION_HOOK, "SessionEnd"], { cwd, env, input: JSON.stringify({ session_id: "s-1", cwd }) });

  assert.equal(start.status, 0, start.stderr);
  assert.equal(end.status, 0, end.stderr);
  assert.ok(fs.readFileSync(envFile, "utf8").includes(`export COPILOT_COMPANION_PLUGIN_DATA='${fallback}'\n`));
  assert.deepEqual(readClosedSessions(fallback).map((entry) => entry.id), ["s-1"]);
  assert.equal(fs.existsSync(path.join(inherited, "state")), false);
});

function readClosedSessions(dataDir) {
  try {
    const stateRoot = path.join(dataDir, "state");
    const [workspaceDir] = fs.readdirSync(stateRoot);
    return JSON.parse(fs.readFileSync(path.join(stateRoot, workspaceDir, "state.json"), "utf8")).closedSessions;
  } catch {
    return [];
  }
}

test("SessionEnd stops three running jobs within 5 s, also a Copilot whose companion is dead, and removes only those jobs", async () => {
  const tasks = setUpTasks("hang-ignore-sigterm");
  const ending = { COPILOT_COMPANION_SESSION_ID: "ending-session" };
  const jobs = [];
  for (let index = 0; index < 3; index += 1) {
    const launch = tasks.companion(["task", "--background", "--json", `run forever ${index}`], ending);
    assert.equal(launch.status, 0, launch.stderr);
    const job = await waitForCopilotStart(tasks.dataDir, tasks.binDir, JSON.parse(launch.stdout).jobId);
    await waitFor(() => readFakeChildPids(tasks.binDir).some(([copilotPid]) => copilotPid === job.copilotPid));
    jobs.push(job);
  }
  const pids = jobs.flatMap((job) => [job.pid, job.copilotPid]);
  pids.push(...readFakeChildPids(tasks.binDir).map(([, childPid]) => childPid));
  // The first job's companion is gone, so only its record still names its Copilot.
  process.kill(jobs[0].pid, "SIGKILL");
  await waitFor(() => !isAlive(jobs[0].pid));

  const started = Date.now();
  const hook = spawn(process.execPath, [SESSION_HOOK, "SessionEnd"], {
    cwd: tasks.cwd,
    env: tasks.env,
    stdio: ["pipe", "ignore", "pipe"]
  });
  const exited = new Promise((resolve) => hook.on("exit", (code) => resolve(code)));
  let stderr = "";
  hook.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  hook.stdin.end(JSON.stringify({ session_id: "ending-session", cwd: tasks.cwd }));
  await waitFor(() => readClosedSessions(tasks.dataDir).some((entry) => entry.id === "ending-session"));
  // Started after the close: the resumed session's new job and another session's job stay.
  const resumed = tasks.companion(["task", "--background", "--json", "after resume"], ending);
  assert.equal(resumed.status, 0, resumed.stderr);
  const resumedId = JSON.parse(resumed.stdout).jobId;
  const other = tasks.companion(["task", "other session"], {
    COPILOT_COMPANION_SESSION_ID: "other-session",
    FAKE_COPILOT_BEHAVIOR: "ok"
  });
  assert.equal(other.status, 0, other.stderr);
  const code = await exited;

  assert.equal(code, 0, stderr);
  assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
  await waitFor(() => pids.every((pid) => !isAlive(pid)), 2000);
  const remaining = readJobs(tasks.dataDir);
  for (const job of jobs) {
    assert.equal(remaining.find((entry) => entry.id === job.id), undefined);
    assert.equal(fs.existsSync(job.logFile), false);
  }
  const otherJob = remaining.find((entry) => entry.sessionId === "other-session");
  assert.equal(otherJob.status, "completed");
  assert.ok(fs.existsSync(otherJob.logFile));
  const resumedJob = await waitForCopilotStart(tasks.dataDir, tasks.binDir, resumedId);
  assert.ok(fs.existsSync(resumedJob.logFile));
  const cancel = tasks.companion(["cancel", resumedId], ending);
  assert.equal(cancel.status, 0, cancel.stderr);
  assert.equal(findJob(tasks.dataDir, resumedId).status, "cancelled");
});

test("SessionEnd keeps a job whose stop fails, and an older job whose stop never finished, with their pids", async () => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async () => {
    const { cleanupSessionJobs } = await import(pathToFileURL(SESSION_HOOK).href);
    const { updateState } = await import("../plugins/copilot/scripts/lib/state.mjs");
    const { terminateProcessTree } = await import("../plugins/copilot/scripts/lib/process.mjs");
    const [worker, copilot, oldCopilot] = [0, 1, 2].map(() =>
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    );
    const sessionId = "failing-stop-session";
    try {
      updateState(tasks.cwd, (state) => {
        state.jobs.unshift(
          { id: "task-running", status: "running", jobClass: "task", sessionId, pid: worker.pid, copilotPid: copilot.pid },
          { id: "task-old-failed", status: "failed", jobClass: "task", sessionId, pid: null, copilotPid: oldCopilot.pid },
          { id: "task-done", status: "completed", jobClass: "task", sessionId }
        );
      });

      await cleanupSessionJobs(tasks.cwd, sessionId, {
        terminateImpl: async (pid, options) => {
          if (pid === copilot.pid) {
            throw new Error("taskkill failed");
          }
          return terminateProcessTree(pid, options);
        }
      });

      await waitFor(() => !isAlive(worker.pid));
      const jobs = readJobs(tasks.dataDir);
      assert.deepEqual(jobs.map((job) => job.id).sort(), ["task-old-failed", "task-running"]);
      const kept = jobs.find((job) => job.id === "task-running");
      // The stopped companion's pid is cleared, so a later cancel never signals it after reuse.
      assert.deepEqual([kept.status, kept.pid, kept.copilotPid], ["cancelled", null, copilot.pid]);
      // The job file agrees with the state.
      const { readStoredJob } = await import("../plugins/copilot/scripts/lib/job-control.mjs");
      const stored = readStoredJob(tasks.cwd, "task-running");
      assert.deepEqual([stored.status, stored.pid, stored.copilotPid], ["cancelled", null, copilot.pid]);
      // An old pid may belong to another program by now, so only a cancel stops it.
      assert.equal(jobs.find((job) => job.id === "task-old-failed").copilotPid, oldCopilot.pid);
      assert.ok(isAlive(oldCopilot.pid));
    } finally {
      for (const child of [worker, copilot, oldCopilot]) {
        child.kill("SIGKILL");
      }
    }
  });
});

test("SessionEnd ends inside its budget when taskkill never ends, and keeps the job with its pids", async () => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async () => {
    const { cleanupSessionJobs } = await import(pathToFileURL(SESSION_HOOK).href);
    const { updateState } = await import("../plugins/copilot/scripts/lib/state.mjs");
    const { runCommandAsync, terminateProcessTree } = await import("../plugins/copilot/scripts/lib/process.mjs");
    const sessionId = "stalled-taskkill-session";
    updateState(tasks.cwd, (state) => {
      state.jobs.unshift({ id: "task-stalled", status: "running", jobClass: "task", sessionId, pid: 111111, copilotPid: 222222 });
    });
    // The real runner, with its time limit, on a command that never ends in place of taskkill.
    const stalledTaskkill = (command, args, options) =>
      runCommandAsync(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);

    const started = Date.now();
    await cleanupSessionJobs(tasks.cwd, sessionId, {
      terminateImpl: (pid, options) =>
        terminateProcessTree(pid, {
          ...options,
          platform: "win32",
          runCommandImpl: stalledTaskkill,
          // Both processes are still alive after the stalled stop.
          killImpl: () => true
        })
    });
    const elapsed = Date.now() - started;

    // The budget is 3500 ms; the stops end about 2000 ms after they start.
    assert.ok(elapsed < 3500, `${elapsed} ms`);
    const job = findJob(tasks.dataDir, "task-stalled");
    assert.deepEqual([job.status, job.pid, job.copilotPid], ["cancelled", 111111, 222222]);
  });
});

test("SessionEnd clears a pid whose stop shows it has exited, keeps one that can still be stopped, and names a child it left", async () => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async () => {
    const { cleanupSessionJobs } = await import(pathToFileURL(SESSION_HOOK).href);
    const { updateState } = await import("../plugins/copilot/scripts/lib/state.mjs");
    const sessionId = "orphan-stop-session";
    updateState(tasks.cwd, (state) => {
      state.jobs.unshift(
        { id: "task-orphan-only", status: "running", jobClass: "task", sessionId, pid: 111111, copilotPid: 222222 },
        { id: "task-orphan-and-live", status: "running", jobClass: "task", sessionId, pid: 333333, copilotPid: 444444 },
        { id: "task-two-orphans", status: "running", jobClass: "task", sessionId, pid: 555555, copilotPid: 666666 }
      );
    });
    const orphan = Object.assign(new Error("Still running: PID 4321."), { orphans: true, stillRunning: [4321] });
    const other = Object.assign(new Error("Still running: PID 8765."), { orphans: true, stillRunning: [8765] });

    await cleanupSessionJobs(tasks.cwd, sessionId, {
      terminateImpl: async (pid) => {
        if (pid === 222222 || pid === 333333 || pid === 555555) {
          throw orphan;
        }
        if (pid === 666666) {
          throw other;
        }
        if (pid === 444444) {
          throw new Error("taskkill failed");
        }
        return { attempted: true, delivered: true, method: "taskkill" };
      }
    });

    const jobs = Object.fromEntries(readJobs(tasks.dataDir).map((job) => [job.id, job]));
    assert.deepEqual(Object.keys(jobs).sort(), ["task-orphan-and-live", "task-orphan-only", "task-two-orphans"]);
    assert.deepEqual([jobs["task-orphan-only"].pid, jobs["task-orphan-only"].copilotPid], [null, null]);
    assert.deepEqual([jobs["task-orphan-and-live"].pid, jobs["task-orphan-and-live"].copilotPid], [null, 444444]);
    assert.deepEqual([jobs["task-two-orphans"].pid, jobs["task-two-orphans"].copilotPid], [null, null]);
    assert.match(
      jobs["task-two-orphans"].errorMessage,
      /^The Claude session ended\. PID 4321, PID 8765 kept running after their parents exited, so a cancel cannot reach them\. If Task Manager still shows them as Copilot or gh processes, end them there\.$/
    );
    for (const job of [jobs["task-orphan-only"], jobs["task-orphan-and-live"]]) {
      assert.match(
        job.errorMessage,
        /^The Claude session ended\. PID 4321 kept running after its parent exited, so a cancel cannot reach it\. If Task Manager still shows it as a Copilot or gh process, end it there\.$/
      );
    }
  });
});

test("SessionEnd still closes the session and stops a job whose job file cannot be written", async () => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async () => {
    const { cleanupSessionJobs } = await import(pathToFileURL(SESSION_HOOK).href);
    const { resolveJobFile, updateState } = await import("../plugins/copilot/scripts/lib/state.mjs");
    const { terminateProcessTree } = await import("../plugins/copilot/scripts/lib/process.mjs");
    const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const sessionId = "unwritable-job-file";
    try {
      updateState(tasks.cwd, (state) => {
        state.jobs.unshift({ id: "task-unwritable", status: "running", jobClass: "task", sessionId, pid: worker.pid });
      });
      // A folder where the job file should be: no file can replace it.
      fs.mkdirSync(path.join(resolveJobFile(tasks.cwd, "task-unwritable"), "blocker"), { recursive: true });

      // The real stop runs, but its time is left out: one taskkill alone takes up to 1.4 s on Windows.
      // Stops can overlap, so their time is the span from the first start to the last end.
      let stopsStarted = null;
      let stopsEnded = null;
      const terminateImpl = async (pid, options) => {
        stopsStarted ??= Date.now();
        try {
          return await terminateProcessTree(pid, options);
        } finally {
          stopsEnded = Date.now();
        }
      };
      const started = Date.now();
      await cleanupSessionJobs(tasks.cwd, sessionId, { terminateImpl });

      // A job file that cannot be written gets only a short retry, not the state's 2 s.
      const stopMs = stopsEnded - stopsStarted;
      const cleanupMs = Date.now() - started - stopMs;
      assert.ok(cleanupMs < 1500, `${cleanupMs} ms without the ${stopMs} ms stop`);
      await waitFor(() => !isAlive(worker.pid));
      assert.deepEqual(readClosedSessions(tasks.dataDir).map((entry) => entry.id), [sessionId]);
      assert.equal(findJob(tasks.dataDir, "task-unwritable"), null);
    } finally {
      worker.kill("SIGKILL");
    }
  });
});

test("SessionEnd ends within its 5 s timeout and changes nothing while a live process holds the state lock", async () => {
  const tasks = setUpTasks();
  assert.equal(tasks.companion(["task", "first"], { COPILOT_COMPANION_SESSION_ID: "locked-session" }).status, 0);
  const workspaceDir = path.join(tasks.dataDir, "state", fs.readdirSync(path.join(tasks.dataDir, "state"))[0]);
  const stateFile = path.join(workspaceDir, "state.json");
  const lockFile = `${stateFile}.lock`;
  const before = fs.readFileSync(stateFile);
  const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: holder.pid, token: "held-by-test" }));
    const started = Date.now();

    const result = run(process.execPath, [SESSION_HOOK, "SessionEnd"], {
      cwd: tasks.cwd,
      env: tasks.env,
      input: JSON.stringify({ session_id: "locked-session", cwd: tasks.cwd })
    });

    assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Timed out after \d+ ms waiting for the state lock/);
    assert.ok(fs.readFileSync(stateFile).equals(before));
  } finally {
    fs.rmSync(lockFile, { force: true });
    holder.kill("SIGKILL");
  }
});

test("SessionEnd in a workspace with no state yet still refuses a companion that was preparing the first job", async () => {
  const tasks = setUpTasks("hang");
  const sessionId = "first-job-session";
  await withCompanionEnv({ ...tasks.env, COPILOT_COMPANION_SESSION_ID: sessionId }, async ({ enqueueBackgroundTask }) => {
    const { createJobRecord, runTrackedJob } = await import("../plugins/copilot/scripts/lib/tracked-jobs.mjs");

    const end = run(process.execPath, [SESSION_HOOK, "SessionEnd"], {
      cwd: tasks.cwd,
      env: tasks.env,
      input: JSON.stringify({ session_id: sessionId, cwd: tasks.cwd })
    });

    assert.equal(end.status, 0, end.stderr);
    assert.deepEqual(readClosedSessions(tasks.dataDir).map((entry) => entry.id), [sessionId]);
    // This test process started before the close, like a companion that was still reading its prompt.
    await assert.rejects(
      runTrackedJob(createJobRecord({ id: "task-first", jobClass: "task", workspaceRoot: tasks.cwd }), () =>
        assert.fail("the runner must not run")
      ),
      /Claude session first-job-session has ended/
    );
    const queued = makeQueuedTask(tasks.cwd);
    await assert.rejects(
      enqueueBackgroundTask(tasks.cwd, { ...queued.job, sessionId }, queued.request, {
        spawnWorkerImpl: () => assert.fail("no worker may start")
      }),
      /Claude session first-job-session has ended/
    );
    assert.deepEqual(tasks.runs(), []);
  });
});

test("after SessionEnd, a companion from before the close cannot create, claim or start a job, while a new one can", async () => {
  const tasks = setUpTasks("hang");
  const sessionId = "closed-session";
  await withCompanionEnv({ ...tasks.env, COPILOT_COMPANION_SESSION_ID: sessionId }, async ({ enqueueBackgroundTask }) => {
    const { createJobRecord, guardCopilotStart, runTrackedJob } = await import("../plugins/copilot/scripts/lib/tracked-jobs.mjs");
    const { updateState } = await import("../plugins/copilot/scripts/lib/state.mjs");
    const { runPromptModeTurn } = await import("../plugins/copilot/scripts/lib/copilot.mjs");
    // Stand-ins for a worker that has not claimed its job yet, and one that has claimed its job but
    // not started Copilot yet. SessionEnd stops both.
    const [queuedWorker, claimedWorker] = [0, 1].map(() =>
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    );
    try {
      const queued = makeQueuedTask(tasks.cwd);
      await enqueueBackgroundTask(tasks.cwd, { ...queued.job, sessionId }, queued.request, {
        spawnWorkerImpl: () => queuedWorker
      });
      updateState(tasks.cwd, (state) => {
        state.jobs.unshift({ id: "task-claimed", status: "running", jobClass: "task", sessionId, pid: claimedWorker.pid });
      });

      const end = run(process.execPath, [SESSION_HOOK, "SessionEnd"], {
        cwd: tasks.cwd,
        env: tasks.env,
        input: JSON.stringify({ session_id: sessionId, cwd: tasks.cwd })
      });

      assert.equal(end.status, 0, end.stderr);
      await waitFor(() => !isAlive(queuedWorker.pid) && !isAlive(claimedWorker.pid));
      assert.deepEqual(readJobs(tasks.dataDir), []);
      // This test process started before the close, like a companion that was still preparing a job.
      const fresh = createJobRecord({ id: "task-fresh", jobClass: "task", workspaceRoot: tasks.cwd });
      await assert.rejects(
        runTrackedJob(fresh, () => assert.fail("the runner must not run")),
        /Claude session closed-session has ended/
      );
      const late = makeQueuedTask(tasks.cwd);
      await assert.rejects(
        enqueueBackgroundTask(tasks.cwd, { ...late.job, sessionId }, late.request, {
          spawnWorkerImpl: () => assert.fail("no worker may start")
        }),
        /Claude session closed-session has ended/
      );
      await assert.rejects(
        runPromptModeTurn(tasks.cwd, { prompt: "x", guardStart: guardCopilotStart(tasks.cwd, "task-claimed") }),
        /Copilot was not started/
      );
      const worker = tasks.companion(["task-worker", "--job-id", queued.job.id]);
      assert.notEqual(worker.status, 0);
      // A gate hook that started before the close starts its companion only now; that companion
      // counts from the hook's start.
      const { runStopReview } = await import(pathToFileURL(GATE_HOOK).href);
      const review = await runStopReview(
        tasks.cwd,
        { session_id: sessionId, last_assistant_message: "Edited." },
        { timeoutMs: 20000 }
      );
      assert.equal(review.ok, false);
      assert.match(review.reason, /Claude session closed-session has ended/);
      assert.deepEqual(tasks.runs(), []);

      const resumed = tasks.companion(["task", "after resume"], {
        COPILOT_COMPANION_SESSION_ID: sessionId,
        FAKE_COPILOT_BEHAVIOR: "ok"
      });

      assert.equal(resumed.status, 0, resumed.stderr);
      assert.equal(tasks.runs().length, 1);
    } finally {
      queuedWorker.kill("SIGKILL");
      claimedWorker.kill("SIGKILL");
    }
  });
});
