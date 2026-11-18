# workflow: shared reference

The `workflow-*` skills read this file first. It holds the repo facts and the rules they share.
Each fact lives here once. The step skills link to it and do not repeat it.

This is a solo project. There are no team steps: no Slack, no QA handoff, no colleague review, no Flow
labels.

## Reading these files

This file holds what every step needs. Each loop or long procedure is in its own file next to it,
in `.claude/skills/workflow-common/`:

| File | Holds | Read at |
| --- | --- | --- |
| `REVIEW-LOOP.md` | "Codex and Copilot review loop", "Background calls", "Code review round" | The start of `workflow-auto` (it finds the reviewers and runs `setup --json`); the blind plan; the plan review; `workflow-manual` Step 7; the PR review loop (the CodeRabbit wait, steps 4 and 5, the end rule); a release run ("Background calls") |
| `PR-REVIEW-LOOP.md` | "PR review loop", "Bot reviewers" | `workflow-manual` Step 8b |
| `RELEASE.md` | "Release run", "Publishing" | `workflow-manual` Step 4 of a release ticket (the `CHANGELOG.md` entry), Step 9 point 7 of a release, and Step 9 point 8 when a release run record exists; `workflow-auto` wherever it handles the release run records (its start, before each ticket, after each release run, after a summary, before the stop) and after each merge (step 9, the CI run) |
| `BUG-TRIAGE.md` | "Bug triage" | Before bug triage is offered or used: the planning mode question of a ticket that touches the plugin (`workflow-manual` Step 1, or the start of Step 4 for an issue that exists), and Steps 4, 5, 6, 7 and 8b of a bug triage ticket; `workflow-commit` when bug notes are committed; a bug check that the after-compaction hook runs again |

1. **Read once.** Read this file and each file in the table only if this session has not read it
   since the last of these events: the session start; a summary of the conversation; a pull; a
   merge of `origin/main` (also while it is still staged); entering or leaving a worktree or
   another checkout; and, for one file, an edit of that file. After such an event the files count
   as not read. Read each one again, from the checkout you now work in, when the next step needs
   it. After a summary, the after-compaction hook (`.claude/settings.json`) says which files to
   read again at once; after the other events, nothing is read at the moment of the event.
2. **Pointers.** When the instruction you are carrying out points to a section in another of
   these files, read that file first, by rule 1. A pointer inside a case (a PR review loop round,
   a bug triage ticket, a release, an `--allow-empty` round commit) is followed only when that
   case applies. A file name in the table above, or in text that only describes, is not a reason
   to read.
3. **Per-round reads.** A sentence that says to read a named section before each round, or before
   a step of a loop, is followed each time, also when rule 1 would skip the file.
4. **Fresh readers.** A reviewer prompt or a spawned session reads the files it needs fresh.

## Repo

