---

description: "Task list for the Copilot plugin port"
---

# Tasks: Copilot plugin port

**Input**: Design documents from `specs/001-copilot-plugin-port/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[call-site-map.md](call-site-map.md), [data-model.md](data-model.md), [contracts/](contracts/),
[quickstart.md](quickstart.md)

**Tests**: Required. Constitution Principle VI asks for tests of the failure paths each change touches.

**Organization**: One phase per ticket, in ticket order. Phase 1 is ticket 1, Phase 8 is ticket 8.
Each ticket is one GitHub issue and one PR.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an open task)
- **[Story]**: The user story in spec.md (US1 to US6)

## Rules for every porting task

- "Upstream" means codex-plugin-cc at commit `db52e28f4d9ded852ab3942cea316258ae4ef346`. Read each
  upstream file line by line before you port it, and list it in the PR.
- Apply the rows for that file in [call-site-map.md](call-site-map.md) and the rules in
  [research.md](research.md) §7. Change nothing else.
- A changed `.mjs` or `.d.ts` file starts with a comment that says it was changed from upstream
  codex-plugin-cc (Apache-2.0). Other changed files go in the "Changes" list in `NOTICE`.
- `P/` means `plugins/copilot/`. Upstream `plugins/codex/` paths are written `U/`.
- Each phase from Phase 2 on ends with `claude plugin validate .` and `node --test tests/*.test.mjs`
  passing, and with its differences added to the README section "Differences from the Codex plugin".

---

## Phase 1: Transport decision and call-site map (ticket 1, #5)

**Purpose**: Choose the transport and map every Codex call before any plugin code exists.

- [X] T001 Check `copilot --version`; install `@github/copilot` on Node 22 or later; check a
  non-interactive call works (research.md §1)
- [X] T002 Compare ACP and prompt mode on the Principle III points, with the official docs, the
  three community ports and a GitHub search, in specs/001-copilot-plugin-port/research.md
- [X] T003 Record the owner's choice (prompt mode, after ACP was found to run repository hooks) and
  the design rules in
  specs/001-copilot-plugin-port/research.md §6 and §7
- [X] T004 Map every upstream Codex call site in specs/001-copilot-plugin-port/call-site-map.md
- [X] T005 Write plan.md, data-model.md, contracts/ and quickstart.md in
  specs/001-copilot-plugin-port/

**Checkpoint**: the transport is chosen, and every later phase has a map to follow.

---

## Phase 2: Base layout and test setup (ticket 2, #6)

**Purpose**: The repo is a valid marketplace with an empty plugin, a version check, CI and the test
setup.

- [ ] T006 [P] Add root `LICENSE` (Apache-2.0 text from upstream) and `NOTICE` (upstream notice text,
  plus a "Changes" heading for files that cannot hold a change comment) at the repo root
- [ ] T007 [P] Add `P/LICENSE`, `P/NOTICE` and `P/CHANGELOG.md` from `U/LICENSE`, `U/NOTICE` and
  `U/CHANGELOG.md`; the changelog starts a Copilot section
- [ ] T008 [P] Port root `.claude-plugin/marketplace.json`: marketplace `tmathura-copilot`, owner
  tmathura, one plugin `copilot` with `source: "./plugins/copilot"`, version `0.1.0`
- [ ] T009 [P] Port `U/.claude-plugin/plugin.json` to `P/.claude-plugin/plugin.json`: `name:
  "copilot"`, version `0.1.0`, author tmathura
- [ ] T010 Port root `package.json`: name `copilot-plugin-cc`, private, `type: "module"`, `engines.node:
  ">=22"`, scripts `bump-version`, `check-version` and `test` as upstream; no `prebuild` or `build`
  yet (Phase 4 adds `build`); then run `npm install` to write `package-lock.json`
- [ ] T011 Port root `scripts/bump-version.mjs` with `plugins/copilot` paths and the `copilot` plugin
  entry
- [ ] T012 [P] Port `tests/bump-version.test.mjs`, including a test that `--check` fails when one
  manifest version differs
- [ ] T013 [P] Port `tests/helpers.mjs` (temp folders and git repos)
- [ ] T014 [P] Add `tests/fake-copilot-fixture.mjs` that answers `--version` with
  `GitHub Copilot CLI 1.0.93.` and `--help`; it reads its behaviour from an environment variable so
  later tests can make it fail. No prompt mode yet
- [ ] T015 [P] Port `.github/workflows/pull-request-ci.yml`: same pinned actions, Node 22, a matrix of
  `ubuntu-latest`, `macos-latest` and `windows-latest`, `npm ci`, `npm test`, and
  `npm run check-version`; no Codex or Copilot install step
- [ ] T016 [P] Update root `.gitignore`: add `node_modules/`; keep the existing entries
- [ ] T017 [P] Add `UPSTREAM.md`: checked commit `db52e28f4d9ded852ab3942cea316258ae4ef346` (v1.0.6),
  and the status table format (ported, pending, skipped with a reason)
- [ ] T018 Write the `README.md` skeleton: what the plugin is, install commands
  `claude plugin marketplace add tmathura/copilot-plugin-cc` and
  `claude plugin install copilot@tmathura-copilot`, "work in progress", and the section "Differences
  from the Codex plugin" with the transport, the dropped broker, the dropped `transfer` and the CI
  matrix
- [ ] T019 Add `npm test` and `npm run check-version` to the "Commands" table in `CLAUDE.md`
- [ ] T020 Run `claude plugin validate .` and `node --test tests/*.test.mjs`; both pass

**Checkpoint**: `claude plugin marketplace add` of the branch works; the plugin has no commands yet.

---

## Phase 3: Shared runtime modules (ticket 3, #7)

**Purpose**: The modules that every command needs, ported with their tests. No Copilot calls yet.

- [ ] T021 [P] Copy `U/scripts/lib/args.mjs`, `U/scripts/lib/prompts.mjs` and
  `U/scripts/lib/workspace.mjs` to `P/scripts/lib/` unchanged
- [ ] T022 [P] Port `U/scripts/lib/fs.mjs` to `P/scripts/lib/fs.mjs` (temp prefix `copilot-plugin-`)
- [ ] T023 Port `U/scripts/lib/process.mjs` to `P/scripts/lib/process.mjs` with `shell: false` always;
  add `resolveLauncher(name)` (research.md §4) and use it in `binaryAvailable`
- [ ] T024 Port `U/scripts/lib/git.mjs` to `P/scripts/lib/git.mjs`; change the self-collect guidance
  in `buildAdversarialCollectionGuidance` to "Read the patch files listed below with the view tool"
  (research.md §2, self-collect)
- [ ] T025 [P] Port `U/scripts/lib/state.mjs` to `P/scripts/lib/state.mjs` (fallback root
  `<tmp>/copilot-companion`); keep `MAX_JOBS = 50` and `STATE_VERSION = 1`
- [ ] T026 [P] Port `U/scripts/lib/tracked-jobs.mjs` to `P/scripts/lib/tracked-jobs.mjs`
  (`COPILOT_COMPANION_SESSION_ID`, `[copilot]` prefix)
- [ ] T027 Create `P/scripts/lib/copilot.mjs` with only `getSessionRuntimeStatus`, which always
  returns `mode: "direct"`, `label: "direct startup"`
- [ ] T028 Port `U/scripts/lib/job-control.mjs` to `P/scripts/lib/job-control.mjs` (import from
  `copilot.mjs`, Copilot text in `inferLegacyJobPhase` and errors)
- [ ] T029 Port `U/scripts/lib/render.mjs` to `P/scripts/lib/render.mjs` (`copilot --resume=<id>` for
  write tasks only; read-only jobs show only the session id, with no command; "Copilot session ID", `/copilot:*` hints, `- copilot:` in the setup report)
- [ ] T030 [P] Port `tests/process.test.mjs`; add tests: `runCommand` never uses a shell; arguments
  with spaces, quotes, `&`, `|`, `;`, `$` and `%` reach the child unchanged; a non-zero exit gives
  `formatCommandFailure` text; `terminateProcessTree` kills a child started with `detached: true`
  and its grandchild on macOS and Linux, and a child tree on Windows;
  `resolveLauncher` on Windows (simulated with a temp PATH): an `.exe`, an npm global-package `.cmd`
  shim, `npm.cmd` with `node_modules/npm/bin/npm-cli.js`, an unknown `.cmd` (not found), and paths
  with spaces; `binaryAvailable("npm")` finds npm on Windows with no shell
- [ ] T031 [P] Port `tests/git.test.mjs`, including a repository path with spaces
- [ ] T032 [P] Port `tests/state.test.mjs` and `tests/render.test.mjs`
- [ ] T033 [P] Add `tests/job-control.test.mjs` for job lookup by id and prefix, ambiguous prefixes,
  and the "still running" errors
- [ ] T034 Add the Phase 3 differences (no shell in `runCommand`, the self-collect text) to the
  README section
- [ ] T035 Run `claude plugin validate .` and `node --test tests/*.test.mjs`; both pass

**Checkpoint**: shared modules are ported and tested.

---

## Phase 4: User Story 1, install and setup (ticket 4, #8) 🎯 MVP

**Goal**: `/copilot:setup` reports a ready Copilot, or says exactly what is wrong.

**Independent test**: run the companion `setup --json` against the fake CLI set to missing, old, not
logged in, and ready.

### Tests for User Story 1

- [ ] T036 [P] [US1] Extend `tests/fake-copilot-fixture.mjs` into a prompt-mode fake that follows
  contracts/copilot-cli-usage.md: it reads the prompt on stdin, writes its arguments, environment
  and prompt to a file the test can read, and prints JSON events. Modes: success, not logged in (the
  real output that T042 records), old version, a line that is not JSON, output cut off before the
  `result` event, non-zero exit, a forbidden tool (`tool.execution_start` with `create`), and a run
  that keeps going until it is killed
- [ ] T037 [P] [US1] Add `tests/prompt-mode.test.mjs`: the prompt reaches stdin unchanged (with
  quotes, `&`, `|`, `%` and non-ASCII text, and a 300 KB prompt); events reach the handler in
  order; a line that is not JSON ends the run with an error that quotes it; output cut off before
  `result` fails with the exit code and stderr; `close` kills a running process tree; a process that
  prints `result` and then does not exit is killed after the grace period, the result is kept, and
  the run counts as a success when `result.exitCode` is 0
  (the grace period is an option, so the test can use a short one)
- [ ] T038 [P] [US1] Add `tests/copilot.test.mjs`: version parse and floor 1.0.93; the adapter
  starts Copilot through `resolveLauncher` and never with `shell: true`; read-only and write profiles build exactly the arguments and environment in research.md §3 (the
  read-only environment has the plugin `COPILOT_HOME` and no `COPILOT_ALLOW_ALL` or
  `GITHUB_COPILOT_PROMPT_MODE_*`); both profiles pass
  `--secret-env-vars=GH_TOKEN,COPILOT_PROVIDER_API_KEY,COPILOT_PROVIDER_BEARER_TOKEN`; no allow-all flag
  in any profile; a launcher and a working folder whose paths contain spaces
- [ ] T039 [P] [US1] Add setup tests to `tests/runtime.test.mjs`: missing CLI, old version, not
  logged in (with `!copilot login` next step), BYOK counts as ready, review gate on and off; with
  Copilot missing and npm found through `resolveLauncher`, the report says npm is available, so
  `/copilot:setup` can offer the install; when the login check fails, the next steps name both
  `!copilot login` and `COPILOT_GITHUB_TOKEN` for systems without a credential store; a token
  variable in the environment reaches the read-only run

### Implementation for User Story 1

- [ ] T040 [US1] Port `U/scripts/lib/app-server.mjs` to `P/scripts/lib/prompt-mode.mjs`: spawn the
  launcher with the given arguments and environment and no shell, write the prompt to stdin, split
  stdout into JSON events, report exit code, signal and stderr, and `close` with a tree kill. On
  macOS and Linux start Copilot with `detached: true` so the tree kill reaches its children; the
  companion kills its Copilot child's group on `SIGTERM` and `SIGINT` (research.md §7, process groups)
- [ ] T041 [US1] Port `U/scripts/lib/app-server-protocol.d.ts` to
  `P/scripts/lib/prompt-mode-protocol.d.ts`: hand-written types for the events in
  contracts/copilot-cli-usage.md; add `typescript` and `@types/node` as devDependencies; add
  `tsconfig.prompt-mode.json` and the `build` script `tsc -p tsconfig.prompt-mode.json`; add
  `npm run build` to CI
- [ ] T042 [US1] Port `U/scripts/lib/codex.mjs` to `P/scripts/lib/copilot.mjs`: `resolveLauncher("copilot")`,
  `buildCopilotArgs` and `buildCopilotEnv` (the profiles), `getCopilotAvailability`,
  `getCopilotAuthStatus` (one tiny read-only prompt in the plugin data folder), `withPromptMode`,
  `captureTurn`, `runPromptModeTurn` (with the forbidden-tool stop of research.md §3),
  `buildResultStatus`, `cleanCopilotStderr`; keep `getSessionRuntimeStatus`. Ask the owner to log
  out once (`/logout`), record the real "not logged in" output, and copy it into the fake
- [ ] T043 [US1] Port `U/scripts/codex-companion.mjs` to `P/scripts/copilot-companion.mjs` with the
  `setup` subcommand, `printUsage` and the shared helpers; other subcommands come in later phases
- [ ] T044 [P] [US1] Port `U/commands/setup.md` to `P/commands/setup.md` (`@github/copilot`,
  `!copilot login`)
- [ ] T045 [P] [US1] Port `U/skills/codex-cli-runtime/SKILL.md` to
  `P/skills/copilot-cli-runtime/SKILL.md` (no `spark`)
- [ ] T046 [P] [US1] Write `docs/configuration.md`: supported Copilot versions, install, login and
  token variables (names only), why systems without a credential store need `COPILOT_GITHUB_TOKEN`, BYOK, the permission profiles, the state folder, `--model` and
  `--effort`
- [ ] T047 [US1] Add the Phase 4 differences (version floor, login check, one process per run, no
  broker, no `transfer`) to the README section
- [ ] T048 [US1] Run `claude plugin validate .`, `npm run build` and `node --test tests/*.test.mjs`;
  all pass

**Checkpoint**: `/copilot:setup` works with a real Copilot install.

---

## Phase 5: User Story 2, reviews (ticket 5, #9)

**Goal**: `/copilot:review` and `/copilot:adversarial-review` run read-only and return upstream's
output shapes.

**Independent test**: run both reviews against the fake in a temp repo; the repo bytes are the same
after; a write attempt is rejected.

### Tests for User Story 2

- [ ] T049 [P] [US2] Add review tests to `tests/runtime.test.mjs`: working tree and branch targets;
  the fake's write attempt is rejected and no file changes; the Copilot arguments contain the read-only
  profile; the two refusal cases in research.md §3 (Copilot fails to start with the read-only flags:
  no prompt is sent; Copilot starts a tool other than `view`, `glob` or `grep`: the run
  stops and the process tree is killed); `--write` passed to a review still gives the read-only
  profile; above the inline limit, the patch folder is passed with `--add-dir`, holds the exact
  patches for a deleted file, for different staged and unstaged versions of one file, and for a
  branch review with unrelated local edits (which must not appear), and is deleted after the run;
  focus text with shell characters and a repo path with spaces; broken review JSON gives
  `parseError`; JSON inside a code fence parses; valid JSON with the wrong shape (`null`, `{}`, an
  unknown `verdict`, a finding without `file`) is rejected by `validateReviewOutput`: `parseError` is
  set, the job is `failed`, and the raw output is kept
- [ ] T050 [P] [US2] Port `tests/commands.test.mjs` for `review.md` and `adversarial-review.md`

### Implementation for User Story 2

- [ ] T051 [P] [US2] Copy `U/schemas/review-output.schema.json` to `P/schemas/` unchanged
- [ ] T052 [P] [US2] Port `U/prompts/adversarial-review.md` to `P/prompts/adversarial-review.md`
  ("You are Copilot", `{{OUTPUT_SCHEMA}}` block)
- [ ] T053 [P] [US2] Add `P/prompts/review.md`: the `/review` slash command, the target label and
  `{{REVIEW_INPUT}}`
- [ ] T053b [US2] In `P/scripts/copilot-companion.mjs`, when `collectReviewContext` returns
  `inputMode: "self-collect"`, write the exact patches (staged, unstaged and untracked for a working
  tree; the merge-base range for a branch) to a new folder for the run, pass it with `--add-dir`
  through the adapter, name the files in the prompt, and delete the folder after the run
- [ ] T054 [US2] Add `runPromptModeReview`, `parseStructuredOutput` (code fence), `readOutputSchema`
  and `validateReviewOutput` (the schema keywords in research.md §7; a failure sets `parseError` and
  fails the job) to `P/scripts/lib/copilot.mjs`
- [ ] T055 [US2] Add `review` and `adversarial-review` to `P/scripts/copilot-companion.mjs`
  (`executeReviewRun`, `handleReviewCommand`, `validateNativeReviewRequest`,
  `buildAdversarialReviewPrompt`, `buildReviewJobMetadata`)
- [ ] T056 [P] [US2] Port `U/commands/review.md` and `U/commands/adversarial-review.md` to
  `P/commands/`
- [ ] T057 [P] [US2] Port `U/skills/codex-result-handling/SKILL.md` to
  `P/skills/copilot-result-handling/SKILL.md`
- [ ] T058 [US2] Add the Phase 5 differences (`/review` with inline context instead of the native
  reviewer, schema in the prompt, sessions kept) to the README section
- [ ] T059 [US2] Run `claude plugin validate .`, `npm run build` and `node --test tests/*.test.mjs`;
  all pass

**Checkpoint**: both reviews work, read-only, against a real Copilot.

---

## Phase 6: User Stories 3 and 4, tasks and background jobs (ticket 6, #10)

**Goal**: `/copilot:rescue` runs tasks in the foreground or background; status, result and cancel
manage them.

**Independent test**: start a background task against the fake, check status, read the result, and
cancel a second task; its process tree is gone.

### Tests for User Stories 3 and 4

- [ ] T060 [P] [US3] Add task tests to `tests/runtime.test.mjs`: read-only task cannot write; `--write`
  builds the write profile; `--model` and `--effort` become Copilot arguments; a bad `--effort` fails;
  `--resume-last` with no earlier task fails with upstream's message; resume passes `--resume=<id>`
  with the profile of the new run; the write profile includes `--sandbox`; resume does not cross modes
  in either direction (a read-only task is not resumed by a `--write` run, and the reverse), and the
  error says to use `--fresh`; `task-resume-candidate` reports the candidate's `write` value
- [ ] T061 [P] [US4] Add job tests to `tests/runtime.test.mjs`: background task queued then completed;
  `status` table and single job; `result` output with `copilot --resume=<id>` for a write task and
  none for a read-only task; cancel kills the worker, the fake Copilot process and a child that the
  fake starts, within 10 seconds (poll with a time limit, no fixed sleep), and marks the job
  `cancelled`; a forbidden tool marks the job `failed`, and a grace kill after `result` keeps the
  status from `result.exitCode`, and in both cases no Copilot child or grandchild is left;
  `status --wait --timeout-ms` returns `waitTimedOut` for a job that
  keeps running; jobs are filtered by `COPILOT_COMPANION_SESSION_ID`; with `GH_TOKEN` set to a
  marker value, no state, job or log file contains the marker
- [ ] T062 [P] [US3] Port the `rescue.md` checks in `tests/commands.test.mjs`

### Implementation for User Stories 3 and 4

- [ ] T063 [US3] Add `resumeThread` (`--resume=<id>`), `findLatestTaskThread` (the newest task job
  in the plugin state with the same `write` value), `buildPersistentTaskThreadName`, `DEFAULT_CONTINUE_PROMPT` and
  `interruptPromptModeTurn` (not attempted) to `P/scripts/lib/copilot.mjs`
- [ ] T064 [US3] Add `task`, `task-worker` and `task-resume-candidate` to
  `P/scripts/copilot-companion.mjs` (`MODEL_ALIASES` empty, `VALID_REASONING_EFFORTS` as upstream)
- [ ] T065 [US4] Add `status`, `result` and `cancel` to `P/scripts/copilot-companion.mjs`
- [ ] T066 [P] [US3] Port `U/commands/rescue.md` to `P/commands/rescue.md` (no `spark`)
- [ ] T067 [P] [US4] Port `U/commands/status.md`, `U/commands/result.md` and `U/commands/cancel.md` to
  `P/commands/`
- [ ] T068 [P] [US3] Port `U/agents/codex-rescue.md` to `P/agents/copilot-rescue.md`
- [ ] T069 [P] [US3] Port `U/skills/gpt-5-4-prompting/` to `P/skills/gpt-5-4-prompting/` (same name;
  references renamed to `copilot-prompt-*.md`; `Codex` becomes `Copilot`)
- [ ] T070 [P] [US4] Write `docs/operations.md`: job states, where logs and state live, how to cancel,
  how to clean up (including read-only sessions in the plugin `COPILOT_HOME`), how to resume a write
  task in the Copilot CLI, and a warning never to start Copilot by hand with the plugin `COPILOT_HOME`
- [ ] T071 [US3] Add the Phase 6 differences (no `spark`, cancel without protocol interrupt, task lookup
  by plugin state, resume within one mode, `--sandbox` for write tasks and what happens where the host
  cannot sandbox) to the README section
- [ ] T072 [US3] Run `claude plugin validate .`, `npm run build` and `node --test tests/*.test.mjs`;
  all pass

**Checkpoint**: rescue, status, result and cancel work against a real Copilot.

---

## Phase 7: User Story 5, review gate and session hooks (ticket 7, #11)

**Goal**: The optional Stop hook blocks only when Copilot finds a problem; session hooks set the
session id and clean up.

**Independent test**: run the hook scripts with hook input on stdin against the fake set to `ALLOW`
and to `BLOCK`.

### Tests for User Story 5

- [ ] T073 [P] [US5] Add hook tests to `tests/runtime.test.mjs`: gate off does nothing; gate blocks on
  `BLOCK:`; gate lets Claude stop on `ALLOW:`; an unexpected answer blocks with upstream's message; a
  missing Copilot gives a setup note and does not block; the gate run uses the read-only profile; a
  gate run past its time limit blocks with upstream's timeout message, and the companion, the fake
  Copilot and their child processes are gone afterwards (the 15-minute limit is passed in through an
  option, so the test can use a short one); a 100 KB last Claude message reaches the companion on
  stdin and the gate runs; the gate prompt holds the working-tree context, and above the inline
  limit the patch folder is passed with `--add-dir`; `SessionStart` writes `COPILOT_COMPANION_SESSION_ID` to `CLAUDE_ENV_FILE`; `SessionEnd` kills and
  removes the session's running jobs

### Implementation for User Story 5

- [ ] T074 [P] [US5] Port `U/hooks/hooks.json` to `P/hooks/hooks.json`
- [ ] T075 [P] [US5] Port `U/prompts/stop-review-gate.md` to `P/prompts/stop-review-gate.md`, with a
  `{{REVIEW_INPUT}}` block for the working-tree context
- [ ] T076 [US5] Port `U/scripts/stop-review-gate-hook.mjs` to `P/scripts/stop-review-gate-hook.mjs`:
  collect the working-tree context with `collectReviewContext` (and the patch folder above the
  inline limit, as T053b) and put it in the prompt; send the prompt to `task --json` on stdin, not
  as an argument; start the companion with `detached: true` on macOS and Linux, and on the time limit
  kill its process tree with `terminateProcessTree`
- [ ] T077 [US5] Port `U/scripts/session-lifecycle-hook.mjs` to `P/scripts/session-lifecycle-hook.mjs`
  (no broker, no transcript path)
- [ ] T078 [US5] Add the Phase 7 differences to the README section
- [ ] T079 [US5] Run `claude plugin validate .`, `npm run build` and `node --test tests/*.test.mjs`;
  all pass

**Checkpoint**: every feature in the spec exists.

---

## Phase 8: First release (ticket 8, #12)

**Purpose**: Docs, the manual run, and version 1.0.0.

- [ ] T080 [P] [US6] Write the full `README.md`: install, every command with its flags, requirements,
  and the complete "Differences from the Codex plugin" section, checked against
  specs/001-copilot-plugin-port/call-site-map.md
- [ ] T081 [P] [US6] Write `docs/architecture.md` from the real code: modules, the prompt-mode run as a
  Mermaid sequence diagram, permission profiles, job state flow
- [ ] T082 [US6] Update `UPSTREAM.md`: every upstream file has a status (ported or skipped with a
  reason). Check that every changed file without a change comment is listed under "Changes" in
  `NOTICE`
- [ ] T083 Run the manual check in specs/001-copilot-plugin-port/quickstart.md with
  `claude --plugin-dir` on a throwaway git repo; record the results in the PR
- [ ] T084 Set version 1.0.0 with `npm run bump-version -- 1.0.0`; `npm run check-version` passes
- [ ] T085 Run `claude plugin validate .`, `npm run build` and `node --test tests/*.test.mjs`; all pass
- [ ] T086 Give the owner the install commands:
  `claude plugin marketplace add tmathura/copilot-plugin-cc` and
  `claude plugin install copilot@tmathura-copilot`

---

## Dependencies and execution order

- Phases run in ticket order: 1, 2, 3, 4, 5, 6, 7, 8. Each phase needs the one before it.
- Phase 4 (US1) is the base for every later story, because it holds the adapter and the prompt-mode fake.
- Phases 5 (US2), 6 (US3, US4) and 7 (US5) touch different commands. They still share
  `copilot-companion.mjs`, `copilot.mjs` and `tests/runtime.test.mjs`, so they run in order, one PR
  each.
- Inside a phase, write the tests first, then the code.

## Parallel examples

- Phase 2: T006, T007, T008, T009, T012, T013, T014, T015, T016 and T017 touch different files.
- Phase 4: T036, T037, T038 and T039 (tests) can be written together; then T044, T045 and T046.
- Phase 6: T066, T067, T068, T069 and T070 touch different files.

## Implementation strategy

- **MVP**: Phases 2 to 4. The plugin installs and `/copilot:setup` works with a real Copilot.
- **Then**: reviews (Phase 5), the main reason to use the plugin; then tasks and jobs (Phase 6); then
  the review gate (Phase 7).
- **Release**: Phase 8 only after the manual run passes.
