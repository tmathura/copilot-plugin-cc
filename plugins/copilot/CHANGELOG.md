# Changelog

## Copilot plugin

### 1.0.17

- The active jobs table in `/copilot:status` keeps a value that holds `\|`, such as a job summary,
  in its own cell. Before, the `|` ended the cell and moved the columns after it.

### 1.0.16

- `/copilot:adversarial-review` now reads Copilot's verdict when Copilot writes a line of text
  before or after its one fenced JSON block. Before, the review failed with "Copilot did not return
  valid structured JSON". An answer with two fenced blocks still fails.

### 1.0.15

- When the review gate stops a review that ran past its limit, or that was stopped, its job now
  shows as `cancelled` with the gate's reason in `/copilot:status`, also when the review failed
  while the gate was stopping it. Before, on Windows, such a job could show as `failed` with the
  companion's own error.

### 1.0.14

- On Windows, when a Claude session ends, a slow or stuck `taskkill` can no longer make the hook
  pass its 5-second limit. Each `taskkill` now ends by the hook's deadline. A job whose stop did not
  finish in time keeps its process ids, so you can run `/copilot:cancel <job id>` again.
- On Windows, `/copilot:cancel` gives up on a `taskkill` that takes more than 5 seconds and says
  that the stop failed, so you can run it again. Before, it could wait with no end. The stop of
  Copilot after a run has the same 5-second limit.

### 1.0.13

- On Windows, when a Claude session ends with several running jobs, the plugin stops them all at
  the same time, in about a second. Before, it stopped them one after another, about a second
  each, so with three jobs Claude Code could stop the hook at its 5-second limit before it removed
  the stopped jobs.
- On Windows, `/copilot:cancel` stops the companion and its Copilot process at the same time, so it
  ends about a second sooner.

### 1.0.12

- On Windows, when `/copilot:cancel` cannot stop a child process that the job does not track, and
  whose parent has already exited, it names that process and says that a new cancel cannot reach
  it. Before, it only asked you to
  run cancel again.

### 1.0.11

- A large branch review keeps white space at the end of the last changed file name, such as a
  no-break space. Before, that one name lost it.

### 1.0.10

- `/copilot:status` shows a job's first line that says something as its summary. Before, a review
  could show a heading or a label, such as `## Review` or `**Findings**`.

### 1.0.9

- A run that fails because Copilot is not logged in now names `/copilot:setup` after Copilot's
  own error, in a task, a review, `/copilot:result` and the review gate.
- The review gate's message for a failed run gives the reason. Before, it showed the task's raw
  JSON output.

### 1.0.8

- `/copilot:rescue` shows why it cannot run Copilot. A missing or too old Copilot gives the error
  and `/copilot:setup` as the next step. A foreground run that fails at once, for example without a
  login, shows Copilot's error. Before, the answer was empty.

### 1.0.7

- On Windows, `/copilot:cancel` during Copilot's start reports the job cancelled. Before, it often
  failed with "The process with PID ... could not be terminated" for short-lived children that had
  already exited, and asked you to run it again.

### 1.0.6

- `/copilot:adversarial-review` asks Copilot for its JSON as plain text in the final message, not
  through a tool. Before, Copilot sometimes called a tool named `json`, and the review stopped with
  no verdict.
- A review whose last Copilot turn has no answer now says so. Before, it showed an earlier message,
  such as "Need to check what setup prints.", as the answer.

### 1.0.5

- `/copilot:result <job id>` with the full id of a queued or running job says that the job is still
  queued or running. Before, it could show the result of another job whose id starts with the same
  text, or say that no job was found.

### 1.0.4

- A review's Git Status keeps the leading space of its first line. Before, an unstaged change on
  the first line looked staged to Copilot. The status and most file lists also keep white space at
  the end of a file name, such as a no-break space.

### 1.0.3

- An option written as `--name=value` keeps every `=` in its value. Before, `--base=refs/x=y`
  gave `refs/x` without an error.

### 1.0.2

- A companion that is stopped while it takes the state lock no longer leaves an empty lock file.
  Before, every later command waited 5 seconds and then failed with "The lock has no readable
  owner", until you deleted the file by hand.

### 1.0.1

- A review shows a file name with non-ASCII letters as it is, in the status, the file lists and the
  patches. Before, it showed git's quoted form, such as `"caf\303\251.js"`.

### 1.0.0

- First release. `/copilot:review`, `/copilot:adversarial-review`, `/copilot:rescue`,
  `/copilot:status`, `/copilot:result`, `/copilot:cancel` and `/copilot:setup`, the
  `copilot-rescue` subagent, and the optional Stop-hook review gate. The plugin runs the Copilot CLI
  in prompt mode. The differences from the Codex plugin are in the README.

### 0.1.0

- Empty `copilot` plugin: manifests, license files and the version check. No commands yet.

## Codex plugin (upstream)

### 1.0.0

- Initial version of the Codex plugin for Claude Code
