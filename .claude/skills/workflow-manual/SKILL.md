---
name: workflow-manual
description: Run the copilot-plugin-cc ticket workflow end to end (blind plans and plan, GitHub issue, worktree branch, implement, test, commit, one review round of code-review, Codex and Copilot, PR, PR review loop, merge). Asks only for the planning mode, to approve the plan and issue, before merging the PR into main, and before publishing a version's GitHub release; everything in between runs without asking unless something needs a decision. Use to start new work or resume a ticket in copilot-plugin-cc.
argument-hint: "[issue number to resume or start from | new]"
---

# workflow: manual

First read the repo's `.claude/skills/workflow-common/REFERENCE.md`. It holds the repo facts, the names,
the commands and the loop rules. This file does not repeat them.

## When to ask the user

Always ask:

1. Which planning mode to use (Step 1, or the start of Step 4 for an existing issue).
2. To approve the plan, and to create the issue as drafted (Step 1).
3. Whether to merge the PR into `main` (Step 9). Never merge without this answer.
4. Whether to publish the GitHub release, when the PR raised the plugin version (Step 9).

Also stop and ask when:

- no ticket id was given and no task was described;
- more than 3 hand-written files must change (Step 4);
- a test failure needs a test changed, is an environment problem, or still fails after 3 fixes
  (Step 5);
- a review finding is unclear, or the blind plans differ in a way that needs a decision;
- a loop reaches its round limit;
- untracked files appear that this ticket did not create;
- a step skill fails.

Do everything else without asking: the branch, tests, review, commits, the Codex and Copilot loop, applying
confirmed findings, push, PR, the PR review loop, and cleanup after the merge.

At each step, print one status line, for example "Step 7: round 1 found nothing; opening the PR."

Do not end the turn between steps. Do not write "continue?" in chat. End the turn only for one of the
questions above, for a background wait (say in one line what you are waiting for), or at the end of
the run. If the user says to stop at a step, ask at that step.

When `workflow-auto` runs this skill, the answers in `workflow-auto` replace these questions, and
the turn does not end to ask. With `--ask-merge`, the merge and release questions are still asked.
Step 9's readiness checks and `--match-head-commit` still apply.

## Input

`$ARGUMENTS` is a ticket id (`12` or `#12`), or empty, or `new`.

