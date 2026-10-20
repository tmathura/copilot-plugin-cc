# Bug Verification: Escape backslashes in status table cells

- **Slug**: 093-escape-backslashes-status-table
- **Tested**: 2026-10-20
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The reproduction from the assessment now gives 8 cells, the same as the header, and the summary cell
is `a\\\|b`. The new test fails on the old code and on the first fix (every backslash doubled), and
passes with the fix; the full suite passes. Run again after review round 1.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | scratchpad script: `renderStatusReport` with summary `a\|b`, row split as CommonMark reads it | pass | 8 cells (9 before the fix) |
| New / updated tests | `node --test tests/render.test.mjs` | pass | 7 pass; the new test fails on the old code and with every backslash doubled |
| Regression suite | `npm ci --include=dev`, `npm test`, `npm run check-version` | pass | 291 tests, 277 pass, 0 fail, 14 skipped; version 1.0.17 |
| Lint / type-check | `npm run build`, `claude plugin validate .` | pass | type check and plugin validation pass |

## Output Excerpts

```text
"| task-1 | task | running | running | 1s |  | a\\\\\\|b | ..."   (JSON string: the cell text is a\\\|b)
cells 8 (header has 8)
```

## Residual Risks

- How a viewer splits the row depends on its Markdown renderer; the test follows CommonMark
  backslash escapes, and the fixed text is also correct for GitHub's table parser.
- A `\|` inside a code span in a cell shows one extra backslash, because a code span reads no escapes.
- CodeQL alert #1 closes only after CodeQL scans `main` with the fix.

## Recommendation

Close the bug once merged — verified by reproduction and tests. Check CodeQL alert #1 after the merge.
