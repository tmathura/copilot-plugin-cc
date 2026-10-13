# Bug Fix: An adversarial review sometimes ends with no verdict

- **Slug**: verdict-without-valid-json
- **Fixed**: 2026-10-12
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #42 (squash commit `c2552e6d91016204d4927add83d1b665ca63456f`), for #59.

## Summary

The prompt now asks for the JSON as plain text in the final message and says not to call a tool for it. The adversarial review parses only the message of Copilot's last turn; if that turn has none, the review fails with a clear error. Released as 1.0.6.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/prompts/adversarial-review.md` | modified | plain-text JSON in the final message; no tool |
| `plugins/copilot/scripts/lib/copilot.mjs` | modified | returns `lastTurnMessage` |
| `plugins/copilot/scripts/copilot-companion.mjs` | modified | parses `lastTurnMessage`; clear error for an empty last turn |
| `tests/fake-copilot-fixture.mjs` | modified | `no-final-message` mode; `FAKE_COPILOT_TOOL`, `FAKE_COPILOT_EARLIER` |
| `tests/runtime.test.mjs` | added tests | prompt text, empty last turn, earlier message, failed run, `json` tool |
| `README.md`, `docs/architecture.md` | modified | describe the change |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.6 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.6 |

## Diff Highlights (optional)

```diff
-Return only valid JSON matching the provided schema.
+Write your answer as plain text in your final message: only valid JSON that matches the schema in `<output_schema>`.
+Do not call a tool to return it, and do not end with a tool call or without that message.
```

```js
// An earlier message, such as "Need to check what setup prints.", is not the verdict.
let parsed = parseStructuredOutput(result.lastTurnMessage, {
  status: result.status,
  failureMessage:
    result.status === 0
      ? "Copilot ended its last turn without an answer, so the review has no verdict. Run the review again."
      : failureMessage
});
```

## Tests Added or Updated

- `tests/runtime.test.mjs` "an adversarial review asks for the JSON as plain text in the final message, not through a tool".
- `tests/runtime.test.mjs` "an adversarial review whose last turn has no answer fails with a clear error, not an earlier message".
- `tests/runtime.test.mjs` "an adversarial review takes the JSON from the last turn, after an earlier message".
- `tests/runtime.test.mjs` "an adversarial review whose run fails with an empty last turn reports the failure".
- `tests/runtime.test.mjs` "an adversarial review whose Copilot calls a json tool is stopped with a clear error".

## Local Verification

As recorded in PR #42:

- Commands run: `npm test` → 235 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass (Windows).
- Manual checks: on 2026-10-12, 9 of 9 real reviews gave a verdict when the focus text carried a similar instruction (issue comment). The merged prompt text itself was not tried on real reviews before the merge.

## Deviations from Assessment

- Both parts of the fix are used: the prompt change (the issue's first option) and a new rule that only the last turn counts, which the issue did not list. The retry option (ask the session again) is not used: a similar instruction in the focus text removed the failures in the 2026-10-12 runs (issue comment).
- A `json` tool call is not turned into a verdict. It still stops the run with the existing clear error, which meets "a verdict or a clear error".
- `/copilot:review`, tasks and the review gate are unchanged. In 28 real job logs, every JSON answer was in Copilot's last turn.

## Follow-ups

- None.
