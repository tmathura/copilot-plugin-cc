# Bug Fix: Escape backslashes in status table cells

- **Slug**: 093-escape-backslashes-status-table
- **Fixed**: 2026-10-20
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`escapeMarkdownCell` now doubles the backslashes just before a `|`, then escapes the `|`, so a value
that holds `\|` stays in its own cell of the `/copilot:status` active jobs table. Other backslashes
stay as written. A status-table test pins the cell text and count.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/render.mjs` | modified | the `\|` replace also doubles the backslashes before the pipe; the "Changed from upstream" notice names it |
| `tests/render.test.mjs` | added test | `tableCells` helper and a status-table test |
| `README.md` | modified | "Differences from the Codex plugin" bullet |
| `plugins/copilot/CHANGELOG.md` | modified | `### 1.0.17` entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | `npm run bump-version -- 1.0.17` |

## Diff Highlights (optional)

```js
function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/(\\*)\|/g, (_match, backslashes) => `${backslashes}${backslashes}\\|`)
    .replace(/\r?\n/g, " ")
    .trim();
}
```

## Tests Added or Updated

- `tests/render.test.mjs` "renderStatusReport keeps each value with a backslash or a pipe in its
  own status table cell": one running job with a summary `a\|b` (cell `a\\\|b`), a backslash in a
  code span (`` `C:\a` `` stays as written), a trailing backslash (`x\` stays), two backslashes
  before a pipe (`c\\|d` gives `c\\\\\|d`), and a CRLF line break with outer spaces
  (` rescue\r\nrun ` gives `rescue run`). The row and the header each have 8 cells when split as
  CommonMark reads them.

## Local Verification

- `node --test tests/render.test.mjs`: with the fix, 7 pass. With the old code, the new test fails
  (the summary splits into `a\\` and `b`). With every backslash doubled (the first fix), it fails
  too (`x\\` and `` `C:\\a` ``).
- `npm ci --include=dev`, `npm run build`, `npm test` (291 tests, 277 pass, 0 fail, 14 skipped),
  `npm run check-version` (1.0.17) and `claude plugin validate .`: all pass.

## Deviations from Assessment

- 2026-10-20, review round 1: the fix doubles only the backslashes just before a `|`, not every
  backslash. Doubling every backslash showed a backslash in a code span twice (CommonMark reads no
  escapes there), and changed every Windows path in the raw status text. The acceptance example
  gives the same text (`a\|b` becomes `a\\\|b`). The test now has a code-span path and a trailing
  backslash that must stay as written. The README and CHANGELOG say that, with the old code, `\|`
  ends the cell or loses its backslash, depending on the viewer (GitHub keeps the cell). `npm test`
  passes again (291 tests).

## Follow-ups

- After the merge, check that CodeQL alert #1 (`js/incomplete-sanitization`, `render.mjs`) is closed.
- The defect also exists upstream (codex-plugin-cc main `db52e28`): the owner may report it there.
