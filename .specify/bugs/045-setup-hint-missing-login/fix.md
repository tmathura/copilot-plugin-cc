# Bug Fix: A run without a Copilot login does not name /copilot:setup

- **Slug**: 045-setup-hint-missing-login
- **Fixed**: 2026-10-12
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #47 (squash commit `9bf0ce4c9b6c6b200bd1a8fedccae2e3593784c7`), for #59.

## Summary

When Copilot stops before it sends a result and its stderr matches `NOT_LOGGED_IN_PATTERN`, the error now ends with "Run `/copilot:setup` to check the login and see how to log in." The hint is built in the adapter (`captureTurn` in `copilot.mjs`), one of the two places the issue allowed, so every caller gets it. The task's JSON output gets `failureMessage`, and the review gate reads it. Released as 1.0.9.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/copilot.mjs` | modified | `LOGIN_HINT` added to the run error |
| `plugins/copilot/scripts/copilot-companion.mjs` | modified | `failureMessage` in the task JSON; `review --json` uses the failure text |
| `plugins/copilot/scripts/stop-review-gate-hook.mjs` | modified | the gate reads `failureMessage` first |
| `tests/runtime.test.mjs` | added tests | no-login runs; `failureMessage` |
| `README.md` | modified | "Differences from the Codex plugin" entry |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.9 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.9 |

## Diff Highlights (optional)

```js
const LOGIN_HINT = "Run `/copilot:setup` to check the login and see how to log in.";
// ...
// Setup knows more than Copilot's own steps, for example a token for a system with no keyring.
const hint = NOT_LOGGED_IN_PATTERN.test(state.stderr) ? `\n${LOGIN_HINT}` : "";
state.error = new Error(
  `Copilot stopped before it sent a result (${how}).${state.stderr ? `\n${state.stderr}` : ""}${hint}`
);
```

## Tests Added or Updated

- `tests/runtime.test.mjs` "a review and the review gate without a Copilot login name /copilot:setup" (an adversarial review, a native review, `review --json` and the gate).
- `tests/runtime.test.mjs` "a failed task's JSON output gives its reason, and a finished one gives none".
- `tests/runtime.test.mjs` "a rescue task without a Copilot login prints Copilot's login steps, at once in the foreground and later in a background result" (from #22) now also checks the hint.

## Local Verification

As recorded in PR #47:

- Commands run: `npm test` → 243 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass (Windows).

## Deviations from Assessment

- The review gate also had a second gap: for any failed run it showed the task's raw JSON output, not a reason. The fix adds `failureMessage` to the task's JSON output (with an exit-code fallback) and the gate reads it first. This adds one JSON field and removes nothing.
- `review --json` puts the same failure text in `copilot.stderr` (Codex review, round 1).

## Follow-ups

- None.
