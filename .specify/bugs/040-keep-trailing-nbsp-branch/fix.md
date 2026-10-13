# Bug Fix: A large branch review cuts a trailing no-break space from the last file name

- **Slug**: 040-keep-trailing-nbsp-branch
- **Fixed**: 2026-10-13
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #49 (squash commit `e7a6b8060fb6cdfc2a09f9f43c8aa493eeb489aa`), for #59.

## Summary

`withReviewPatches` now removes only trailing new lines from the context, as `formatSection` does. The review, the adversarial review and the review gate all get the fix. Released as 1.0.11.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/copilot-companion.mjs` | modified | `trimEnd()` replaced by `replace(/\n+$/, "")` |
| `tests/runtime.test.mjs` | added test | large branch review, last name ends in U+00A0 |
| `README.md` | modified | the #28 exception note removed |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.11 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.11 |

## Diff Highlights (optional)

```js
// Only new lines go: the last changed file name can end in white space, such as a no-break space.
const reviewInput = [context.content.replace(/\n+$/, ""), "", "## Patch Files", "", ...files.map((file) => `- ${file}`), ""].join("\n");
```

## Tests Added or Updated

- `tests/runtime.test.mjs` "above the inline limit, a branch review keeps a trailing no-break space on the last changed file name": the name is in the final review input, just before "## Patch Files".

## Local Verification

As recorded in PR #49:

- Commands run: `npm test` → 245 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass (Windows).
- Manual checks: the new test fails on the old code.

## Deviations from Assessment

None.

## Follow-ups

- #61: an untracked file's content and the diff stat's first line are still trimmed. The code review before commit turned these down as outside this ticket; #61 was opened later, in #59.
