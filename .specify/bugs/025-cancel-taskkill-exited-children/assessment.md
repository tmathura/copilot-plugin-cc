# Bug Assessment: Cancel reports a failure when taskkill names children that already exited

- **Slug**: 025-cancel-taskkill-exited-children
- **Created**: 2026-10-13
- **Source**: pasted text (issue #25). Written by hand on 2026-10-13, after the fix merged in PR #43, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: low

## Report (verbatim or summarized)

Issue #25, "Do not report a failed cancel when taskkill names children that already exited" (2026-10-11):

> On Windows, `/copilot:cancel` during Copilot's startup often fails with `taskkill /PID <n> /T /F: exit=128 … The process with PID X (child process of PID Y) could not be terminated. Reason: The operation attempted is not supported.` The named processes are short-lived `gh.exe`/`conhost.exe` children (Copilot's GitHub CLI login lookup) that exit by themselves. The job is marked `cancelled` and nothing is left running, but cancel exits 1 and says to run it again. Seen in 2 of 3 cancels in the #12 manual run (PR #24).

## Symptom

On Windows, a cancel during Copilot's start exits 1 and asks for a retry, although every process of the tree has stopped. Expected: cancel succeeds when the whole tree has stopped, and still reports a process that really keeps running.

## Reproduction

1. On Windows, start a background task (`/copilot:rescue --background ...`).
2. Run `/copilot:cancel <job id>` while Copilot is still starting.
3. `taskkill /T /F` fails with exit 128 and names a `gh.exe` or `conhost.exe` child that exits by itself.
4. Cancel exits 1 and says to run it again, while nothing is still running.

The tests reproduce this with a fake `taskkill` result and a fake `kill`.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/process.mjs` `terminateProcessTree()` (at `c2552e6`), Windows branch: any non-zero `taskkill` exit that is not "not found" or `ENOENT` throws at line 230 (`throw new Error(formatCommandFailure(result))`). It does not check whether the named processes are still alive.
- (Reconstructed from the Codex review of PR #43, round 1.) `plugins/copilot/scripts/lib/process.mjs:209-212`: the "not found" shortcut returns at once when any line says a process was not found, also when another line names a process that could not be stopped.

## Root Cause Hypothesis

`taskkill /T` walks the tree and fails on a child that exits during the walk. The plugin takes any `taskkill` failure as a failed stop. Confidence: high (seen in the #12 manual run; the error names short-lived children).

## Proposed Remediation

**Preferred**: in the Windows branch of `terminateProcessTree`, when `taskkill` fails, check whether the root pid and each pid named in its error are still alive, within the existing 5-second limit. Report a failure only for those still alive. Add a test for both cases.

**Files likely to change**:
- `plugins/copilot/scripts/lib/process.mjs`
- `tests/process.test.mjs`
- `README.md`

**Tests to add or update**:
- Children that exit during the wait: success.
- A named process that stays alive: failure, and its pid is kept for a retry.

## Risks & Considerations

- A check must not signal a process; it may only test whether the process is alive.

Reconstructed from the reviews of PR #43 (not in the issue):

- A pid on a `taskkill` line can be the parent, which can be the companion itself; checking it would always find it alive.
- Windows reuses pids quickly, so a pid on a `SUCCESS` line may already belong to another process.
- `taskkill` messages are translated on non-English Windows.

## Open Questions

- None.

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #43, not only the plan above.

- I. Upstream parity: met. The change departs from upstream for correctness, which Principle I allows, and the README lists it.
- II. Only reviewed code: met. The fix is written in this repo.
- III. Copilot CLI through documented interfaces: not relevant. No Copilot call changes.
- IV. Safe by default: met. `taskkill` still runs without a shell; the check uses `kill(pid, 0)`, which sends no signal.
- V. Cross-platform: met. Only the Windows branch changes; the tests use injected fakes, so CI runs them on every OS.
- VI. Tested: met. Cancel with the child process stopped is a Principle VI failure path; new tests cover it.
