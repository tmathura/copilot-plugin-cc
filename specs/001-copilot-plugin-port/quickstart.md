# Quickstart: validate the Copilot plugin

The manual release run (constitution, Principle VI). Ticket 8 does it in full. Earlier tickets run the
parts that exist.

## Before you start

- Node 22 or later, Git, Claude Code.
- Copilot CLI 1.0.93 or later: `npm install -g @github/copilot`, then `copilot login` once (or a GitHub CLI login, or `COPILOT_GITHUB_TOKEN`; see `docs/configuration.md`).
- A throwaway git repository with one commit, one staged change and one untracked file. Use it for
  every step below.

## Automated checks

```bash
npm ci
npm test
claude plugin validate .
```

All must pass.

## Manual run

Start Claude Code in the test repository with the plugin from the checkout:

```bash
claude --plugin-dir <path to this repo>/plugins/copilot
```

| Step | Do | Expect |
| --- | --- | --- |
| 1 | `/copilot:setup` | `Status: ready`, the Copilot version, the auth source, `review gate: disabled` |
| 2 | `/copilot:review --wait` | A review of the working tree. `git status` and `git stash list` are the same as before |
| 3 | `/copilot:adversarial-review --wait check error handling` | A verdict, findings with file and lines, next steps. The repository is unchanged |
| 3b | Add `.github/hooks/probe.json` with a `sessionStart` command hook that writes `hooked.txt`, then `/copilot:review --wait` | The review runs. `hooked.txt` does not exist |
| 4 | `/copilot:rescue --background --write add a README line that says hello` | "started in the background as task-…" |
| 5 | `/copilot:status` | A table with the task, `running`, then `completed` |
| 6 | `/copilot:result` | The task output and `copilot --resume=<id>`. `git diff` shows the README change |
| 7 | `/copilot:rescue --background --write run the shell command sleep 300 (Start-Sleep 300 on Windows) and report when it ends`, then `/copilot:cancel` while it runs | The job shows `cancelled`. No `copilot` process from the job is left (Task Manager or `ps`) |
| 8 | `/copilot:setup --enable-review-gate`, ask Claude for a small change with an obvious bug, let it stop | The stop is blocked with a `BLOCK:` reason |
| 9 | Fix the bug, let Claude stop | Claude stops |
| 10 | `/copilot:setup --disable-review-gate` | `review gate: disabled` |

Run steps 2 and 3 on Windows and on one of macOS or Linux.

## Failure checks

| Do | Expect |
| --- | --- |
| Run `/copilot:setup` with `copilot` removed from the PATH | "not installed", with the npm install command |
| Run `/copilot:review` from a folder that is not a git repository | "This command must run inside a Git repository." |
