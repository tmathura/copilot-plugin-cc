# Call-site map: Codex to Copilot (prompt mode)

Every place in upstream codex-plugin-cc v1.0.6 (commit `db52e28f4d9ded852ab3942cea316258ae4ef346`)
that calls Codex or depends on Codex, with its Copilot match. The transport is prompt mode
(`copilot --output-format json`, prompt on stdin), as chosen in [research.md](research.md) §6. The
naming and design rules are in research.md §7. Section numbers like "§3" point to research.md.

"Rename only" means the code stays the same apart from the rules for names and user-visible text.
Every row with a real change, and every "dropped" row, needs a line in the README section
"Differences from the Codex plugin".

Paths are relative to `plugins/codex/` upstream and `plugins/copilot/` here, unless they start at the
repo root.

## Process start and protocol client

| Upstream place | What it does with Codex | Copilot match | Ticket |
| --- | --- | --- | --- |
| `scripts/lib/app-server.mjs` → `SpawnedCodexAppServerClient.initialize` | `spawn("codex", ["app-server"])`, with a shell on Windows; JSON-RPC handshake | `scripts/lib/prompt-mode.mjs`: spawn the resolved launcher (§4) with the arguments the adapter built, the environment the adapter built, and the prompt written to stdin. Never a shell. No handshake | 4 |
| `AppServerClientBase.request`, `notify`, `pending`, `nextId` | JSON-RPC requests and responses | None. Prompt mode has one input (the prompt) and one output stream | 4 |
| `AppServerClientBase.handleLine`, `handleChunk` | Parses one JSON message per line; a bad line ends the client | Same: one JSON event per line, passed to the adapter's event handler. A bad line ends the run with an error that quotes the line | 4 |
| `AppServerClientBase.handleServerRequest` | Refuses every server request | None. A tool that needs approval is denied by Copilot itself in prompt mode | 4 |
| `AppServerClientBase.handleExit`, `exitPromise` | Ends pending requests when the process exits | Resolves the run with the exit code, signal and stderr when the process exits | 4 |
| `SpawnedCodexAppServerClient.close` | Ends stdin, then kills the process tree on Windows | `close` kills the process tree if Copilot is still running (cancel, stopped review, or 5 seconds after `result`; §7) | 4 |
| `BrokerCodexAppServerClient`, `CodexAppServerClient.connect` | Broker connection, or a direct client | Dropped. One direct process per run | 4 |
| `BROKER_ENDPOINT_ENV`, `BROKER_BUSY_RPC_CODE`, `DEFAULT_CLIENT_INFO`, `DEFAULT_CAPABILITIES` | Broker and handshake constants | Dropped | 4 |
| `scripts/app-server-broker.mjs` | Long-lived broker that shares one `codex app-server` | Dropped. Prompt mode has no server to share | 4 |
| `scripts/lib/broker-endpoint.mjs` | Builds and parses broker endpoints | Dropped | 4 |
| `scripts/lib/broker-lifecycle.mjs` | Starts, finds and tears down the broker | Dropped | 4 |
| `scripts/lib/app-server-protocol.d.ts` | Types from `codex app-server generate-ts` | `scripts/lib/prompt-mode-protocol.d.ts`: hand-written types for the events in §7 | 4 |
| root `tsconfig.app-server.json` | Type-checks the protocol client and adapter | `tsconfig.prompt-mode.json`, same settings, with the renamed files | 4 |

## Adapter: `scripts/lib/codex.mjs` → `scripts/lib/copilot.mjs`

