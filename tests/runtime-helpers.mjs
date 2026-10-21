// Changed from upstream codex-plugin-cc (Apache-2.0): split out of tests/runtime.test.mjs;
// the shared helpers of the runtime tests, which run the Copilot companion against the fake copilot CLI.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildEnv, installFakeCopilot, readFakeChildPids, readFakeCopilotRuns } from "./fake-copilot-fixture.mjs";
import { countLines, git, initGitRepo, makeTempDir, run } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN_ROOT = path.join(ROOT, "plugins", "copilot");
export const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "copilot-companion.mjs");

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

export async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Condition not met within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const READ_ONLY_ARGS = ["--available-tools=view,glob,grep", "--deny-tool=write,shell,memory"];
export const FINDING = {
  severity: "high",
  title: "Missing empty-state guard",
  body: "items can be empty.",
  file: "src/app.js",
  line_start: 1,
  line_end: 1,
  confidence: 0.8,
  recommendation: "Guard the empty list."
};
export const REVIEW_JSON = JSON.stringify({
  verdict: "needs-attention",
  summary: "Do not ship yet.",
  findings: [FINDING],
  next_steps: ["Add the guard."]
});


export function writeFile(repo, name, text) {
  fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
  fs.writeFileSync(path.join(repo, name), text);
}

// A committed file with one unstaged change: a small working-tree review.
export function makeRepo(repo = makeTempDir()) {
  initGitRepo(repo);
  writeFile(repo, "src/app.js", "export const value = items[0];\n");
  git(repo, "add", "src/app.js");
  git(repo, "commit", "-m", "init");
  writeFile(repo, "src/app.js", "export const value = items[0].id;\n");
  return repo;
}

// Every file under the folder, .git included, so a review that writes anything is caught.
export function snapshot(dir) {
  const files = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files[path.relative(dir, full)] = fs.readFileSync(full).toString("base64");
      }
    }
  };
  walk(dir);
  return files;
}

export function runReview(subcommand, repo, options = {}) {
  const binDir = makeTempDir();
  const { recordPath } = installFakeCopilot(binDir, options.behavior ?? "ok");
  const dataDir = makeTempDir();
  const result = run(process.execPath, [SCRIPT, subcommand, ...(options.args ?? [])], {
    cwd: repo,
    env: buildEnv(binDir, { CLAUDE_PLUGIN_DATA: dataDir, ...options.env })
  });
  return { result, runs: readFakeCopilotRuns(recordPath), dataDir };
}

export function readJobs(dataDir) {
  const stateRoot = path.join(dataDir, "state");
  const [workspaceDir] = fs.readdirSync(stateRoot);
  return JSON.parse(fs.readFileSync(path.join(stateRoot, workspaceDir, "state.json"), "utf8")).jobs;
}

export function assertReadOnlyRun(copilotRun, dataDir) {
  for (const arg of READ_ONLY_ARGS) {
    assert.ok(copilotRun.args.includes(arg), arg);
  }
  assert.ok(!copilotRun.args.some((arg) => /allow-all|--allow-tool|--sandbox/.test(arg)), copilotRun.args.join(" "));
  assert.equal(copilotRun.env.COPILOT_HOME, path.join(dataDir, "copilot-home"));
}

export function addDirsOf(copilotRun) {
  return copilotRun.args.filter((arg) => arg.startsWith("--add-dir=")).map((arg) => arg.slice("--add-dir=".length));
}

export function patchesOf(copilotRun) {
  return Object.fromEntries(Object.entries(copilotRun.addDirFiles).map(([name, data]) => [name, Buffer.from(data, "base64")]));
}

// One line of the prompt's Patch Files list.
export function patchListEntry(patchDir, patches, name, label) {
  return `- ${path.join(patchDir, name)} (${countLines(patches[name].toString("latin1"))} lines): ${label}`;
}

// The patch folders under the plugin data folder: jobs/<job id>.patches.
export function findPatchDirs(dataDir) {
  const stateRoot = path.join(dataDir, "state");
  if (!fs.existsSync(stateRoot)) {
    return [];
  }
  return fs.readdirSync(stateRoot).flatMap((workspace) => {
    const jobsDir = path.join(stateRoot, workspace, "jobs");
    return fs.existsSync(jobsDir)
      ? fs.readdirSync(jobsDir).filter((name) => name.endsWith(".patches")).map((name) => path.join(jobsDir, name))
      : [];
  });
}

