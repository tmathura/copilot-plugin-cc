# Bug Fix: Cancel reports a failure when taskkill names children that already exited

- **Slug**: 025-cancel-taskkill-exited-children
- **Fixed**: 2026-10-12
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #43 (squash commit `1e29b929be29682e3d836a9a4ed8cb57eb007735`), for #59.

## Summary

When `taskkill` fails on Windows, the plugin now reads the pids it could not stop, then checks the root and those pids until they are gone, within the 5-second limit. Then only a process still alive counts as a failed stop, and the error names it: `Still running: PID <n>.` Output that names no process still fails at once, as before, unless it matches a known missing-process message (such as "not found"). Released as 1.0.7.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/process.mjs` | modified | check named pids before a failure counts; "not found" shortcut moved |
| `tests/process.test.mjs` | added tests | exiting children, live child, live root, mixed output, output with no PID |
| `README.md` | modified | "Differences from the Codex plugin" entry |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.7 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.7 |

## Diff Highlights (optional)

```js
// taskkill /T also fails on short-lived children, such as gh.exe at Copilot's start, that exit
// while it walks the tree. Only a process that is still alive after the wait is a failure. Each
// line names its process first; a later PID is its parent, which can be this process itself.
const named = combinedOutput
  .split(/\r?\n/)
  .filter((line) => !/^SUCCESS/i.test(line.trim()))
  .map((line) => /\bPID\s+(\d+)/i.exec(line)?.[1])
  .filter(Boolean)
  .map(Number);
```

## Tests Added or Updated

- `tests/process.test.mjs` "terminateProcessTree reports success when taskkill names children that exit during the wait".
- `tests/process.test.mjs` "terminateProcessTree reports a failed taskkill for a named process that stays alive" (a live child).
- `tests/process.test.mjs` "terminateProcessTree checks every named process even when taskkill also reports a missing one" (also a live root).
- `tests/process.test.mjs` "terminateProcessTree reports a failed taskkill whose output names no process" (for example German "FEHLER: Zugriff verweigert.").

## Local Verification

As recorded in PR #43:

- Commands run: `npm test` → 239 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass (Windows).

## Deviations from Assessment

- Only the first `PID <n>` on each line is checked; a later pid is the parent, which can be the caller (code review before commit).
- Pids on `SUCCESS` lines are skipped, because they may already be reused (code review before commit).
- Output that names no process fails at once, as before, unless it matches a known missing-process message (such as "not found") (Copilot review, round 1).
- The "not found" shortcut no longer skips the checks when another line names a process that could not be stopped (Codex review, round 1).
- A live child is named in the error (`Still running: PID <n>.`), but its pid is not stored. The job keeps only its root pids for a retry, as before. A retry on a root that has exited cannot reach the child; that became #44.

## Follow-ups

- #44: a retry runs `taskkill` only on the stored root pid, so a child that survives after its root exits is never reached again (CodeRabbit review of PR #43).
