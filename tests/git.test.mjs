// Changed from upstream codex-plugin-cc (Apache-2.0): renamed for the copilot plugin; adds tests for
// a path with spaces, for git calls that start no hook or textconv program and write no index, and
// for a default branch that only the remote has.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { collectReviewContext, getWorkingTreeState, resolveReviewTarget, writeReviewPatches } from "../plugins/copilot/scripts/lib/git.mjs";
import { DIFF_ARGS, countLines, git, gitBytes, initGitRepo, makeTempDir, run } from "./helpers.mjs";

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// Git runs these values through its own shell, so the path is quoted with forward slashes.
function nodeCommand(scriptPath) {
  return `"${process.execPath.replace(/\\/g, "/")}" "${scriptPath.replace(/\\/g, "/")}"`;
}

test("resolveReviewTarget prefers working tree when repo is dirty", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");

  const target = resolveReviewTarget(cwd, {});

  assert.equal(target.mode, "working-tree");
});

test("resolveReviewTarget falls back to branch diff when repo is clean", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["checkout", "-b", "feature/test"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "change"], { cwd });

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(target.mode, "branch");
  assert.match(target.label, /main/);
  assert.match(context.content, /Branch Diff/);
});

test("default branch names with special characters are passed to git literally", () => {
  const cwd = makeTempDir();
  const branchName = "main&branch-helper&x";
  const helperOutputPath = path.join(cwd, "branch-helper-output");
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "branch-helper.cmd"), "@echo branch-helper>branch-helper-output\r\n");
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('base');\n");
  run("git", ["add", "app.js", "branch-helper.cmd"], { cwd });
  run("git", ["commit", "-m", "base"], { cwd });
  run("git", ["branch", "-m", branchName], { cwd, shell: false });
  run("git", ["update-ref", `refs/remotes/origin/${branchName}`, branchName], { cwd, shell: false });
  run("git", ["symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${branchName}`], {
    cwd,
    shell: false
  });
  run("git", ["checkout", "-b", "feature/test"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('feature');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "feature"], { cwd });

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, branchName);
  assert.match(context.content, /Branch Diff/);
  assert.equal(fs.existsSync(helperOutputPath), false);
});

test("a default branch name with special characters is passed to git literally when only the remote has it", () => {
  const cwd = makeTempDir();
  const branchName = "main&branch-helper&x";
  const helperOutputPath = path.join(cwd, "branch-helper-output");
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "branch-helper.cmd"), "@echo branch-helper>branch-helper-output\r\n");
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('base');\n");
  run("git", ["add", "app.js", "branch-helper.cmd"], { cwd });
  run("git", ["commit", "-m", "base"], { cwd });
  run("git", ["branch", "-m", branchName], { cwd });
  run("git", ["update-ref", `refs/remotes/origin/${branchName}`, branchName], { cwd });
  run("git", ["symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${branchName}`], { cwd });
  run("git", ["checkout", "-b", "feature/test"], { cwd });
  git(cwd, "branch", "-D", branchName);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('feature');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "feature"], { cwd });

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(target.baseRef, `origin/${branchName}`);
  assert.match(context.content, /Branch Diff/);
  assert.equal(fs.existsSync(helperOutputPath), false);
});

// A repo with main and one more commit on feature, with main checked out, so a clone's origin/HEAD is origin/main.
function makeOriginWithFeature() {
  const origin = makeTempDir();
  initGitRepo(origin);
  fs.writeFileSync(path.join(origin, "app.js"), "console.log('base');\n");
  git(origin, "add", "app.js");
  git(origin, "commit", "-m", "base");
  git(origin, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(origin, "app.js"), "console.log('feature');\n");
  git(origin, "commit", "-am", "feature");
  git(origin, "checkout", "main");
  return origin;
}

function cloneFeature(origin, ...options) {
  const clone = path.join(makeTempDir(), "clone");
  git(origin, "clone", ...options, "-b", "feature", origin, clone);
  return clone;
}

