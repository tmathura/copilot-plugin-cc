# Bug Verification: /copilot:status shows a heading or a label as a job's summary

- **Slug**: 030-skip-headings-job-summary
- **Tested**: 2026-10-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

Written on 2026-10-13, for #59, after the fix had merged. The checks below were run on that day.

## Summary

The fix's own tests fail on the plugin code from before the fix: a review that starts with `## Review` gets `## Review` as its summary. They pass on the fix commit. The full suite passes on this branch (current `main` plus these notes).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix code) | `node --test tests/runtime.test.mjs` on the pre-fix tree (below) | fail | expected: the bug shows. 92 tests, 87 pass, 1 fail, 4 skipped; each failure is on the bug's own assertion |
| Reproduction (post-fix) and new / updated tests | `node --test tests/runtime.test.mjs` at `7b12f53` | pass | 92 tests, 88 pass, 0 fail, 4 skipped |
| Regression suite | `npm test` on branch `feature/59-bug-notes-before-extension` (`main` at `980356a`) | pass | 268 tests, 255 pass, 13 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Versions and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.12 everywhere; validation passed |

The pre-fix tree is every file from the squash commit `7b12f5378b5110029138bdf1991ecf35744c763e` (PR #48), except the files under `plugins/copilot/` that the fix changed, which come from its parent `9bf0ce4c9b6c6b200bd1a8fedccae2e3593784c7`. `plugins/copilot/CHANGELOG.md` and `plugin.json` keep the fix commit's version, so the version tests are not affected. So the tests and the fake Copilot CLI are the same on both sides, and only the plugin code differs:

```bash
git archive 7b12f53 | tar -x                  # in an empty folder
git show 9bf0ce4:<plugin file> > <plugin file>   # for each plugin file the fix changed
node --test tests/runtime.test.mjs
```

Environment: Windows 11 (10.0.22631), Git Bash, Node v24.21.0, git 2.56.0.windows.2.

## Output Excerpts

Tests that fail on the pre-fix code:

- ✖ a review's job summary skips headings and bold labels, and keeps a bold sentence without its markers

On the fix commit: `ℹ fail 0`, exit 0. On the branch: `ℹ pass 255`, `ℹ fail 0`, `ℹ skipped 13`.

## Residual Risks

- The skipped tests are platform skips (13 in the full suite on Windows).
- Copilot's output format changes from run to run; a new kind of opening line could still become a summary.

## Recommendation

Close the bug: verified. The fix's tests reproduce the bug on the old code and pass on the fix.
