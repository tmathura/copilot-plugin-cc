# Bug Assessment: A reclaim lock whose owner is dead is never freed

- **Slug**: 117-free-dead-reclaim-lock
- **Created**: 2026-10-27
- **Source**: pasted text (GitHub issue #117)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

Summarized from #117. `reclaimDeadLock` (`plugins/copilot/scripts/lib/state.mjs`) frees a dead main
lock through a second lock, `state.json.lock.reclaim`. When that reclaim file belongs to a dead
process, the code throws "The state lock ... .reclaim belongs to process N, which is no longer
running. Delete ... and retry". Nothing in the code ever frees it. The reclaim file is held only for a
moment, but a cancel's `taskkill /F` or Claude's hook kill can land there. From then on, every time
the main lock's owner is dead, every `updateState` throws: SessionEnd exits 1 and stops nothing,
cancel fails, the worker's final write fails, until the user deletes the file by hand. Found by code
review on 2026-10-21, from the code.

Expected: a reclaim lock whose owner is dead is freed the same way as a dead main lock. The error for
a reclaim file that cannot be read stays.

## Symptom

With a dead main lock and a dead reclaim lock beside it, every state update fails with "... .reclaim
belongs to process N, which is no longer running. Delete ... and retry". Expected: the dead reclaim
lock is freed, then the dead main lock, and the update succeeds.

## Reproduction

1. Write `state.json.lock` with `{ pid: <dead pid>, token }` and `state.json.lock.reclaim` with
   `{ pid: <dead pid>, token }` in a workspace's state folder.
2. Call `updateState(workspace, ...)`.
3. It throws the error above; the test "a reclaim lock whose owner is dead gives a clear error that
   names it" (`tests/state.test.mjs:659`) pins this on `main`.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/state.mjs` `reclaimDeadLock`, the `!linked` branch — throws when the reclaim file's owner is dead, instead of freeing it.
- `plugins/copilot/scripts/lib/state.mjs` `describeLockBlocker` — the timeout message for a dead main lock beside a reclaim file that names no live process; it stays for the unreadable case.
- `tests/state.test.mjs:659` — pins the throw.

## Root Cause Hypothesis

The reclaim lock was given the same `{pid, token}` owner as the main lock, but its dead-owner case was
left as an error for the user to fix by hand. A process killed while it holds the reclaim lock (only
for a moment, but kills do land there) leaves a file that no process ever frees. Confidence: high
(the code and its test say so).

## Proposed Remediation

**Preferred** (2026-10-27, after the plan review): free a dead reclaim lock by going past it, never by
removing a file that a live process may hold. The reclaim locks form a chain: the first is
`state.json.lock.reclaim`, as today; when a level's owner is readable and dead, the next level is
`state.json.lock.reclaim.<that owner's token>`. Every reclaimer of the same dead main lock walks the
same chain, so the first free level is the one they all contend on, and only one can link it. The
winner first reads every level it passed once more: each must still hold the token it read. If one
does not, or is gone or unreadable (its owner was alive when it was read, then released it and exited, so the liveness check
came too late, and another process may now hold that level), the winner releases its own level and
returns, so `acquireStateLock` loops (plan review round 4). A dead owner never removes its level, so
a passed level that still holds its token stays until the walk ends, and no other process can be on
an earlier level. Then the winner does what the reclaim lock does today (re-check the main lock,
remove it if its owner is still dead) and releases its own level, token-checked, as today. A dead
level is never removed: it
stays as a signpost to the next level, so the chain never changes under a reclaimer that stalls
after it read a level, and the first free level stays the same for every reclaimer (plan review
round 2: removing passed levels let a stalled reclaimer win an old level while a new one held the
first level). A level whose owner is alive, or that cannot be read, ends the walk as today: return,
and `acquireStateLock` loops. A token that is not a plain UUID is treated as unreadable (it becomes
part of a file name), and a token seen twice in one walk (a loop, only possible by tampering) ends
the walk as unreadable too. Dead levels add up only when a process is killed in the moment it holds
a level, so the walk has no fixed bound. The one temporary owner file serves every level and is
removed when the walk ends, also on an error. `describeLockBlocker` walks the same chain, so a
timeout names the level that blocks (an unreadable one keeps today's message and advice). For the
error-path test, the link goes through an injectable `linkImpl` option, as `isPidAliveImpl` is.

This differs from the issue's literal wording ("freed the same way as a dead main lock", "remove the
reclaim file and try once more"): the dead reclaim file is not removed, the reclaim goes past it.
It meets the issue's expected behaviour ("no state update fails because of a lock that no live
process holds"), and the literal way breaks the lock's mutual exclusion (Alternatives). The issue
gets a dated scope line, and the PR says so. A walk that ends at a free level that it then loses
(another process took it) times out with today's fallback message for a held lock, as today when no
reclaim file exists.

**Alternatives**:
- Remove the dead reclaim file after a token re-check, then retry the link (the issue's wording):
  the check and the removal are two steps, so two reclaimers can both pass the check, and the second
  can remove the live reclaim file of the first. Both then reclaim the main lock, and one can remove a
  main lock that a live process took since: two writes to `state.json` at once. Rejected in the plan
  review (Codex), because the lock exists to prevent exactly that.
- An atomic capture by rename and a give-back: narrows the window but still leaves the reclaim file
  missing for a moment, so a third reclaimer can link it. Rejected.
- The chain, with the winner removing the dead levels it passed (plan review round 1): a reclaimer
  that stalls after it read a level can later win an old level while a new reclaimer holds the
  first one, and both can reclaim at once. Rejected in plan review round 2 (Codex, Copilot).

**Files likely to change**:
- `plugins/copilot/scripts/lib/state.mjs`
- `tests/state.test.mjs`
- `plugins/copilot/CHANGELOG.md` and the version files (patch release 1.0.20)
- `docs/operations.md`: one sentence that names the reclaim files a killed process leaves, and that
  they are not a stuck lock (it gives no advice to delete a lock file today). The spec folder
  `specs/005-copilot-plugin-port/` mentions the old error, but a merged spec folder is history
  (constitution, Implementation-to-Spec Consistency).

**Tests to add or update**:
- `tests/state.test.mjs:659`: a dead main lock beside a dead reclaim lock: `updateState` succeeds,
  the update is written, the main lock and every temporary owner file are gone, the reclaimer's own
  level is released, and the dead first level is still there.
- Three dead levels: the walk goes past all of them and succeeds; a second dead main lock later
  walks the same chain and succeeds again (the chain does not change).
- A stalled reclaimer, through `isPidAliveImpl` as the test "a reclaimer that saw a dead owner does
  not remove the lock that a live process took since" does: while the walker checks the dead first
  level, the test frees the dead main lock and writes a live holder's main lock (another reclaim
  done); the walker then links the second level, finds the main lock live at its re-check, removes
  nothing, and releases its level; the live holder's main lock and the dead first level remain. A
  variant: the second level is held by a live reclaimer, so the walker waits and leaves it.
- A stale read: through `isPidAliveImpl`, the first level's owner is reported dead, but while it is
  checked the test removes that level and writes it again with a live reclaimer's token (the old
  owner released it, a new one took it). The walker links the next level, finds the first level
  changed, releases its own level, removes nothing, and the update times out; the live reclaimer's
  first level and the dead main lock are left as they were.
- A live owner on a later level after a dead first level: the timeout message names that later level
  (not `.reclaim`), and no reclaim file is removed.
- Tokens in these tests are real UUIDs (a non-UUID token is now treated as unreadable); the
  unreadable-reclaim test keeps its damaged content.
- The link-order test at `tests/state.test.mjs:565-583` has no reclaim file and passes unchanged;
  the new dead-first-level test checks its own order (`lock`, `reclaim`, `reclaim.<token>`, `lock`)
  and that the temporary owner file is gone after it.
- A passed level that is gone when the winner reads it again: the winner backs off as for a changed
  token.
- A dead first level followed by an unreadable second level: the walk ends, and the timeout message
  names the second level with today's unreadable-file advice.
- A loop of tokens (a level that names the first level's token again): the walk stops; the update
  times out with the message that names that level.
- A live owner on the next level (another reclaimer holds it): the update waits; that level's file
  and the dead first level are left as they are.
- A live owner on the first level beside a dead main lock: waits as today, with today's timeout
  message (`describeLockBlocker` names `.reclaim`).
- A level whose token is not a UUID: treated as unreadable, today's message names it.
- An unexpected error on the link of a later level (`linkImpl` throws `EACCES` for it, the folder and
  the files stay): the error comes out of `updateState`, and no temporary owner file is left.
- The existing test "a reclaimer that saw a dead owner does not remove the lock that a live process
  took since" passes unchanged.
- The unreadable-reclaim test stays as it is.

## Risks & Considerations

- Mutual exclusion holds: no reclaim level is removed except by its own owner, the dead levels never
  change, so every reclaimer, also a stalled one, contends on the same first free level.
- Dead levels stay in the state folder as small files (`state.json.lock.reclaim`,
  `state.json.lock.reclaim.<uuid>`), one per process killed while it held a level; each walk reads
  past them. `docs/operations.md` names them, so a reader knows they are not a stuck lock.
- No change for a live reclaimer on the first level or an unreadable reclaim file.
- A dead level whose pid the OS gives to a new process looks live and blocks the chain until that
  process ends, the same limit the main lock has today (`isPidAlive`).
- `isPidAlive` is the same check that frees a dead main lock today.

## Open Questions

None.

## Constitution Check

- **I. Upstream parity**: not relevant. The state lock's reclaim path is this repo's own (upstream
  has no reclaim lock); no upstream name or behaviour changes.
- **II. Only reviewed code**: met. Code written here; no new dependency.
- **III. Copilot CLI through documented interfaces only**: not relevant. No Copilot call changes.
- **IV. Safe by default**: met. A reclaim level is removed only by its own owner (token-checked, as
  today); a dead level is never removed, so only one process reclaims at a time and only one process
  writes `state.json` at a time.
- **V. Cross-platform**: met. Same file operations as the main-lock reclaim, on every OS; the tests
  run on ubuntu, macOS and Windows in CI.
- **VI. Tested, including failure paths**: met. Tests for a dead reclaim lock, several dead levels, a
  stalled reclaimer, a stale read of a level, a live next level, a live first level, the timeout
  message for a later blocking level, a bad token, a token loop, an unexpected link error, and the
  unreadable reclaim file. `docs/operations.md` names the reclaim files a killed process leaves. Patch release with its `CHANGELOG.md` entry, and the release
  run after the merge.
