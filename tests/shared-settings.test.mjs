import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"));
const START = "cat <<'EOF'\n";
const END = "\nEOF";

function compactHook() {
  const entries = settings.hooks.SessionStart.filter((entry) => entry.matcher === "compact");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hooks.length, 1);
  return entries[0].hooks[0];
}

test("the shared settings set the 400k compaction window", () => {
  assert.equal(settings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "400000");
});

test("the after-compaction hook is one quoted heredoc that nothing cuts short", () => {
  const hook = compactHook();
  assert.equal(hook.type, "command");
  assert.ok(hook.timeout > 0);
  assert.ok(hook.command.startsWith(START));
  assert.ok(hook.command.endsWith(END));
  const lines = hook.command.slice(START.length, -END.length).split("\n");
  // A body line equal to the end word would end the heredoc early, and the shell would run the rest.
  assert.ok(!lines.includes("EOF"));
  assert.ok(!hook.command.includes("\r"));
});

test("the after-compaction hook names the files to read again and the rule for checks", () => {
  const text = compactHook().command;
  for (const part of [
    ".claude/skills/workflow-common/REFERENCE.md",
    ".claude/skills/workflow-auto/SKILL.md",
    ".claude/skills/workflow-manual/SKILL.md",
    "<scratchpad>/workflow-auto-report.md",
    "If this session does not run workflow-auto, workflow-manual or a step skill that one of them calls, do nothing.",
    "only when you ran it after this compaction, or when the summary quotes its output",
    "Do this before you go on with the current step",
    "1. Read again .claude/skills/workflow-common/REFERENCE.md",
    "2. Read again the scratchpad files",
    "is not its output: run the check again.",
    "For a release run step, the proof is its result in the release run record, not the summary"
  ]) {
    assert.ok(text.includes(part), `missing: ${part}`);
  }
});
