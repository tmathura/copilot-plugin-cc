# workflow: release run and publishing

Moved out of the "Release" section of `REFERENCE.md`; its "Reading these files" says when to read
this file. "Is this ticket a release?" stays there. Read at: `workflow-manual` Step 4 of a release
ticket (the `CHANGELOG.md` entry), Step 9 point 7 of a release, and Step 9 point 8 when a release
run record exists; `workflow-auto` wherever it handles the release run records, and after each
merge (step 9, the CI run).

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
  example for a version the owner decides not to publish;
- it has no paths, its result is `waits`, and the "A release exists" case of Setup step 1 finds
  nothing to run for its version, because the run table is the proof ("Table as proof" there).
  Use the PR and the merge commit that the record names; a record that does not name them is
  not finished. Check this each time you read the record, and leave the record as it is. If a
  `gh` call fails twice (`gh release view`: for another reason than "release not found"), the
  record counts as not finished for this read. Report the query error as the cause, not a task
  for the owner.

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
     commit, and one of these is true:
     - the record for vX.Y.Z is finished ("Record") with the result `published` or the line
       `checked by owner`. A finished `failed` record without `checked by owner` does not count:
       a failed version gets no release;
     - the run table on the PR is the proof ("Table as proof", below);
     - the version is 1.0.12 or lower (by version order). Those versions were released before
       release-run records existed, so they need no record.

     In every other case, the release waits for the owner.
   - No release exists: claim the version by creating the record, in a way that fails when it
     exists: `mkdir -p "$WT_ROOT"`, then `(set -o noclobber; : > "$WT_ROOT/release-run-X.Y.Z.md")`. Only one run can claim a
     version. If the create fails, touch no path and no record, and report it to the owner: the
     version was claimed before (its record says how that run ended), or the file could not be
     made.

   When a release exists and waits for the owner, report it, and keep the hold for later runs:
   - no record: create one with the `noclobber` command above. It names the PR and the merge
     commit, and has the result `waits` and no paths;
   - a finished record: append the line `hold: <what is wrong>` to it;
   - a record that is not finished: it already blocks later runs, so only report it.

   The owner clears the hold by completing the record by hand until it is finished, for example
   with `checked by owner`. "Record" also says when a record with no paths is finished with no
   change by the owner.

   **Table as proof.** The record is not in git, so a checkout that did not do the run has no
   record of it. The run table on the merged PR is then the proof that the run passed. This
   applies only when no run happened in this checkout: it has no record for vX.Y.Z, or it has one
   with no paths, the result `waits` and no `hold:` line. A record of a run that happened here
   keeps its meaning.

   Find the comment with the query in "Table" (the owner's login, the whole first line
   `Release run vX.Y.Z`; the newest one, if there are several). Read its body with
   `gh api repos/tmathura/copilot-plugin-cc/issues/comments/<id> --jq .body`. The table is the
   proof when it has one row for each step in "Steps", and the result of each row is `pass`. A
   `fail` or `unsure` row, a missing step, a table that cannot be read, or no such comment is no
   proof: the release waits for the owner. If a `gh` call fails, run it once more. If it fails
   again, stop and report it, as for `gh release view` above: write no record and no `hold:` line.
   That stop is for Setup. When "Record" makes this check for a record it reads, a `gh` call that
   fails twice has the result that "Record" gives instead.

   When the table is the proof, write no record, change no record and add no `hold:` line.
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
  "Background calls" in `REVIEW-LOOP.md` gives, with `cd "<repo>" && exec <command>`. A background call's shell ends
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
| 9 The CI run on the merge commit ("CI" in "Repo" in `REFERENCE.md`). Run its commands from the main checkout, because the throwaway repo has no `origin` | Find the push run: `gh run list --workflow pull-request-ci.yml --branch main --event push --commit <merge commit> --json databaseId,status,conclusion,url` (the full 40-character SHA). If none is listed yet, wait with a background `exec sleep 30` (`run_in_background`) and look again, up to 20 times. Wait for the run with a background `exec gh run watch <run id> --exit-status`, with a background `exec sleep 1800` timer that is stopped when the watch ends. A watch that still runs when its timer ends is stopped (`TaskStop`). Then read `gh run view <run id> --json status,conclusion`, because the exit code does not say why the watch ended. `success`: pass. Any other conclusion: note the `attempt` from `gh run view <run id> --json attempt`, rerun it once with `gh run rerun <run id> --failed`, wait until `attempt` is higher (as for a missing run), then watch and read it again. After the rerun, `success` is pass and `failure` is `fail` (a red CI run). Anything else (no run, a run that did not finish, another conclusion, a `gh` error) is `unsure`. The note gives the run link |

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

