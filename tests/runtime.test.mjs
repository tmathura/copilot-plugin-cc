// Changed from upstream codex-plugin-cc (Apache-2.0): the setup, review, task and job tests run the
// Copilot companion against the fake copilot CLI.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildEnv,
  installFakeCopilot,
  readFakeChildPids,
  readFakeCopilotRuns,
  readFakeVersionPids
} from "./fake-copilot-fixture.mjs";
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

test("a review's job summary skips headings and bold labels, and keeps a bold sentence without its markers", () => {
  const cases = [
    ["## Review\n\nThe loop skips the last item.\n", "The loop skips the last item."],
    ["**Review findings**\n\n1. The loop skips the last item.\n", "1. The loop skips the last item."],
    ["**Findings:**\n- The loop skips the last item.\n", "- The loop skips the last item."],
    ["**The change breaks the empty case.**\n\nDetails follow.\n", "The change breaks the empty case."],
    ["## Review\n---\n__Findings__\n```\nThe loop skips the last item.\n", "The loop skips the last item."],
    ["**Findings in my_module**:\n**The get_user call fails for a*b.**\n", "The get_user call fails for a*b."],
    ["**Is the empty case handled?**\n", "Is the empty case handled?"],
    ["**a** and **b** differ.\n", "**a** and **b** differ."],
    ["***Findings***\r\n~~~markdown\r\n***The cache never expires.***\r\n", "The cache never expires."],
    ["~~~\n~~~\n* * *\n-  -  -\n", "Review completed."],
    ["# Review\n\n### Findings\n\n**Summary**\n", "Review completed."]
  ];
  for (const [answer, summary] of cases) {
    const { result, dataDir } = runReview("review", makeRepo(), { env: { FAKE_COPILOT_ANSWER: answer } });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readJobs(dataDir)[0].summary, summary, answer);
  }

  const { companion, dataDir } = setUpTasks("ok", { env: { FAKE_COPILOT_ANSWER: "## Done\n\nI fixed the null check." } });
  assert.equal(companion(["task", "fix it"]).status, 0);
  assert.equal(readJobs(dataDir)[0].summary, "I fixed the null check.");
});

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

test("an adversarial review asks for the JSON as plain text in the final message, not through a tool", () => {
  const { runs } = runReview("adversarial-review", makeRepo(), { env: { FAKE_COPILOT_ANSWER: REVIEW_JSON } });

  assert.match(runs[0].prompt, /Write your answer as plain text in your final message: only valid JSON/);
  assert.match(runs[0].prompt, /Do not call a tool to return it/);
  assert.doesNotMatch(runs[0].prompt, /the provided schema/);
});

test("an adversarial review whose last turn has no answer fails with a clear error, not an earlier message", () => {
  const approval = JSON.stringify({ verdict: "approve", summary: "Ship it.", findings: [], next_steps: [] });
  for (const earlier of [undefined, approval]) {
    const env = earlier ? { FAKE_COPILOT_ANSWER: earlier } : {};
    const { result } = runReview("adversarial-review", makeRepo(), { behavior: "no-final-message", args: ["--json"], env });
    const payload = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(payload.result, null);
    assert.match(payload.parseError, /Copilot ended its last turn without an answer, so the review has no verdict\. Run the review again\./);
    assert.equal(payload.copilot.stdout, "");

    const rendered = runReview("adversarial-review", makeRepo(), { behavior: "no-final-message", env });
    assert.equal(rendered.result.status, 1);
    assert.doesNotMatch(rendered.result.stdout, /Verdict: approve|Need to check what setup prints/);
    assert.match(rendered.result.stdout, /without an answer/);
    assert.match(rendered.result.stdout, /I would approve/);
  }
});

test("an adversarial review takes the JSON from the last turn, after an earlier message", () => {
  const { result } = runReview("adversarial-review", makeRepo(), {
    args: ["--json"],
    env: { FAKE_COPILOT_EARLIER: "Need to check what setup prints.", FAKE_COPILOT_ANSWER: REVIEW_JSON }
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.result.verdict, "needs-attention");
  assert.equal(payload.copilot.stdout, REVIEW_JSON);
});

test("an adversarial review whose run fails with an empty last turn reports the failure", () => {
  const { result } = runReview("adversarial-review", makeRepo(), { behavior: "truncated", args: ["--json"] });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.result, null);
  assert.match(payload.parseError, /fake copilot: connection lost/);
  assert.doesNotMatch(payload.parseError, /without an answer/);
  assert.equal(payload.copilot.stdout, "");
});

