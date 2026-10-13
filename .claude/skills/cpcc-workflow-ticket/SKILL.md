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
4. Change nothing else on the issue: no milestone or project. The PR's `Closes #<n>` closes
   it when it merges.