| Upstream place | What it does with Codex | Copilot match | Ticket |
| --- | --- | --- | --- |
| (none upstream) | Codex is found on the PATH by the shell | `resolveLauncher("copilot")` from `process.mjs` (§4) | 4 |
| (none upstream) | Codex gets `sandbox` and `approvalPolicy` per thread | `buildCopilotArgs` and `buildCopilotEnv`: the read-only and write profiles (§3), the plugin-owned `COPILOT_HOME`, and the scrubbed environment. Only this module builds Copilot arguments | 4 |
| `getCodexAvailability` | Runs `codex --version` and `codex app-server --help` | `getCopilotAvailability`: runs `copilot --no-auto-update --version` (§5), parses `GitHub Copilot CLI <x.y.z>`, and refuses versions below 1.0.93 (§5) | 4 |
| `getCodexAuthStatus`, `getCodexAuthStatusFromClient` | `account/read` and `config/read` over the app server | `getCopilotAuthStatus`: one tiny read-only prompt in the plugin data folder; reads the `result` event (§7) | 4 |
| `buildAppServerAuthStatus`, `buildAuthStatus` | Builds the auth report from the Codex account | Builds it from the check run. Sources: stored login (the `/login` login or the GitHub CLI login), a token variable (name only, never the value), or BYOK. A BYOK provider counts as logged in and runs no check, as upstream does when `requiresOpenaiAuth` is false (research §7, login check). `requiresOpenaiAuth` becomes `requiresGithubAuth` | 4 |
| `resolveProviderConfig`, `normalizeProviderId`, `formatProviderLabel`, `BUILTIN_PROVIDER_LABELS` | Reads the Codex model provider from config | Reads `COPILOT_PROVIDER_TYPE` and `COPILOT_PROVIDER_BASE_URL` for BYOK. Labels: `openai`, `azure`, `anthropic` | 4 |
| `getSessionRuntimeStatus` | Reports "shared session" when a broker exists | Always reports "direct startup". The function stays, because setup and status show it | 3 |
| `withAppServer`, `withDirectAppServer` | Connects, with a retry without the broker | `withPromptMode`: starts one process for the run and closes it at the end. No retry path | 4 |
| `buildThreadParams`, `startThread` | `thread/start` with `cwd`, `model`, `approvalPolicy`, `sandbox`, `serviceName`, `ephemeral`; then `thread/name/set` | Arguments: `--session-id=<new uuid>`, `--model`, the profile flags; `cwd` is the process working folder. The thread name becomes `--name` when set (see `buildPersistentTaskThreadName`). `ephemeral` has no match (§7) | 4 |
| `buildResumeParams`, `resumeThread` | `thread/resume` | Argument `--resume=<sessionId>`, with the same profile rules | 6 |
| `buildTurnInput` | `[{ type: "text", text, text_elements: [] }]` | The prompt text, written to stdin | 4 |
| `captureTurn` | Starts a turn, buffers notifications, waits for `turn/completed` | Same name. Feeds each JSON event to the state until the `result` event and process exit | 4 |
| `createTurnCaptureState`, `completeTurn`, `scheduleInferredCompletion`, `belongsToTurn` | Tracks turn ids, subagent threads and inferred completion | Same state, smaller. The `result` event marks the end, so no inference and no thread routing | 4 |
| `applyTurnNotification` | Handles `thread/started`, `turn/started`, `item/started`, `item/completed`, `error`, `turn/completed` | Handles `assistant.turn_start`, `assistant.message`, `assistant.reasoning`, `tool.execution_start`, `tool.execution_complete` and `result` (§7) | 4 |
| `recordItem`: `agentMessage` | Final answer text | `data.content` of the last `assistant.message` | 4 |
| `recordItem`: `reasoning` | Reasoning summary sections | `data.content` of each `assistant.reasoning`, one section each | 4 |
| `recordItem`: `fileChange`, `collectTouchedFiles` | Edited file paths | `usage.codeChanges.filesModified` in the `result` event | 4 |
| `recordItem`: `commandExecution` | Commands run | `tool.execution_start` with a shell tool (`bash` or `powershell`) | 4 |
| `recordItem`: `exitedReviewMode` | Native review text | None. The review text is the last agent message (the `/review` answer) | 5 |
| `describeStartedItem`, `describeCompletedItem` | Progress text per item type | Progress text per tool name: `view`, `glob`, `grep` give "investigating"; `create`, `edit`, `apply_patch` give "editing"; a shell tool gives "running" or "verifying" (same `looksLikeVerificationCommand`) | 4 |
| `collabAgentToolCall`, subagent thread labels | Codex subagents | Not tracked. The `task` tool is not in any profile | 4 |
| `runAppServerReview` | Read-only thread, then `review/start` with a target (native reviewer) | `runPromptModeReview`: a read-only run whose prompt is the `/review` slash command and the inline context (§7) | 5 |
| `runAppServerTurn` | `thread/start` or `thread/resume`, then `turn/start` with `model`, `effort`, `outputSchema` | `runPromptModeTurn`: a run with `--session-id` or `--resume`, `--model`, `--reasoning-effort`; `outputSchema` goes into the prompt text (§7) | 4 |
| `interruptAppServerTurn` | `turn/interrupt` through the broker, from the cancel process | `interruptPromptModeTurn`: returns `attempted: false`; prompt mode has no interrupt. Cancel kills the process tree, as upstream does next | 6 |
| `findLatestTaskThread` | `thread/list` with the `Codex Companion Task` name prefix | Returns the session id of the newest task job in the plugin state for this workspace with the same `write` value as the new run, or `null` (§7). Prompt mode has no session list | 6 |
| `buildTaskThreadName`, `buildPersistentTaskThreadName`, `TASK_THREAD_PREFIX` | Thread name for later lookup | Passed as `--name` on new task runs, and kept for the job title | 6 |
| `buildResultStatus` | `turn.status === "completed"` gives exit 0 | The `result` event decides: `result.exitCode === 0` gives 0. A kill after `result` (§7) does not change it. Without a `result` event, the run fails with the process exit code | 4 |
| `cleanCodexStderr` | Drops a Codex PATH warning | `cleanCopilotStderr`: drops empty lines. Real runs in ticket 4 printed nothing else on stderr, so there is no noise list (2026-10-08) | 4 |
| `parseStructuredOutput` | `JSON.parse` of the final message; Codex enforced the schema | Same, and it also accepts JSON inside one surrounding code fence. New `validateReviewOutput` checks the schema locally and fails the job when it does not match (§7) | 5 |
| `readOutputSchema` | Reads the schema file | Rename only | 5 |
| `DEFAULT_CONTINUE_PROMPT` | Prompt for `--resume-last` with no text | Rename only | 6 |
| `SERVICE_NAME` | `claude_code_codex_plugin` | Dropped. Prompt mode has no such field | 4 |
| `importExternalAgentSession`, `requestExternalAgentSessionImport`, `externalAgentSessionMigration`, `importedThreadIdForSource`, `sourceContentSha256`, `resolveCodexHome`, `EXTERNAL_AGENT_IMPORT_*` | Claude session transfer | Dropped with `transfer` | 4 |

