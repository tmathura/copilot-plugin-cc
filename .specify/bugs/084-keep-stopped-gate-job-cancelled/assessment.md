# Bug Assessment: Keep a stopped gate job cancelled when its companion saves it as failed first

- **Slug**: 084-keep-stopped-gate-job-cancelled
- **Created**: 2026-10-20
- **Source**: pasted text (GitHub issue #84, https://github.com/tmathura/copilot-plugin-cc/issues/84). The CI run link in the report (host `github.com`, allowlisted) was not fetched: the report quotes the failing assertion, and the code confirms the cause.
- **Verdict**: valid
- **Severity**: low

## Report (verbatim or summarized)

When the Stop gate's review runs past its limit, the gate stops its companion and then cancels the
job. On Windows the job can end `failed` instead of `cancelled`, without the message "The stop-time
review timed out." Seen in PR #83, CI run
https://github.com/tmathura/copilot-plugin-cc/actions/runs/38798188101 (attempt 2), job
`CI (windows-latest)`: the test "a gate run past its limit blocks, stops the companion, Copilot and
its child, and removes the patch folder" (`tests/runtime-gate-stop.test.mjs:95`) got `'failed'` in
place of `'cancelled'`. The rerun passed.

## Symptom

After the gate stops a review that ran past its limit (or that a signal stopped), the gate's job can
stay `failed` with the companion's own error, not `cancelled` with the gate's reason. The gate's
answer to Claude (block, "timed out") is right; only the stored job is wrong.

## Reproduction

1. Turn the review gate on and run the Stop hook with a review that does not end before the limit
   (the fake Copilot `hang` behaviour, a short `timeoutMs`).
2. On Windows, `taskkill /T /F` stops Copilot before the companion. The companion's runner sees
   Copilot end, fails, and saves the job as `failed` before it is stopped itself.
3. The gate then looks for its job with status `running`, finds none, and leaves the `failed` job.

The race depends on the order in which `taskkill` stops the tree, so step 2 happens only sometimes.
A test can force it with the `terminateImpl` seam: stop the tree, then save the job as `failed` as
the companion's runner does, before the gate's cancel runs.

## Suspected Code Paths

- `plugins/copilot/scripts/stop-review-gate-hook.mjs:174-181` (`cancelCompanionJob`): finds the
  gate's job only when its status is `running`.
- `plugins/copilot/scripts/stop-review-gate-hook.mjs:228-236` (`runCompanionTask`, the timeout and
  signal branch): stops the companion, then calls `cancelCompanionJob`.
- `plugins/copilot/scripts/lib/tracked-jobs.mjs:225-262` (`runTrackedJob`, the runner's `catch`):
  saves `failed` while the record is still `running`.
- `plugins/copilot/scripts/copilot-companion.mjs:1159-1184` (`cancelJob`): refuses a job that is not
  active and has no pending stop ("already failed"), and keeps the outcome of a finished job whose
  stop is pending.

## Root Cause Hypothesis

The gate's stop path treats "the companion saved `failed`" as "nothing to cancel". Both checks,
the `running` filter in `cancelCompanionJob` and the active-job check in `cancelJob`, are right for a
job that ended by itself, but in the gate's stop path a `failed` record was caused by the gate's own
stop. Confidence: high. The code allows exactly this order, and the failed assertion shows it.

## Proposed Remediation

**Preferred**: give `cancelJob` an internal option, `overrideFailed`. With it, a `failed` job passes
the active-job check and is rewritten to `cancelled` with the given reason, `phase: "cancelled"`,
`completedAt` and `cancelledAt`, in the same locked step that a cancel of a running job uses. Its
pids (normally null after the runner's `catch`; a `copilotPid` that could not be stopped stays) are
stopped as for any cancel. Without the option nothing changes, so `/copilot:cancel` still refuses a
finished job with no pending stop, and still keeps the outcome of one with a pending stop. A `completed` or `cancelled` job is never rewritten. In the gate,
`cancelCompanionJob` gets a matching flag: in the timeout and signal branch only, it also finds the
gate's job when it is `failed`, and passes `overrideFailed`. The order stays: the companion's tree
is stopped first, then the job is cancelled, so no new Copilot can start. After the stop, the
companion cannot write again, and `runTrackedJob` writes only over a `running` record, so the
`cancelled` status stays. The branch for a companion that ended by itself ("ended before its job
did") is unchanged: there, `failed` is a real failure.

**Alternatives**:
- The gate rewrites the record itself with `updateState` and `writeJobFile`. Rejected: it repeats the
  lock, log and pid handling that `cancelJob` already has.
- Stop Copilot before the companion. Rejected: the issue asks to keep the order, because a companion
  that still runs could start a new Copilot.

**Files likely to change**:
- `plugins/copilot/scripts/copilot-companion.mjs` (`cancelJob`)
- `plugins/copilot/scripts/stop-review-gate-hook.mjs` (`cancelCompanionJob`, its call in the stop
  branch, the comment above it, and the "Changed from upstream" notice)
- `tests/runtime-gate-stop.test.mjs` (a new test; the existing tests and their limits are unchanged)
- `tests/runtime-jobs.test.mjs` (a `cancelJob` test for the option, next to the other `cancelJob`
  tests)
- `tests/runtime-hooks.test.mjs` (one check in the existing `fail` case)
- Release: `npm run bump-version -- 1.0.15` and a `plugins/copilot/CHANGELOG.md` entry (patch: a fix
  of a stored job status that users see in `/copilot:status`).

**Tests to add or update**:
- `tests/runtime-gate-stop.test.mjs`: a gate run whose `terminateImpl` stops the tree and then saves
  the job as `failed` (status `failed`, `pid` null, the companion's error) before the gate's cancel.
  Once past the limit: the job ends `cancelled` with "The stop-time review timed out.". Once stopped
  by a signal (`process.emit("SIGTERM")`, as the existing test does): it ends `cancelled` with "The
  stop-time review was stopped.". In both, `pid` and `copilotPid` end null.
- `tests/runtime-jobs.test.mjs`: `cancelJob` with `overrideFailed` turns a `failed` job that still
  has a `copilotPid` into `cancelled` with the reason, and stops that pid. Without the option, a
  `failed` job with no pids is still refused. With the option, a `completed` job is still refused.
- `tests/runtime-hooks.test.mjs:250`, the `fail` case: one added check that a run whose companion
  ended by itself with `failed` keeps its job `failed`, so the override cannot reach that branch.

## Risks & Considerations

- The option is internal (no CLI flag), so `/copilot:cancel` behaviour is unchanged.
- A run that failed for its own reason just before the limit also ends `cancelled` with the gate's
  reason, which replaces its own error message. The gate's reply to Claude is the same either way:
  the run was past its limit.
- A job that `completed` just as the limit was reached keeps `completed`: the review had a result,
  and the gate's reply already says it timed out.
- The README "Differences from the Codex plugin" bullet already says the gate marks the job
  cancelled; the fix makes that true in this race. No README change is needed.

## Open Questions

None.

## Constitution Check

- **I. Upstream parity**: met. Upstream's gate does not cancel its job at all (README "Differences
  from the Codex plugin" already says so). `cancelJob` keeps its name, module and result shape; the
  option is new and optional. The "Changed from upstream" notice of `stop-review-gate-hook.mjs` is
  updated.
- **II. Only reviewed code**: met. No dependency is added.
- **III. Copilot CLI through documented interfaces only**: not relevant. No Copilot call changes.
- **IV. Safe by default**: met. No user-facing cancel can now rewrite a finished job; the override is
  reachable only from the gate's own stop path, for the gate's own run id.
- **V. Cross-platform**: met. The race is Windows-only in practice, but the fix and the new tests
  do not depend on the OS: the test forces the order with `terminateImpl`.
- **VI. Tested, including failure paths**: met. The new tests cover the failure path (a job already
  `failed` when the gate cancels it, after the limit and after a signal), a `failed` job that keeps
  a `copilotPid`, the refusals without the option, and a natural failure that stays `failed`. CI
  runs them on ubuntu, macOS and Windows. This is a patch release, so a release run follows the
  merge.
