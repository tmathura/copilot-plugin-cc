# Bug Assessment: setup says "not logged in" when the token is in the Linux keyring

- **Slug**: 156-copy-logged-in-accounts
- **Created**: 2026-11-09
- **Source**: pasted text (issue #156, with facts checked on 2026-11-09 on Windows 11 with Copilot CLI 1.0.105)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

Issue #156. On Ubuntu 26.10 (GNOME Keyring serving `org.freedesktop.secrets`), Copilot CLI 1.0.105,
plugin 1.0.25: after `copilot login --device-code` prints `Signed in successfully as tmathura.`, and
`copilot -p "Reply with the single word OK."` answers, `/copilot:setup` still reports
`ready: false` and `auth.detail: "not logged in"`. Every review and read-only task fails the same
way. The next steps include "On a system without a credential store, `copilot login` saves the
token in a file that the plugin cannot read. Set `COPILOT_GITHUB_TOKEN` …", which does not apply:
the system has a credential store and the token is in it.

The reporter's probe, outside the plugin:

- `COPILOT_HOME=<empty folder> copilot -p "Reply with the single word OK."` gives
  `Error: No authentication information found.`
- With a `COPILOT_HOME` whose `config.json` holds only `lastLoggedInUser` and `loggedInUsers`
  (each entry `{host, login}`, no token), the same command prints `OK`.

Workaround: merge those two keys (only `host` and `login`) from `~/.copilot/config.json` into the
plugin's `copilot-home/config.json`. Setup then reports ready.

On Windows 11 with Copilot CLI 1.0.101 (2026-11-02), neither file has these keys and setup reports
"logged in".

Facts checked for this assessment (2026-11-09, Windows 11, Copilot CLI 1.0.105):

- Copilot's `config.json` is not plain JSON. `~/.copilot/config.json` and the plugin's
  `copilot-home/config.json` both start with two comment lines,
  `// User settings belong in settings.json.` and `// This file is managed automatically.`, then a
  JSON object. `JSON.parse` on the raw text fails.
- Here `~/.copilot/config.json` has the keys `firstLaunchAt`, `appTipShown`,
  `reasoningSummariesCleanupDone` and `askedSetupTerminals`, and no account keys. The plugin's file
  has only `firstLaunchAt`. Setup reports "logged in".
- The Copilot CLI docs ("Authenticating GitHub Copilot CLI", "Troubleshooting Copilot CLI
  authentication") say that when the system keychain is unavailable, "the CLI prompts you to store
  the token in a plaintext configuration file at `~/.copilot/config.json`", with the prompt
  "System keychain unavailable. Store token in plaintext config file? (y/N)". They name no key for
  that token, and they do not mention `lastLoggedInUser` or `loggedInUsers`. The CLI binary is
  packed, so its key names cannot be read from it.

## Symptom

With the token in the OS keyring, Copilot run with the plugin's own `COPILOT_HOME` does not find
the login, so setup, reviews and read-only tasks fail with "not logged in". They should find the
same login that `copilot` finds when it runs on its own.

## Reproduction

1. On Linux with a running Secret Service (GNOME Keyring) and Copilot CLI 1.0.105, run
   `copilot login --device-code` and approve it.
2. Run `copilot -p "Reply with the single word OK."`. It prints `OK`.
3. Run `node plugins/copilot/scripts/copilot-companion.mjs setup --json`. It reports
   `ready: false`, `auth.detail: "not logged in"`.

Not reproduced in this session: it needs that Linux system. The Windows system here shows the
other side: no account keys in either file, and setup reports "logged in".

## Suspected Code Paths

- `plugins/copilot/scripts/lib/copilot.mjs:172` `buildCopilotEnv()` — for a read-only run it
  replaces the caller's `COPILOT_HOME` with the plugin's folder (`resolveCopilotHome`, line 168).
- `plugins/copilot/scripts/lib/copilot.mjs:428` `runCopilotTurn()` — creates that folder (line
  440) and puts nothing in it. Reviews, the review gate, read-only tasks and the login check all start Copilot
  here.
- `plugins/copilot/scripts/lib/copilot.mjs:581` `getCopilotAuthStatus()` — the login check runs
  through `runCopilotTurn`, and reads `No authentication information found` as "not logged in"
  (`NOT_LOGGED_IN_PATTERN`, line 64).
- `plugins/copilot/scripts/copilot-companion.mjs:227` `buildSetupReport()` — adds the "system
  without a credential store" step to every "not logged in" result, stated as the cause.
- `plugins/copilot/scripts/lib/state.mjs:444` `writeJsonAtomic()` — the temp file and rename writer
  with mode 0600 that the state files use. It is private to that module.

## Root Cause Hypothesis

On this Linux setup, Copilot CLI 1.0.105 finds a keyring login only through the account names that
it records in `config.json` under its home (`lastLoggedInUser`, `loggedInUsers`). The plugin's
read-only home has no such names, so Copilot never asks the keyring and reports no login. The
token never was in `config.json`, so the plugin's folder needs only the names. Confidence: high for
the mechanism (the reporter's probe shows the two keys alone turn the failure into `OK`); medium
for which platforms or versions write these keys (Windows with 1.0.101 and 1.0.105 writes none).

## Proposed Remediation

**Preferred**: before each read-only Copilot start in `runCopilotTurn` (so also before the login
check), copy the account names from the user's Copilot folder into the plugin's one:

- Read `config.json` in the caller's `COPILOT_HOME` (from `options.env ?? process.env`, because
  the environment that `buildCopilotEnv` builds has the plugin's folder there), or in `~/.copilot`
  when it is not set. Drop whole-line `//` comments before `JSON.parse`, because Copilot writes
  two of them at the top. Only whole lines count, so a value such as `"https://..."` is kept.
- Keep only well-formed entries, and from each only `host` and `login` (both strings):
  `lastLoggedInUser` (one entry) and `loggedInUsers` (a list; an empty result is left out). An
  entry of another shape, a `loggedInUsers` that is not a list, or a root that is not an object
  gives nothing and does not throw. Never copy any other field, so no token can be copied.
- Read the plugin's `config.json` the same way (a missing or broken file counts as empty, so a
  broken file loses its other keys when accounts are copied; Copilot writes only `firstLaunchAt`
  there). Remove the two keys from it, add the copied ones, and keep every other key and the
  comment lines at its top. A new file gets no comment lines; Copilot adds its own.
- When the user's file is missing, cannot be read (for example a folder in its place), is broken,
  or has no such keys, the two keys are removed from the plugin's file, so a logout or an account
  switch is picked up on the next run.
- Write only when the two account keys change (compared as parsed values, not as text, because
  Copilot may format the file in its own way), through a temp file and a rename, with mode 0600. The state
  module's JSON writer is split into an atomic text writer, which this copy uses, and the JSON
  writer on top of it, so the state files keep their format. When there is nothing to copy and
  the plugin's file does not exist, write nothing, so Windows and macOS stay as today.
- A failed write of the plugin's file fails the run before Copilot starts, with the error: Copilot
  could not use that folder either. The login check then reports that error, not "not logged in".
- Write runs are not changed: they use the user's own folder.

For the next step, the docs name no key for a file-stored token, so the plugin cannot tell that
case without guessing a key. Word the step as a condition the user can check: "If `copilot login`
asked to store the token in a plaintext config file (no system keychain), the plugin cannot read
it. …", still naming `COPILOT_GITHUB_TOKEN`. `plugins/copilot/commands/setup.md` (its output rule)
and the README item on setup's next steps say the same.

Doc passages that become false and change: `docs/configuration.md` "Log in" (the credential store
line) and "Systems without a credential store", the "Permission profiles" notes on the plugin's
folder, and `docs/operations.md` "Clean up" ("It holds no login").

**Alternatives**:

- Copy the whole user `config.json` into the plugin's folder: simpler, but it can carry a
  plaintext token and the user's other settings into the plugin's folder. Rejected.
- Run read-only Copilot with the user's own `COPILOT_HOME`: finds every login, but brings back the
  user's trusted folders, hooks, saved approvals and MCP servers, which the plugin's folder keeps
  out (constitution Principle IV). Rejected.
- Look for a token key in the user's file to decide on the next step: the key is not documented,
  and reading it is close to reading a token. Rejected.

**Files likely to change**:

- `plugins/copilot/scripts/lib/copilot.mjs`
- `plugins/copilot/scripts/lib/state.mjs` (an exported atomic text writer under the JSON writer)
- `plugins/copilot/scripts/copilot-companion.mjs` (the next step's words)
- `plugins/copilot/commands/setup.md` (the output rule for that step)
- `tests/copilot.test.mjs`, `tests/runtime-setup.test.mjs`
- `docs/configuration.md`, `docs/operations.md`, `README.md`
- `plugins/copilot/CHANGELOG.md` and the version files (patch release 1.0.26)

**Tests to add or update**:

- A user `config.json` with the comment lines, `lastLoggedInUser` and `loggedInUsers` entries
  with extra fields and a token-like field gives a plugin `config.json` with only `host` and
  `login`, no token text, its own comment lines and `firstLaunchAt` kept, and mode 0600 on
  non-Windows.
- A user file with no such keys, a missing user file and a broken user file each remove the keys
  from the plugin's file and keep its other keys; so do a root that is not an object and a
  `loggedInUsers` that is not a list. Mixed entries keep only the well-formed ones. A value with
  `//` inside it does not break the parse.
- A user `config.json` that cannot be read (a folder in its place) copies nothing.
- A new plugin file (keys to copy, no file yet) holds only the copied keys. A broken plugin file,
  or one whose root is not an object, is replaced by one with only the copied keys.
- A second run with the same accounts does not rewrite the plugin's file, also when its
  formatting differs from the plugin's.
- A plugin `config.json` that cannot be written (a folder in its place) fails the read-only run
  before Copilot starts and leaves no temp file in `copilot-home`; the login check reports the
  error, not "not logged in", so setup gives no login steps.
- The caller's `COPILOT_HOME` is read; without it, `~/.copilot` is read (a setup run with `HOME`
  and `USERPROFILE` set to a temp folder, which also covers the login check).
- A write run does not touch the plugin's file.
- With nothing to copy and no plugin file, no plugin file is written.
- The setup next step is worded as a condition.

## Risks & Considerations

- Copilot rewrites its own `config.json`. A Copilot run that starts after the copy reads the copied
  names. Two plugin runs that start at the same time write the same text, and the rename keeps the
  file whole. A Copilot process that is still running from an earlier job can write the plugin's
  file between the plugin's read and its rename; that write is then lost. The window is one read
  and one rename, and the write happens only when the accounts change, so this risk is accepted.
- On Windows a rename can fail for a moment while another process has the file open; the state
  writer already retries that. Writing only on a change keeps this rare.
- Copilot may change the format or the keys in a later version. A missing or changed key then
  copies nothing, which is today's behaviour.
- The copied names (`host`, `login`) are not secret, but the file is still made owner-only.
- A `/copilot:setup` on Linux cannot be checked in CI against the real keyring; tests use the fake
  CLI.

## Open Questions

None.

## Constitution Check

- **I. Upstream parity**: met. The change stays inside the adapter (`copilot.mjs`), the state
  module and setup's next steps; no file, command or function is renamed. The difference from
  upstream (Codex has no per-plugin Copilot folder) is added to the existing `COPILOT_HOME` item
  in the README section "Differences from the Codex plugin", with its reason (platform support).
- **II. Only reviewed code**: met. All code is written in this repo, with Node built-ins only.
- **III. Copilot CLI through documented interfaces only**: met, with a note. Only the adapter
  starts Copilot and decides its environment. The two keys are not in the Copilot docs; the plugin
  only copies them when they are there, and copies nothing when they are not, so an undocumented
  change cannot widen permissions. `setup` still reports a missing login clearly.
- **IV. Safe by default**: met. Read-only runs keep the plugin's own folder with none of the user's
  trusted folders, hooks, approvals or MCP servers. No token is copied: only `host` and `login`
  strings are taken, field by field. The file is written with mode 0600. No shell runs.
- **V. Cross-platform**: met. Paths go through `node:path` and `os.homedir()`; the writer retries
  the Windows rename; CI runs on ubuntu, macOS and Windows. Windows and macOS with no such keys
  write nothing.
- **VI. Tested, including failure paths**: met. The fake CLI tests cover a missing, broken and
  key-less user file, the token filter, the kept keys, the write run, and the login check. The
  release run covers setup on Windows.
