import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, ".claude", "skills", "cpcc-workflow-common", "poll-reviews.mjs");
const SHA = "a".repeat(40);

// The checks run before any gh call; the timeout stops a regression from polling GitHub in CI.
function poll(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 10_000, windowsHide: true });
}

for (const [name, args] of [
  ["no arguments", []],
  ["a short sha", ["abc1234", "56"]],
  ["a pr of 0", [SHA, "0"]],
  ["a pr with a leading zero", [SHA, "056"]],
  ["a non-numeric tries", [SHA, "56", "many"]],
  ["a negative interval", [SHA, "56", "60", "-1"]]
]) {
  test(`poll-reviews rejects ${name} before calling gh`, () => {
    const result = poll(args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /usage: node poll-reviews\.mjs <40-character head sha>/);
  });
}
