// Changed from upstream codex-plugin-cc (Apache-2.0): renamed for the copilot plugin; adds tests for
// a path with spaces, for git calls that start no hook or textconv program and write no index, and
// for a default branch that only the remote has.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  collectReviewContext,
  dropLinkedStatusLines,
  getWorkingTreeState,
  resolveReviewTarget,
  unquoteGitPath,
  writeReviewPatches
} from "../plugins/copilot/scripts/lib/git.mjs";
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

test("a clone with no origin/HEAD and no local default branch reviews against origin/main", () => {
  const clone = cloneFeature(makeOriginWithFeature());
  git(clone, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");

  const target = resolveReviewTarget(clone, {});

  assert.equal(target.baseRef, "origin/main");
  assert.equal(target.label, "branch diff against origin/main");
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

// A junction needs no extra rights on Windows; elsewhere git lists a folder link as one entry.
const FOLDER_LINK = process.platform === "win32" ? "junction" : "dir";

// The inline context, the lightweight context and the untracked.md patch file, joined.
function untrackedOutputs(cwd) {
  const target = resolveReviewTarget(cwd, {});
  const lightweight = collectReviewContext(cwd, target, { maxInlineFiles: 0 });
  const dir = makeTempDir();
  writeReviewPatches(lightweight, dir);
  return [
    collectReviewContext(cwd, target).content,
    lightweight.content,
    fs.readFileSync(path.join(dir, "untracked.md"), "utf8")
  ];
}

test("an untracked file behind a folder link or junction that leads outside the repo or into .git is not read", () => {
  const base = makeTempDir();
  const cwd = path.join(base, "repo");
  const outside = path.join(base, "outside");
  // A sibling whose name starts with the repo's name is still outside it.
  const sibling = path.join(base, "repo2");
  for (const dir of [cwd, outside, sibling, path.join(cwd, "sub"), path.join(cwd, "inner")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(outside, "key.txt"), "SECRET_OUTSIDE_MARKER\n");
  fs.writeFileSync(path.join(sibling, "key.txt"), "SECRET_SIBLING_MARKER\n");
  initGitRepo(cwd);
  // The repo's .git/config can hold a token, as in a remote URL.
  run("git", ["config", "review.marker", "SECRET_GIT_MARKER"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "sub", "plain.txt"), "PLAIN_INSIDE\n");
  fs.writeFileSync(path.join(cwd, "..notes.txt"), "DOTS_INSIDE\n");
  // Names that only start with ".git" are not the .git folder.
  fs.mkdirSync(path.join(cwd, ".github"));
  fs.writeFileSync(path.join(cwd, ".github", "ci.yml"), "GITHUB_INSIDE\n");
  fs.writeFileSync(path.join(cwd, ".gitattributes"), "GITATTRIBUTES_INSIDE\n");
  fs.writeFileSync(path.join(cwd, "inner", "ok.txt"), "INNER_INSIDE\n");
  fs.symlinkSync(outside, path.join(cwd, "linkdir"), FOLDER_LINK);
  fs.symlinkSync(outside, path.join(cwd, "sub", "linkdir"), FOLDER_LINK);
  fs.symlinkSync(sibling, path.join(cwd, "siblink"), FOLDER_LINK);
  fs.symlinkSync(path.join(cwd, "inner"), path.join(cwd, "innerlink"), FOLDER_LINK);
  fs.symlinkSync(path.join(cwd, ".git"), path.join(cwd, "gitlink"), FOLDER_LINK);

  for (const output of untrackedOutputs(cwd)) {
    assert.doesNotMatch(output, /SECRET_OUTSIDE_MARKER|SECRET_SIBLING_MARKER|SECRET_GIT_MARKER/);
    assert.match(output, /PLAIN_INSIDE/);
    assert.match(output, /DOTS_INSIDE/);
    assert.match(output, /GITHUB_INSIDE/);
    assert.match(output, /GITATTRIBUTES_INSIDE/);
    assert.match(output, /INNER_INSIDE/);
    // Git for Windows lists the files behind a junction; each becomes the junction itself.
    for (const link of ["linkdir", "sub/linkdir", "siblink", "gitlink", "innerlink"]) {
      assert.match(output, new RegExp(`### ${link}\\n\\(skipped: symlink\\)`), link);
      assert.doesNotMatch(output, new RegExp(`(### |\\?\\? )${link}/`), link);
    }
  }
});

// Each mock matches one path and passes every other path to the real function.
function mockRealpath(t, match, answer) {
  const native = fs.realpathSync.native;
  t.mock.method(fs.realpathSync, "native", (filePath, ...rest) =>
    path.resolve(String(filePath)) === path.resolve(match) ? answer() : native(filePath, ...rest)
  );
}

// The paths match git's root, which the code uses: a temp folder can differ from it (/var is
// /private/var on macOS).
function makeRepoWithUntrackedFile() {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "plain.txt"), "SECRET_MOCKED_MARKER\n");
  const root = git(cwd, "rev-parse", "--show-toplevel").trim();
  return { cwd, root, file: path.join(root, "plain.txt") };
}

test("an untracked file whose real path is outside the repo is skipped as a symlink", (t) => {
  const { cwd, file } = makeRepoWithUntrackedFile();
  mockRealpath(t, file, () => path.join(makeTempDir(), "plain.txt"));

  for (const output of untrackedOutputs(cwd)) {
    assert.match(output, /### plain\.txt\n\(skipped: symlink\)/);
    assert.doesNotMatch(output, /SECRET_MOCKED_MARKER/);
  }
});

test("an untracked file whose real path is in a .git folder, in any case, is skipped as a symlink", (t) => {
  for (const folder of [".git", ".GIT", path.join("vendor", "lib", ".git")]) {
    const { cwd, root, file } = makeRepoWithUntrackedFile();
    mockRealpath(t, file, () => path.join(fs.realpathSync.native(root), folder, "config"));

    for (const output of untrackedOutputs(cwd)) {
      assert.match(output, /### plain\.txt\n\(skipped: symlink\)/, folder);
      assert.doesNotMatch(output, /SECRET_MOCKED_MARKER/);
    }
    t.mock.restoreAll();
  }
});

test(
  "an untracked file whose real path is on another drive is skipped as a symlink",
  { skip: process.platform !== "win32" && "only Windows has drive letters" },
  (t) => {
    const { cwd, file } = makeRepoWithUntrackedFile();
    const otherDrive = path.parse(fs.realpathSync.native(cwd)).root.startsWith("Z") ? "Y:\\" : "Z:\\";
    mockRealpath(t, file, () => `${otherDrive}elsewhere\\plain.txt`);

    for (const output of untrackedOutputs(cwd)) {
      assert.match(output, /### plain\.txt\n\(skipped: symlink\)/);
      assert.doesNotMatch(output, /SECRET_MOCKED_MARKER/);
    }
  }
);

for (const which of ["the file", "the repo root"]) {
  test(`an untracked file whose real path cannot be read for ${which} is skipped as unreadable`, (t) => {
    const { cwd, root, file } = makeRepoWithUntrackedFile();
    mockRealpath(t, which === "the file" ? file : root, () => {
      throw Object.assign(new Error("no such file"), { code: "ENOENT" });
    });

    for (const output of untrackedOutputs(cwd)) {
      assert.match(output, /### plain\.txt\n\(skipped: broken symlink or unreadable file\)/);
      assert.doesNotMatch(output, /SECRET_MOCKED_MARKER/);
    }
  });
}

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

// A repo whose root is spelled as git prints it, which the code uses (/private/var on macOS).
function makeLinkRepo() {
  const base = makeTempDir();
  const repo = path.join(base, "repo");
  fs.mkdirSync(repo);
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  const root = git(repo, "rev-parse", "--show-toplevel").trim();
  return { base, root };
}

function untrackedNamesInStatus(content) {
  const status = content.split("## Git Status\n\n")[1].split("\n## ")[0];
  return status.split("\n").filter((line) => line.startsWith("?? "));
}

test("a junction or folder link to a git-ignored folder in the repo leaks no name or text", () => {
  const { root } = makeLinkRepo();
  fs.writeFileSync(path.join(root, ".gitignore"), "secrets/\n");
  run("git", ["add", ".gitignore"], { cwd: root });
  run("git", ["commit", "-m", "ignore"], { cwd: root });
  fs.mkdirSync(path.join(root, "secrets"));
  fs.writeFileSync(path.join(root, "secrets", "key.txt"), "SECRET_IGNORED_MARKER\n");
  fs.symlinkSync(path.join(root, "secrets"), path.join(root, "seclink"), FOLDER_LINK);

  for (const output of untrackedOutputs(root)) {
    assert.doesNotMatch(output, /SECRET_IGNORED_MARKER|seclink\/|secrets\//);
    assert.match(output, /### seclink\n\(skipped: symlink\)/);
  }
});

test("each untracked path behind a link becomes the link once, in the state, Git Status and the count", () => {
  const { base, root } = makeLinkRepo();
  const outside = path.join(base, "outside");
  fs.mkdirSync(path.join(outside, "sub"), { recursive: true });
  for (const file of ["a.txt", "b.txt", path.join("sub", "c.txt")]) {
    fs.writeFileSync(path.join(outside, file), "OUTSIDE\n");
  }
  // A folder behind a link that holds another link.
  const deep = path.join(base, "deep");
  fs.mkdirSync(deep);
  fs.symlinkSync(outside, path.join(deep, "inner"), FOLDER_LINK);
  fs.writeFileSync(path.join(root, "plain.txt"), "PLAIN_INSIDE\n");
  fs.mkdirSync(path.join(root, "newdir"));
  fs.writeFileSync(path.join(root, "newdir", "f.txt"), "NEWDIR_INSIDE\n");
  fs.writeFileSync(path.join(root, "app.js"), "console.log('v2');\n");
  const links = ["link dir", "multi", "outer", "lïnk"];
  fs.symlinkSync(outside, path.join(root, "multi"), FOLDER_LINK);
  fs.symlinkSync(outside, path.join(root, "link dir"), FOLDER_LINK);
  fs.symlinkSync(outside, path.join(root, "lïnk"), FOLDER_LINK);
  fs.symlinkSync(deep, path.join(root, "outer"), FOLDER_LINK);

  const state = getWorkingTreeState(root);
  assert.deepEqual([...state.untracked].sort(), [...links, "newdir/f.txt", "plain.txt"].sort());
  // Git for Windows walks into a junction; elsewhere git lists the folder link as one entry.
  assert.deepEqual([...state.linkFolders].sort(), process.platform === "win32" ? [...links].sort() : []);

  const context = collectReviewContext(root, resolveReviewTarget(root, {}));
  assert.match(context.content, /## Git Status\n\n M app\.js\n/);
  for (const line of untrackedNamesInStatus(context.content)) {
    assert.doesNotMatch(line, /(multi|link dir|outer|lïnk)\//, line);
  }
  assert.match(context.content, /PLAIN_INSIDE/);
  assert.match(context.content, /NEWDIR_INSIDE/);
  assert.doesNotMatch(context.content, /OUTSIDE\n/);
  assert.equal(context.summary, "Reviewing 0 staged, 1 unstaged, and 6 untracked file(s).");
});

test("a nested repo stays one entry, and a link to a nested repo becomes the link", () => {
  const { base, root } = makeLinkRepo();
  fs.mkdirSync(path.join(root, "nested"));
  initGitRepo(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "nested", "n.txt"), "NESTED\n");
  const other = path.join(base, "other");
  fs.mkdirSync(other);
  initGitRepo(other);
  fs.writeFileSync(path.join(other, "o.txt"), "OTHER\n");
  fs.symlinkSync(other, path.join(root, "linkrepo"), FOLDER_LINK);

  const { untracked } = getWorkingTreeState(root);
  assert.ok(untracked.includes("nested/"), untracked.join(", "));
  assert.ok(untracked.includes("linkrepo"), untracked.join(", "));
  assert.ok(!untracked.some((file) => file.startsWith("linkrepo/")), untracked.join(", "));
});

test("a folder that cannot be checked counts as a link, and no name or text behind it is shown", (t) => {
  const { root } = makeLinkRepo();
  const inner = path.join(root, "outer", "inner");
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, "secret.txt"), "SECRET_UNCHECKED_MARKER\n");
  const quoted = process.platform === "win32" ? [] : ["a\tb.txt", 'q"x.txt'];
  for (const name of quoted) {
    fs.writeFileSync(path.join(inner, name), "SECRET_UNCHECKED_MARKER\n");
  }
  fs.writeFileSync(path.join(root, "outer", "ok.txt"), "OK_INSIDE\n");
  const native = fs.lstatSync;
  let hits = 0;
  t.mock.method(fs, "lstatSync", (file, ...rest) => {
    if (path.resolve(String(file)) === path.resolve(inner)) {
      hits += 1;
      throw Object.assign(new Error("EACCES: mocked"), { code: "EACCES" });
    }
    return native(file, ...rest);
  });

  const state = getWorkingTreeState(root);
  assert.ok(hits > 0);
  assert.deepEqual([...state.untracked].sort(), ["outer/inner", "outer/ok.txt"]);
  for (const output of untrackedOutputs(root)) {
    assert.match(output, /### outer\/inner\n\(skipped: broken symlink or unreadable file\)/);
    assert.doesNotMatch(output, /SECRET_UNCHECKED_MARKER|outer\/inner\/|"outer\/inner\//);
    assert.match(output, /OK_INSIDE/);
  }
});

test("a folder on many untracked paths is checked once", (t) => {
  const { root } = makeLinkRepo();
  const folder = path.join(root, "plainfolder");
  fs.mkdirSync(folder);
  for (const name of ["a.txt", "b.txt", "c.txt"]) {
    fs.writeFileSync(path.join(folder, name), "x\n");
  }
  const native = fs.lstatSync;
  let hits = 0;
  t.mock.method(fs, "lstatSync", (file, ...rest) => {
    if (path.resolve(String(file)) === path.resolve(folder)) {
      hits += 1;
    }
    return native(file, ...rest);
  });

  getWorkingTreeState(root);
  assert.equal(hits, 1);
});

test("unquoteGitPath reads back each untracked name that git status prints", () => {
  const { root } = makeLinkRepo();
  const names = ["a b.txt", "café.txt"];
  if (process.platform !== "win32") {
    names.push("t\tab.txt", "new\nline.txt", 'q"uote.txt', "back\\slash.txt", "c\u0001.txt", "d\u007f.txt");
  }
  for (const name of names) {
    fs.writeFileSync(path.join(root, name), "x\n");
  }
  const listed = git(root, "ls-files", "-z", "--others", "--exclude-standard").split("\0").filter(Boolean);
  const status = git(root, "-c", "core.quotePath=false", "status", "--short", "--untracked-files=all");
  const read = status
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => unquoteGitPath(line.slice(3)));
  assert.deepEqual(read.sort(), listed.sort());
  assert.deepEqual(listed.sort(), [...names].sort());
});

test("unquoteGitPath reads git's escapes and never throws on a broken name", () => {
  assert.equal(unquoteGitPath('"a\\tb"'), "a\tb");
  assert.equal(unquoteGitPath('"caf\\303\\251"'), "café");
  assert.equal(unquoteGitPath('"a\\qb"'), "aqb");
  assert.equal(unquoteGitPath('"linkdir/x'), "linkdir/x");
  assert.equal(unquoteGitPath('"linkdir/\\377x"'), "linkdir/�x");
  assert.equal(unquoteGitPath("plain name.txt"), "plain name.txt");
});

test("dropLinkedStatusLines drops only the untracked lines under a link folder", () => {
  const status = [
    " M app.js",
    "?? linkdir/old.txt",
    // A file that the untracked listing never saw.
    "?? linkdir/new.txt",
    '?? "link dir/a b.txt"',
    '?? "linkdir/x',
    '?? "linkdir/\\qy"',
    '?? "other/\\qy"',
    "?? linkdir2.txt",
    "?? other/x.txt",
    ""
  ].join("\n");

  assert.equal(
    dropLinkedStatusLines(status, ["linkdir", "link dir"]),
    [" M app.js", '?? "other/\\qy"', "?? linkdir2.txt", "?? other/x.txt", ""].join("\n")
  );
  assert.equal(dropLinkedStatusLines(status, []), status);
});

test(
  "a tracked change under a junction stays in Git Status, and the untracked file beside it is gone",
  { skip: process.platform !== "win32" && "only Git for Windows walks into a folder link" },
  () => {
    const { base, root } = makeLinkRepo();
    fs.mkdirSync(path.join(root, "tracked"));
    fs.writeFileSync(path.join(root, "tracked", "file.txt"), "v1\n");
    run("git", ["add", "tracked/file.txt"], { cwd: root });
    run("git", ["commit", "-m", "tracked"], { cwd: root });
    const copy = path.join(base, "copy");
    fs.cpSync(path.join(root, "tracked"), copy, { recursive: true });
    fs.writeFileSync(path.join(copy, "file.txt"), "v2\n");
    fs.writeFileSync(path.join(copy, "new.txt"), "SECRET_NEW_MARKER\n");
    fs.rmSync(path.join(root, "tracked"), { recursive: true });
    fs.symlinkSync(copy, path.join(root, "tracked"), "junction");

    const context = collectReviewContext(root, resolveReviewTarget(root, {}));
    assert.match(context.content, /## Git Status\n\n M tracked\/file\.txt\n/);
    assert.doesNotMatch(context.content, /tracked\/new\.txt|SECRET_NEW_MARKER/);
    assert.match(context.content, /### tracked\n\(skipped: symlink\)/);
    assert.match(context.content, /\+v2/);
  }
);