| Fact | Value |
| --- | --- |
| Repo | `tmathura/copilot-plugin-cc` on GitHub |
| Remote | `origin` = `https://github.com/tmathura/copilot-plugin-cc.git` |
| Default branch | `main` |
| Merge style | squash: `gh pr merge --squash --delete-branch`. The repo settings and the ruleset allow no other merge method, and GitHub deletes the head branch after a merge. |
| PR template | none; use "PR body" below |
| Branch rules | Changes to `main` go through a PR. No force-push to `main`, and no deleting it. 0 approvals needed. Bot reviewers (see `PR-REVIEW-LOOP.md`) review each push. A PR merges only when the CI jobs `CI (ubuntu-latest)`, `CI (macos-latest)` and `CI (windows-latest)` passed, CodeQL found no error alert and no security alert of high or critical level, every review thread is resolved, and its branch has the latest `main` (ruleset "Protect main + Copilot review"). |
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
| Planning folder | `.specify/specs/NNN-<name>/` or `.specify/bugs/NNN-<slug>/`. `NNN` is the issue number padded to 3 digits ("Folder names" in the repo's `docs/development.md`). | `.specify/bugs/016-quoted-untracked-file-names/` |
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
- Specs go in `.specify/specs/NNN-<name>/` (see "Naming"). `.specify/feature.json` points to the current spec. It is per
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
- Before you offer or use bug triage, read `BUG-TRIAGE.md`. It also says when bug triage may be
  used.
- A plugin change never uses plan mode. For it, the planning-mode question chooses only between
  bug triage and the spec flow.
- Give the issue its type label ("Tickets" in the repo's `docs/development.md`) before the branch is made.
- **Folder line:** the issue body ends with `Spec: .specify/specs/NNN-<name>/` or
  `Bug notes: .specify/bugs/NNN-<slug>/`. When you plan in Step 1, `workflow-ticket` adds it.
  When you plan in the worktree for an issue that already exists, add it yourself: append it to the
  body from `gh issue view <n> -R tmathura/copilot-plugin-cc --json body --jq .body` in a scratchpad
  file, then `gh issue edit <n> -R tmathura/copilot-plugin-cc --body-file <file>`.
- On resume, plugin work with no `.specify/bugs/NNN-<slug>/` or `.specify/specs/NNN-<name>/` in the branch: stop
  and ask. A plan-mode ticket that grows into plugin files: stop and ask.
- **Spec flow:** pass the folder: `/speckit-specify SPECIFY_FEATURE_DIRECTORY=.specify/specs/NNN-<name>
  <description>` when the issue exists, or `.specify/specs/<name>` in Step 1, before the issue exists
  (`workflow-ticket` adds the number). In Step 1, first check that no untracked
  `$MAIN/.specify/specs/<name>/` exists. Then run
  `/speckit-clarify` if needed, `/speckit-plan`, `/speckit-tasks` and `/speckit-analyze`. The plan
  for the review loop is `spec.md`, `plan.md` and `tasks.md`. In a worktree, check that
  `.specify/feature.json` exists after specify.

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
- **rejected**: it is not true, or the rule above rejects it, or "Code review round" in `REVIEW-LOOP.md` rejects it as
  wording only. Write the reason in one line.
- **unclear**: you cannot tell. Ask: **Apply the confirmed findings, skip the unclear (Recommended)** /
  **Choose which** / **Stop the loop**.

Print the marks as a short list.

A rejected finding that comes back in a later round with the same point (by its meaning, not its
words) and the same evidence is rejected again with the earlier reason, with no new check. One with
new evidence is checked again: the text it points at changed, it names a new case, or the issue now
asks for the change. If you cannot tell, check it again.

**Spec review page.** It applies to the ticket's own planning folder, the one in the issue's `Spec:`
or `Bug notes:` line (a spec folder `.specify/specs/NNN-<name>/`, or a bug folder `.specify/bugs/NNN-<slug>/`),
when a commit changed a Markdown file in it: in a review round, any commit of the round (a Codex
and Copilot round inside a PR review loop round, step 4 in `PR-REVIEW-LOOP.md`, is part of that round); otherwise
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

1. Run `spec-review-page` on the folder in a subagent: an Agent call with `model: sonnet`. A
   subagent started without `model` runs on the main session's model, and a skill's own `model:`
   line does not apply inside a subagent, so the Agent call names the model. The prompt gives the
   folder path and says: build the page with the `spec-review-page` skill
   (`.claude/skills/spec-review-page/SKILL.md`), do not commit, and report the build's exit code
   and its line `missing anchors: <n>`; where the skill says to ask, stop and report why. Note
   `git rev-parse HEAD` before the call. The report must give exit code 0 and
   `missing anchors: 0` (the build prints the count before it writes the page), and HEAD must not
   have moved. A build that fails (also a report without these) is a step skill that fails
   ("Questions to the user"), but ask only **Retry (Recommended)** / **Abort**: a skipped refresh
   would push a stale page, and the constitution asks for the page to be rebuilt in the same
   change. Before a retry, put the page back as the noted HEAD has it
   (`git restore --source=<HEAD> -- <folder>/review.html`, or delete it when that commit has
   none), so the new build diffs from the same previous page.
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
   Copilot script as in "Codex and Copilot review loop" in `REVIEW-LOOP.md`; "Background calls" there), then plan while
   they run. `task` without `--write` is read-only, and it starts a fresh thread, so it cannot see
   this session. Until both calls have ended, write nothing
   in the checkout that shows Claude's plan: in the Spec Kit modes, read the code, and start the
   skill that writes the planning folder only after the calls end. A plan-mode plan lives outside
   the checkout. Install and ready checks are as in "Codex and Copilot review loop" in `REVIEW-LOOP.md`: plan with the
   ready ones, or skip this step when none is ready. A blind-plan call that fails twice only leaves
   out that reviewer's plan; a stopped call is handled as "Background calls" in `REVIEW-LOOP.md` says. Say in the
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

## Release

The release run and the publishing of a release are in `RELEASE.md`.

### Is this ticket a release?

Decide in Step 4, from the files the ticket changes:

| The PR changes | Release? |
| --- | --- |
| Anything under `plugins/copilot/`, or `.claude-plugin/marketplace.json` | Yes. Claude Code updates an installed plugin by its version, so a shipped change with no new version can stay unseen by users. |
| Only files outside those: `docs/`, `tests/`, `.github/`, `.specify/`, `.claude/`, `scripts/`, `package.json`, `package-lock.json`, `tsconfig.*.json`, `README.md`, `CLAUDE.md`, `UPSTREAM.md`, `NOTICE`, `.gitignore`, `.gitattributes` | No. These are not part of the installed plugin. |

For a release, pick the level by what users see (SemVer, as the constitution says):

| Level | When |
| --- | --- |
| Patch `X.Y.Z+1` | A fix, or a change users do not notice in commands, flags or output |
| Minor `X.Y+1.0` | A new command, flag or behaviour that breaks nothing |
| Major `X+1.0.0` | A command, flag or output shape removed or changed in a way that breaks use |

Then, in the same PR: run `npm run bump-version -- X.Y.Z`, add the `CHANGELOG.md` entry ("Publishing" in `RELEASE.md`), and
say the level and the reason in the PR body. The version files and the `CHANGELOG.md` entry do not
count toward the 3-file limit. Each user-facing ticket is its own release; do not batch.

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
