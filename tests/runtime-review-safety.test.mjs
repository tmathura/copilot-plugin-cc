// Changed from upstream codex-plugin-cc (Apache-2.0): split out of tests/runtime.test.mjs;
// the review tests run the Copilot companion against the fake copilot CLI.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEnv,
  installFakeCopilot,
  readFakeCopilotRuns,
  readFakeVersionPids
} from "./fake-copilot-fixture.mjs";
import { initGitRepo, makeTempDir } from "./helpers.mjs";
import {
  REVIEW_JSON,
  SCRIPT,
  addDirsOf,
  assertReadOnlyRun,
  findPatchDirs,
  git,
  isAlive,
  makeRepo,
  patchesOf,
  readJobs,
  runReview,
  snapshot,
  waitFor,
  writeFile
} from "./runtime-helpers.mjs";

const DIFF_ARGS = ["--binary", "--no-ext-diff", "--submodule=diff"];
// Raw bytes with no buffer limit, to compare with the patch files.
function gitBytes(repo, ...args) {
  const result = spawnSync("git", args, { cwd: repo, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}

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