function hasRef(repo, ref) {
  return run("git", ["show-ref", "--verify", "--quiet", ref], { cwd: repo }).status === 0;
}

function assertRemoteOnlyMain(clone) {
  assert.equal(git(clone, "symbolic-ref", "refs/remotes/origin/HEAD").trim(), "refs/remotes/origin/main");
  assert.equal(hasRef(clone, "refs/remotes/origin/main"), true);
  assert.equal(hasRef(clone, "refs/heads/main"), false);
  for (const scope of [undefined, "branch"]) {
    const target = resolveReviewTarget(clone, { scope });
    assert.equal(target.baseRef, "origin/main");
    assert.equal(target.label, "branch diff against origin/main");
    assert.match(collectReviewContext(clone, target).content, /console\.log\('feature'\)/);
  }
}

test("a branch review in a clone with no local default branch runs against origin/<name>", () => {
  assertRemoteOnlyMain(cloneFeature(makeOriginWithFeature()));
});

test("a branch review in a single-branch clone runs against origin/<name> once the default branch is fetched", () => {
  const clone = cloneFeature(makeOriginWithFeature(), "--single-branch");
  git(clone, "fetch", "origin", "main:refs/remotes/origin/main");
  git(clone, "remote", "set-head", "origin", "main");
  assertRemoteOnlyMain(clone);
});

test("a clone with a local default branch still reviews against <name>", () => {
  const clone = cloneFeature(makeOriginWithFeature());
  git(clone, "branch", "main", "origin/main");

  const target = resolveReviewTarget(clone, {});

  assert.equal(target.baseRef, "main");
  assert.equal(target.label, "branch diff against main");
  assert.match(collectReviewContext(clone, target).content, /console\.log\('feature'\)/);
});

// Today's failure, kept on purpose: an origin/HEAD that points at a missing ref is not a usable base.
test("an origin/HEAD that points at a missing ref gives origin/<name> and fails at merge-base", () => {
  const clone = cloneFeature(makeOriginWithFeature());
  git(clone, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/gone");

  const target = resolveReviewTarget(clone, {});

  assert.equal(target.baseRef, "origin/gone");
  assert.throws(() => collectReviewContext(clone, target), /merge-base HEAD origin\/gone/);
});

test("resolveReviewTarget honors explicit base overrides", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["checkout", "-b", "feature/test"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "change"], { cwd });

  const target = resolveReviewTarget(cwd, { base: "main" });

  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "main");
});

test("resolveReviewTarget requires an explicit base when no default branch can be inferred", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["branch", "-m", "feature-only"], { cwd });

  assert.throws(
    () => resolveReviewTarget(cwd, {}),
    /Unable to detect the repository default branch\. Pass --base <ref> or use --scope working-tree\./
  );
});

test("collectReviewContext keeps inline diffs for tiny adversarial reviews", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('INLINE_MARKER');\n");

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(context.inputMode, "inline-diff");
  assert.equal(context.fileCount, 1);
  assert.match(context.collectionGuidance, /primary evidence/i);
  assert.match(context.content, /INLINE_MARKER/);
});

test("collectReviewContext skips untracked directories in working tree review", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });

  const nestedRepoDir = path.join(cwd, ".claude", "worktrees", "agent-test");
  fs.mkdirSync(nestedRepoDir, { recursive: true });
  initGitRepo(nestedRepoDir);

  const target = resolveReviewTarget(cwd, { scope: "working-tree" });
  const context = collectReviewContext(cwd, target);

  assert.match(context.content, /### \.claude\/worktrees\/agent-test\/\n\(skipped: directory\)/);
});

test("collectReviewContext skips broken untracked symlinks instead of crashing", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.symlinkSync("missing-target", path.join(cwd, "broken-link"));

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(target.mode, "working-tree");
  assert.match(context.content, /### broken-link/);
  assert.match(context.content, /skipped: broken symlink or unreadable file/i);
});

