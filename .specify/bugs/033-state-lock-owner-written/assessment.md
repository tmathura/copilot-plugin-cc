# Bug Assessment: A killed process can leave an empty state lock that blocks every later command

- **Slug**: 033-state-lock-owner-written
- **Created**: 2026-10-13
- **Source**: pasted text (issue #33). Written by hand on 2026-10-13, after the fix merged in PR #37, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

Issue #33, "Create the state lock with its owner already written" (2026-10-11):

> `tryCreateLock` in `plugins/copilot/scripts/lib/state.mjs` opens the lock file with `wx`, then writes the owner `{ pid, token }` in a second call. If the process is killed between the two calls, an empty lock stays behind. The code never reclaims a lock with no readable owner, because such a lock may still be in creation. So every later command that needs the state lock fails after 5 s with "The lock has no readable owner; if no Copilot companion is running, delete it and retry." The user must delete the file by hand. The same applies to the `.reclaim` lock, which uses the same function.
>
> The SessionEnd hook can cause this: it sends SIGKILL to job companions after a shared wait (`session-lifecycle-hook.mjs`). A companion that is killed while it takes the lock leaves an empty lock.
>
> Evidence: PR #32 CI, macOS, run 38178068886. The test "SessionEnd stops three running jobs within 5 s, also a Copilot whose companion is dead, and removes only those jobs" (`tests/runtime.test.mjs`) failed at its last `cancel`: "Timed out after 5000 ms waiting for the state lock …/state.json.lock. The state was not changed. The lock has no readable owner". A rerun of the same commit passed.

## Symptom

A process killed between creating the lock file and writing its owner leaves an empty lock. Every later command that needs the state lock times out after 5 s, until the user deletes the file. Expected: a lock file never exists without a readable owner.

## Reproduction

1. Start a companion that takes the state lock.
2. Kill it (SIGKILL) after `fs.openSync(lockFile, "wx")` and before the owner is written.
3. Run `/copilot:status` or `/copilot:cancel`.
4. It fails after 5 s with "The lock has no readable owner".

The timing window is small. CI hit it once (macOS run 38178068886). The tests check the order of the file calls instead of killing a process at that moment.

## Suspected Code Paths

At `343a8ee`, in `plugins/copilot/scripts/lib/state.mjs`:

- `tryCreateLock()` (line 200): `fs.openSync(lockFile, "wx")`, then `fs.writeFileSync(fd, ...)` in a second call.
- `reclaimDeadLock()` (line 230): uses `tryCreateLock` for the `.reclaim` lock.
- `acquireStateLock()` (line 274): retries `tryCreateLock` until the deadline.
- `describeLockBlocker()` (line 260): gives the "no readable owner" message.
- `plugins/copilot/scripts/session-lifecycle-hook.mjs`: SessionEnd kills job companions, which can hit the window.

## Root Cause Hypothesis

Creating the lock name and writing its owner are two steps, so the lock can exist without an owner. The reclaim logic, correctly, never reclaims a lock with no owner, because it cannot tell a dead writer from one still writing. Confidence: high.

## Proposed Remediation

**Preferred**: in `tryCreateLock`, write the owner to a unique temporary file in the same folder, then `fs.linkSync` it to the lock name (it fails with `EEXIST` if the lock exists, as `wx` does), then remove the temporary file. Keep the Windows `EPERM` handling. A temporary file left by a killed process must not block anything. Keep the "no readable owner" message for a lock damaged in another way.

**Files likely to change**:
- `plugins/copilot/scripts/lib/state.mjs`
- `tests/state.test.mjs`

**Tests to add or update**:
- A lock is never seen without an owner.
- A temporary file left behind does not block the next lock.

## Risks & Considerations

- Every state change takes this lock, so a mistake here breaks every command.

Reconstructed from the code review of PR #37 (not in the issue):

- Hard links need a file system that supports them. The data folder is in the user's home.
- A write error must not look like a busy lock.

## Open Questions

- None.

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #37, not only the plan above.

- I. Upstream parity: met. The state lock is this port's own addition (the file's change notice lists "updateState holds a lock file"), so no upstream behaviour changes. The notice is updated.
- II. Only reviewed code: met. The fix is written in this repo.
- III. Copilot CLI through documented interfaces: not relevant. No Copilot call changes.
- IV. Safe by default: met. Only the plugin's own job files are written.
- V. Cross-platform: met. `fs.linkSync` works on NTFS, APFS and ext4; the Windows `EPERM` case is kept; CI runs the tests on all three OSes.
- VI. Tested: met. New tests in `tests/state.test.mjs` cover the lock, the reclaim lock, a failed write, a failed link and a leftover temp file.
