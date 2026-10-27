# Bug Assessment: a task whose prompt holds a double quote fails before Copilot starts

- **Slug**: 151-safe-session-name
- **Created**: 2026-10-27
- **Source**: pasted text (issue #151, with a probe of Copilot CLI 1.0.95 made on 2026-10-27)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

Issue #151, "Fix release run step 4 of v1.0.23". Release run step 4 of v1.0.23 started a background
`task --write` with the prompt `Add the comment line "// Checked by the release run." at the top of
math.js. Change no other file.` It failed at once, before Copilot ran:

```text
Copilot stopped before it sent a result (exit 1).
Session name must not contain double quotes.
```

`buildTaskThreadName` (`plugins/copilot/scripts/lib/copilot.mjs:89`) makes the session name from the
first 56 characters of the prompt, and `copilot.mjs:212` passes it as `--name=<name>`. Copilot CLI
1.0.95 refuses a name with a `"`. The same task without the quotes completed. The defect is older
than v1.0.23, which changed only the modes of the state folders and job files (#126).

The probe ran the real Copilot CLI 1.0.95 on Windows with `--model=no-such-model-xyz`, so a name
that passes fails at the model check and no model call runs. `--name` refuses:

| Name holds | Copilot CLI says |
| --- | --- |
| `"` | Session name must not contain double quotes. |
| tab, U+0001, U+007F | Session name must not contain control characters. |
| more than 100 UTF-16 units (60 emoji) | Session name must be 100 characters or less. |
| nothing | Session name cannot be empty. |

It accepts `'`, a backtick, `\`, `$ % < > | & ; : / #`, non-ASCII letters, emoji, U+2028, the C1
controls U+0085 and U+009F, a lone surrogate, a leading `-`, and exactly 100 characters.

## Symptom

A `/copilot:rescue` or `task` whose prompt holds a double quote, or an ASCII control character that
is not white space, in its first 56 characters fails before Copilot starts, in the foreground and
the background. Expected: the task runs whatever its prompt holds, and the session name still starts
with the start of the prompt.

## Reproduction

1. In a git repo, run `node plugins/copilot/scripts/copilot-companion.mjs task 'Say "hi".'` with the
   real Copilot CLI 1.0.95.
2. The task fails with "Session name must not contain double quotes." and no Copilot turn runs.
3. The same with `Say hi.` completes.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/copilot.mjs:89` `buildTaskThreadName`: puts `shorten(prompt, 56)`
  after the prefix `Copilot Companion Task: ` with no filter.
- `plugins/copilot/scripts/lib/copilot.mjs:78` `shorten`: folds white space runs into one space and
  cuts to 56, so a tab or newline never reaches the name, but `"` and the other ASCII controls do.
- `plugins/copilot/scripts/lib/copilot.mjs:212`: passes the name as `--name=<name>`.
- `plugins/copilot/scripts/copilot-companion.mjs:599`: the only caller, through
  `buildPersistentTaskThreadName`; a resume passes no name.

## Root Cause Hypothesis

The name comes from the prompt with only white space folded. Codex's app server takes any thread
name, so upstream never filtered it; Copilot CLI checks `--name` and refuses `"` and ASCII control
characters. The other two rules hold already: the name is at most 24 + 56 = 80 UTF-16 units, and it
falls back to the bare prefix, so it is never empty. Confidence: high (the probe shows each rule).

## Proposed Remediation

**Preferred**: in `buildTaskThreadName`, replace each `"` and each ASCII control character
(U+0000 to U+001F and U+007F) in the prompt with a space before `shorten`, so `shorten` folds the
spaces and the 56-character cut and the empty fallback stay as they are. The prompt that Copilot
receives does not change; only the session name does. One line, in the one place where the name is
built.

**Alternatives**:

- Remove the characters instead of replacing them: `"word"` stays readable either way, but
  `a\u0001b` would join two words. A space is closer to what `shorten` already does with white space.
- Drop `--name` for tasks: no failure, but the user can no longer find the task's session in Copilot
  by its name, which the issue asks to keep.

**Files likely to change**:

- `plugins/copilot/scripts/lib/copilot.mjs` (the filter, and the header comment)
- `tests/fake-copilot-fixture.mjs` (the fake CLI refuses a name as the real one does)
- `tests/runtime-task.test.mjs` (task runs with such prompts)
- `README.md` (a "Differences from the Codex plugin" bullet)
- `plugins/copilot/CHANGELOG.md`, and the version files through `npm run bump-version -- 1.0.24`

**Tests to add or update**:

- The fake CLI (a template string in `tests/fake-copilot-fixture.mjs`, so each `\` in its regular
  expressions is doubled) checks `--name` like Copilot CLI 1.0.95: a `"` or an ASCII control
  character, more than 100 UTF-16 units, or an empty value fails with exit 1 and the real message
  on stderr, before any event. The check runs after the run record is written, so a test sees the
  refused name in `runs()`. Every run through the fake CLI that passes `--name` is then checked: in
  `tests/runtime-task.test.mjs` the task tests (for example the ones at lines 95, 117 and 195).
  `tests/copilot.test.mjs:97` builds the arguments without the fake CLI and is not covered by it.
- Direct runs of the fake CLI with each refused name (`a"b`, a tab, U+0001, U+007F, 101 characters,
  60 emoji, empty) give exit 1, the matching message and no event; `'`, non-ASCII and exactly 100
  characters pass. These check the fake CLI's rules themselves.
- A foreground `task --write` and a foreground read-only task with the prompt from the release run
  complete (exit 0); the run's `--name` is the prefix and the start of the prompt with the quotes
  gone (they become spaces, which `shorten` folds), and the prompt Copilot receives still holds the
  quotes. These fail on the current code.
- A background task with a `"` reaches job status `completed`, and its result holds no refusal
  (fails on the current code).
- `buildPersistentTaskThreadName` (exported) with U+0000, U+0001, U+0008, U+001F and U+007F (the
  ends of the range and a control that is not white space) gives spaces in their place
  (fails on the current code); with only `"` characters, an empty or white-space prompt, the bare
  prefix `Copilot Companion Task` (the quote case fails on the current code); with 60 emoji, a name
  of at most 100 UTF-16 units; with `'`, a backtick, `\` and non-ASCII letters, those characters
  kept (these last two pass on the current code too; they guard the length rule and against a
  filter that takes too much).

**CHANGELOG**: a new `### 1.0.24` entry above `### 1.0.23`. It gives this fix and repeats the 1.0.23
change, because 1.0.23 is not published and the release notes take only the 1.0.24 entry. The
1.0.23 entry stays as it is.

**Checks**: `npm ci --include=dev`, `npm run build`, `npm test`, `npm run check-version` and
`claude plugin validate .`; CI on Ubuntu, macOS and Windows; after the merge, the release run, with
step 4's prompt holding double quotes again.

## Risks & Considerations

- The probe ran on Windows only. The check is Copilot CLI's own, so macOS and Linux should give the
  same answers, but CI uses the fake CLI and cannot show it.
- A later Copilot CLI may refuse more characters. The fake CLI copies 1.0.95's rules, so a new rule
  shows only in the release run or a user report.
- Session names that users already have keep their quotes; only new tasks change.
- Not an upstream defect: Codex's app server takes the name as is.

## Open Questions

- None.

## Constitution Check

- **I. Upstream parity**: met. `buildTaskThreadName` keeps upstream's name and shape; the filter is a
  difference that Copilot CLI needs, recorded in the README section "Differences from the Codex
  plugin" and the `copilot.mjs` header.
- **II. Only reviewed code**: met. A regular expression; no new dependency.
- **III. Copilot CLI through documented interfaces only**: met. `--name` stays; the plugin now passes
  only values that Copilot CLI accepts.
- **IV. Safe by default**: met. The prompt is unchanged; the name holds less.
- **V. Cross-platform**: met. A string change; the tests run on all three systems in CI.
- **VI. Tested, including failure paths**: met. The fake CLI refuses what the real one refuses, so
  every task test checks the name; tests cover the quote, control characters, an empty excerpt, and
  the characters that must stay. Patch release 1.0.24, whose `CHANGELOG.md` entry also gives the
  unpublished 1.0.23 change, then the release run after the merge.
