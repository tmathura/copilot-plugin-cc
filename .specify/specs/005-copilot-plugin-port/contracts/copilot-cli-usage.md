# Contract: how the plugin calls the Copilot CLI

Only `scripts/lib/copilot.mjs` (the adapter) and `scripts/lib/prompt-mode.mjs` (the transport helper)
use this. The fake CLI in `tests/fake-copilot-fixture.mjs` implements the same subset. Everything here
was seen on Copilot CLI 1.0.93 (research §1, §2 and §7).

## Version check

- Command: the resolved launcher (research §4) with `--no-auto-update --version` (research §5).
- Output: `GitHub Copilot CLI <x.y.z>.` on stdout. Setup refuses versions below 1.0.93.
- Limit: 30 seconds; after that the check reports that `--version` did not answer (research §5).

## One run

- Command: the resolved launcher with `--output-format json`, `--no-ask-user`, `--no-auto-update`,
  `--secret-env-vars=GH_TOKEN,COPILOT_PROVIDER_API_KEY,COPILOT_PROVIDER_BEARER_TOKEN`,
  the profile arguments (research §3), `--session-id=<new uuid>` or
  `--resume=<id>`, and `--model=<m>`, `--reasoning-effort=<e>` and `--name=<n>` when set.
- Environment: the profile environment (research §3).
- Working folder: the workspace root. For the login check: the plugin data folder.
- Stdin: the prompt text, then end of input.
- Large reviews: when a review is above the inline limit, also pass `--add-dir=<patch folder>`
  (research §2).
- Stdout: one JSON event per line.
- Stderr: kept for error reports, after `cleanCopilotStderr`.
- No shell, on every system.

## Events the adapter reads

| `type` | Fields read | Use |
| --- | --- | --- |
| `assistant.turn_start` | `data.turnId` | `turnId` of the job; progress "Turn started" |
| `assistant.message` | `data.content` | The last one that is not empty is the final answer |
| `assistant.reasoning` | `data.content` | Reasoning summary sections |
| `tool.execution_start` | `data.toolCallId`, `data.toolName`, `data.arguments` | Progress line. In a read-only run, a tool other than `view`, `glob` or `grep` stops the run (research §3) |
| `tool.execution_complete` | `data.toolCallId`, `data.success`, `data.error.message` | Progress line; the tool name comes from the start event with the same `toolCallId` |
| `result` | `sessionId`, `exitCode`, `usage.codeChanges.filesModified` | End of the run; session id; touched files |

Every other event type is ignored, and so is a JSON line that is not an object with a `type`. A new
event type from a newer Copilot does not fail a run.

## Failures

| What happens | Result |
| --- | --- |
| The launcher is not found | "Copilot CLI is not installed", with the npm install command |
| `--version` is below 1.0.93 | "unsupported version", with the update command |
| A stdout line is not JSON | The run fails with an error that quotes the line |
| The process exits before a `result` event | The run fails with the exit code and the cleaned stderr |
| `result.exitCode` is not 0 | The job is `failed`, with the cleaned stderr |
| A read-only run starts a tool other than `view`, `glob` or `grep` | The helper kills the process tree; the run fails with an error that names the tool (research §3) |
| The process does not exit within 5 seconds after `result` | The helper kills the process tree; the job status follows `result.exitCode` |
| Not logged in | Exit 1, nothing on stdout, and stderr starting `Error: No authentication information found.` (research §1). Setup shows `!copilot login` and `COPILOT_GITHUB_TOKEN` |
| The login check runs longer than 60 seconds | The helper kills the process tree; setup reports the timeout (research §7, login check) |
| Cancel | The process tree is killed; the job is `cancelled` |