## Companion: `scripts/codex-companion.mjs` → `scripts/copilot-companion.mjs`

| Upstream place | What it does with Codex | Copilot match | Ticket |
| --- | --- | --- | --- |
| `printUsage` | Lists subcommands, including `transfer` and `--model <model\|spark>` | Same list without `transfer` and without `spark` | 4 |
| `MODEL_ALIASES` (`spark`) | Maps `spark` to `gpt-5.3-codex-spark` | Empty map. Copilot has no `spark` model. The map stays so that a Copilot alias can be added later | 6 |
| `VALID_REASONING_EFFORTS`, `normalizeReasoningEffort` | `none` to `xhigh` | Same values; Copilot accepts them all (`copilot --help`). `max` is Copilot-only and not added | 6 |
| `buildSetupReport` | Checks node, npm, Codex, auth; next steps `npm install -g @openai/codex`, `!codex login` | Checks node, npm, Copilot version, auth. Next steps: `npm install -g @github/copilot`, `!copilot login`, and `!copilot login --device-code` if the browser flow is blocked | 4 |
| `handleSetup` | Review gate on or off | Rename only | 4 |
| `ensureCodexAvailable` | Install hint for `@openai/codex` | `ensureCopilotAvailable`, hint for `@github/copilot` and the version floor | 4 |
| `buildNativeReviewTarget`, `validateNativeReviewRequest` | Maps the target to `uncommittedChanges` or `baseBranch` for `review/start` | `validateNativeReviewRequest` keeps its checks. `buildNativeReviewTarget` is dropped; the companion collects the context with `collectReviewContext` instead | 5 |
| `executeReviewRun` (native branch) | `runAppServerReview` | `runPromptModeReview` with the review prompt | 5 |
| `executeReviewRun` (adversarial branch) | `runAppServerTurn` with `sandbox: "read-only"` and `outputSchema` | `runPromptModeTurn` with the read-only profile; the schema goes into the prompt | 5 |
| `buildAdversarialReviewPrompt` | Fills the template | Also fills `{{OUTPUT_SCHEMA}}` (§7) | 5 |
| `executeTaskRun` | `sandbox: write ? "workspace-write" : "read-only"`, `persistThread: true` | Write profile or read-only profile (§3). Sessions always persist | 6 |
| `resolveLatestTrackedTaskThread`, `findLatestResumableTaskJob` | Pick the newest finished task | Only tasks with the same `write` value as the new run; otherwise the error says to use `--fresh` (§7) | 6 |
| `handleTaskResumeCandidate` | Reports the newest finished task | Same, and the candidate also reports its `write` value (§7) | 6 |
| `handleTask`, `buildTaskRequest` | Parse task options and build the request | Also accept the internal `--context-dir <path>` option, which only the review gate uses (§7, gate context folder) | 6, 7 |
| `enqueueBackgroundTask` | Starts the worker, then writes the `queued` job record | Writes the `queued` record with its request first, then starts the worker, then stores its `pid` only if the job is still `queued`; if the worker cannot start, marks the job `failed` (§7, background start order; correctness) | 6 |
| `handleTaskWorker` | Checks that the job record and request exist, then runs the job | Claims the job inside `updateState` only if it is still `queued` (sets `running` and its `pid`); a cancelled or missing job exits without running (§7, background start order; correctness) | 6 |
| `spawnDetachedTaskWorker` | Background worker with `process.execPath`, no shell | Rename only | 6 |
| `handleStatus`, `waitForSingleJobSnapshot`, `handleResult` | Job state only | Rename only | 6 |
| `handleCancel` | Picks the job, signals its recorded `pid` (`interruptAppServerTurn`, then `terminateProcessTree`), then saves `cancelled` | In one `updateState`, re-reads the job, marks it `cancelled` and reads its current `pid` and `copilotPid`; then `interruptPromptModeTurn` (not attempted) and `terminateProcessTree` on both (§7, stopping a job; correctness) | 6 |
| `buildReviewJobMetadata`, `buildTaskRunMetadata`, `renderQueuedTaskLaunch` | "Codex Review", "Codex Task", `/codex:status` | Rename only | 5, 6 |
| `STOP_REVIEW_TASK_MARKER` | Marks the stop-gate task | Rename only (the text has no Codex name) | 7 |
| `handleTransfer`, `executeTransfer`, `renderTransferResult`, `transfer` case | Session transfer | Dropped | 4 |

