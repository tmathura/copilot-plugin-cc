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
`## Acceptance criteria`, and maybe suggested labels. If there is no approved draft, and this is not
a resume (below), stop and say so.

It can also name a Spec Kit planning folder in the main checkout that has no issue number yet:
`specs/<name>/` or `.specify/bugs/<slug>/`.

To finish step 4 after it stopped (a resume), pass the existing issue (`#<n>`) and the planning
folder by its name without the number, as first given, instead of a draft. Then skip steps 1 to 3,
and do not create an issue.

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
     the unnumbered folder is gone, check that the numbered folder is untracked
     (`git -C "$MAIN" ls-files <numbered folder>` prints nothing; if not, stop and report), skip the
     `mv`, and do the rest.
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
   - Check the result. If a check fails, fix the files and check again.
     - No old path is left. This prints nothing: `grep -rnE 'specs/<name>([^A-Za-z0-9-]|$)'
       "$MAIN/specs/NNN-<name>"` (for a bug: `'\.specify/bugs/<slug>([^A-Za-z0-9-]|$)'` in
       `"$MAIN/.specify/bugs/NNN-<slug>"`).
     - The new names are set. For a bug, `assessment.md` has the line `- **Slug**: NNN-<slug>`. For
       a spec, a `**Feature Branch**` or `**Branch**` line that held the bare name now holds
       `NNN-<name>`, and `$MAIN/.specify/feature.json` holds `specs/NNN-<name>`.
   - Set the folder line in the issue. Read the current body
     (`gh issue view <n> -R tmathura/copilot-plugin-cc --json body --jq .body`) into
     `<scratchpad>/issue-body.md`. If the command fails or the body is empty, stop and report: never
     edit the issue from a body you could not read. The expected line is `Spec: specs/NNN-<name>/`
     or `Bug notes: .specify/bugs/NNN-<slug>/`. A folder line is a line that starts with `Spec:`
     or `Bug notes:` and holds a `specs/` or `.specify/bugs/` path; compare lines without a trailing
     `\r` or spaces. Leave every other line alone. Count the folder lines first:
     - more than one: stop and report;
     - one, equal to the expected line and already the last non-blank line: nothing to change;
     - one, anywhere else or with another path (for example the unnumbered one): remove it, with
       any blank lines it leaves at the end;
     - then, if the body changed or had no folder line, append the expected line after a blank line.

     Only when you changed the body, run `gh issue edit <n> -R tmathura/copilot-plugin-cc
     --body-file "<scratchpad>/issue-body.md"`. On every run, also when nothing changed, read the
     body again and check that it has exactly one folder line, the expected one, as its last
     non-blank line, and no old unnumbered path (the same `grep -E` pattern as for the files).
     If the old path is still in other text of the body, stop and report it; do not edit that text.
   - Print the new folder path. Later steps use it.
   - If this step stops, the issue already exists. Fix the cause, then run this skill again with
     `#<n>` and the planning folder (see "Input"). Each part is safe to run again.
5. Change nothing else on the issue: no milestone or project. The PR's `Closes #<n>` closes
   it when it merges.