function makeThreeFileRepo() {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  // A line-ending warning on stderr would count toward a small byte limit.
  run("git", ["config", "core.autocrlf", "false"], { cwd });
  for (const name of ["a.js", "b.js", "c.js"]) {
    fs.writeFileSync(path.join(cwd, name), `export const value = "${name}-v1";\n`);
  }
  run("git", ["add", "a.js", "b.js", "c.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  return cwd;
}

function writeMarkers(cwd) {
  for (const letter of ["A", "B", "C"]) {
    fs.writeFileSync(path.join(cwd, `${letter.toLowerCase()}.js`), `export const value = "MARKER_${letter}";\n`);
  }
}

test("collectReviewContext puts the whole diff of 3 changed files inline, in the working tree and on a branch", () => {
  const cwd = makeThreeFileRepo();
  writeMarkers(cwd);
  const workingTree = collectReviewContext(cwd, resolveReviewTarget(cwd, {}));

  run("git", ["checkout", "-q", "-b", "feature"], { cwd });
  run("git", ["commit", "-qam", "change"], { cwd });
  const branch = collectReviewContext(cwd, resolveReviewTarget(cwd, { base: "main" }));

  for (const context of [workingTree, branch]) {
    assert.equal(context.inputMode, "inline-diff", context.mode);
    assert.equal(context.fileCount, 3, context.mode);
    assert.match(context.collectionGuidance, /primary evidence/);
    for (const letter of ["A", "B", "C"]) {
      assert.match(context.content, new RegExp(`\\+export const value = "MARKER_${letter}";`), context.mode);
    }
  }
});

test("collectReviewContext keeps a diff of exactly the byte limit inline, and not a diff one byte above it", () => {
  const cwd = makeThreeFileRepo();
  writeMarkers(cwd);
  const target = resolveReviewTarget(cwd, {});
  const { diffBytes } = collectReviewContext(cwd, target);

  assert.equal(collectReviewContext(cwd, target, { maxInlineDiffBytes: diffBytes }).inputMode, "inline-diff");
  assert.equal(collectReviewContext(cwd, target, { maxInlineDiffBytes: diffBytes - 1 }).inputMode, "self-collect");
});

test("collectReviewContext gives lightweight context above the file limit that a caller sets", () => {
  const cwd = makeThreeFileRepo();
  writeMarkers(cwd);

  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, {}), { maxInlineFiles: 2 });

  assert.equal(context.inputMode, "self-collect");
  assert.equal(context.fileCount, 3);
  assert.match(context.collectionGuidance, /lightweight summary/i);
  assert.match(context.collectionGuidance, /Read every file listed below with the view tool/);
  assert.match(context.collectionGuidance, /Each patch file holds the diff of one changed file, or git's one-line note on a merge conflict/);
  assert.doesNotMatch(context.content, /MARKER_[ABC]/);
  assert.match(context.content, /## Changed Files/);
});

test("collectReviewContext falls back to lightweight context for oversized single-file diffs", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "export const value = 'v1';\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), `export const value = '${"x".repeat(512)}';\n`);

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target, { maxInlineDiffBytes: 128 });

  assert.equal(context.fileCount, 1);
  assert.equal(context.inputMode, "self-collect");
  assert.ok(context.diffBytes > 128);
  assert.doesNotMatch(context.content, /xxx/);
  assert.match(context.content, /## Changed Files/);
});

test("collectReviewContext keeps the leading status column of an unstaged first line, inline and lightweight", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  for (const name of ["a.js", "b.js"]) {
    fs.writeFileSync(path.join(cwd, name), `export const value = "${name}-v1";\n`);
  }
  run("git", ["add", "a.js", "b.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "a.js"), 'export const value = "unstaged";\n');
  fs.writeFileSync(path.join(cwd, "b.js"), 'export const value = "staged";\n');
  run("git", ["add", "b.js"], { cwd });

  const target = resolveReviewTarget(cwd, {});
  for (const includeDiff of [true, false]) {
    const { content } = collectReviewContext(cwd, target, { includeDiff });

    assert.ok(content.includes("## Git Status\n\n M a.js\nM  b.js\n"), content);
    assert.ok(content.includes("## Untracked Files\n\n(none)\n"), content);
  }
});

test("collectReviewContext keeps trailing white space of the last name in the status and file lists", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "a.js"), "export const value = 1;\n");
  run("git", ["add", "a.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "z.js "), "export const value = 2;\n");

  const { content } = collectReviewContext(cwd, resolveReviewTarget(cwd, {}), { includeDiff: false });

  assert.ok(content.includes("## Git Status\n\n?? z.js \n\n"), content);
  assert.ok(content.includes("## Changed Files\n\nz.js \n\n"), content);
});

test("collectReviewContext keeps untracked file content in lightweight working tree context", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  for (const name of ["a.js", "b.js"]) {
    fs.writeFileSync(path.join(cwd, name), `export const value = "${name}-v1";\n`);
  }
  run("git", ["add", "a.js", "b.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "a.js"), 'export const value = "TRACKED_MARKER_A";\n');
  fs.writeFileSync(path.join(cwd, "b.js"), 'export const value = "TRACKED_MARKER_B";\n');
  fs.writeFileSync(path.join(cwd, "new-risk.js"), 'export const value = "UNTRACKED_RISK_MARKER";\n');

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target, { maxInlineFiles: 0 });

  assert.equal(context.inputMode, "self-collect");
  assert.equal(context.fileCount, 3);
  assert.doesNotMatch(context.content, /TRACKED_MARKER_[AB]/);
  assert.match(context.content, /## Untracked Files/);
  assert.match(context.content, /UNTRACKED_RISK_MARKER/);
});

test("collectReviewContext reads an untracked file whose name git would quote", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "a.js"), "export const value = 1;\n");
  run("git", ["add", "a.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "naïve café.js"), 'export const value = "QUOTED_NAME_MARKER";\n');

  const state = getWorkingTreeState(cwd);
  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, {}));

  assert.deepEqual(state.untracked, ["naïve café.js"]);
  assert.match(context.content, /### naïve café\.js\n```\nexport const value = "QUOTED_NAME_MARKER";\n```/);
});

