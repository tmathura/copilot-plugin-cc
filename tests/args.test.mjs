import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "../plugins/copilot/scripts/lib/args.mjs";

const config = { valueOptions: ["option"], booleanOptions: ["flag"], aliasMap: { x: "option" } };

test("a long option value keeps every equals sign after the first", () => {
  assert.deepEqual(parseArgs(["--option=a=b"], config).options, { option: "a=b" });
  assert.deepEqual(parseArgs(["--option=refs/x=y=="], config).options, { option: "refs/x=y==" });
});

test("a long option written with an empty inline value gives an empty string", () => {
  assert.deepEqual(parseArgs(["--option="], config).options, { option: "" });
});

test("flags, separate values, short aliases and -- keep their behaviour", () => {
  assert.deepEqual(parseArgs(["--flag"], config).options, { flag: true });
  assert.deepEqual(parseArgs(["--flag=false"], config).options, { flag: false });
  assert.deepEqual(parseArgs(["--flag=true"], config).options, { flag: true });
  assert.deepEqual(parseArgs(["--option", "a=b"], config).options, { option: "a=b" });
  assert.deepEqual(parseArgs(["-x", "value"], config).options, { option: "value" });
  assert.deepEqual(parseArgs(["--", "--option=a", "-x"], config), { options: {}, positionals: ["--option=a", "-x"] });
  assert.deepEqual(parseArgs(["--other=a=b", "word"], config), { options: {}, positionals: ["--other=a=b", "word"] });
  assert.throws(() => parseArgs(["--option"], config), /Missing value for --option/);
});
