# Copilot plugin for Claude Code

Use the GitHub Copilot CLI from Claude Code to review code or to hand off coding tasks.

This plugin is a port of OpenAI's [codex-plugin-cc](https://github.com/openai/codex-plugin-cc). It
keeps the same commands and layout, and calls the Copilot CLI instead of Codex.

## What you get

- `/copilot:review` for a normal read-only Copilot review.
- `/copilot:adversarial-review` for a review that you can steer, and that questions the design.
- `/copilot:rescue`, `/copilot:status`, `/copilot:result` and `/copilot:cancel` to hand work to
  Copilot and to look after background jobs.
- `/copilot:setup` to check the Copilot CLI and to turn the optional review gate on or off.
- The `copilot:copilot-rescue` subagent, so Claude can hand work to Copilot by itself.

## Requirements

- Claude Code.
- A GitHub Copilot plan that includes the Copilot CLI. Each run uses premium requests from your
  plan.
- Node.js 22 or later. The Copilot CLI needs it.
- The GitHub Copilot CLI 1.0.93 or later, logged in. See
  [docs/configuration.md](docs/configuration.md).

## Install

Add the marketplace and install the plugin:

```bash
claude plugin marketplace add tmathura/copilot-plugin-cc
claude plugin install copilot@tmathura-copilot
```

Inside Claude Code you can use `/plugin marketplace add tmathura/copilot-plugin-cc` and
`/plugin install copilot@tmathura-copilot` instead, then `/reload-plugins`.

Then run:

```bash
/copilot:setup
```

`/copilot:setup` tells you whether Copilot is ready. If Copilot is missing and npm is available, it
offers to install it. To install it yourself:

```bash
npm install -g @github/copilot
```

If Copilot is installed but not logged in, run:

```bash
!copilot login
```

After install, you see the commands below, and the `copilot:copilot-rescue` subagent in `/agents`.

A simple first run:

```bash
/copilot:review --background
/copilot:status
/copilot:result
```

## Usage

### `/copilot:review`

Runs a normal Copilot review of your current work. It reviews your uncommitted changes, or your
branch against a base branch such as `main`.

| Flag | What it does |
| --- | --- |
| `--base <ref>` | Review the branch against `<ref>`. |
| `--scope auto\|working-tree\|branch` | Choose the target. `auto` (the default) reviews the working tree when it has changes, and the branch otherwise. |
| `--wait` | Run in the foreground. |
| `--background` | Run as a Claude background task. Without `--wait` or `--background`, Claude estimates the size and asks. |

It takes no focus text. Use `/copilot:adversarial-review` to steer the review.

```bash
/copilot:review
/copilot:review --base main
/copilot:review --background
```

The review is read-only. It does not change files. A review of many files can take a while, so run
it in the background and check it with `/copilot:status`.

### `/copilot:adversarial-review`

Runs a review that questions the chosen approach: its assumptions, trade-offs and failure modes, and
whether a different approach would be safer or simpler. It takes the same flags as
`/copilot:review`, and focus text after the flags.

```bash
/copilot:adversarial-review
/copilot:adversarial-review --base main challenge whether this was the right caching and retry design
/copilot:adversarial-review --background look for race conditions and question the chosen approach
```

The answer has a verdict, findings with file and lines, and next steps. The review is read-only. It
does not fix code.

### `/copilot:rescue`

Hands a task to Copilot through the `copilot:copilot-rescue` subagent. Use it to investigate a bug,
try a fix, continue an earlier Copilot task, or take a pass with a different model.

| Flag | What it does |
| --- | --- |
| `--background` | Run the subagent in the background. |
| `--wait` | Run the subagent in the foreground (the default). |
| `--resume` | Continue the latest Copilot task of the same mode from this Claude session. |
| `--fresh` | Start a new task. Without `--resume` or `--fresh`, the command offers to continue the latest task. |
| `--model <model>` | A model name that your Copilot CLI accepts. Without it, Copilot uses its default. |
| `--effort <level>` | Reasoning effort: `none`, `minimal`, `low`, `medium`, `high` or `xhigh`. |

