# Bug Verification: /copilot:result with a running job's id shows another job's result

- **Slug**: 018-match-result-reference-all-jobs
- **Tested**: 2026-10-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

Written on 2026-10-13, for #59, after the fix had merged. The checks below were run on that day.

## Summary

The fix's own tests fail on the plugin code from before the fix: a running `task-abc` with a finished `task-abcdef` returns `task-abcdef`. They pass on the fix commit. The full suite passes on this branch (current `main` plus these notes).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix code) | `node --test tests/job-control.test.mjs` on the pre-fix tree (below) | fail | expected: the bug shows. 10 tests, 9 pass, 1 fail, 0 skipped; each failure is on the bug's own assertion |
| Reproduction (post-fix) and new / updated tests | `node --test tests/job-control.test.mjs` at `839df3a` | pass | 10 tests, 10 pass, 0 fail, 0 skipped |
| Regression suite | `npm test` on branch `feature/59-bug-notes-before-extension` (`main` at `980356a`) | pass | 268 tests, 255 pass, 13 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Versions and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.12 everywhere; validation passed |

The pre-fix tree is every file from the squash commit `839df3a6db1cfbe7a54e1cb054cc3146deceb725` (PR #41), except the files under `plugins/copilot/` that the fix changed, which come from its parent `9bd07f0f16c67ed169dc43b029acebc746424633`. `plugins/copilot/CHANGELOG.md` and `plugin.json` keep the fix commit's version, so the version tests are not affected. So the tests and the fake Copilot CLI are the same on both sides, and only the plugin code differs:

```bash
git archive 839df3a | tar -x                  # in an empty folder
git show 9bd07f0:<plugin file> > <plugin file>   # for each plugin file the fix changed
node --test tests/job-control.test.mjs
```

Environment: Windows 11 (10.0.22631), Git Bash, Node v24.21.0, git 2.56.0.windows.2.

## Output Excerpts

Tests that fail on the pre-fix code:

- ✖ result with the exact id of a running job says it is still running, not another job's result

The tests for an exact finished id and for no reference pass on both sides; they pin behaviour that did not change.

On the fix commit: `ℹ fail 0`, exit 0. On the branch: `ℹ pass 255`, `ℹ fail 0`, `ℹ skipped 13`.

## Residual Risks

- The skipped tests are platform skips (13 in the full suite on Windows).

## Recommendation

Close the bug: verified. The fix's tests reproduce the bug on the old code and pass on the fix.
