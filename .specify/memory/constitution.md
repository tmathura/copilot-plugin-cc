# copilot-plugin-cc Constitution

This plugin lets Claude Code hand code reviews and coding tasks to the GitHub Copilot CLI. It is a
port of OpenAI's [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (Apache-2.0). The
baseline is v1.0.6, commit `db52e28f4d9ded852ab3942cea316258ae4ef346`.

The rules below are ranked. If two rules conflict, Principle IV wins first, then Principle I. The
detailed conventions are in [docs/conventions.md](../../docs/conventions.md). The workflow steps are
in [docs/development.md](../../docs/development.md).

## Core Principles

### I. Upstream parity

- The repo MUST keep the upstream layout: the plugin in `plugins/copilot/` and the marketplace file at
  the root.
- File names, command names, agent names, skill names and hook names MUST match upstream, with
  `codex` changed to `copilot`.
- User-visible behaviour MUST match upstream wherever Copilot supports it.
- Module boundaries and function names MUST match upstream where the Copilot transport allows it.
- A change from upstream is allowed only for one of these reasons: Copilot cannot do the same thing,
  security, correctness, or platform support. Each change MUST be listed in the README section
  "Differences from the Codex plugin", with its reason.

Why: the owner follows upstream releases. An upstream change must land in the same place here.

### II. Only reviewed code

- Code MUST come from one of three sources: code written in this repo, code ported from upstream
  codex-plugin-cc, or the Spec Kit files already in the repo.
- Code from other Copilot ports MUST NOT be copied. Those repos are read for ideas only.
- Other Copilot plugins for Claude Code MUST NOT be installed. Review tools that the owner chooses,
  such as the Codex plugin used in the workflow, are allowed.
- The plugin MUST NOT have runtime npm dependencies. It uses Node built-ins only.
- A devDependency is allowed only for build or test. Its PR MUST give the reason.
- A PR that brings in upstream code MUST list the files and the upstream commit. It MUST say that
  someone read them line by line.

### III. Copilot CLI through documented interfaces only

- The plugin MUST use only the flags, output formats and protocols in the official Copilot CLI docs.
  This includes JSON output (one JSON record per line) and ACP.
- Every Copilot call MUST go through one adapter module, the match for upstream
  `scripts/lib/codex.mjs`.
- Only that module builds Copilot arguments and decides permissions. A transport helper that it uses
  MUST NOT be imported by any other module. The helper only starts the process and reads its output.
- A feature spec chooses the transport. It MUST compare the options on permission control,
  streaming, cancel, sessions, Windows support and CLI version support first. Closeness to upstream
  comes second.
- The supported Copilot CLI versions MUST be documented.
- `setup` MUST give a clear error when the CLI is missing, the version is not supported, or the user
  is not logged in.

### IV. Safe by default

- `review`, `adversarial-review` and the review gate MUST NOT change the target repo or any remote.
  The Copilot CLI's own controls (tool permissions, sandbox) MUST enforce this. Words in the prompt
  are not enough.
- If a review cannot run read-only, it MUST refuse to run.
- The only files a review may write are the plugin's own job files.
- The companion MUST run read-only unless `--write` is passed. This matches the upstream `task`
  command. The rescue subagent may add `--write` under the upstream rule.
- `--write` MUST give the fewest Copilot permissions that do the job.
- `--allow-all-tools`, or a flag with the same effect, MUST NOT run outside a throwaway test repo
  without the user's approval. An approval never removes the read-only rule for reviews.
- Tokens and other credentials MUST NOT appear in the repo, the job files or the logs. Login stays
  with Copilot's `/login` or the token variables in the Copilot docs.
- Child processes MUST start without a shell: `spawn` or `execFile` with an argument array. If
  Windows needs a `.cmd` shim, it MUST live in one helper. Tests MUST cover spaces and shell
  characters in the arguments.

### V. Cross-platform

- The plugin MUST work the same on macOS, Linux and Windows.
- The runtime is Node ESM, version 22 or later, because the Copilot CLI needs Node 22. Paths go through `node:path`. The runtime has no
  shell-specific syntax.
- Repo scripts and the workflow MUST use bash (Git Bash on Windows). They MUST NOT use PowerShell or
  fixed paths.

### VI. Tested, including failure paths

- Tests MUST run with `node --test` and a fake Copilot CLI.
- A change MUST have tests for the failure paths it touches: a write blocked during a review, a
  missing CLI, no login, an unsupported version, broken or cut-off JSON output, a non-zero exit, a
  timeout, cancel with the child process stopped, and the review gate both when it blocks a stop and
  when it lets Claude stop.
- `claude plugin validate .` MUST pass.
- Before each release, a person MUST run the plugin with `claude --plugin-dir` on a real git repo. The
  run covers a review, a background task with status and result, cancel, and the review gate.

## Distribution, licensing and versioning

- The license is Apache-2.0. Before the first release, the repo MUST meet section 4 of the license:
  - ship `LICENSE`;
  - keep every upstream copyright, patent, trademark and attribution notice that applies;
  - copy the upstream `NOTICE` text that applies;
  - give each changed upstream file a clear notice that says it was changed.
  The port ticket decides how to mark files that cannot hold comments.
- The repo is its own plugin marketplace. Users install with
  `claude plugin marketplace add tmathura/copilot-plugin-cc`, then
  `claude plugin install copilot@tmathura-copilot`.
- Plugin versions use SemVer, measured by what users see. The package, plugin and marketplace
  versions MUST match. A check script MUST enforce this. Every release MUST raise the version.
- The constitution has its own version.
- The plugin has these features: `review`, `adversarial-review`, `rescue`, `status`, `result`,
  `cancel`, `setup`, the `copilot-rescue` subagent, and the optional Stop-hook review gate. It has no
  `transfer`. A new feature MUST start with a spec.

## Development workflow

- Each change has one GitHub issue and one branch, `<type>/<n>-<slug>`, in its own worktree. Commit
  subjects are `[#n] Imperative description`. PRs are squash-merged into `main`.
- A plan's Constitution Check MUST mark each principle as met (with the planned proof), not relevant
  (with the reason), or not met. "Not met" is allowed only where a principle allows a change. It then
  needs the owner's approval and a line in Complexity Tracking. Anything else needs an amendment.
- Test proof is checked at merge and at release, not at plan time.
- A PR is merged only when:
  - tests and CI pass, where they exist;
  - the Codex and Copilot review loops have finished, or the PR says a reviewer was not available;
  - each finding is fixed, or recorded with the reason it was rejected.
- `UPSTREAM.md` records the upstream commit that was last checked. It gives each upstream change a
  status: ported, pending, or skipped with a reason. The checked commit moves forward only when every
  change has a status.
- Pushes need the owner's approval. So does `--allow-all-tools` outside the test repo. Starting the
  ticket workflow counts as approval for that ticket's own pushes and PR.

## Governance

- This constitution comes before all other project rules and docs.
- To change it, open a ticket and a PR, and raise the version: MAJOR when a principle is removed or
  changes meaning, MINOR when a principle is added or grows, PATCH for wording.
- Every plan and every PR review checks the work against this constitution.

**Version**: 1.0.0 | **Ratified**: 2026-10-08 | **Last Amended**: 2026-10-08
