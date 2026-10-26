# Bug Verification: Copilot JSON events with U+2028 or U+2029 are split and fail to parse

- **Slug**: 107-split-events-at-lf-only
- **Tested**: 2026-10-27
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

An event whose JSON string holds a raw U+2028 or U+2029 now reaches the event handler whole through
the real reader and a real child process, and the run succeeds. The not-JSON error, CRLF line ends
and the rest of the suite still work.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `node --test --test-name-pattern="raw U\+202" tests/prompt-mode.test.mjs` | pass | The assessment's input (one JSON event line with a raw separator, then LF) written by the fake Copilot through a pipe to `CopilotPromptModeClient`; one `assistant.message` with the exact text, no protocol error, exit 0 |
| Reproduction (pre-fix) | the same tests against the old `prompt-mode.mjs` | fail, as expected | U+2028, U+2029 and the lone-CR tests fail on the readline reader (recorded in `fix.md`) |
| New / updated tests | `node --test --test-name-pattern="raw U\+202\|CRLF line ends\|lone CR\|joined across chunks\|last line with no LF\|not JSON ends the run\|after the run has finished\|after a protocol error\|times out with part\|more than 1 MB" tests/prompt-mode.test.mjs` | pass | 11 of 11 by this pattern, also the existing not-JSON quoting test (run again after review round 2; the new byte-split pipe test is in the full suite) |
| Regression suite | `npm test` | pass | 423 tests, 399 pass, 24 skipped, 0 fail |
| Lint / type-check | `npm run build` (tsc over `prompt-mode.mjs`) | pass | |
| Version and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.19 |

## Output Excerpts

```
✔ an event whose JSON string holds a raw U+2028 is read as one event
✔ an event whose JSON string holds a raw U+2029 is read as one event
✔ CRLF line ends are read, and no CR stays in the events
✔ a lone CR does not end a line, so two events joined by it fail with the quoting error
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

## Residual Risks

- Not run against the real Copilot CLI here; the release run after the merge uses the real CLI.
- A lone CR no longer ends a line (readline split there); Copilot's JSON-lines output ends records
  with LF, and the README records the difference.

## Recommendation

Close the bug once merged — verified with the real reader and a child process; the release run
covers the real CLI.
