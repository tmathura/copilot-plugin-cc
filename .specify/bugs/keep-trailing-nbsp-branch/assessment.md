# Bug Assessment: A large branch review cuts a trailing no-break space from the last file name

- **Slug**: keep-trailing-nbsp-branch
- **Created**: 2026-10-13
- **Source**: pasted text (issue #40). Written by hand on 2026-10-13, after the fix merged in PR #49, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: low

## Report (verbatim or summarized)

Issue #40, "Keep a trailing no-break space on the last file name of a large branch review" (2026-10-12):

> `withReviewPatches` in `plugins/copilot/scripts/copilot-companion.mjs` builds the review input for a large review (the lightweight context with patch files) as `[context.content.trimEnd(), "", "## Patch Files", ...]`. JavaScript's `trimEnd()` also removes Unicode white space such as U+00A0 (no-break space).
>
> In a large branch review, the last section of `context.content` is "Changed Files". So when the last changed file's name ends in a no-break space (for example `z.js `), Copilot sees `z.js`, a file that does not exist or is a different file. A large working-tree review is not affected, because its last section is "Untracked Files", which ends with a code fence or `(none)`.
>
> #16 made the name lists keep such names [...], and #28 (PR #39) made `formatSection` remove only trailing new lines. This `trimEnd()` is the last place that still cuts the name. The Copilot PR review of #39 found it.

## Symptom

In a branch review above the inline limit, the last changed file name loses a trailing U+00A0, so Copilot sees a different name. Expected: the name as it is.

## Reproduction

1. On a branch, commit a change large enough to pass the inline limit, with the last changed file named `z.txt` + U+00A0.
2. Run `/copilot:review --base main`.
3. The review input's "Changed Files" ends with `z.txt`, without the U+00A0.

## Suspected Code Paths

- `plugins/copilot/scripts/copilot-companion.mjs:332` `withReviewPatches()` (at `7b12f53`): `context.content.trimEnd()`. Its callers are the review, the adversarial review and the review gate.

## Root Cause Hypothesis

`trimEnd()` removes all Unicode white space, not only new lines. Confidence: high.

## Proposed Remediation

**Preferred**: in `withReviewPatches`, remove only trailing new lines from `context.content`, as `formatSection` in `git.mjs` does. Add a test that checks the final review input, not only `collectReviewContext`. Remove the exception that the README entry from #28 names. Patch release.

**Files likely to change**:
- `plugins/copilot/scripts/copilot-companion.mjs`
- `tests/runtime.test.mjs`
- `README.md`

**Tests to add or update**:
- A large branch review whose last changed file name ends in U+00A0 shows that name with the U+00A0 in the review input.

## Risks & Considerations

- All three review paths go through `withReviewPatches`.

## Open Questions

- None.

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #49, not only the plan above.

- I. Upstream parity: met. This completes the #28 entry in the README section "Differences from the Codex plugin" (correctness).
- II. Only reviewed code: met. The fix is written in this repo.
- III. Copilot CLI through documented interfaces: not relevant. Only the prompt text changes.
- IV. Safe by default: not relevant. The patch folder and its permissions do not change.
- V. Cross-platform: met. The test file name ends in U+00A0, which every OS allows; CI runs it on all three.
- VI. Tested: met. A new end-to-end test checks the final review input.
