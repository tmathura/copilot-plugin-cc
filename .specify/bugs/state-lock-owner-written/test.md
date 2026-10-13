# Bug Verification: A killed process can leave an empty state lock that blocks every later command

- **Slug**: state-lock-owner-written
- **Tested**: 2026-10-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

Written on 2026-10-13, for #59, after the fix had merged. The checks below were run on that day.

## Summary

The fix's own tests fail on the plugin code from before the fix: the lock name is opened directly and written in a second step, so it can exist without an owner. They pass on the fix commit. The full suite passes on this branch (current `main` plus these notes). The tests show the cause, not the symptom: no process was killed between creating the lock and writing its owner.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix code) | `node --test tests/state.test.mjs` on the pre-fix tree (below) | fail | expected: the bug shows. 32 tests, 26 pass, 3 fail, 3 skipped; the first failure shows the cause (the old code opens the lock name directly); the other two check the link calls of the new design, which the old code does not make |
| Reproduction (post-fix) and new / updated tests | `node --test tests/state.test.mjs` at `a1db422` | pass | 32 tests, 29 pass, 0 fail, 3 skipped |
| Regression suite | `npm test` on branch `feature/59-bug-notes-before-extension` (`main` at `980356a`) | pass | 268 tests, 255 pass, 13 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Versions and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.12 everywhere; validation passed |

The pre-fix tree is every file from the squash commit `a1db4229f4824811cba8f7b0d8a9fd8439917d0b` (PR #37), except the files under `plugins/copilot/` that the fix changed, which come from its parent `343a8ee826d752ce70dc9a2c9d2ab038971c241f`. `plugins/copilot/CHANGELOG.md` and `plugin.json` keep the fix commit's version, so the version tests are not affected. So the tests and the fake Copilot CLI are the same on both sides, and only the plugin code differs:

```bash
git archive a1db422 | tar -x                  # in an empty folder
git show 343a8ee:<plugin file> > <plugin file>   # for each plugin file the fix changed
node --test tests/state.test.mjs
```

Environment: Windows 11 (10.0.22631), Git Bash, Node v24.21.0, git 2.56.0.windows.2.

## Output Excerpts

Tests that fail on the pre-fix code:

- ✖ a lock file appears only with its owner already in it, and no temp file stays behind
- ✖ a reclaim lock appears only with its owner already in it, and no temp file stays behind
- ✖ a lock link that fails for another reason gives its error and leaves no lock or temp file

The tests for a failed owner write and for a leftover temp file pass on both sides; they guard the new design. (PR #37 notes this for the leftover temp file.)

On the fix commit: `ℹ fail 0`, exit 0. On the branch: `ℹ pass 255`, `ℹ fail 0`, `ℹ skipped 13`.

## Residual Risks

- The skipped tests are platform skips (13 in the full suite on Windows).
- The tests check the order of the file calls. A process killed at the exact moment was not reproduced; CI hit it once (macOS run 38178068886).

## Recommendation

Keep the bug closed. The code change is verified by tests that fail on the old code; the part named at the end of the Summary was not exercised.
