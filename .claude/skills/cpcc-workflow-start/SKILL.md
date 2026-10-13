---
name: cpcc-workflow-start
description: Run the copilot-plugin-cc ticket workflow end to end (plan, GitHub issue, worktree branch, implement, test, review, commit, Codex and Copilot loop, PR, PR review loop, merge). Asks only for the planning mode, to approve the plan and issue, before merging the PR into main, and before publishing a version's GitHub release; everything in between runs without asking unless something needs a decision. Use to start new work or resume a ticket in copilot-plugin-cc.
argument-hint: "[issue number to resume or start from | new]"
---

# cpcc workflow: start

First read the repo's `.claude/skills/cpcc-workflow-common/REFERENCE.md`. It holds the repo facts, the names,
the commands and the loop rules. This file does not repeat them.

## When to ask the user

Always ask:

1. Which planning mode to use (Step 1, or Step 4 for an existing issue that touches the plugin).
2. To approve the plan, and to create the issue as drafted (Step 1).
3. Whether to merge the PR into `main` (Step 9). Never merge without this answer.
4. Whether to publish the GitHub release, when the PR raised the plugin version (Step 9).

Also stop and ask when:

- no ticket id was given and no task was described;
- more than 3 hand-written files must change (Step 4);
- a test failure needs a test changed, is an environment problem, or still fails after 3 fixes
  (Step 5);
- a review finding is unclear;
- a loop reaches its round limit;
- untracked files appear that this ticket did not create;
- a step skill fails.

Do everything else without asking: the branch, tests, review, commits, the Codex and Copilot loop, applying
confirmed findings, push, PR, the PR review loop, and cleanup after the merge.

At each step, print one status line, for example "Step 6: code-review found nothing; committing."

Do not end the turn between steps. Do not write "continue?" in chat. End the turn only for one of the
questions above, for a background wait (say in one line what you are waiting for), or at the end of
the run. If the user says to stop at a step, ask at that step.

## Input

`$ARGUMENTS` is a ticket id (`12` or `#12`), or empty, or `new`.

- **A ticket id with a branch:** resume it (see below).
- **A ticket id with no branch:** read the issue with `gh issue view <n>`, assign it with
  `gh issue edit <n> -R tmathura/copilot-plugin-cc --add-assignee @me`. Classify it with
  REFERENCE.md "Planning mode", and add the `bug` label to a defect. Then start at Step 2. If it
  touches the plugin, ask at the start of Step 4: **Bug triage** / **Spec flow**, with the one the
  rule picks marked (Recommended). Run that mode in the worktree with the issue text, write the
  Constitution Check, and run the Codex and Copilot loop on the plan, as in Step 1, before the code.
- **Empty or `new`:** start at Step 1. If no task was described, ask: **Describe and plan
  (Recommended)** / **Give an issue number** / **Abort**.

## Resume

1. Find the branch: `git -C "$MAIN" branch --list "feature/<n>-*" "bugfix/<n>-*"` and
   `git -C "$MAIN" worktree list --porcelain`.
2. Enter its worktree (see "Worktrees" in REFERENCE.md). If it has no worktree, invoke
   `cpcc-workflow-branch` to add one.
3. Find where the run stopped from `git status`, `git log origin/main..HEAD` and
   `gh pr view --json number,state,url,reviewDecision`. Having no PR is fine.
4. If the worktree has no `.claude/skills/cpcc-workflow-common/REFERENCE.md` (its branch was made
   before the workflow skills were in the repo), run `git merge origin/main` in it first.
5. Say in one line where you resume, for example "Resuming #12 at Step 7b: 2 commits, no PR yet."
   Then go on from that step. If the work touches the plugin and has no planning notes, stop and ask
   (REFERENCE.md "Planning mode").

## Step 0. Track the steps

Track the steps of this run with the session's todo tool, or print a checklist if it has none.

## Step 1. Plan and ticket

Ask which planning mode to use. Mark the mode that REFERENCE.md "Planning mode" picks as
(Recommended), and give the reason in one line. For a change that touches the plugin, offer only the
two Spec Kit modes.

- **Claude plan mode**: `EnterPlanMode`, read the code, write the plan, then `ExitPlanMode` for
  approval.
- **Spec Kit spec flow**: offer it only when REFERENCE.md "Spec Kit" allows it. Run the skills in
  the main checkout, as REFERENCE.md "Planning mode" says. The spec files stay untracked;
  `cpcc-workflow-branch` moves them into the worktree.
- **Spec Kit bug triage**: offer it for a bug, when REFERENCE.md "Bug triage" allows it. Pull `main`,
  check the slug, then run `/speckit-bug-assess "<symptom>" slug=<slug>` in the main checkout. Write
  a Constitution Check at the end of `assessment.md`. The approved plan is `assessment.md` with that
  check.
  The notes stay untracked; `cpcc-workflow-branch` moves them into the worktree.

Run the Codex and Copilot loop on the approved plan (REFERENCE.md). A bug triage plan goes in a
prompt file, as a plan-mode plan does. Apply confirmed findings to the plan. Correct Spec Kit files
by hand.

Draft the ticket from the plan:

```markdown
Title: <imperative, specific>

## Problem
## Expected behaviour
## Solution requirements
## Acceptance criteria
- [ ] ...
```

With bug triage, end the draft with the line `Bug notes: .specify/bugs/<slug>/`.

