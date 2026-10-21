# copilot-plugin-cc

A Claude Code plugin that uses the GitHub Copilot CLI to review code or to hand off coding tasks. It is
a port of OpenAI's codex-plugin-cc and stays close to it.

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
plugins/copilot/                  the plugin; scripts/copilot-companion.mjs is the companion,
                                  scripts/lib has the shared modules and the Copilot adapter; also
                                  commands, agents, skills, hooks, prompts and schemas
scripts/bump-version.mjs          sets and checks the version in every manifest
tests/                            node --test suites, helpers and the fake copilot CLI
UPSTREAM.md                       last upstream commit checked, and the status of later changes
docs/                             architecture, configuration, operations, conventions, workflow
specs/005-copilot-plugin-port/    the port spec: transport decision, call-site map, plan, tasks
.specify/                         Spec Kit: constitution, templates, scripts, the bug extension, bug notes
.claude/skills/speckit-*          Spec Kit skills (managed, do not edit)
.claude/skills/workflow-*         the ticket workflow skills (written for this repo, edit as normal)
.claude/skills/spec-review-page   builds review.html, a one-page reading aid, in a spec or bug folder
```

## Commands

| Purpose | Command |
| --- | --- |
| Test | `npm test` |
| Type check | `npm run build` |
| Check versions | `npm run check-version` |
| Validate plugin | `claude plugin validate .` |
