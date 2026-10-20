# Bug Fix: Read the review verdict when Copilot writes text before the JSON

- **Slug**: 078-read-verdict-text-before-json
- **Fixed**: 2026-10-20
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

When the first parse of Copilot's answer fails, `parseStructuredOutput` now finds the fenced blocks
in it and reads the verdict from the one block when there is exactly one closed block. Every other
answer keeps the first error and its raw output.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/copilot.mjs` | modified | new `fencedBlocks` (line by line, fences paired from left to right, null when one is left open) with a comment on why; the fallback in `parseStructuredOutput` |
| `tests/runtime-review.test.mjs` | added tests | text around one fence (before, after, both sides, CRLF); ten failure cases; a wrong-shape fenced verdict |
| `README.md` | modified | the "Differences from the Codex plugin" bullet: exactly one code fence, also with text around it |
| `docs/architecture.md` | modified | the `adversarial-review` line says the same |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.16 |
| `plugins/copilot/CHANGELOG.md` | modified | the 1.0.16 entry |

## Diff Highlights (optional)

```js
const blocks = fencedBlocks(rawOutput);
if (blocks?.length === 1) {
  try {
    return { parsed: JSON.parse(blocks[0]), parseError: null, rawOutput, ...fallback };
  } catch {
    // The block is not JSON either; the first error stays.
  }
}
```

## Tests Added or Updated

- "adversarial review reads the verdict from one code fence with text around it": the reported
  answer (a line, a blank line, the fence), text after, text on both sides, and CRLF line ends all
  give the verdict.
- "an answer without exactly one closed JSON fence fails the job with the first parse error": two
  verdict blocks (with and without text), a verdict with a non-JSON block or an empty block in both
  orders, an invalid fence alone and with text, an unclosed fence alone and after a verdict block.
  Each fails with `parseError` equal to the error of `JSON.parse(stripCodeFence(answer))`, `result`
  null, `rawOutput` the whole answer and the job `failed`. One two-block case without `--json` shows
  "Parse error" and the raw output.
- "a fenced verdict with text around it that has the wrong shape gets the schema error".

## Local Verification

- With the fallback switched off (`blocks?.length === -1`), the two new tests that need it fail (0
  pass, 2 fail). With it on, the six review JSON tests pass.
- `npm ci --include=dev`, `npm run build`, `npm test` (290 tests, 0 fail), `npm run check-version`
  (1.0.16) and `claude plugin validate .` pass, on Windows.
- The CRLF case runs through `FAKE_COPILOT_ANSWER` and passes, so the fixture keeps `\r`.

## Deviations from Assessment

- 2026-10-20, review round 1: the comment above `stripCodeFence` is back to what it said before;
  the note that text may come around the fence is on `fencedBlocks`, which handles it. No behaviour
  change; `npm test` passes again (290 tests).
- 2026-10-20, review round 2: the comment on `fencedBlocks` keeps only its reason. No behaviour
  change; `npm test` passes again.

## Follow-ups

- None.
