# Configuration

How to install and log in to the Copilot CLI for this plugin, and what the plugin sets when it runs
Copilot. Run `/copilot:setup` to check your setup.

## Supported Copilot versions

- The plugin supports Copilot CLI **1.0.93 and later**. It was tested on 1.0.93 and 1.0.94.
- Setup reads the version with `copilot --no-auto-update --version`. Every run also passes
  `--no-auto-update`, so the version that setup checked is the version that runs. A bare
  `copilot --version` can report a newer build from Copilot's update cache.
- Setup refuses an older version and tells you to update.

## Install

```bash
npm install -g @github/copilot
```

The Copilot CLI needs Node.js 22 or later. A WinGet install also works: the plugin finds
`copilot.exe` on the `PATH`.

`/copilot:setup` offers to run the npm command for you when Copilot is missing and npm is available.

## Log in

Copilot finds a login in one of these places:

- A login from `copilot login` (or `/login` in an interactive session). It is kept in the system
  credential store.
- The GitHub CLI login from `gh auth login`.
- A token variable. Copilot reads `COPILOT_GITHUB_TOKEN`, then `GH_TOKEN`, then `GITHUB_TOKEN`. Use a
  fine-grained token with the "Copilot Requests" permission. Classic `ghp_` tokens do not work.

Setup checks the login with one small read-only prompt. Each `/copilot:setup` therefore uses one
premium request. The check stops after 60 seconds. When a token variable is set, the report names
the variable, never its value. It cannot tell you that Copilot used the token: Copilot uses a stored
login instead when the token is not valid.

If setup says "not logged in", run `!copilot login` in Claude Code. If the browser flow is blocked,
use `!copilot login --device-code`.

### Systems without a credential store

When `copilot login` finds no credential store, it saves the token in a file in your own Copilot
folder (`~/.copilot`). Reviews and read-only tasks run with the plugin's own Copilot folder (see
"Permission profiles"), so they cannot read that file. On such a system, set `COPILOT_GITHUB_TOKEN`
in the environment that starts Claude Code instead.

### Your own model provider (BYOK)

When `COPILOT_PROVIDER_BASE_URL` is set, Copilot uses that provider and needs no GitHub login.
`COPILOT_PROVIDER_TYPE` names the provider type: `openai` (the default), `azure` or `anthropic`.
Setup then counts Copilot as ready without a login check. See `copilot help providers` for the
other `COPILOT_PROVIDER_*` variables.

## Permission profiles

The plugin starts `copilot --output-format json` once for each run, with the prompt on stdin and
never through a shell. Each run passes `--no-ask-user`, `--no-auto-update` and
`--secret-env-vars=GH_TOKEN,COPILOT_PROVIDER_API_KEY,COPILOT_PROVIDER_BEARER_TOKEN`. The plugin
removes `COPILOT_ALLOW_ALL` and the `GITHUB_COPILOT_PROMPT_MODE_*` variables from Copilot's
environment.

| Profile | Used by | Copilot tools | Copilot folder (`COPILOT_HOME`) |
| --- | --- | --- | --- |
| Read-only | reviews, the review gate, the login check, tasks without `--write` | `view`, `glob` and `grep` only, and `--deny-tool=write,shell,memory` | the plugin's own folder |
| Write | tasks with `--write` | the read-only tools, `create`, `edit`, `apply_patch` and the shell (`bash`, or `powershell` on Windows); `--allow-tool=write,shell`, `--deny-tool=shell(git push)` and `--sandbox` | your own folder |

- The plugin's own Copilot folder has no trusted folders, hooks, saved approvals or MCP servers of
  yours. So the hooks and MCP servers of the repo under review do not start.
- If Copilot starts any other tool in a read-only run, the plugin stops the run and reports the tool.
- The plugin never passes `--allow-all-tools`, `--allow-all`, `--yolo` or `--allow-all-paths`.

## Folders

| What | Where |
| --- | --- |
| Job state and logs | `$CLAUDE_PLUGIN_DATA/state`, or `~/.copilot-companion/state` without it |
| The plugin's Copilot folder | `$CLAUDE_PLUGIN_DATA/copilot-home`, or `~/.copilot-companion/copilot-home` without it |
| The working folder of the login check | `$CLAUDE_PLUGIN_DATA`, or `~/.copilot-companion` without it |

Claude Code sets `CLAUDE_PLUGIN_DATA` for the plugin. The fallback folders are in your home folder,
never in the shared temp folder. On macOS and Linux, `~/.copilot-companion` is readable only by you.

## Model and effort

`/copilot:rescue` accepts `--model <model>` and `--effort <level>`. The plugin passes them to
Copilot as `--model=<model>` and `--reasoning-effort=<level>`. The levels are `none`, `minimal`,
`low`, `medium`, `high` and `xhigh`. Without them, Copilot uses its own default.
