// Changed from upstream codex-plugin-cc (Apache-2.0): split out of tests/runtime.test.mjs;
// the review tests run the Copilot companion against the fake copilot CLI.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEnv,
  installFakeCopilot,
  readFakeCopilotRuns,
  readFakeVersionPids
} from "./fake-copilot-fixture.mjs";
import { withReviewPatches } from "../plugins/copilot/scripts/copilot-companion.mjs";
import { collectReviewContext, resolveReviewTarget } from "../plugins/copilot/scripts/lib/git.mjs";
import { resolveJobPatchDir } from "../plugins/copilot/scripts/lib/state.mjs";
import { DIFF_ARGS, git, gitBytes, initGitRepo, makeTempDir } from "./helpers.mjs";
import {
  REVIEW_JSON,
  SCRIPT,
  addDirsOf,
  assertReadOnlyRun,
  findPatchDirs,
  isAlive,
  largeText,
  makeRepo,
  patchListEntry,
  patchesOf,
  readJobs,
  runReview,
  snapshot,
  waitFor,
  writeFile
} from "./runtime-helpers.mjs";

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
  assert.deepEqual(Object.keys(patches).sort(), [
    "staged-001.patch",
    "staged-002.patch",
    "staged-003.patch",
    "unstaged-001.patch",
    "unstaged-002.patch",
    "unstaged-003.patch",
    "untracked.md"
  ]);
  const join = (prefix) => Buffer.concat(["001", "002", "003"].map((number) => patches[`${prefix}-${number}.patch`]));
  assert.ok(join("staged").equals(gitBytes(repo, "diff", "--cached", ...DIFF_ARGS)));
  assert.ok(join("unstaged").equals(gitBytes(repo, "diff", ...DIFF_ARGS)));
  assert.ok(patches["staged-002.patch"].length > 1024 * 1024);
  assert.ok(patches["unstaged-003.patch"].includes(Buffer.from([0x2b, 0x63, 0x61, 0x66, 0xe9, 0x0a])));
  assert.match(patches["staged-001.patch"].toString("utf8"), /^diff --git a\/a\.txt b\/a\.txt\n[\s\S]*\+a\.txt STAGED_MARKER/);
  assert.match(patches["staged-002.patch"].toString("utf8"), /^diff --git a\/c\.txt b\/c\.txt\n[\s\S]*\+BIG_END\n$/);
  assert.match(patches["staged-003.patch"].toString("utf8"), /^diff --git a\/deleted\.txt b\/deleted\.txt\ndeleted file mode 100644\n[^\n]*\n--- a\/deleted\.txt/);
  assert.match(patches["unstaged-001.patch"].toString("utf8"), /-a\.txt STAGED_MARKER\n\+a\.txt UNSTAGED_MARKER/);
  assert.match(patches["untracked.md"].toString("utf8"), /### new\.txt\n```\nuntracked file\n```/);
  assert.match(runs[0].prompt, /lightweight summary/i);
  assert.match(runs[0].prompt, /Read every file listed below with the view tool/);
  assert.match(runs[0].prompt, /read each file to its last line, in line ranges where needed/);
  const entry = (name, label) => patchListEntry(patchDir, patches, name, label);
  assert.ok(
    runs[0].prompt.includes(
      [
        "## Patch Files",
        "",
        entry("staged-001.patch", "diff --git a/a.txt b/a.txt"),
        entry("staged-002.patch", "diff --git a/c.txt b/c.txt"),
        entry("staged-003.patch", "diff --git a/deleted.txt b/deleted.txt"),
        entry("unstaged-001.patch", "diff --git a/a.txt b/a.txt"),
        entry("unstaged-002.patch", "diff --git a/b.txt b/b.txt"),
        entry("unstaged-003.patch", "diff --git a/latin1.txt b/latin1.txt"),
        entry("untracked.md", "untracked files"),
        ""
      ].join("\n")
    ),
    runs[0].prompt
  );
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
      for (const name of ["a.txt", "b.txt"]) {
        writeFile(repo, name, `${name} v2\n`);
      }
      writeFile(repo, "c.txt", largeText("c.txt v2"));
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

test("above the inline limit, a branch review gets one patch per changed file, without local edits", () => {
  const repo = makeTempDir();
  initGitRepo(repo);
  for (const name of ["a.txt", "b.txt", "c.txt"]) {
    writeFile(repo, name, `${name} v1\n`);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "checkout", "-q", "-b", "feature");
  writeFile(repo, "a.txt", "a.txt BRANCH_MARKER\n");
  writeFile(repo, "c.txt", largeText("c.txt BRANCH_MARKER"));
  git(repo, "mv", "b.txt", "renamed.txt");
  git(repo, "commit", "-qam", "change");
  writeFile(repo, "a.txt", "a.txt LOCAL_MARKER\n");

  const { result, runs } = runReview("review", repo, { args: ["--base", "main"] });

  assert.equal(result.status, 0, result.stderr);
  const [patchDir] = addDirsOf(runs[0]);
  assert.equal(fs.existsSync(patchDir), false);
  const patches = patchesOf(runs[0]);
  assert.deepEqual(Object.keys(patches).sort(), ["branch-001.patch", "branch-002.patch", "branch-003.patch"]);
  const mergeBase = git(repo, "merge-base", "HEAD", "main").trim();
  const joined = Buffer.concat(Object.keys(patches).sort().map((name) => patches[name]));
  assert.ok(joined.equals(gitBytes(repo, "diff", ...DIFF_ARGS, `${mergeBase}..HEAD`)));
  assert.match(patches["branch-002.patch"].toString("utf8"), /^diff --git a\/c\.txt b\/c\.txt\n[\s\S]*\+c\.txt BRANCH_MARKER\n/);
  // The rename is one patch with both names.
  assert.match(patches["branch-003.patch"].toString("utf8"), /^diff --git a\/b\.txt b\/renamed\.txt\nsimilarity index 100%\nrename from b\.txt\nrename to renamed\.txt\n$/);
  assert.doesNotMatch(joined.toString("utf8"), /LOCAL_MARKER/);
  assert.ok(runs[0].prompt.includes(`- ${path.join(patchDir, "branch-003.patch")} (4 lines): diff --git a/b.txt b/renamed.txt\n`));
  assert.doesNotMatch(runs[0].prompt, /LOCAL_MARKER/);
});

test("a patch file that cannot be written stops the review before Copilot starts and removes the folder", async (t) => {
  const repo = makeTempDir();
  initGitRepo(repo);
  for (const name of ["a.txt", "b.txt"]) {
    writeFile(repo, name, `${name} v1\n`);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  for (const name of ["a.txt", "b.txt"]) {
    writeFile(repo, name, `${name} v2\n`);
  }
  const workspaceRoot = makeTempDir();
  // tests/helpers.mjs removes the companion's own data folder export, so this one is used.
  const previousDataDir = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = makeTempDir();
  t.after(() => {
    if (previousDataDir === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousDataDir;
    }
  });
  const patchDir = resolveJobPatchDir(workspaceRoot, "review-write-fail");
  const context = collectReviewContext(repo, resolveReviewTarget(repo, {}), { maxInlineFiles: 0 });
  const writeFileSync = fs.writeFileSync;
  let patchWrites = 0;
  t.mock.method(fs, "writeFileSync", (file, ...rest) => {
    if (String(file).endsWith(".patch") && ++patchWrites === 2) {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    }
    return writeFileSync(file, ...rest);
  });
  let started = false;

  await assert.rejects(
    withReviewPatches(context, { workspaceRoot, jobId: "review-write-fail" }, () => {
      started = true;
    }),
    /disk full/
  );

  assert.equal(patchWrites, 2);
  assert.equal(started, false);
  assert.equal(fs.existsSync(patchDir), false);
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
  writeFile(repo, "a.txt", largeText("a.txt v2"));
  for (const name of names.slice(1)) {
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
