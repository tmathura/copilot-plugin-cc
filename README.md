# Copilot plugin for Claude Code

Use the GitHub Copilot CLI from Claude Code to review code or to hand off coding tasks.

This plugin is a port of OpenAI's [codex-plugin-cc](https://github.com/openai/codex-plugin-cc). It
keeps the same commands and layout, and calls the Copilot CLI instead of Codex.

## Status

Work in progress. The plugin has every command below and the `copilot-rescue` subagent. The review
gate comes next. [docs/operations.md](docs/operations.md) says how to look after jobs.

## What you get

- `/copilot:review` reviews your changes. It does not change files.
- `/copilot:adversarial-review` reviews your changes with a focus that you give, and looks hard for
  problems.
- `/copilot:rescue` hands a task to Copilot. It can run in the background (`--background`) and use a
  model that you pick (`--model`). As in the Codex plugin, Copilot may change files unless you ask for
  read-only work.
- `/copilot:status`, `/copilot:result` and `/copilot:cancel` show, collect and stop background jobs.
- `/copilot:setup` checks that the Copilot CLI is installed and logged in. It also turns the review
  gate on or off.
- The `copilot-rescue` subagent lets Claude hand work to Copilot by itself.
- The optional review gate runs a Copilot review before Claude stops.

## Requirements

- Claude Code.
- Node.js 22 or later. The Copilot CLI needs it.
- The GitHub Copilot CLI 1.0.93 or later (`npm install -g @github/copilot`), logged in with
  `copilot login`, the GitHub CLI or a token variable. See
  [docs/configuration.md](docs/configuration.md).

## Install

```bash
claude plugin marketplace add tmathura/copilot-plugin-cc
claude plugin install copilot@tmathura-copilot
```

## Differences from the Codex plugin

- There is no `/copilot:transfer`. Copilot cannot import a Claude Code session.
- Reviews are read-only because the Copilot CLI's own controls block writes. Codex uses its
  read-only sandbox mode. The transport spec chooses which Copilot controls to use: tool permissions,
  the Copilot sandbox, or both.
- The plugin needs Node.js 22, not 18.18, because the Copilot CLI needs Node 22.
- The plugin runs `copilot` once for each job, with the prompt on stdin and
  `--output-format json`. Codex runs a long-lived app server. Copilot's other interface, ACP, runs
  the repository's own hooks, so it is not safe for reviews.
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
- Setup checks the login with one small read-only prompt, which uses one premium request. Copilot
  has no other way to report a login. Codex reads the account from its app server.
- Reviews and read-only tasks run with the plugin's own Copilot folder (`COPILOT_HOME`) and only
  Copilot's read tools. So the repo's hooks and MCP servers, and your own saved approvals, do not
  apply. The plugin also removes `COPILOT_ALLOW_ALL` from Copilot's environment. A read-only run
  that starts any other tool is stopped.
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
  `workspace-write`. Where your system cannot run the sandbox, Copilot runs shell commands with your
  full rights, and the plugin cannot detect this.
- Cancel cannot ask a running Copilot to stop its turn, because Copilot has no interrupt that another
  process can send. Cancel stops the process tree instead. `turnInterruptAttempted` is always
  `false`.
- Cancel first marks the job cancelled, then stops its processes. It stops the companion and then
  the Copilot process itself, so a Copilot process whose companion was killed is still stopped.
  Codex stops the process first and marks the job after, so a job that starts between the two steps
  can keep running. If a process cannot be stopped, by cancel or at the end of a run, the job keeps
  its process ids, and you can run `/copilot:cancel <job id>` again.
- A background task's record is written before its worker starts. Codex starts the worker first, and
  a worker that finds no record leaves the job queued forever. If the worker cannot start, or stops
  with an error before its run ends, the job is marked failed.
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

## Development

See [docs/development.md](docs/development.md) for the workflow and
[docs/conventions.md](docs/conventions.md) for the rules. The project rules are in the
[constitution](.specify/memory/constitution.md).

## License

Apache-2.0. The plugin is based on codex-plugin-cc by OpenAI, also Apache-2.0. See
[LICENSE](LICENSE) and [NOTICE](NOTICE). [UPSTREAM.md](UPSTREAM.md) records the upstream commit that
was last checked.
