# Research: Copilot transport and review design

Ticket 1 of the Copilot plugin port. This file holds the facts behind the transport decision. The
call-site map is in [call-site-map.md](call-site-map.md).

Sources:

- Official docs, read on 2026-10-08:
  [programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference),
  [command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference),
  [ACP server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server),
  [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference),
  [install](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli),
  [allowing tools](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools),
  [running programmatically](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically).
- `copilot help`, `copilot help permissions`, `copilot help sandbox` and `copilot help environment`
  from Copilot CLI 1.0.93.
- The Copilot CLI changelog (`github/copilot-cli`, `changelog.md`), for the version in which each
  feature came.
- Live checks with Copilot CLI 1.0.93 on Windows 11, in a throwaway git repository. Each result
  below that says "tested" comes from these checks.

## 1. Copilot CLI setup

- **Decision**: Install with `npm install -g @github/copilot`. Node 22 or later is needed.
- **Facts**:
  - Copilot CLI 1.0.93 was installed on Node 24.21.0. A read-only call (`--available-tools=view`)
    returned the expected answer. The user was already logged in, so no `/login` was needed.
  - The login is stored in the OS credential store. An empty `COPILOT_HOME` still finds it (tested).
    An invalid `COPILOT_GITHUB_TOKEN` did not cause an error either; Copilot fell back to the stored
    login (tested). So the real "not logged in" output could not be seen in ticket 1.
  - Token variables, in order: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`. Classic `ghp_`
    tokens do not work.
  - On Windows, `copilot` on the PATH is the npm shim `copilot.cmd`. It runs
    `node <npm-root>/@github/copilot/npm-loader.js`. The package also ships a native
    `copilot.exe`. A WinGet install puts `copilot.exe` on the PATH.

## 2. Options compared

| Option | What it is |
| --- | --- |
| **A. ACP** | Start `copilot --acp --stdio`. Talk JSON-RPC 2.0, one JSON message per line, over stdin and stdout. |
| **B. Prompt mode** | Start `copilot --output-format json` once for each run. Send the prompt on stdin. Read one JSON event per line until the `result` event. |

The community ports, read for ideas only:

| Repo | Stars | Last push | How it calls Copilot | Notes |
| --- | --- | --- | --- | --- |
| wagnersza/copilot-plugin-cc | 45 | 2026-04-02 | `@github/copilot-sdk` npm package (says "ACP") | Approves every permission request (`onPermissionRequest` returns `approved`). Needs a runtime npm package. Both break the constitution (Principles II and IV). |
| chinlung/copilot-plugin-cc | 0 | 2026-04-04 | `copilot -p`, JSON output | Uses `shell: true` on Windows. Read-only mode passes no flags. `--write` passes `--allow-all`. |
| apappascs/copilot-plugin-cc | 0 | 2026-08-12 | `copilot -p`, JSON output | Always passes `--allow-all-tools`. Read-only adds `--deny-tool write --deny-tool shell`. Keeps `transfer`. |

GitHub search (repos, more than 20 stars, pushed on or after 2026-07-08): no other Claude Code to
Copilot CLI plugin matched. The hits with more than 20 stars (superpowers-zh, squeez, Formic) are
not delegation plugins. The other `copilot-plugin-cc` repos have fewer than 20 stars.

Evidence, run on 2026-10-08:

- `gh search repos "claude code copilot cli" --stars ">20" --updated ">=2026-07-08"` returned
  `jnMetaCode/superpowers-zh` (8268 stars, pushed 2026-10-04), `claudioemmanuel/squeez` (216,
  2026-10-07) and `rickywo/Formic` (41, 2026-07-13). None hands reviews or tasks from Claude Code to
  the Copilot CLI.
- `gh search repos "copilot-plugin-cc"` returned 24 repos. Only `wagnersza/copilot-plugin-cc` has
  more than 20 stars (45), and its last push is 2026-04-02.
- `gh api repos/<owner>/copilot-plugin-cc` gave the star counts and push dates in the table above.
- The live checks used Copilot CLI 1.0.93 in a throwaway git repo:
  - `copilot --output-format json` with the prompt on stdin, with `--available-tools=view` and with
    `--available-tools=view,create` (denied `create`: `"code":"denied"`).
  - A `.github/hooks/*.json` hook that writes a file, in prompt mode (not run) and in ACP mode (run).
  - `--resume=<id>` in a new process.
  - An ACP client written for the check: `initialize`, `session/new`, `session/prompt`,
    `session/request_permission` (rejected), `session/cancel` (`stopReason: "cancelled"`) and
    `authenticate`.
  - `--deny-tool='shell(git push)'` against `git -C . push` and `git -c core.askPass=x push`
    (both denied).
  The event names and fields in §7 are copied from those runs.

### Comparison on the points of Principle III

| Point | A. ACP | B. Prompt mode |
| --- | --- | --- |
| **Tool permissions** | Server flags `--available-tools`, `--excluded-tools`, `--allow-tool` and `--deny-tool`. ACP also asks the client before each tool call that needs approval (`session/request_permission`). Tested: the client rejected a file create, and no file was written. | The same flags, on each run. A tool call that needs approval is denied at once, because nobody can answer. Tested: `create` was denied with "Permission denied because no interactive user response was available". |
| **Code from the repository under review** | **Runs.** Tested: a `.github/hooks/*.json` file in a folder that was never trusted ran its `sessionStart` and `userPromptSubmitted` commands, with only read tools available. It still ran with `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=false` and an empty `COPILOT_HOME`. No documented flag turns hooks off for one run. | **Off by default.** Prompt mode "gates repo hooks and workspace MCP behind opt-in env vars for secure-by-default behavior" (changelog 1.0.40). Repo hooks load only when the folder is trusted (changelog 1.0.49), or when `COPILOT_ALLOW_ALL` or the opt-in variables are set. Tested: the same hook file did not run. |
| **Saved approvals and user config** | Saved approvals in `permissions-config.json` apply (changelog 0.0.400). User hooks and plugin hooks run. | The same with the default `COPILOT_HOME`. A plugin-owned `COPILOT_HOME` has no saved approvals, no trusted folders, no user hooks and no user MCP servers. The login still works from the credential store (tested). |
| **Sandbox** | Same for both. `--sandbox` (1.0.70 and later) puts shell commands in an OS sandbox. By default the sandbox can read and write the working folder, and a flag cannot make the folder read-only. Tool filtering must make a review read-only. | Same. |
| **Streaming** | `session/update` notifications. The open ACP spec documents them. Tested. | JSON events such as `assistant.message_delta`, `assistant.message`, `tool.execution_start`, `tool.execution_complete` and a final `result` with `sessionId`, `exitCode` and `usage.codeChanges.filesModified`. Tested. The docs say only "JSONL, one JSON object per line". They do not document the event names or fields. |
| **Cancel** | `session/cancel` stops a turn cleanly (tested), but only the process that owns the pipe can send it. `/copilot:cancel` runs in another process, so it kills the process tree. | Kill the process tree (`taskkill /T /F` on Windows, process group `SIGTERM` elsewhere). The docs give exit code 130 for `SIGINT` or `SIGTERM`. |
| **Sessions** | `session/new`, `session/load`, `session/list`, `session/close`. Tested. | `--resume=<id>`, `--continue`, `--session-id=<uuid>` (sets the id of a new session before it starts), `--name`. Tested: a new process resumed a session by id and remembered the last answer. |
| **Windows** | Needs a no-shell launcher for the `.cmd` shim (section 4). The prompt goes over stdin. | Same launcher. The prompt must go on stdin, not in `-p`, because Windows limits a command line to about 32,000 characters and review prompts hold diffs up to 256 KB. Tested: a stdin prompt with `--output-format json` works. |
| **Login check** | `authenticate` returned success even for an unknown method id (tested), so it proves nothing. | No login request. A tiny prompt is the only sure check; it costs one premium request. |
| **CLI versions** | `--acp` since 0.0.397; tool flags work in ACP from 1.0.60. The docs mark ACP as **public preview, subject to change**. | `--output-format json` since 0.0.422; `--available-tools` since 0.0.370. The documented automation path, not marked preview. The event format has no published schema. |
| **Closeness to upstream** | Close: JSON-RPC client, threads to sessions, turns to prompts, `turn/interrupt` to `session/cancel`. | Further: one process per run. `app-server.mjs`, the broker files and the notification routing become one JSON event reader. |
| **Code size** | A JSON-RPC client like upstream's: `app-server.mjs` at commit `db52e28` is 354 lines (`wc -l`), plus a permission handler. Not measured for the port, because no code exists yet. | A line reader for JSON events and no request handling. Expected to be smaller than the client on the left; not measured, because no code exists yet. |

### What neither option can do

- **Codex's built-in reviewer.** Upstream `/codex:review` calls `review/start`. Copilot has a
  built-in `/review` agent, but it collects the diff with `git` in the shell. Tested: with only
  `view`, `glob` and `grep`, `/review` could not see the diff. A shell allow-list such as
  `shell(git diff)` is not safe. Copilot matches only the first subcommand, so
  `git diff --output=<file>` would be allowed and could write a file. Tested: `/review` with the diff
  in the stdin prompt, and only read tools, gave a normal review.
- **Upstream's "self-collect" mode.** Upstream lets Codex run read-only `git` commands for large
  diffs. Without a shell, Copilot cannot do this. Reading only the current files would lose deleted
  code, the staged and unstaged split, and the merge-base. So the port keeps upstream's inline limit,
  and above it the companion writes the exact patches (the same `git diff` commands upstream inlines:
  staged, unstaged, untracked files, or the branch range) to a new folder for the run. It passes that
  folder with `--add-dir`, which lets the `view` tool read it, names the files in the prompt, and
  deletes the folder after the run.
- **A shared runtime.** Upstream's broker shares one `codex app-server` per Claude session. Prompt
  mode has no server to share. The broker files are not ported.
- **Policy hooks.** An administrator can install machine-wide policy hooks. They run in every mode
  and nothing can turn them off. They are the administrator's choice, like git hooks set by policy.
  The README says so.
- **Session import.** Copilot 1.0.85 and later has `copilot sessions import <transcript.jsonl>`. It
  reads Copilot's own "semantic session JSONL" format, not a Claude transcript. `transfer` stays out,
  as the constitution says. A future spec can look at it again.

## 3. Read-only and write runs

This section is the one place that lists the Copilot arguments and environment of each run. The
data model, the contracts, the plan and the tasks link here.

- **Decision (every run, both profiles)**:
  - `--output-format json`, with the prompt on stdin.
  - `--no-ask-user`, so the model never waits for an answer, and `--no-auto-update`, so the version
    that setup checked is the one that runs.
  - `--secret-env-vars=GH_TOKEN,COPILOT_PROVIDER_API_KEY,COPILOT_PROVIDER_BEARER_TOKEN`. Copilot
    redacts `GITHUB_TOKEN` and `COPILOT_GITHUB_TOKEN` by default, but not these.
  - `--session-id=<new uuid>` for a new run, or `--resume=<id>` (§7). `--model`,
    `--reasoning-effort` and `--name` when set.
  - The child environment drops `COPILOT_ALLOW_ALL`, `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS`,
    `GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP` and `GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS`. An
    inherited `COPILOT_ALLOW_ALL` would otherwise give allow-all to any run.
- **Decision (read-only runs: reviews, the review gate and tasks without `--write`)**:
  - `--available-tools=view,glob,grep`. Tools not in this list do not exist for the model. This
    removes `bash`, `powershell`, `create`, `edit`, `apply_patch`, `web_fetch`, `task`, memory and
    every MCP tool. Tested: the GitHub MCP tools were listed as disabled, and the model saw one tool
    (`tool_count: 1`) when only `view` was listed.
  - `--deny-tool=write,shell,memory` as a second layer. The command reference says: "For multiple
    tools, use a quoted, comma-separated list". Deny rules win over `--allow-all` and over saved
    approvals.
  - `COPILOT_HOME` set to a plugin-owned folder: `$CLAUDE_PLUGIN_DATA/copilot-home`, or
    `~/.copilot-companion/copilot-home` when `CLAUDE_PLUGIN_DATA` is not set. It is never in the
    shared temp folder, where another user could prepare it. It has no trusted folders, so
    repository hooks and workspace MCP servers stay off. It also has no user hooks, no saved
    approvals, no user MCP servers and no user plugins.
  - Login: the plugin home has no stored login file. The login still works when it is in the OS
    credential store (tested) or in a token variable (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`,
    `GITHUB_TOKEN`), which the child environment keeps. Without a credential store, `copilot login`
    saves the token in a file under the user's `COPILOT_HOME` (command reference), which the plugin
    home cannot see. For that case, setup tells the user to set `COPILOT_GITHUB_TOKEN` to a
    fine-grained token with the "Copilot Requests" permission. The plugin never copies a login file.
  - A review above the inline limit also gets `--add-dir=<patch folder>` (§2).
- **Decision (when a read-only run refuses to run)**: spec FR-018 applies in two cases.
  - Before the prompt: the Copilot version is below the floor, or Copilot exits with an error
    before the first event. The run stops with that error.
  - During the run: Copilot starts a tool other than `view`, `glob` or `grep`
    (`tool.execution_start`). The run stops, the process tree is killed, and the failure names the
    tool. This should never happen with these flags. It guards against a Copilot change.
- **Decision (`--write` tasks, chosen by the owner)**:
  `--available-tools=view,glob,grep,create,edit,apply_patch,<shell>`, `--allow-tool=write,shell`,
  `--deny-tool=shell(git push)` and `--sandbox`. `<shell>` is `bash` on macOS and Linux, and
  `powershell` on Windows. Upstream `workspace-write` lets Codex run commands and edit files inside an
  OS sandbox, so the shell is needed for parity (tests, builds).
  - `shell(git push)` also blocks a push with git's global options. Tested: `git -C . push` and
    `git -c core.askPass=x push` were both denied by this rule.
  - The file tools stay in the working folder, because `--allow-all-paths` is never passed.
  - Shell commands run inside Copilot's OS sandbox (`--sandbox`, 1.0.70 and later). Its default
    policy lets commands write in the working folder, the temp folder and the user profile, so it is
    wider than Codex's `workspace-write`.
  - Where the host cannot run the sandbox, Copilot warns and runs shell commands with the user's
    full rights. The docs give no reliable check for this, so the plugin cannot refuse. The README
    says so.
  - Write tasks use the user's own
  `COPILOT_HOME`, so the user's settings, hooks and trusted folders apply, as they would if the user
  ran Copilot by hand.
- **Never passed**: `--allow-all-tools`, `--allow-all`, `--yolo`, `--allow-all-paths`.
- **Rationale**: Principle IV. The CLI's own controls must make reviews read-only: tool filters,
  deny rules and the documented `COPILOT_HOME`. The sandbox cannot make the working folder read-only.
- **Alternatives rejected**:
  - ACP: it runs the reviewed repository's hooks (section 2).
  - `--allow-all-tools` with deny rules (apappascs): the constitution names `--allow-all-tools` as
    needing approval, and deny rules miss MCP tools from the user's config.
  - No flags (chinlung read-only): it depends on saved approvals not existing.
  - Approve everything (wagnersza): not safe.

## 4. Starting Copilot and npm without a shell

- **Decision**: One helper, `resolveLauncher(name)` in `scripts/lib/process.mjs`, turns a command
  name into a program and leading arguments. Setup uses it for `npm`; the adapter uses it for
  `copilot`.
  - On macOS and Linux: the name itself.
  - On Windows, the first match on the PATH:
    - `<name>.exe`: spawn it directly (for example a WinGet install of Copilot).
    - `<name>.cmd` written by npm for a global package: spawn `node` (`process.execPath`) with the
      script the shim names after `%dp0%`. For Copilot this is
      `<shim folder>/node_modules/@github/copilot/npm-loader.js` (seen on this machine).
    - `npm.cmd` from the Node install: spawn `node` with `<shim folder>/node_modules/npm/bin/npm-cli.js`
      (seen on this machine).
    - Anything else: the command counts as not found, with a message that it cannot start without a
      shell.
    - A name that is already a path (it contains `\` or `/`) and is not a `.cmd` or `.bat` file is
      used as given (added 2026-10-08, PR review).
  - Never pass `shell: true`.
- **Rationale**: Principle IV ("If Windows needs a `.cmd` shim, it MUST live in one helper").
  Upstream uses a shell on Windows. Node refuses to spawn a `.cmd` file without a shell, and with a
  shell `cmd.exe` would read the arguments. Tested: `spawnSync("npm", ["--version"], { shell: false })`
  fails with `ENOENT` on Windows, so setup needs the helper for `npm` too.
- **Alternatives rejected**: `shell: true` (unsafe), `cmd.exe /c` with escaping (fragile), and
  hard-coding `copilot-win32-x64/copilot.exe` (it ties the plugin to one npm package layout and CPU).
- **Test helper**: `run()` in `tests/helpers.mjs` never uses a shell. Decided 2026-10-08, after the
  ticket 2 code review. Reason: correctness and Principle IV. Upstream turns the shell on for a bare
  command name on Windows. Node then joins the arguments without quotes, so a temp path with a space
  splits in two, and `&` or `^` in a path runs as shell text. `node` and `git` start without a shell
  on every system. A test that must start `npm` or `copilot` goes through `resolveLauncher`.
  `tests/helpers.test.mjs` checks that spaces and shell characters reach the child unchanged.
  Rejected alternative: upstream's shell on Windows, kept for parity.

## 4b. Git calls that write nothing and start no hooks

- **Decision**: every `git` call in `scripts/lib/git.mjs` passes the global options
  `--no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false`, and every `git diff`
  call also passes `--no-textconv` next to upstream's `--no-ext-diff`. The git commands that
  `commands/review.md` and `commands/adversarial-review.md` give Claude for the size estimate get the
  same options. The unstaged file list comes from `git diff --numstat --no-renames`, not
  `git diff --name-only`.
- **Rationale (index)**: correctness. `git status` can refresh cached file data in `.git/index`
  while it reads; `--no-optional-locks` stops that (git-status manual). A review must leave the
  repository byte for byte the same (spec User Story 2).
- **Changed 2026-10-08** (ticket 3, found by the T031 index test with git 2.56): `git diff` of the
  working tree still rewrote `.git/index` when a file's cached stat data was stale, even with
  `--no-optional-locks`. Its refresh is controlled by `diff.autoRefreshIndex`, so that option is now
  off on every call. Without the refresh, `git diff --name-only` also lists files whose content
  matches the index (only their stat data changed), which would make a clean tree look dirty and
  pick a working-tree review. `--numstat` compares the content and drops them, and quotes paths as
  `--name-only` does. Rejected alternative: the earlier decision, `--no-optional-locks -c
  core.fsmonitor=false` only, which does not keep the index unchanged.
- **Rationale**: security. `shell: false` stops a shell, but git itself can start a configured
  `core.fsmonitor` hook (on `git status`) or a `textconv` program (on `git diff`). Reviews and the
  gate run these calls before Copilot starts, so no Copilot control covers them. Neither is needed
  for a review, and raw patches are the right input.
- **Limit**: clean and process filters (`filter.<driver>.clean` and `.process`, for example Git LFS)
  still run, as they do in every `git status` or `git diff` the user runs. They are needed for a
  correct diff. Their commands come from the user's own git config; a cloned repository can only name
  a driver in `.gitattributes`, not define its command.
- **Untracked symlinks** (decided 2026-10-08, ticket 3 Codex review round 4): the review context
  shows an untracked symlink as `(skipped: symlink)` and never reads its target. Reason: security.
  A link can point outside the repository, for example at a key file, and upstream would put that
  file's text in the prompt before any Copilot control applies. A broken link keeps upstream's
  text. Rejected alternative: upstream, which follows the link.
- **Limit (submodules)**, found in the ticket 3 code review (2026-10-08): `--submodule=diff` makes git
  start a second `git diff` inside each changed submodule. Command-line flags such as `--no-textconv`
  and `--no-ext-diff` do not reach it (the `-c` options do), so a textconv program set in the user's
  own config for that submodule still runs. As with filters, a cloned repository cannot define the
  command. Kept as upstream, because the inline submodule diff is review input. Rejected
  alternative: `--submodule=short`, which drops that input.

## 5. Supported Copilot CLI versions

- **Decision**: The lowest supported version is **1.0.93**, the version tested in this ticket. Setup
  checks it with `--no-auto-update --version`, the same flag every run uses. `copilot help
  environment` says `--no-auto-update` "makes launches ignore any newer version already in the
  package cache", so a bare `--version` can report a different build from the one that runs. Setup
  refuses older versions and says how to update. Raise the floor only after a test run on the newer
  version.
- **Rationale**: The prompt-mode event format has no published schema, so the plugin claims only what
  was tested. Most users run the newest version, because Copilot updates itself by default.

## 6. Decision: option B, prompt mode

**Chosen by the owner on 2026-10-08.**

The owner first chose ACP. The Codex review of this plan then asked whether hooks bypass the tool
filters. The live check in section 2 showed that ACP runs the reviewed repository's hooks and that
no documented flag stops it. The owner then switched to prompt mode.

Prompt mode is better on the point that Principle III ranks first, permission control. It keeps code
from the repository under review from running, and the plugin-owned `COPILOT_HOME` removes user hooks
and saved approvals too. It is equal on sandbox, cancel, sessions and Windows. It is better on CLI
version support, because it is not marked preview.

What it loses:

- The permission callback. The tool filters and deny rules remain, and an unapproved tool is
  denied because nobody can answer.
- A published event schema. The parser reads only the events it needs (section 7) and ignores the
  rest. A run with no `result` event fails with a clear error.
- Closeness to upstream. The adapter keeps upstream's module boundary and function names (section
  7), but the protocol client becomes a JSON event reader.

## 7. Design rules that follow from prompt mode

Later tickets apply these rules. The call-site map uses them.

- **Names**: change `codex` to `copilot`, `Codex` to `Copilot`, `app-server` to `prompt-mode` and
  `AppServer` to `PromptMode`. Examples: `scripts/lib/app-server.mjs` becomes
  `scripts/lib/prompt-mode.mjs`, and `runAppServerTurn` becomes `runPromptModeTurn`. Job record fields
  keep their upstream names: `threadId` holds the Copilot session id, and `turnId` holds the
  `turnId` of the last `assistant.turn_start` event.
- **One process per run**: `copilot --output-format json` with the flags of section 3, the prompt on
  stdin, and the workspace root as the working folder. `--model <m>` and `--reasoning-effort <e>`
  are added when set.
- **Session ids**: a new run passes `--session-id=<new uuid>`, so the job knows its session id before
  Copilot starts. A resumed run passes `--resume=<id>`.
- **Events read**: `assistant.message` (`data.content` of the last one is the final answer),
  `assistant.reasoning` (reasoning summary), `assistant.turn_start` (turn id),
  `tool.execution_start` and `tool.execution_complete` (progress, edited paths), and `result`
  (`sessionId`, `exitCode`, `usage.codeChanges.filesModified`). All other events are ignored. A line that is
  not JSON, or no `result` before the process exits, fails the run with the stderr text.
- **Exit after `result`**: the `result` event ends the run. If the process has not exited 5 seconds
  later, the helper kills the process tree and keeps the result. The `result` event decides success;
  the forced exit does not. There is no other run deadline,
  as upstream has none; cancel and the review gate's 840 s limit stop long runs.
- **Structured output**: prompt mode has no output schema setting, unlike Codex `turn/start`
  (`outputSchema`). The adversarial-review prompt puts the schema text in the prompt.
  `parseStructuredOutput` also accepts JSON inside one surrounding code fence. Then
  `validateReviewOutput` checks the parsed value against `schemas/review-output.schema.json` (the
  keywords it uses, applied at every level: `type`, `properties`, `enum`, `required`,
  `additionalProperties`, `minLength`, `minimum`, `maximum`, `items`). A value that fails sets `parseError` and fails the job. This does what
  Codex's `outputSchema` did. Upstream's looser shape check in `render.mjs` stays as it is.
- **Native review**: `/copilot:review` sends Copilot's `/review` slash command, followed by the context
  from `collectReviewContext`. The text lives in a new file, `prompts/review.md`. The output stays
  free text, shown by `renderNativeReviewResult` as upstream does.
- **Login check**: setup runs one tiny read-only prompt in a neutral folder (the plugin data folder)
  and reads the `result` event. It costs one premium request for each `/copilot:setup`. A BYOK
  provider (`COPILOT_PROVIDER_BASE_URL`) needs no GitHub login. Ticket 4 records the real
  "not logged in" output: the owner logs out once (`/logout` in an interactive session), runs the
  check, and logs in again. The fake CLI copies that output.
- **Sessions are kept**: upstream asks Codex not to keep review threads (`ephemeral`). Copilot always
  keeps sessions. Read-only sessions live in the plugin-owned `COPILOT_HOME`, so they stay out of the
  user's own session list. `docs/operations.md` says how to clean them up.
- **The plugin home stays untrusted**: a folder becomes trusted only when someone runs Copilot
  interactively and accepts the trust prompt. The plugin runs Copilot only in prompt mode, so its
  home never gets a trusted folder. Read-only job reports therefore show only the session id, with
  no resume command, and `docs/operations.md` warns not to start Copilot by hand
  with the plugin home. Where Copilot stores trust is not documented, so the plugin cannot check it.
- **Resume stays in one mode**: a session lives in the home of the mode that made it. `--resume-last`
  only picks a task with the same `write` value as the new run. If there is none, the error says to
  use `--fresh`. `task-resume-candidate` runs before the mode is known, so it reports the
  candidate's `write` value and does not filter.
- **Type check**: upstream type-checks its protocol client with generated types. Copilot has no
  generator. The port hand-writes the few event types in `scripts/lib/prompt-mode-protocol.d.ts` and
  keeps the `tsc` check with `typescript` and `@types/node` as devDependencies.

- **Process groups**: upstream `terminateProcessTree` signals the process group (`-pid`) on macOS
  and Linux, and `taskkill /T` on Windows. `kill(-pid)` signals every process in the group whose ID
  is `pid`, and that group exists only if the process with that `pid` leads it. In Node on macOS and
  Linux, `detached: true` makes the child the leader of a new process group and session, so its
  `pid` is the group ID. So on macOS and Linux every process the plugin may have to stop starts with
  `detached: true`: the background worker (as upstream), each Copilot child of `prompt-mode.mjs`,
  and the companion that the review gate starts. Each companion also handles `SIGTERM` and
  `SIGINT`: it kills its Copilot child's group, then exits. A cancel or gate timeout that stops a
  companion therefore stops its Copilot process and Copilot's own children too. Windows keeps
  `taskkill /T`, which follows the whole tree.
- **Limit of stopping a job** (decided 2026-10-08, after Copilot PR review): cancel, the gate and
  `SessionEnd` stop the companion, the Copilot process and every process in their process groups
  (the tree with `taskkill /T` on Windows). On macOS and Linux, a program that a `--write` task
  deliberately detaches (for example with `setsid` or a detached Node child) leaves those groups and
  is not stopped. On Windows, `taskkill /T` follows the parent chain, so a detached child is stopped
  while its parent still runs; a child whose parent has already exited is not. The
  README says so, next to the best-effort sandbox. Rejected alternative: tracking every descendant
  by polling the process table, which is different on each system and races with short-lived
  processes.
- **Stopping a job**: `terminateProcessTree` changes in two ways (correctness, spec SC-007).
  - If the group signal finds no group (`ESRCH`), it signals the process itself. A companion that
    Claude's Bash tool started (a foreground or Bash-background review) is not a group leader, and
    upstream returns without signalling it.
  - It waits up to 5 seconds (an option, so tests can use less). If the process or its group is
    still alive, it sends `SIGKILL` to it. Windows already uses `taskkill /T /F`.
  - A pid that is not a positive integer is never signalled: `kill(0)` would signal the caller's own
    group (added 2026-10-08, PR review; upstream accepts any finite number).
  - The wait does not block the event loop, so `terminateProcessTree` returns a promise (decided
    2026-10-08, ticket 3 code review). Reason: correctness. Node reaps the caller's own exited child
    only from the event loop; until then it still answers a signal check, so a blocking wait always
    ran the full 5 seconds and then sent `SIGKILL`. A caller that stops several processes (such as
    `SessionEnd`) can also wait for all of them at once. Rejected alternative: a blocking wait, as
    upstream's synchronous function would need.
  - The job record also keeps `copilotPid`, the Copilot child's process id, set when the run starts.
    Cancel stops the job's `pid` and then the `copilotPid` group, so a Copilot run whose companion
    was killed with `SIGKILL` is still stopped.
  - Cancel first re-reads the job, marks it `cancelled` and reads its current `pid` and
    `copilotPid` in one `updateState`, and only then sends signals, as `SessionEnd` does (decided
    2026-10-08, after Copilot PR review). The worker claim and the Copilot start use the same lock,
    so a job either was claimed and started before this step (its PIDs are read) or finds itself
    cancelled and never starts. Upstream signals first and saves `cancelled` after (rejected: a job
    that starts between the two steps escapes the kill).
  - The rule for every stopper (cancel, `SessionEnd`, the review gate): stop the companion, then
    stop the `copilotPid` of its job record itself. Never rely only on the companion's `SIGTERM`
    handler, because the companion can be killed before the handler finishes. The gate finds the
    record by the companion's `pid`.
- **Gate context folder**: the gate hook writes the patch folder (§2) and passes it to the companion
  with the internal `task` option `--context-dir <path>`. The adapter turns it into `--add-dir`. The
  hook removes the folder in a `finally` step, after success, failure or a timeout kill.
- **Background start order** (decided 2026-10-08, after Copilot PR review): `enqueueBackgroundTask`
  writes the `queued` job record, with its stored request, before it starts the worker. Then it
  stores the worker's `pid` through `updateState`, only if the job is still `queued`, so it never
  overwrites a worker that has already moved the job on. Reason: correctness. Upstream starts the
  worker first; a worker that reads the job record before it exists exits at once, and the job stays
  `queued` forever. Rejected alternative: upstream's order, kept for parity.
  If the worker cannot be started (`spawn` reports an error, or gives no `pid`), the companion marks
  the job `failed` through `updateState` with the error, so it never stays `queued`.
  The worker claims the job inside `updateState`: only if the job is still `queued` does it set
  `running` and its own `pid`. Otherwise (cancelled or missing) it exits without running anything.
  Cancel also changes the job inside `updateState`, so a cancel and a claim never both win. Reason:
  without the claim, a job cancelled before its worker starts would still run, even with `--write`.
  `runTrackedJob` follows the same rule (decided 2026-10-08, after Copilot PR review). Its start
  write goes through `updateState`: it creates a new foreground job, or keeps a job that this
  process claimed, but it never sets `running` on a job that is `cancelled` or gone; then it exits
  without running. Its final write (`completed` or `failed`) also happens only if the job is still
  `running`, so a finished run never overwrites a cancel. Upstream writes `running` and the final
  status unconditionally (rejected: it can revive a job that `SessionEnd` or cancel stopped).
  The progress writes of `createJobProgressUpdater` (phase, session id, turn id) follow the same
  rule: they change only a job that is still `running` (added 2026-10-08, ticket 3). Reason:
  correctness. Upstream writes them with `upsertJob`, which creates the job again if `SessionEnd`
  has removed it. Rejected alternative: upstream's `upsertJob`. A progress write that cannot take the
  state lock is skipped and does not fail the run; the job log still gets the line. The final status
  write runs outside the runner's error handling, so a failed write never turns a finished run into a
  failed one (both added 2026-10-08, ticket 3 code review). If that write fails, the error goes to
  the job log and `runTrackedJob` still returns the run's result (added 2026-10-08, PR review).
  Likewise, if the runner fails and its `failed` status cannot be saved, the caller still gets the
  runner's own error (added 2026-10-08, PR review). A progress value counts as written only
  after its write succeeds, so the next event retries it (added 2026-10-08, PR review).
- **Hook time budgets**: Claude Code stops a hook at its `hooks.json` timeout (`Stop` 900 s,
  `SessionEnd` 5 s, as upstream), and then no cleanup runs. So each hook does its work inside a
  smaller budget.
  - `Stop`: the gate's run limit is 840 s (upstream: 900 s). The other 60 s cover collecting the
    context, the kill wait, removing the patch folder and printing the decision.
  - `SessionEnd`: first, inside one `updateState`, it adds the session id to `closedSessions`,
    marks all the session's queued and running jobs `cancelled`, and reads the `pid` and
    `copilotPid` of the running ones. Creating a job, claiming one and starting Copilot all happen
    inside `updateState` and are refused when the companion process started before the session's
    `closedAt`, so a job that a companion was still preparing can never start after the snapshot.
    A resumed conversation keeps its session id (`claude --resume`), but its new companions start
    after `closedAt` and are allowed. Entries stay for 30 days, with no count cap, so newer sessions
    cannot push an entry out early. Not covered: a companion paused for longer than 30 days. The worker claim and
    the Copilot start use the same lock: a companion starts Copilot only inside `updateState`,
    after it checks that its job is still `running`, and it writes `copilotPid` in that same step
    (Node returns the child's `pid` from `spawn` at once). The check, the spawn and the save run as
    one synchronous block (synchronous file calls, as upstream `state.mjs` uses), so no signal
    handler runs inside it, and the plugin's own `SIGKILL` comes seconds after its `SIGTERM`. If the
    save fails after the spawn, the companion kills the new Copilot process tree before it reports
    the error. So
    every Copilot child either is in the `SessionEnd` snapshot or is never started, and a worker
    either claimed before this step or finds its job cancelled. Not covered: an outside `kill -9`
    that lands inside that block. Rejected alternative: a supervisor process that gates every
    Copilot start, which upstream does not have, for a window of a few milliseconds. Then it sends `SIGTERM` to every recorded `pid` and
    `copilotPid`, waits once, up to 2 s in total, and sends `SIGKILL` to what is still alive. Last, it
    removes, through `updateState`, only the job ids it captured in the first step, so a job that a
    resumed session starts meanwhile keeps its record. Each lock wait is limited to the time left in
    its 5 s budget. It never waits per job.

- **Locked state updates** (decided 2026-10-08, after Copilot PR review): `updateState` holds a lock
  file, `state.json.lock`, for the whole read, change, save and prune. It creates the lock with an
  exclusive create (`wx`) and writes its owner into it: its `pid` and a random token. It retries for
  up to 5 seconds by default; a caller can pass a shorter limit. Then it fails with a clear error and
  changes nothing. It reclaims a lock only when
  the owner's `pid` is no longer running, never because of age alone. Reclaiming is serialized by a
  second lock, `state.json.lock.reclaim`, also created with `wx` and holding a `pid` and token. Only
  its holder reads the main lock, checks that its owner is dead, and deletes it. A new main lock can
  only appear after that delete, so the reclaimer never deletes a live lock. If the reclaim lock's
  own owner is dead, the update fails with a clear error that names the file to delete; that needs
  a process to die inside a few lines of code. A holder removes a lock only if the file still holds
  its own token. It writes `state.json` to a temp file in the same folder and
  renames it over the old file, so a reader never sees half a file. Reason: correctness. Two
  companions that save at the same time can otherwise drop each other's job, and pruning then
  deletes that job's record and log, so cancel and `SessionEnd` lose its `pid` and `copilotPid`.
  Pruning keeps every queued or running job and applies the 50-job cap to finished jobs only,
  because upstream's cap counts running jobs too and can delete a long task's record. Every writer,
  `SessionEnd` included, changes state only through `updateState` on the state it read under the
  lock, never by saving an earlier snapshot. So upstream's `saveState`, which saves a snapshot the
  caller read earlier, is not ported (decided 2026-10-08, ticket 3 code review; rejected alternative:
  a locked `saveState`, which still drops a job added after the caller's read). When the lock file
  has no readable owner (no positive integer pid and token), the timeout error says to delete it if
  no companion is running. When the main lock's owner has ended and an unreadable reclaim lock
  blocks freeing it, the error names the reclaim lock to delete instead (added 2026-10-08, PR
  review). A process
  that creates a lock but cannot write its owner removes that lock again, so it never leaves an
  unreadable one (added 2026-10-08, PR review). A session counts as closed for a companion if any
  `closedSessions` entry with its id is newer than the companion's start, so a resumed session that
  closes again is caught (added 2026-10-08, PR review).
  An update that cannot read or parse an existing `state.json` stops with an error that names the
  file and changes nothing; plain readers still fall back to the empty state, as upstream. Pruned
  jobs' files and logs are deleted only after the new `state.json` is saved, and a failed delete
  does not fail the saved update. A job that the same update adds and prunes loses its files too
  (upstream checks only the jobs read before the change; added 2026-10-08, PR review). Reason: correctness (decided 2026-10-08, ticket 3 Codex review).
  Upstream saves the empty default over a file it could not read, and deletes before it saves
  (rejected: a read error or a failed save loses job records, pids and logs). Job files
  (`jobs/<id>.json`) are also written through a temp file and a rename, and the final status write
  rebuilds a job file it cannot read (decided 2026-10-08, ticket 3 Codex review round 2; rejected:
  upstream's direct overwrite, where a failed progress write leaves a broken file that then stops
  the final write).
  Rejected alternative: keep upstream's unlocked update for parity; upstream has the same race, but
  this port relies on the job records to stop processes.
  Without `CLAUDE_PLUGIN_DATA`, the state lives in `~/.copilot-companion/state`, owned by the user,
  as the plugin's Copilot home does (§3). Decided 2026-10-08, after Copilot PR review. Reason:
  security. Upstream uses `<tmp>/codex-companion`, which another local user can create first and
  fill with job records; cancel and `SessionEnd` would then signal PIDs that user chose. Rejected
  alternative: upstream's shared temp folder.

## 8. Effect on the ticket split

The 8 tickets stay as planned.

- Ticket 4 holds the prompt-mode helper (the transport helper), the launcher helper and a fake CLI
  that prints JSON events. Ticket 2 adds only the fake's `--version` and `--help` answers.
- Upstream's broker files (`app-server-broker.mjs`, `broker-endpoint.mjs`, `broker-lifecycle.mjs`)
  are not ported. Each one gets a line in "Differences from the Codex plugin".
