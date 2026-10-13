# Bug Fix: A long option value loses everything after its second equals sign

- **Slug**: keep-equals-option-values
- **Fixed**: 2026-10-12
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #38 (squash commit `19fbe3fdfd156943e0c01f686d7cb8bb237b0b26`), for #59.

## Summary

A long option is now split at the first `=` only, so its value keeps every later `=`. Released as 1.0.3.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/args.mjs` | modified | split at the first `=`; upstream change notice |
| `tests/args.test.mjs` | added | new test file |
| `README.md` | modified | "Differences from the Codex plugin" entry |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.3 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.3 |

## Diff Highlights (optional)

```js
const separator = token.indexOf("=");
const rawKey = separator === -1 ? token.slice(2) : token.slice(2, separator);
const inlineValue = separator === -1 ? undefined : token.slice(separator + 1);
```

## Tests Added or Updated

- `tests/args.test.mjs` "a long option value keeps every equals sign after the first".
- `tests/args.test.mjs` "a long option written with an empty inline value gives an empty string".
- `tests/args.test.mjs` "flags, separate values, short aliases and -- keep their behaviour": `--flag`, `--flag=false`, `--flag=true`, `--option value`, `-x value`, `--`, an unknown long option and a missing value.

## Local Verification

As recorded in PR #38:

- Commands run: `npm test` → 225 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass (Windows).

## Deviations from Assessment

None.

## Follow-ups

- None.
