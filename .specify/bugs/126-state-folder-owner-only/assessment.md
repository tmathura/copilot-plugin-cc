# Bug Assessment: the state folder and job files are readable by others under CLAUDE_PLUGIN_DATA

- **Slug**: 126-state-folder-owner-only
- **Created**: 2026-10-27
- **Source**: pasted text (GitHub issue #126)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

Summarized from #126. `ensurePluginDataDir` (`plugins/copilot/scripts/lib/state.mjs`) sets mode
0700 only on the home fallback (`~/.copilot-companion`). With `CLAUDE_PLUGIN_DATA` set, the normal
case, `state/<slug>/jobs` is created with the default mode (0755 under umask 022) and the files with
0644. `jobs/<id>.json` holds the whole prompt, the request and Copilot's answer; the log holds the
progress. Whether another user can read them depends on the mode of Claude Code's data folder,
which the plugin does not check. A shared Linux or macOS host is the realistic exposure. The issue
asks for the plugin's state folder and job files to be owner-only on macOS and Linux, wherever the
data folder is, with a test, a docs update and a patch release.

## Symptom

On macOS and Linux, with `CLAUDE_PLUGIN_DATA` set, `<plugin data>/state/<slug>` and `jobs/` are 0755
and `state.json`, `jobs/<id>.json` and `jobs/<id>.log` are 0644 (under umask 022). Expected: the
folders 0700 and the files 0600, as for the home fallback.

## Reproduction

From the code (this machine is Windows, where the mode does not apply); CI on Ubuntu and macOS runs
the new tests:

1. Set `CLAUDE_PLUGIN_DATA` to a 0755 temp folder, umask 022.
2. Run any state update and start a job (`updateState`, `writeJobFile`, `createJobLogFile`).
3. `state/<slug>` and `jobs` are 0755; `state.json`, `<id>.json` and `<id>.log` are 0644.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/state.mjs:99-110` (`ensurePluginDataDir`): 0700 only for the
  fallback folder.
- `plugins/copilot/scripts/lib/state.mjs:112-115` (`ensureStateDir`): `mkdirSync(jobsDir,
  { recursive: true })` with the default mode.
- `plugins/copilot/scripts/lib/state.mjs:412-421` (`writeJsonAtomic`): the temp file for
  `state.json` and `jobs/<id>.json` gets the default mode; the rename keeps it.
- `plugins/copilot/scripts/lib/tracked-jobs.mjs:42-62` (`appendLogLine`, `appendLogBlock`,
  `createJobLogFile`): the log gets the default mode.
- The lock owner files (`state.mjs`, `openSync(ownerFile, "wx")`) hold only a pid and a token, in
  the same folder.

## Root Cause Hypothesis

The owner-only mode was added for the fallback folder only. The plugin's own folders and files under
Claude Code's data folder are made with the default mode, so their reach depends on a folder the
plugin does not own. Confidence: high (read from the code).

## Proposed Remediation

**Preferred**:

- `ensureStateDir`: `mkdirSync(jobsDir, { recursive: true, mode: 0o700 })`. `recursive` applies the
  mode to each folder it creates, which can include `state/` itself; an existing `state/` and the
  data folder keep their mode.
- Then, on non-Windows only, the plugin's own two folders from an older version are tightened, best
  effort, each in its own `try`. This goes past "create with 0700" on purpose: after an upgrade the
  folders exist already, so without it the acceptance "the state folder is 0700" would not hold for
  anyone who used the plugin before. `lstatSync` `state/<slug>`; when it is a link, or the `lstatSync` fails
  (so it may be a link), stop: neither it nor its `jobs` is changed. Otherwise, for `state/<slug>`
  and then for `jobs`, each in its own `try`: when it is not a link (for `jobs`, its own
  `lstatSync`) and its mode is not 0700, `chmodSync` it to 0700. A `chmodSync` error on
  `state/<slug>` (EPERM or EROFS) skips that folder only, and an error on `jobs` skips `jobs`; the
  call goes on: such a folder is open whatever the plugin does, and a failure
  would also block the read calls that use `ensureStateDir` (`resolveJobFile`,
  `resolveJobLogFile`, `resolveJobPatchDir`), so `status` and `cancel`.
- `writeJsonAtomic`: create the temp file with `mode: 0o600`; the rename keeps it, so `state.json`
  and `jobs/<id>.json` are 0600 each time they are written.
- `tracked-jobs.mjs`: `mode: 0o600` on the log's `writeFileSync` and both `appendFileSync` calls, so
  a new log is 0600. The option applies only at creation, so `createJobLogFile`, where each job's
  log starts, also tightens a log that exists already: after the `writeFileSync`, on non-Windows,
  in a `try`, `lstatSync` it and `chmodSync` it to 0600 when it is not a link and its mode is not
  0600; a failure leaves it as it is and the job goes on. The two append helpers only add to a log
  that a job has started; only a job that runs across an upgrade could append to an older 0644 log,
  which sits in the now-0700 `jobs` folder. A job file of an older version becomes 0600 when it is
  written again (the rename).
- `ensurePluginDataDir` is unchanged: a data folder that `CLAUDE_PLUGIN_DATA` names and that does
  not exist yet is created with the default mode, because it is Claude Code's folder, not the
  plugin's.
- The lock owner files stay as they are (a pid and a token, 0644 under umask 022): they are in the
  0700 folder.
- Windows: no change. The `chmodSync` calls run only on non-Windows; the `mode` options are passed
  everywhere and Windows ignores them.
- `docs/configuration.md` "Folders": on macOS and Linux, with or without `CLAUDE_PLUGIN_DATA`,
  each workspace's state folder (`state/<slug>`) and its `jobs` folder are owner-only, also when
  an older version made them; new job and log files are owner-only too. The `state` folder above
  them is owner-only when the plugin creates it; the plugin does not change an existing one, nor
  the data folder itself. The CHANGELOG entry says the same, with the tightening of older folders. The `state.mjs` and `tracked-jobs.mjs` header comments
  and a README "Differences from the Codex plugin" bullet record the change from upstream, which
  makes these folders with the default mode too.

**Alternatives**:
- Only the folder modes: a 0700 folder already keeps others out, but the issue asks for 0600 files,
  which also hold if the folder mode is loosened later.
- A process-wide `umask`: it would also change files the plugin writes elsewhere, and it does not
  tighten existing folders.

**Files likely to change**:
- `plugins/copilot/scripts/lib/state.mjs`, `plugins/copilot/scripts/lib/tracked-jobs.mjs`
- `tests/state.test.mjs`, `tests/tracked-jobs.test.mjs`
- `docs/configuration.md`, `README.md`
- `plugins/copilot/CHANGELOG.md` and the version files (`npm run bump-version -- 1.0.23`)

**Tests to add or update** (skipped on Windows; each sets `process.umask(0o022)` itself and
restores it in `finally`, and uses a fresh data folder; mocks match the exact path, not a call
count). These fail on the current code:
- With `CLAUDE_PLUGIN_DATA` set to a folder that the test `chmodSync`s to 0755: after `updateState`,
  `writeJobFile` and `createJobLogFile`, `state/<slug>` and `jobs` are 0700, `state.json`,
  `<id>.json` and `<id>.log` are 0600, the fresh `state/` is 0700, and the data folder is still
  0755.
- The same without `CLAUDE_PLUGIN_DATA` (the fallback); the existing fallback tests stay.
- An existing `state/<slug>` and `jobs` at 0755 become 0700.
- `appendLogLine` and `appendLogBlock` each on a log that does not exist yet: 0600.
- `writeJsonAtomic` replacing an existing 0644 `state.json` and `<id>.json`: 0600 after the rename.
- `fs.renameSync` mocked to check the temp file's mode (0600) and then throw: the update fails and
  the temp file is removed, as today.
- A data folder that `CLAUDE_PLUGIN_DATA` names and that does not exist yet: `state/` and
  `state/<slug>` come out 0700, and the data folder has the default mode.
- A real `state/<slug>` at 0755 whose `jobs` is a link to a 0755 folder: `state/<slug>` becomes
  0700 and the link's target keeps 0755.
- `createJobLogFile` on an existing 0644 log: 0600.
- `fs.chmodSync` mocked to throw EPERM for a 0755 `state/<slug>`: `jobs` still becomes 0700.
- `fs.lstatSync` mocked to throw for `jobs` after `state/<slug>` is checked: `state/<slug>` becomes
  0700.

These guard against a regression and pass on the current code too:
- An existing `state/` at 0755 keeps 0755.
- `fs.chmodSync` mocked to throw EPERM for `state/<slug>`, for `jobs` and for an existing log, and
  `fs.lstatSync` mocked to throw ENOENT and EACCES for `state/<slug>` (then neither folder is
  changed: both keep 0755), for `jobs` and for the log (then the "Starting" line is still written): `updateState`, `writeJobFile`, `createJobLogFile` and
  the read call `resolveJobLogFile` still work.
- `state/<slug>` as a link to a 0755 folder that holds a 0755 `jobs`, and the log as a link to a
  0644 file: the targets keep their modes.
- The lock owner files are not tested; they sit in the 0700 folder.

**Checks**: `npm ci --include=dev`, `npm run build`, `npm test`, `npm run check-version` and
`claude plugin validate .` must pass before the PR; CI runs the tests on Ubuntu, macOS and Windows.

## Risks & Considerations

- Two `lstatSync` calls on every `ensureStateDir` call, and a `chmodSync` only for a folder that is
  not 0700: small next to the git and file work around them.
- Accepted limit: a `state/<slug>` or `jobs` folder that is open to others and cannot be closed
  (another user owns it, or a read-only file system) stays open, and the plugin goes on writing to
  it. Refusing to write would stop reviews there, and the folder is open whatever the plugin does.
  The docs say the folders are made owner-only, not that an existing open folder is refused.
- A link at `state/<slug>` gets no `chmodSync`, nor its `jobs`, so their targets keep their modes;
  the files written there still get 0600. `chmodSync` follows a link, so a folder swapped for a
  link between the `lstatSync` and the `chmodSync` would have its target changed; that needs write
  access to the folder above it, which is the plugin's own or Claude Code's.
- A log of an older version keeps 0644, and a job file of an older version keeps it until it is
  written again; both sit inside the 0700 `jobs` folder.
- The tests run their mode checks only in CI on Ubuntu and macOS; this machine is Windows.

## Open Questions

None.

## Constitution Check

- **I. Upstream parity**: met. Names and layout stay; the safer modes are a difference from upstream,
  recorded in the README section "Differences from the Codex plugin" and the header comments.
- **II. Only reviewed code**: met. Node's `fs` modes and `chmodSync`; no new dependency.
- **III. Copilot CLI through documented interfaces only**: met. No change to how Copilot is called.
- **IV. Safe by default**: met; this is the point of the fix. The plugin makes its state folders and
  new files owner-only and tightens its own older folders; a folder it cannot close is an accepted
  limit (Risks).
- **V. Cross-platform**: met. The mode checks run on macOS and Linux; Windows is unchanged; CI runs
  all three.
- **VI. Tested, including failure paths**: met. Fresh and existing folders and files, with and
  without `CLAUDE_PLUGIN_DATA`, the data folder and an existing `state/` left alone, logs created by
  each writer, replaced JSON files, a linked folder, and a failed `lstatSync` or `chmodSync` that
  blocks nothing. Patch release with its `CHANGELOG.md` entry, and the release run after the merge.
