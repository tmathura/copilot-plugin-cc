# Bug Verification: Read the review verdict when Copilot writes text before the JSON

- **Slug**: 078-read-verdict-text-before-json
- **Tested**: 2026-10-20
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The reported answer (a line of text, a blank line, then one fenced JSON verdict) now gives the
verdict through the fake Copilot CLI. Answers with no closed block, two blocks or an invalid block
still fail with the first parse error and the raw output. No regressions were found.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `node --test tests/runtime-review.test.mjs` (the reported answer through `FAKE_COPILOT_ANSWER`) | pass | the assessment's reproduction, run by the new test |
| Reproduction (pre-fix) | the same test with the fallback switched off | fail (expected) | 2 of the new tests fail without the fix |
| New / updated tests | `node --test tests/runtime-review.test.mjs` | pass | 15 tests, 0 fail |
| Regression suite | `npm test` | pass | 290 tests, 0 fail |
| Lint / type-check | `npm run build` (`tsc`) | pass | |
| Version and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.16 |

## Output Excerpts

```
ℹ tests 290
ℹ fail 0
All version metadata matches 1.0.16.
✔ Validation passed
```

## Residual Risks

- The fix was checked with the fake Copilot CLI, not with a live Copilot run; the release run's
  adversarial-review step exercises a live answer.

## Recommendation

Close the bug once CI passes on ubuntu, macOS and Windows.
