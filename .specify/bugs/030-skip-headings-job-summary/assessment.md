# Bug Assessment: /copilot:status shows a heading or a label as a job's summary

- **Slug**: 030-skip-headings-job-summary
- **Created**: 2026-10-13
- **Source**: pasted text (issue #30). Written by hand on 2026-10-13, after the fix merged in PR #48, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: low

## Report (verbatim or summarized)

Issue #30, "Skip headings and label lines when picking a job summary" (2026-10-11):

> `/copilot:status` can show a heading or a label as a job's summary, not what Copilot found.
>
> `firstMeaningfulLine` in `plugins/copilot/scripts/copilot-companion.mjs` returns the first line of the output that is not empty. A normal review takes its summary from it (line 382), and so do tasks (line 610) and the adversarial review's fallback (line 448).
>
> Copilot's `/review` sets its own output format, and the format changes from run to run. In the 2026-10-11 hand run, three reviews of the same change began with:
>
> - `## Review` (job `review-mv4bkukp-brgj1y`, which the owner saw)
> - `**Review findings**`
> - `**Findings**`
>
> Each of these lines became the summary in `/copilot:status`. [...]
>
> Upstream has the same code, but Codex's built-in review always starts with a plain one-sentence summary, so upstream does not show the problem.

## Symptom

A review whose output starts with `## Review`, `**Review findings**` or `**Findings**` shows that line as its summary in `/copilot:status`. Expected: the first line that says something; a heading or a label is skipped.

## Reproduction

1. Run `/copilot:review` with a Copilot answer that starts with `## Review`, then a sentence.
2. Run `/copilot:status`.
3. The job's summary is `## Review`.

The tests reproduce this with the fake Copilot CLI.

## Suspected Code Paths

At `9bf0ce4`, in `plugins/copilot/scripts/copilot-companion.mjs`:

- `firstMeaningfulLine()` (line 161): returns the first non-empty line.
- Its callers: the review summary (line 383), the adversarial review's fallback (line 453) and the task summary (line 619). The line numbers in the report are from an older commit.

## Root Cause Hypothesis

The function treats any non-empty line as meaningful. Copilot's `/review` often opens with markdown structure, which upstream's Codex output does not. Confidence: high.

## Proposed Remediation

**Preferred**: fix it once, in `firstMeaningfulLine`, so reviews and tasks both get it. Skip lines that are only a markdown heading (`#` to `######`), and short bold-only label lines such as `**Findings**`. Keep a bold line that is a full sentence, without its `**` markers. If every line is skipped, use the caller's fallback. No change to the review prompt or the stored job fields.

**Files likely to change**:
- `plugins/copilot/scripts/copilot-companion.mjs`
- `tests/runtime.test.mjs`
- `README.md`

**Tests to add or update**:
- `## Review` first gives the next line with real content.
- `**Review findings**` or `**Findings**` first gives the next line with real content.
- A bold full sentence first gives that sentence, without `**`.
- Only headings gives the caller's fallback.

## Risks & Considerations

- A pattern that is too wide could skip a real summary line.
- (Reconstructed from the reviews of PR #48.) Copilot's format changes from run to run, so other markers (rules, fences) can appear first.

## Open Questions

- None.

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #48, not only the plan above.

- I. Upstream parity: met. The change departs from upstream for correctness, which Principle I allows, and the README lists it.
- II. Only reviewed code: met. The fix is written in this repo.
- III. Copilot CLI through documented interfaces: not relevant. Only the parsing of Copilot's text changes.
- IV. Safe by default: not relevant. No permission changes.
- V. Cross-platform: met. The pattern accepts CRLF line ends; CI runs the tests on Windows, macOS and Linux.
- VI. Tested: met. An end-to-end test with the fake Copilot CLI covers each case.
