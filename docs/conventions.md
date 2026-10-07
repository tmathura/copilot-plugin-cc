# Conventions

How to write code, tests, docs and commands in this repo. The
[constitution](../.specify/memory/constitution.md) wins if this file disagrees with it.

## Code

Match the style of the upstream file you port. Upstream codex-plugin-cc has no style guide. Its code
shows these rules:

- ESM `.mjs` files. Imports use the `node:` prefix: built-ins first, then a blank line, then local
  files (`scripts/lib/git.mjs`).
- Double quotes, semicolons, 2-space indent, LF line endings.
- Small functions with named exports. Helpers stay private to their module.
- Collaborators come in through an `options` argument, so that tests can replace them, as
  `runCommandImpl` and `killImpl` do in `scripts/lib/process.mjs`.
- Functions return a result object (`{ status, stdout, stderr, error }`). A `*Checked` version throws
  instead (`runCommandChecked` in `scripts/lib/process.mjs`).
- Error text says what failed, like `formatCommandFailure` in `scripts/lib/process.mjs`. Where the
  plugin knows the fix, the error also says what to do next.

Where this repo is different from upstream:

- Start child processes with an argument array and no shell. Upstream `scripts/lib/process.mjs` uses a
  shell on Windows. This repo does not (constitution, Principle IV).
- No runtime dependencies.
- Rename `codex` to `copilot` in names.

### Comments

Write a comment only to say why the code is the way it is, when the code cannot show it. Do not
describe what the code does. Do not put ticket or spec ids in comments; they belong in commits and
PRs. The exception is the notice that a file was changed from upstream, which the license requires.

Before:

```js
// Call git without a shell (#12, see spec 003) - loops over args and passes them to spawnSync
```

After:

```js
// Repository-derived arguments must never pass through a shell.
```

## Tests

These rules apply from the port onward. Until then, a docs change gets a review of its diff.

- A behaviour change comes with its tests in the same PR.
- Run tests with `node --test tests/*.test.mjs` and `node:assert/strict`. Node 22 expands the glob
  itself, so this works on Windows too.
- Use a fake `copilot` CLI, like upstream `tests/fake-codex-fixture.mjs`, and helpers like upstream
  `tests/helpers.mjs` for temp folders and git repos.
- Cover the failure paths in the constitution, Principle VI.
- Tests do not use the network or a real login.
- Tests do not wait with a fixed sleep. Poll for the condition, with a time limit.
- Name a test file after the module or the behaviour it covers.

## Docs

- Each fact lives in one file. Other files link to it.
- Change the docs in the same PR as the behaviour.
- Write plainly, in the style of ASD-STE100: short sentences, one idea in each, everyday words. Keep
  code names exactly as they are.
- Draw diagrams as Mermaid blocks.

## Commands

The command files (`plugins/copilot/commands/*.md`) copy upstream `plugins/codex/commands/*.md`. They
are the contract for each command: its arguments, its flags and what it prints. When a command must
be different from upstream, list the difference in the README section "Differences from the Codex
plugin".
