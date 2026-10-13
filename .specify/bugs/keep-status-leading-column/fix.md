# Bug Fix: The review context's Git Status loses the leading space of its first line

- **Slug**: keep-status-leading-column
- **Fixed**: 2026-10-12
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #39 (squash commit `9bd07f0f16c67ed169dc43b029acebc746424633`), for #59.

## Summary

The Git Status body now goes into `formatSection` as git prints it, and `formatSection` removes only trailing new lines. An unstaged first line keeps ` M`. Released as 1.0.4.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/git.mjs` | modified | no `trim()` on the status; `formatSection` removes only trailing new lines |
| `tests/git.test.mjs` | added tests | unstaged first line; trailing U+00A0 on the last name |
| `README.md` | modified | new "Differences from the Codex plugin" entry; #29 note on the non-ASCII entry |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.4 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.4 |

## Diff Highlights (optional)

```js
// Only trailing new lines go: a leading space is the staged column of `git status --short`, and a
// file name or a patch line can end in white space.
function formatSection(title, body) {
  return [`## ${title}`, "", body.trim() ? body.replace(/\n+$/, "") : "(none)", ""].join("\n");
}
```

## Tests Added or Updated

- `tests/git.test.mjs` "collectReviewContext keeps the leading status column of an unstaged first line, inline and lightweight" (also an empty section shows `(none)`).
- `tests/git.test.mjs` "collectReviewContext keeps trailing white space of the last name in the status and file lists".

## Local Verification

As recorded in PR #39:

- Commands run: `npm test` → 227 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass (Windows).

## Deviations from Assessment

- `formatSection` now keeps white space at the end of every section's last line, not only for Git Status, because a file name or a patch line can end in white space (code review before commit). The other bodies are still trimmed where they are built, so their content does not change.
- The PR also closed #29: the owner chose to keep `core.quotePath=false`, and the README now says that hidden Unicode characters in a file name reach the review as they are.

## Follow-ups

- #40: in a large branch review, `withReviewPatches` still trims the content, so the last changed file name loses white space at its end (Copilot review of PR #39).
- #61: the diff stat's first line still loses its leading space. The code review before commit turned this down as outside this ticket; #61 was opened later, in #59.
