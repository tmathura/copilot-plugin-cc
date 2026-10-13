# cpcc workflow: shared reference

The `cpcc-workflow-*` skills read this file first. It holds the repo facts and the rules they share.
Each fact lives here once. The step skills link to it and do not repeat it.

This is a solo project. There are no team steps: no Slack, no QA handoff, no colleague review, no Flow
labels.

## Repo

| Fact | Value |
| --- | --- |
| Repo | `tmathura/copilot-plugin-cc` on GitHub |
| Remote | `origin` = `https://github.com/tmathura/copilot-plugin-cc.git` |
| Default branch | `main` |
| Merge style | squash: `gh pr merge --squash --delete-branch` |
| PR template | none; use "PR body" below |
| Branch rules | Changes to `main` go through a PR. No force-push to `main`, and no deleting it. 0 approvals needed. Bot reviewers (see "PR review loop") review each push. |
| Labels | `bug`, `enhancement`, `documentation`, `duplicate`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`, `accessibility` |

## Shell and paths

The skills must work the same on macOS, Linux and Windows.

- Run every command with the Bash tool. That is bash on macOS and Linux, and Git Bash on Windows.
- Do not use PowerShell, `cmd`, `.exe` paths, drive letters or fixed home folders.
- Use only `git`, `gh`, `node`, `npm`, `claude`, `uv`, `specify`, POSIX `sh` builtins, and the
  standard POSIX tools that the steps use, such as `mkdir`, `mv`, `ls`, `sort`, `tail`, `grep`,
  `awk` and `sed`.
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
| Build | `npm run build` (the `tsc` type check; CI runs it too) |
| Format | none configured yet |
| Test | `npm test` and `npm run check-version` |
| Validate | `claude plugin validate .` (skip with a note if `claude` is not on the PATH) |

When the repo gets tooling, add the commands here. Do not guess them in the step skills.

## Spec Kit

- Use Spec Kit only if `$MAIN/.specify/` exists and `command -v specify` finds the CLI.
- The order is `/speckit-specify`, then `/speckit-clarify` if the spec has open questions, then
  `/speckit-plan`, `/speckit-tasks` and `/speckit-analyze`.
- Specs go in `specs/NNN-<name>/`. `.specify/feature.json` points to the current spec. It is per
  checkout and gitignored.
- Spec Kit does not create branches. `cpcc-workflow-branch` does.
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
- Give any defect the `bug` label before the branch is made, so the branch is `bugfix/`.
- On resume, plugin work with no `.specify/bugs/<slug>/` or `specs/NNN-<name>/` in the branch: stop
  and ask. A plan-mode ticket that grows into plugin files: stop and ask.
- **Spec flow:** before `/speckit-specify`, list the spec numbers in use: `specs/` on `origin/main`
  (`git -C "$MAIN" ls-tree --name-only origin/main specs/`) and in every open worktree. Pass a free
  folder: `/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/NNN-<name> <description>`. Then run
  `/speckit-clarify` if needed, `/speckit-plan`, `/speckit-tasks` and `/speckit-analyze`. The plan
  for the review loop is `spec.md`, `plan.md` and `tasks.md`. In a worktree, check that
  `.specify/feature.json` exists after specify.

### Bug triage

The repo's Spec Kit `bug` extension gives `/speckit-bug-assess`, `/speckit-bug-fix` and
`/speckit-bug-test`. Use them only when `$MAIN/.claude/skills/speckit-bug-assess/` exists, and run
fix and test only for a ticket that used bug triage.

- **Order:** assess in Step 1 (main checkout) or at the start of Step 4 (worktree, for a bug issue
  that already exists), then fix in Step 4, then test in Step 5. Notes go in
  `.specify/bugs/<slug>/` and are committed with the fix. They do not count toward the 3-file limit.
- **Slug:** pick a kebab-case slug at assess time and keep it for the whole ticket. Do not rename it
  to the branch slug. Before assess, check that no folder has it: `ls "$MAIN/.specify/bugs"`,
  `git -C "$MAIN" ls-tree --name-only origin/main .specify/bugs/`, and `.specify/bugs/` in each open
  worktree. Pass it as `slug=<slug>`. The `Slug:` line in the assess output must equal it; if not,
  stop. Put `Bug notes: .specify/bugs/<slug>/` in the ticket body, so a resumed run finds it.
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
  - Verdict `invalid` (the bug does not apply): do not run fix or test. Step 6 reviews
    `assessment.md` only. The PR holds `assessment.md` and the `UPSTREAM.md` row set to `skipped`
    with the reason. Not a release.
  - Otherwise the PR sets the row to `ported`. Differences from upstream go, with their reason, in
    the README section "Differences from the Codex plugin". The PR lists the upstream files and
    commit, and says they were read line by line.
- **Edits:** review-loop changes to `assessment.md` are made by hand, before the first fix. Never run
  assess again over an existing `assessment.md`, and never run fix again when `fix.md` exists (also on
  resume). After a later fix (a review round), add a dated entry under "Deviations from Assessment"
  in `fix.md`, run test again, and confirm the overwrite of `test.md`.

## Commit and push rules

- Starting `cpcc-workflow-start` counts as permission for every commit, push and PR it makes. It does
  **not** give permission to merge into `main`. Merge only after the user answers the Step 9 question.
  It does not give permission to publish a release either. Publish only after the user answers the
  Step 9 release question.
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

A finding from Codex, Copilot or a bot reviewer is a claim, not a fact. Check each one against the code. Mark it:

- **confirmed**: it is true. Apply it without asking.
- **rejected**: it is not true. Write the reason in one line.
- **unclear**: you cannot tell. Ask: **Apply the confirmed findings, skip the unclear (Recommended)** /
  **Choose which** / **Stop the loop**.

Print the marks as a short list. Do not check a rejected finding again in a later round.

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
  with the longest Bash timeout (600000 ms). Give both the same scope and focus text.
- If only one reviewer is ready, run the loop with that one. If neither is, skip the loop.
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

## PR review loop

Bot reviewers review a PR that is not a draft. Treat every reviewer's findings the same way. Each
reviewer is one row here and one entry in `poll-reviews.mjs`; to add a reviewer, add both.

### Bot reviewers

| Reviewer | Login | Starts | Trigger it again | Findings live in |
| --- | --- | --- | --- | --- |
| Copilot | `copilot-pull-request-reviewer` | Every push | `gh pr edit <n> --add-reviewer "@copilot"` | Threads; "previously missed" list in the review body |
| CodeRabbit | `coderabbitai` | Pushes, until it pauses itself ("Reviews paused" in its summary comment) | `@coderabbitai review` as a PR comment (one review of the new commits) | Threads; "outside diff range" comments in the review body; the summary comment |

Each round:

1. **Wait for every reviewer on the current head.** Get the head SHA (`git rev-parse HEAD`) and the
   PR number. If CodeRabbit is paused, post `@coderabbitai review` first. Then wait in the background
   (`run_in_background: true`). You are called again when it ends:

   ```bash
   node .claude/skills/cpcc-workflow-common/poll-reviews.mjs <head sha> <pr number>   # 60 tries, 30 s apart
   ```

   Exit 0: every reviewer is done. Exit 1: timed out; it prints which reviewer is still pending.
   Exit 2: bad arguments (it prints the usage line; the SHA must be the full 40 characters) or `gh`
   failed (it prints "gh failed"). The poll is a Node script because the worktree guard blocks shell loops that
   call `gh`.

   - If Copilot has not started 3 minutes after the push, trigger it again (table above). Do not
     while a review of this SHA is still running.
   - Never push while a reviewer is still working: a push cancels CodeRabbit's review ("Pull request
     base or head changed"). Make fixes locally and push after the poll ends.
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
   "Commands".
4. **Run a Codex and Copilot round on the fixes** with `--scope working-tree` and the findings as the focus.
   Check its findings too. If you fix any of them, run the commands from "Commands" again.
5. **Review the diff** as in Step 6 of `cpcc-workflow-start` (`code-review`, then the docs check).
   Then **commit** with `cpcc-workflow-commit`. The body lists each finding and what happened to it.
6. **Push and rewrite the PR body** with `cpcc-workflow-pr`.
7. **Reply to every thread and resolve it.** Say what was done, or why the finding was rejected. Write
   the reply to a file and pass it with `-F body=@<file>`, because backticks in a quoted string run as
   commands:

   ```bash
   gh api -X POST repos/tmathura/copilot-plugin-cc/pulls/<pr>/comments/<comment databaseId>/replies -F body=@"<file>"
   gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }' -F id=<thread id>
   ```

8. The push starts new reviews. Go back to step 1.

If the poll times out (exit 1), trigger the pending reviewer again once (table above) and poll
again. If it still times out, ask: **Wait longer (Recommended)** / **Treat <reviewer> as
unavailable** / **Stop**. An unavailable reviewer counts as done for this head. Name it, as not
available, in the PR body's **Review rounds** right away (`cpcc-workflow-pr`); the constitution
allows the merge only when the PR says so.

The loop ends only when every reviewer is done with the current head (the poll exits 0, or the user
marked it unavailable), all its reviews have been read, and one of these is true:

- No reviewer reported a new finding for that head, and no thread is open. A clean CodeRabbit review
  can be only a success status, with no review object.
- Every open finding was rejected in an earlier round.

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
| Only files outside those: `docs/`, `specs/`, `tests/`, `.github/`, `.specify/`, `.claude/`, `scripts/`, `package.json`, `package-lock.json`, `tsconfig.*.json`, `README.md`, `CLAUDE.md`, `UPSTREAM.md`, `NOTICE`, `.gitignore` | No. These are not part of the installed plugin. |

For a release, pick the level by what users see (SemVer, as the constitution says):

| Level | When |
| --- | --- |
| Patch `X.Y.Z+1` | A fix, or a change users do not notice in commands, flags or output |
| Minor `X.Y+1.0` | A new command, flag or behaviour that breaks nothing |
| Major `X+1.0.0` | A command, flag or output shape removed or changed in a way that breaks use |

Then, in the same PR: run `npm run bump-version -- X.Y.Z`, add the `CHANGELOG.md` entry below, and
say the level and the reason in the PR body. The version files and the `CHANGELOG.md` entry do not
count toward the 3-file limit. Each user-facing ticket is its own release; do not batch.

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

## Review rounds
Codex and Copilot: <n> rounds, last result <result per reviewer>. Rejected findings: <reviewer: finding: reason>.
PR review: <n> rounds, <state> (per reviewer).

Closes #<n>
```

- Leave out **Review rounds** until there is something to report.
- Do not add a "Generated with Claude Code" footer.
- Each push to an open PR rewrites the body so it describes the branch as it is now. Never add a
  change log to it.
