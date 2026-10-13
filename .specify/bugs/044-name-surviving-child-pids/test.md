# Bug Verification: A cancel retry cannot reach a child that survived after its parent exited

- **Slug**: 044-name-surviving-child-pids
- **Tested**: 2026-10-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

Written on 2026-10-13, for #59, after the fix had merged. The checks below were run on that day.

## Summary

The fix's own tests fail on the plugin code from before the fix: the cancel error names the child (`Still running: PID <n>.`, from #25) but asks for a retry and does not say that a retry cannot reach it. They pass on the fix commit. The full suite passes on this branch (current `main` plus these notes).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix code) | `node --test tests/process.test.mjs tests/runtime.test.mjs` on the pre-fix tree (below) | fail | expected: the bug shows. 128 tests, 116 pass, 4 fail, 8 skipped; the cancel and SessionEnd failures show the bug (a retry is asked for, with no note that it cannot reach the child); the process test checks the new `orphans` field |
| Reproduction (post-fix) and new / updated tests | `node --test tests/process.test.mjs tests/runtime.test.mjs` at `871329d` | pass | 128 tests, 120 pass, 0 fail, 8 skipped |
| Regression suite | `npm test` on branch `feature/59-bug-notes-before-extension` (`main` at `980356a`) | pass | 268 tests, 255 pass, 13 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Versions and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.12 everywhere; validation passed |

The pre-fix tree is every file from the squash commit `871329de310308fa373007c97da6178886f6ea49` (PR #50), except the files under `plugins/copilot/` that the fix changed, which come from its parent `e7a6b8060fb6cdfc2a09f9f43c8aa493eeb489aa`. `plugins/copilot/CHANGELOG.md` and `plugin.json` keep the fix commit's version, so the version tests are not affected. So the tests and the fake Copilot CLI are the same on both sides, and only the plugin code differs:

```bash
git archive 871329d | tar -x                  # in an empty folder
git show e7a6b80:<plugin file> > <plugin file>   # for each plugin file the fix changed
node --test tests/process.test.mjs tests/runtime.test.mjs
```

Environment: Windows 11 (10.0.22631), Git Bash, Node v24.21.0, git 2.56.0.windows.2.

## Output Excerpts

Tests that fail on the pre-fix code:

- ✖ a failed taskkill marks whether only children whose root has exited are left
- ✖ a cancel that leaves a child whose parent exited names it and asks for a retry only when one can help
- ✖ a cancel whose record cannot be cleared after an orphan-only stop names the child and asks for a retry
- ✖ SessionEnd clears a pid whose stop shows it has exited, keeps one that can still be stopped, and names a child it left

On the fix commit: `ℹ fail 0`, exit 0. On the branch: `ℹ pass 255`, `ℹ fail 0`, `ℹ skipped 13`.

## Residual Risks

- The skipped tests are platform skips (13 in the full suite on Windows).
- The tests use injected stop results. A real child that `taskkill` cannot stop on Windows was not reproduced.

## Recommendation

Close the bug: verified. The fix's tests reproduce the bug on the old code and pass on the fix.
