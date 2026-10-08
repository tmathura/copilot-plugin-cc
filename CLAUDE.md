# copilot-plugin-cc

A Claude Code plugin that hands code reviews and coding tasks to the GitHub Copilot CLI. It is a port
of OpenAI's codex-plugin-cc and stays close to it.

This file only gives directions. The rules live in the files below.

## Read first

- [Constitution](.specify/memory/constitution.md): the project rules. It wins over every other doc.
- [docs/conventions.md](docs/conventions.md): how to write code, tests, docs and commands.
- [docs/development.md](docs/development.md): the ticket workflow, Spec Kit, upstream sync and
  release. While a feature is being built, keep its spec folder in step with the code, as
  "Keeping the spec current" there says.

## Layout

```
.claude-plugin/marketplace.json   marketplace entry
plugins/copilot/                  the plugin; scripts/lib has the shared modules; commands, agents,
                                  hooks, skills and the companion are planned
scripts/bump-version.mjs          sets and checks the version in every manifest
tests/                            node --test suites, helpers and the fake copilot CLI
UPSTREAM.md                       last upstream commit checked, and the status of later changes
docs/                             conventions and development workflow
specs/001-copilot-plugin-port/    the port spec: transport decision, call-site map, plan, tasks
.specify/                         Spec Kit: constitution, templates, scripts
.claude/skills/speckit-*          Spec Kit skills (managed, do not edit)
```

## Commands

| Purpose | Command |
| --- | --- |
| Test | `npm test` |
| Check versions | `npm run check-version` |
| Validate plugin | `claude plugin validate .` |
