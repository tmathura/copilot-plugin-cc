# Bug Verification: A run without a Copilot login does not name /copilot:setup

- **Slug**: 045-setup-hint-missing-login
- **Tested**: 2026-10-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

Written on 2026-10-13, for #59, after the fix had merged. The checks below were run on that day.

## Summary

The fix's own tests fail on the plugin code from before the fix: a run without a login shows Copilot's error with no `/copilot:setup`. They pass on the fix commit. The full suite passes on this branch (current `main` plus these notes).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix code) | `node --test tests/runtime.test.mjs` on the pre-fix tree (below) | fail | expected: the bug shows. 91 tests, 84 pass, 3 fail, 4 skipped; two failures show the missing hint; the third checks the new `failureMessage` field that the review gate reads |
| Reproduction (post-fix) and new / updated tests | `node --test tests/runtime.test.mjs` at `9bf0ce4` | pass | 91 tests, 87 pass, 0 fail, 4 skipped |
| Regression suite | `npm test` on branch `feature/59-bug-notes-before-extension` (`main` at `980356a`) | pass | 268 tests, 255 pass, 13 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Versions and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.12 everywhere; validation passed |

The pre-fix tree is every file from the squash commit `9bf0ce4c9b6c6b200bd1a8fedccae2e3593784c7` (PR #47), except the files under `plugins/copilot/` that the fix changed, which come from its parent `861853c359ca3bcb44fcefd0d98b363aa823195d`. `plugins/copilot/CHANGELOG.md` and `plugin.json` keep the fix commit's version, so the version tests are not affected. So the tests and the fake Copilot CLI are the same on both sides, and only the plugin code differs:

```bash
git archive 9bf0ce4 | tar -x                  # in an empty folder
git show 861853c:<plugin file> > <plugin file>   # for each plugin file the fix changed
node --test tests/runtime.test.mjs
```

Environment: Windows 11 (10.0.22631), Git Bash, Node v24.21.0, git 2.56.0.windows.2.

## Output Excerpts

Tests that fail on the pre-fix code:

- ✖ a rescue task without a Copilot login prints Copilot's login steps, at once in the foreground and later in a background result
- ✖ a failed task's JSON output gives its reason, and a finished one gives none
- ✖ a review and the review gate without a Copilot login name /copilot:setup

On the fix commit: `ℹ fail 0`, exit 0. On the branch: `ℹ pass 255`, `ℹ fail 0`, `ℹ skipped 13`.

## Residual Risks

- The skipped tests are platform skips (13 in the full suite on Windows).
- The hint depends on `NOT_LOGGED_IN_PATTERN`; another wording of Copilot's login error would get no hint.

## Recommendation

Close the bug: verified. The fix's tests reproduce the bug on the old code and pass on the fix.