## Hooks

| Upstream place | What it does with Codex | Copilot match | Ticket |
| --- | --- | --- | --- |
| `hooks/hooks.json` | `SessionStart`, `SessionEnd`, `Stop` with timeouts 5, 5, 900 | Same events and timeouts. The scripts keep their own work inside these limits (§7, hook time budgets) | 7 |
| `scripts/session-lifecycle-hook.mjs` → `handleSessionStart` | Exports `CODEX_COMPANION_SESSION_ID`, `CODEX_COMPANION_TRANSCRIPT_PATH`, `CLAUDE_PLUGIN_DATA` | Exports `COPILOT_COMPANION_SESSION_ID` and `CLAUDE_PLUGIN_DATA`. The transcript path was only for `transfer`, so it is dropped | 7 |
| same → `handleSessionEnd`, `cleanupSessionJobs` | Shuts down the broker; stops each running job's `pid` and prunes the jobs; clears broker state | Inside one `updateState` adds the session to `closedSessions` (job creation, claim and Copilot start are refused for companions that started before the closure; a resumed session's new companions are allowed), marks the session's queued and running jobs `cancelled` and reads the running jobs' `pid` and `copilotPid` (the worker claim and the Copilot start use the same lock); stops them with one shared wait of up to 2 s and then `SIGKILL`; then removes only the job ids captured in that first step, through `updateState` on fresh state, with the lock wait limited to the time left. Upstream saves its earlier snapshot with `saveState`, which could drop another session's new job. No broker (§7, hook time budgets) | 7 |
| same → `shellEscape`, `appendEnvVar` | Writes `export` lines to `CLAUDE_ENV_FILE` | Rename only | 7 |
| `scripts/stop-review-gate-hook.mjs` → `buildSetupNote` | `getCodexAvailability`, "Run /codex:setup" | `getCopilotAvailability`, "Run /copilot:setup" | 7 |
| same → `runStopReview` | Runs `codex-companion.mjs task --json <prompt>` (read-only) with `spawnSync` and a 15-minute limit; the limit kills only the companion | Runs `copilot-companion.mjs task --json` with the prompt on stdin, because Claude's last message can pass the Windows command-line limit (platform support). Read-only profile. The run limit is 840 s, so the hook can clean up and answer inside its 900 s timeout (§7, hook time budgets). On the limit it kills the companion's whole process tree with `terminateProcessTree`, then the `copilotPid` of the companion's job record, so no Copilot process is left (correctness; §7, stopping a job) | 7 |
| same → `buildStopReviewPrompt` | Instructions and Claude's last message; Codex inspects the repository with read-only `git` | Also fills `{{REVIEW_INPUT}}` with the working-tree context from `collectReviewContext`, and the patch folder above the inline limit (§2). The read-only profile has no shell, so Copilot cannot run `git` itself | 7 |
| same → `parseStopReviewOutput`, messages | `ALLOW:` or `BLOCK:` first line; "Codex" in reasons | Rename only | 7 |

