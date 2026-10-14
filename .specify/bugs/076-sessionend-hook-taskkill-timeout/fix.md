# Bug Fix: SessionEnd hook can pass its timeout when taskkill is slow

- **Slug**: 076-sessionend-hook-taskkill-timeout
- **Fixed**: 2026-10-14
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`taskkill` now has a time limit, and the SessionEnd hook passes one absolute deadline to every stop,
so on Windows the whole stop (`taskkill` and the wait after it) ends by that deadline. A `taskkill`
that runs out of time while its process is still alive, or that has no time left to start, is a
stop that did not finish: the job keeps its pids for `/copilot:cancel`. Cancel and the other callers keep their wait and get a fixed
5000 ms `taskkill` limit.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/process.mjs` | modified | `runCommandAsync` `timeoutMs`: settle with `ETIMEDOUT`, then kill, destroy pipes and unref; `terminateProcessTree` `deadline` option; `TASKKILL_TIMEOUT_MS`; `stopDeadline` and `hasDeadline` helpers; notice updated |
| `plugins/copilot/scripts/session-lifecycle-hook.mjs` | modified | one `stopDeadline` passed as `{ deadline }` to every stop; notice updated |
| `tests/process.test.mjs` | added tests | runner time limit, no handles left, Windows deadline and limits, no time left, slow `taskkill`, Linux deadline |
| `tests/runtime.test.mjs` | added test | SessionEnd with a `taskkill` that never ends |
| `README.md` | modified | new "Differences" bullet on the `taskkill` time limit; SessionEnd bullet says "one shared deadline" |
| `plugins/copilot/CHANGELOG.md`, version files | modified | 1.0.14 (patch) |

## Diff Highlights (optional)

```js
// terminateProcessTree, Windows
let timeoutMs = TASKKILL_TIMEOUT_MS;
if (hasDeadline(options)) {
  timeoutMs = options.deadline - Date.now();
  if (timeoutMs <= 0) {
    throw Object.assign(new Error(`taskkill /PID ${pid} /T /F was not started: no time was left.`), { code: "ETIMEDOUT" });
  }
}
```

```js
// cleanupSessionJobs
const stopDeadline = Date.now() + Math.max(0, Math.min(STOP_WAIT_MS, timeLeft() - FINAL_UPDATE_RESERVE_MS));
... terminate(job[key], { deadline: stopDeadline })
```

## Tests Added or Updated

- `tests/process.test.mjs::runCommandAsync stops a command that runs past its time limit`: `ETIMEDOUT`, `status: null`, the command's process is gone; `timeoutMs: 0` also times out.
- `tests/process.test.mjs::runCommandAsync leaves nothing that keeps its caller alive after it settles`: a child `node` exits at once after a normal end, an `ENOENT` and a timeout, with 60 s timers set.
- `tests/process.test.mjs::terminateProcessTree on Windows gives taskkill the time to its deadline, or 5 s without one`: the deadline wins over `forceKillAfterMs`; a `NaN` deadline counts as none.
- `tests/process.test.mjs::terminateProcessTree on Windows rejects when taskkill runs out of time, unless the root has exited`.
- `tests/process.test.mjs::terminateProcessTree on Windows starts no taskkill when its deadline has passed`.
- `tests/process.test.mjs::terminateProcessTree on Windows ends the wait after a slow taskkill at its deadline`: acceptance criterion 2.
- `tests/process.test.mjs::terminateProcessTree on macOS and Linux sends SIGKILL at its deadline`.
- `tests/runtime.test.mjs::SessionEnd ends inside its budget when taskkill never ends, and keeps the job with its pids`: acceptance criterion 1.

## Local Verification

- Commands run: `node --test tests/process.test.mjs` → 42 pass, 5 skipped (POSIX-only, on Windows);
  `node --test --test-name-pattern=SessionEnd tests/runtime.test.mjs` → 10 pass (the new test took
  about 2080 ms, inside the 3500 ms budget).
- Manual checks: none.

## Deviations from Assessment

- 2026-10-14, Step 6 code review: after a timed-out `taskkill`, `terminateProcessTree` now checks
  whether the root pid is still alive. If it has exited, the stop counts as done and the pid is
  cleared. Reason: a pid that has exited can be reused, and a retry would then stop another
  program; the hook and cancel already clear such pids. The assessment said that a timed-out
  `taskkill` always keeps the pids (the issue's wording); it now keeps only a pid that is still
  alive. Rejected alternative: keep every pid, as first planned. The test "rejects when taskkill
  runs out of time" became "rejects when taskkill runs out of time, unless the root has exited",
  and the runner time-limit test uses 3000 ms, not 1500 ms, so a slow runner can start `node`.
  `runCommandAsync` builds its result in one `finish` helper.
- 2026-10-14, Step 7b Codex and Copilot round 1: a timed-out `taskkill` whose root has exited now
  also checks the children that `taskkill` named in its output before it ran out of time, with no
  wait. If one is still alive, the stop rejects with the existing `orphans` / `stillRunning` error,
  so the caller clears the root's pid and keeps the note that names the child. Reason: the first
  version reported success and lost that note. The parsing of named processes moved into one
  helper, `namedByTaskkill`, used by both paths. New test: "a timed-out taskkill whose root has
  exited still names a child it reported that stays alive". Children that `taskkill` never named
  cannot be known (assessment, Risks).

## Follow-ups

- Watch the Windows SessionEnd tests that run the real `taskkill` under the 2000 ms stop deadline
  in CI (assessment, Risks).
