# Contract: `copilot-companion.mjs`

The commands in `plugins/copilot/commands/*.md` call this script. Its subcommands, flags and output
shapes match upstream `codex-companion.mjs`, apart from the rows marked **changed**. Every
subcommand takes `--cwd <path>` (alias `-C`) and, where upstream does, `--json`.

| Subcommand | Flags | Output | Change from upstream |
| --- | --- | --- | --- |
| `setup` | `--enable-review-gate`, `--disable-review-gate`, `--json` | Setup report: `ready`, `node`, `npm`, `copilot` (was `codex`; adds `version` and `missing`), `auth`, `sessionRuntime`, `reviewGateEnabled`, `actionsTaken`, `nextSteps` | **changed**: `copilot` key, version floor, Copilot next steps; `/copilot:setup` offers the install only when `copilot.missing` is true (added 2026-10-08, PR review) |
| `review` | `--wait`, `--background`, `--base <ref>`, `--scope auto\|working-tree\|branch`, `--model`/`-m`, `--json` | Rendered review text, or the payload with `--json` | **changed**: Copilot's `/review` with inline context instead of the native reviewer |
| `adversarial-review` | Same as `review`, plus focus text | Rendered findings, or the payload | **changed**: schema sent in the prompt |
| `task` | `--background`, `--write`, `--resume-last`, `--resume`, `--fresh`, `--model`/`-m <model>`, `--effort <none\|minimal\|low\|medium\|high\|xhigh>`, `--prompt-file <path>`, `--json`, prompt text or stdin; internal `--context-dir <path>` (review gate only) | Task output, or "started in the background as <id>" | **changed**: no `spark` alias; `--context-dir` |
| `task-worker` | `--job-id <id>` | None (internal) | none |
| `task-resume-candidate` | `--json` | `available`, `sessionId`, `candidate`; the candidate also reports its `write` value | **changed**: `write` field |
| `status` | `[job-id]`, `--all`, `--wait`, `--timeout-ms`, `--poll-interval-ms`, `--json` | Status table or one job report | none |
| `result` | `[job-id]`, `--json` | Stored output, with `Copilot session ID`; `copilot --resume=<id>` for write tasks only | **changed**: resume command |
| `cancel` | `[job-id]`, `--json` | Cancel report; `turnInterruptAttempted` is always `false` | **changed**: no protocol interrupt across processes; a job id matches all jobs first, and a finished job is refused, except a cancelled job whose cancel did not stop every process (added 2026-10-09) |
| `transfer` | | | **dropped** |

Exit codes: `0` on success; `1` on an error, with the message on stderr; the job's exit status for a
failed review or task, as upstream.
