# Bug Fix: /copilot:status shows a heading or a label as a job's summary

- **Slug**: 030-skip-headings-job-summary
- **Fixed**: 2026-10-12
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #48 (squash commit `7b12f5378b5110029138bdf1991ecf35744c763e`), for #59.

## Summary

`firstMeaningfulLine` now skips headings, rules, code fences and bold-only labels, and keeps a bold line that ends like a sentence, without its markers. Released as 1.0.10.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/copilot-companion.mjs` | modified | `firstMeaningfulLine` skips structure lines |
| `tests/runtime.test.mjs` | added test | review answers with each kind of first line; a task |
| `README.md` | modified | "Differences from the Codex plugin" entry |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.10 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.10 |

## Diff Highlights (optional)

```js
for (const value of String(text ?? "").split(/\r?\n/)) {
  const line = value.trim();
  // Headings, rules such as "---" and code fences.
  if (!line || /^#{1,6}(\s|$)/.test(line) || /^([-*_])(\s*\1){2,}$/.test(line) || /^(```|~~~)/.test(line)) {
    continue;
  }
  // Bold, also bold-italic such as "***Findings***".
  const bold = /^(\*\*\*?|___?)((?:(?!\1).)+)\1:?$/.exec(line)?.[2].trim();
  if (bold === undefined) {
    return line;
  }
  if (/[.!?]$/.test(bold)) {
    return bold;
  }
}
return fallback;
```

## Tests Added or Updated

- `tests/runtime.test.mjs` "a review's job summary skips headings and bold labels, and keeps a bold sentence without its markers": `## Review`, `**Review findings**`, `**Findings:**`, a bold sentence, rules, fences, `__x__`, `_` and `*` inside bold text, a `?` sentence, two bold parts on one line, `***x***` with CRLF, and fences or headings only (fallback). It also runs a task that starts with a heading.

## Local Verification

As recorded in PR #48:

- Commands run: `npm test` → 244 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass (Windows).

## Deviations from Assessment

- The fix also skips rules (`---`, `***`, `___`, also spaced as `* * *`) and code fence lines (`` ``` ``, `~~~`), and `__x__` and `***x***` labels, which the issue did not name. Copilot's answers use them as structure too (code review before commit; Codex and Copilot rounds 1 and 2; Copilot PR review round 1).
- A bold line is a sentence when it ends with `.`, `!` or `?`.
- Rejected: Setext headings (the issue defines headings as `#` to `######`), and skipping the content inside a fence (Copilot often wraps its whole answer in one fence).

## Follow-ups

- None.