test("collectReviewContext reads an untracked file whose name git would quote in lightweight context", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "a.js"), "export const value = 1;\n");
  run("git", ["add", "a.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "café.js"), 'export const value = "LIGHTWEIGHT_QUOTED_MARKER";\n');

  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, {}), { maxInlineFiles: 0 });

  assert.equal(context.inputMode, "self-collect");
  assert.deepEqual(context.changedFiles, ["café.js"]);
  assert.match(context.content, /### café\.js\n```\nexport const value = "LIGHTWEIGHT_QUOTED_MARKER";\n```/);
});

// A trailing no-break space on the last name checks that the name lists do not trim the unquoted name.
const QUOTED_NAMES = ["café.js", "café.js "];

test("collectReviewContext lists a staged and unstaged file whose name git would quote once, by its real name", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  for (const name of QUOTED_NAMES) {
    fs.writeFileSync(path.join(cwd, name), "export const value = 1;\n");
  }
  run("git", ["add", ...QUOTED_NAMES], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  for (const name of QUOTED_NAMES) {
    fs.writeFileSync(path.join(cwd, name), "export const value = 2;\n");
  }
  run("git", ["add", ...QUOTED_NAMES], { cwd });
  for (const name of QUOTED_NAMES) {
    fs.writeFileSync(path.join(cwd, name), "export const value = 3;\n");
  }

  const state = getWorkingTreeState(cwd);
  const lightweight = collectReviewContext(cwd, resolveReviewTarget(cwd, {}), { includeDiff: false });
  const inline = collectReviewContext(cwd, resolveReviewTarget(cwd, {}), { includeDiff: true });

  assert.deepEqual(state.staged.toSorted(), QUOTED_NAMES.toSorted());
  assert.deepEqual(state.unstaged.toSorted(), QUOTED_NAMES.toSorted());
  assert.equal(lightweight.fileCount, 2);
  assert.deepEqual(lightweight.changedFiles, QUOTED_NAMES.toSorted());
  assert.match(lightweight.content, /## Changed Files\n\ncafé\.js\n/);
  assert.match(inline.content, /^MM café\.js$/m);
  for (const name of QUOTED_NAMES) {
    assert.ok(inline.content.includes(`\ndiff --git a/${name} b/${name}\n`), name);
  }
  assert.doesNotMatch(inline.content, /\\303/);
});

test("collectReviewContext reads an untracked file with a tab in its name", { skip: process.platform === "win32" }, () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "a.js"), "export const value = 1;\n");
  run("git", ["add", "a.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "tab\tname.js"), 'export const value = "TAB_NAME_MARKER";\n');

  const state = getWorkingTreeState(cwd);
  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, {}));

  assert.deepEqual(state.untracked, ["tab\tname.js"]);
  assert.match(context.content, /TAB_NAME_MARKER/);
});

