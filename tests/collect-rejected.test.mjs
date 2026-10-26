import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { git, initGitRepo, makeTempDir, run } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, ".claude", "skills", "workflow-common", "collect-rejected.mjs");
const FORM = "rejected: <reviewer>: <finding>: <reason>";

function collect(cwd, args = ["7"]) {
  return run(process.execPath, [SCRIPT, ...args], { cwd, timeout: 30_000 });
}

// A repo whose origin/main is its first commit, as a ticket branch sees it.
function makeRepo({ originMain = true } = {}) {
  const repo = makeTempDir("collect-rejected-");
  initGitRepo(repo);
  git(repo, "commit", "--allow-empty", "-m", "base");
  if (originMain) {
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  }
  return repo;
}

// --cleanup=verbatim keeps the message byte for byte, so CR and trailing blank lines reach git.
function commit(repo, message) {
  const result = run("git", ["commit", "--allow-empty", "--cleanup=verbatim", "-F", "-"], { cwd: repo, input: message });
  assert.equal(result.status, 0, result.stderr);
  return git(repo, "rev-parse", "--short", "HEAD").trim();
}

const ROUND_1 = [
  "[#7] Address review round 1",
  "",
  "Fixed one finding.",
  "",
  "rejected: Codex: the lock leaks: the lock is freed in finally",
  "on every path.",
  "",
  "Co-Authored-By: Someone <someone@example.com>",
  ""
].join("\n");
const ROUND_2 = ["[#7] Address review round 2", "", "rejected: Copilot: wording: wording only, from round 3 on", ""].join(
  "\n"
);
// Newest first, as git log lists them; one blank line after each entry, as the awk it replaces printed.
const EXPECTED = [
  "rejected: Copilot: wording: wording only, from round 3 on",
  "",
  "rejected: Codex: the lock leaks: the lock is freed in finally",
  "on every path.",
  "",
  ""
].join("\n");

test("collect-rejected prints the entries of every round commit and exits 0", () => {
  const repo = makeRepo();
  commit(repo, ROUND_1);
  commit(repo, "[#7] Address review round 2\n");
  commit(repo, ROUND_2);
  const result = collect(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, EXPECTED);
});

test("collect-rejected reads a CRLF body as an LF body", () => {
  const repo = makeRepo();
  commit(repo, ROUND_1.replace(/\n/g, "\r\n"));
  commit(repo, ROUND_2.replace(/\n/g, "\r\n"));
  const result = collect(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, EXPECTED);
});

test("collect-rejected prints nothing when the round commits hold no entry", () => {
  const repo = makeRepo();
  commit(repo, "[#7] Address review round 1\n\nFixed the lock.\n");
  commit(repo, "[#7] Address review round 2\n\nrejected again for the same reasons (no new entry)\n");
  const result = collect(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("collect-rejected fails on a list-marked entry and names its commit", () => {
  const repo = makeRepo();
  const sha = commit(repo, "[#7] Address review round 1\n\n- rejected: x; y\n");
  const result = collect(repo);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(`${sha} "[#7] Address review round 1": "- rejected: x; y"`), result.stderr);
  assert.ok(result.stderr.includes(FORM), result.stderr);
});

test("collect-rejected prints nothing when a later commit holds a wrong-form entry", () => {
  const repo = makeRepo();
  const good = commit(repo, ROUND_1);
  const bad = commit(repo, "[#7] Address review round 2\n\n  rejected: Copilot: x: y\n");
  const result = collect(repo);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(bad), result.stderr);
  assert.ok(!result.stderr.includes(good), result.stderr);
});

for (const line of [
  "  rejected: a: b: c",
  "\trejected: a: b: c",
  "- rejected: a: b: c",
  "* rejected: a: b: c",
  "+ rejected: a: b: c",
  "1. rejected: a: b: c",
  "1) rejected: a: b: c",
  "- Rejected: a: b: c",
  "-rejected: a: b: c"
]) {
  test(`collect-rejected fails on the entry form ${JSON.stringify(line)}`, () => {
    const repo = makeRepo();
    commit(repo, `[#7] Address review round 1\n\n${line}\n`);
    const result = collect(repo);
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes(JSON.stringify(line)), result.stderr);
  });
}

test("collect-rejected fails on a wrong-form line inside a correct entry", () => {
  const repo = makeRepo();
  commit(repo, "[#7] Address review round 1\n\nrejected: a: b: c\n  - rejected: d: e: f\n");
  const result = collect(repo);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
});

test("collect-rejected neither flags nor prints a column-0 entry in another case", () => {
  const repo = makeRepo();
  commit(repo, "[#7] Address review round 1\n\nRejected: a: b: c\n");
  const result = collect(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("collect-rejected reads only first-parent round commits of this ticket", () => {
  const repo = makeRepo();
  commit(repo, "[#8] Address review round 1\n\nrejected: other ticket: x: y\n");
  commit(repo, "[#7] Fix the lock\n\nrejected: not a round commit: x: y\n");
  git(repo, "checkout", "-b", "side", "HEAD~2");
  commit(repo, "[#7] Address review round 1\n\nrejected: side branch: x: y\n");
  git(repo, "checkout", "main");
  git(repo, "merge", "--no-ff", "-m", "Merge side", "side");
  commit(repo, ROUND_2);
  const result = collect(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "rejected: Copilot: wording: wording only, from round 3 on\n\n");
});

for (const [name, args] of [
  ["no argument", []],
  ["0", ["0"]],
  ["01", ["01"]],
  ["abc", ["abc"]],
  ["+1", ["+1"]],
  [" 1", [" 1"]],
  ["an empty argument", [""]],
  ["two arguments", ["7", "8"]]
]) {
  test(`collect-rejected rejects ${name} before calling git`, () => {
    const result = collect(makeTempDir("collect-rejected-args-"), args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /usage: node collect-rejected\.mjs <issue number>/);
  });
}

test("collect-rejected exits 2 outside a git repo", () => {
  const result = collect(makeTempDir("collect-rejected-nogit-"));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^git failed: /);
});

test("collect-rejected exits 2 when origin/main is missing", () => {
  const repo = makeRepo({ originMain: false });
  const result = collect(repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^git failed: /);
});
