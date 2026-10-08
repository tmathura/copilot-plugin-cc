# Copilot plugin for Claude Code

Use the GitHub Copilot CLI from Claude Code to review code or to hand off coding tasks.

This plugin is a port of OpenAI's [codex-plugin-cc](https://github.com/openai/codex-plugin-cc). It
keeps the same commands and layout, and calls the Copilot CLI instead of Codex.

## Status

Work in progress. The marketplace and an empty `copilot` plugin exist. The plugin has no commands
yet. The commands below describe what the first release will do.

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
- The GitHub Copilot CLI (`npm install -g @github/copilot`), logged in with `copilot` and then
  `/login`.

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
- On Windows, the plugin starts Copilot without a shell. A shell could run text from the repo as a
  command, so this is a security change. The tests start their commands without a shell too, so
  paths with spaces work.
- The plugin needs Node.js 22, not 18.18, because the Copilot CLI needs Node 22.
- The plugin runs `copilot` once for each job, with the prompt on stdin and
  `--output-format json`. Codex runs a long-lived app server. Copilot's other interface, ACP, runs
  the repository's own hooks, so it is not safe for reviews.
- There is no shared broker process (upstream `app-server-broker.mjs`, `broker-endpoint.mjs` and
  `broker-lifecycle.mjs`). Each `copilot` run stands alone, so there is nothing to share.
- CI runs the tests on Ubuntu, macOS and Windows, not only Ubuntu, because the plugin must work the
  same on all three. CI does not install a real CLI. The tests use a fake `copilot`. The checkout
  does not keep the GitHub token, so code under test cannot read it.

## Development

See [docs/development.md](docs/development.md) for the workflow and
[docs/conventions.md](docs/conventions.md) for the rules. The project rules are in the
[constitution](.specify/memory/constitution.md).

## License

Apache-2.0. The plugin is based on codex-plugin-cc by OpenAI, also Apache-2.0. See
[LICENSE](LICENSE) and [NOTICE](NOTICE). [UPSTREAM.md](UPSTREAM.md) records the upstream commit that
was last checked.
