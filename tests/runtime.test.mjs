// Changed from upstream codex-plugin-cc (Apache-2.0): the setup and review tests run the Copilot
// companion against the fake copilot CLI. Tasks, jobs and hooks come in later tickets.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCopilot, readFakeCopilotRuns, readFakeVersionPids } from "./fake-copilot-fixture.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "copilot");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "copilot-companion.mjs");

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Condition not met within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function runSetup(behavior, options = {}) {
  const binDir = makeTempDir();
  const { recordPath } = installFakeCopilot(binDir, behavior);
  const cwd = options.cwd ?? makeTempDir();
  const result = run(process.execPath, [SCRIPT, "setup", ...(options.args ?? ["--json"])], {
    cwd,
    env: buildEnv(binDir, { CLAUDE_PLUGIN_DATA: makeTempDir(), ...options.env })
  });
  return { result, runs: () => readFakeCopilotRuns(recordPath) };
}

function parsePayload(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("setup reports ready when fake copilot is installed and logged in", () => {
  const payload = parsePayload(runSetup("ok").result);

  assert.equal(payload.ready, true);
  assert.equal(payload.copilot.detail, "GitHub Copilot CLI 1.0.93");
  assert.equal(payload.auth.loggedIn, true);
  assert.equal(payload.sessionRuntime.mode, "direct");
  assert.equal(payload.reviewGateEnabled, false);
});

test("setup reports a missing CLI, and that npm is available to install it", () => {
  // The Node folder holds npm but not copilot, so only resolveLauncher can find npm there on Windows.
  const { result, runs } = runSetup("ok", { env: { PATH: path.dirname(process.execPath) } });
  const payload = parsePayload(result);

  assert.equal(payload.ready, false);
  assert.equal(payload.copilot.available, false);
  assert.equal(payload.copilot.missing, true);
  assert.equal(payload.npm.available, true);
  assert.ok(payload.nextSteps.includes("Install Copilot with `npm install -g @github/copilot`."));
  assert.deepEqual(runs(), []);
});

test("setup refuses a Copilot version below 1.0.93", () => {
  for (const behavior of ["old-version", "pinned-old-version"]) {
    const { result, runs } = runSetup(behavior);
    const payload = parsePayload(result);

    assert.equal(payload.ready, false, behavior);
    assert.equal(payload.copilot.missing, false, behavior);
    assert.match(payload.copilot.detail, /1\.0\.92 is not supported/);
    assert.ok(
      payload.nextSteps.includes(
        "Copilot CLI 1.0.92 is too old. Update it with the tool that installed it (for an npm install: `npm install -g @github/copilot`), then rerun `/copilot:setup`."
      )
    );
    assert.deepEqual(runs(), []);
  }
});

test("setup asks to check an installed Copilot whose version cannot be read, not to install it", () => {
  const payload = parsePayload(runSetup("unreadable-version").result);

  assert.equal(payload.ready, false);
  assert.equal(payload.copilot.missing, false);
  assert.match(payload.copilot.detail, /cannot read the Copilot version/);
  assert.ok(payload.nextSteps.includes("Check that `copilot --no-auto-update --version` works, then rerun `/copilot:setup`."));
  assert.ok(!payload.nextSteps.some((step) => step.startsWith("Install Copilot")));
});

test("setup without a login names copilot login and the token variable", () => {
  const payload = parsePayload(runSetup("not-logged-in").result);

  assert.equal(payload.ready, false);
  assert.equal(payload.auth.detail, "not logged in");
  assert.ok(payload.nextSteps.includes("Run `!copilot login`."));
  assert.ok(payload.nextSteps.some((step) => step.includes("`COPILOT_GITHUB_TOKEN`")));
});

test("setup gives no login steps when the check fails for another reason", () => {
  const payload = parsePayload(runSetup("fail").result);

  assert.equal(payload.ready, false);
  assert.match(payload.auth.detail, /model request failed/);
  assert.ok(!payload.nextSteps.some((step) => step.includes("copilot login")));
});

test(
  "setup without a plugin data folder keeps the fallback folder private",
  { skip: process.platform === "win32" && "a Windows profile folder is private already" },
  () => {
    const home = makeTempDir();
    const { result } = runSetup("ok", { env: { CLAUDE_PLUGIN_DATA: "", HOME: home } });

    assert.equal(parsePayload(result).ready, true);
    assert.equal(fs.statSync(path.join(home, ".copilot-companion")).mode & 0o777, 0o700);
  }
);

test(
  "a companion stopped during a stalled version check stops it and starts no other check",
  { skip: process.platform === "win32" && "Windows stops the tree with taskkill /T" },
  async () => {
    for (const [signal, exitCode] of [["SIGTERM", 143], ["SIGINT", 130]]) {
      const binDir = makeTempDir();
      installFakeCopilot(binDir, "hang-version");
      const companion = spawn(process.execPath, [SCRIPT, "setup", "--json"], {
        cwd: makeTempDir(),
        env: buildEnv(binDir, { CLAUDE_PLUGIN_DATA: makeTempDir() }),
        stdio: "ignore"
      });
      const exited = new Promise((resolve) => companion.on("exit", (code) => resolve(code)));
      await waitFor(() => readFakeVersionPids(binDir).length > 0);

      companion.kill(signal);

      assert.equal(await exited, exitCode, signal);
      // Setup runs a second check after the first; a check that starts during the stop would leak.
      const checks = readFakeVersionPids(binDir);
      assert.equal(checks.length, 1, signal);
      await waitFor(() => checks.flat().every((pid) => !isAlive(pid)));
    }
  }
);

test("setup counts a BYOK provider as ready", () => {
  const payload = parsePayload(
    runSetup("not-logged-in", { env: { COPILOT_PROVIDER_BASE_URL: "http://localhost:11434/v1" } }).result
  );

  assert.equal(payload.ready, true);
  assert.equal(payload.auth.source, "byok");
  assert.ok(!payload.nextSteps.some((step) => step.includes("copilot login")));
});

test("a token variable reaches the login check, and setup prints its name but never its value", () => {
  const secret = "github_pat_fake_value_for_tests";
  const { result, runs } = runSetup("ok", { env: { COPILOT_GITHUB_TOKEN: secret } });
  const payload = parsePayload(result);

  assert.equal(payload.auth.detail, "logged in; COPILOT_GITHUB_TOKEN is set");
  assert.equal(runs()[0].env.COPILOT_GITHUB_TOKEN, secret);
  assert.ok(!result.stdout.includes(secret));
});

test("setup turns the review gate on and off", () => {
  const cwd = makeTempDir();
  const binDir = makeTempDir();
  installFakeCopilot(binDir, "ok");
  const env = buildEnv(binDir, { CLAUDE_PLUGIN_DATA: makeTempDir() });
  const setup = (...args) => run(process.execPath, [SCRIPT, "setup", "--json", ...args], { cwd, env });

  const enabled = parsePayload(setup("--enable-review-gate"));
  assert.equal(enabled.reviewGateEnabled, true);
  assert.match(enabled.actionsTaken[0], /^Enabled the stop-time review gate/);
  assert.ok(!enabled.nextSteps.some((step) => step.includes("--enable-review-gate")));

  const disabled = parsePayload(setup("--disable-review-gate"));
  assert.equal(disabled.reviewGateEnabled, false);
  assert.match(disabled.actionsTaken[0], /^Disabled the stop-time review gate/);

  const both = setup("--enable-review-gate", "--disable-review-gate");
  assert.equal(both.status, 1);
  assert.match(both.stderr, /Choose either --enable-review-gate or --disable-review-gate/);
});

test("setup without --json renders the report", () => {
  const { result } = runSetup("ok", { args: [] });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Copilot Setup\n\nStatus: ready\n/);
  assert.match(result.stdout, /- copilot: GitHub Copilot CLI 1\.0\.93/);
});

