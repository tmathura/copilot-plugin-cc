# Bug Verification: a task whose prompt holds a double quote fails before Copilot starts

- **Slug**: 151-safe-session-name
- **Tested**: 2026-10-27
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The bug reproduces with main's companion and the real Copilot CLI 1.0.95, and does not with the
fixed one: the same quoted read-only task completes. The full suite passes with no regression. The
checks ran again after review rounds 1, 2 and 3.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | `task --fresh 'Say "ok" in one word. Do not change any file.'` with main's companion (31863a9), real Copilot CLI 1.0.95, a throwaway repo and data folder | fail (as expected) | Exit 1, "Session name must not contain double quotes." |
| Reproduction (post-fix) | The same task with this branch's companion | pass | Exit 0, answer `ok`; the repo is unchanged |
| New / updated tests | `node --test tests/copilot.test.mjs tests/runtime-task.test.mjs` (in `npm test`) | pass | The tests listed in `fix.md` as failing on the old code pass now |
| Regression suite | `npm test` | pass | 508 tests: 466 pass, 42 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Version and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.24; validation passed |

## Output Excerpts

```text
main (31863a9):  exit 1
                 Copilot stopped before it sent a result (exit 1).
                 Session name must not contain double quotes.
this branch:     exit 0
                 ok
```

## Residual Risks

- The real Copilot CLI ran on Windows only; CI checks the rules through the fake CLI.
- A later Copilot CLI may refuse more characters; the release run would show it.
- A prompt given as one string can still lose some of its quotes before it reaches Copilot (#111,
  main's behaviour).

## Recommendation

Close the bug: verified end to end with the real Copilot CLI. The release run after the merge repeats
step 4 with a quoted prompt.
