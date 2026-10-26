---
name: workflow-branch
description: Create (or resume) the worktree and branch for a copilot-plugin-cc ticket from the latest origin/main, named <type>/<n>-<slug>, and enter it.
argument-hint: "<issue number> <feature|bugfix> <slug>"
---

# workflow: branch

First read the repo's `.claude/skills/workflow-common/REFERENCE.md`. Read it again after each summary of the conversation. Act at once; do not ask to proceed.

## Input

`$ARGUMENTS`: the issue number `<n>`, the type (`feature` or `bugfix`), and the slug. If one is
missing or breaks "Naming" in REFERENCE.md, stop and say so. Do not guess.

The branch is `<type>/<n>-<slug>`. The worktree is `$WT_ROOT/<type>-<n>-<slug>`. Start each Bash call
with the `MAIN=` and `WT_ROOT=` lines from REFERENCE.md, and run git as `git -C "$MAIN" ...`.

## Steps

1. **Check the remote.** `git -C "$MAIN" remote get-url origin` must be the remote in REFERENCE.md.
   If not, stop.
2. **Check the main checkout.** It must be on `main`, and
   `git -C "$MAIN" status --porcelain --untracked-files=no` must be empty. If not, stop and report.
   Untracked `specs/NNN-<name>/` and `.specify/bugs/NNN-<slug>/` from Spec Kit planning are expected.
3. **Fetch:** `git -C "$MAIN" fetch origin`.
4. **Does the branch exist already?** Check `git -C "$MAIN" branch --list "<branch>"`,
   `git -C "$MAIN" ls-remote --heads origin "<branch>"` and `git -C "$MAIN" worktree list`. If it
   exists, say "Resuming existing branch <branch>." Then:
   - it has a worktree: do step 7, then go to step 8;
   - it is only local: `git -C "$MAIN" worktree add "$WT_ROOT/<type>-<n>-<slug>" "<branch>"`, then
     go to step 6;
   - it is only on the remote:
     `git -C "$MAIN" worktree add --track -b "<branch>" "$WT_ROOT/<type>-<n>-<slug>" "origin/<branch>"`,
     then go to step 6.
5. **Create the worktree** from the latest `origin/main`:

   ```bash
   mkdir -p "$WT_ROOT"
   git -C "$MAIN" worktree add --no-track -b "<branch>" "$WT_ROOT/<type>-<n>-<slug>" origin/main
   ```

   `--no-track` stops the branch from tracking `origin/main`. `workflow-pr` sets the upstream on
   the first push.
6. **Copy `.env`** if the main checkout has one and the worktree does not.
7. **Move Spec Kit files** (only when this ticket's Spec Kit planning ran in the main checkout and
   its files are still untracked there; skip this step when planning runs in the worktree). Move `specs/NNN-<name>/` and
   `.specify/feature.json`, or `.specify/bugs/NNN-<slug>/`, from `$MAIN` to the same paths in the
   worktree. The path is the one in the issue body's `Spec:` or `Bug notes:` line, which
   `workflow-ticket` added. Move only an untracked folder (`git -C "$MAIN" ls-files <folder>`
   prints nothing). Create the parent folder
   in the worktree first, and stop if the destination exists. After a move, check that
   `git -C "$MAIN" status --porcelain` is clean.
8. **Install the dev dependencies** when the worktree has `package-lock.json`: run the Install
   command from "Commands" in REFERENCE.md with `--prefix "<worktree path>"`, the path that
   `git -C "$MAIN" worktree list --porcelain` prints for the branch. If it fails, stop and report
   its error. The worktree stays, and a retry runs this step again.
9. **Enter the worktree** (see "Worktrees" in REFERENCE.md).
10. **Report** the branch, the worktree path, the base commit
    (`git -C "$MAIN" log -1 --oneline origin/main`), whether `.env` and Spec Kit files were moved,
    and whether the dev dependencies were installed.

Do not push. `workflow-pr` pushes.

## Cleanup

Run this after the PR is merged, or to drop a ticket. Run `ExitWorktree` (`keep`) first if the
session is inside the worktree.

```bash
MAIN="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
WT_ROOT="$MAIN/.claude/worktrees"
git -C "$MAIN" worktree remove "$WT_ROOT/<type>-<n>-<slug>"
git -C "$MAIN" branch -D "<type>/<n>-<slug>"   # -D, because a squash merge looks unmerged to -d
git -C "$MAIN" fetch --prune
```

- If the ticket has work that was never pushed, ask before you remove anything.
- `git worktree remove` refuses when the worktree has changes. Do not add `--force` unless the user
  says so.
- On Windows the folder can stay behind, empty and locked by VS Code. The worktree is still removed
  from git. Go on, and tell the user to delete the folder later.
