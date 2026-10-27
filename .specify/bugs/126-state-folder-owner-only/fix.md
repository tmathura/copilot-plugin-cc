# Bug Fix: the state folder and job files are readable by others under CLAUDE_PLUGIN_DATA

- **Slug**: 126-state-folder-owner-only
- **Fixed**: 2026-10-27
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

On macOS and Linux the plugin now creates its state folders with mode 0700 and its job and log
files with 0600, also under `CLAUDE_PLUGIN_DATA`, and tightens its own `state/<slug>` and `jobs`
folders from an older version, best effort. `createJobLogFile` also tightens a log that exists
already when a job starts it; job ids are new, so in practice an older version's logs keep their
mode, inside the now-0700 `jobs` folder.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/state.mjs` | modified | `makeOwnerOnly(file, mode)` (best effort, skips links); `ensureStateDir` creates `jobs` with 0700 and tightens `state/<slug>`, then `jobs` only when `state/<slug>` was checked and is no link; `writeJsonAtomic` temp file 0600; header comment |
| `plugins/copilot/scripts/lib/tracked-jobs.mjs` | modified | Log writes with mode 0600; `createJobLogFile` tightens an existing log; header comment |
| `tests/state-modes.test.mjs` | added | 18 tests, skipped on Windows |
| `docs/configuration.md` | modified | "Folders": which folders and files are owner-only |
| `README.md` | modified | A "Differences from the Codex plugin" bullet |
| `plugins/copilot/CHANGELOG.md` | modified | `### 1.0.23` entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | `npm run bump-version -- 1.0.23` |

## Diff Highlights (optional)

```js
export function ensureStateDir(cwd) {
  ensurePluginDataDir();
  const jobsDir = resolveJobsDir(cwd);
  fs.mkdirSync(jobsDir, { recursive: true, mode: 0o700 });
  if (makeOwnerOnly(path.dirname(jobsDir), 0o700)) {
    makeOwnerOnly(jobsDir, 0o700);
  }
}
```

## Tests Added or Updated

`tests/state-modes.test.mjs` (a new file, so its umask and data-folder settings stay apart; each test
sets umask 022 and a fresh data folder). These fail on the old code:

- Under `CLAUDE_PLUGIN_DATA` (a 0755 folder): `state/`, `state/<slug>` and `jobs` are 0700,
  `state.json`, `<id>.json` and the log are 0600, and the data folder keeps 0755.
- Without `CLAUDE_PLUGIN_DATA` (the fallback in a temp `HOME`): the same.
- A data folder that does not exist yet: it gets the default mode, the folders under it 0700.
- Folders from an older version (0755), and a 0644 log that `createJobLogFile` starts again, are
  tightened.
- Job files rewritten from 0644 become 0600.
- A log that `appendLogLine` or `appendLogBlock` creates is 0600.
- The temp file of a state write is 0600 before its rename (a mocked rename that fails).
- A `jobs` link: its target keeps 0755 while `state/<slug>` becomes 0700.
- A `chmodSync` failure on `state/<slug>` still lets `jobs` be tightened; an `lstatSync` failure on
  `jobs` still lets `state/<slug>` be tightened.

These pass on the old code too and guard what the fix must not break:

- An existing `state/` at 0755 keeps 0755. This check passes on the old code, but it is one
  assertion in the upgrade test, which fails there on its other checks.
- A `state/<slug>` link and a log link: their targets keep their modes.

These check the failure paths. Each also checks that its mocked failure was reached, so they fail
on the old code, which never calls `chmodSync` or `lstatSync` there:

- With `chmodSync` or `lstatSync` failing for `state/<slug>`, `jobs` or the log (EPERM, EROFS,
  ENOENT, EACCES), state updates, job files, the log and the read call `resolveJobLogFile` still
  work; an `lstatSync` failure on `state/<slug>` changes neither folder.

## Local Verification

- Commands run: `npm ci --include=dev` (0 vulnerabilities), `npm run build` (pass), `npm test`
  (503 tests: 461 pass, 42 skipped, 0 fail; the 18 new tests skip on this Windows machine),
  `npm run check-version` (1.0.23), `claude plugin validate .` (pass).
- The new tests run only on macOS and Linux, so CI on Ubuntu and macOS runs them; WSL is not
  reachable from this session.

## Deviations from Assessment

- 2026-10-27: the mode tests are in a new file, `tests/state-modes.test.mjs`, not in
  `tests/state.test.mjs` and `tests/tracked-jobs.test.mjs`, because both set one module-level
  `CLAUDE_PLUGIN_DATA` that other tests use. The assessment was written in the format of
  `/speckit-bug-assess` without running that skill.
- 2026-10-27, review round 1: the guard test "an existing `state/` keeps 0755" was removed, because
  the upgrade test makes the same check; the tests restore unset environment variables by deleting
  them; the docs name the workspace folder `state/<repo folder name>-<hash>` and say that `jobs`
  stays as it is when that folder is a link or cannot be checked.
- 2026-10-27, review round 2: the tests restore the umask and the environment with `t.after`, not
  in `finally` as the assessment says; `t.after` runs also when the test fails. The docs now name
  the workspace folder `state/<name>-<hash>`, named after the workspace folder, because the name is
  cleaned and can come from a folder that is no repo.
- 2026-10-27, review round 3: the failure-path tests also check that the mocked failure was
  reached, so a mock that misses its path cannot pass unnoticed. They now fail on the old code,
  which the assessment had listed as passing there.

## Follow-ups

- None.
