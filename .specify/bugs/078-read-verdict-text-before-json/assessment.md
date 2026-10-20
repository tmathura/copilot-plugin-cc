# Bug Assessment: Read the review verdict when Copilot writes text before the JSON

- **Slug**: 078-read-verdict-text-before-json
- **Created**: 2026-10-20
- **Source**: pasted text (GitHub issue #78, https://github.com/tmathura/copilot-plugin-cc/issues/78)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

`/copilot:adversarial-review` can report "Copilot did not return valid structured JSON" when Copilot
did return a valid verdict. Seen on 2026-10-14 (plugin 1.0.12, Windows). The final message was a
line of text, a blank line, then a fenced block:

````text
Fine; EPERM treated as alive (conservative).

```json
{"verdict":"approve","summary":"Ship. ...","findings":[],"next_steps":[]}
```
````

The plugin printed `Parse error: Unexpected token 'F', "Fine; EPER"... is not valid JSON`.

## Symptom

A final message with text before (or after) one fenced JSON verdict fails the review with a parse
error. Expected: the verdict is read from the one fenced block.

## Reproduction

1. Make the fake Copilot CLI answer with a line of text, a blank line and a ```` ```json ```` fenced
   review verdict (`FAKE_COPILOT_ANSWER`).
2. Run `adversarial-review` through the companion.
3. The job fails with a `JSON.parse` error, though the fenced block is a valid verdict.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/copilot.mjs:685-688` (`stripCodeFence`): its regex is anchored to the
  whole text (`^\s*```...```\s*$`), so it returns the text unchanged when anything is outside the
  fence.
- `plugins/copilot/scripts/lib/copilot.mjs:690-715` (`parseStructuredOutput`): parses
  `stripCodeFence(rawOutput)`, so the text before the fence reaches `JSON.parse`.

## Root Cause Hypothesis

`stripCodeFence` only handles a message that is one fence and nothing else. Copilot in prompt mode
has no output schema setting, so it sometimes writes a sentence before the fenced JSON. Confidence:
high; the reported error starts at the first character of that sentence.

## Proposed Remediation

**Preferred**: keep `JSON.parse(stripCodeFence(rawOutput))` as the first try. When it fails, find
every fenced block in the message. A block opens with a line that starts with ```` ``` ```` (spaces
or tabs before it allowed, then an optional language word) and closes with a line of only
```` ``` ```` (spaces or tabs around it allowed), with LF or CRLF line ends; this is the form that
`stripCodeFence` accepts today. Blocks pair from left to right: each opening line takes the next
closing line. Fences of four or more backticks, `~~~` fences, a fence on one line, and words after
the language word stay out of scope, as they are today. When there is exactly one block, and no opening line is left without a
closing line, parse its content. With no block (also an
opening line with no closing line), more than one block (also when only one of them is JSON), or a
block that is not valid JSON, return the first error unchanged: the error of
`JSON.parse(stripCodeFence(rawOutput))`, as today (for a message that is one fence and nothing else,
that is the error about the fence content). `rawOutput` stays unchanged. The comment above
`stripCodeFence` says that text may come around the fence. A JSON verdict taken from a block still goes through the schema check. The
prompt does not change. A message that is one fence and nothing else still parses as before.

**Alternatives**:
- Make the `stripCodeFence` regex unanchored and take the first match: shorter, but it would accept
  one block and ignore a second one, which the issue says must stay an error.

**Files likely to change**:
- `plugins/copilot/scripts/lib/copilot.mjs`
- `tests/runtime-review.test.mjs`
- `README.md` (the "Differences from the Codex plugin" bullet on the schema and the code fence)
- `docs/architecture.md:104` (it describes the "inside one code fence" parsing)
- Release: `npm run bump-version -- 1.0.16` and a `### 1.0.16` entry above `### 1.0.15` in
  `plugins/copilot/CHANGELOG.md` (patch: a fix of a review result users see); then
  `npm run check-version`.

**Tests to add or update**:
- A line of text, then a fenced verdict: the review gives that verdict (as in the report).
- A fenced verdict with text after it, text on both sides, and CRLF line ends: the verdict is read.
- Failures, each with `result` null, `rawOutput` the whole answer, the job `failed`, and
  `parseError` equal to the error of `JSON.parse(stripCodeFence(answer))`: two fenced blocks that
  are both valid JSON, with and without text around them; one valid verdict block and one block that
  is not JSON, in both orders; one fenced block that is not valid JSON, with text around it and
  alone; an opening fence with no closing line, alone and after a valid verdict block; a valid
  verdict block and an empty block, in both orders, with one line break between them. One two-block
  case also runs without `--json` and shows "Parse error" and the raw output.
- One fenced block with text around it whose JSON has the wrong shape: the schema error, as for an
  unfenced answer, with `rawOutput` kept.

## Risks & Considerations

- A JSON string cannot hold a raw line break, so a closing ```` ``` ```` line cannot come from inside
  a JSON value. Only text outside the JSON, such as a code sample in the prose, can add a second
  block; then the answer fails, as the issue asks. A real answer with a verdict block and a code
  sample block therefore stays an error; that is intended, because the issue wants one block only.
- The README bullet already says that the review "accepts the JSON inside one code fence"; it gets
  "also with text around it". Codex makes its answer match the schema itself, so this stays a
  difference from upstream (correctness).

## Open Questions

None.

## Constitution Check

- **I. Upstream parity**: met. `parseStructuredOutput` keeps its name, module and result shape. The
  difference from upstream (Codex enforces the schema, so it needs no fence handling) is already in
  the README "Differences from the Codex plugin"; the bullet is extended. The file's "Changed from
  upstream" notice already covers the prompt-mode parsing.
- **II. Only reviewed code**: met. No dependency is added; a small regex does the work.
- **III. Copilot CLI through documented interfaces only**: met. Only the parsing of Copilot's final
  message changes; no Copilot call or argument changes.
- **IV. Safe by default**: met. The parsed JSON still goes through the same schema check, and a
  message with two blocks stays an error, so no verdict is taken from a guess.
- **V. Cross-platform**: met. The block regex accepts LF and CRLF line ends; the tests include CRLF.
- **VI. Tested, including failure paths**: met. Tests cover the fixed case and the failure paths
  (two blocks, an invalid block). CI runs them on ubuntu, macOS and Windows. This is a patch release,
  so a release run follows the merge.
