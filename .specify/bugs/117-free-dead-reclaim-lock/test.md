# Bug Verification: A reclaim lock whose owner is dead is never freed

- **Slug**: 117-free-dead-reclaim-lock
- **Tested**: 2026-10-27
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The reproduction (a dead main lock beside a dead reclaim lock) now ends with a written update instead
of the "... belongs to process N ... Delete ... and retry" error. The races that the plan review found
are covered by tests, and the rest of the suite passes.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `node --test --test-name-pattern="whose owner is dead is passed" tests/state.test.mjs` | pass | The assessment's input: `updateState` writes the update, the dead main lock is freed, the dead first level stays |
| New / updated tests | `node --test --test-name-pattern="reclaim" tests/state.test.mjs` | pass | 17 of 17, also the unreadable-reclaim test (after review round 2) |
| Stale-read guard | the same tests with the re-read of passed levels taken out for one run | fail, as expected | both stale-read tests fail without it (recorded in `fix.md`) |
| Regression suite | `npm test` | pass | 435 tests, 411 pass, 24 skipped, 0 fail (after review round 2) |
| Lint / type-check | `npm run build` | pass | |
| Version and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.20 |

## Output Excerpts

```
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

## Residual Risks

- A dead level whose pid the OS gives to a new process looks live and blocks the chain until that
  process ends, the same limit the main lock has today.
- Not run with a real killed companion; the tests write the lock files a killed process leaves. The
  release run after the merge exercises the state lock through real commands.

## Recommendation

Close the bug once merged.