test("collectReviewContext lists branch files whose names git would quote by their real names", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "a.js"), "export const value = 1;\n");
  run("git", ["add", "a.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["checkout", "-b", "feature"], { cwd });
  for (const name of QUOTED_NAMES) {
    fs.writeFileSync(path.join(cwd, name), "export const value = 2;\n");
  }
  run("git", ["add", ...QUOTED_NAMES], { cwd });
  run("git", ["commit", "-m", "add"], { cwd });

  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, { base: "main" }), { includeDiff: false });

  assert.deepEqual(context.changedFiles, QUOTED_NAMES);
  assert.equal(context.fileCount, 2);
  assert.match(context.content, /## Changed Files\n\ncafé\.js\n/);
});

test("collectReviewContext never reads the target of an untracked symlink", () => {
  const secretDir = makeTempDir("copilot plugin secret ");
  const secretFile = path.join(secretDir, "id_key");
  fs.writeFileSync(secretFile, "SECRET_TARGET_MARKER\n");

  for (const extraFiles of [[], ["b.js", "c.js"]]) {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
    run("git", ["add", "app.js"], { cwd });
    run("git", ["commit", "-m", "init"], { cwd });
    for (const name of extraFiles) {
      fs.writeFileSync(path.join(cwd, name), "export {};\n");
    }
    fs.symlinkSync(secretFile, path.join(cwd, "linked-key"));

    const context = collectReviewContext(cwd, resolveReviewTarget(cwd, {}), extraFiles.length ? { maxInlineFiles: 2 } : {});

    assert.equal(context.inputMode, extraFiles.length ? "self-collect" : "inline-diff");
    assert.match(context.content, /### linked-key\n\(skipped: symlink\)/);
    assert.doesNotMatch(context.content, /SECRET_TARGET_MARKER/);
  }
});

test("collectReviewContext skips an untracked file that disappears while it is checked", (t) => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "vanishing.js"), "export {};\n");
  const lstatSync = fs.lstatSync;
  t.mock.method(fs, "lstatSync", (filePath, ...rest) => {
    if (String(filePath).endsWith("vanishing.js")) {
      throw Object.assign(new Error("no such file"), { code: "ENOENT" });
    }
    return lstatSync(filePath, ...rest);
  });

  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, {}));

  assert.match(context.content, /### vanishing\.js\n\(skipped: broken symlink or unreadable file\)/);
});

test("collectReviewContext works in a repository path with spaces and shell characters", () => {
  const cwd = makeTempDir("copilot plugin test & repo ");
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('SPACE_MARKER');\n");

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(target.mode, "working-tree");
  assert.equal(fs.realpathSync.native(context.repoRoot), fs.realpathSync.native(cwd));
  assert.equal(context.inputMode, "inline-diff");
  assert.match(context.content, /SPACE_MARKER/);
});

