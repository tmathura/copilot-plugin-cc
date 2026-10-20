# Bug Fix: Keep a stopped gate job cancelled when its companion saves it as failed first

- **Slug**: 084-keep-stopped-gate-job-cancelled
- **Fixed**: 2026-10-20
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`cancelJob` got an internal `overrideFailed` option, and the Stop gate's timeout and signal branch
uses it. So a job that the companion saved as `failed` while the gate was stopping it now ends
`cancelled` with the gate's reason.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/copilot-companion.mjs` | modified | `cancelJob`: with `overrideFailed`, a `failed` job passes the check and is rewritten to `cancelled` like an active job |
| `plugins/copilot/scripts/stop-review-gate-hook.mjs` | modified | `cancelCompanionJob` takes `{ overrideFailed }`; only the timeout and signal branch passes it; the comment and the "Changed from upstream" notice say so |
| `tests/runtime-gate-stop.test.mjs` | added test | the job is saved `failed` during the stop, once past the limit and once after a signal |
| `tests/runtime-jobs.test.mjs` | added test | `cancelJob` with and without `overrideFailed` |
| `tests/runtime-hooks.test.mjs` | added check | a run whose companion ended by itself keeps `failed` (or `completed`) |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.15 |
| `plugins/copilot/CHANGELOG.md` | modified | the 1.0.15 entry |
| `docs/operations.md` | modified | the job state diagram gets `failed --> cancelled`; the gate bullet says the gate also cancels a job that failed while it was being stopped |

## Diff Highlights (optional)

```js
const cancels = (status) => isActiveJobStatus(status) || (options.overrideFailed && status === "failed");
```

```js
await cancelCompanionJob(options.workspaceRoot, options.runId, reason, { overrideFailed: true }).catch(keepError);
```

## Tests Added or Updated

- `tests/runtime-gate-stop.test.mjs` "a gate run that it stops cancels its job even when the companion
  saved the job as failed while it was being stopped": the `terminateImpl` seam stops the tree, then
  saves the job as `failed`. The job ends `cancelled` with "The stop-time review timed out." (limit)
  or "The stop-time review was stopped." (signal), with no pids, and the patch folder is gone.
- `tests/runtime-jobs.test.mjs` "overrideFailed cancels a failed job ...": a `failed` job with a
  `copilotPid` ends `cancelled` with the reason and its pid is stopped; without the option a `failed`
  job is refused; with the option a `completed` job is refused.
- `tests/runtime-hooks.test.mjs` "above the inline limit ...": the `fail` case keeps its job `failed`.

## Local Verification

- `node --test tests/runtime-jobs.test.mjs tests/runtime-gate-stop.test.mjs tests/runtime-hooks.test.mjs`
  → 42 tests, 41 pass, 1 skipped (the SIGTERM hook test, skipped on Windows as before), 0 fail.
- With the gate's `overrideFailed` set to `false`, the new gate test fails with
  `['failed', 'Copilot exited.', null, null]` in place of `['cancelled', 'The stop-time review timed out.', null, null]`,
  the same mismatch as the CI failure in the issue. Set back to `true`, it passes.
- `npm ci --include=dev`, `npm run build`, `npm test` (287 tests, 0 fail), `npm run check-version`
  (1.0.15) and `claude plugin validate .` pass, on Windows.

## Deviations from Assessment

- 2026-10-20, review round 1: `docs/operations.md` also changed. Its job state diagram gets
  `failed --> cancelled` for the gate's stop, and its gate bullet says the gate also cancels a job
  that failed while it was being stopped. The `CHANGELOG.md` entry no longer says "always", because
  a job that completed at the limit keeps `completed`. The new gate test waits for the job no longer
  than the run limit, and the gate's header comment is wrapped again.
- 2026-10-20, review round 2: the gate's header comment and the `docs/operations.md` gate bullet
  are wrapped again to the width of the lines around them (round 1 left one long line in each).

## Follow-ups

- Own ticket, after this merge: when the companion ends by itself, the gate looks only for a
  `running` job, so a `failed` job that kept its `copilotPid` (Copilot could not be stopped) is
  skipped and that Copilot is not stopped. The code for a companion that ended by itself is the
  same as on `main` (found by code-review in round 1).
