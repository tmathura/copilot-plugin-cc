# Bug Fix: A cancel retry cannot reach a child that survived after its parent exited

- **Slug**: name-surviving-child-pids
- **Fixed**: 2026-10-13
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #50 (squash commit `871329de310308fa373007c97da6178886f6ea49`), for #59.

## Summary

The cancel error now names a child whose parent has exited and says to end it in Task Manager if it is still a Copilot or gh process. It asks for a retry only when a stored pid is still alive. No child pid is stored or signalled. SessionEnd follows the same rule. Released as 1.0.12.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/process.mjs` | modified | a failed Windows stop's error carries `stillRunning` and `orphans` |
| `plugins/copilot/scripts/copilot-companion.mjs` | modified | `cancelJob` builds one message from every failed stop; clears an exited stored pid |
| `plugins/copilot/scripts/session-lifecycle-hook.mjs` | modified | an orphan-only stop counts as done; the job keeps a note that names the child |
| `tests/process.test.mjs` | added test | `orphans` set only when the root has exited |
| `tests/runtime.test.mjs` | added tests | cancel and SessionEnd orphan cases |
| `README.md` | modified | the #25 entry |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.12 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.12 |

## Diff Highlights (optional)

```js
// A new taskkill on a root that has exited cannot reach its children, so the caller must not
// offer a retry for them.
throw Object.assign(
  new Error(`${formatCommandFailure(result)}\nStill running: ${alive.map((candidate) => `PID ${candidate}`).join(", ")}.`),
  { stillRunning: alive, orphans: !alive.includes(pid) }
);
```

## Tests Added or Updated

- `tests/process.test.mjs` "a failed taskkill marks whether only children whose root has exited are left".
- `tests/runtime.test.mjs` "a cancel that leaves a child whose parent exited names it and asks for a retry only when one can help" (one orphan, the same orphan twice, an orphan plus a root failure, an `undefined` reason, and the job's own Copilot pid as the "orphan").
- `tests/runtime.test.mjs` "a cancel whose record cannot be cleared after an orphan-only stop names the child and asks for a retry".
- `tests/runtime.test.mjs` "SessionEnd clears a pid whose stop shows it has exited, keeps one that can still be stopped, and names a child it left".

## Local Verification

As recorded in PR #50:

- Commands run: `npm test` → 247 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass (Windows).

## Deviations from Assessment

- The choice: name the child in the error, and do not store child pids. Rejected: store them and signal them on a retry, because Windows reuses pids quickly (PR #50).
- A stored pid whose own stop shows that it has exited is cleared, so the job does not stay pending (Copilot PR review, round 4).
- SessionEnd counts an orphan-only stop as done, clears that pid, and keeps the job with a note in `errorMessage` that names the child (Copilot PR review, rounds 5 and 8). The issue named only `cancelJob`.
- A failure to clear an exited pid gives an error that keeps the orphan names and asks for a retry (Copilot PR review, round 7).

## Follow-ups

- None.