```bash
/copilot:rescue investigate why the tests started failing
/copilot:rescue fix the failing test with the smallest safe patch
/copilot:rescue --resume apply the top fix from the last run
/copilot:rescue --effort medium investigate the flaky integration test
/copilot:rescue --background investigate the regression
```

You can also ask Claude in your own words, for example "Ask Copilot to make the database connection
more resilient."

As in the Codex plugin, the subagent lets Copilot change files (`--write`) unless you ask only for a
review, a diagnosis or research. What a write task may do is in
[docs/configuration.md](docs/configuration.md#permission-profiles).

### `/copilot:status`

Shows the running and recent Copilot jobs of this Claude session.

```bash
/copilot:status
/copilot:status task-abc123
```

`--all` lists every job of the session, not only the newest ones. With a job id, `--wait` waits for the job to finish, up to
`--timeout-ms <ms>` (4 minutes by default).

### `/copilot:result`

Shows the stored output of a finished job. For a `--write` task, it also shows a
`copilot --resume=<session id>` command, so you can continue the session in the Copilot CLI.

```bash
/copilot:result
/copilot:result task-abc123
```

### `/copilot:cancel`

Stops an active background job.

```bash
/copilot:cancel
/copilot:cancel task-abc123
```

### `/copilot:setup`

Checks that the Copilot CLI is installed, is a supported version and is logged in. The login check
sends one small prompt, so it uses one premium request.

It also turns the optional review gate on or off:

```bash
/copilot:setup --enable-review-gate
/copilot:setup --disable-review-gate
```

When the review gate is on, a `Stop` hook runs a read-only Copilot review of Claude's last turn. If
the review finds a problem, the stop is blocked so that Claude can fix it first.

> [!WARNING]
> The review gate can start a long loop between Claude and Copilot, and can use up premium requests
> quickly. Turn it on only when you watch the session.

## Typical flows

Review before you ship:

```bash
/copilot:review
```

Hand a problem to Copilot:

```bash
/copilot:rescue investigate why the build is failing in CI
```

Start something long:

```bash
/copilot:adversarial-review --background
/copilot:rescue --background investigate the flaky test
```

Then check in with:

```bash
/copilot:status
/copilot:result
```

## How it uses Copilot

The plugin starts `copilot --output-format json` once for each run, with the prompt on stdin and
never through a shell. It uses the `copilot` that is installed on your machine.

- Reviews, the review gate and read-only tasks run with only Copilot's read tools, in the plugin's
  own Copilot folder. Your own Copilot settings, hooks and MCP servers do not apply to them.
- `--write` tasks run in your own Copilot folder, with Copilot's sandbox. Your Copilot settings
  apply to them.

[docs/configuration.md](docs/configuration.md) gives the exact flags, the folders and the login
options. [docs/operations.md](docs/operations.md) says how to look after jobs.
[docs/architecture.md](docs/architecture.md) describes the code.

## FAQ

### Do I need a separate Copilot account?

No. The plugin uses the login of your Copilot CLI: `copilot login`, the GitHub CLI login or a token
variable. Run `/copilot:setup` to check it.

### Can I continue a task in the Copilot CLI?

Yes, for a `--write` task. Run the `copilot --resume=<session id>` command that `/copilot:result`
shows. Read-only jobs show only their session id. See
[docs/operations.md](docs/operations.md#resume-a-task).

### Can I use my own model provider?

Yes. Set `COPILOT_PROVIDER_BASE_URL` and the other `COPILOT_PROVIDER_*` variables in the
environment that starts Claude Code. See [docs/configuration.md](docs/configuration.md).

## Differences from the Codex plugin

- There is no `/copilot:transfer`. Copilot cannot import a Claude Code session.
- Reviews are read-only because the Copilot CLI's own controls block writes: only Copilot's read
  tools are available, and the plugin's own Copilot folder is used. Codex uses its read-only sandbox
  mode.
- The plugin needs Node.js 22, not 18.18, because the Copilot CLI needs Node 22.
- The plugin runs `copilot` once for each job, with the prompt on stdin and
  `--output-format json`. Codex runs a long-lived app server. Copilot's other interface, ACP, runs
  the repository's own hooks, so it is not safe for reviews.
- Copilot publishes no schema for its JSON output, so the types in
  `scripts/lib/prompt-mode-protocol.d.ts` are written by hand. Codex generates its types with
  `codex app-server generate-ts`, so `npm run build` has no `prebuild` step here.
- Copilot cannot start its own subagents in a run, because its `task` tool is not in any permission
  profile. Codex can, and the plugin reports their progress.
- There is no shared broker process (upstream `app-server-broker.mjs`, `broker-endpoint.mjs` and
  `broker-lifecycle.mjs`). Each `copilot` run stands alone, so there is nothing to share.
- CI runs the tests on Ubuntu, macOS and Windows, not only Ubuntu, because the plugin must work the
  same on all three. CI does not install a real CLI. The tests use a fake `copilot`. The checkout
  does not keep the GitHub token, so code under test cannot read it.
- The plugin never starts a command through a shell, on any system. On Windows it starts `npm` and
  `copilot` from their npm `.cmd` files by running the script inside with `node`. Codex uses a
  shell on Windows, which could run text from the repo as a command. The tests start their commands
  without a shell too, so paths with spaces work.
- Before a review, the plugin runs `git` so that it does not write `.git/index` and does not start
  a `core.fsmonitor` hook or a `textconv` program from the repo's git config. A review must leave
  the repo as it was, and nothing controls these programs once git starts them. Clean filters, such
  as Git LFS, still run, as in any `git diff`. So does a `textconv` program that your own git config
  sets for a changed submodule, because git starts the submodule's diff itself. The review commands
  tell Claude to use the same git options when it estimates the size of a review.
- A review does not list a file whose only change is a new timestamp. The plugin does not let `git`
  refresh the index, so it compares the content instead.
- A review does not read the target of an untracked symlink. The link can point outside the repo,
  for example at a key file. Codex puts the target's text in the prompt.
- A review reads an untracked file whose name has non-ASCII letters. Codex skips it, because git
  quotes the name.
- For a large diff, Codex runs read-only `git` commands itself. Copilot's reviews have no shell, so
  the plugin writes the exact patches to a folder in its own job storage, lets Copilot read that
  folder (`--add-dir`), and deletes the folder after the review. If the review is killed outright
  (`SIGKILL`, or `taskkill /F` on Windows), the folder stays until its job record is removed.
- `/copilot:review` sends Copilot's `/review` command with the diff in the prompt. Codex uses its
  built-in reviewer, which collects the diff itself. Copilot's `/review` collects the diff with
  `git` in a shell, and reviews have no shell.
- Copilot has no setting for an output schema. So `/copilot:adversarial-review` puts the schema in
  the prompt, also accepts the JSON inside one code fence, and checks the answer against the schema.
  An answer that does not match fails the job and keeps Copilot's text. Codex makes its answer match
  the schema itself.
- Copilot keeps every review session. Codex can run a review in a thread that it does not keep. The
  sessions stay in the plugin's own Copilot folder, so they are not in your own session list.
- Job state lives in `~/.copilot-companion/state` when Claude Code does not give a plugin data
  folder. Codex uses the shared temp folder, where another user on the same computer could create
  the folder first and plant job records.
- Two companion processes can save job state at the same time without losing a job. Each save
  holds a lock file, and pruning never removes a queued or running job. Codex can lose a job in that
  case, and cancel then cannot find the process to stop.
- Cancel waits up to 5 seconds and then force-stops a process that ignores the stop signal. It also
  stops a process that Claude's Bash tool started, which leads no process group. On macOS it
  accepts the error that macOS gives for a process group whose members have exited.
- A job that was cancelled, or a job whose Claude session has ended, never starts and is never
  marked as running again.
- Job reports show a `copilot --resume=<id>` command only for `--write` tasks. Read-only jobs run
  in the plugin's own Copilot home, so the report shows only their session id.
- Setup needs Copilot CLI 1.0.93 or later and refuses older versions. Copilot publishes no schema for
  its JSON output, so the plugin supports only the versions it was tested on.
- Setup reads your own model provider (BYOK) from the `COPILOT_PROVIDER_*` variables. Codex reads
  its provider from its config file.
- When Copilot is not logged in, setup also suggests `!copilot login --device-code` for a blocked
  browser flow, and `COPILOT_GITHUB_TOKEN` for a system without a credential store.
- Setup checks the login with one small read-only prompt, which uses one premium request. Copilot
  has no other way to report a login. Codex reads the account from its app server.
- Reviews and read-only tasks run with the plugin's own Copilot folder (`COPILOT_HOME`) and only
  Copilot's read tools. So the repo's hooks and MCP servers, and your own saved approvals, do not
  apply. The plugin also removes `COPILOT_ALLOW_ALL` from Copilot's environment. A read-only run
  that starts any other tool is stopped.
- A helper command, such as `git`, that is stopped by a signal counts as failed. Codex counts it as
  a success (exit code 0).
- When the companion is stopped with `SIGTERM` or `SIGINT`, it first stops its Copilot process and
  that process's children.
- `/copilot:rescue` has no `spark` model name. Copilot has no such model.
- `/copilot:rescue --resume` continues only a task of the same mode: a read-only task continues a
  read-only task, and a `--write` task a `--write` task. Each mode keeps its sessions in a different
  Copilot folder. If there is no such task, the error says to use `--fresh`. The rescue command tells
  the subagent the mode of the task it continues, so the subagent adds `--write` only for a
  `--write` task.
- `/copilot:rescue --resume` finds the last task in the plugin's own job records. Codex asks its app
  server for its list of threads. Copilot has no such list.
- A `--write` task runs shell commands in Copilot's sandbox (`--sandbox`). The sandbox lets commands
  write in the working folder, the temp folder and your user folder, so it is wider than Codex's
  `workspace-write`. Where your system cannot run the sandbox, Copilot either refuses shell commands
  (Copilot 1.0.94 on Windows 11 23H2: "Windows sandboxing requires BaseContainer") or, as its docs
  say, runs them with your full rights. The plugin cannot detect which.
- Cancel cannot ask a running Copilot to stop its turn, because Copilot has no interrupt that another
  process can send. Cancel stops the process tree instead. `turnInterruptAttempted` is always
  `false`.
- Cancel first marks the job cancelled, then stops its processes. It stops the companion and the
  Copilot process itself at the same time, so a Copilot process whose companion was killed is still
  stopped, and a process that ignores the stop signal costs one 5-second wait, not two.
  Codex stops the process first and marks the job after, so a job that starts between the two steps
  can keep running. If a process cannot be stopped, by cancel or at the end of a run, the job keeps
  its process ids, and you can run `/copilot:cancel <job id>` again.
- A background task's record is written before its worker starts. Codex starts the worker first, and
  a worker that finds no record leaves the job queued forever. If the worker cannot start, or stops
  with an error before its run ends, the job is marked failed.
- A task that fails after Copilot has answered, for example when a read-only task starts a write
  tool, shows the answer and then why the run failed, also in `/copilot:result`. Codex shows only
  the answer, which reads like a success.
- `/copilot:cancel <job id>` with the full id of a finished job says that the job has finished. Codex
  can pick a different, running job whose id starts with the same text.
- The rescue skill rule that defaults to `--write` repeats the exceptions for review, diagnosis and
  research without edits, and the prompt recipes run diagnosis without edits read-only. The Codex
  skill lists the exceptions in one rule but not in the other, and its recipes run diagnosis in
  write mode.
- The plugin replaces the job state and job files through a temp file and a rename, so a reader
  never sees half a file. Codex writes over the file. On Windows a rename fails while another
  process reads the file, and a reader can miss the file during a rename, so the plugin retries both
  for up to 2 seconds.
- The review gate puts the working-tree diff in its prompt, because Copilot's reviews have no shell
  to run `git`. Above the inline limit it writes the exact patches to a folder in the plugin's job
  storage, lets Copilot read that folder, and deletes it when the hook ends. Codex runs `git` itself.
- The review gate sends its prompt to the companion on stdin. Claude's last message can be longer
  than the Windows command-line limit. Codex passes the prompt as an argument.
- The review gate stops its review 14 minutes after the hook starts, not 15, so that the hook can
  still clean up and answer inside Claude Code's 15-minute hook timeout. On that limit, or when the
  hook itself is stopped, it stops the companion, the Copilot process and their children, and marks
  the job cancelled. Codex stops only the companion and leaves the job marked as running.
- When the review gate is on and its review cannot run, for example because `git` fails, the gate
  blocks the stop and says why. Codex's hook fails with an error that Claude Code does not treat as
  a block, so the stop goes through unreviewed. A missing Copilot still gives only a note, as in
  Codex.
- When `git` fails, the plugin uses the nearest folder above that holds `.git` as the workspace,
  not the current folder. So the hooks still find the plugin's state for that repository when
  Claude works in a subfolder. Codex uses the current folder.
- `/copilot:rescue --resume` never continues the review gate's session. In Codex it can.
- If a review gate hook is killed outright, a later gate deletes the patch folder that it left.
- When a Claude session ends, the plugin first marks the session closed and its active jobs
  cancelled, in one step. A companion that started before the session ended cannot start a job for
  it, and neither can a companion that a review gate hook from before that time starts later. Then the plugin stops the jobs' processes, with one shared wait of up to 2 seconds, and
  removes the session's finished jobs and the jobs it stopped. A job that another session, or the
  same session after `claude --resume`, starts in the meantime stays. A job whose processes could
  not be stopped keeps its record, so `/copilot:cancel` can try again. All of this ends inside the
  hook's 5-second timeout. Codex removes the session's jobs from an earlier copy of the state, which
  can drop a job that was added in the meantime.
- The companion and the hooks read stdin in a way that waits when the pipe has no data yet. Codex
  reads it in one call, which can fail on a non-blocking pipe, for example on macOS, when the input
  is large.
- When the review gate cannot read the plugin's job state, it says so and lets Claude stop. Codex
  treats an unreadable state as "gate off" and says nothing.
- The session start hook does not export a transcript path, because there is no `/copilot:transfer`.
- The session start hook exports the plugin data folder as `COPILOT_COMPANION_PLUGIN_DATA`, not
  `CLAUDE_PLUGIN_DATA`. The Codex plugin exports `CLAUDE_PLUGIN_DATA` to the same shell, and the
  last export wins. With both plugins installed, one plugin's commands would otherwise use the other
  plugin's jobs and review gate setting.

## Development

See [docs/development.md](docs/development.md) for the workflow,
[docs/conventions.md](docs/conventions.md) for the rules and
[docs/architecture.md](docs/architecture.md) for the code. The project rules are in the
[constitution](.specify/memory/constitution.md).

## License

Apache-2.0. The plugin is based on codex-plugin-cc by OpenAI, also Apache-2.0. See
[LICENSE](LICENSE) and [NOTICE](NOTICE). [UPSTREAM.md](UPSTREAM.md) records the upstream commit that
was last checked.
