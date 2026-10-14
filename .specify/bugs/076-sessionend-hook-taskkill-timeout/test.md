# Bug Verification: SessionEnd hook can pass its timeout when taskkill is slow

- **Slug**: 076-sessionend-hook-taskkill-timeout
- **Tested**: 2026-10-14
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

With a `taskkill` that never ends, `cleanupSessionJobs` now ends in about 2.1 s, inside its 3500 ms
budget, and keeps the job as `cancelled` with both pids. A slow `taskkill` that names a live child
ends at the shared deadline. No regressions in the full suite. Run again after the Step 6 change in
`fix.md` ("Deviations from Assessment"): a timed-out `taskkill` whose root has exited counts as
stopped; the results below are from that run.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `npm test`, the new "SessionEnd ends inside its budget when taskkill never ends" test (the assessment's step 2: a runner that never returns, here the real `runCommandAsync` on a `node` process that waits forever) | pass | about 2.1 s, budget 3500 ms; job kept with pids 111111 and 222222 |
| New / updated tests | `npm test` (`tests/process.test.mjs`) | pass | the seven new process tests pass; POSIX-only tests skipped on Windows |
| Regression suite | `npm test` | pass | 284 tests: 270 pass, 0 fail, 14 skipped |
| Lint / type-check | `npm run build` (`tsc`) | pass | no errors |
| Version check | `npm run check-version` | pass | all version metadata matches 1.0.14 |
| Plugin validate | `claude plugin validate .` | pass | validation passed |

## Output Excerpts

```
✔ SessionEnd ends inside its budget when taskkill never ends, and keeps the job with its pids (2081.8795ms)
✔ terminateProcessTree on macOS and Linux sends SIGKILL at its deadline (310.0607ms)
ℹ tests 284  ℹ pass 270  ℹ fail 0  ℹ skipped 14   (npm test, after the Step 6 change)
```

## Residual Risks

- A real `taskkill` that stalls was not produced; a `node` process that never ends stands in for it,
  through the same runner and time limit.
- The macOS and Linux branches of the new tests run only in CI.
- The existing Windows SessionEnd tests run the real `taskkill` under the 2000 ms stop deadline; a
  very slow CI runner could see a stop that did not finish (assessment, Risks).

## Recommendation

Close the bug once CI passes on Windows, macOS and Linux.
