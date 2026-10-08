import test from "node:test";
import assert from "node:assert/strict";

import { run } from "./helpers.mjs";

test("run passes spaces and shell characters to the child unchanged", () => {
  const args = ["a b", "x&y", "c^d", "p|q", "s;t", "$HOME", "%PATH%", "say \"hi\""];

  const result = run("node", ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
});