## Shared modules

| Upstream place | What it does with Codex | Copilot match | Ticket |
| --- | --- | --- | --- |
| `scripts/lib/process.mjs` → `runCommand` | `shell` is on by default on Windows; a child killed by a signal gets `status: 0` | `shell: false` always (Principle IV). A child killed by a signal keeps `status: null`, so checked calls fail (correctness; decided 2026-10-08, PR review) | 3 |
| (none upstream) | The shell finds `.cmd` shims on Windows | New `resolveLauncher(name)`: the one helper for Windows `.cmd` shims, used for `npm` and `copilot` (§4) | 3 |
| same → `binaryAvailable` | Runs `<command> --version` through `runCommand` | Resolves the command with `resolveLauncher` first, so `npm` and `copilot` are found on Windows without a shell | 3 |
| same → `terminateProcessTree` | Sends `SIGTERM` to the process group on macOS and Linux and returns; on `ESRCH` it does not signal the process itself; `taskkill /T /F` on Windows | Signals the process itself when there is no group, and sends `SIGKILL` to what is still alive after up to 5 seconds (§7, stopping a job). Returns a promise, so the wait does not block the event loop (§7, changed 2026-10-08). The callers start each process they may stop as its own group (§7, process groups) | 3, 4, 7 |
| same → `formatCommandFailure` | No Codex calls | Rename only | 3 |
| `scripts/lib/git.mjs` → `buildAdversarialCollectionGuidance` | Self-collect text: "inspect the target diff yourself with read-only git commands" | "Read the patch files listed below with the view tool". The companion writes the exact patches to a folder passed with `--add-dir` (§2, ticket 5). Copilot has no shell in reviews | 3, 5 |
| same, rest of `git.mjs` | Runs `git` without a shell | Also passes `--no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false` to every call and `--no-textconv` to every `git diff` (§4b: no index writes, no hooks). Clean and process filters still run, as in any git call (§4b, limit) | 3 |
| same → `formatUntrackedFile` | Reads each untracked file, following symlinks | Shows an untracked symlink as `(skipped: symlink)` and never reads its target (§4b, decided 2026-10-08; security) | 3 |
| same → `getWorkingTreeState` | Lists unstaged files with `git diff --name-only`; lists untracked files with `git ls-files` without `-z` | Lists unstaged files with `git diff --numstat --no-renames`, which drops files whose only change is stale stat data (§4b, changed 2026-10-08; correctness). Lists untracked files with `git ls-files -z`, so a name that git would quote (for example one with non-ASCII letters) is read, not skipped (§4b, added 2026-10-09, ticket 5 Codex review; correctness) | 3, 5 |
| `scripts/lib/state.mjs` → `FALLBACK_STATE_ROOT_DIR` | `<tmp>/codex-companion`, a shared folder another local user can create first | `~/.copilot-companion/state`, owned by the user; never the shared temp folder (§7, locked state updates; security) | 3 |
| same → `updateState`, `saveState` | Read, change, save and prune with no lock between processes; plain overwrite | Hold the `state.json.lock` lock for the whole update, and write through a temp file and a rename (§7, locked state updates; correctness). `saveState` is dropped, because it saves a snapshot read earlier. An update refuses a state file it cannot read, and deletes pruned files only after the save (§7, decided 2026-10-08) | 3 |
| same → `pruneJobs` | Keeps the 50 most recently updated jobs, whatever their status | Keeps every queued or running job; the 50 cap applies to finished jobs only (§7, locked state updates; correctness). A pruned job also loses its review patch folder, `jobs/<id>.patches` (§2, added 2026-10-09) | 3, 5 |
| `scripts/lib/fs.mjs` → `createTempDir` | Prefix `codex-plugin-` | Prefix `copilot-plugin-` | 3 |
| `scripts/lib/tracked-jobs.mjs` → `SESSION_ID_ENV`, `createProgressReporter` | `CODEX_COMPANION_SESSION_ID`, `[codex]` stderr prefix | `COPILOT_COMPANION_SESSION_ID`, `[copilot]` | 3 |
| same → `runTrackedJob` | Writes `running` at the start and the final status at the end, unconditionally | Both writes go through `updateState` and never revive a `cancelled` or missing job; a cancelled job exits without running (§7, background start order; correctness) | 3 |
| same → `createJobProgressUpdater` | Writes phase and ids with `upsertJob`, which creates a missing job | Changes only a job that is still `running` (§7, background start order; added 2026-10-08; correctness) | 3 |
| `scripts/lib/job-control.mjs` → import of `getSessionRuntimeStatus` | From `codex.mjs` | From `copilot.mjs`. Without a broker this function always reports "direct startup", so ticket 3 creates `copilot.mjs` with only this function. Ticket 4 adds the rest of the adapter | 3 |
| same → `inferLegacyJobPhase` | Matches "starting codex", "codex error:" | Matches "starting copilot", "copilot error:" | 3 |
| same → error text | `/codex:status`, `/codex:cancel`, "Codex jobs" | Rename only | 3 |
| `scripts/lib/render.mjs` → `formatCodexResumeCommand` and the result renderers | `codex resume <threadId>`, "Codex session ID" | `copilot --resume=<sessionId>` and "Copilot session ID" for write tasks. Read-only jobs show only the session id, with no command: an interactive command would put trust in the plugin home (§7), and the companion's `--resume` means "the newest task", not this session | 3 |
| same → titles and hints | "# Codex Setup", `- codex:`, `/codex:*` | Rename only | 3 |
| `scripts/lib/args.mjs`, `scripts/lib/prompts.mjs`, `scripts/lib/workspace.mjs` | No Codex calls | Copied unchanged | 3 |
| `scripts/lib/claude-session-transfer.mjs` | Finds the Claude transcript for `transfer` | Dropped | 3 |

