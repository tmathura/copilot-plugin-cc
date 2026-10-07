# copilot-plugin-cc

A Claude Code plugin. Details will follow with the first feature.

## Spec Kit

The repo uses [Spec Kit](https://github.com/github/spec-kit) for spec-driven planning, with the
Claude Code integration (`.claude/skills/speckit-*`) and bash scripts (`.specify/scripts/bash/`).
Installed version: **1.1.2.dev0**, no extensions.

### Using it

Run the skills in this order:

1. `/speckit-specify <feature description>` writes `specs/NNN-<name>/spec.md`
2. `/speckit-clarify` (optional) resolves open questions in the spec
3. `/speckit-plan` writes `plan.md`
4. `/speckit-tasks` writes `tasks.md`
5. `/speckit-analyze` (optional) checks the spec, plan and tasks against each other
6. `/speckit-implement` works through `tasks.md`

`/speckit-checklist` (optional) writes a requirements checklist. Run it only after `/speckit-plan`:
its setup script stops with "plan.md not found" when there is no plan yet. This is upstream
behaviour; the managed skill and script are kept unmodified so upgrades keep working.

Notes:

- The skills run the scripts in `.specify/scripts/bash/` directly, e.g.
  `.specify/scripts/bash/setup-plan.sh --json`, so they work the same on macOS, Linux and Windows
  (through Git Bash, which Claude Code's Bash tool uses). `jq` is optional; the scripts fall back to
  `printf` and `awk` without it. Git stores the scripts as executable (mode `100755`). If a script
  fails with "permission denied", run `git add --chmod=+x .specify/scripts/bash/*.sh` and commit.
- Specs live in `specs/NNN-<name>/`, numbered sequentially. The next number is the highest one in
  `specs/` of the current checkout plus one. A spec moved into a ticket worktree and not yet merged
  doesn't count, so before specifying a second ticket in parallel, check the open worktrees for
  numbers already taken.
- `.specify/feature.json` points at the current feature. It is per checkout and gitignored
  (`.specify/.gitignore`), so a re-created or resumed worktree has none, and `/speckit-plan`,
  `/speckit-analyze` and `/speckit-implement` fail with "Feature directory not found". To restore it,
  write `{"feature_directory": "specs/NNN-<name>"}` to `.specify/feature.json`. Always use a path
  relative to the repo root.
- Don't use `specify workflow run speckit`. The bundled workflow runs specify → plan → tasks →
  implement in one checkout. It pauses for review after specify and after plan, but goes straight
  from tasks to implement, and never creates the ticket branch and worktree the work belongs in.
- Spec Kit does not create git branches here. Branches are named `<type>/<n>-<slug>` and are created
  outside Spec Kit.
- The generators (`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`) rewrite their files. Make
  later corrections by hand and re-run `/speckit-analyze` instead.
- `.specify/memory/constitution.md` is still the placeholder template. Fill it in with
  `/speckit-constitution`.

### Install (first time only)

This is how the scaffolding was created, in an empty checkout:

```
specify init --here --force --non-interactive --ignore-agent-tools --integration claude --script sh
git add --chmod=+x .specify/scripts/bash/*.sh
```

`--force` only skips the "directory not empty" prompt. `--ignore-agent-tools` skips the check for a
`claude` CLI on `PATH`. The `chmod` keeps the scripts executable when the install runs on Windows,
which otherwise commits them as `100644` and breaks the skills on macOS and Linux. Use `sh`, not
`ps` (PowerShell doesn't run on macOS or Linux) or `py` (it also installs the PowerShell scripts, and
its skills call `python`). Don't re-run this on a populated repo: `--force` overwrites customised
shared files, and switching `--script` this way leaves the old scripts' entries in
`.specify/integrations/speckit.manifest.json`.

### Upgrading

1. Upgrade the CLI (`uv tool upgrade specify-cli`), then run `specify integration upgrade claude`.
   It refuses if a managed file was changed by hand. Review the diff before committing, and re-run
   `git add --chmod=+x .specify/scripts/bash/*.sh` if it adds a script.
2. Refresh the bundled workflow by hand. Neither `integration upgrade`, `init` nor `workflow update`
   refreshes it. Diff `.specify/workflows/speckit/workflow.yml` against
   `core_pack/workflows/speckit/workflow.yml` in the installed `specify_cli` package. If it changed,
   copy it over and set the `speckit` entry's `version` in `.specify/workflows/workflow-registry.json`
   to the new file's `version`.

### Line endings

`.gitattributes` forces LF. Spec Kit's manifests (`.specify/integrations/*.manifest.json`) store
SHA-256 hashes of the exact file bytes. A CRLF checkout would make untouched files look modified and
block `specify integration upgrade`.
