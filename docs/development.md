# Development

How work moves from an idea to `main`. The rules behind these steps are in the
[constitution](../.specify/memory/constitution.md).

## Ticket workflow

1. Open a GitHub issue for the change.
2. Make a branch `<type>/<n>-<slug>` from the latest `origin/main`, in its own worktree. The type is
   `bugfix` for an issue with the `bug` label, and `feature` for all others.
3. Plan with Claude plan mode or with Spec Kit (below). Run the plan's Constitution Check.
4. Make the change, with its tests and docs.
5. Commit with the subject `[#n] Imperative description`.
6. Run a Codex review of the branch. Fix confirmed findings, and record rejected ones with the reason.
7. Open a PR into `main`. Copilot reviews each push. Answer and resolve every thread.
8. Squash-merge when the reviews are done and CI passes. Until the repo has CI, the reviews are
   enough.

The owner runs these steps with personal `cpcc-workflow-*` Claude Code skills. They are not in this
repo. You can follow the same steps by hand.

## Spec Kit

The repo uses [Spec Kit](https://github.com/github/spec-kit) 1.1.2.dev0 with the Claude Code
integration (`.claude/skills/speckit-*`) and bash scripts (`.specify/scripts/bash/`). It has no
extensions.

### Using it

Run the skills in this order:

1. `/speckit-specify <feature description>` writes `specs/NNN-<name>/spec.md`.
2. `/speckit-clarify` (optional) answers open questions in the spec.
3. `/speckit-plan` writes `plan.md`.
4. `/speckit-tasks` writes `tasks.md`.
5. `/speckit-analyze` (optional) checks the spec, plan and tasks against each other.
6. `/speckit-implement` works through `tasks.md`.

`/speckit-checklist` (optional) writes a requirements checklist. Run it only after `/speckit-plan`.
Without a plan, its setup script stops with "plan.md not found". This is how Spec Kit works. The
skill and script stay unchanged so that upgrades keep working.

Things to know:

- The skills run the scripts in `.specify/scripts/bash/` directly, for example
  `.specify/scripts/bash/setup-plan.sh --json`. They work the same on macOS, Linux and Windows,
  because Claude Code's Bash tool uses Git Bash on Windows.
- `jq` is optional. Without it, the scripts use `printf` and `awk`.
- Git stores the scripts as executable (mode `100755`). If a script fails with "permission denied",
  run `chmod +x .specify/scripts/bash/*.sh`. If `git ls-files -s .specify/scripts/bash` then shows
  `100644`, also run `git add --chmod=+x .specify/scripts/bash/*.sh` and commit it.
- Specs live in `specs/NNN-<name>/` with sequential numbers. The next number is the highest one in
  `specs/` of the current checkout, plus one. A spec in a ticket worktree that is not merged yet is not
  counted. Before you start a second spec at the same time, check the open worktrees for numbers in
  use.
- `.specify/feature.json` points to the current spec. Each checkout has its own copy, and git ignores
  it. A new or resumed worktree has none, so `/speckit-plan`, `/speckit-analyze` and
  `/speckit-implement` fail with "Feature directory not found". To fix it, write
  `{"feature_directory": "specs/NNN-<name>"}` to `.specify/feature.json`. Always use a path from the
  repo root.
- Spec Kit does not create git branches here. Branches are made by the ticket workflow.
- The tasks template says tests are optional. In this repo the constitution (Principle VI) asks for
  them, so `tasks.md` must include test tasks.
- `/speckit-specify`, `/speckit-plan` and `/speckit-tasks` rewrite their files. Make later corrections
  by hand, then run `/speckit-analyze` again.
- The bundled Spec Kit workflow (`.specify/workflows/`) was deleted because nothing uses it. If an
  upgrade brings it back, delete it again.

### Setup

Install the CLI with `uv tool install specify-cli --from git+https://github.com/github/spec-kit.git`.

The repo was set up with:

```bash
specify init --here --force --non-interactive --ignore-agent-tools --integration claude --script sh
git add --chmod=+x .specify/scripts/bash/*.sh
```

Use `--script sh`, because the constitution (Principle V) says repo scripts use bash. Most macOS and
Linux machines also have no PowerShell for `ps`. The `py` option installs the PowerShell scripts too,
and needs `python`. Do not run `init` again on this repo: `--force` overwrites
changed shared files.

### Upgrading

1. Run `uv tool upgrade specify-cli`, then `specify integration upgrade claude`.
2. The upgrade refuses if someone changed a managed file by hand. Read the diff before you commit.
3. If the upgrade adds a script, run `git add --chmod=+x .specify/scripts/bash/*.sh` again.

### Line endings

`.gitattributes` forces LF. Spec Kit's manifests (`.specify/integrations/*.manifest.json`) store a
SHA-256 hash of each file's exact bytes. With CRLF, files nobody changed look changed, and
`specify integration upgrade` refuses to run.

## Upstream sync

The port tracks [codex-plugin-cc](https://github.com/openai/codex-plugin-cc). `UPSTREAM.md` (added
by the port) records the upstream commit that was last checked. When upstream makes a release, read
its changes since that commit. Give each change a status: ported, pending, or skipped with a reason.
Open a ticket for each change to port. Move the checked commit forward only when every change has a
status.

## Release

1. Raise the version in the package, plugin and marketplace files. The check script must pass.
2. Run the tests and `claude plugin validate .`.
3. Run the plugin with `claude --plugin-dir` on a real git repo: a review, a background task with
   status and result, cancel, and the review gate.
4. Merge, and tag the release.
