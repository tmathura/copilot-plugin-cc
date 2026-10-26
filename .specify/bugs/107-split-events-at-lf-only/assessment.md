# Bug Assessment: Copilot JSON events with U+2028 or U+2029 are split and fail to parse

- **Slug**: 107-split-events-at-lf-only
- **Created**: 2026-10-26
- **Source**: pasted text (GitHub issue #107)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

Summarized from #107. The companion reads Copilot's JSON events with `node:readline`
(`plugins/copilot/scripts/lib/prompt-mode.mjs:198`). `readline` ends a line at U+2028 (line
separator) and U+2029 (paragraph separator), as well as at LF and CR. JSON allows both characters
unescaped inside a string, so Copilot can print an event that holds one. The companion then gets the
event in pieces, and none of them parses. Seen on 2026-10-20 in #105, review round 16:

```
Copilot error: Failed to parse Copilot JSON output: Unterminated string in JSON at position 1832 (line 1 column 1833)
{"type":"tool.execution_complete", ... "result":{"content":"...
```

Expected: an event line splits only at LF (a CR before it is dropped); a raw U+2028 or U+2029 inside a
JSON string stays in the event, and the run goes on. The issue asks for the chunk buffer of
upstream's `handleChunk`, the same event handling otherwise (also the error that quotes a line that is
not JSON), and the two separators in the fake and in `tests/prompt-mode.test.mjs`.

## Symptom

Any review or task fails with "Failed to parse Copilot JSON output" when Copilot reads, quotes or
writes text that holds a raw U+2028 or U+2029, for example a file copied from a web page or a Word
document. Expected: the event is read whole and the run goes on.

## Reproduction

1. Write one valid JSON event line whose string holds a raw U+2028 and U+2029, for example
   `JSON.stringify({ type: "assistant.message", data: { content: "a" + String.fromCharCode(0x2028) + "b" + String.fromCharCode(0x2029) + "c" } })`
   (`JSON.stringify` does not escape them), followed by LF.
