# Bug Verification: SessionEnd overruns its 5 s timeout on Windows, and a test helper's dead pid can be alive

- **Slug**: 072-timing-tests-pass-windows
- **Tested**: 2026-10-14
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

The SessionEnd failure no longer reproduces: the test failed 5 runs of 5 before the fix and passed
20 runs of 20 after it, and the third test added by the scope change also held. The pid reuse
behind the reclaim-lock failure could not be caused on demand, so that reproduction was not run;
the fix removes the helper's need for a freed pid, and the state tests passed 20 runs of 20. The
result is `partial` only for that reason. No regressions were found.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix), SessionEnd | `node --test --test-name-pattern="SessionEnd stops three" tests/runtime.test.mjs`, 5 runs | pass | before the fix 5 of 5 failed (5334 to 6110 ms) |
| Reproduction (post-fix), reclaim lock | `npm test` on a busy machine, waiting for a freed pid to be reused | not-run | the reuse cannot be caused on demand; 0 reuses in 100 tries on an idle machine |
| Acceptance, runtime file | `node --test tests/runtime.test.mjs`, 20 runs in a row on Windows 11 | pass | 20 of 20, 92 passed in each run, 180 to 189 s a run |
| Acceptance, state file | `node --test tests/state.test.mjs`, 20 runs in a row on Windows 11 | pass | 20 of 20, 29 passed in each run |
| New / updated tests | `node --test tests/process.test.mjs` | pass | 35 passed (Windows skips the signal tests) |
| Regression suite | `npm test` | pass | 276 tests: 262 passed, 0 failed, 14 skipped |
| Lint / type-check | `npm run build` | pass | `tsc` exits 0 |
| Version check | `npm run check-version` | pass | all version metadata matches 1.0.13 |
| Plugin validation | `claude plugin validate .` | pass | validation passed |
| CI on Windows, macOS and Linux | the PR's checks | not-run | runs on the PR |

## Output Excerpts

```text
run 20: pass 92 fail 0 187 s
failed runs: 0 of 20          (tests/runtime.test.mjs)
run 20: pass 29 fail 0 5 s
failed runs: 0 of 20          (tests/state.test.mjs)
ℹ tests 276  ℹ pass 262  ℹ fail 0  ℹ skipped 14   (npm test)
```

## Residual Risks

- Windows documents no pid ceiling. `deadPid()` asserts `ESRCH` for 2147483644, so a system where
  that pid is alive fails with a clear message, not a lock timeout.
- `taskkill` itself has no time limit, and the SessionEnd stop wait is computed before it runs
  (assessment, Risks). A very slow `taskkill` can still use up the hook's budget; it is now one
  `taskkill` time, not six.
- macOS and Linux results come from CI only.

## Recommendation

Merge after CI passes on Windows, macOS and Linux. The reclaim-lock reproduction was not run because
the pid reuse cannot be caused on demand; the fix takes away the dependency on it.
