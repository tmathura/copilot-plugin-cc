---
name: cpcc-workflow-commit
description: Commit staged changes on a copilot-plugin-cc ticket branch with the "[#n] Imperative description" subject and the Co-Authored-By trailer. Never commits on main.
argument-hint: "[imperative description] [-- commit body]"
---

# cpcc workflow: commit

First read the repo's `.claude/skills/cpcc-workflow-common/REFERENCE.md`. Follow its "Commit and push rules".

## Input

`$ARGUMENTS`: an optional one-line description. It can be followed by `--` and a commit body. A review
round, for example, passes its findings and their outcomes as the body.

## Steps

1. **Check the branch.** If `git branch --show-current` is `main` or empty, stop. Take `<n>` from the
   branch name `<type>/<n>-<slug>`. If the name does not match, stop and report.
2. **Look at the changes** with `git status` and `git diff --staged`.
3. **If nothing is staged:**
   - When `cpcc-workflow-start` passed a file list, stage those files by name
     (`git add -- <files>`). Leave any other changed or untracked files alone, and ask whether they
     belong to this ticket.
   - Otherwise ask: **Stage tracked changes with `git add -u` (Recommended)** / **Pick files** /
     **Stop**.
   - If there is nothing to commit at all, say so and stop.
4. **Write the message.**
   - Subject: `[#<n>] <Imperative description>` (see "Naming" in REFERENCE.md). If no description was
     passed, write one from the staged diff.
   - Body: the text after `--`, wrapped at 72 characters. It is optional.
   - Trailer: from "Naming" in REFERENCE.md.
5. **Ask only if you wrote the description yourself.** Show the message and ask: **Commit
   (Recommended)** / **Edit the subject** / **Stop**. A description that was passed in needs no
   question.
6. **Commit** with a heredoc, so the body and the trailer keep their line breaks:

   ```bash
   git commit -F - <<'EOF'
   [#<n>] <Imperative description>

   <optional body>

   <trailer from "Naming" in REFERENCE.md, if there is one>
   EOF
   ```

7. **Check** with `git status` and `git log -1 --oneline`. Report the hash and the subject.

Do not push. `cpcc-workflow-pr` pushes.