// One fake Copilot, one plugin data folder and one working folder, shared by the companion runs of a
// test. No Claude session is set unless a test sets one.
export function setUpTasks(behavior = "ok", options = {}) {
  const binDir = makeTempDir();
  const { recordPath } = installFakeCopilot(binDir, behavior);
  const dataDir = makeTempDir();
  const cwd = options.cwd ?? makeTempDir();
  const env = buildEnv(binDir, { CLAUDE_PLUGIN_DATA: dataDir, COPILOT_COMPANION_SESSION_ID: "", ...options.env });
  const companion = (args, extraEnv = {}) => run(process.execPath, [SCRIPT, ...args], { cwd, env: { ...env, ...extraEnv } });
  return { binDir, dataDir, cwd, env, companion, runs: () => readFakeCopilotRuns(recordPath) };
}

// The state file is replaced through a rename, which a read on Windows can meet halfway.
export function findJob(dataDir, jobId) {
  try {
    return readJobs(dataDir).find((job) => job.id === jobId) ?? null;
  } catch {
    return null;
  }
}

// A background job is ready to stop once its Copilot and Copilot's child run. A timeout shows the job
// record and its log, because the worker has no other output.
export async function waitForCopilotStart(dataDir, binDir, jobId) {
  try {
    await waitFor(() => findJob(dataDir, jobId)?.copilotPid && readFakeChildPids(binDir).length > 0, 30000);
  } catch (error) {
    const job = findJob(dataDir, jobId);
    const log = job?.logFile && fs.existsSync(job.logFile) ? fs.readFileSync(job.logFile, "utf8") : "(no log)";
    throw new Error(`${error.message}\njob: ${JSON.stringify(job)}\nlog:\n${log}`);
  }
  return findJob(dataDir, jobId);
}

// The background start, run in this process so a test can put a stand-in for the worker spawn.
export async function withCompanionEnv(env, fn) {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  try {
    return await fn(await import(pathToFileURL(SCRIPT).href));
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, previous);
  }
}

export function makeQueuedTask(cwd, prompt = "fix the bug") {
  const jobId = `task-test-${Math.random().toString(36).slice(2, 10)}`;
  return {
    job: {
      id: jobId,
      kind: "task",
      kindLabel: "rescue",
      title: "Copilot Task",
      workspaceRoot: cwd,
      jobClass: "task",
      summary: prompt,
      write: false,
      createdAt: new Date().toISOString()
    },
    request: { cwd, prompt, write: false, resumeLast: false, jobId }
  };
}

export const GATE_HOOK = path.join(PLUGIN_ROOT, "scripts", "stop-review-gate-hook.mjs");
export const GATE_TITLE = "Copilot Stop Gate Review";

// About 300 KB: a diff that adds it is above the 256 KB inline limit.
export function largeText(firstLine) {
  return `${firstLine}\n${Array.from({ length: 3000 }, (_, index) => `line ${index} ${"x".repeat(90)}`).join("\n")}\n`;
}

// Three changed files and a diff above the inline limit, so the gate writes a patch folder.
export function makeLargeRepo() {
  const repo = makeTempDir();
  initGitRepo(repo);
  for (const name of ["a.txt", "b.txt", "c.txt"]) {
    writeFile(repo, name, `${name} v1\n`);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  writeFile(repo, "a.txt", "a.txt v2\n");
  writeFile(repo, "b.txt", "b.txt v2\n");
  writeFile(repo, "c.txt", largeText("c.txt v2"));
  return repo;
}

// A repo whose gate is on, unless the test says otherwise. Setup's login check is also a Copilot run,
// with the normal fake, so the gate's run is the last one.
export function setUpGate(behavior = "ok", options = {}) {
  const repo = options.repo ?? makeRepo();
  const tasks = setUpTasks(behavior, { cwd: repo, env: options.env });
  if (options.enable !== false) {
    const setup = tasks.companion(["setup", "--enable-review-gate", "--json"], { FAKE_COPILOT_BEHAVIOR: "ok" });
    assert.equal(setup.status, 0, setup.stderr);
  }
  const gate = (input = {}, extraEnv = {}) =>
    run(process.execPath, [GATE_HOOK], {
      cwd: repo,
      env: { ...tasks.env, ...extraEnv },
      input: JSON.stringify({ cwd: repo, ...input })
    });
  return { ...tasks, repo, gate, gateRun: () => tasks.runs().at(-1) };
}