test("collectReviewContext starts no fsmonitor hook or textconv program", () => {
  const cwd = makeTempDir("copilot plugin test ");
  const toolsDir = makeTempDir("copilot plugin tools ");
  const fsmonitorMarker = path.join(toolsDir, "fsmonitor-ran");
  const textconvMarker = path.join(toolsDir, "textconv-ran");
  const fsmonitorHook = path.join(toolsDir, "fsmonitor.cjs");
  const textconv = path.join(toolsDir, "textconv.cjs");
  fs.writeFileSync(fsmonitorHook, `require("node:fs").writeFileSync(${JSON.stringify(fsmonitorMarker)}, "ran");\n`);
  fs.writeFileSync(
    textconv,
    `const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(textconvMarker)}, "ran");
process.stdout.write(fs.readFileSync(process.argv[2]));\n`
  );
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, ".gitattributes"), "*.txt diff=marker\n");
  fs.writeFileSync(path.join(cwd, "notes.txt"), "v1\n");
  run("git", ["add", ".gitattributes", "notes.txt"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["checkout", "-b", "feature/test"], { cwd });
  fs.writeFileSync(path.join(cwd, "notes.txt"), "v2\n");
  run("git", ["commit", "-am", "change"], { cwd });
  fs.writeFileSync(path.join(cwd, "notes.txt"), "v3\n");
  run("git", ["config", "core.fsmonitor", nodeCommand(fsmonitorHook)], { cwd });
  run("git", ["config", "diff.marker.textconv", nodeCommand(textconv)], { cwd });

  const workingTree = collectReviewContext(cwd, resolveReviewTarget(cwd, { scope: "working-tree" }));
  const branch = collectReviewContext(cwd, resolveReviewTarget(cwd, { base: "main" }));

  assert.match(workingTree.content, /\+v3/);
  assert.match(branch.content, /\+v2/);
  assert.equal(fs.existsSync(fsmonitorMarker), false, "fsmonitor hook ran");
  assert.equal(fs.existsSync(textconvMarker), false, "textconv program ran");

  run("git", ["status"], { cwd });
  run("git", ["diff"], { cwd });
  assert.equal(fs.existsSync(fsmonitorMarker), true, "plain git status runs the configured hook");
  assert.equal(fs.existsSync(textconvMarker), true, "plain git diff runs the configured textconv");
});

test("collectReviewContext leaves .git/index unchanged when cached file data is stale", () => {
  const cwd = makeTempDir("copilot plugin test ");
  initGitRepo(cwd);
  const filePath = path.join(cwd, "app.js");
  fs.writeFileSync(filePath, "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(filePath, "console.log('v2');\n");
  run("git", ["add", "app.js"], { cwd });
  const touchedAt = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(filePath, touchedAt, touchedAt);
  const indexFile = path.join(cwd, ".git", "index");
  const before = sha256File(indexFile);

  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, { scope: "working-tree" }));

  assert.equal(sha256File(indexFile), before);
  assert.match(context.summary, /1 staged, 0 unstaged/);
  run("git", ["status"], { cwd });
  assert.notEqual(sha256File(indexFile), before, "plain git status refreshes the stale index entry");
});

// The diff that writeReviewPatches splits, as raw bytes.
function diffBytes(cwd, ...args) {
  return gitBytes(cwd, "-c", "core.quotePath=false", "diff", ...DIFF_ARGS, ...args);
}

function readPatches(entries) {
  return Buffer.concat(entries.map(({ file }) => fs.readFileSync(file)));
}

