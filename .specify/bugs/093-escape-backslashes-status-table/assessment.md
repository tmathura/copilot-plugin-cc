# Bug Assessment: Escape backslashes in status table cells

- **Slug**: 093-escape-backslashes-status-table
- **Created**: 2026-10-20
- **Source**: pasted text (GitHub issue #93, read with `gh issue view 93`)
- **Verdict**: valid
- **Severity**: low (a rare value breaks one row of a display table; no data is lost; CodeQL rates
  the code pattern high)

## Report (verbatim or summarized)

Issue #93: CodeQL alert #1 (`js/incomplete-sanitization`, level high) points at `escapeMarkdownCell`
in `plugins/copilot/scripts/lib/render.mjs:98-103`. It escapes `|` as `\|` but does not escape `\`.
A value that holds `\|` becomes `\\|`: Markdown reads `\\` as one backslash and the `|` as a cell
break, so a job title or summary with that text breaks the status table that
`appendActiveJobsTable` (`render.mjs:124`) prints. Upstream codex-plugin-cc has the same code
(`plugins/codex/scripts/lib/render.mjs:95-100`, main at
`db52e28f4d9ded852ab3942cea316258ae4ef346`).

Asked for: escape `\` before `|`, so `\|` becomes `\\\|`; keep the newline handling and `trim()`; a
test with a summary that holds `\|` that checks the row keeps its column count; a README bullet in
"Differences from the Codex plugin" unless upstream has fixed it.

## Symptom

A running job whose summary (or id, phase or other cell) holds `\|` gets a row with one cell too
many in the `/copilot:status` "Active jobs" table, so the columns after it move. Expected: each value
stays in its own cell and shows as written.

## Reproduction

1. Call `renderStatusReport` with one running job whose `summary` is `a\|b`.
2. Read the job's row: `| task-1 | task | running | running | 1s |  | a\\|b | ... |`.
3. Split it on each `|` that has an even number of backslashes before it (CommonMark backslash
   escapes: `\\` is one literal backslash, so the `|` after it is not escaped). The row has 9
   cells; the header has 8.

Run on 2026-10-20 with `2451028` (scratchpad script): 9 cells.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/render.mjs:98` `escapeMarkdownCell` — escapes `|` only, not `\`.
- `plugins/copilot/scripts/lib/render.mjs:114` `appendActiveJobsTable` — its only caller; every cell
  of the row except the actions column goes through it.

## Root Cause Hypothesis

`escapeMarkdownCell` adds a `\` before each `|` but leaves a `\` that is already in the value. A
value `\|` then has two backslashes before the pipe: the first escapes the second, and the pipe is
left as a cell break. Confidence: high (reproduced). How a viewer splits the row depends on its
Markdown renderer: one that counts the backslashes before a pipe splits the cell; GitHub's table
parser takes any `\|` as an escaped pipe and instead drops the backslash. Escaping `\` first is
correct for both.

## Proposed Remediation

**Preferred**: in `escapeMarkdownCell`, add `.replace(/\\/g, "\\\\")` before the `|` replace. The
order matters: escaping `\` after `|` would double the backslash that the `|` escape adds. Keep the
newline replace and `trim()` as they are. Keep the function private and test it through
`renderStatusReport`, as the module's other helpers are tested. Extend the "Changed from upstream"
notice at the top of `render.mjs`. Add a README bullet in "Differences from the Codex plugin"
(upstream main `db52e28` still has the old code on 2026-10-20). Patch release 1.0.17 with a
`CHANGELOG.md` entry, because the status output changes.

**Alternatives**:
- Export `escapeMarkdownCell` and test it directly: matches the acceptance wording more closely,
  but adds an export only for a test. The status-table test checks the same text.
- Wrap each cell in a code span: changes the output format; rejected.

**Files likely to change**:
- `plugins/copilot/scripts/lib/render.mjs`
- `tests/render.test.mjs`
- `README.md`
- `plugins/copilot/CHANGELOG.md` and the version files (`npm run bump-version -- 1.0.17`)

**Tests to add or update**:
- `renderStatusReport` with a running job whose summary is `a\|b`: the summary cell is exactly
  `a\\\|b`, and the row has 8 cells when split on pipes after an even number of backslashes.
- Same row: a lone `\` (`a\b` gives `a\\b`), two backslashes before a pipe, and a CRLF line break
  with outer spaces (joined with a space and trimmed, as before).

## Risks & Considerations

- A value with a plain backslash, such as a Windows path in a summary, now shows `\\` in the raw
  text. Rendered Markdown shows one `\`, as written. Raw-text readers of `/copilot:status` see the
  doubled backslash; this is the cost of a correct table.
- Only the active-jobs table uses this function; the "Live details", "Latest finished" and "Recent
  jobs" lists print values without escaping and do not change.
- The CodeQL alert closes only after CodeQL scans `main` with the fix; the PR's own scan shows it.

## Open Questions

None.

## Constitution Check

- **I. Upstream parity**: met. The function keeps its name and place; the difference from upstream
  goes in the README "Differences from the Codex plugin", and the file's "Changed from upstream"
  notice names it.
- **II. Only reviewed code**: met. No dependency; one `replace` call.
- **III. Copilot CLI through documented interfaces only**: met. No Copilot call changes.
- **IV. Safe by default**: met. The change closes a high CodeQL alert; no data is read or written in
  a new way.
- **V. Cross-platform**: met. String handling only; the test covers a CRLF line break.
- **VI. Tested, including failure paths**: met. The new test fails on today's code (9 cells) and
  covers the kept newline and trim handling. CI runs it on ubuntu, macOS and Windows. This is a
  patch release, so a release run follows the merge.
