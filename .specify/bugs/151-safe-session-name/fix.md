# Bug Fix: a task whose prompt holds a double quote fails before Copilot starts

- **Slug**: 151-safe-session-name
- **Fixed**: 2026-10-27
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`buildTaskThreadName` now puts a space in place of each `"` and each ASCII control character
(U+0000 to U+001F, U+007F) before `shorten` folds and cuts the excerpt, so the session name holds
nothing that Copilot CLI 1.0.95 refuses. The prompt that Copilot receives is unchanged.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/copilot.mjs` | modified | The filter in `buildTaskThreadName`, with a comment; header comment |
| `tests/fake-copilot-fixture.mjs` | modified | The fake CLI refuses an empty `--name`, one over 100 characters, or one with `"` or an ASCII control character, after it writes its run record |
| `tests/copilot.test.mjs` | added tests | The name builder; the fake CLI's name rules |
| `tests/runtime-task.test.mjs` | added tests | Foreground (read-only and `--write`) and background tasks with a quoted prompt |
| `README.md` | modified | A "Differences from the Codex plugin" bullet |
| `plugins/copilot/CHANGELOG.md` | modified | `### 1.0.24` entry, which also repeats the unpublished 1.0.23 change |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | `npm run bump-version -- 1.0.24` |

## Diff Highlights (optional)

```js
// Copilot CLI refuses a --name that holds a double quote or an ASCII control character.
function buildTaskThreadName(prompt) {
  const excerpt = shorten(String(prompt ?? "").replace(/["\u0000-\u001f\u007f]/g, " "), 56);
  return excerpt ? `${TASK_THREAD_PREFIX}: ${excerpt}` : TASK_THREAD_PREFIX;
}
```

## Tests Added or Updated

These fail on the old code:

- `tests/runtime-task.test.mjs`, "a task whose prompt holds double quotes runs, and only its session
  name loses them": the release run's prompt, read-only and `--write`, exit 0; the `--name` is
  `Copilot Companion Task: Add the comment line // Checked by the release run. a...`; Copilot gets
  the prompt with its quotes.
- `tests/runtime-task.test.mjs`, "a one-string task prompt that keeps its double quotes through the
  split runs": `task 'Don'\''t add "x" here'` as one argument, exit 0; the `--name` is
  `Copilot Companion Task: Dont add x here`.
- `tests/runtime-task.test.mjs`, "a background task whose prompt holds double quotes completes": job
  status `completed`, the result is the answer with no refusal, and the prompt keeps its quotes.
- `tests/copilot.test.mjs`, "a task's session name holds no character that Copilot CLI refuses, and
  keeps the rest": U+0000, U+0001, U+0008, U+001F, U+007F and `"` become a space; a prompt of
  only `""` gives the bare prefix.

These pass on the old code too:

- The same unit test: an empty or white-space prompt gives the bare prefix; 60 emoji give at most
  100 UTF-16 units; `'`, a backtick, `\` and `café` stay.
- `tests/copilot.test.mjs`, "the fake Copilot CLI refuses the session names that Copilot CLI 1.0.95
  refuses": `a"b`, a tab, U+0001, U+007F, 101 characters, 60 emoji and an empty name give exit 1,
  the real message and no output; `a'b`, `café` and 100 characters pass.
- Every other task test now runs through the stricter fake CLI.

## Local Verification

- Commands run: `npm run build` (pass), `npm test` (508 tests: 466 pass, 42 skipped, 0 fail),
  `npm run check-version` (1.0.24), `claude plugin validate .` (pass).
- Before the fix, the three tests listed as failing on the old code failed: the runtime ones with
  the fake CLI's "Session name must not contain double quotes.", the unit one with the U+0000 kept.

## Deviations from Assessment

- 2026-10-27: the foreground read-only test passes `--fresh` with the prompt. With one argument
  after `task`, the companion splits it again like a shell line (`normalizeArgv`, open issue #111).
  The split drops a `"` that opens or closes a quoted span, so the release run's prompt given as
  one string reaches Copilot without its quotes. That is main's behaviour and #111's scope; the
  test checks the prompt that Copilot receives, so it takes the many-argument path.
- 2026-10-27, review round 1: for the same reason, the assessment's Reproduction (`task 'Say
  "hi".'`, one argument) does not show the bug on main: its quotes go in the split. `test.md`
  reproduces it with `task --fresh`.
- 2026-10-27, review round 2: the two entries above first said that a one-string prompt never
  reached the name with its quotes, and that the assessment's Symptom said too much. That was
  wrong, and they are corrected. A one-string prompt can reach the name with its quotes: an apostrophe opens a single-quoted span that keeps a `"`
  (`Don't add "x" here` splits to `Dont add "x" here`), and so does `\"`. So the assessment's
  Symptom holds for the bare `/copilot:rescue` form too. A new runtime test runs such a one-string
  prompt.

## Follow-ups

- #111 keeps every quote of a one-string prompt; this fix keeps such a prompt's session name valid
  then.