// A branch with a changed submodule, an ordinary file after it, a binary file, CRLF lines and a file
// with no new line at its end. The submodule's own file is left modified in its working tree.
function makeSubmoduleRepo() {
  const sub = makeTempDir();
  initGitRepo(sub);
  fs.writeFileSync(path.join(sub, "inner.txt"), "inner v1\n");
  git(sub, "add", "inner.txt");
  git(sub, "commit", "-qm", "init");

  const cwd = makeTempDir();
  initGitRepo(cwd);
  git(cwd, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(cwd, "bin.dat"), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(cwd, "crlf.txt"), "one\r\ntwo\r\n");
  fs.writeFileSync(path.join(cwd, "nonl.txt"), "no end");
  fs.writeFileSync(path.join(cwd, "z.txt"), "z v1\n");
  git(cwd, "add", "bin.dat", "crlf.txt", "nonl.txt", "z.txt");
  git(cwd, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "sub");
  git(cwd, "commit", "-qm", "init");
  git(cwd, "checkout", "-q", "-b", "feature");

  const inner = path.join(cwd, "sub");
  initGitRepo(inner);
  fs.writeFileSync(path.join(inner, "inner.txt"), "inner v2\n");
  git(inner, "commit", "-qam", "change");
  fs.writeFileSync(path.join(cwd, "bin.dat"), Buffer.from([0, 9, 8, 7, 6]));
  fs.writeFileSync(path.join(cwd, "crlf.txt"), "one\r\nTWO\r\n");
  fs.writeFileSync(path.join(cwd, "nonl.txt"), "still no end");
  fs.writeFileSync(path.join(cwd, "z.txt"), "z v2\n");
  git(cwd, "add", "bin.dat", "crlf.txt", "nonl.txt", "sub", "z.txt");
  git(cwd, "commit", "-qm", "change");
  fs.writeFileSync(path.join(inner, "inner.txt"), "inner dirty\n");
  return cwd;
}

test("writeReviewPatches splits a branch diff into exact patches at each file and submodule header", () => {
  const cwd = makeSubmoduleRepo();
  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, { base: "main" }), { maxInlineFiles: 0 });
  const dir = makeTempDir();

  const entries = writeReviewPatches(context, dir);

  const mergeBase = git(cwd, "merge-base", "HEAD", "main").trim();
  assert.ok(readPatches(entries).equals(diffBytes(cwd, `${mergeBase}..HEAD`)));
  assert.ok(entries.every(({ file, lines }) => lines === countLines(fs.readFileSync(file, "latin1"))));
  const names = ["001", "002", "003", "004", "005", "006"].map((number) => `branch-${number}.patch`);
  assert.deepEqual(entries.map(({ file }) => path.basename(file)), names);
  assert.deepEqual(fs.readdirSync(dir).sort(), names);
  const labels = entries.map(({ label }) => label);
  assert.deepEqual(labels.slice(0, 3), ["diff --git a/bin.dat b/bin.dat", "diff --git a/crlf.txt b/crlf.txt", "diff --git a/nonl.txt b/nonl.txt"]);
  assert.match(labels[3], /^Submodule sub [0-9a-f]+\.\.[0-9a-f]+:$/);
  assert.equal(labels[4], "diff --git a/sub/inner.txt b/sub/inner.txt");
  assert.equal(labels[5], "diff --git a/z.txt b/z.txt");
  const [binary, crlf, noNewLine, submodule] = entries.map(({ file }) => fs.readFileSync(file, "latin1"));
  assert.match(binary, /GIT binary patch/);
  assert.match(crlf, /\+TWO\r\n/);
  assert.match(noNewLine, /\+still no end\n\\ No newline at end of file\n$/);
  assert.equal(submodule.split("\n").length, 2);
});