2. Feed it to `readline.createInterface` on a stream, as `prompt-mode.mjs` does.
3. Checked on 2026-10-26 with Node 24.21.0: 3 `line` events, and `JSON.parse` fails on all 3.
   `JSON.parse` of the whole line works.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/prompt-mode.mjs:198-201` — `readline.createInterface({ input: this.proc.stdout })` and its `line` handler split stdout into events; readline also ends lines at U+2028 and U+2029.
- `plugins/copilot/scripts/lib/prompt-mode.mjs:218-230` (`handleLine`) — gets each piece and sets `protocolError` with "Failed to parse Copilot JSON output" on the first piece that does not parse.
- `plugins/copilot/scripts/lib/prompt-mode.mjs` `finish()` — closes `this.readline`.
- Upstream `plugins/codex/scripts/lib/app-server.mjs:220` reads its spawned client the same way; its broker path (`handleChunk`, lines 107-116) already splits at LF only.

## Root Cause Hypothesis

`node:readline` treats U+2028 and U+2029 as line ends, but they are valid unescaped characters in a
JSON string, and Copilot's JSON-lines output (like `JSON.stringify`) leaves them raw. So one event
reaches `handleLine` as several pieces, and the first piece that fails to parse ends the run.
Confidence: high (reproduced).

## Proposed Remediation

**Preferred**: replace `readline` with the chunk buffer of upstream's `handleChunk`: append each
stdout chunk (stdout is already decoded as UTF-8) to a buffer, cut it at each LF, drop one CR before
the LF, and pass each line to the unchanged `handleLine`. When stdout ends, pass the rest of the
buffer (a last line with no LF) to `handleLine`, as readline did, so a cut-off or not-JSON last line
is still reported. Remove the `readline` import and the `readline.close()` in `finish()`. Output
that arrives after `finish()` (possible when a stop fails and `finish()` runs before stdout ends) is
ignored: the `data` and `end` handlers return at once once the run has exited, so late output cannot
dispatch an event, change the result or start a result timer. A lone CR no longer ends a line
(readline split there too); the issue asks for LF only, and JSON-lines output from Copilot ends each
record with LF. This difference is part of the README entry.

**Alternatives**:
- Keep readline and join pieces after a failed parse: fragile, and it could change the error that
  quotes a line that is not JSON. Rejected.
- `crlfDelay` and other readline options cannot turn off the Unicode line ends.

**Files likely to change**:
- `plugins/copilot/scripts/lib/prompt-mode.mjs`
- `tests/fake-copilot-fixture.mjs` (an env switch that ends event lines with CRLF, added to the fake's list of passed variables next to `FAKE_COPILOT_ANSWER`; the separators already pass through `FAKE_COPILOT_ANSWER`)
- `tests/prompt-mode.test.mjs` (the chunk, late-output and partial-line cases use small inline scripts, as its existing stop tests do, because the fake writes each event in one `write`)
- No other doc: no doc names readline; `specs/005-copilot-plugin-port/call-site-map.md` maps `handleLine` and `handleChunk` to upstream and stays true (and is history)
- `README.md` "Differences from the Codex plugin" (a correctness difference from upstream)
- `plugins/copilot/CHANGELOG.md` and the version files (patch release)

**Tests to add or update**:
- An answer with a raw U+2028, and one with a raw U+2029: one `assistant.message` event with the exact text, no `protocolError`, the result kept, exit 0.
- CRLF line ends: every event parses and no text ends with `\r`.
- An event cut across two stdout chunks, two events in one chunk, and a CR and its LF in separate chunks (the buffer joins and splits them).
- Two JSON objects separated by a lone CR are one line: the run fails with the quoting error (only LF splits).
- A last line with no LF is still read: a valid event is dispatched, and a not-JSON last line fails with the quoting error, also when the process exits at once.
- Output after the run has finished (and after a `protocolError`) dispatches no event and leaves the result and the error as they are.
- A run that times out with a partial line in the buffer keeps its timeout error.
- One event of more than 1 MB, written in many chunks, is read whole.
- The existing "a line that is not JSON ends the run with an error that quotes it" test stays as it is.
- In test source, the separators are written as `String.fromCharCode(0x2028)` and `0x2029`, not as raw characters, so the files stay readable for tools that read them line by line.

## Risks & Considerations

- A multi-byte UTF-8 character cut across two chunks: `setEncoding("utf8")` on stdout already
  decodes across chunk ends, so the buffer sees whole characters.
- Order of the last `data`, `end` and the process `close`: `close` fires after stdio has closed, so the
  flush on stdout `end` runs before `finish()`. The flush must not run after `finish()` or after a
  `protocolError` (`handleLine` already returns at once on a `protocolError`).
- A very long event line stays in memory until its LF, as with readline.
- Upstream has the same defect; the owner reports it upstream ("Tickets", Upstream).

## Open Questions

None.

## Constitution Check

- **I. Upstream parity**: met. The module and function names stay; the reader takes the shape of
  upstream's own `handleChunk`. The change from upstream's `readline` reader is a correctness
  difference, listed in the README section "Differences from the Codex plugin" with its reason.
- **II. Only reviewed code**: met. Code written here, after upstream's `handleChunk`; no new
  dependency.
- **III. Copilot CLI through documented interfaces only**: met. Still the documented JSON output, one
  record per line; the adapter boundary does not change.
- **IV. Safe by default**: met. No change to permissions, the read-only rule or how Copilot starts.
- **V. Cross-platform**: met. LF splitting with one CR dropped works the same on every OS; CRLF is
  tested.
- **VI. Tested, including failure paths**: met. Tests for both separators, CRLF, split and joined
  chunks, the last line with no LF, and the existing not-JSON error. Patch release with its
  `CHANGELOG.md` entry, and the release run after the merge.
