# Development

How work moves from an idea to `main`. The rules behind these steps are in the
[constitution](../.specify/memory/constitution.md).

## Ticket workflow

1. Plan. Choose how by what the change touches ("touches the plugin" is the file test in "Release",
   below):

   | The change | Plan with |
   | --- | --- |
   | Touches the plugin and fixes a defect, also a bug fix ported from upstream | Spec Kit bug triage ("Bug fixes", below) |
   | Touches the plugin, anything else: new or changed behaviour, a refactor, prompt or skill text, a feature ported from upstream | The Spec Kit spec flow ("Using it", below) |
   | Does not touch the plugin: docs outside it, tests only, tooling, CI, Spec Kit, the workflow | Claude plan mode |

   A change to the plugin always uses Spec Kit, so its reasoning is committed with the code. A plan
   made in Claude plan mode is not saved in the repo. If it is not clear which row fits, ask the
   owner. If a plan-mode ticket grows into plugin files, stop and plan it again with Spec Kit.

   The bug triage plan is `assessment.md` plus a Constitution Check that you write in it, because
   the assessment has none. Run the plan's Constitution Check. Have Codex and Copilot review the
   plan (for the spec flow: `spec.md`, `plan.md` and `tasks.md`), and apply their confirmed findings.
   Give any defect the `bug` label.
2. Open a GitHub issue from the plan. Skip this step when the issue already exists, for example an
   upstream port. Then label it before its branch is made: `bug` when it reports a defect (for a
   port, an upstream bug fix), `enhancement` otherwise. Make its branch (step 3), then plan it in the
   worktree as in step 1. If planning shows the label was wrong, fix the label and keep the branch.
3. Make a branch `<type>/<n>-<slug>` from the latest `origin/main`, in its own worktree. The type is
   `bugfix` for an issue with the `bug` label, and `feature` for all others. If Spec Kit ran in the
   main checkout, move `specs/NNN-<name>/` and `.specify/feature.json`, or
   `.specify/bugs/<slug>/`, into the worktree before its first commit. The main checkout must then
   be clean.
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
integration (`.claude/skills/speckit-*`) and bash scripts (`.specify/scripts/bash/`). It has one
extension, the bundled `bug` extension ("Bug fixes", below).

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
- Specs live in `specs/NNN-<name>/` with sequential numbers. `/speckit-specify` takes the highest
  number in `specs/` of the current checkout, plus one, so it does not see a spec in another
  worktree. Before you run it, find the numbers in use in `specs/` on `origin/main` and in every
  open worktree. Then pass a free folder: `/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/NNN-<name>
  <feature description>`. In a worktree, check that `.specify/feature.json` exists after it.
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

### Bug fixes

The `bug` extension gives three skills. Run them in this order:

1. `/speckit-bug-assess "<symptom>" slug=<slug>` finds the cause and writes
   `.specify/bugs/<slug>/assessment.md`. It changes no code. Pull `main` first, then run it in the
   main checkout, and move the folder into the worktree as for `specs/`. For a bug issue that already
   exists, you can run it in the worktree instead, with the text from `gh issue view <n>`.
2. `/speckit-bug-fix slug=<slug>` makes the fix and writes `fix.md`.
3. `/speckit-bug-test slug=<slug>` runs the checks again and writes `test.md`.

Things to know:

- Pick a slug that no other bug folder uses, here or in an open worktree. Keep it for the whole
  ticket.
- Commit the bug folder with the fix. Once the fix has merged, the folder is history.
- The assess skill quotes the report in `assessment.md` and records any URL it was given exactly as
  given. Give it the issue text, not a URL. Pasted logs can also hold secrets. Before you commit the
  folder, check that it holds no token, password or signed URL; the constitution (Principle IV)
  keeps credentials out of the repo.
- Tickets that use bug triage need no `specs/` folder and no `.specify/feature.json`.
- Write the Constitution Check by hand as its own section at the end of `assessment.md`, before the
  first fix. It is then committed with the notes.
- `assessment.md` does not change after the fix starts. If the fix departs from it, record why under
  "Deviations from Assessment" in `fix.md`, in the same commit.
- The skills ask before they overwrite a report. Do not run `/speckit-bug-fix` again when `fix.md`
  exists.

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
   then `specify integration upgrade claude` and `specify extension update bug`. `uv tool upgrade`
   does not move a pinned tag. Change the version and the tag in this file.
   A new version can change the managed files and the bug extension: read that diff. Running the
   same version again changes only the `installed_at` times.
   The repo's bug extension comes from the copy inside Spec Kit, not from the online catalogue. If
   `specify extension list` does not show the version that the new release ships, run
   `specify extension remove bug`, `specify extension add bug`, then
   `specify integration upgrade claude` again.
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

The sync itself is one ticket, planned in Claude plan mode, because `UPSTREAM.md` is not part of the
plugin. It adds the rows, marks the changes that clearly do not apply `skipped`, opens the port
tickets (rows `pending` with the ticket), and moves the checked commit.

Each port ticket is planned by the table in "Ticket workflow", step 1. Its PR changes the row to
`ported`, or to `skipped` with the reason.

- **A bug fix:** give `/speckit-bug-assess` plain text, with no URL: the upstream commit SHA, the
  upstream diff, and the map from upstream to local file names (the file table in `UPSTREAM.md`,
  for example `codex.mjs` to `copilot.mjs`). The assessment checks that the bug exists here. Its
  proposed fix is the upstream change.
- **A bug that does not apply here** (verdict `invalid`): do not run fix or test. Still write the
  Constitution Check in `assessment.md`. The PR holds only `assessment.md` and the `skipped` row.
  It is not a release.
- **A feature:** the spec names the upstream commit and files.
- A port may differ from upstream only where the constitution allows it (Principle I). List each
  difference, with its reason, in the README section "Differences from the Codex plugin". The
  "Deviations from Assessment" section in `fix.md` is only for departures from the assessment.
- The PR lists the upstream files and commit, and says that someone read them line by line
  (Principle II).

## Release

A ticket is a release when it changes anything under `plugins/copilot/` or
`.claude-plugin/marketplace.json`, because Claude Code updates an installed plugin by its version.
These files are also what "touches the plugin" means in "Ticket workflow", step 1.
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
