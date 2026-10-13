# Bug Assessment: Non-ASCII file names reach the review context in git's quoted form

- **Slug**: quoted-untracked-file-names
- **Created**: 2026-10-13
- **Source**: pasted text (issue #16 and its comments). Written by hand on 2026-10-13, after the fix merged in PR #27, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

Issue #16, "Decode quoted untracked file names in review context" (2026-10-08):

> `collectReviewContext` in `plugins/copilot/scripts/lib/git.mjs` lists untracked files with `git ls-files --others --exclude-standard` and splits the output by line. With git's default `core.quotePath`, a file name with non-ASCII characters (or a tab or newline) comes back quoted and escaped, for example `"caf\303\251.js"`. `formatUntrackedFile` then joins that quoted text to the repository root, the path does not exist, and the file is shown as `(skipped: broken symlink or unreadable file)`. [...]
>
> This bug comes from upstream codex-plugin-cc (commit `db52e28`), and #7 copied the code unchanged.

Comment on the issue (2026-10-09), after #9 (PR #20) and #10 (PR #21):

> **Done:** untracked files are now listed with `git ls-files -z --others --exclude-standard` and split on NUL [...]
> **Still open:** the staged list (`git diff --cached --name-only`), the unstaged list (`git diff --numstat --no-renames`) and the branch file list (`git diff --name-only <range>`) still use git's quoted form for non-ASCII names.

Reported upstream as openai/codex-plugin-cc#812.

## Symptom

At the commit before the fix (`c7271ad`), untracked files were already read correctly. But the staged, unstaged and branch file lists and their counts showed a non-ASCII name in git's quoted form, such as `"caf\303\251.js"` (issue comment of 2026-10-09). Expected: each name appears as it is. (Reconstructed from PR #27: the Git Status section and the patch headers also showed the quoted form, while untracked files showed the real name, so Copilot could see one file under two names.)

## Reproduction

1. In a git repo, create `café.js`, stage it, then change it again (staged and unstaged).
2. Run `collectReviewContext` for the working tree.
3. The file lists show `"caf\303\251.js"`, not `café.js`.
4. For a branch review, commit `café.js` on a branch and review against the base: the Changed Files list shows the quoted name.

## Suspected Code Paths

At `c7271ad`, in `plugins/copilot/scripts/lib/git.mjs`:

- `safeGitArgs` (lines 17-22): builds the options for every git call. It does not set `core.quotePath`, so git quotes non-ASCII names.
- `listUnstagedFiles` (line 138): reads `git diff --numstat` and calls `trim()`.
- `getWorkingTreeState` (line 146): the staged list from `git diff --cached --name-only`, with `trim()`.
- `collectBranchContext` (line 296): the branch file list from `git diff --name-only`, with `trim()`.
- `collectReviewContext` (line 389): counts branch files the same way.

## Root Cause Hypothesis

Git's default `core.quotePath=true` quotes any path byte above 0x7F in its plain-text output. The plugin used that output as the file name. Confidence: high (git documents the option).

## Proposed Remediation

**Preferred** (from the issue, with the scope from its 2026-10-09 comment): the untracked list already uses `git ls-files -z` (#9). List the staged, unstaged and branch names with `-z` too, and split on NUL without trimming names, so that `listUniqueFiles` never lists one file twice in two forms. Keep the safe git options on every call. Add the change to the README section "Differences from the Codex plugin" (correctness).

**Alternatives** (optional):
- (Reconstructed from PR #27.) Set `-c core.quotePath=false` on every git call. One change fixes the lists, the status and the patch headers. Names with a tab, a newline, a quote or a backslash stay quoted.

**Files likely to change**:
- `plugins/copilot/scripts/lib/git.mjs`
- `tests/git.test.mjs`
- `README.md`

**Tests to add or update**:
- An untracked `café.js` shows its content in the inline and the lightweight context (the comment says the lightweight case was still untested).
- A file that is both staged and unstaged, with a non-ASCII name, is counted once, by its real name.

## Risks & Considerations

- Every git call goes through `safeGitArgs`, so a change there touches every review.
- The code is upstream code. A change needs a README entry (constitution Principle I).

Reconstructed from PR #27 and later (not in the issue):

- `trim()` on a name list also removes Unicode white space, such as U+00A0, at the end of a name (Codex review of PR #27, round 1).
- Names with hidden Unicode characters (bidi controls) reach the prompt as they are. #29, opened after the merge, asked the owner to decide this.

## Open Questions

- None at the time. The hidden-character question came later, in #29 (see `fix.md`).

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #27, not only the plan above.

- I. Upstream parity: met. The change departs from upstream for correctness, which Principle I allows, and the README section "Differences from the Codex plugin" lists it.
- II. Only reviewed code: met. The fix is written in this repo.
- III. Copilot CLI through documented interfaces: not relevant. Only git calls change.
- IV. Safe by default: met. The safe git options stay on every call, and git still runs without a shell.
- V. Cross-platform: met. `core.quotePath` works the same on every OS. CI runs the tests on Windows, macOS and Linux.
- VI. Tested: met. New tests in `tests/git.test.mjs` cover the staged, unstaged, branch and untracked lists.
