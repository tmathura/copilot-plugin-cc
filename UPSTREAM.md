# Upstream

This repo ports [codex-plugin-cc](https://github.com/openai/codex-plugin-cc). This file records the
last upstream commit that was checked, the status of each upstream file at that commit, and the
status of each upstream change after it. The steps are in [docs/development.md](docs/development.md),
"Upstream sync".

## Checked commit

`db52e28f4d9ded852ab3942cea316258ae4ef346` (v1.0.6). Upstream `main` was still at this commit on
2026-10-11.

## Files at the checked commit

Each upstream file has one row. The status is one of:

- **ported**: the file is in this repo. Give the file here, if its name changed, and the PR.
- **skipped**: the file does not apply. Give the reason.

The details of each change are in
[specs/005-copilot-plugin-port/call-site-map.md](specs/005-copilot-plugin-port/call-site-map.md).
`P/` is `plugins/copilot/` here, and `plugins/codex/` upstream.

| Upstream file | Status | File here, PR or reason |
| --- | --- | --- |
| `.claude-plugin/marketplace.json` | ported | #14 |
| `.github/workflows/pull-request-ci.yml` | ported | #14 |
| `.gitignore` | skipped | This repo has its own short `.gitignore`. Upstream's only plugin line ignores the generated Codex types, and nothing is generated here. |
| `LICENSE` | ported | #14 |
| `NOTICE` | ported | #14 |
| `README.md` | ported | Written for Copilot. Each ticket added its differences; #12 wrote it in full. |
| `package-lock.json` | ported | #14 |
| `package.json` | ported | #14, `build` in #19 |
| `P/.claude-plugin/plugin.json` | ported | #14 |
| `P/CHANGELOG.md` | ported | #14 |
| `P/LICENSE` | ported | #14 |
| `P/NOTICE` | ported | #14 |
| `P/agents/codex-rescue.md` | ported | `P/agents/copilot-rescue.md`, #21 |
| `P/commands/adversarial-review.md` | ported | #20 |
| `P/commands/cancel.md` | ported | #21 |
| `P/commands/rescue.md` | ported | #21 |
| `P/commands/result.md` | ported | #21 |
| `P/commands/review.md` | ported | #20 |
| `P/commands/setup.md` | ported | #19 |
| `P/commands/status.md` | ported | #21 |
| `P/commands/transfer.md` | skipped | Copilot cannot import a Claude Code session. |
| `P/hooks/hooks.json` | ported | #23 |
| `P/prompts/adversarial-review.md` | ported | #20 |
| `P/prompts/stop-review-gate.md` | ported | #23 |
| `P/schemas/review-output.schema.json` | ported | #20 |
| `P/scripts/app-server-broker.mjs` | skipped | Prompt mode has no long-lived server to share. |
| `P/scripts/codex-companion.mjs` | ported | `P/scripts/copilot-companion.mjs`, #19, #20, #21, #23 |
| `P/scripts/lib/app-server-protocol.d.ts` | ported | `P/scripts/lib/prompt-mode-protocol.d.ts`, #19 |
| `P/scripts/lib/app-server.mjs` | ported | `P/scripts/lib/prompt-mode.mjs`, #19 |
| `P/scripts/lib/args.mjs` | ported | #15 |
| `P/scripts/lib/broker-endpoint.mjs` | skipped | No broker. |
| `P/scripts/lib/broker-lifecycle.mjs` | skipped | No broker. |
| `P/scripts/lib/claude-session-transfer.mjs` | skipped | No `transfer` command. |
| `P/scripts/lib/codex.mjs` | ported | `P/scripts/lib/copilot.mjs`, #15, #19 |
| `P/scripts/lib/fs.mjs` | ported | #15 |
| `P/scripts/lib/git.mjs` | ported | #15 |
| `P/scripts/lib/job-control.mjs` | ported | #15 |
| `P/scripts/lib/process.mjs` | ported | #15 |
| `P/scripts/lib/prompts.mjs` | ported | #15 |
| `P/scripts/lib/render.mjs` | ported | #15 |
| `P/scripts/lib/state.mjs` | ported | #15 |
| `P/scripts/lib/tracked-jobs.mjs` | ported | #15 |
| `P/scripts/lib/workspace.mjs` | ported | #15 |
| `P/scripts/session-lifecycle-hook.mjs` | ported | #23 |
| `P/scripts/stop-review-gate-hook.mjs` | ported | #23 |
| `P/skills/codex-cli-runtime/SKILL.md` | ported | `P/skills/copilot-cli-runtime/SKILL.md`, #19 |
| `P/skills/codex-result-handling/SKILL.md` | ported | `P/skills/copilot-result-handling/SKILL.md`, #20 |
| `P/skills/gpt-5-4-prompting/SKILL.md` | ported | #21 |
| `P/skills/gpt-5-4-prompting/references/codex-prompt-antipatterns.md` | ported | `.../copilot-prompt-antipatterns.md`, #21 |
| `P/skills/gpt-5-4-prompting/references/codex-prompt-recipes.md` | ported | `.../copilot-prompt-recipes.md`, #21 |
| `P/skills/gpt-5-4-prompting/references/prompt-blocks.md` | ported | #21 |
| `scripts/bump-version.mjs` | ported | #14 |
| `tests/broker-endpoint.test.mjs` | skipped | No broker. |
| `tests/bump-version.test.mjs` | ported | #14 |
| `tests/commands.test.mjs` | ported | #20 |
| `tests/fake-codex-fixture.mjs` | ported | `tests/fake-copilot-fixture.mjs`, #14, #19 |
| `tests/git.test.mjs` | ported | #15 |
| `tests/helpers.mjs` | ported | #14 |
| `tests/process.test.mjs` | ported | #15 |
| `tests/render.test.mjs` | ported | #15 |
| `tests/runtime.test.mjs` | ported | #19 |
| `tests/state.test.mjs` | ported | #15 |
| `tsconfig.app-server.json` | ported | `tsconfig.prompt-mode.json`, #19 |

## Changes since the checked commit

Each upstream change gets one row. The status is one of:

- **ported**: the change is in this repo. Give the PR.
- **pending**: the change is not in this repo yet. Give the ticket.
- **skipped**: the change does not apply. Give the reason.

Move the checked commit forward only when every row has a status.

| Upstream commit | Change | Status | PR, ticket or reason |
| --- | --- | --- | --- |
| | None yet | | |
