# Bug Verification: The review context's Git Status loses the leading space of its first line

- **Slug**: 028-keep-status-leading-column
- **Tested**: 2026-10-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

Written on 2026-10-13, for #59, after the fix had merged. The checks below were run on that day.

## Summary

The fix's own tests fail on the plugin code from before the fix: an unstaged first line shows `M a.js` instead of ` M a.js`. They pass on the fix commit. The full suite passes on this branch (current `main` plus these notes).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix code) | `node --test tests/git.test.mjs` on the pre-fix tree (below) | fail | expected: the bug shows. 23 tests, 20 pass, 2 fail, 1 skipped; each failure is on the bug's own assertion |
| Reproduction (post-fix) and new / updated tests | `node --test tests/git.test.mjs` at `9bd07f0` | pass | 23 tests, 22 pass, 0 fail, 1 skipped |
| Regression suite | `npm test` on branch `feature/59-bug-notes-before-extension` (`main` at `980356a`) | pass | 268 tests, 255 pass, 13 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Versions and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.12 everywhere; validation passed |

The pre-fix tree is every file from the squash commit `9bd07f0f16c67ed169dc43b029acebc746424633` (PR #39), except the files under `plugins/copilot/` that the fix changed, which come from its parent `19fbe3fdfd156943e0c01f686d7cb8bb237b0b26`. `plugins/copilot/CHANGELOG.md` and `plugin.json` keep the fix commit's version, so the version tests are not affected. So the tests and the fake Copilot CLI are the same on both sides, and only the plugin code differs:

```bash
git archive 9bd07f0 | tar -x                  # in an empty folder
git show 19fbe3f:<plugin file> > <plugin file>   # for each plugin file the fix changed
node --test tests/git.test.mjs
```

Environment: Windows 11 (10.0.22631), Git Bash, Node v24.21.0, git 2.56.0.windows.2.

## Output Excerpts

Tests that fail on the pre-fix code:

- ✖ collectReviewContext keeps the leading status column of an unstaged first line, inline and lightweight
- ✖ collectReviewContext keeps trailing white space of the last name in the status and file lists

On the fix commit: `ℹ fail 0`, exit 0. On the branch: `ℹ pass 255`, `ℹ fail 0`, `ℹ skipped 13`.

## Residual Risks

- The skipped tests are platform skips (13 in the full suite on Windows).

## Recommendation

Close the bug: verified. The fix's tests reproduce the bug on the old code and pass on the fix.
