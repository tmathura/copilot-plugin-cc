# Bug Verification: Non-ASCII file names reach the review context in git's quoted form

- **Slug**: 016-quoted-untracked-file-names
- **Tested**: 2026-10-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

Written on 2026-10-13, for #59, after the fix had merged. The checks below were run on that day.

## Summary

The fix's own tests fail on the plugin code from before the fix: the staged, unstaged and branch name lists show git's quoted form of `café.js`, as the assessment says. They pass on the fix commit. The full suite passes on this branch (current `main` plus these notes).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix code) | `node --test tests/git.test.mjs` on the pre-fix tree (below) | fail | expected: the bug shows. 21 tests, 18 pass, 2 fail, 1 skipped; each failure is on the bug's own assertion |
| Reproduction (post-fix) and new / updated tests | `node --test tests/git.test.mjs` at `ef019eb` | pass | 21 tests, 20 pass, 0 fail, 1 skipped |
| Regression suite | `npm test` on branch `feature/59-bug-notes-before-extension` (`main` at `980356a`) | pass | 268 tests, 255 pass, 13 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Versions and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.12 everywhere; validation passed |

The pre-fix tree is every file from the squash commit `ef019ebf5614b6fe8cd7a1e6392796b806edfda5` (PR #27), except the files under `plugins/copilot/` that the fix changed, which come from its parent `c7271ad61dc97d4231b8d5a6eaf571dc168b5331`. `plugins/copilot/CHANGELOG.md` and `plugin.json` keep the fix commit's version, so the version tests are not affected. So the tests and the fake Copilot CLI are the same on both sides, and only the plugin code differs:

```bash
git archive ef019eb | tar -x                  # in an empty folder
git show c7271ad:<plugin file> > <plugin file>   # for each plugin file the fix changed
node --test tests/git.test.mjs
```

Environment: Windows 11 (10.0.22631), Git Bash, Node v24.21.0, git 2.56.0.windows.2.

## Output Excerpts

Tests that fail on the pre-fix code:

- ✖ collectReviewContext lists a staged and unstaged file whose name git would quote once, by its real name
- ✖ collectReviewContext lists branch files whose names git would quote by their real names

The untracked-file tests pass on both sides, because #9 had already fixed untracked names before this fix.

On the fix commit: `ℹ fail 0`, exit 0. On the branch: `ℹ pass 255`, `ℹ fail 0`, `ℹ skipped 13`.

## Residual Risks

- The skipped tests are platform skips (13 in the full suite on Windows).
- The tab-name test is skipped on Windows, which does not allow a tab in a file name. CI runs it on macOS and Linux.
- A name that is not valid UTF-8 shows U+FFFD in the status and patch headers (known limit, `fix.md`).

## Recommendation

Close the bug: verified. The fix's tests reproduce the bug on the old code and pass on the fix.
