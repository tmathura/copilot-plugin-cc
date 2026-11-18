# workflow: bug triage

Moved out of the "Spec Kit" section of `REFERENCE.md`. Its "Reading these files" section says when
to read this file.

### Bug triage

The repo's Spec Kit `bug` extension gives `/speckit-bug-assess`, `/speckit-bug-fix` and
`/speckit-bug-test`. Use them only when `$MAIN/.claude/skills/speckit-bug-assess/` exists, and run
fix and test only for a ticket that used bug triage.

- **Order:** assess in Step 1 (main checkout) or at the start of Step 4 (worktree, for a bug issue
  that already exists), then fix in Step 4, then test in Step 5. Notes go in
  `.specify/bugs/NNN-<slug>/` and are committed with the fix. They do not count toward the 3-file limit.
- **Slug:** `NNN-<slug>` when the issue exists; in Step 1, before the issue exists, `<slug>` alone
  (`workflow-ticket` adds the number and the `Bug notes:` line). Apart from that number, keep
  the slug for the whole ticket; do not rename it to the branch slug. Before a Step 1 assess, check
  that no untracked folder in `$MAIN/.specify/bugs/` has it. Pass it as `slug=<slug>`. The `Slug:`
  line in the assess output must equal it; if not, stop.
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
  - Verdict `invalid` (the bug does not apply): do not run fix or test. Step 7 reviews
    `assessment.md` only. The PR holds `assessment.md` and the `UPSTREAM.md` row set to `skipped`
    with the reason, and no `review.html` while the verdict is `invalid` ("Spec review page" in `REFERENCE.md`). Not
    a release.
  - Otherwise the PR sets the row to `ported`. Differences from upstream go, with their reason, in
    the README section "Differences from the Codex plugin". The PR lists the upstream files and
    commit, and says they were read line by line.
- **Edits:** review-loop changes to `assessment.md` are made by hand, before the first fix. Never run
  assess again over an existing `assessment.md`, and never run fix again when `fix.md` exists (also on
  resume). After a later fix (a review round), add a dated entry under "Deviations from Assessment"
  in `fix.md`, run test again, and confirm the overwrite of `test.md`.