## Prompts, schema, commands, agent and skills

| Upstream place | What it does with Codex | Copilot match | Ticket |
| --- | --- | --- | --- |
| `prompts/adversarial-review.md` | "You are Codex"; "matching the provided schema" (Codex gets the schema separately) | "You are Copilot"; adds an `{{OUTPUT_SCHEMA}}` block (§7) | 5 |
| (none upstream) | Codex's native reviewer needs no prompt | New `prompts/review.md`: the `/review` slash command and `{{REVIEW_INPUT}}` | 5 |
| `prompts/stop-review-gate.md` | Mentions `/codex:setup` and `/codex:status` | Renamed, plus a `{{REVIEW_INPUT}}` block for the working-tree context | 7 |
| `schemas/review-output.schema.json` | Output schema for Codex | Copied unchanged | 5 |
| `commands/review.md`, `commands/adversarial-review.md` | Call `codex-companion.mjs`; "Codex" text; tell Claude to run `git status` and `git diff --shortstat` to estimate the review size | Renamed. The size-estimate commands get the §4b hardening: `git --no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false status ...` and `git --no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false diff --shortstat --no-textconv ...` (security, no index writes) | 5 |
| `commands/rescue.md` | `codex:codex-rescue`, `--model <model\|spark>`, the `spark` mapping | `copilot:copilot-rescue`, `--model <model>`, no `spark` line | 6 |
| `commands/status.md`, `commands/result.md`, `commands/cancel.md` | Call the companion | Rename only | 6 |
| `commands/setup.md` | Offers `npm install -g @openai/codex`; keeps `!codex login` guidance | Offers `npm install -g @github/copilot`; keeps `!copilot login` guidance | 4 |
| `commands/transfer.md` | `/codex:transfer` | Dropped | 4 |
| `agents/codex-rescue.md` | Forwards to `codex-companion.mjs task`; `spark` mapping; skills `codex-cli-runtime`, `gpt-5-4-prompting` | `agents/copilot-rescue.md`, forwards to `copilot-companion.mjs task`; no `spark`; skills `copilot-cli-runtime`, `gpt-5-4-prompting` | 6 |
| `skills/codex-cli-runtime/SKILL.md` | Contract for calling the companion | `skills/copilot-cli-runtime/SKILL.md`; no `spark` | 4 |
| `skills/codex-result-handling/SKILL.md` | How Claude shows Codex output | `skills/copilot-result-handling/SKILL.md`, rename only | 5 |
| `skills/gpt-5-4-prompting/SKILL.md` and `references/*.md` | Prompting advice for Codex and GPT-5.4 | Same name. `Codex` becomes `Copilot` (spec FR-031). Reference files `codex-prompt-*.md` become `copilot-prompt-*.md` | 6 |
| `.claude-plugin/plugin.json` | `name: "codex"`, author OpenAI | `name: "copilot"`, author tmathura | 2 |
| `CHANGELOG.md`, `LICENSE`, `NOTICE` (plugin folder) | Plugin copies of the release files | Kept, with the Apache-2.0 change notice (spec FR-002) | 2 |

