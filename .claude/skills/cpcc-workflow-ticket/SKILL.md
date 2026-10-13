---
name: cpcc-workflow-ticket
description: Create a GitHub issue on tmathura/copilot-plugin-cc from a drafted ticket (title + Problem / Expected behaviour / Solution requirements / Acceptance criteria) and print its number.
argument-hint: "<drafted ticket, or nothing to use the draft in the conversation>"
---

# cpcc workflow: ticket

First read the repo's `.claude/skills/cpcc-workflow-common/REFERENCE.md`. Act at once: the user already
approved the draft in `cpcc-workflow-start`.

## Input

The draft comes from `$ARGUMENTS`, or from the last approved draft in the conversation. It has a
title, the sections `## Problem`, `## Expected behaviour`, `## Solution requirements` and
`## Acceptance criteria`, and maybe suggested labels. If there is no approved draft, stop and say so.

It can also name a Spec Kit planning folder in the main checkout that has no issue number yet:
`specs/<name>/` or `.specify/bugs/<slug>/`.

Use only labels from REFERENCE.md. Do not create new ones.

## Steps

1. Write the body (everything below the title) to `<scratchpad>/issue-body.md`.
2. Create the issue. Repeat `--label` for each label, or leave it out:

   ```bash
   gh issue create -R tmathura/copilot-plugin-cc \
     --title '<title>' \
     --body-file "<scratchpad>/issue-body.md" \
     --assignee "@me" \
     --label "<label>"
   ```

3. Take the number from the URL that comes back. Print the URL and `#<n>`.
4. **If a planning folder was named,** add the issue number to it, as "Folder names" in the repo's
   `docs/development.md` says. `NNN` is `<n>` padded to 3 digits (`printf '%03d' <n>`). Start each
   Bash call with the `MAIN=` line from REFERENCE.md, and give every path from `$MAIN`.
   - If `$MAIN/<parent>/NNN-<name>` already exists from an earlier run of this step for `#<n>`, and
     the unnumbered folder is gone, skip the check and the `mv`, and do the rest.
   - Otherwise check that the folder is untracked (`git -C "$MAIN" ls-files <folder>` prints
     nothing) and that `NNN-<name>` (or `NNN-<slug>`) does not exist. If not, stop and report.
   - `mv "$MAIN/specs/<name>" "$MAIN/specs/NNN-<name>"` (or the same in `$MAIN/.specify/bugs/`).
   - With the file tools, change each place in its files that names the folder to the numbered
     name: every `specs/<name>` (or `.specify/bugs/<slug>`) that is not followed by a letter, a
     digit or `-`, so that a longer name that starts the same is left alone; the `Slug` line in
     `assessment.md`; and the
     `**Feature Branch**` line in `spec.md` and the `**Branch**` line in `plan.md`, if they hold the
     bare name. For a spec, write `{"feature_directory": "specs/NNN-<name>"}` to
     `$MAIN/.specify/feature.json`.
   - Add a last line to `<scratchpad>/issue-body.md`, `Spec: specs/NNN-<name>/` or
     `Bug notes: .specify/bugs/NNN-<slug>/`, and run
     `gh issue edit <n> -R tmathura/copilot-plugin-cc --body-file "<scratchpad>/issue-body.md"`.
   - Print the new folder path. Later steps use it.
   - If this step stops, the issue already exists. Fix the cause, then run this step again for
     `#<n>`; do not create a second issue.
5. Change nothing else on the issue: no milestone or project. The PR's `Closes #<n>` closes
   it when it merges.