- **A ticket id with a branch:** resume it (see below).
- **A ticket id with no branch:** read the issue with `gh issue view <n>`, assign it with
  `gh issue edit <n> -R tmathura/copilot-plugin-cc --add-assignee @me`. Classify it with
  REFERENCE.md "Planning mode". Before the branch, check the issue against "Tickets" in the repo's
  `docs/development.md`. If it does not match, fix it with `gh issue edit`: the title, the
  sections (keep the author's text), and exactly one type label (remove any other type label).
  If the planning in Step 4 shows that the type label is wrong, fix it then. Then start at Step 2. At the start of Step 4,
  ask which planning mode to use, with the one the rule picks marked (Recommended): **Bug triage**
  / **Spec flow** if it touches the plugin, otherwise **Claude plan mode**. Plan once, in the
  worktree, with the issue text. With Spec Kit, the folder has the issue number from the start
  (`slug=NNN-<slug>` or `SPECIFY_FEATURE_DIRECTORY=specs/NNN-<name>`), and you add its `Bug notes:` or
  `Spec:` line to the issue (REFERENCE.md "Planning mode"). Run the blind plan, write the
  Constitution Check, and run the Codex and Copilot loop on the merged plan, as in Step 1, before the
  code.
- **Empty or `new`:** start at Step 1. If no task was described, ask: **Describe and plan
  (Recommended)** / **Give an issue number** / **Abort**.

## Resume

First check the issue against "Tickets" and fix it, as for a ticket id with no branch (see "Input").
Keep the text of its scope lines and its folder line; only move them if needed, so that the folder
line is the last line and the scope lines are above it. A fix does not rename the branch or the
planning folder.

1. Find the branch: `git -C "$MAIN" branch --list "feature/<n>-*" "bugfix/<n>-*"` and
   `git -C "$MAIN" worktree list --porcelain`.
2. Enter its worktree (see "Worktrees" in REFERENCE.md). If it has no worktree, invoke
   `workflow-branch` to add one.
3. Find where the run stopped from `git status`, `git log origin/main..HEAD` and
   `gh pr view --json number,state,url,reviewDecision,isDraft`. Having no PR is fine.
4. If the worktree has no `.claude/skills/workflow-common/REFERENCE.md` (its branch was made
   before the workflow skills were in the repo under these names), bring them in before anything
   else:
   - `git status --porcelain` must be empty. If not, stop and ask.
   - Run `git fetch origin`, then `git merge origin/main`. If the merge stops on a conflict, run
     `git merge --abort`, then stop and report.
   - Check that the file now exists. If not, stop and report.
5. Say in one line where you resume, for example "Resuming #12 at Step 7: 2 commits, no PR yet."
   Then go on from that step. If the work touches the plugin and has no planning notes, stop and ask
   (REFERENCE.md "Planning mode").

## Step 0. Track the steps

Track the steps of this run with the session's todo tool, or print a checklist if it has none.

## Step 1. Plan and ticket

Ask which planning mode to use. Mark the mode that REFERENCE.md "Planning mode" picks as
(Recommended), and give the reason in one line. For a change that touches the plugin, offer only the
two Spec Kit modes.

Pull `main` in the main checkout (`git -C "$MAIN" pull --ff-only origin main`; if it fails, stop
and report). Then start the blind plan (REFERENCE.md) with the task description, and plan in the
chosen mode while it runs; REFERENCE.md says what you may write in the checkout before it ends.
Before you show the plan, write the comparison and merge what you take into the plan (Spec Kit files
by hand). Show the comparison with the plan for approval.

- **Claude plan mode**: once the blind plan has started, `EnterPlanMode`, read the code, write the
  plan, then `ExitPlanMode` for approval.
- **Spec Kit spec flow**: offer it only when REFERENCE.md "Spec Kit" allows it. Run the skills in
  the main checkout, as REFERENCE.md "Planning mode" says. The spec files stay untracked;
  `workflow-branch` moves them into the worktree.
- **Spec Kit bug triage**: offer it for a bug, when REFERENCE.md "Bug triage" allows it. Check the
  slug, then run `/speckit-bug-assess "<symptom>" slug=<slug>` in the main checkout. Write
  a Constitution Check at the end of `assessment.md`. The approved plan is `assessment.md` with that
  check.
  The notes stay untracked; `workflow-branch` moves them into the worktree.

Run the Codex and Copilot loop on the approved plan (REFERENCE.md). A bug triage plan goes in a
prompt file, as a plan-mode plan does. Apply confirmed findings to the plan. Correct Spec Kit files
by hand.

Draft the ticket from the plan: its title, body and one type label, as "Tickets" in the repo's
`docs/development.md` says, with the `## Plan comparison` section. Pass the type label to
`workflow-ticket` apart from the body, not as a line in it.

With Spec Kit, also pass the planning folder (`specs/<name>/` or `.specify/bugs/<slug>/`, still
without the issue number). `workflow-ticket` adds the number to the folder and the `Spec:` or
`Bug notes:` line to the issue.

Ask: **Create as drafted (Recommended)** / **Edit first** / **Stop**. Say what the reviewers changed in the
plan. Then invoke `workflow-ticket` with the draft and keep the issue number.

## Step 2. Branch

Work out the type and slug (see "Naming" in REFERENCE.md). Print the branch name. Invoke
`workflow-branch` with the issue number, type and slug.

## Step 3. Read the repo context

Read the root `CLAUDE.md` in the worktree and the docs it links to. Read
`.specify/memory/constitution.md` if it exists. If there is no `CLAUDE.md`, say so in one line.

## Step 4. Implement

- For an existing issue that has not been planned yet, plan it first (see "Input", a ticket id with
  no branch), and add the comparison to the issue (REFERENCE.md "Blind plan").
- Before you write code, say in a few lines which files you will change and why.
- With Spec Kit feature planning, work through `tasks.md` and tick each task when it is done.
- With bug triage, run `/speckit-bug-fix slug=NNN-<slug>`, then handle its result (REFERENCE.md "Bug
  triage"). For an upstream port with verdict `invalid`, skip fix and test, and update the
  `UPSTREAM.md` row instead.
- When a decision, a count, the scope, the approach or the shape of a test departs from the spec, do the sweep in
  the repo's `docs/development.md` ("Keeping the spec current") before you commit. Spec files that
  change this way do not count toward the 3-file limit below.
- When the scope of the ticket changes, add the dated scope line to the issue ("Tickets").
- Make one change per ticket. Do not change things nobody asked for.
- If more than 3 hand-written files must change, stop and suggest separate tickets. Generated files
  and lockfiles do not count.
- When behaviour changes, update the docs in the same change.
- Decide whether the ticket is a release ("Is this ticket a release?" in REFERENCE.md). Say in one
  line which it is, and for a release the level and why. A release ticket bumps the version and
  adds its `CHANGELOG.md` entry in this PR.

## Step 5. Test

Run the commands from "Commands" in REFERENCE.md. If none are set, say "No build, format or test
commands are configured" and go on.

With bug triage, then run `/speckit-bug-test slug=NNN-<slug>` and handle its result (REFERENCE.md "Bug
triage").

If something fails, decide which kind of failure it is **before you touch a test**:

- **The code is wrong:** fix it, go back to Step 4, and test again. Ask after 3 failed attempts.
- **The test is wrong:** stop and ask before you change it.
- **The environment is wrong** (tools, PATH, network, auth): stop and ask.

Never hide a timing problem with a sleep or a retry in a test.

## Step 6. Commit

Invoke `workflow-commit` with a one-line description of the diff and the list of files this
ticket changed. With bug triage, the list includes the Markdown files of `.specify/bugs/NNN-<slug>/`,
the path in the issue's `Bug notes:` line (by name, so a `review.html` or a leftover build file is
not swept in; the page gets its own commit).

With the spec flow or bug triage, after the commit: if the planning folder (`specs/NNN-<name>/` or
`.specify/bugs/NNN-<slug>/`) has no `review.html`, run
`spec-review-page` on it to build the first page, and commit the page as steps 2 and 3 of "Spec
review page" in REFERENCE.md ("Checking review findings") say. Otherwise refresh the page where
that rule applies. An upstream port with verdict `invalid` gets no page: its PR holds only
`assessment.md` and the `UPSTREAM.md` row (REFERENCE.md "Bug triage", Upstream port).

## Step 7. Review round

Run the code review round (REFERENCE.md) with the plan in the focus text. A resume at this step
starts a new round on the current head.

1. The docs check: check the diff against `CLAUDE.md` and the docs it links to. With Spec
   Kit feature planning, also check it against `spec.md` and `plan.md`. With bug triage, check it
   against `assessment.md` and the "Deviations from Assessment" in `fix.md` (only `assessment.md`
   for an `invalid` port).
2. Report the checks that ran and the findings, with `path:lines` and their source, or "No
   deviations found".
3. Check the findings of all three together (REFERENCE.md). Fix the confirmed ones by the rules of
   Step 4, and run Step 5 again. With bug triage, a round that changed the fix also updates
   `fix.md` (REFERENCE.md "Bug triage", Edits). Commit with `workflow-commit`, the description
   `Address review round <k>` and a body that gives the outcome of each finding, with the record
   that REFERENCE.md "Code review round" describes. A round that fixes nothing commits as that
   section says. After the round commit, refresh the spec review page where it applies
   (REFERENCE.md "Checking review findings"). Then run the next round, until the loop ends by its
   rules.

## Step 8. Push and PR

Invoke `workflow-pr`. The PR body gets a short **Review rounds** section from the Step 7 commit
bodies, and the **Plan comparison** from the issue.

A draft PR needs a check, because bot reviewers skip drafts and Step 9 needs a PR that is not a
draft. Read `isDraft` with `gh pr view <n> --json isDraft`, and the comments from all pages with
`gh api --paginate repos/tmathura/copilot-plugin-cc/issues/<n>/comments --jq '.[] | {login: .user.login, created_at, body}'`
(`gh pr view` gives only the first 100).

- Look only at the comments `workflow-auto: made draft` and `workflow-auto: resumed` that the
  owner's login posted (`gh api user --jq .login`); anyone else can type them. If the PR is
  a draft and the later of these is `made draft`, then `workflow-auto` made the draft. After the
  push, comment `workflow-auto: resumed`, then run `gh pr ready <n>`.
- Leave any other draft as it is: the owner made it. Stop before Step 8b, because bot reviewers
  skip drafts and the poll would only time out. Report that the PR is an owner's draft; the owner
  marks it ready by hand. (Under `workflow-auto`, the ticket is Not done.)
- A resume that starts after this step does this check at once.

## Step 8b. PR review loop

Run the PR review loop (REFERENCE.md) until it ends.

## Step 9. Merge (always ask, unless `workflow-auto` answers)

The PR is ready when all of these are true:

- Both review loops ended by their own rules, and every finding is fixed or rejected with its
  reason. Any reviewer marked unavailable is named as not available in the PR body.
- `gh pr checks <n>` shows every check passed, or there are no checks. Wait for running checks in the
  background with `gh pr checks <n> --watch --interval 30`.
- `gh pr view <n> --json state,isDraft,mergeable,mergeStateStatus,headRefOid` shows `OPEN`, not a
  draft, `MERGEABLE`, `CLEAN`, and a `headRefOid` equal to `git rev-parse HEAD`. Read it after the
  checks have ended: while a required check runs, the state is `BLOCKED`.
- The working tree is clean.

**Bring the branch up to date.** The ruleset on `main` ("Branch rules" in REFERENCE.md) merges a PR
only when its branch has the latest `main` and its CI passed on that code. When `mergeStateStatus`
is `BEHIND` (`main` has moved on), or `mergeable` is `CONFLICTING`, "Fix first" is:

1. `git status --porcelain` must be empty. If not, stop and ask.
2. `git fetch origin`. If it fails, stop and report.
3. `git merge --no-commit --no-ff origin/main`, so the merge stays staged for Step 5. If it
   stops on a conflict that needs a decision, run `git merge --abort`, then stop and ask. Resolve
   any other conflict and stage the result. If it says `Already up to date`, the branch has `main`
   already: read the state again. If it still shows `BEHIND` or `CONFLICTING`, stop and report.
   Otherwise skip point 4 and run the readiness checks again.
4. Step 5 on the staged merge. Stage each fix (`git add -u`, or `git add <path>` for a new file).
   Then commit with `git commit -F <file>`, with a message in the "Naming" format and the
   description `Merge origin/main` (as `workflow-commit` writes it). Git makes the merge commit even
   when the merge changes no file. Then do Steps 7, 8 and 8b on the new head: Step 7 reviews the
   merge commit with the rest of the branch. Run the readiness checks again.

Report the PR URL, the rounds of each loop, any rejected findings, and whether the PR is ready. Then
ask:

- **If it is ready:** **Merge now (Recommended)** / **I'll review it myself first** / **Stop**.
- **If it is not ready:** say what is missing. Ask **Fix first (Recommended)** (back to Step 4) /
  **Stop**. There is no "merge anyway": the constitution allows a merge only when tests and CI pass,
  the review loops have finished, and every finding is fixed or rejected with its reason.

After the user's own review, ask again: **Merge now (Recommended)** / **More changes** (back to
Step 4) / **Stop**. On **Stop**, leave the PR open and keep the worktree.

To merge:

1. Keep the `headRefOid` that the readiness check saw; the user approved that commit. Run the
   readiness checks above again. If `headRefOid` changed, or a check now fails, do not merge: report
   it, go back to the review loops for the new head (for `BEHIND`: "Bring the branch up to date"),
   and ask again.
2. Run `gh pr merge <n> --squash --delete-branch --match-head-commit <approved headRefOid>`. GitHub
   then refuses the merge if anything was pushed after the approval.
3. Whatever exit code point 2 gave, check that `gh pr view <n> --json state,mergeable,mergeStateStatus`
   shows `MERGED`. If it is `BEHIND` or `CONFLICTING`, bring the branch up to date and ask again.
   Otherwise, if it is not `MERGED`, stop and report.
4. `ExitWorktree` with `action: "keep"`.
5. Run the "Cleanup" commands in `workflow-branch`. `git branch -D` is safe only after the check
   in point 3. A squash merge makes the branch look unmerged to `git branch -d`.
6. Run `git -C "$MAIN" pull --ff-only origin main`.
7. If the PR raised the plugin version, it is a release (see "Release" in REFERENCE.md). Do the
   release run ("Release run" in REFERENCE.md) on the merge commit, without asking. Only when its
   result allows publishing, show the `CHANGELOG.md` summary and the generated notes preview, and
   ask: **Publish (Recommended)** / **Not now**. On **Publish**, run the publish command from
   REFERENCE.md. Otherwise follow "Result" in "Release run".
8. Report the PR URL, the merge commit on `main`, the release URL if there is one, and the fix
   ticket for a failed release. Report each release run record that is not finished ("Record" in
   REFERENCE.md), with what it asks of the owner. Report the rounds
   of each loop, any rejected findings, and the issue that `Closes #<n>` closed. If the defect also
   exists in codex-plugin-cc and upstream has not fixed it ("Tickets", Upstream), say so. The owner
   reports it upstream, or finds the upstream issue that already reports it. Give the owner the
   command to run with that upstream issue number:
   `gh issue comment <issue number> -R tmathura/copilot-plugin-cc --body 'Reported upstream: openai/codex-plugin-cc#<m>'` (the ticket's issue, not the PR).
