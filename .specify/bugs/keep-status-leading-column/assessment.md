# Bug Assessment: The review context's Git Status loses the leading space of its first line

- **Slug**: keep-status-leading-column
- **Created**: 2026-10-13
- **Source**: pasted text (issue #28 and its comment). Written by hand on 2026-10-13, after the fix merged in PR #39, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

Issue #28, "Keep the leading status column in the review context's Git Status" (2026-10-11):

> `collectWorkingTreeContext` in `plugins/copilot/scripts/lib/git.mjs` calls `.trim()` on the `git status --short --untracked-files=all` output, and `formatSection` calls `body.trim()` again. In the short format, the first column is the staged state and the second is the unstaged state. When the first line is an unstaged change, the trim removes its leading space:
>
> ```
> git status --short:   " M a.js\nM  b.js\n"
> review context:       "M a.js\nM  b.js"
> ```
>
> Copilot then reads `a.js` as staged, not unstaged. This happens in the inline and the lightweight context. The code comes from upstream codex-plugin-cc.

Comment (2026-10-11): reported upstream as openai/codex-plugin-cc#813.

## Symptom

When the first line of `git status --short` is an unstaged change, the review context shows `M a.js` instead of ` M a.js`, so Copilot reads the change as staged. Expected: each status line exactly as git prints it.

## Reproduction

1. In a git repo with two tracked files, change `a.js` (not staged) and stage a change to `b.js`.
2. Run `collectReviewContext` for the working tree.
3. The Git Status section starts with `M a.js`.

## Suspected Code Paths

At `19fbe3f`, in `plugins/copilot/scripts/lib/git.mjs`:

- `collectWorkingTreeContext` (line 261): `gitChecked(cwd, ["status", ...]).stdout.trim()`.
- `formatSection` (line 222): `body.trim()` again for every section.

## Root Cause Hypothesis

`trim()` removes leading white space, and in the short status format a leading space is data (the empty staged column). Confidence: high.

## Proposed Remediation

**Preferred**: do not remove leading white space from the status output; trailing new lines may still go. `formatSection` keeps the leading white space of its body and still prints `(none)` for an empty or blank body. Do not change the other sections' content. Add the change to the README section "Differences from the Codex plugin" (correctness). Patch release.

**Files likely to change**:
- `plugins/copilot/scripts/lib/git.mjs`
- `tests/git.test.mjs`
- `README.md`

**Tests to add or update**:
- An unstaged change in the first status line shows ` M <file>` in Git Status, in the inline and the lightweight context.
- An empty section still shows `(none)`.

## Risks & Considerations

- `formatSection` builds every section, so a change there reaches all of them.
- (Reconstructed from the code review of PR #39.) `trim()` also removes white space at the end of the last line, such as U+00A0 at the end of a file name.

## Open Questions

- None.

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #39, not only the plan above.

- I. Upstream parity: met. The change departs from upstream for correctness, which Principle I allows, and the README lists it.
- II. Only reviewed code: met. The fix is written in this repo.
- III. Copilot CLI through documented interfaces: not relevant. Only the prompt text changes.
- IV. Safe by default: not relevant. No git option or permission changes.
- V. Cross-platform: met. CI runs the tests on Windows, macOS and Linux.
- VI. Tested: met. New tests in `tests/git.test.mjs`.
