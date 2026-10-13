# Bug Assessment: A cancel retry cannot reach a child that survived after its parent exited

- **Slug**: name-surviving-child-pids
- **Created**: 2026-10-13
- **Source**: pasted text (issue #44). Written by hand on 2026-10-13, after the fix merged in PR #50, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: low

## Report (verbatim or summarized)

Issue #44, "Keep the pids of child processes that survive a cancel, so a retry can stop them" (2026-10-12):

> `cancelJob` in `plugins/copilot/scripts/copilot-companion.mjs` keeps only the job's root pids (`pid` and `copilotPid`) for a retry. On Windows, `terminateProcessTree` runs `taskkill /PID <root> /T /F`. If `taskkill` cannot stop a child (for example "Access is denied") while the root exits, the stop fails and the job keeps the root pid. A retry then runs `taskkill` on the root, which no longer exists. It reports "not found", the pid is cleared, and the child that survived is never reached again.
>
> After #25 (PR #43), the error names the surviving process (`Still running: PID <n>.`), but its pid is not stored. The CodeRabbit review of PR #43 found this. The same gap existed before #25.
>
> On macOS and Linux the stop signals the process group, so a retry still reaches a child in that group while the group exists.

## Symptom

On Windows, when `taskkill /T` cannot stop a child while its root exits, cancel fails and says "Run /copilot:cancel <id> again". The retry cannot reach the child, so the advice does not help, and nothing tells the user what to do. Expected: a retry stops the child, or the error names the child and says what to do.

## Reproduction

1. On Windows, cancel a job whose Copilot tree has a child that `taskkill` cannot stop (for example "Access is denied"), while the root exits.
2. Cancel fails with `Still running: PID <child>.` and "Run /copilot:cancel <id> again."
3. Run the cancel again: `taskkill` on the root says "not found", the pid is cleared, and the child keeps running.

The case needs a process that `taskkill` cannot stop. The tests use injected `terminate` results instead.

## Suspected Code Paths

At `e7a6b80`:

- `plugins/copilot/scripts/copilot-companion.mjs:1159` `cancelJob()`: stores only `pid` and `copilotPid`; line 1207 always asks for a retry when a stop fails.
- `plugins/copilot/scripts/lib/process.mjs` `terminateProcessTree()`, Windows branch: the error names the pids still alive, but does not say whether the root is among them.
- (Reconstructed from PR #50, not in the issue.) `plugins/copilot/scripts/session-lifecycle-hook.mjs` `cleanupSessionJobs()`: keeps the same root pids for a later cancel.

## Root Cause Hypothesis

A retry can only signal the stored root pids, and `taskkill /T` on a root that has exited cannot reach its children. The error does not tell the caller which case it is. Confidence: high (follows from how `taskkill /T` works and from the stored record).

## Proposed Remediation

**Preferred** (the issue offered two ways, and asked to pick one):
- store the pids that `terminateProcessTree` reports as still running in the job record, and stop them on a retry; or
- keep the current record, and say in the cancel error which process is still running and that a retry cannot reach it.

Do not signal a stored child pid that has exited, because Windows reuses pids quickly.

**Files likely to change**:
- `plugins/copilot/scripts/copilot-companion.mjs`
- `plugins/copilot/scripts/lib/process.mjs`
- `tests/runtime.test.mjs`, `tests/process.test.mjs`
- `README.md`

**Tests to add or update**:
- A cancel whose root exits while a child stays alive either stops that child on the retry, or names it in the error with what to do.
- A pid that has exited is not signalled again.

## Risks & Considerations

- A stop signal to a reused pid could end an unrelated process.
- (Reconstructed from PR #50.) SessionEnd uses the same stop path, so it needs the same rule.

## Open Questions

- None left. PR #50 records the choice (see `fix.md`).

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #50, not only the plan above.

- I. Upstream parity: met. The change extends the #25 entry in the README section "Differences from the Codex plugin" (correctness).
- II. Only reviewed code: met. The fix is written in this repo.
- III. Copilot CLI through documented interfaces: not relevant. No Copilot call changes.
- IV. Safe by default: met. No signal goes to a child pid, so a reused pid is never hit.
- V. Cross-platform: met. Only the Windows stop sets the new error fields; the tests use injected results, so CI runs them on every OS.
- VI. Tested: met. Cancel with the child process stopped is a Principle VI failure path; new tests cover the orphan cases and SessionEnd.
