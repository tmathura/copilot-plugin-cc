# Development

How work moves from an idea to `main`. The rules behind these steps are in the
[constitution](../.specify/memory/constitution.md).

## Ticket workflow

1. Plan with Claude plan mode or with Spec Kit (below). Run the plan's Constitution Check. Have
   Codex and Copilot review the plan, and apply their confirmed findings.
2. Open a GitHub issue from the plan.
3. Make a branch `<type>/<n>-<slug>` from the latest `origin/main`, in its own worktree. The type is
   `bugfix` for an issue with the `bug` label, and `feature` for all others. Spec Kit wrote its files
   in the main checkout; move `specs/NNN-<name>/` and `.specify/feature.json` into the worktree.
4. Make the change, with its tests and docs. If the work departs from the spec, update the spec in
   the same commit ("Keeping the spec current", below). If the change is a release, raise the
   version and add the `CHANGELOG.md` entry ("Release", below).
5. Run `npm run build`, `npm test`, `npm run check-version` and `claude plugin validate .`. They
   must pass.
6. Review the diff, and check it against `CLAUDE.md` and the docs it links to. Fix what you find,
   then test again. Do steps 5 and 6 before every commit, also in the review rounds below.
7. Commit with the subject `[#n] Imperative description`.
8. Review the branch with `/codex:adversarial-review` and `/copilot:adversarial-review`, both with
   `--scope branch --base origin/main`, in rounds. In each round, fix the confirmed findings, record
   rejected ones with the reason, test, and commit. Stop when both reviewers approve, or when every
   finding left was rejected in an earlier round. If one reviewer is not set up, run this step and
   step 10 with the other one, and say so in the PR.
9. Open a PR into `main`. The bot reviewers (today Copilot and CodeRabbit) review each push.
10. Review the PR in rounds. In each round, read every review, including findings that are only in a
    review body or summary comment. Fix the confirmed findings, have Codex and Copilot review the
    fixes, test, commit and push. Answer and resolve every thread, then wait for the next reviews.
    Stop when no reviewer has findings and no thread is open, or when every finding left was
    rejected in an earlier round.
11. Squash-merge when every CI check passes.
12. Remove the worktree and the branch, and pull `main`. If the PR raised the version, publish the
    release ("Release", below).

The owner runs these steps with personal `cpcc-workflow-*` Claude Code skills. They are not in this
repo. You can follow the same steps by hand.

## Spec Kit

The repo uses [Spec Kit](https://github.com/github/spec-kit) 1.1.3 with the Claude Code
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

### Keeping the spec current

While a feature is being built, its spec folder must describe the feature as it is being built
(constitution, "Implementation-to-Spec Consistency"). Once the work has merged, the folder is
history.

When a decision, a count, the scope, the approach or the shape of a test departs from the spec, do
one sweep before you push:

1. In `research.md`, record the new decision with its date and reason. Keep the old decision as the
   rejected alternative.
2. Carry the change through the rest of the folder: a dated entry under "Clarifications" in
   `spec.md`; `plan.md` (summary, Technical Context, Constitution Check, project structure and
   phases); `data-model.md`; `contracts/`; the `tasks.md` task that did the work (add a suffixed
   task, such as `T053b`, if work was added); `checklists/`; and any file the feature added.
3. Rebuild any page that is built from the spec folder.
4. Run `/speckit-analyze` and fix what it finds.
5. Commit the spec changes with the code, in the same commit.

A change written only in a PR body or a commit message does not count.

### Setup

Install the CLI from the release tag the repo uses:

```bash
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v1.1.3
```

Use a release tag, not the main branch. A build from main is unreleased work, and its version ends
in `.dev0`.

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

1. Find the newest release on the [releases page](https://github.com/github/spec-kit/releases).
   Run `uv tool install specify-cli --force --from git+https://github.com/github/spec-kit.git@vX.Y.Z`,
   then `specify integration upgrade claude`. `uv tool upgrade` does not move a pinned tag.
   Change the version and the tag in this file.
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

A ticket is a release when it changes anything under `plugins/copilot/` or
`.claude-plugin/marketplace.json`, because Claude Code updates an installed plugin by its version.
A ticket that changes only repo files (docs, specs, tests, CI, scripts, package files, README) is
not a release. Each user-facing ticket is its own release.

Pick the level by what users see (SemVer):

- patch for a fix;
- minor for a new command, flag or behaviour;
- major for a change that breaks use.

In the PR that raises the version:

1. Run `npm run bump-version -- X.Y.Z`. `npm run check-version` must pass.
2. Add a `### X.Y.Z` entry at the top of the "Copilot plugin" section of
   `plugins/copilot/CHANGELOG.md`: a few plain bullets that say what changed for users. The summary
   lives in the repo, so it survives a move away from GitHub.
3. Run the tests and `claude plugin validate .`.
4. Do the manual run that the constitution asks for (Principle VI).

After the merge, publish a GitHub release like
[upstream's](https://github.com/openai/codex-plugin-cc/releases):

- the tag `vX.Y.Z` on the merge commit;
- the title `vX.Y.Z` (the first release, `v1.0.0`, is titled "Initial Release", as upstream's is);
- notes that are the `CHANGELOG.md` entry, followed by GitHub's generated notes.

```bash
gh release create vX.Y.Z --target <merge commit> --title "vX.Y.Z" --notes-file <entry> --generate-notes
```

The full PR list of a release comes from git, because every squash merge puts the PR title in the
commit subject: `git log --oneline v<previous>..v<version>`.
