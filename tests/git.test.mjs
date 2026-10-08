// Changed from upstream codex-plugin-cc (Apache-2.0): renamed for the copilot plugin; adds tests for
// a path with spaces, and for git calls that start no hook or textconv program and write no index.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { collectReviewContext, resolveReviewTarget } from "../plugins/copilot/scripts/lib/git.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";

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

test("collectReviewContext falls back to lightweight context for larger adversarial reviews", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  for (const name of ["a.js", "b.js", "c.js"]) {
    fs.writeFileSync(path.join(cwd, name), `export const value = "${name}-v1";\n`);
  }
  run("git", ["add", "a.js", "b.js", "c.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "a.js"), 'export const value = "SELF_COLLECT_MARKER_A";\n');
  fs.writeFileSync(path.join(cwd, "b.js"), 'export const value = "SELF_COLLECT_MARKER_B";\n');
  fs.writeFileSync(path.join(cwd, "c.js"), 'export const value = "SELF_COLLECT_MARKER_C";\n');

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(context.inputMode, "self-collect");
  assert.equal(context.fileCount, 3);
  assert.match(context.collectionGuidance, /lightweight summary/i);
  assert.match(context.collectionGuidance, /patch files listed below with the view tool/i);
  assert.doesNotMatch(context.content, /SELF_COLLECT_MARKER_[ABC]/);
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
  const context = collectReviewContext(cwd, target);

  assert.equal(context.inputMode, "self-collect");
  assert.equal(context.fileCount, 3);
  assert.doesNotMatch(context.content, /TRACKED_MARKER_[AB]/);
  assert.match(context.content, /## Untracked Files/);
  assert.match(context.content, /UNTRACKED_RISK_MARKER/);
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
  assert.equal(fs.realpathSync(context.repoRoot), fs.realpathSync(cwd));
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
