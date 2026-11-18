# workflow: Codex and Copilot review loop

Moved out of `REFERENCE.md`. Its "Reading these files" section says when to read this file.

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
- Each round: run the reviewers, then check the findings of both (see "Checking review findings" in `REFERENCE.md`). Tag each finding with
  its reviewer. When both find the same thing, check it once.

The loop ends when one of these is true:

- Every reviewer that ran says `approve`.
- Every finding left was rejected in an earlier round.

Keep going without asking while every finding is confirmed and fixed. Ask only for an unclear
finding (see "Checking review findings" in `REFERENCE.md`), or when 10 rounds have run: **One more round
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
  that failed twice: see "Blind plan" in `REFERENCE.md`.)
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
`approve`. Handle it as a step skill that fails ("Questions to the user" in `REFERENCE.md`). When neither Codex nor
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
  it as a step skill that fails ("Questions to the user" in `REFERENCE.md`). Commits are never amended, so the owner
  decides how to repair the record.

  Give `code-review` the range, then this text and the whole list:
  `Earlier review rounds rejected these findings, with these reasons. Do not raise them again in
  other words; raise one only with new evidence:`. The docs check and the `code-review` run in the
  PR review loop step 5 (`PR-REVIEW-LOOP.md`) use the same list. When PR review loop step 5 repeats within one PR
  review loop round, the list also holds the findings that it rejected earlier in that round.
  Every finding that is still reported is checked as "Checking review findings" in `REFERENCE.md` says. In a Step 7 round, when
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

