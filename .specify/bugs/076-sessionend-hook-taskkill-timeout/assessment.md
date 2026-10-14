# Bug Assessment: SessionEnd hook can pass its timeout when taskkill is slow

- **Slug**: 076-sessionend-hook-taskkill-timeout
- **Created**: 2026-10-14
- **Source**: pasted text (GitHub issue #76, filed by the owner)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

Issue #76, "Keep the SessionEnd hook inside its timeout when taskkill is slow":

> The SessionEnd hook must end inside Claude Code's 5 s hook timeout. `cleanupSessionJobs` plans a
> 3500 ms budget, but two parts of the Windows stop are outside it: `terminateProcessTree` runs
> `taskkill /PID <pid> /T /F` with no time limit, and the hook computes `forceKillAfterMs` before the
> stops start, but on Windows that wait starts only after `taskkill` returns.
>
> Requirements: give each `taskkill` a time limit tied to the hook's deadline and count its time
> against the budget; a `taskkill` that runs out of time is a stop that did not finish, so the job
> keeps its pids; keep `/copilot:cancel` as it is apart from the time limit; no shell, and no change
> to the result shape of `terminateProcessTree`.
>
> Acceptance: a test with a `taskkill` runner that never ends shows that `cleanupSessionJobs` ends
> before its budget and keeps the job with its pids; a test with a slow `taskkill` that names a live
> child shows that the wait after it ends at the deadline; `npm test` and CI pass on all three
> systems.

## Symptom

On Windows, the SessionEnd hook can run past Claude Code's 5 s hook timeout when `taskkill` is slow
or stalls. Claude Code then kills the hook before its last state update, and the stopped jobs stay
in the job list. Expected: the hook ends inside its budget and always runs its last update.

## Reproduction

1. On Windows, start a background task, so the session has a running job with `pid` and
   `copilotPid`.
2. End the Claude session while `taskkill` is slow (for example under heavy load), or give
   `terminateProcessTree` a runner that never returns.
3. `cleanupSessionJobs` waits for `taskkill` with no limit, and the wait after it starts only when
   `taskkill` returns. The hook does not end inside 3500 ms.

The stall itself was not seen on a real system; the code shows that nothing bounds it.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/process.mjs:terminateProcessTree()` (Windows branch, about line 232):
  `await runCommandImpl("taskkill", ...)` has no time limit, and `deadline` for the alive wait is set
  only after `taskkill` returns (about line 276). On macOS and Linux the wait starts right after an
  instant `SIGTERM`, so there `forceKillAfterMs` already counts from the start of the stop.
- `plugins/copilot/scripts/lib/process.mjs:runCommandAsync()` (about line 43): the runner has no
  time limit and no way to stop the command.
- `plugins/copilot/scripts/session-lifecycle-hook.mjs:cleanupSessionJobs()` (about line 124):
  computes `forceKillAfterMs` from the time left minus the 500 ms reserve, and expects the stops to
  end inside it.

## Root Cause Hypothesis

On Windows, `forceKillAfterMs` bounds only the alive check after `taskkill`, not `taskkill` itself.
The hook's arithmetic assumes it bounds the whole stop, as it does on macOS and Linux. Confidence:
high.

## Proposed Remediation

**Preferred**: the hook passes one absolute `deadline` to every stop, and on Windows that deadline
bounds `taskkill` as well as the wait after it. Without a `deadline`, cancel and the other callers
keep their wait; only `taskkill` gets a time limit.

- `runCommandAsync` gets a `timeoutMs` option. When it is set (also `0`, so the check is
  `!== undefined`) and the command has not closed in time, the runner first resolves with
  `status: null` and an `error` with code `ETIMEDOUT` and the message
  `<command> <args> did not end within <n> ms.` Then it stops the command (`child.kill()`, in a
  `try`, because Node can throw or emit `error` from inside `kill`), and in `finally` destroys its
  pipes and unrefs it, so nothing holds the event loop open. Because the promise has already
  settled, a kill error, a late `close` or a late `error` changes nothing. The timer is cleared on
  `close` and on `error`. Without the option, nothing changes.
- `terminateProcessTree` gets a `deadline` option (an absolute `Date.now()` time). When it is
  given, it wins over `forceKillAfterMs`; a value that is not a finite number counts as no deadline.
  - On Windows with a `deadline`: it computes the time left once. If it is 0 or less, it rejects
    with an `ETIMEDOUT` error and starts no `taskkill`. Otherwise it passes that time as
    `timeoutMs`, and the alive wait after a failed `taskkill` ends at the same deadline. (The timer
    starts after `spawn` returns; a slow `spawn` is covered by the 500 ms reserve.)
  - On Windows without a `deadline` (cancel, prompt-mode close, the review gate): `taskkill` gets
    its own fixed limit, `TASKKILL_TIMEOUT_MS = 5000`, and the alive wait after it is a full
    `forceKillAfterMs` (default 5000 ms), as now. The limit is not `forceKillAfterMs`, because a
    caller that asks for a short alive wait must not kill a healthy `taskkill`.
  - On macOS and Linux, the wait before `SIGKILL` ends at `deadline` when it is given, else
    `forceKillAfterMs` after `SIGTERM`, as now.
  - A timed-out `taskkill` rejects with the runner's error, as other start errors already do. The
    error has no `orphans` mark, so `cleanupSessionJobs` keeps the job and its pids, and
    `/copilot:cancel` keeps the pid and says the stop failed.
- `cleanupSessionJobs` computes one stop deadline before the stops start,
  `Date.now() + max(0, min(STOP_WAIT_MS, timeLeft() - FINAL_UPDATE_RESERVE_MS))`, and passes it as
  `{ deadline }` to every `terminate` call in place of `forceKillAfterMs`. Stops that start a few
  milliseconds later share the same end, so the 500 ms reserve for the last update holds.

The result shape of `terminateProcessTree` does not change. Prompt-mode close and the review gate
call it with no options, so they also get the 5000 ms `taskkill` limit. This is on purpose: a
`taskkill` that stalls would hang them too, and both already handle a rejected stop (prompt-mode
turns it into a failed run, the gate adds it to its errors).

**Alternatives**:
- Make `forceKillAfterMs` bound the whole Windows stop for every caller, with no new option.
  Rejected after review: a cancel whose `taskkill` takes 1 s would then get only 4 s for the alive
  check, and the issue says to keep cancel as it is apart from the time limit. Each stop would also
  start its own clock, so stops that start later would end later than the hook planned.
- Race `taskkill` against a timer in `terminateProcessTree` only. Rejected: the stalled `taskkill`
  keeps running and holds the hook's event loop open, so the hook still does not exit.

**Files likely to change**:
- `plugins/copilot/scripts/lib/process.mjs`
- `plugins/copilot/scripts/session-lifecycle-hook.mjs`
- `tests/process.test.mjs`
- `tests/runtime.test.mjs`
- `README.md` ("Differences from the Codex plugin": the Windows `taskkill` and SessionEnd bullets)
- Release files: the version in the manifests (`npm run bump-version`) and `plugins/copilot/CHANGELOG.md`

**Tests to add or update** (timing checks use loose upper limits and poll for process exit, so a
slow CI runner does not make them fail):
- `tests/process.test.mjs`: `runCommandAsync` with `timeoutMs` stops a real `node` command that
  never ends (it prints its pid first): it resolves with `ETIMEDOUT` and `status: null`, not before
  the limit minus 50 ms (timers can fire early) and well before the limit plus a few seconds, and
  the command's process is gone (polled). The child is killed in `finally`. With `timeoutMs: 0`
  the same command also resolves with `ETIMEDOUT`.
- `tests/process.test.mjs`: the runner holds no handle open after it resolves: a child `node` that
  calls `runCommandAsync` with `timeoutMs: 60000` on a command that ends at once and on a missing
  command (`ENOENT`), and with `timeoutMs: 200` on a command that never ends, exits within a few
  seconds.
- `tests/process.test.mjs`: on Windows, `terminateProcessTree` passes `deadline - Date.now()` as
  `timeoutMs` when a `deadline` is given, and 5000 when not (also with a small `forceKillAfterMs`);
  it rejects with the runner's `ETIMEDOUT` error.
- `tests/process.test.mjs`: a `deadline` that has passed rejects with `ETIMEDOUT` and never calls
  the runner.
- `tests/process.test.mjs`: a slow `taskkill` runner (it returns after 1500 ms) that names a live
  child, with a `deadline` 1800 ms after the start (and a `forceKillAfterMs` that the deadline
  overrides), rejects with `Still running` before 3000 ms. A wait that started fresh after the
  runner would end at 3300 ms, and the wait without a deadline at 6500 ms.
- `tests/process.test.mjs`: on macOS and Linux (`platform: "linux"`, injected `killImpl`), a
  target that ignores `SIGTERM` gets `SIGKILL` at a `deadline` 300 ms away, well before the 5000 ms
  default, and at once when the `deadline` has passed.
- `tests/runtime.test.mjs`: `cleanupSessionJobs` with a `taskkill` runner that never ends (the real
  `runCommandAsync` on a `node` process that waits forever, with `platform: "win32"` passed through
  `terminateImpl`, so it runs on every system) ends before its 3500 ms budget (the stops end about
  2000 ms after they start) and keeps the job as `cancelled` with both pids.

## Risks & Considerations

- A `taskkill` stopped by the time limit may have stopped part of the tree. The job keeps both
  pids, as the issue asks, so a new cancel runs `taskkill` again; a pid that is gone gives "not
  found", which counts as stopped. If the root has exited but children it started are still alive,
  a new `taskkill` cannot reach them (the same limit as today for any root that exited). That case
  is rare (`taskkill` usually stops the children first) and is not solved here.
- `child.kill()` on Windows ends the `taskkill` process at once (`TerminateProcess`). If it fails,
  Node throws or emits `error`; the promise has already settled with `ETIMEDOUT`, and the pipes are
  still destroyed. A failing `kill` is not tested: the runner has no seam to make it fail, and the
  order of the calls gives the result. No shell is added (constitution Principle IV).
- With no time left before the stop deadline, no `taskkill` starts and the stop counts as not
  finished. That is right: the 500 ms reserve is for the last update. This is a deliberate change:
  before, a stop with no wait left still ran `taskkill` (or, with no `taskkill`, the instant `kill`
  fallback). Now, after a long state-lock wait, the hook may start no stop at all, and the jobs keep
  their pids for `/copilot:cancel`. Windows always has `taskkill`, so the fallback matters little.
- The existing Windows SessionEnd tests in `tests/runtime.test.mjs` run the real `taskkill` under
  the hook's stop deadline (up to 2000 ms). One `taskkill` takes 750 to 1400 ms, so a very slow CI
  runner could now see a stop that did not finish there. They are not changed in advance; a CI
  failure there is handled as a test failure in Step 5.
- Upstream parity: upstream runs `taskkill` with no time limit. The function names and result shape
  stay the same; `deadline` and `timeoutMs` are new optional options. The reason for the difference
  is correctness (the hook timeout).

## Open Questions

None.

## Constitution Check

- **I. Upstream parity**: met. `terminateProcessTree`, `runCommandAsync` and `cleanupSessionJobs`
  keep their names, modules and result shapes; `deadline` and `timeoutMs` are new optional
  options. The difference from upstream (a time limit on `taskkill`, and one deadline for the
  hook's stops) is for correctness, and the README "Differences from the Codex plugin" bullets on
  Windows `taskkill` and SessionEnd will say so. The "Changed from upstream" notices of both files
  are updated.
- **II. Only reviewed code**: met. The code is written in this repo; no dependency is added.
- **III. Copilot CLI through documented interfaces only**: not relevant. No Copilot call or argument
  changes.
- **IV. Safe by default**: met. The runner still uses `spawn` with an argument array and
  `shell: false`; it only adds a timer and `child.kill()`. No review path changes; no token is
  logged.
- **V. Cross-platform**: met. The time limit is in the shared runner and the Windows branch; the new
  tests use injected runners or a real `node` child, so they run on every system in CI.
- **VI. Tested, including failure paths**: met. New tests cover the timeout failure path (a runner
  that never ends, at the runner and at the SessionEnd cleanup), a deadline with no time left, a
  slow `taskkill` with a live child, and the timer cleanup after a normal end and a spawn error;
  cancel with the child stopped is covered by the existing cancel and SessionEnd tests. This
  is a patch release, so a release run follows the merge.