test("the setup command file runs the companion and offers the Copilot npm package", () => {
  const command = fs.readFileSync(path.join(PLUGIN_ROOT, "commands", "setup.md"), "utf8");

  assert.match(command, /copilot-companion\.mjs" setup --json \$ARGUMENTS/);
  assert.match(command, /Copilot is missing \(`copilot\.missing` is `true`\) and npm is available/);
  assert.match(command, /npm install -g @github\/copilot/);
  assert.match(command, /!copilot login/);
});

const READ_ONLY_ARGS = ["--available-tools=view,glob,grep", "--deny-tool=write,shell,memory"];
const DIFF_ARGS = ["--binary", "--no-ext-diff", "--submodule=diff"];
const FINDING = {
  severity: "high",
  title: "Missing empty-state guard",
  body: "items can be empty.",
  file: "src/app.js",
  line_start: 1,
  line_end: 1,
  confidence: 0.8,
  recommendation: "Guard the empty list."
};
const REVIEW_JSON = JSON.stringify({
  verdict: "needs-attention",
  summary: "Do not ship yet.",
  findings: [FINDING],
  next_steps: ["Add the guard."]
});

function git(repo, ...args) {
  const result = run("git", args, { cwd: repo });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function writeFile(repo, name, text) {
  fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
  fs.writeFileSync(path.join(repo, name), text);
}

// A committed file with one unstaged change: a small working-tree review.
function makeRepo(repo = makeTempDir()) {
  initGitRepo(repo);
  writeFile(repo, "src/app.js", "export const value = items[0];\n");
  git(repo, "add", "src/app.js");
  git(repo, "commit", "-m", "init");
  writeFile(repo, "src/app.js", "export const value = items[0].id;\n");
  return repo;
}

// Every file under the folder, .git included, so a review that writes anything is caught.
function snapshot(dir) {
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

function runReview(subcommand, repo, options = {}) {
  const binDir = makeTempDir();
  const { recordPath } = installFakeCopilot(binDir, options.behavior ?? "ok");
  const dataDir = makeTempDir();
  const result = run(process.execPath, [SCRIPT, subcommand, ...(options.args ?? [])], {
    cwd: repo,
    env: buildEnv(binDir, { CLAUDE_PLUGIN_DATA: dataDir, ...options.env })
  });
  return { result, runs: readFakeCopilotRuns(recordPath), dataDir };
}

function readJobs(dataDir) {
  const stateRoot = path.join(dataDir, "state");
  const [workspaceDir] = fs.readdirSync(stateRoot);
  return JSON.parse(fs.readFileSync(path.join(stateRoot, workspaceDir, "state.json"), "utf8")).jobs;
}

function assertReadOnlyRun(copilotRun, dataDir) {
  for (const arg of READ_ONLY_ARGS) {
    assert.ok(copilotRun.args.includes(arg), arg);
  }
  assert.ok(!copilotRun.args.some((arg) => /allow-all|--allow-tool|--sandbox/.test(arg)), copilotRun.args.join(" "));
  assert.equal(copilotRun.env.COPILOT_HOME, path.join(dataDir, "copilot-home"));
}

function addDirsOf(copilotRun) {
  return copilotRun.args.filter((arg) => arg.startsWith("--add-dir=")).map((arg) => arg.slice("--add-dir=".length));
}

function patchesOf(copilotRun) {
  return Object.fromEntries(Object.entries(copilotRun.addDirFiles).map(([name, data]) => [name, Buffer.from(data, "base64")]));
}

// Raw bytes with no buffer limit, to compare with the patch files.
function gitBytes(repo, ...args) {
  const result = spawnSync("git", args, { cwd: repo, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}

test("review sends /review with the working-tree diff on the read-only profile", () => {
  const repo = makeRepo();
  const { result, runs, dataDir } = runReview("review", repo);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Copilot Review\n\nTarget: working tree diff\n/);
  assert.match(result.stdout, /Fake Copilot answer\./);
  assert.equal(runs.length, 1);
  assert.match(runs[0].prompt, /^\/review the working tree diff\./);
  assert.match(runs[0].prompt, /export const value = items\[0\]\.id;/);
  assertReadOnlyRun(runs[0], dataDir);
  assert.deepEqual(addDirsOf(runs[0]), []);
  assert.equal(readJobs(dataDir)[0].status, "completed");
});

test("review --json gives upstream's payload, with the session as both thread ids", () => {
  const { result, runs } = runReview("review", makeRepo(), { args: ["--json"] });
  const payload = JSON.parse(result.stdout);
  const sessionId = runs[0].args.find((arg) => arg.startsWith("--session-id=")).slice("--session-id=".length);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.review, "Review");
  assert.equal(payload.target.mode, "working-tree");
  assert.equal(payload.threadId, sessionId);
  assert.equal(payload.sourceThreadId, sessionId);
  assert.equal(payload.copilot.status, 0);
  assert.equal(payload.copilot.stdout, "Fake Copilot answer.");
  assert.deepEqual(payload.copilot.reasoning, ["Looked at the request."]);
});

test("review accepts the quoted raw argument style for base-branch review", () => {
  const repo = makeRepo();
  git(repo, "checkout", "-q", "-b", "feature");
  git(repo, "commit", "-qam", "change");

  const { result, runs } = runReview("review", repo, { args: ["--base main"] });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Target: branch diff against main/);
  assert.match(runs[0].prompt, /^\/review the branch diff against main\./);
  assert.match(runs[0].prompt, /export const value = items\[0\]\.id;/);
});

test("review rejects focus text because it is native-review only", () => {
  const { result, runs } = runReview("review", makeRepo(), { args: ["--scope working-tree focus on auth"] });

  assert.equal(result.status > 0, true);
  assert.match(result.stderr, /does not support custom focus text/i);
  assert.match(result.stderr, /\/copilot:adversarial-review focus on auth/i);
  assert.deepEqual(runs, []);
});

test("review refuses --write instead of running a review that can write", () => {
  const { result, runs } = runReview("review", makeRepo(), { args: ["--write"] });

  assert.equal(result.status > 0, true);
  assert.match(result.stderr, /does not support custom focus text/i);
  assert.deepEqual(runs, []);
});

test("review and adversarial review reject staged-only scope", () => {
  for (const subcommand of ["review", "adversarial-review"]) {
    const repo = makeRepo();
    git(repo, "add", "src/app.js");
    const { result } = runReview(subcommand, repo, { args: ["--scope", "staged"] });

    assert.equal(result.status > 0, true, subcommand);
    assert.match(result.stderr, /Unsupported review scope "staged"/i);
    assert.match(result.stderr, /Use one of: auto, working-tree, branch, or pass --base <ref>/i);
  }
});

test("adversarial review renders structured findings and puts the schema in the prompt", () => {
  const { result, runs, dataDir } = runReview("adversarial-review", makeRepo(), {
    env: { FAKE_COPILOT_ANSWER: REVIEW_JSON }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verdict: needs-attention/);
  assert.match(result.stdout, /\[high\] Missing empty-state guard \(src\/app\.js:1\)/);
  assert.match(runs[0].prompt, /You are Copilot performing an adversarial software review/);
  assert.match(runs[0].prompt, /<output_schema>\n\{\n {2}"\$schema"/);
  assert.match(runs[0].prompt, /"needs-attention"/);
  assertReadOnlyRun(runs[0], dataDir);
});

test("adversarial review accepts the same base-branch targeting as review", () => {
  const repo = makeRepo();
  git(repo, "checkout", "-q", "-b", "feature");
  git(repo, "commit", "-qam", "change");

  const { result } = runReview("adversarial-review", repo, {
    args: ["--base", "main"],
    env: { FAKE_COPILOT_ANSWER: REVIEW_JSON }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Target: branch diff against main/);
  assert.match(result.stdout, /Missing empty-state guard/);
});

test("adversarial review accepts JSON inside one code fence", () => {
  const { result } = runReview("adversarial-review", makeRepo(), {
    env: { FAKE_COPILOT_ANSWER: `\`\`\`json\n${REVIEW_JSON}\n\`\`\`` }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Missing empty-state guard/);
});

test("broken review JSON fails the job and keeps the raw output", () => {
  const answer = "The change looks fine to me.";
  const { result, dataDir } = runReview("adversarial-review", makeRepo(), {
    args: ["--json"],
    env: { FAKE_COPILOT_ANSWER: answer }
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.match(payload.parseError, /JSON/);
  assert.equal(payload.result, null);
  assert.equal(payload.rawOutput, answer);
  assert.equal(readJobs(dataDir)[0].status, "failed");
});

test("valid review JSON with the wrong shape fails the job and keeps the raw output", () => {
  const review = JSON.parse(REVIEW_JSON);
  const { file, ...findingWithoutFile } = FINDING;
  assert.equal(file, "src/app.js");
  const cases = [
    [null, "The review output must be of type object."],
    [{}, "The review output is missing `verdict`."],
    [{ ...review, verdict: "maybe" }, "`verdict` must be one of: approve, needs-attention."],
    [{ ...review, findings: [findingWithoutFile] }, "`findings[0]` is missing `file`."],
    [{ ...review, constructor: "unexpected" }, "The review output has the unknown field `constructor`."],
    [{ ...review, findings: [{ ...FINDING, toString: "unexpected" }] }, "`findings[0]` has the unknown field `toString`."]
  ].map(([value, error]) => [value, `The JSON does not match the review schema: ${error}`]);

  for (const [value, expectedError] of cases) {
    const answer = JSON.stringify(value);
    const { result, dataDir } = runReview("adversarial-review", makeRepo(), {
      args: ["--json"],
      env: { FAKE_COPILOT_ANSWER: answer }
    });
    const payload = JSON.parse(result.stdout);

    assert.equal(result.status, 1, answer);
    assert.equal(payload.parseError, expectedError);
    assert.equal(payload.result, null);
    assert.equal(payload.rawOutput, answer);
    assert.equal(readJobs(dataDir)[0].status, "failed", answer);
  }
});

test("a review changes no file, even with --write and a Copilot that writes when it can", () => {
  for (const [subcommand, args] of [["review", []], ["adversarial-review", ["--write"]]]) {
    const repo = makeRepo();
    const before = snapshot(repo);
    const { result, runs, dataDir } = runReview(subcommand, repo, {
      behavior: "write-attempt",
      args,
      env: { FAKE_COPILOT_ANSWER: REVIEW_JSON }
    });

    assert.equal(result.status, 0, `${subcommand}: ${result.stderr}`);
    assertReadOnlyRun(runs[0], dataDir);
    assert.deepEqual(snapshot(repo), before, subcommand);
  }
});

test("a review refuses to run when Copilot is too old or rejects the read-only arguments", () => {
  const old = runReview("review", makeRepo(), { behavior: "old-version" });
  assert.equal(old.result.status, 1);
  assert.match(old.result.stderr, /Copilot CLI 1\.0\.92 is not supported/);
  assert.deepEqual(old.runs, []);

  const rejected = runReview("review", makeRepo(), { behavior: "reject-flags" });
  assert.equal(rejected.result.status, 1);
  assert.match(rejected.result.stdout, /Copilot stopped before it sent a result \(exit 1\)/);
  assert.match(rejected.result.stdout, /unknown option '--available-tools=view,glob,grep'/);
  assert.deepEqual(rejected.runs, []);
});

test("a review whose Copilot starts a write tool is stopped and its process is killed", async () => {
  for (const subcommand of ["review", "adversarial-review"]) {
    const repo = makeRepo();
    const before = snapshot(repo);
    const { result, runs, dataDir } = runReview(subcommand, repo, { behavior: "forbidden-tool" });

    assert.equal(result.status, 1, subcommand);
    assert.match(result.stdout, /Copilot started the tool "create", which a read-only run does not allow/);
    assert.equal(readJobs(dataDir)[0].status, "failed");
    assert.deepEqual(snapshot(repo), before);
    await waitFor(() => !isAlive(runs[0].pid));
  }
});

test("an adversarial review whose run fails or is stopped after valid JSON still fails and says why", () => {
  const approval = JSON.stringify({ verdict: "approve", summary: "Ship it.", findings: [], next_steps: [] });
  const cases = [
    ["forbidden-tool", /Copilot started the tool "create"/],
    ["fail", /fake copilot: model request failed/]
  ];

  for (const [behavior, expectedError] of cases) {
    const { result } = runReview("adversarial-review", makeRepo(), {
      behavior,
      args: ["--json"],
      env: { FAKE_COPILOT_ANSWER: approval }
    });
    const payload = JSON.parse(result.stdout);

    assert.equal(result.status, 1, behavior);
    assert.equal(payload.result, null, behavior);
    assert.equal(payload.rawOutput, approval, behavior);
    assert.match(payload.parseError, expectedError);

    const rendered = runReview("adversarial-review", makeRepo(), { behavior, env: { FAKE_COPILOT_ANSWER: approval } });
    assert.equal(rendered.result.status, 1, behavior);
    assert.doesNotMatch(rendered.result.stdout, /Verdict: approve/);
    assert.match(rendered.result.stdout, expectedError);
  }
});

test("above the inline limit, a working-tree review reads the exact patches from a folder that is then removed", () => {
  const repo = makeTempDir();
  initGitRepo(repo);
  for (const name of ["a.txt", "b.txt", "c.txt", "deleted.txt", "latin1.txt"]) {
    writeFile(repo, name, `${name} v1\n`);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "rm", "-q", "deleted.txt");
  writeFile(repo, "a.txt", "a.txt STAGED_MARKER\n");
  git(repo, "add", "a.txt");
  writeFile(repo, "a.txt", "a.txt UNSTAGED_MARKER\n");
  writeFile(repo, "b.txt", "b.txt UNSTAGED_MARKER\n");
  // More than spawnSync's default 1 MiB buffer.
  writeFile(repo, "c.txt", `${Array.from({ length: 15000 }, (_, index) => `line ${index} ${"x".repeat(90)}`).join("\n")}\nBIG_END\n`);
  git(repo, "add", "c.txt");
  // "café" in Latin-1: bytes that are not UTF-8 must reach the patch unchanged.
  fs.writeFileSync(path.join(repo, "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  writeFile(repo, "new.txt", "untracked file\n");
  const before = snapshot(repo);

  const { result, runs } = runReview("adversarial-review", repo, { env: { FAKE_COPILOT_ANSWER: REVIEW_JSON } });

  assert.equal(result.status, 0, result.stderr);
  const [patchDir] = addDirsOf(runs[0]);
  assert.ok(patchDir);
  assert.equal(fs.existsSync(patchDir), false);
  const patches = patchesOf(runs[0]);
  assert.deepEqual(Object.keys(patches).sort(), ["staged.patch", "unstaged.patch", "untracked.md"]);
  assert.ok(patches["staged.patch"].equals(gitBytes(repo, "diff", "--cached", ...DIFF_ARGS)));
  assert.ok(patches["unstaged.patch"].equals(gitBytes(repo, "diff", ...DIFF_ARGS)));
  assert.ok(patches["staged.patch"].length > 1024 * 1024);
  assert.ok(patches["unstaged.patch"].includes(Buffer.from([0x2b, 0x63, 0x61, 0x66, 0xe9, 0x0a])));
  const staged = patches["staged.patch"].toString("utf8");
  assert.match(staged, /deleted file mode 100644\n[^\n]*\n--- a\/deleted\.txt/);
  assert.match(staged, /\+a\.txt STAGED_MARKER/);
  assert.match(staged, /\+BIG_END\n/);
  assert.match(patches["unstaged.patch"].toString("utf8"), /-a\.txt STAGED_MARKER\n\+a\.txt UNSTAGED_MARKER/);
  assert.match(patches["untracked.md"].toString("utf8"), /### new\.txt\n```\nuntracked file\n```/);
  assert.match(runs[0].prompt, /lightweight summary/i);
  assert.match(runs[0].prompt, /with the view tool/);
  assert.ok(runs[0].prompt.includes(`## Patch Files\n\n- ${path.join(patchDir, "staged.patch")}\n`));
  assert.doesNotMatch(runs[0].prompt, /STAGED_MARKER|UNSTAGED_MARKER|BIG_END/);
  assert.deepEqual(snapshot(repo), before);
});

// The patch folders under the plugin data folder: jobs/<job id>.patches.
function findPatchDirs(dataDir) {
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

test(
  "a review stopped with SIGTERM or SIGINT removes its patch folder, before or while Copilot runs",
  { skip: process.platform === "win32" && "Windows stops the tree with taskkill /T" },
  async () => {
    for (const [behavior, signal, exitCode] of [
      ["hang", "SIGTERM", 143],
      ["hang", "SIGINT", 130],
      ["hang-version", "SIGTERM", 143],
      ["hang-version", "SIGINT", 130]
    ]) {
      const repo = makeTempDir();
      initGitRepo(repo);
      for (const name of ["a.txt", "b.txt", "c.txt"]) {
        writeFile(repo, name, `${name} v1\n`);
      }
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "init");
      for (const name of ["a.txt", "b.txt", "c.txt"]) {
        writeFile(repo, name, `${name} v2\n`);
      }
      const binDir = makeTempDir();
      const dataDir = makeTempDir();
      const { recordPath } = installFakeCopilot(binDir, behavior);
      const companion = spawn(process.execPath, [SCRIPT, "adversarial-review"], {
        cwd: repo,
        env: buildEnv(binDir, { CLAUDE_PLUGIN_DATA: dataDir }),
        stdio: "ignore"
      });
      const exited = new Promise((resolve) => companion.on("exit", (code) => resolve(code)));
      // A stop that does not work must fail the test, not hang it.
      const fallback = setTimeout(() => companion.kill("SIGKILL"), 15000);
      await waitFor(() =>
        behavior === "hang" ? readFakeCopilotRuns(recordPath).length > 0 : readFakeVersionPids(binDir).length > 0
      );
      const label = `${behavior} ${signal}`;
      assert.equal(findPatchDirs(dataDir).length, 1, label);

      companion.kill(signal);
      const code = await exited;
      clearTimeout(fallback);

      assert.equal(code, exitCode, label);
      assert.deepEqual(findPatchDirs(dataDir), [], label);
    }
  }
);

test("above the inline limit, a branch review gets only the branch patch, without local edits", () => {
  const repo = makeTempDir();
  initGitRepo(repo);
  for (const name of ["a.txt", "b.txt", "c.txt"]) {
    writeFile(repo, name, `${name} v1\n`);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "checkout", "-q", "-b", "feature");
  for (const name of ["a.txt", "b.txt", "c.txt"]) {
    writeFile(repo, name, `${name} BRANCH_MARKER\n`);
  }
  git(repo, "commit", "-qam", "change");
  writeFile(repo, "a.txt", "a.txt LOCAL_MARKER\n");

  const { result, runs } = runReview("review", repo, { args: ["--base", "main"] });

  assert.equal(result.status, 0, result.stderr);
  const [patchDir] = addDirsOf(runs[0]);
  assert.equal(fs.existsSync(patchDir), false);
  const patches = patchesOf(runs[0]);
  assert.deepEqual(Object.keys(patches), ["branch.patch"]);
  const mergeBase = git(repo, "merge-base", "HEAD", "main").trim();
  assert.ok(patches["branch.patch"].equals(gitBytes(repo, "diff", ...DIFF_ARGS, `${mergeBase}..HEAD`)));
  assert.match(patches["branch.patch"].toString("utf8"), /BRANCH_MARKER/);
  assert.doesNotMatch(patches["branch.patch"].toString("utf8"), /LOCAL_MARKER/);
  assert.doesNotMatch(runs[0].prompt, /LOCAL_MARKER/);
});

test("focus text with shell characters reaches the prompt unchanged, in a repo path with spaces", () => {
  const repo = path.join(makeTempDir(), "repo with spaces & more");
  fs.mkdirSync(repo);
  makeRepo(repo);
  const focus = `$(touch pwned) & echo "hi" | more; 'quoted' %PATH% \`id\``;

  const { result, runs } = runReview("adversarial-review", repo, {
    args: ["--scope", "working-tree", focus],
    env: { FAKE_COPILOT_ANSWER: REVIEW_JSON }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(runs[0].prompt.includes(`User focus: ${focus}\n`));
  assert.equal(fs.existsSync(path.join(repo, "pwned")), false);
});
