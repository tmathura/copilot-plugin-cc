# Bug Fix: setup says "not logged in" when the token is in the Linux keyring

- **Slug**: 156-copy-logged-in-accounts
- **Fixed**: 2026-11-09
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Before each read-only Copilot start, also the login check, the plugin now copies the `host` and
`login` of the logged-in accounts from the user's Copilot `config.json` into its own one, and
removes them there when the user's file has none. Setup's plaintext-token step is worded as a
condition the user can check. Patch release 1.0.26.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/copilot.mjs` | modified | `readCopilotConfig`, `pickAccount`, `pickLoggedInAccounts`, `copyLoggedInAccounts`; `runCopilotTurn` calls the copy in its read-only branch; file notice updated |
| `plugins/copilot/scripts/lib/state.mjs` | modified | `writeFileAtomic` (exported text writer); `writeJsonAtomic` now calls it |
| `plugins/copilot/scripts/copilot-companion.mjs` | modified | the `COPILOT_GITHUB_TOKEN` next step is worded as a condition |
| `plugins/copilot/commands/setup.md` | modified | the output rule for that step |
| `tests/copilot.test.mjs` | added tests | `setUp` gives each test an empty user Copilot folder |
| `tests/runtime-setup.test.mjs` | added test, updated test | the `~/.copilot` default; the step's wording |
| `docs/configuration.md`, `docs/operations.md`, `README.md` | modified | what the plugin's folder holds, and the step |
| `plugins/copilot/CHANGELOG.md` and the version files | modified | 1.0.26 |

## Diff Highlights (optional)

```js
const { lastLoggedInUser, loggedInUsers, ...rest } = current?.config ?? {};
const copied = Object.fromEntries(
  Object.entries({ lastLoggedInUser, loggedInUsers }).filter(([, value]) => value !== undefined)
);
if (isDeepStrictEqual(copied, accounts)) {
  return;
}
```

The write happens only when the two keys differ from what the user's file gives, compared as
values. A missing plugin file with nothing to copy, and a broken plugin file with nothing to
copy, both compare equal (`{}`), so nothing is written.

## Tests Added or Updated

- `tests/copilot.test.mjs` "a read-only run copies only the host and login of the logged-in accounts into the plugin's Copilot folder" — the comment lines, a token-like field, a token map, extra fields, bad entries and a `//` inside a value; the plugin file keeps its comment lines and `firstLaunchAt`, drops stale accounts, has no token text, no temp file, and mode 0600 on macOS and Linux.
- `tests/copilot.test.mjs` "the plugin's Copilot folder follows an account switch, and loses the accounts when the user's config has none" — a switch over two runs; no keys, a missing file, a folder in its place, a broken file, a root that is not an object, and a `loggedInUsers` that is not a list.
- `tests/copilot.test.mjs` "the plugin's Copilot config is written only when its accounts change" — nothing written with nothing to copy; a new file holds only the accounts; the same accounts in Copilot's own formatting cause no rewrite; a broken plugin file is replaced.
- `tests/copilot.test.mjs` "a write run does not touch the plugin's Copilot config".
- `tests/copilot.test.mjs` "a plugin Copilot config that cannot be written stops a read-only run before Copilot starts" — no Copilot run, no temp file left, and the login check reports the error with no login steps.
- `tests/runtime-setup.test.mjs` "the login check copies the accounts from ~/.copilot when COPILOT_HOME is not set" — a setup run with `HOME` and `USERPROFILE` set to a temp folder.
- `tests/runtime-setup.test.mjs` "setup without a login names copilot login and the token variable" — the step is worded as a condition.

## Local Verification

- Commands run: `npm run build` → passed; `node --test tests/copilot.test.mjs tests/runtime-setup.test.mjs` → 44 passed, 2 skipped (POSIX-only, on Windows).
- Manual checks: none. The Linux keyring case needs the reporter's system.

## Deviations from Assessment

None.

## Follow-ups

- The owner can check on the Linux system of the report that setup reports ready after the update.
