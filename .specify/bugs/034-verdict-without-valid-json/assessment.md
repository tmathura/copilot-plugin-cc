# Bug Assessment: An adversarial review sometimes ends with no verdict

- **Slug**: 034-verdict-without-valid-json
- **Created**: 2026-10-13
- **Source**: pasted text (issue #34 and its comment). Written by hand on 2026-10-13, after the fix merged in PR #42, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

Issue #34, "Get a verdict when a Copilot review ends without valid JSON" (2026-10-11):

> `/copilot:adversarial-review` sometimes ends with "Copilot did not return valid structured JSON" and no verdict. Codex makes its answer follow the review schema. Copilot has no such control: the plugin only asks for JSON in `plugins/copilot/prompts/adversarial-review.md` ("Return only valid JSON matching the provided schema.") and checks the answer afterwards in `copilot-companion.mjs`.
>
> Two runs on 2026-10-11 (Copilot plugin 1.0.1, Windows, branch review of PR #32) ended this way:
>
> 1. The last turn had no assistant message. The plugin keeps the last non-empty message (`assistant.message` in `scripts/lib/copilot.mjs`), so it showed an earlier one, "Need to check what setup prints.", as the raw output. The reasoning said Copilot would approve.
> 2. Copilot called a tool named `json` to return its answer. The read-only guard stopped the run: `Copilot started the tool "json", which a read-only run does not allow. The run was stopped.` The words "the provided schema" may make Copilot think a tool exists for this.

Comment (2026-10-12), examples collected: with the original prompt, 4 of 7 runs had no verdict (tool calls `bash`, `_` and `json`, and one answer that was not an object), plus the 2 runs above. With one extra line in the focus text ("Return your answer as JSON text in your final message; do not call any tool to return it."), 9 of 9 runs gave a valid verdict.

## Symptom

An adversarial review that Copilot finishes can end with no verdict: either Copilot calls a tool to return the JSON and the read-only guard stops the run, or its last turn has no message and the plugin shows an earlier message as the answer. Expected: a verdict, or a clear error that says why there is none.

## Reproduction

1. Run `/copilot:adversarial-review --wait` on a branch.
2. In some runs, Copilot calls a tool named `json` (or `_`, or `bash`), and the run stops.
3. In other runs, Copilot's last turn has only reasoning; the review shows an earlier message such as "Need to check what setup prints." and fails to parse.

The failure depends on the model, so it does not happen every time. The tests reproduce both forms with the fake Copilot CLI.

## Suspected Code Paths

At `839df3a`:

- `plugins/copilot/prompts/adversarial-review.md:49`: "Return only valid JSON matching the provided schema." "The provided schema" can read as a tool.
- `plugins/copilot/scripts/lib/copilot.mjs` `applyTurnEvent()`, case `assistant.message`: keeps the last non-empty message of the whole run in `lastAgentMessage`, across turns.
- `plugins/copilot/scripts/lib/copilot.mjs:466` `runCopilotTurn()`: returns that message as `finalMessage`.
- `plugins/copilot/scripts/copilot-companion.mjs:401` `executeReviewRun()`: parses `result.finalMessage` as the verdict.

## Root Cause Hypothesis

Two causes. The prompt does not say that the JSON must be plain text in the final message, so Copilot sometimes looks for a tool. And the adapter keeps the last message of any turn, so an empty last turn looks like an answer from an earlier turn. Confidence: medium at the time of the report (two runs); high after the 2026-10-12 examples.

## Proposed Remediation

**Preferred**: first, collect more examples (how often, and in which form). Then pick the smallest fix. The issue offered:
- change the prompt to ask for the JSON as plain text in the final message, with no tool call; or
- when the answer is not valid JSON, ask the same Copilot session once more for only the JSON.

Either fix changes a prompt or a flow from upstream, so add it to the README section "Differences from the Codex plugin".

**Files likely to change**:
- `plugins/copilot/prompts/adversarial-review.md`
- `plugins/copilot/scripts/copilot-companion.mjs`
- `plugins/copilot/scripts/lib/copilot.mjs`
- `tests/fake-copilot-fixture.mjs`
- `tests/runtime.test.mjs`
- `README.md`

**Tests to add or update**:
- With the fake Copilot CLI: a review that ends with no final message, and one that calls a `json` tool, give a verdict or a clear error.

## Risks & Considerations

- The failure depends on the model; a test can only check the prompt text and the handling of each form.
- A second request costs a premium request.
- `/copilot:review`, tasks and the review gate use the same adapter.

## Open Questions

- None left. The comment of 2026-10-12 records the examples and the fix chosen.

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #42, not only the plan above.

- I. Upstream parity: met. The prompt and the parsing depart from upstream for correctness (Copilot has no schema control), which Principle I allows, and the README lists it.
- II. Only reviewed code: met. The fix is written in this repo.
- III. Copilot CLI through documented interfaces: met. The adapter reads the documented JSON event stream (`assistant.turn_start`, `assistant.message`); all Copilot calls stay in `copilot.mjs`.
- IV. Safe by default: met. The read-only guard still stops a tool call; no permission is added.
- V. Cross-platform: met. CI runs the tests on Windows, macOS and Linux.
- VI. Tested: met. Broken or cut-off output is a Principle VI failure path; new fake CLI modes and tests cover it.
