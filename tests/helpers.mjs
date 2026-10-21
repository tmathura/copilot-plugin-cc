// Changed from upstream codex-plugin-cc (Apache-2.0): renamed for the copilot plugin; run() never
// uses a shell; test repositories run no background git maintenance.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// A Claude session with this plugin exports the companion's data folder. Tests use their own folders.
delete process.env.COPILOT_COMPANION_PLUGIN_DATA;

export function makeTempDir(prefix = "copilot-plugin-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o755 });
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    shell: false,
    timeout: options.timeout,
    windowsHide: true
  });
}

export function initGitRepo(cwd) {
  run("git", ["init", "-b", "main"], { cwd });
  run("git", ["config", "user.name", "Copilot Plugin Tests"], { cwd });
  run("git", ["config", "user.email", "tests@example.com"], { cwd });
  run("git", ["config", "commit.gpgsign", "false"], { cwd });
  run("git", ["config", "tag.gpgsign", "false"], { cwd });
  // A commit can start background maintenance, which writes in .git while a test reads it.
  run("git", ["config", "maintenance.auto", "false"], { cwd });
  run("git", ["config", "gc.auto", "0"], { cwd });
}

export function git(repo, ...args) {
  const result = run("git", args, { cwd: repo });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

// A last line with no new line still counts, as it does for the view tool.
export function countLines(text) {
  return text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export const DIFF_ARGS = ["--binary", "--no-ext-diff", "--submodule=diff"];
// Raw bytes with no buffer limit, to compare with the patch files.
export function gitBytes(repo, ...args) {
  const result = spawnSync("git", args, { cwd: repo, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}
