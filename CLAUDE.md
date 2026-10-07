# copilot-plugin-cc

A Claude Code plugin that hands code reviews and coding tasks to the GitHub Copilot CLI. It is a port
of OpenAI's codex-plugin-cc and stays close to it.

This file only gives directions. The rules live in the files below.

## Read first

- [Constitution](.specify/memory/constitution.md): the project rules. It wins over every other doc.
- [docs/conventions.md](docs/conventions.md): how to write code, tests, docs and commands.
- [docs/development.md](docs/development.md): the ticket workflow, Spec Kit, upstream sync and
  release.

## Layout

```
.claude-plugin/marketplace.json   (planned) marketplace entry
plugins/copilot/                  (planned) the plugin: commands, agents, hooks, skills, scripts
tests/                            (planned) node --test suites
docs/                             conventions and development workflow
.specify/                         Spec Kit: constitution, templates, scripts
.claude/skills/speckit-*          Spec Kit skills (managed, do not edit)
```

## Commands

None yet. The port adds `npm test`.
