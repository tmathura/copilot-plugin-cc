# Implementation Plan: Copilot plugin port

**Branch**: set by the ticket workflow for each ticket | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-copilot-plugin-port/spec.md`

## Summary

Port codex-plugin-cc v1.0.6 to a Claude Code plugin that hands reviews and tasks to the GitHub Copilot
CLI. The owner chose prompt mode as the transport ([research.md](research.md) §6). The plugin starts
`copilot --output-format json` once for each run, sends the prompt on stdin, and reads one JSON event
per line. Copilot's own tool filters, deny rules and a plugin-owned `COPILOT_HOME` make read-only runs
read-only. A review above upstream's inline limit gives Copilot the exact patches in a folder of
its own job storage (research §2). Every upstream call to Codex
has a Copilot match or a reason to drop it in [call-site-map.md](call-site-map.md). Ticket 1 delivers
this research, the map and this plan. Tickets 2 to 8 build the plugin in the phases below.

## Technical Context

**Language/Version**: Node.js ESM (`.mjs`), Node 22 or later

**Primary Dependencies**: none at runtime. The Copilot CLI 1.0.93 or later is an external program.
devDependencies for the type check only: `typescript` and `@types/node`

**Storage**: JSON files per workspace under `$CLAUDE_PLUGIN_DATA/state/`, as upstream `state.mjs`.
The fallback is `~/.copilot-companion/state/`, not upstream's shared temp folder (research §7).
A review above the inline limit also has `jobs/<id>.patches/` while it runs; it is removed at the
end, and with its job record (research §2, added 2026-10-09)

**Testing**: `node --test tests/*.test.mjs` with a fake `copilot` CLI; `claude plugin validate .`;
a manual run with `claude --plugin-dir` before release

**Target Platform**: Claude Code on macOS, Linux and Windows

**Project Type**: Claude Code plugin and marketplace (commands, agent, skills, hooks, Node scripts)

**Performance Goals**: none beyond upstream. Cancel stops a job within 10 seconds (spec SC-007)

**Constraints**: no shell for child processes; reviews read-only through Copilot's tool filters; no
`--allow-all-tools`, `--allow-all` or `--yolo`; prompts go over stdin; read-only runs use a plugin-owned
`COPILOT_HOME` and a scrubbed environment

**Scale/Scope**: about 5,000 lines of upstream code to port, 7 commands, 1 agent, 3 skills, 3 hooks

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Planned proof |
| --- | --- | --- |
| I. Upstream parity | Met | Same layout, file names and command, agent, skill and hook names with the rename rules (research §7). Every change and drop in [call-site-map.md](call-site-map.md) has a reason that the principle allows: Copilot cannot do it (native reviewer, broker, protocol client, interrupt, output schema, `spark`, ephemeral sessions, transfer), security (no shell, read-only review context, plugin-owned `COPILOT_HOME`), or platform support (Windows launcher, CI on three systems). Each ticket adds its differences to the README section "Differences from the Codex plugin". |
| II. Only reviewed code | Met | Code is written here or ported from upstream; the community ports were read for ideas only. No runtime dependencies. The devDependencies (`typescript`, `@types/node`) are for the type check only, as upstream. Each porting PR lists the upstream files and commit `db52e28` and says they were read line by line. |
| III. Documented interfaces only | Met | Prompt mode with JSON output and the CLI flags and environment variables in the official docs (research sources). Only `scripts/lib/copilot.mjs` builds Copilot arguments and the child environment, and decides permissions. Only it imports the transport helper `scripts/lib/prompt-mode.mjs`, which only starts the process, writes the prompt and reads its output. The transport comparison is in research §2. Supported versions: 1.0.93 and later (research §5). Setup errors for a missing CLI, an old version and no login (spec FR-012). |
| IV. Safe by default | Met | Reviews, the gate and read-only tasks use the read-only profile in research §3: Copilot's tool filters and deny rules, and a plugin-owned `COPILOT_HOME`, so the reviewed repository's hooks and MCP servers stay off. A review refuses to run, or stops, in the two cases of research §3. Above the inline limit, a review also writes its patch folder, a job file in the plugin's job storage (`jobs/<id>.patches`), outside the repository, which is deleted after the run (research §2). Tasks are read-only unless `--write`; the write profile is the smallest set that matches upstream `workspace-write`. No allow-all flag, and an inherited `COPILOT_ALLOW_ALL` is removed. Login stays with Copilot; the plugin stores no tokens. `process.mjs` uses `shell: false`; one launcher helper handles the npm shim (research §4); tests cover spaces and shell characters. |
| V. Cross-platform | Met | Node 22 ESM with `node:path`. CI runs the tests on Ubuntu, macOS and Windows. Repo scripts use bash. |
| VI. Tested, including failure paths | Met | The fake CLI covers each failure path of the principle, in the ticket that touches it (see the phases). `claude plugin validate .` and `node --test` pass at the end of every ticket from ticket 2. Ticket 8 runs the manual release check. |
| Licensing (section 4 of Apache-2.0) | Met | Ticket 2 ships `LICENSE` and the upstream `NOTICE` text. Changed `.mjs` and `.d.ts` files carry a header comment that says they were changed from upstream. Files that cannot hold a comment, or where a comment would reach the model as prompt text (JSON, command, agent, skill and prompt Markdown), are listed in `NOTICE` under a "Changes" heading. |
| Versioning | Met | Ticket 2 ports `scripts/bump-version.mjs` as the check script. Ticket 8 sets 1.0.0. |
| Features | Met | The plugin has exactly the listed features, and no `transfer`. This spec covers them all. |

Re-check after Phase 1 design: no change. No principle is "not met", so Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-copilot-plugin-port/
├── spec.md              # what the port must do
├── research.md          # transport comparison and decision, design rules
├── call-site-map.md     # every upstream Codex call and its Copilot match
├── plan.md              # this file
├── data-model.md        # job, state and session records
├── quickstart.md        # end-to-end validation run
├── contracts/
│   ├── companion-cli.md # companion subcommands, flags and outputs
│   └── copilot-cli-usage.md # the Copilot arguments, environment and JSON events the plugin uses
├── checklists/
│   └── requirements.md
└── tasks.md             # from /speckit-tasks
```

### Source Code (repository root)

```text
.claude-plugin/marketplace.json
.github/workflows/pull-request-ci.yml
package.json
package-lock.json
tsconfig.prompt-mode.json
scripts/bump-version.mjs
LICENSE
NOTICE
README.md
UPSTREAM.md
plugins/copilot/
├── .claude-plugin/plugin.json
├── CHANGELOG.md
├── LICENSE
├── NOTICE
├── agents/copilot-rescue.md
├── commands/{review,adversarial-review,rescue,status,result,cancel,setup}.md
├── hooks/hooks.json
├── prompts/{adversarial-review,review,stop-review-gate}.md
├── schemas/review-output.schema.json
├── skills/
│   ├── copilot-cli-runtime/SKILL.md
│   ├── copilot-result-handling/SKILL.md
│   └── gpt-5-4-prompting/{SKILL.md,references/*.md}
└── scripts/
    ├── copilot-companion.mjs
    ├── session-lifecycle-hook.mjs
    ├── stop-review-gate-hook.mjs
    └── lib/
        ├── prompt-mode.mjs
        ├── prompt-mode-protocol.d.ts
        ├── args.mjs
        ├── copilot.mjs
        ├── fs.mjs
        ├── git.mjs           # review context; writeReviewPatches for jobs/<id>.patches
        ├── job-control.mjs
        ├── process.mjs
        ├── prompts.mjs
        ├── render.mjs
        ├── state.mjs         # state.json, jobs/<id>.json, .log and .patches/
        ├── tracked-jobs.mjs
        └── workspace.mjs
tests/
├── fake-copilot-fixture.mjs
├── helpers.mjs
└── *.test.mjs
docs/
├── conventions.md       # exists
├── development.md       # exists
├── configuration.md     # ticket 4
├── operations.md        # ticket 6
└── architecture.md      # ticket 8
```

**Structure Decision**: the upstream layout, with the renames and drops in the call-site map. The new
files are `prompts/review.md`, `UPSTREAM.md` and the three docs files that the owner asked for.

## Phases

Phase 0 (research) and Phase 1 (design) are ticket 1. Each later phase is one ticket. Each ticket
ends with `claude plugin validate .` and `node --test tests/*.test.mjs` passing, and adds its
differences to the README.

| Phase | Ticket | Scope | Failure-path tests (Principle VI) |
| --- | --- | --- | --- |
| 0, 1 | 1 | Copilot CLI check, transport research and decision, call-site map, design files. No plugin code. | none (no code) |
| 2 | 2 | Base layout: marketplace and plugin manifests, `LICENSE`, `NOTICE`, `UPSTREAM.md`, `package.json` (Node 22+), `scripts/bump-version.mjs`, the PR CI workflow on three systems, `tests/helpers.mjs`, a fake `copilot` that answers `--version` and `--help`, `README.md` skeleton with the differences section. | version check mismatch |
| 3 | 3 | Shared runtime modules: `args`, `fs`, `git`, `process` (no shell, and the `resolveLauncher` helper for Windows `.cmd` shims), `state`, `tracked-jobs`, `job-control`, `workspace`, `render`, `prompts`, and `copilot.mjs` with only `getSessionRuntimeStatus`. Their tests. `state.mjs` locks each update. | non-zero exit, spaces and shell characters in arguments, process tree kill, concurrent state updates |
| 4 | 4 | Copilot adapter and setup: `copilot.mjs`, `prompt-mode.mjs` and its types, the prompt-mode fake CLI, the companion `setup` subcommand, `/copilot:setup`, the `copilot-cli-runtime` skill, the type check, `docs/configuration.md`. | missing CLI, old version, no login, broken JSON, output cut off before `result`, non-zero exit, a forbidden tool in a read-only run, a hang after `result` (added 2026-10-08) |
| 5 | 5 | Review commands: `/copilot:review`, `/copilot:adversarial-review`, `prompts/review.md`, `prompts/adversarial-review.md`, the schema, `copilot-result-handling`. Above the inline limit, the patch folder `jobs/<id>.patches` (research §2). | a write blocked during a review, a review that cannot get the read-only profile, broken review JSON, the patch folder removed after the run and on a signal |
| 6 | 6 | Rescue and background jobs: `/copilot:rescue`, the `copilot-rescue` agent, `gpt-5-4-prompting`, the `task` and `task-worker` subcommands with `--background`, `--write`, `--model`, `--effort`, `--resume`, `--fresh`, `task-resume-candidate`, `/copilot:status`, `/copilot:result`, `/copilot:cancel`, `docs/operations.md`. | cancel with the child process stopped, read-only task blocked from writing, resume with no earlier session |
| 7 | 7 | Review gate and session hooks: `hooks/hooks.json`, `stop-review-gate-hook.mjs`, `session-lifecycle-hook.mjs`, `prompts/stop-review-gate.md`. | gate blocks a stop, gate lets Claude stop, gate with Copilot missing |
| 8 | 8 | First release: full README, `docs/architecture.md` from the real code, the manual run in [quickstart.md](quickstart.md), version 1.0.0, the install commands. | manual run (Principle VI) |

## Complexity Tracking

No principle is "not met". Nothing to record.
