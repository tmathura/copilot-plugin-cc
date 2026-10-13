---
name: cpcc-workflow-pr
description: Push a copilot-plugin-cc ticket branch and open its PR against main with the Problem / Change / Testing body, or, if the PR is already open, push and rewrite its body to the current state.
argument-hint: "[draft]"
---

# cpcc workflow: pr

First read the repo's `.claude/skills/cpcc-workflow-common/REFERENCE.md`. Follow its "Commit and push rules".

## Checks

Stop and report if one of these fails:

1. `git remote get-url origin` is the remote in REFERENCE.md.
2. `git branch --show-current` is not `main` and matches `<type>/<n>-<slug>`. Take `<n>` from it.
3. `gh auth status` shows a login, and `gh api repos/tmathura/copilot-plugin-cc --jq .permissions.push`
   prints `true`.
4. `git status --porcelain` is empty. If not, run `cpcc-workflow-commit` first.
5. After `git fetch origin`, `git log origin/main..HEAD` shows at least one commit.

## Push

Run `git push -u origin HEAD`. If the push is rejected, stop and report. Do not rebase or force.

## Body

1. Read `git log origin/main..HEAD` (subjects and bodies), `git diff origin/main...HEAD --stat`, the
   diff, and the issue (`gh issue view <n>`).
2. Write the body to `<scratchpad>/pr-body-<n>.md` in the "PR body" shape from REFERENCE.md.

## Create or update

Look for a PR: `gh pr view --json number,state,url,isDraft`.

**No PR yet:**

```bash
gh pr create --base main --head "<branch>" \
  --title '[#<n>] <Imperative description of the whole change>' \
  --body-file "<scratchpad>/pr-body-<n>.md"
```

Add `--draft` only when `$ARGUMENTS` says `draft` or the user asked for it. Bot reviewers do not review
drafts, so tell the user the review loop starts when the PR is marked ready.

**PR already open:** `gh pr edit <number> --body-file "<scratchpad>/pr-body-<n>.md"`. Change the title
only if the scope changed.

## Output

End the reply with two lines, the PR URL and then the PR number:

```
https://github.com/tmathura/copilot-plugin-cc/pull/<number>
<number>
```
