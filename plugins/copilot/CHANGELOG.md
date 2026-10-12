# Changelog

## Copilot plugin

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
