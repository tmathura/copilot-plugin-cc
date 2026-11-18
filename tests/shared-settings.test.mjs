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
    "First, if .claude/skills/workflow-common/RELEASE.md does not exist in the current checkout, the checkout is from before the workflow reference was split.",
    "Its REFERENCE.md then holds every section: where a rule below names REVIEW-LOOP.md, PR-REVIEW-LOOP.md, RELEASE.md or BUG-TRIAGE.md, read that section in REFERENCE.md.",
    "1. Read again .claude/skills/workflow-common/REFERENCE.md, the files next to it that the step you are on names (REVIEW-LOOP.md, PR-REVIEW-LOOP.md, RELEASE.md, BUG-TRIAGE.md), the SKILL.md of the skill whose step you are on,",
    "Under workflow-auto, it always includes .claude/skills/workflow-auto/SKILL.md, .claude/skills/workflow-manual/SKILL.md and .claude/skills/workflow-common/RELEASE.md.",
    "Before you run a check again, read the file that holds its rules: BUG-TRIAGE.md for a Spec Kit bug check, REVIEW-LOOP.md or PR-REVIEW-LOOP.md for a reviewer.",
    "the SKILL.md of each workflow skill that called it",
    "For a step skill that workflow-manual called, that includes .claude/skills/workflow-manual/SKILL.md.",
    "2. Read again the scratchpad files",
    "is not its output: run the check again.",
    "When /speckit-bug-test then asks to overwrite test.md, confirm it.",
    "For a release run step, the release run record is the proof, not the summary: do not run a step again because of the summary, and go on from the record as \"Record\" under \"Release run\" in RELEASE.md says."
  ]) {
    assert.ok(text.includes(part), `missing: ${part}`);
  }
});
