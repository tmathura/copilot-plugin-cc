# Bug Fix: A killed process can leave an empty state lock that blocks every later command

- **Slug**: 033-state-lock-owner-written
- **Fixed**: 2026-10-12
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #37 (squash commit `a1db4229f4824811cba8f7b0d8a9fd8439917d0b`), for #59.

## Summary

The owner is written to a unique owner file next to the lock, and `fs.linkSync` links it to the lock name. So a lock name never exists without its owner. The same applies to the `.reclaim` lock. Released as 1.0.2.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/state.mjs` | modified | `tryCreateLock` replaced by `writeOwnerFile`, `tryLinkLock` and `removeOwnerFile` |
| `tests/state.test.mjs` | added tests | lock and reclaim lock, failed write, failed link, leftover temp file |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.2 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.2 |

## Diff Highlights (optional)

```js
function writeOwnerFile(lockFile, owner) {
  const ownerFile = `${lockFile}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(ownerFile, "wx");
  // ... write the owner, close, remove the file on error
  return ownerFile;
}

function tryLinkLock(ownerFile, lockFile) {
  try {
    fs.linkSync(ownerFile, lockFile);
    return true;
  } catch (error) {
    // Windows reports EPERM while another process is still deleting the old lock file.
    if (error?.code === "EEXIST" || (error?.code === "EPERM" && process.platform === "win32")) {
      return false;
    }
    throw error;
  }
}
```

## Tests Added or Updated

- `tests/state.test.mjs` "a lock file appears only with its owner already in it, and no temp file stays behind".
- `tests/state.test.mjs` "a reclaim lock appears only with its owner already in it, and no temp file stays behind".
- `tests/state.test.mjs` "an owner file that cannot be written is removed, and no lock is made".
- `tests/state.test.mjs` "a lock link that fails for another reason gives its error and leaves no lock or temp file".
- `tests/state.test.mjs` "a temp lock file left by a killed process does not block a later lock".

## Local Verification

As recorded in PR #37:

- Commands run: `npm test` → 222 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass (Windows).

## Deviations from Assessment

- `acquireStateLock` writes the owner file once and retries only the link, then removes the owner file when it ends (code review before commit). The assessment had one temp file per attempt.
- An error from writing the owner file is thrown at once, not treated as a busy lock (code review before commit).
- No README entry: the state lock is not upstream behaviour, so "Differences from the Codex plugin" does not change.

## Follow-ups

- None.
