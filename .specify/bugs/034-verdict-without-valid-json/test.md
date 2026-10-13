# Bug Verification: An adversarial review sometimes ends with no verdict

- **Slug**: 034-verdict-without-valid-json
- **Tested**: 2026-10-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

Written on 2026-10-13, for #59, after the fix had merged. The checks below were run on that day.

## Summary

The fix's own tests fail on the plugin code from before the fix: a last turn with no answer shows an earlier message, and the prompt still says "the provided schema". They pass on the fix commit. The full suite passes on this branch (current `main` plus these notes). The prompt part of the fix depends on the model. Real Copilot reviews with the merged prompt were not run now. The issue comment records 9 of 9 with a verdict on 2026-10-12, with a similar line in the focus text, not the merged prompt.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix code) | `node --test tests/runtime.test.mjs` on the pre-fix tree (below) | fail | expected: the bug shows. 87 tests, 81 pass, 2 fail, 4 skipped; each failure is on the bug's own assertion |
| Reproduction (post-fix) and new / updated tests | `node --test tests/runtime.test.mjs` at `c2552e6` | pass | 87 tests, 83 pass, 0 fail, 4 skipped |
| Regression suite | `npm test` on branch `feature/59-bug-notes-before-extension` (`main` at `980356a`) | pass | 268 tests, 255 pass, 13 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Versions and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.12 everywhere; validation passed |

The pre-fix tree is every file from the squash commit `c2552e6d91016204d4927add83d1b665ca63456f` (PR #42), except the files under `plugins/copilot/` that the fix changed, which come from its parent `839df3a6db1cfbe7a54e1cb054cc3146deceb725`. `plugins/copilot/CHANGELOG.md` and `plugin.json` keep the fix commit's version, so the version tests are not affected. So the tests and the fake Copilot CLI are the same on both sides, and only the plugin code differs:

```bash
git archive c2552e6 | tar -x                  # in an empty folder
git show 839df3a:<plugin file> > <plugin file>   # for each plugin file the fix changed
node --test tests/runtime.test.mjs
```

Environment: Windows 11 (10.0.22631), Git Bash, Node v24.21.0, git 2.56.0.windows.2.

## Output Excerpts

Tests that fail on the pre-fix code:

- ✖ an adversarial review asks for the JSON as plain text in the final message, not through a tool
- ✖ an adversarial review whose last turn has no answer fails with a clear error, not an earlier message

The tests for JSON after an earlier message, for a failed run and for a `json` tool call pass on both sides; they pin behaviour that did not change.

On the fix commit: `ℹ fail 0`, exit 0. On the branch: `ℹ pass 255`, `ℹ fail 0`, `ℹ skipped 13`.

## Residual Risks

- The skipped tests are platform skips (13 in the full suite on Windows).
- Copilot can still call a tool or end without an answer; the review then fails with a clear error, not a verdict.

## Recommendation

Keep the bug closed. The code change is verified by tests that fail on the old code; the part named at the end of the Summary was not exercised.
