# workflow: shared reference

The `workflow-*` skills read this file first. It holds the repo facts and the rules they share.
Each fact lives here once. The step skills link to it and do not repeat it.

This is a solo project. There are no team steps: no Slack, no QA handoff, no colleague review, no Flow
labels.

## Repo

| Fact | Value |
| --- | --- |
| Repo | `tmathura/copilot-plugin-cc` on GitHub |
| Remote | `origin` = `https://github.com/tmathura/copilot-plugin-cc.git` |
| Default branch | `main` |
| Merge style | squash: `gh pr merge --squash --delete-branch`. The repo settings and the ruleset allow no other merge method, and GitHub deletes the head branch after a merge. |
| PR template | none; use "PR body" below |
| Branch rules | Changes to `main` go through a PR. No force-push to `main`, and no deleting it. 0 approvals needed. Bot reviewers (see "PR review loop") review each push. A PR merges only when the CI jobs `CI (ubuntu-latest)`, `CI (macos-latest)` and `CI (windows-latest)` passed, CodeQL found no error alert and no security alert of high or critical level, every review thread is resolved, and its branch has the latest `main` (ruleset "Protect main + Copilot review"). |
| CI | `.github/workflows/pull-request-ci.yml`, on each PR and on each push to `main`, so each merge commit gets its own run |
| Security | CodeQL default setup (no workflow file) scans each PR, each push to `main`, and `main` once a week. Dependabot alerts and security updates are on, and `.github/dependabot.yml` asks for npm and GitHub Actions updates once a week. Private vulnerability reporting is on (`SECURITY.md`). |
| Features | Wiki and Projects are off. Issues are on, with the bug form `.github/ISSUE_TEMPLATE/bug_report.yml`. Blank issues stay allowed, because `workflow-ticket` makes issues from its own body. |
| Labels | `bug`, `enhancement`, `documentation`, `duplicate`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`, `accessibility`. When to use each: "Tickets" in the repo's `docs/development.md`. |

## Shell and paths

The skills must work the same on macOS, Linux and Windows.

- Run every command with the Bash tool. That is bash on macOS and Linux, and Git Bash on Windows.
- Do not use PowerShell, `cmd`, `.exe` paths, drive letters or fixed home folders.
- Use only `git`, `gh`, `node`, `npm`, `claude`, `uv`, `specify`, POSIX `sh` builtins (such as
  `cd` and `exec`), and the standard POSIX tools that the steps use, such as `mkdir`, `mv`, `ls`,
  `sort`, `tail`, `grep`, `awk`, `sed` and `sleep`.
- Do not pass `-R` with a different repo to `gh`.
- Run commands from the root of the current checkout (main checkout or worktree,
  `git rev-parse --show-toplevel`). Paths such as `.claude/skills/...` are relative to it.
- Never put generated text (titles, focus text, bodies, findings) inside double quotes or a heredoc
  in a shell command. Backticks and `$(...)` in it would run, and a line equal to the heredoc end
  word would cut it. Write long text to a scratchpad file with the file tool and pass the file
  (`--body-file`, `git commit -F`, `-F body=@<file>`, `--prompt-file`). Put a short one-line text in
  single quotes, and write each `'` in it as `'\''`.

Tools that must be on the PATH:

| Tool | Notes |
| --- | --- |
| `git` | 2.31 or later |
| `gh` | 2.48 or later (the review poll uses `gh api --slurp`). `gh auth status` shows a login, and `gh api repos/tmathura/copilot-plugin-cc --jq .permissions.push` prints `true` |
| `node` | Codex, Copilot and the review poll use it |
| `specify` | only for Spec Kit |
| `uv` | Spec Kit setup, and `spec-review-page` (its build command is in the skill's Step 4) |

If `command -v <tool>` prints nothing, stop and tell the user what to install. If a tool was just
installed and is still not found, ask the user to restart Claude Code. The shell can be older than the
PATH change.

Shell variables do not carry over between Bash calls. Start each call that needs a path with these
two lines. They work from the main checkout and from any worktree:

```bash
MAIN="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"   # main checkout
WT_ROOT="$MAIN/.claude/worktrees"                                                    # worktree folder
```

## Naming

| Thing | Format | Example |
| --- | --- | --- |
| Ticket id | `#<n>`, a GitHub issue | `#12` |
| Branch | `<type>/<n>-<slug>`, lowercase. The type is `bugfix` if the issue has the `bug` label, otherwise `feature`. | `feature/12-copilot-review-polling` |
| Slug | 3 to 5 words from the issue title, kebab-case, ASCII only | `copilot-review-polling` |
| Worktree folder | `$WT_ROOT/<type>-<n>-<slug>` | `.claude/worktrees/feature-12-copilot-review-polling` |
| Planning folder | `specs/NNN-<name>/` or `.specify/bugs/NNN-<slug>/`. `NNN` is the issue number padded to 3 digits ("Folder names" in the repo's `docs/development.md`). | `.specify/bugs/016-quoted-untracked-file-names/` |
| Commit subject | `[#<n>] Imperative description`, 72 characters at most, no full stop at the end | `[#12] Poll for the Copilot review` |
| Commit trailer | a blank line, then the `Co-Authored-By:` line that Claude Code gives for this session. Leave it out if there is none. Do not write a model name from memory. | |
| PR title | the commit subject format, for the whole change | `[#12] Poll for the Copilot review` |

## Worktrees

- Each ticket gets one worktree under `$WT_ROOT`, inside the main checkout. Claude Code enters a
  worktree there without asking; it always asks for a worktree outside `.claude/worktrees/`.
- The main checkout stays on `main`. Do not edit it for a ticket.
- If `.env` exists in the main checkout, copy it into each new worktree. Copy nothing else.
- Enter a worktree with `EnterWorktree`. Set `path` exactly as `git worktree list --porcelain` prints
  it after `worktree `. That form works on every OS (on Windows `C:/...`, not `/c/...`).
- If the session is in another worktree, call `ExitWorktree` with `action: "keep"` first.
- `ExitWorktree` does not remove a worktree that was entered by `path`. Remove it with
  `git worktree remove` from the main checkout.

## Commands

| Purpose | Command |
| --- | --- |
| Install | `npm ci --include=dev` (the dev dependencies that the build needs, such as `tsc`; `--include=dev` keeps them when `NODE_ENV=production` is set; CI runs `npm ci` too) |
| Build | `npm run build` (the `tsc` type check; CI runs it too) |
| Format | none configured yet |
| Test | `npm test` and `npm run check-version` |
| Validate | `claude plugin validate .` (skip with a note if `claude` is not on the PATH) |

Run them in this order, so the install comes first, each time, when `package-lock.json` exists. It
runs with no check for an existing `node_modules/`, because such a check can be wrong (a partial
install, a lockfile that a merge changed), and it takes about a second. This also covers a
worktree that `workflow-manual` Resume enters without `workflow-branch`. If the install fails, run
none of the other commands, and handle it as any failed command (`workflow-manual` Step 5).

When the repo gets tooling, add the commands here. Do not guess them in the step skills.

## Spec Kit

- Use Spec Kit only if `$MAIN/.specify/` exists and `command -v specify` finds the CLI.
- The order is `/speckit-specify`, then `/speckit-clarify` if the spec has open questions, then
  `/speckit-plan`, `/speckit-tasks` and `/speckit-analyze`.
- Specs go in `specs/NNN-<name>/` (see "Naming"). `.specify/feature.json` points to the current spec. It is per
  checkout and gitignored.
- Spec Kit does not create branches. `workflow-branch` does.
- `/speckit-specify`, `/speckit-plan` and `/speckit-tasks` rewrite their files and lose earlier
  decisions. Make corrections by hand, then run `/speckit-analyze` again.
- Setup and upgrade steps are in the repo: `docs/development.md`, or the README until that file exists.

### Planning mode

The repo's `docs/development.md` ("Ticket workflow", step 1) holds the rule. "Touches the plugin" is
the file test in "Is this ticket a release?" below.

| The change | Mode |
| --- | --- |
| Touches the plugin and fixes a defect, also an upstream bug-fix port | Spec Kit bug triage |
| Touches the plugin, anything else (behaviour, refactor, prompt or skill text, an upstream feature port) | Spec Kit spec flow |
| Does not touch the plugin (docs outside it, tests only, tooling, CI, Spec Kit, the workflow) | Claude plan mode |

- Decide from the issue text and the files the plan will change. If unclear, ask.
- A plugin change never uses plan mode. For it, the planning-mode question chooses only between
  bug triage and the spec flow.
- Give the issue its type label ("Tickets" in the repo's `docs/development.md`) before the branch is made.
- **Folder line:** the issue body ends with `Spec: specs/NNN-<name>/` or
  `Bug notes: .specify/bugs/NNN-<slug>/`. When you plan in Step 1, `workflow-ticket` adds it.
  When you plan in the worktree for an issue that already exists, add it yourself: append it to the
  body from `gh issue view <n> -R tmathura/copilot-plugin-cc --json body --jq .body` in a scratchpad
  file, then `gh issue edit <n> -R tmathura/copilot-plugin-cc --body-file <file>`.
- On resume, plugin work with no `.specify/bugs/NNN-<slug>/` or `specs/NNN-<name>/` in the branch: stop
  and ask. A plan-mode ticket that grows into plugin files: stop and ask.
- **Spec flow:** pass the folder: `/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/NNN-<name>
  <description>` when the issue exists, or `specs/<name>` in Step 1, before the issue exists
  (`workflow-ticket` adds the number). In Step 1, first check that no untracked
  `$MAIN/specs/<name>/` exists. Then run
  `/speckit-clarify` if needed, `/speckit-plan`, `/speckit-tasks` and `/speckit-analyze`. The plan
  for the review loop is `spec.md`, `plan.md` and `tasks.md`. In a worktree, check that
  `.specify/feature.json` exists after specify.

### Bug triage

The repo's Spec Kit `bug` extension gives `/speckit-bug-assess`, `/speckit-bug-fix` and
`/speckit-bug-test`. Use them only when `$MAIN/.claude/skills/speckit-bug-assess/` exists, and run
fix and test only for a ticket that used bug triage.

- **Order:** assess in Step 1 (main checkout) or at the start of Step 4 (worktree, for a bug issue
  that already exists), then fix in Step 4, then test in Step 5. Notes go in
  `.specify/bugs/NNN-<slug>/` and are committed with the fix. They do not count toward the 3-file limit.
- **Slug:** `NNN-<slug>` when the issue exists; in Step 1, before the issue exists, `<slug>` alone
  (`workflow-ticket` adds the number and the `Bug notes:` line). Apart from that number, keep
  the slug for the whole ticket; do not rename it to the branch slug. Before a Step 1 assess, check
  that no untracked folder in `$MAIN/.specify/bugs/` has it. Pass it as `slug=<slug>`. The `Slug:`
  line in the assess output must equal it; if not, stop.
- **Input:** pull `main` before assess in the main checkout. For an issue, pass the text from
  `gh issue view <n>`, not the URL. Before each commit of the bug folder, check that it holds no
  token, password or signed URL (constitution Principle IV), and remove any you find.
- **Results:**
  - assess verdict `invalid`, or no `assessment.md` written: stop and ask;
  - assess verdict `likely valid, needs reproduction` with open `[NEEDS CLARIFICATION]` items: stop
    and ask before the fix;
  - fix status `partial` or `not-applied`, or `fix.md` recommends a new assessment: stop and ask, and
    do not run test;
  - test result `failed`, or `partial` with any failed check: a Step 5 failure;
  - test result `partial` only because a check was skipped or not run: say why in the PR body.
- **Constitution Check:** write it by hand as its own section at the end of `assessment.md`, before
  the first fix (also for an `invalid` port).
- **Upstream port:**
  - Input to assess is plain text, no URL: the upstream commit SHA, the pasted upstream diff, and
    the upstream-to-local file map from `UPSTREAM.md`. The proposed fix must be the upstream change.
  - Verdict `invalid` (the bug does not apply): do not run fix or test. Step 7 reviews
    `assessment.md` only. The PR holds `assessment.md` and the `UPSTREAM.md` row set to `skipped`
    with the reason, and no `review.html` while the verdict is `invalid` ("Spec review page"). Not
    a release.
  - Otherwise the PR sets the row to `ported`. Differences from upstream go, with their reason, in
    the README section "Differences from the Codex plugin". The PR lists the upstream files and
    commit, and says they were read line by line.
- **Edits:** review-loop changes to `assessment.md` are made by hand, before the first fix. Never run
  assess again over an existing `assessment.md`, and never run fix again when `fix.md` exists (also on
  resume). After a later fix (a review round), add a dated entry under "Deviations from Assessment"
  in `fix.md`, run test again, and confirm the overwrite of `test.md`.

## Commit and push rules

- Starting `workflow-manual` counts as permission for every commit, push and PR it makes. It does
  **not** give permission to merge into `main`. Merge only after the user answers the Step 9 question.
  It does not give permission to publish a release either. Publish only after the user answers the
  Step 9 release question. The one exception: starting `workflow-auto` without `--ask-merge` gives
  permission to merge each PR that Step 9 finds ready, and to publish each release whose release
  run allows publishing.
- Never commit or push on `main`.
- Never `git add .` or `git add -A`. Stage files by name, or use `git add -u`.
- If a hook fails, fix the cause and make a new commit. Never use `--no-verify`. Never `--amend` after
  a failed commit.
- Never force-push unless the user asks. Commits are never amended, so plain pushes work.

## Questions to the user

- Use `AskUserQuestion` with 2 to 4 options. Put the recommended option first and add
  `(Recommended)`.
- Step skills act as soon as they are invoked. Do not add "proceed?" questions inside them.
- If a step skill fails, show the error and ask: **Retry (Recommended)** / **Skip** / **Abort**.

## Checking review findings

A finding from Codex, Copilot or a bot reviewer is a claim, not a fact. Check each one against the code.

Also check it against the behaviour before the ticket, that is, what `main` does without this
branch. Reject a finding that would change that behaviour, unless the issue asks for the change. If
that behaviour is a real problem, say so in the reason, so that it can get its own ticket. A finding
on what the issue asks for, or one that says this branch broke that behaviour, is checked as usual.

Mark each finding:

- **confirmed**: it is true, and the rule above does not reject it. Apply it without asking.
- **rejected**: it is not true, or the rule above rejects it, or "Code review round" rejects it as
  wording only. Write the reason in one line.
- **unclear**: you cannot tell. Ask: **Apply the confirmed findings, skip the unclear (Recommended)** /
  **Choose which** / **Stop the loop**.

Print the marks as a short list.

A rejected finding that comes back in a later round with the same point (by its meaning, not its
words) and the same evidence is rejected again with the earlier reason, with no new check. One with
new evidence is checked again: the text it points at changed, it names a new case, or the issue now
asks for the change. If you cannot tell, check it again.

**Spec review page.** It applies to the ticket's own planning folder, the one in the issue's `Spec:`
or `Bug notes:` line (a spec folder `specs/NNN-<name>/`, or a bug folder `.specify/bugs/NNN-<slug>/`),
when a commit changed a Markdown file in it: in a review round, any commit of the round (a Codex
and Copilot round inside a PR review loop round, step 4 there, is part of that round); otherwise
the commit itself, such as the commit of `workflow-manual` Step 6 or of a spec sweep made outside a
review round (`docs/development.md`, "Keeping the spec current"). The folder of a merged ticket is
history: leave its page alone. Once for each such round or commit, after its last commit and before
the next round or the push, with every change in the folder in a commit (so the folder is clean
and a new page's snapshot is that commit, not `-wip`), do one of these:

- **An upstream port whose `assessment.md` verdict is now `invalid`** has no page. If the folder
  has a page the skill built, `git rm` it and commit with `workflow-commit`, the description
  `Remove the spec review page` and the file list `<folder>/review.html`. Otherwise do nothing.
  Skip steps 1 and 2 below.
- **Any other folder:** if it has no `review.html`, build its first page; otherwise refresh the
  page, so that its "What moved" section shows what that round changed. Do steps 1 and 2 below.

1. Run `spec-review-page` on the folder (pass it). The build must print `missing anchors: 0`. A
   build that fails is a step skill that fails ("Questions to the user"), but ask only **Retry
   (Recommended)** / **Abort**: a skipped refresh would push a stale page, and the constitution
   asks for the page to be rebuilt in the same change.
2. Commit the page on its own: `workflow-commit` with the description `Refresh the spec review page`
   and the file list `<folder>/review.html`. This rule is the request to commit that
   `spec-review-page` Step 5 waits for.

A round that changed no Markdown in the folder leaves the page alone, so its "What moved" section
is not reset to nothing. A `review.html` without the skill's marker (its Step 1) was written by
hand: leave it alone.

## Blind plan

Before Claude's plan is shown, Codex and Copilot each write their own plan from the task alone. They
do not see Claude's plan, so they can find a simpler approach or a different root cause. Run it once
per ticket, in every planning mode.

1. Write `<scratchpad>/blind-plan-<n>.md` with the file tool. In Step 1, before the issue exists,
   use a short kebab-case name for the task in place of `<n>`. Put in it this request, then the
   issue title and body from `gh issue view <n>` (in Step 1: the task description), without the
   folder line:

   > Plan the change that the text below asks for, in the repo in the current directory. Read the
   > code and docs you need, but do not change any file. Give a short plan, as a list: the root cause
   > (only for a bug); the files to change, and what changes in each; the approach, and any simpler
   > option you see; the tests or checks that prove it.

   Put nothing from Claude's plan or reasoning in it. When the task uses files outside the repo,
   paste their text into the prompt file, because the reviewers' sandbox reads only the repo. Do
   the same in a plan review prompt file. An issue that already has a `## Plan comparison` was
   planned before: do not run the blind plan again.
2. Start each ready reviewer with `exec node "$CODEX" task --prompt-file "<file>"` (`$CODEX` and the
   Copilot script as in "Codex and Copilot review loop"; "Background calls" there), then plan while
   they run. `task` without `--write` is read-only, and it starts a fresh thread, so it cannot see
   this session. Until both calls have ended, write nothing
   in the checkout that shows Claude's plan: in the Spec Kit modes, read the code, and start the
   skill that writes the planning folder only after the calls end. A plan-mode plan lives outside
   the checkout. Install and ready checks are as in "Codex and Copilot review loop": plan with the
   ready ones, or skip this step when none is ready. A blind-plan call that fails twice only leaves
   out that reviewer's plan; a stopped call is handled as "Background calls" says. Say in the
   comparison which plan is missing and why.
3. When the plans are done, write a short comparison: where they agree, where they differ and why,
   and what Claude took from them. Claude's plan with those changes (the merged plan) is the plan
   for the review loop. A difference that needs the owner's decision is asked like an unclear
   finding ("Checking review findings").
4. The comparison goes in the issue body as a `## Plan comparison` section. In Step 1 it is part of
   the ticket draft, and `workflow-ticket` puts the folder line after it. For an issue that exists,
   edit the body as for the folder line ("Planning mode"), but put the section above the folder
   line, so the folder line stays last. There it survives a resume, and `workflow-pr` copies it into
   the PR body.

## Codex and Copilot review loop

Two reviewers, Codex and Copilot, take the same commands. Find each reviewer's newest installed
folder once per run:

```bash
ls -d ~/.claude/plugins/cache/openai-codex/codex/*/ | sort -V | tail -1        # Codex
ls -d ~/.claude/plugins/cache/tmathura-copilot/copilot/*/ | sort -V | tail -1  # Copilot
```

If a command prints nothing, that reviewer is not installed. Tell the user how to install it, and
leave it out:

- Codex: `/plugin marketplace add openai/codex-plugin-cc`, then `/plugin install codex@openai-codex`.
- Copilot: `claude plugin marketplace add tmathura/copilot-plugin-cc`, then
  `claude plugin install copilot@tmathura-copilot`.

Then call each script with the literal folder path that was printed. Inside a ticket worktree, the
worktree guard refuses `node "$VAR"` with a computed path. Below, `$CODEX` stands for
`<printed folder>scripts/codex-companion.mjs` (and Copilot's `scripts/copilot-companion.mjs`):

```bash
node "$CODEX" setup --json   # must say "ready": true; if not, tell the user to run /codex:setup (or /copilot:setup) and leave that reviewer out
node "$CODEX" adversarial-review --wait --scope working-tree '<focus text>'            # uncommitted work, Spec Kit plans
node "$CODEX" adversarial-review --wait --scope branch --base origin/main '<focus text>' # committed code
node "$CODEX" task --prompt-file "<scratchpad>/plan-review.md"                         # a plan-mode plan
```

- Each round, run both reviewers at the same time: two foreground Bash calls in one message, each
  with the longest Bash timeout (600000 ms). Give both the same scope and focus text. (The code
  review round runs them in the background, below.)
- If only one reviewer is ready, run the loop with that one. If neither is, skip the loop. (The
  code review round still runs `code-review` and the docs check, below.)
- Branch scope reads commits only. Commit first.
- A plan-mode plan is outside the repo. Write the plan and the request into the prompt file.
- The focus text names the agreed plan. It asks the reviewer to check that the work does what the
  plan says and nothing more, and to look for failure paths that have no test.
- Each round: run the reviewers, then check the findings of both (see above). Tag each finding with
  its reviewer. When both find the same thing, check it once.

The loop ends when one of these is true:

- Every reviewer that ran says `approve`.
- Every finding left was rejected in an earlier round.

Keep going without asking while every finding is confirmed and fixed. Ask only for an unclear
finding (see "Checking review findings"), or when 10 rounds have run: **One more round
(Recommended)** / **Reject the open findings, each with its reason** / **Stop**. A finding is never
left open: the constitution allows a merge only when each one is fixed or rejected with a reason.

### Background calls

The blind plan and the code review round start Codex and Copilot as background Bash calls
(`run_in_background`). Read each call's output when it ends.

In each background Bash call that may be stopped with `TaskStop`, the last command is
`exec <command>`, and nothing else in the call starts a process. Only these may come with it: the
`MAIN=` and `WT_ROOT=` lines before it, a `cd "<dir>" &&` in front of the `exec`, and an input
redirect from a file, `< "<file>"`, at its end. The command starts with a program name or with
`env`, never with `VAR=value`. For example:

```bash
exec sleep 1800
exec node "<printed folder>scripts/copilot-companion.mjs" task --prompt-file "<file>"
cd "<repo>" && exec env -u COPILOT_COMPANION_PLUGIN_DATA CLAUDE_PLUGIN_DATA="<data folder>" node "<script>" < "<file>"
```

The reason is that on Windows, `TaskStop` ends the Git Bash shell. A Git Bash tool that the shell
started, such as `sleep.exe` or `env.exe`, can stay running. Windows can then give that pid to a
process that a release run records. With `exec`, the shell becomes the program, so `TaskStop` ends
it. `exec` does not end the processes that the program started, such as a reviewer's Copilot or
Codex, or the children of `claude -p`. The rules for a possible leftover process still apply to
them.

- Start a background `exec sleep 1800` with each call (a retry too), so that you are called again
  after 30 minutes. Stop the timer with `TaskStop` when its call ends.
- A call that ended with an error, or with no plan or no verdict, runs once more.
- A call that still runs when its timer ends is stopped with `TaskStop` and does not run again,
  because its reviewer process may still run. Name it in the report as a possible leftover process.
- A reviewer whose call was stopped, or whose code review round call failed twice, is not ready for
  the rest of the ticket, and the rules for a reviewer that is not ready apply. (A blind-plan call
  that failed twice: see "Blind plan".)
- A failed call never counts as `approve`.

### Code review round

`workflow-manual` Step 7 reviews the committed branch with three reviews at once in each round:

- Codex and Copilot with `--scope branch --base origin/main`, as background calls
  (`exec node "$CODEX" adversarial-review ...`, as "Background calls" says);
- while they run, `code-review` and the docs check that Step 7 describes, on a range of commits.
  Look only at the commits made on this branch itself, not the ones that a merge brought in
  (`--first-parent`). Find the newest one that is a merge commit (it has two or more parents) or
  has the subject `[#<n>] Address review round <k>`. The command prints it as
  `<sha>|<parents>|<subject>`. If it prints nothing, the branch has no such commit:

  ```bash
  git log --first-parent --format='%H|%p|%s' origin/main..HEAD | grep -m1 -E '^[0-9a-f]+\|([0-9a-f]+( [0-9a-f]+)+\||[0-9a-f]+\|\[#<n>\] Address review round [0-9])' || true
  ```

  Then:
  - an `Address review round` commit: review only the commits since the last round, `<sha>^..HEAD`.
    Step 7 makes this commit directly on the head that the round reviewed, so `<sha>^` is that
    head. This range shows `code-review` only the commits made since the last round. It also
    works after a resume;
  - a merge commit, or nothing (the first round): review the whole branch, `origin/main...HEAD`.

The round waits for all three. A `code-review` or docs-check finding is checked like any other
finding. For the end rule above, `code-review` with the docs check counts as one more reviewer. It
says `approve` when it ran, reported, and has no finding left that is not rejected. An empty list
of findings is a report. A `code-review` run that fails, or ends with no report, never counts as
`approve`. Handle it as a step skill that fails ("Questions to the user"). When neither Codex nor
Copilot is ready, skip only their part of the round. `code-review` and the docs check still run.
The PR names Codex and Copilot as not available.

`code-review` keeps no record between rounds, and each fix gives it new text to find small points
in. So the round keeps its own record:

- **The record.** The `[#<n>] Address review round <k>` commit body gives each rejected finding
  as an entry, `rejected: <reviewer>: <finding>: <reason>`, with a blank line after it. A repeat
  that is rejected again for the same reason gets no new entry. A round that fixes nothing but has
  a new entry still commits: pass `--allow-empty` to `workflow-commit`. A round that fixes nothing
  and has no new entry makes no commit.
- **The round number** is the number of round commits on the branch plus one. A merge of
  `origin/main` does not reset it, and PR review loop commits have another subject:

  ```bash
  git rev-list --count --first-parent --grep='^\[#<n>\] Address review round [0-9]' origin/main..HEAD
  ```

- **Rejected findings reach `code-review` (from round 2 on).** At the start of each round, collect
  the `rejected:` entries from the round commits only:

  ```bash
  node .claude/skills/workflow-common/collect-rejected.mjs <n>
  ```

  The collector exits 1 and names the commit and the line when an entry is in another form; handle
  it as a step skill that fails ("Questions to the user"). Commits are never amended, so the owner
  decides how to repair the record.

  Give `code-review` the range, then this text and the whole list:
  `Earlier review rounds rejected these findings, with these reasons. Do not raise them again in
  other words; raise one only with new evidence:`. The docs check and the `code-review` run in the
  PR review loop step 5 use the same list. When PR review loop step 5 repeats within one PR
  review loop round, the list also holds the findings that it rejected earlier in that round.
  Every finding that is still reported is checked as above. In a Step 7 round, when
  `git diff --quiet <range>` succeeds, the range holds no change: skip `code-review` and the docs
  check in that round. As an exception to the rule above, they then count as `approve`.
- **Later rounds take substance only (from round 3 on).** A `code-review` or docs-check finding
  that is wording only is rejected with the reason `wording only, from round 3 on`, and a few
  words on why. Wording only means that its fix would change no fact, rule or step that a reader
  follows: points on style, plain language, length or saying a thing once, also when they cite
  `docs/conventions.md`. A finding that shows a wrong fact, text that contradicts itself or
  another rule, a step that would fail, or a breach of the constitution is never wording only. If
  you cannot tell, check it as usual. Codex and Copilot findings are not limited. Rounds 1 and 2
  take wording findings, so that the text that a fix adds is reviewed once.

## PR review loop

Bot reviewers review a PR that is not a draft. Treat every reviewer's findings the same way. Each
reviewer is one row here and one entry in `poll-reviews.mjs`; to add a reviewer, add both.

### Bot reviewers

| Reviewer | Login | Starts | Trigger it again | Findings live in |
| --- | --- | --- | --- | --- |
| Copilot | `copilot-pull-request-reviewer` | Every push. It drops a request that arrives while it still reviews an earlier push; the poll reports that as exit 4 | `gh pr edit <n> --add-reviewer "@copilot"` | Threads; "previously missed" list in the review body |
| CodeRabbit | `coderabbitai` | Pushes, until it pauses itself ("Reviews paused" in its summary comment). A rate-limited CodeRabbit (status "Review rate limited") has not reviewed the head: wait the time its summary comment gives, then trigger it again | `@coderabbitai review` as a PR comment (one review of the new commits) | Threads; "outside diff range" comments in the review body; the summary comment |

Each round:

1. **Wait for every reviewer on the current head.** Get the head SHA (`git rev-parse HEAD`) and the
   PR number. If CodeRabbit is paused, post `@coderabbitai review` first. Then wait in the background
   (`run_in_background: true`). You are called again when it ends:

   ```bash
   node .claude/skills/workflow-common/poll-reviews.mjs <head sha> <pr number> [--no-copilot]   # 60 tries, 30 s apart
   ```

   Exit 0: every reviewer is done. Exit 1: timed out; it prints which reviewer is still pending.
   Exit 2: bad arguments (it prints the usage line; the SHA must be the full 40 characters) or `gh`
   failed (it prints "gh failed"). Exit 4: Copilot dropped its request: 2 minutes after the poll
   started, the PR timeline has no `copilot_work_started` event since the request (it prints the
   request time). `--no-copilot` waits for CodeRabbit only. The poll is a Node script because the worktree guard blocks shell loops that
   call `gh`.

   - Exit 4: trigger Copilot again (table above) and poll again. A second exit 4 for the same head:
     Copilot is not available for this head. Name it in the PR body's **Review rounds** as
     "Copilot: not available (request dropped twice)" right away (`workflow-pr`), then poll again
     with `--no-copilot` until CodeRabbit is done. A new head starts with Copilot again. Exit 4 is
     not a timeout, never asks, and is counted apart from the timeout re-trigger below.
   - Never push while a reviewer is still working: a push cancels CodeRabbit's review ("Pull request
     base or head changed"). Make fixes locally and push after the poll ends. This holds between an
     exit-4 poll and the next poll too: CodeRabbit may still be reviewing.
2. **Read everything.** Read the whole body of every bot review since the last round, on any commit,
   not only the head SHA, because a body can hold findings with no thread (see the table). Read each
   reviewer's summary comment too. Then read every thread, resolved or not:

   ```bash
   gh api graphql -F owner=tmathura -F repo=copilot-plugin-cc -F n=<pr> -f query='
     query($owner:String!,$repo:String!,$n:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$n){
       reviews(last:20){ nodes{ author{login} commit{oid} state body } }
       reviewThreads(first:100){ nodes{ id isResolved isOutdated path line
         comments(first:50){ nodes{ databaseId author{login} body } } } } } } }'
   gh api repos/tmathura/copilot-plugin-cc/issues/<pr>/comments --jq '.[] | select(.user.type == "Bot")'
   ```

   A finding that lives only in a review body gets one PR comment (`gh pr comment <pr> --body-file
   "<file>"`) that says what happened to it.

3. **Check the findings** (see above). Fix the confirmed ones by hand. Run the commands from
   "Commands". If nothing was changed (every finding was rejected, or there were none), skip steps
   4 to 6: reply and resolve (step 7), update the PR body with `gh pr edit <n> --body-file "<file>"`
   (nothing to push), and check the loop's end rule below.
4. **Run a Codex and Copilot round on the fixes** with `--scope working-tree` and the findings as the focus.
   Check its findings too. If you fix any of them, run the commands from "Commands" again.
5. **Review the diff:** Read "Code review round" before this step. `code-review` on the working diff, with the list of rejected findings
   ("Code review round"), then the docs check of `workflow-manual` Step 7. Check the findings, fix the confirmed ones, run the commands from "Commands" again, and
   repeat until no confirmed finding is left. Then **commit** with `workflow-commit`. The body lists
   each finding and what happened to it.
6. **Push and rewrite the PR body** with `workflow-pr`. Before the push, build, refresh or
   remove the spec review page, where it applies ("Checking review findings").
7. **Reply to every thread and resolve it.** Say what was done, or why the finding was rejected. Write
   the reply to a file and pass it with `-F body=@<file>`, because backticks in a quoted string run as
   commands:

   ```bash
   gh api -X POST repos/tmathura/copilot-plugin-cc/pulls/<pr>/comments/<comment databaseId>/replies -F body=@"<file>"
   gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }' -F id=<thread id>
   ```

8. If you pushed, the push starts new reviews: go back to step 1.

If the poll times out (exit 1), trigger the pending reviewer again once (table above) and poll
again. If it still times out, ask: **Wait longer (Recommended)** / **Treat <reviewer> as
unavailable** / **Stop**. An unavailable reviewer counts as done for this head. Name it, as not
available, in the PR body's **Review rounds** right away (`workflow-pr`); the constitution
allows the merge only when the PR says so.

The loop ends only when every reviewer is done with the current head (the poll exits 0, the user
marked it unavailable, or a second drop marked Copilot unavailable for that head), all its reviews have been read, and one of these is true:

- No reviewer reported a new finding for that head, and no thread is open. A clean CodeRabbit review
  can be only a success status, with no review object.
- Every finding left for that head was rejected with its reason, in this round or an earlier one,
  each thread got a reply and is resolved, and nothing was pushed after that head.

Keep going without asking while every finding is confirmed and fixed, including rounds started by a
push the user asked for. Ask only for an unclear finding, or when 20 rounds have run: **One more
round (Recommended)** / **Reject the open findings, each with its reason** / **Stop**. A finding is
never left open (see the Codex and Copilot loop above).

## Release

### Is this ticket a release?

Decide in Step 4, from the files the ticket changes:

| The PR changes | Release? |
| --- | --- |
| Anything under `plugins/copilot/`, or `.claude-plugin/marketplace.json` | Yes. Claude Code updates an installed plugin by its version, so a shipped change with no new version can stay unseen by users. |
| Only files outside those: `docs/`, `specs/`, `tests/`, `.github/`, `.specify/`, `.claude/`, `scripts/`, `package.json`, `package-lock.json`, `tsconfig.*.json`, `README.md`, `CLAUDE.md`, `UPSTREAM.md`, `NOTICE`, `.gitignore`, `.gitattributes` | No. These are not part of the installed plugin. |

For a release, pick the level by what users see (SemVer, as the constitution says):

| Level | When |
| --- | --- |
| Patch `X.Y.Z+1` | A fix, or a change users do not notice in commands, flags or output |
| Minor `X.Y+1.0` | A new command, flag or behaviour that breaks nothing |
| Major `X+1.0.0` | A command, flag or output shape removed or changed in a way that breaks use |

Then, in the same PR: run `npm run bump-version -- X.Y.Z`, add the `CHANGELOG.md` entry below, and
say the level and the reason in the PR body. The version files and the `CHANGELOG.md` entry do not
count toward the 3-file limit. Each user-facing ticket is its own release; do not batch.

### Release run

The run that Principle VI asks for before a release is published. The owner or Claude does it after
the merge, on the owner's system, on the merge commit. It covers what Principle VI lists, nothing
more. Claude does it as in PR #24 ("Manual run (T083)"), with no new script.

**Where.** Only on the owner's system, which is Windows today. If `node -p process.platform` does
not print `win32`, the run is `unsure`: claim the version and write the record (Setup steps 1 and
2, but create no path), with the result `waits`, so the release waits for the owner and later runs
see it. Such a record (no paths, result `waits`) is the one record the owner may delete, so that a
run on the owner's system can claim the version.

**Safety.** Use the real `claude` and `copilot` CLIs and the logins already there. Never print or
store a token. Never print the environment (`env` or `printenv` with no command, `set -x`). The
table notes are short summaries in your own words, not raw output.

**Record.** Keep a record in `$WT_ROOT/release-run-X.Y.Z.md`. The record and the three paths below
are under `$WT_ROOT`, not in a session's scratchpad, so a new session can find them. The record is
the version's claim and its history, so it is never deleted. It holds:

- the PR and its ticket, the version and the merge commit;
- the three paths, each marked `created` once this run made it, or `existed before` when Setup
  found it there; and the throwaway repo's first commit;
- the companion session id, each job id with its pids as it starts, and when each `claude -p` call
  starts and ends;
- each step's result as it ends, and cancel messages;
- whether the table is posted;
- the cleanup state: `open`, `manual` or `closed`;
- the result, set by "Result": `failed`, `waits` or `published`;
- the fix ticket's number, for a `failed` result;
- the time of the last update.

A record is finished when it has no `hold:` line (the owner removes it), its cleanup state is
`closed`, its table is posted (a record with no paths needs none), and one of these is true:

- its result is `published`;
- its result is `failed` and it names a fix ticket. When the failed version was itself a release
  fix ("Result"), it also needs the line `checked by owner`;
- it has the line `checked by owner`. The owner adds it when nothing more is to be done, for
  example for a version the owner decides not to publish.

A record with no paths (no run happened: "Where", or a release found by Setup step 1) has the
cleanup state `closed` from the start and needs no table.

Claude never writes `checked by owner`, never sets a `manual` record to `closed`, and never sets
`published` on a record whose run it did not do: those are the owner's.

Before a run, read every record:

- This session's own record (after a summary, the summary or the `workflow-auto` report names the
  version) whose result is not set and whose cleanup state is not `manual`: wait until its
  background calls have ended, then go on with the run from the record, without running Setup
  again.
- Any record with paths (a run happened) whose table is not posted, whose PR is known, and whose run has ended (cleanup state
  `closed` or `manual`, or a last update more than 2 hours old): post its table as "Table" says,
  with unfinished steps as `unsure`. A run that may still be going posts its own.
- Any other record that is not finished, this session's own too: do not touch it otherwise. Report it to the owner
  (`workflow-auto`: "For you"; `workflow-manual`: the Step 9 report), and say whether its last
  update is less than 2 hours old: then it may be a live run in another session. `workflow-auto`
  stops before the queue. The owner first checks that the run is not live (its last update and its
  pids), then finishes it by hand: stops the leftover processes (check the name in Task Manager
  first, because pids are reused), deletes only the paths this run created (a path that was
  there before the run is resolved by hand, not deleted), posts the table, creates the fix ticket or
  publishes, and updates the record.

**Setup.**

1. Run `gh release view vX.Y.Z`:
   - The command fails for another reason than "release not found": run it once more. If it fails
     again, stop and report the version to the owner (`workflow-auto`: "For you", and it stops
     the run early). A query error is no fault in the release, so write no record and no `hold:`
     line: the next run asks again.
   - A release exists: there is nothing to run when it is not a draft, its tag points to the merge
     commit, and the record for vX.Y.Z is finished ("Record") with the result `published` or the
     line `checked by owner`. A finished `failed` record without `checked by owner` does not
     count: a failed version gets no release. Versions up to 1.0.12 (by version order) were
     released before release-run records existed: for them only the record is not needed; the
     release must still be no draft with its tag on the merge commit. In every other case, the
     release waits for the owner.
   - No release exists: claim the version by creating the record, in a way that fails when it
     exists: `mkdir -p "$WT_ROOT"`, then `(set -o noclobber; : > "$WT_ROOT/release-run-X.Y.Z.md")`. Only one run can claim a
     version. If the create fails, touch no path and no record, and report it to the owner: the
     version was claimed before (its record says how that run ended), or the file could not be
     made.

   When a release exists and waits for the owner, report it, and keep the hold for later runs:
   - no record: create one with the `noclobber` command above, with the result `waits` and no
     paths;
   - a finished record: append the line `hold: <what is wrong>` to it;
   - a record that is not finished: it already blocks later runs, so only report it.

   The owner clears the hold by completing the record by hand until it is finished, for example
   with `checked by owner`.
2. Write the record. The three paths are the release worktree `$WT_ROOT/release-X.Y.Z`, the
   throwaway repo `$WT_ROOT/release-repo-X.Y.Z` and the data folder `$WT_ROOT/release-data-X.Y.Z`.
   Check that none of them exists; any folder that exists, also an empty one, did not come from
   this run. If one exists, create nothing and run no
   cleanup: the run is `unsure`, mark that path `existed before`, set the record's state to
   `manual`, and post the table. Otherwise mark each path `created` in the record right after
   making it (steps 3 and 4).
3. `git -C "$MAIN" worktree add --detach "$WT_ROOT/release-X.Y.Z" <merge commit>`. The main
   checkout is not touched.
4. Make the throwaway repo: `git init`, one commit, one staged change and one untracked file. Write
   the first commit's SHA to the record. Make the data folder with `mkdir`.

**Commands.** Run every command in the throwaway repo, with `env -u COPILOT_COMPANION_PLUGIN_DATA`,
so nothing touches the installed plugin's jobs or gate. In a foreground call, use a subshell,
`(cd "<repo>" && <command>)`, so the shell does not stay in the throwaway repo: from there the
`MAIN=` line would find the wrong repo, and Windows cannot delete a folder that a shell is in.

- Slash commands: `env -u COPILOT_COMPANION_PLUGIN_DATA -u CLAUDE_PLUGIN_DATA claude -p --settings '{"enabledPlugins":{"copilot@tmathura-copilot":false}}' --plugin-dir "$WT_ROOT/release-X.Y.Z/plugins/copilot" '/copilot:<command> <args>'`.
  `--settings` turns off the installed plugin of the same name for this run, so the commands come
  from the merge commit. The commands carry their own `allowed-tools`.
- Steps that need several turns in one session call the companion directly, with a fixed session
  id and the data folder:
  `env -u COPILOT_COMPANION_PLUGIN_DATA CLAUDE_PLUGIN_DATA="<data folder>" COPILOT_COMPANION_SESSION_ID=<id> node "$WT_ROOT/release-X.Y.Z/plugins/copilot/scripts/copilot-companion.mjs" <command> <args>`.
  The Stop hook is `scripts/stop-review-gate-hook.mjs`, run the same way.
- Run the Stop hook and the `claude -p` reviews as background Bash calls (`run_in_background`). They
  can take longer than the 600 s limit of a foreground call. Write them in the form that
  "Background calls" gives, with `cd "<repo>" && exec <command>`. A background call's shell ends
  with its command, so it does not stay in the throwaway repo. Start a background
  `exec sleep 1800` timer with each, and stop it when its call ends. A call that still runs when its
  timer ends is stopped (`TaskStop`), and its step is `unsure`.
- Write a path that a program reads from a file (the hook input) in the form that
  `git rev-parse --show-toplevel` prints (`C:/...` on Windows), not as `/c/...`.

**Steps.**

| Step | Pass when |
| --- | --- |
| 1 `/copilot:setup` | It says ready |
| 2 `/copilot:review --wait` | A review. The repo is unchanged: `git status --porcelain`, `git stash list`, `git rev-parse HEAD`, `git ls-files -s` (the index) and `git hash-object` of each file in the working tree (also the untracked one) are the same before and after |
| 3 `/copilot:adversarial-review --wait` | A verdict. The repo is unchanged, checked as in step 2 |
| 4 A background `task --background --write` (a small change), then `status` and `result` | Before the task, pick one tracked file, write its `git hash-object` to the record, and ask the task to change exactly that file. Pass: the job completes, `result` shows its output, and that file's `git hash-object` now differs from the recorded one (Setup's own staged and untracked changes do not count). A change to another file only is `fail` |
| 5 A background task, then `cancel` while it runs | `cancel` exits 0 and the job is `cancelled`. A cancel that says the job already completed or already failed means the task ended first: run the step once more with a longer task; if it happens again, the step is `unsure`. Any other failed cancel is `fail`; write its message to the record. Its `pid` and `copilotPid` (from `status --json`, read while it ran, and written to the record) are gone: `process.kill(pid, 0)` in `node` throws with code `ESRCH`. A pid that still answers is `fail`; any other error is `unsure`. Where Copilot's sandbox refuses the shell command, cancel a running read-only task instead |
| 6 Reset the throwaway repo to its first commit (`git reset --hard <first commit>`, `git clean -fd`), so the gate sees only the planted bug. `setup --enable-review-gate`, make a change with an obvious bug, write `{"session_id": "<id>", "cwd": "<repo>", "last_assistant_message": "<what changed>"}` to a file in the scratchpad (not in the repo) with the file tool, and run the Stop hook with `< "<file>"` | The hook prints `"decision":"block"` with a reason that names the planted bug. A block for another reason is `unsure` |
| 7 Fix the bug, write a new hook input whose `last_assistant_message` describes the fix, and run the Stop hook again | The hook ran a review (a new job in `status --json`) and does not block. A block is `unsure`, because the review is the model's opinion |
| 8 `setup --disable-review-gate` | `setup --json` shows the gate off |
| 9 The CI run on the merge commit ("CI" in "Repo"). Run its commands from the main checkout, because the throwaway repo has no `origin` | Find the push run: `gh run list --workflow pull-request-ci.yml --branch main --event push --commit <merge commit> --json databaseId,status,conclusion,url` (the full 40-character SHA). If none is listed yet, wait with a background `exec sleep 30` (`run_in_background`) and look again, up to 20 times. Wait for the run with a background `exec gh run watch <run id> --exit-status`, with a background `exec sleep 1800` timer that is stopped when the watch ends. A watch that still runs when its timer ends is stopped (`TaskStop`). Then read `gh run view <run id> --json status,conclusion`, because the exit code does not say why the watch ended. `success`: pass. Any other conclusion: note the `attempt` from `gh run view <run id> --json attempt`, rerun it once with `gh run rerun <run id> --failed`, wait until `attempt` is higher (as for a missing run), then watch and read it again. After the rerun, `success` is pass and `failure` is `fail` (a red CI run). Anything else (no run, a run that did not finish, another conclusion, a `gh` error) is `unsure`. The note gives the run link |

Judge each step by facts where they exist (the exit code, `git status`, the pids, the hook's
decision), not only by the model's words. Run a step that fails on timing once more before it
counts as failed. A step is `unsure` when the run cannot start (a missing CLI, no login, setup not
ready), when a permission is denied, when the Stop hook writes a note on stderr that the gate did
not run, or when Claude cannot read the fact.

**Cleanup.** On every exit, also after a failure, before the table is posted. The one exception is
a Setup that found a path that existed before: that run created nothing, so it runs no cleanup and
does not touch the gate or any job.

1. Turn the gate off and check it with `setup --json`. A gate that `setup --json` shows on is a
   failed step. When the throwaway repo or the data folder is already gone, the gate is gone with
   it; when it cannot be checked otherwise, the run is `unsure`.
2. Stop the run's processes:
   - Cancel every job of this run that has not finished.
   - Read `status --all --json` from the data folder. It also lists the Stop hook's jobs. Do not
     cancel a `cancelled` or `failed` job again: its stored pid may belong to another program by
     now, and cancel ends it with `taskkill /T /F`. Write the pids it still names to the record.
   - A cancel that says the job already completed or failed is fine. Write the message of every
     other failed cancel to the record, as step 5 does.
   - Check every pid in the record: the job pids, and the pids that the cancel messages name. Each
     must be gone (`ESRCH`).
   - The jobs of the `claude -p` steps live in Claude Code's own data folder, which cleanup does not
     read. The record notes when each `claude -p` call starts and ends. A call that was stopped
     (`TaskStop`), that gave no result, or that has no end in the record may leave `claude`, `node`
     and `copilot` processes: treat it like a pid that still answers. The owner finds them in Task
     Manager by their start time, after the record's start.
   - If a pid still answers or cannot be read, the run is `unsure`. Keep the folders, set the
     record's state to `manual`, and stop the cleanup here. The owner ends each listed process by
     hand, after checking its name in Task Manager (pids are reused). Then the owner deletes the
     paths and sets the record to `closed`.
3. For the paths the record marks `created` only: `git -C "$MAIN" worktree remove --force
   "$WT_ROOT/release-X.Y.Z"` (no `worktree prune`: it acts on every worktree of the repo), and
   delete the throwaway repo and the data folder. A worktree still in `git worktree list`, or a
   folder that is not empty, makes the run `unsure`: write what is left to the record, which stays
   `open`, and the owner removes it. An empty folder that the OS locks is only reported.
4. When nothing is left but such empty folders, set the record to `closed`.

**Table.** The table (step, `pass` / `fail` / `unsure`, a short note) is a comment on the merged PR
whose first line is `Release run vX.Y.Z`. Before posting, look for a comment by the owner's login
that starts with that line, in all pages:
`gh api --paginate repos/tmathura/copilot-plugin-cc/issues/<pr>/comments --jq '.[] | select(.user.login == "<owner login>" and ((.body | split("\n")[0] | rtrimstr("\r")) == "Release run vX.Y.Z")) | .id'`
(the whole first line must match, so `v1.2.3` does not find `v1.2.30`)
(the `id` is the number the edit needs). If there are several, use the newest (the last id). If
there is one, edit it
(`gh api -X PATCH repos/tmathura/copilot-plugin-cc/issues/comments/<id> -F body=@<file>`);
otherwise post it with `gh pr comment <pr> --body-file <file>`. Then mark it posted in the record.
If the post fails, or the comment cannot be found, keep the table in the record ("Result" says
what follows).

**Result.** Write the result to the record: `failed` for a failed step (step 9 failing is a red CI
run on the merge commit), `published` once the release counts as published, and `waits` for every
other outcome.

- The table is not on the PR (the post failed): do not publish. The release waits for the owner,
  who finds the table in the record and posts it.
- Every step passed, the cleanup state is `closed`, and the table is on the PR: the run allows
  publishing. (Cleanup that is not `closed` makes the run `unsure`.) Before publishing, run
  `git -C "$MAIN" ls-remote origin "refs/tags/vX.Y.Z" "refs/tags/vX.Y.Z^{}"` (full ref names, so a
  tag such as `release/vX.Y.Z` does not match; the main checkout, because the throwaway repo has
  no `origin`). If the command fails, do not publish: the release waits for the owner. Empty output from a command that worked means there is no tag. A tag
  that exists must point to the merge commit; if not, do not publish, never move the tag, and the
  release waits for the owner.
- A step failed: do not publish. The fix is a new ticket and a new patch release (Principle VI).
  Write `fix ticket: creating` to the record, then create that ticket with `workflow-ticket`. The
  draft is approved by this rule, so pass it as approved: the `bug` type label (plus `question` in
  the case at the end of this item); the title
  `Fix release run step <n> of vX.Y.Z`; the four sections of "Tickets" in `docs/development.md`,
  filled from the run table (Problem: the failed step and what it showed); the line
  `Release fix: vX.Y.Z, step <n>` (`step 9` for a red CI run); and a note that its `CHANGELOG.md`
  entry must also say what vX.Y.Z changed ("Release" in `docs/development.md`). Write its number
  to the record. If it cannot be created, or a record
  still says `creating` with no number (a crash), the record is not finished: the owner looks for
  the ticket with
  `gh issue list --state all --author @me --search '"Release fix: vX.Y.Z" in:body'`, creates it if
  there is none, and writes its number to the record. When the PR's own ticket already has a
  `Release fix:` line (a fix that failed again, maybe because of the environment), still create the
  ticket, but add the `question` label to it: no run takes it until the owner has looked, and the
  record also needs `checked by owner` ("Record").
  This rule wins over the one for a table that is not on the PR: a failed post alone does not
  retire the version, but it does not save a version whose step failed.
- A step is `unsure`: do not publish. The release waits for the owner, who does the open steps by
  hand on the merge commit, updates the table on the PR, and publishes only when every step passed.
  If a newer version has a release by then, add `--latest=false` to `gh release create`, so the
  newer release stays the latest.
- After `gh release create`, whether it worked or failed, check `gh release view vX.Y.Z`. The
  release counts as published only when it is not a draft and its tag points to the merge commit.
  If not, it waits for the owner, with what you found. Once it counts as published, set the result
  to `published` (the owner does the same after publishing by hand).

### Publishing

A merged PR that raised the plugin version (`npm run check-version` on `main` prints a new `X.Y.Z`)
is a release. Publish it like upstream (https://github.com/openai/codex-plugin-cc/releases), with
the version's summary from `CHANGELOG.md` on top:

| Part | Value |
| --- | --- |
| Tag | `vX.Y.Z` on the merge commit on `main` |
| Title | `vX.Y.Z` (the first release, `v1.0.0`, is titled "Initial Release", as upstream's is) |
| Notes | The `### X.Y.Z` entry from `plugins/copilot/CHANGELOG.md`, then GitHub's generated notes ("What's Changed", "New Contributors", "Full Changelog") |

The PR that raises the version also adds its entry to `plugins/copilot/CHANGELOG.md`: a `### X.Y.Z`
heading at the top of the "Copilot plugin" section, with a few plain bullets that say what changed
for users. The summary lives in the repo, so it survives a move away from GitHub. The full PR list
comes from `git log --oneline v<previous>..v<version>`.

```bash
# The CHANGELOG entry for X.Y.Z, without its heading:
awk '/^### X.Y.Z/{f=1;next} /^##/{if(f)exit} f' plugins/copilot/CHANGELOG.md | sed '/^$/d' > "<scratchpad>/release-summary-X.Y.Z.md"
# Preview the generated part:
gh api repos/tmathura/copilot-plugin-cc/releases/generate-notes -f tag_name=vX.Y.Z -f target_commitish=<merge commit> --jq .body
# Publish; GitHub puts the summary above the generated notes:
gh release create vX.Y.Z --target <merge commit> --title "vX.Y.Z" --notes-file "<scratchpad>/release-summary-X.Y.Z.md" --generate-notes
```

Known issues go in tickets and the README, not in the release notes.

## PR body

```markdown
## Problem
What was wrong, with evidence (error text, issue link, failing case).

## Change
What changed and why. Name any change to a contract, schema, CLI flag or infrastructure.

## Testing
What ran locally (commands and results), and what CI covers. Say so if nothing could run.

## Plan comparison
The issue's `## Plan comparison` section, copied.

## Review rounds
Review round (`code-review`, Codex, Copilot): <n> rounds, last result <result per reviewer>. Rejected findings: <reviewer: finding: reason>.
PR review: <n> rounds, <state> (per reviewer).

Closes #<n>
```

- Leave out **Plan comparison** when the issue has none (a ticket planned before the blind plan
  existed).
- Leave out **Review rounds** until there is something to report.
- Do not add a "Generated with Claude Code" footer.
- Each push to an open PR rewrites the body so it describes the branch as it is now. Never add a
  change log to it.
