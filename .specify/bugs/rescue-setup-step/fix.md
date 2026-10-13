# Bug Fix: /copilot:rescue gives an empty answer when Copilot cannot run

- **Slug**: rescue-setup-step
- **Fixed**: 2026-10-12
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #46 (squash commit `861853c359ca3bcb44fcefd0d98b363aa823195d`), for #59.

## Summary

The rescue subagent now returns a failed `task` call's output as it is, so a missing or too old Copilot shows the companion's error with `/copilot:setup` as the next step. The `rescue.md` rule that could never fire is replaced. Released as 1.0.8.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/agents/copilot-rescue.md` | modified | "return nothing" replaced |
| `plugins/copilot/skills/copilot-cli-runtime/SKILL.md` | modified | the same rule |
| `plugins/copilot/commands/rescue.md` | modified | the helper rule replaced; background failures named |
| `tests/commands.test.mjs` | modified | checks the new rules, and that the old ones are gone |
| `tests/runtime.test.mjs` | added tests | missing CLI, old CLI and missing login, foreground and background |
| `README.md` | modified | "Differences from the Codex plugin" entry |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.8 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.8 |

## Diff Highlights (optional)

`agents/copilot-rescue.md` and `skills/copilot-cli-runtime/SKILL.md`:

```diff
-- If the Bash call fails or Copilot cannot be invoked, return nothing.
+- If the Bash call fails, return its output exactly as-is, with nothing added. When Copilot is missing or too old, that output names `/copilot:setup` as the next step.
```

## Tests Added or Updated

- `tests/commands.test.mjs` "rescue command absorbs continue semantics": checks the new rules in the three files, and that "return nothing" and the old helper rule are gone.
- `tests/runtime.test.mjs` "a rescue task with a missing or too old Copilot fails with an error that names /copilot:setup" (foreground and background; Copilot never runs).
- `tests/runtime.test.mjs` "a rescue task without a Copilot login prints Copilot's login steps, at once in the foreground and later in a background result".

## Local Verification

As recorded in PR #46:

- Commands run: `npm test` → 241 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass (Windows).

## Deviations from Assessment

- The choice between the two ways: the subagent returns the companion's output when `task` fails. Recorded in the issue comment of 2026-10-12. Reasons: the companion's error already names the next step; it covers `--resume`, `--fresh` and a subagent that Claude starts on its own, which skip the helper; and it adds no version check or login check to each rescue. Rejected: `task-resume-candidate` reports readiness and `rescue.md` stops before routing.
- The decision is recorded in the issue comment and the README, not in a spec folder: the port spec (`specs/001-copilot-plugin-port/`) is history since #26, and this bug fix got no new spec.
- The rule returns the failed call's output, not only stderr, and covers any failure, not only one before Copilot starts, because the Bash tool merges stdout and stderr on a failure (Copilot review, round 2).
- A missing login gets Copilot's own steps, not a `/copilot:setup` hint, because that needs a change in the companion, outside these files. Moved to #45.

## Follow-ups

- #45: name `/copilot:setup` when a run fails because there is no login.
