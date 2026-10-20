# Bug Verification: Keep a stopped gate job cancelled when its companion saves it as failed first

- **Slug**: 084-keep-stopped-gate-job-cancelled
- **Tested**: 2026-10-20
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The forced form of the race (the job saved `failed` between the companion's stop and the gate's
cancel) no longer leaves the job `failed`. It ends `cancelled` with the gate's reason, after the
limit and after a signal. No regressions were found. Run again after review rounds 1 and 2 (docs,
the changelog wording, the test's wait and comment wrapping); the results below are from that run.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `node --test tests/runtime-gate-stop.test.mjs` (the new test forces the race with `terminateImpl`) | pass | the automated form of the assessment's reproduction |
| Reproduction (pre-fix) | the same test with the gate's `overrideFailed` set to `false` | fail (expected) | got `['failed', 'Copilot exited.', null, null]`, the CI failure in the issue |
| Stability | `node --test tests/runtime-gate-stop.test.mjs`, two more runs | pass | 5 pass, 1 skipped each time |
| New / updated tests | `node --test tests/runtime-jobs.test.mjs tests/runtime-gate-stop.test.mjs tests/runtime-hooks.test.mjs` | pass | 42 tests, 41 pass, 1 skipped, 0 fail |
| Regression suite | `npm test` | pass | 287 tests, 0 fail |
| Lint / type-check | `npm run build` (`tsc`) | pass | |
| Version and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.15 |

## Output Excerpts

```
ℹ tests 287
ℹ fail 0
All version metadata matches 1.0.15.
✔ Validation passed
```

## Residual Risks

- The real race depends on the order in which Windows `taskkill /T /F` stops the tree, so it cannot
  be made to happen on demand. The test forces the same state through the `terminateImpl` seam.
  CI on Windows runs the original test, which can no longer fail this way.
- The skipped test is the SIGTERM hook test, which is skipped on Windows as before. It runs on
  ubuntu and macOS in CI.

## Recommendation

Close the bug once CI passes on ubuntu, macOS and Windows.
