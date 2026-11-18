# workflow: PR review loop

Moved out of `REFERENCE.md`; its "Reading these files" says when to read this file. Read at:
`workflow-manual` Step 8b.

## PR review loop

Bot reviewers review a PR that is not a draft. Treat every reviewer's findings the same way. Each
reviewer is one row here and one entry in `poll-reviews.mjs`; to add a reviewer, add both.

### Bot reviewers

| Reviewer | Login | Starts | Trigger it again | Findings live in |
| --- | --- | --- | --- | --- |
| Copilot | `copilot-pull-request-reviewer` | Every push. It drops a request that arrives while it still reviews an earlier push; the poll reports that as exit 4 | `gh pr edit <n> --add-reviewer "@copilot"` | Threads; "previously missed" list in the review body |
| CodeRabbit | `coderabbitai` | Pushes, until it pauses itself ("Reviews paused" in its summary comment). A rate-limited CodeRabbit (status "Review rate limited") has not reviewed the head: wait the time its summary comment gives (a background `exec sleep`, as "Background calls" in `REVIEW-LOOP.md` says; a foreground one is blocked), then post `@coderabbitai review` | `@coderabbitai review` as a PR comment (one review of the new commits) | Threads; "outside diff range" comments in the review body; the summary comment |

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

3. **Check the findings** (see "Checking review findings" in `REFERENCE.md`). Fix the confirmed ones by hand. Run the commands from
   "Commands" in `REFERENCE.md`. If nothing was changed (every finding was rejected, or there were none), skip steps
   4 to 6: reply and resolve (step 7), update the PR body with `gh pr edit <n> --body-file "<file>"`
   (nothing to push), and check the loop's end rule below.
4. **Run a Codex and Copilot round on the fixes** (`REVIEW-LOOP.md`) with `--scope working-tree` and the findings as the focus.
   Check its findings too. If you fix any of them, run the commands from "Commands" in `REFERENCE.md` again.
5. **Review the diff:** Read "Code review round" in `REVIEW-LOOP.md` before this step. `code-review` on the working diff, with the list of rejected findings
   ("Code review round"), then the docs check of `workflow-manual` Step 7. Check the findings, fix the confirmed ones, run the commands from "Commands" in `REFERENCE.md` again, and
   repeat until no confirmed finding is left. Then **commit** with `workflow-commit`. The body lists
   each finding and what happened to it.
6. **Push and rewrite the PR body** with `workflow-pr`. Before the push, build, refresh or
   remove the spec review page, where it applies ("Checking review findings" in `REFERENCE.md`).
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
  can be only a success status, or a successful `CodeRabbit` check run whose summary starts "Result:
  Success - Review completed", with no review object. A status, or a run's title or summary, that
  says "paused", "rate limit" or "limit reached" is not a review of the head.
- Every finding left for that head was rejected with its reason, in this round or an earlier one,
  each thread got a reply and is resolved, and nothing was pushed after that head.

Keep going without asking while every finding is confirmed and fixed, including rounds started by a
push the user asked for. Ask only for an unclear finding, or when 20 rounds have run: **One more
round (Recommended)** / **Reject the open findings, each with its reason** / **Stop**. A finding is
never left open (see the Codex and Copilot loop in `REVIEW-LOOP.md`).

