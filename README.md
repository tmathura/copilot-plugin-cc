# Copilot plugin for Claude Code

Use the GitHub Copilot CLI from Claude Code to review code or to hand off coding tasks.

This plugin is a port of OpenAI's [codex-plugin-cc](https://github.com/openai/codex-plugin-cc). It
keeps the same commands and layout, and calls the Copilot CLI instead of Codex.

## Status

Planned. The plugin code does not exist yet. The commands below describe what the first release will
do.

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

From the first release:

```bash
claude plugin marketplace add tmathura/copilot-plugin-cc
claude plugin install copilot@tmathura-copilot
```

## Differences from the Codex plugin

- There is no `/copilot:transfer`. Copilot cannot import a Claude Code session.
- Reviews are read-only because the Copilot CLI permission settings block writes. Codex has a
  sandbox for this, and Copilot does not.
- On Windows, the plugin starts Copilot without a shell. A shell could run text from the repo as a
  command, so this is a security change.
- The plugin needs Node.js 22, not 18.18, because the Copilot CLI needs Node 22.

Not decided yet: how the plugin talks to Copilot. The options are ACP and
`copilot -p ... --output-format json`.

## Development

See [docs/development.md](docs/development.md) for the workflow and
[docs/conventions.md](docs/conventions.md) for the rules. The project rules are in the
[constitution](.specify/memory/constitution.md).

## License

Apache-2.0. The plugin is based on codex-plugin-cc by OpenAI, also Apache-2.0. The `LICENSE` and
`NOTICE` files come with the port.