## Repo root

| Upstream place | What it does with Codex | Copilot match | Ticket |
| --- | --- | --- | --- |
| `.claude-plugin/marketplace.json` | Marketplace `openai-codex`, plugin `codex` | Marketplace `tmathura-copilot`, plugin `copilot` | 2 |
| `package.json` | `@openai/codex-plugin-cc`, Node 18.18+, `prebuild` runs `codex app-server generate-ts`, `build` runs `tsc` | `copilot-plugin-cc`, Node 22+, no `prebuild`, `build` runs `tsc -p tsconfig.prompt-mode.json` | 2 (scripts), 4 (`build`) |
| `package-lock.json` | Locks the devDependencies | Same | 2 |
| `scripts/bump-version.mjs` | Checks and sets the version in package, lock, plugin and marketplace files | Same, with `plugins/copilot` paths and the `copilot` plugin entry | 2 |
| `.github/workflows/pull-request-ci.yml` | Ubuntu, Node 22, installs `@openai/codex` for type generation, runs tests and build | Runs on Ubuntu, macOS and Windows (Principle V). No Copilot install: tests use the fake CLI, and the types are hand-written. The checkout does not keep the token (`persist-credentials: false`; security, added 2026-10-08) | 2 |
| `.gitignore` | Ignores `plugins/codex/.generated/` | Drops that line; nothing is generated | 2 |
| `README.md` | Codex install and command docs | New README with "Differences from the Codex plugin" (ticket 8 writes it in full; each earlier ticket adds its own differences) | 2 to 8 |
| `LICENSE`, `NOTICE` | Apache-2.0 and OpenAI notice | Kept, plus a notice that names the changes | 2 |

## Tests

| Upstream place | What it does with Codex | Copilot match | Ticket |
| --- | --- | --- | --- |
| `tests/fake-codex-fixture.mjs` | Fake `codex` binary that speaks the app-server protocol | `tests/fake-copilot-fixture.mjs`. Ticket 2: `--version` and `--help` only. Ticket 4: prompt mode, which reads the prompt on stdin, records its arguments and environment, and prints JSON events, with the failure modes of Principle VI | 2, 4 |
| `tests/helpers.mjs` | Temp folders and git repos; `run()` uses a shell on Windows | Renamed, and `run()` never uses a shell (§4, test helper; decided 2026-10-08) | 2 |
| `tests/bump-version.test.mjs` | Version script | Rename only | 2 |
| `tests/process.test.mjs`, `tests/git.test.mjs`, `tests/state.test.mjs`, `tests/render.test.mjs` | Shared modules | Rename only, plus tests for no shell, and for spaces and shell characters in arguments | 3 |
| `tests/runtime.test.mjs` | End-to-end companion runs against the fake | Split by ticket: setup (4), reviews (5), tasks and jobs (6), hooks (7) | 4 to 7 |
| `tests/commands.test.mjs` | Checks the command files | Rename only, without `transfer` | 5, 6 |
| `tests/broker-endpoint.test.mjs` | Broker endpoint parsing | Dropped | 4 |