test("writeReviewPatches gives a dirty submodule line its own patch and writes no empty staged patch", () => {
  const cwd = makeSubmoduleRepo();
  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, { scope: "working-tree" }), { maxInlineFiles: 0 });
  const dir = makeTempDir();

  const entries = writeReviewPatches(context, dir);

  const patches = entries.filter(({ file }) => file.endsWith(".patch"));
  assert.ok(patches.every(({ file }) => path.basename(file).startsWith("unstaged-")));
  assert.ok(readPatches(patches).equals(diffBytes(cwd)));
  assert.ok(patches.some(({ label }) => label === "Submodule sub contains modified content"), JSON.stringify(entries));
  assert.ok(patches.every(({ label }) => /^(diff --git |Submodule )/.test(label)));
  assert.deepEqual(entries.at(-1), { file: path.join(dir, "untracked.md"), label: "untracked files", lines: 0 });
});

test("writeReviewPatches gives each file of an unresolved merge its own patch, staged and unstaged", () => {
  const cwd = makeThreeFileRepo();
  git(cwd, "checkout", "-qb", "other");
  writeMarkers(cwd);
  // The other side deletes c.js, a modify/delete conflict: the unstaged diff gives it no diff --cc header.
  git(cwd, "rm", "-qf", "c.js");
  git(cwd, "commit", "-qam", "other");
  git(cwd, "checkout", "-q", "main");
  for (const name of ["a.js", "b.js", "c.js"]) {
    fs.writeFileSync(path.join(cwd, name), `export const value = "main ${name}";\n`);
  }
  git(cwd, "commit", "-qam", "main");
  // --no-ff: a global merge.ff=only would stop the merge before it conflicts.
  run("git", ["merge", "--no-ff", "other"], { cwd });
  assert.notEqual(git(cwd, "ls-files", "-u"), "");
  // An edit to c.js, which our side still has, adds a diff --git patch after its note.
  fs.writeFileSync(path.join(cwd, "c.js"), 'export const value = "edited c.js";\n');
  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, { scope: "working-tree" }), { maxInlineFiles: 0 });

  const entries = writeReviewPatches(context, makeTempDir());

  const staged = entries.filter(({ file }) => path.basename(file).startsWith("staged-"));
  const unstaged = entries.filter(({ file }) => path.basename(file).startsWith("unstaged-"));
  assert.ok(readPatches(staged).equals(diffBytes(cwd, "--cached")));
  assert.ok(readPatches(unstaged).equals(diffBytes(cwd)));
  assert.deepEqual(
    staged.map(({ label }) => label),
    ["* Unmerged path a.js", "* Unmerged path b.js", "* Unmerged path c.js"]
  );
  assert.deepEqual(unstaged.map(({ label }) => label), [
    "diff --cc a.js",
    "diff --cc b.js",
    "* Unmerged path c.js",
    "diff --git a/c.js b/c.js"
  ]);
});

test("writeReviewPatches numbers 1000 patches with 4 digits, in diff order", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "base.txt"), "base\n");
  git(cwd, "add", "base.txt");
  git(cwd, "commit", "-qm", "init");
  git(cwd, "checkout", "-q", "-b", "feature");
  const names = Array.from({ length: 1000 }, (_, index) => `f${String(index).padStart(4, "0")}.txt`);
  for (const name of names) {
    fs.writeFileSync(path.join(cwd, name), `${name}\n`);
  }
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "many");
  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, { base: "main" }), { maxInlineFiles: 0 });

  const entries = writeReviewPatches(context, makeTempDir());

  assert.equal(entries.length, 1000);
  assert.equal(path.basename(entries[0].file), "branch-0001.patch");
  assert.equal(path.basename(entries[999].file), "branch-1000.patch");
  assert.deepEqual(entries.map(({ label }) => label), names.map((name) => `diff --git a/${name} b/${name}`));
});

test("writeReviewPatches throws when a patch file exists already", () => {
  const cwd = makeThreeFileRepo();
  writeMarkers(cwd);
  const context = collectReviewContext(cwd, resolveReviewTarget(cwd, {}), { maxInlineFiles: 0 });
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "unstaged-002.patch"), "left over\n");

  assert.throws(() => writeReviewPatches(context, dir), { code: "EEXIST" });
});