Suggest a label: `bug` for a defect, `enhancement` for a feature, `documentation` for docs only.

Ask: **Create as drafted (Recommended)** / **Edit first** / **Stop**. Say what the reviewers changed in the
plan. Then invoke `cpcc-workflow-ticket` with the draft and keep the issue number.

## Step 2. Branch

Work out the type and slug (see "Naming" in REFERENCE.md). Print the branch name. Invoke
`cpcc-workflow-branch` with the issue number, type and slug.

## Step 3. Read the repo context

Read the root `CLAUDE.md` in the worktree and the docs it links to. Read
`.specify/memory/constitution.md` if it exists. If there is no `CLAUDE.md`, say so in one line.

## Step 4. Implement

- Before you write code, say in a few lines which files you will change and why.
- With Spec Kit feature planning, work through `tasks.md` and tick each task when it is done.
- With bug triage, run `/speckit-bug-fix slug=<slug>`, then handle its result (REFERENCE.md "Bug
  triage"). For an upstream port with verdict `invalid`, skip fix and test, and update the
  `UPSTREAM.md` row instead.
- When a decision, a count, the scope, the approach or the shape of a test departs from the spec, do the sweep in
  the repo's `docs/development.md` ("Keeping the spec current") before you commit. Spec files that
  change this way do not count toward the 3-file limit below.
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

With bug triage, then run `/speckit-bug-test slug=<slug>` and handle its result (REFERENCE.md "Bug
triage").

If something fails, decide which kind of failure it is **before you touch a test**:

- **The code is wrong:** fix it, go back to Step 4, and test again. Ask after 3 failed attempts.
- **The test is wrong:** stop and ask before you change it.
- **The environment is wrong** (tools, PATH, network, auth): stop and ask.

Never hide a timing problem with a sleep or a retry in a test.

## Step 6. Review before commit

1. Invoke the `code-review` skill on the working diff.
2. Check the diff against `CLAUDE.md` and the docs it links to. With Spec Kit feature planning, also
   check it against `spec.md` and `plan.md`. With bug triage, check it against `assessment.md` and
   the "Deviations from Assessment" in `fix.md` (only `assessment.md` for an `invalid` port).
3. Report the checks that ran and the findings, with `path:lines`, or "No deviations found".
4. Check the findings (REFERENCE.md). Fix the confirmed ones, then repeat Steps 4 and 5.

## Step 7. Commit

Invoke `cpcc-workflow-commit` with a one-line description of the diff and the list of files this
ticket changed. With bug triage, the list includes `.specify/bugs/<slug>/`.

## Step 7b. Codex and Copilot loop on the code

Run the Codex and Copilot loop (REFERENCE.md) with branch scope and the plan in the focus text. After each round,
run Step 5 again. With bug triage, a round that changed the fix also updates `fix.md` (REFERENCE.md
"Bug triage", Edits). Commit with the description `Address Codex and Copilot review round <k>` and a body that gives
the outcome of each finding.

## Step 8. Push and PR

Invoke `cpcc-workflow-pr`. The PR body gets a short **Review rounds** section from the Step 7b commit
bodies.

## Step 8b. PR review loop

Run the PR review loop (REFERENCE.md) until it ends.

## Step 9. Merge (always ask)

The PR is ready when all of these are true:

- Both review loops ended by their own rules. Neither stopped at its round limit with real findings
  still open, unless the user chose to ship and record them.
- `gh pr checks <n>` shows every check passed, or there are no checks. Wait for running checks in the
  background with `gh pr checks <n> --watch --interval 30`.
- `gh pr view <n> --json state,isDraft,mergeable,mergeStateStatus,headRefOid` shows `OPEN`, not a
  draft, `MERGEABLE`, `CLEAN`, and a `headRefOid` equal to `git rev-parse HEAD`.
- The working tree is clean.

Report the PR URL, the rounds of each loop, any rejected findings, and whether the PR is ready. Then
ask:

- **If it is ready:** **Merge now (Recommended)** / **I'll review it myself first** / **Stop**.
- **If it is not ready:** say what is missing. Ask **Merge anyway** / **Fix first** (back to Step 4) /
  **Stop**. Mark no option as recommended. Offer **Merge anyway** only when the missing item is a
  review loop that stopped at its round limit. Never offer it when a test or a CI check fails, or
  the PR is not mergeable, because the constitution requires them to pass.

After the user's own review, ask again: **Merge now (Recommended)** / **More changes** (back to
Step 4) / **Stop**. On **Stop**, leave the PR open and keep the worktree.

To merge:

1. Run `gh pr merge <n> --squash --delete-branch`.
2. Check that `gh pr view <n> --json state` shows `MERGED`. If not, stop and report.
3. `ExitWorktree` with `action: "keep"`.
4. Run the "Cleanup" commands in `cpcc-workflow-branch`. `git branch -D` is safe only after the check
   in point 2. A squash merge makes the branch look unmerged to `git branch -d`.
5. Run `git -C "$MAIN" pull --ff-only origin main`.
6. If the PR raised the plugin version, it is a release (see "Release" in REFERENCE.md). Show the
   `CHANGELOG.md` summary and the generated notes preview, and ask: **Publish (Recommended)** /
   **Not now**. On **Publish**, run the publish command from REFERENCE.md.
7. Report the PR URL, the merge commit on `main`, the release URL if there is one, the rounds of
   each loop, any rejected findings, and the issue that `Closes #<n>` closed.
