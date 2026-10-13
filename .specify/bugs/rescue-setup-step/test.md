# Bug Verification: /copilot:rescue gives an empty answer when Copilot cannot run

- **Slug**: rescue-setup-step
- **Tested**: 2026-10-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

Written on 2026-10-13, for #59, after the fix had merged. The checks below were run on that day.

## Summary

The fix's own tests fail on the plugin code from before the fix: the agent, skill and command text still hold "return nothing" and the helper rule that cannot fire. They pass on the fix commit. The full suite passes on this branch (current `main` plus these notes). The symptom is how the rescue subagent follows its instructions in a live Claude Code session. That was not run; the tests check the instruction text and the companion's output.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix code) | `node --test tests/commands.test.mjs tests/runtime.test.mjs` on the pre-fix tree (below) | fail | expected: the bug shows. 97 tests, 92 pass, 1 fail, 4 skipped; each failure is on the bug's own assertion |
| Reproduction (post-fix) and new / updated tests | `node --test tests/commands.test.mjs tests/runtime.test.mjs` at `861853c` | pass | 97 tests, 93 pass, 0 fail, 4 skipped |
| Regression suite | `npm test` on branch `feature/59-bug-notes-before-extension` (`main` at `980356a`) | pass | 268 tests, 255 pass, 13 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Versions and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.12 everywhere; validation passed |

The pre-fix tree is every file from the squash commit `861853c359ca3bcb44fcefd0d98b363aa823195d` (PR #46), except the files under `plugins/copilot/` that the fix changed, which come from its parent `1e29b929be29682e3d836a9a4ed8cb57eb007735`. `plugins/copilot/CHANGELOG.md` and `plugin.json` keep the fix commit's version, so the version tests are not affected. So the tests and the fake Copilot CLI are the same on both sides, and only the plugin code differs:

```bash
git archive 861853c | tar -x                  # in an empty folder
git show 1e29b92:<plugin file> > <plugin file>   # for each plugin file the fix changed
node --test tests/commands.test.mjs tests/runtime.test.mjs
```

Environment: Windows 11 (10.0.22631), Git Bash, Node v24.21.0, git 2.56.0.windows.2.

## Output Excerpts

Tests that fail on the pre-fix code:

- ✖ rescue command absorbs continue semantics

The runtime tests for a missing CLI, an old CLI and a missing login pass on both sides: the companion already printed the right error, and the bug was in the subagent's instructions.

On the fix commit: `ℹ fail 0`, exit 0. On the branch: `ℹ pass 255`, `ℹ fail 0`, `ℹ skipped 13`.

## Residual Risks

- The skipped tests are platform skips (13 in the full suite on Windows).
- A model can still ignore an instruction. Only a live `/copilot:rescue` with Copilot missing would show the end-to-end result.

## Recommendation

Keep the bug closed. The code change is verified by tests that fail on the old code; the part named at the end of the Summary was not exercised.
