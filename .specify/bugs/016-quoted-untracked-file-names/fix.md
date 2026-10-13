# Bug Fix: Non-ASCII file names reach the review context in git's quoted form

- **Slug**: 016-quoted-untracked-file-names
- **Fixed**: 2026-10-11
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #27 (squash commit `ef019ebf5614b6fe8cd7a1e6392796b806edfda5`), for #59.

## Summary

Every git call now gets `-c core.quotePath=false`, so git prints a non-ASCII name as it is in the status, the file lists and the patch headers. The staged, unstaged and branch name lists no longer call `trim()`, so a name that ends in U+00A0 keeps it. Released as 1.0.1.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/git.mjs` | modified | `PATH_OPTIONS` added to `safeGitArgs`; `trim()` removed from the name lists; header notice updated |
| `tests/git.test.mjs` | added tests | staged, unstaged, branch and untracked non-ASCII names |
| `README.md` | modified | "Differences from the Codex plugin" entry rewritten |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.1 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.1 |

## Diff Highlights (optional)

```js
// Git then prints a non-ASCII name as it is, so the status, the file lists and the patches agree.
// Git still quotes a name with a tab, a newline, a quote or a backslash.
const PATH_OPTIONS = ["-c", "core.quotePath=false"];

function safeGitArgs(args) {
  if (args[0] === "diff") {
    return [...SAFE_GIT_OPTIONS, ...PATH_OPTIONS, "diff", "--no-textconv", ...args.slice(1)];
  }
  return [...SAFE_GIT_OPTIONS, ...PATH_OPTIONS, ...args];
}
```

## Tests Added or Updated

- `tests/git.test.mjs` "collectReviewContext lists a staged and unstaged file whose name git would quote once, by its real name": `café.js` and `café.js` + U+00A0 counted once, with the real name in the status and patch headers.
- `tests/git.test.mjs` "collectReviewContext lists branch files whose names git would quote by their real names".
- `tests/git.test.mjs` "collectReviewContext reads an untracked file whose name git would quote in lightweight context".
- `tests/git.test.mjs` "collectReviewContext reads an untracked file with a tab in its name" (skipped on Windows, which does not allow a tab in a file name).

## Local Verification

As recorded in PR #27:

- Commands run: `npm test` → 230 tests, 217 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass.
- Manual checks: the staged and branch tests fail without the fix, and with `trim()` put back.

## Deviations from Assessment

- The fix uses `core.quotePath=false` on every git call, not `-z` for the staged, unstaged and branch lists. Reason (PR #27): `-z` fixes only those lists, while `core.quotePath=false` also fixes the status and the patch headers, in one place, and keeps names with control characters quoted on one line.
- Known limit: a name that is not valid UTF-8 shows U+FFFD in the status and patch headers, not git's octal form.

## Follow-ups

- #29: decide how file names with hidden Unicode characters reach the prompt. Closed by PR #39: keep `core.quotePath=false` and record the risk in the README.
