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
.specify/                         Spec Kit: constitution, templates, scripts, the bug extension, bug notes
.specify/specs/                   the spec folders; 005-copilot-plugin-port is the port spec:
                                  transport decision, call-site map, plan, tasks
.claude/settings.json             shared Claude Code settings (see "Shared settings")
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

## Shared settings

`.claude/settings.json` is tracked, so every clone gets it. It holds two settings:

- `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is `400000`. Claude Code then summarizes the conversation at
  about 400k tokens. Claude Code caps the value at the model's own context window.
- A `SessionStart` hook with the matcher `compact` runs after each summary. It prints the rules
  that tell a workflow session which files to read again, and when a check counts as run.

The hook text is inline in the settings file, not in a script. A hook runs in the session's
current folder, so after `EnterWorktree` a relative path can run a PR worktree's copy of a
script. `tests/shared-settings.test.mjs` checks the file.
