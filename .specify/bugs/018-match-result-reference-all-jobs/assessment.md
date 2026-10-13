# Bug Assessment: /copilot:result with a running job's id shows another job's result

- **Slug**: 018-match-result-reference-all-jobs
- **Created**: 2026-10-13
- **Source**: pasted text (issue #18 and its comments). Written by hand on 2026-10-13, after the fix merged in PR #41, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

Issue #18, "Match an explicit result reference against all jobs first" (2026-10-08):

> `resolveResultJob` in `plugins/copilot/scripts/lib/job-control.mjs` filters the jobs to finished ones before it matches an explicit job reference. So the exact id of a running job can match a different, finished job by prefix. For example, with a running `task-abc` and a finished `task-abcdef`, `/copilot:result task-abc` returns the result of `task-abcdef`. When no finished job has that prefix, the user gets "No job found" instead of the "is still running" message.
>
> This bug comes from upstream codex-plugin-cc (commit `db52e28`).

Comment (2026-10-09): the Copilot review of PR #21 found the second symptom, "`No job found for "<id>"`" for the full id of a queued or running job. Comment (2026-10-11): already reported upstream as openai/codex-plugin-cc#498, which covers the "No job found" case only.

## Symptom

`/copilot:result <id>` with the exact id of a queued or running job shows the result of a different, finished job whose id starts with that text, or says "No job found". Expected: the command says that the job is still queued or running.

## Reproduction

1. Store two jobs in one workspace: `task-abc` (running) and `task-abcdef` (completed).
2. Call `resolveResultJob(cwd, "task-abc")`.
3. It returns `task-abcdef`.
4. With only `task-abc` (running), the same call throws `No job found for "task-abc"`.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/job-control.mjs:262-286` `resolveResultJob()` (at `9bd07f0`): it calls `matchJobReference` with a filter that keeps only finished jobs. `matchJobReference` throws "No job found" before the branch for active jobs can run.
- `resolveCancelableJob()` in the same file: PR #21 already changed cancel to match all jobs first. It is the model for the fix.

## Root Cause Hypothesis

The reference is matched only against finished jobs, so a prefix match on a finished job wins over an exact match on an active job. Confidence: high.

## Proposed Remediation

**Preferred**: in `resolveResultJob`, match an explicit reference against all jobs of the workspace (exact id, then a unique prefix). Then check the matched job's status. Keep the errors for an ambiguous prefix and an unknown reference. A call without a reference still picks the newest finished job of the current session. Add the change to the README section "Differences from the Codex plugin" (correctness).

**Files likely to change**:
- `plugins/copilot/scripts/lib/job-control.mjs`
- `tests/job-control.test.mjs`
- `README.md`

**Tests to add or update**:
- A running `task-abc` with a finished `task-abcdef`: `resolveResultJob(cwd, "task-abc")` says `task-abc` is still running.
- The exact id of a finished job still wins over a longer id with the same prefix.
- The full id of a running job, with no finished job of that prefix, says it is still running, not "No job found" (asked in the issue comment of 2026-10-09).

## Risks & Considerations

- A short prefix that fits both a finished and a running job becomes ambiguous. Before, it picked the finished job.

## Open Questions

- None.

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #41, not only the plan above.

- I. Upstream parity: met. The change departs from upstream for correctness, which Principle I allows. The README lists it, and the file's change notice says it.
- II. Only reviewed code: met. The fix is written in this repo and follows `resolveCancelableJob`.
- III. Copilot CLI through documented interfaces: not relevant. No Copilot call changes.
- IV. Safe by default: not relevant. Reading a job result writes nothing.
- V. Cross-platform: met. No OS-specific code; CI runs the tests on Windows, macOS and Linux.
- VI. Tested: met. New tests in `tests/job-control.test.mjs`.