test("an adversarial review whose Copilot calls a json tool is stopped with a clear error", async () => {
  const { result, runs } = runReview("adversarial-review", makeRepo(), {
    behavior: "forbidden-tool",
    env: { FAKE_COPILOT_TOOL: "json" }
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Copilot started the tool "json", which a read-only run does not allow\. The run was stopped\./);
  await waitFor(() => !isAlive(runs[0].pid));
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

test("above the inline limit, a branch review keeps a trailing no-break space on the last changed file name", () => {
  const repo = makeTempDir();
  initGitRepo(repo);
  const names = ["a.txt", "b.txt", "z.txt "];
  for (const name of names) {
    writeFile(repo, name, `${name} v1\n`);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "checkout", "-q", "-b", "feature");
  for (const name of names) {
    writeFile(repo, name, `${name} v2\n`);
  }
  git(repo, "commit", "-qam", "change");

  const { result, runs } = runReview("review", repo, { args: ["--base", "main"] });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(addDirsOf(runs[0]).length, 1);
  assert.ok(runs[0].prompt.includes("## Changed Files\n\na.txt\nb.txt\nz.txt \n\n## Patch Files"), runs[0].prompt);
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

const WRITE_ARGS = ["--allow-tool=write,shell", "--deny-tool=shell(git push)", "--sandbox"];

// One fake Copilot, one plugin data folder and one working folder, shared by the companion runs of a
// test. No Claude session is set unless a test sets one.
function setUpTasks(behavior = "ok", options = {}) {
  const binDir = makeTempDir();
  const { recordPath } = installFakeCopilot(binDir, behavior);
  const dataDir = makeTempDir();
  const cwd = options.cwd ?? makeTempDir();
  const env = buildEnv(binDir, { CLAUDE_PLUGIN_DATA: dataDir, COPILOT_COMPANION_SESSION_ID: "", ...options.env });
  const companion = (args, extraEnv = {}) => run(process.execPath, [SCRIPT, ...args], { cwd, env: { ...env, ...extraEnv } });
  return { binDir, dataDir, cwd, env, companion, runs: () => readFakeCopilotRuns(recordPath) };
}

// The state file is replaced through a rename, which a read on Windows can meet halfway.
function findJob(dataDir, jobId) {
  try {
    return readJobs(dataDir).find((job) => job.id === jobId) ?? null;
  } catch {
    return null;
  }
}

// A background job is ready to stop once its Copilot and Copilot's child run. A timeout shows the job
// record and its log, because the worker has no other output.
async function waitForCopilotStart(dataDir, binDir, jobId) {
  try {
    await waitFor(() => findJob(dataDir, jobId)?.copilotPid && readFakeChildPids(binDir).length > 0, 30000);
  } catch (error) {
    const job = findJob(dataDir, jobId);
    const log = job?.logFile && fs.existsSync(job.logFile) ? fs.readFileSync(job.logFile, "utf8") : "(no log)";
    throw new Error(`${error.message}\njob: ${JSON.stringify(job)}\nlog:\n${log}`);
  }
  return findJob(dataDir, jobId);
}

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

// The background start, run in this process so a test can put a stand-in for the worker spawn.
async function withCompanionEnv(env, fn) {
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

function makeQueuedTask(cwd, prompt = "fix the bug") {
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
      // The job's own Copilot pid is left after its companion exits. Its own stop worked, so it is gone.
      ["task-orphan-is-stopped-copilot", { 111111: orphan(222222), 222222: null }, false, false],
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

      await assert.rejects(cancelJob(tasks.cwd, jobId, { terminateImpl }), (error) => {
        assert.equal(
          /The parent of PID 4321 has exited, so a new cancel cannot reach it\. If it keeps running, end it in Task Manager\./.test(error.message),
          named,
          jobId
        );
        assert.equal(/The parent of PID 222222/.test(error.message), false, jobId);
        assert.equal(/PID 4321, PID 4321/.test(error.message), false, jobId);
        assert.equal(/Run \/copilot:cancel .* again\.$/.test(error.message), retry, jobId);
        return true;
      });
    }
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

const GATE_HOOK = path.join(PLUGIN_ROOT, "scripts", "stop-review-gate-hook.mjs");
const SESSION_HOOK = path.join(PLUGIN_ROOT, "scripts", "session-lifecycle-hook.mjs");
const GATE_TITLE = "Copilot Stop Gate Review";

function findJobByTitle(dataDir, title) {
  try {
    return readJobs(dataDir).find((job) => job.title === title) ?? null;
  } catch {
    return null;
  }
}

// Three changed files: above the inline limit of two, so the gate writes a patch folder.
function makeLargeRepo() {
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
  return repo;
}

// A repo whose gate is on, unless the test says otherwise. Setup's login check is also a Copilot run,
// with the normal fake, so the gate's run is the last one.
function setUpGate(behavior = "ok", options = {}) {
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
    assert.deepEqual(Object.keys(patchesOf(copilotRun)).sort(), ["staged.patch", "unstaged.patch", "untracked.md"]);
    assert.match(patchesOf(copilotRun)["unstaged.patch"].toString("utf8"), /\+c\.txt v2/);
    assert.ok(copilotRun.prompt.includes(`## Patch Files\n\n- ${path.join(patchDir, "staged.patch")}\n`));
    assert.match(copilotRun.prompt, /Read the patch files listed below with the view tool/);
    assert.deepEqual(findPatchDirs(dataDir), [], behavior);
  }
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

test("SessionEnd still closes the session and stops a job whose job file cannot be written", async () => {
  const tasks = setUpTasks();
  await withCompanionEnv(tasks.env, async () => {
    const { cleanupSessionJobs } = await import(pathToFileURL(SESSION_HOOK).href);
    const { resolveJobFile, updateState } = await import("../plugins/copilot/scripts/lib/state.mjs");
    const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const sessionId = "unwritable-job-file";
    try {
      updateState(tasks.cwd, (state) => {
        state.jobs.unshift({ id: "task-unwritable", status: "running", jobClass: "task", sessionId, pid: worker.pid });
      });
      // A folder where the job file should be: no file can replace it.
      fs.mkdirSync(path.join(resolveJobFile(tasks.cwd, "task-unwritable"), "blocker"), { recursive: true });

      const started = Date.now();
      await cleanupSessionJobs(tasks.cwd, sessionId);

      // A job file that cannot be written gets only a short retry, not the state's 2 s.
      assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms`);
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
