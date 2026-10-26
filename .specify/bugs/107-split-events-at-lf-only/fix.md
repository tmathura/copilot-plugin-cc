# Bug Fix: Copilot JSON events with U+2028 or U+2029 are split and fail to parse

- **Slug**: 107-split-events-at-lf-only
- **Fixed**: 2026-10-27
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The companion now splits Copilot's stdout into event lines at LF only, with one CR before it
dropped, through a chunk buffer in the shape of upstream's `handleChunk`, instead of `readline`,
which also ended lines at U+2028 and U+2029. Output after the run has finished is ignored.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/prompt-mode.mjs` | modified | `readline` removed; `handleChunk` splits at LF, searches only the new chunk, drops one CR; stdout `end` flushes a last line with no LF; both return once the run has exited |
| `tests/fake-copilot-fixture.mjs` | modified | `FAKE_COPILOT_CRLF` ends each event line with CRLF; added to the variables the fake reads from the test, not the outer environment |
| `tests/prompt-mode.test.mjs` | added tests | separators, CRLF, chunks, lone CR, last line with no LF, timeout with a partial line, output after the run, an event over 1 MB; `startFake` takes extra env |
| `README.md` | modified | "Differences from the Codex plugin": the LF-only split, with its reason |
| `plugins/copilot/CHANGELOG.md` | modified | `### 1.0.19` entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.19 (`npm run bump-version`) |

## Diff Highlights (optional)

```js
handleChunk(chunk) {
  if (this.exited) {
    return;
  }
  const searchFrom = this.lineBuffer.length;
  this.lineBuffer += chunk;
  let start = 0;
  let newlineIndex = this.lineBuffer.indexOf("\n", searchFrom);
  while (newlineIndex !== -1) {
    const line = this.lineBuffer.slice(start, newlineIndex);
    start = newlineIndex + 1;
    this.handleLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    newlineIndex = this.lineBuffer.indexOf("\n", start);
  }
  this.lineBuffer = this.lineBuffer.slice(start);
}
```

## Tests Added or Updated

- `tests/prompt-mode.test.mjs` "an event whose JSON string holds a raw U+2028 is read as one event" and the U+2029 case — the bug; both fail on the old reader.
- "CRLF line ends are read, and no CR stays in the events" — CRLF from Copilot still works.
- "events are joined across chunks and split within one, also with CR and LF in separate chunks".
- "a lone CR does not end a line, so two events joined by it fail with the quoting error" — only LF splits (fails on the old reader, which split at the CR).
- "a last line with no LF is still read: a result is kept, and text that is not JSON fails".
- "a run that times out with part of a line kept keeps its timeout error".
- "output after the run has finished changes nothing" — a stop that fails finishes the run while stdout is open.
- "an event of more than 1 MB, written in many chunks, is read whole".
- The existing "a line that is not JSON ends the run with an error that quotes it" is unchanged and passes.

## Local Verification

- Commands run: `npm ci --include=dev`, `npm run build` → pass; `npm test` → 421 tests, 397 pass, 24 skipped, 0 fail; `npm run check-version` → 1.0.19; `claude plugin validate .` → pass.
- Against the old `prompt-mode.mjs` (the fix taken out for one run): the U+2028, U+2029 and lone-CR tests fail; the others pass.
- Manual check: a one-line script fed one JSON event with both separators to `readline` and got 3 line events, none of which parsed (Node 24.21.0).

## Deviations from Assessment

None.

## Follow-ups

- Upstream codex-plugin-cc reads its app server with `readline` too; the owner reports it upstream.
