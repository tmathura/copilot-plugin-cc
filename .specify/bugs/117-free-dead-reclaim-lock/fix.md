# Bug Fix: A reclaim lock whose owner is dead is never freed

- **Slug**: 117-free-dead-reclaim-lock
- **Fixed**: 2026-10-27
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`reclaimDeadLock` no longer throws on a reclaim lock whose owner is dead. It goes past it along a
chain of reclaim levels, each named by the token of the dead owner of the level before, and never
removes a dead level, so only one process reclaims the main lock at a time.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/state.mjs` | modified | `nextReclaimLevel` gives the next level after a dead one (stops at an unreadable, live, non-UUID or repeated token); `reclaimDeadLock` walks the chain, reads every passed level again after it links one and backs off if one changed, then re-checks and frees the main lock as before; `describeLockBlocker` names the level that blocks |
| `tests/state.test.mjs` | modified tests | the dead-reclaimer test now expects the recovery; tests for a chain of dead levels, live first and later levels, a non-UUID token, a token loop, an unreadable later level, a reclaimer that read the first level before another reclaim finished, stale reads (a level taken or released), and an unexpected link error |
| `docs/operations.md` | modified | names the reclaim files that a killed process can leave, and that they are not a stuck lock |
| `plugins/copilot/CHANGELOG.md` | modified | `### 1.0.20` entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.20 (`npm run bump-version`) |

## Diff Highlights (optional)

```js
while (!tryLinkLock(ownerFile, reclaimFile)) {
  const other = readLockOwner(reclaimFile);
  const next = nextReclaimLevel(lockFile, other, seen, isAlive);
  if (!next) {
    return;
  }
  passed.push([reclaimFile, other.token]);
  reclaimFile = next;
}
// ...
if (passed.some(([file, token]) => readLockOwner(file)?.token !== token)) {
  return;
}
```

## Tests Added or Updated

- `tests/state.test.mjs` "a reclaim lock whose owner is dead is passed by the next level, and the update is written" — the bug; the link order is `lock`, `reclaim`, `reclaim.<token>`, `lock`, and the dead first level stays.
- "a chain of dead reclaim levels is walked to its end, and again for a later dead lock".
- "a live owner on a later reclaim level makes the update wait, and the timeout names that level".
- "a live owner on the first reclaim level makes the update wait, and the timeout names it".
- "a dead reclaim level with a token that is not a UUID stops the walk" and "... with a token loop ...".
- "an unreadable reclaim level after a dead one stops the walk, and the timeout names it".
- "a reclaimer that read the first level before another reclaim finished removes no live lock".
- "a reclaimer whose read of a passed level is stale backs off when the level was taken by a live reclaimer" and "... was released" — both fail with the re-read taken out.
- "a timeout while the reclaim chain is free says that the ended holder's lock is being freed".
- "an unexpected error on the link of a later reclaim level comes out, and no temp file stays".
- Unchanged and passing: the unreadable-reclaim test, "a reclaimer that saw a dead owner does not remove the lock that a live process took since", and the link-order test with no reclaim file.

## Local Verification

- Commands run: `npm ci --include=dev`, `npm run build` → pass; `npm test` → 434 tests, 410 pass, 24 skipped, 0 fail (after review round 1); `npm run check-version` → 1.0.20; `claude plugin validate .` → pass.
- With the re-read of passed levels taken out for one run, both stale-read tests fail.

## Deviations from Assessment

- 2026-10-27: no `linkImpl` option. The unexpected-link-error test mocks `fs.linkSync` with
  `t.mock.method`, as the existing link-order test does, so the plugin needs no new option.
- 2026-10-27, review round 1 (`code-review`): a timeout while the holder is dead and the chain ends at
  a free level now says "Process N has ended, and another process is freeing its lock; retry."
  (the assessment kept today's "Process N holds the lock" there, which is wrong for a dead holder).
  `describeLockBlocker` treats a level that was released during its walk as free, and
  `nextReclaimLevel` runs the UUID and loop checks before the liveness check. Test added.

## Follow-ups

- None. Upstream has no reclaim lock.
