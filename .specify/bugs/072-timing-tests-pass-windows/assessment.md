# Bug Assessment: SessionEnd overruns its 5 s timeout on Windows, and a test helper's dead pid can be alive

- **Slug**: 072-timing-tests-pass-windows
- **Created**: 2026-10-14
- **Source**: pasted text (issue #72, https://github.com/tmathura/copilot-plugin-cc/issues/72), plus
  measurements made in the ticket worktree
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

Issue #72, "Make two timing tests pass reliably on Windows":

- `tests/runtime.test.mjs:2059`, "SessionEnd stops three running jobs within 5 s, also a Copilot
  whose companion is dead, and removes only those jobs", asserts `Date.now() - started < 5000`.
  On the owner's Windows 11 machine, failing runs took 5039 to 5144 ms, a few over 6000 ms.
- `tests/state.test.mjs:669`, "an unreadable reclaim lock beside a dead lock gives an error that
  names it". `deadPid()` (`tests/state.test.mjs:36`) takes the pid of a child that has exited.
  Windows can give that pid to a new process at once. The error was then "Timed out after 200 ms
  waiting for the state lock ... Process 8180 holds the lock", not the reclaim message.

The issue asks to find each cause first, and to fix the code, not the test, when the code is slow
or wrong. No sleep, retry or larger limit without a reason.

## Symptom

1. On Windows, the SessionEnd hook takes 5.3 to 6.1 s to stop three running jobs. Claude Code gives
   the hook 5 s (`plugins/copilot/hooks/hooks.json`), and the README says the cleanup ends inside
   that timeout.
2. The reclaim-lock test sometimes meets a "dead" lock owner whose pid a new process has taken, so
   the code under test correctly treats the owner as alive and times out.

## Reproduction

SessionEnd (fails every time on the owner's machine, Windows 11, 2026-10-14):

1. `node --test --test-name-pattern="SessionEnd stops three" tests/runtime.test.mjs`
2. Failed 5 runs of 5, with 5334 to 6110 ms. Timing probes in the test showed that the test's own
   work (the close seen, the "resumed" and "other" companion runs) ends about 600 ms after the hook
   starts. The rest is the hook.
3. A scratch script timed `taskkill /PID <pid> /T /F` on idle node processes: one call takes 749 to
   1048 ms. Six calls through `spawnSync`, one after another, take 5579 ms. Six calls through async
   `spawn`, started together, take 998 ms.

Reclaim-lock test:

1. Run `npm test` (all test files in parallel) on a busy Windows machine.
2. Now and then, the pid that `deadPid()` returns belongs to a new process by the time
   `updateState` checks it. It was seen once during PR #71 and passed on rerun.
3. A scratch script found no reuse in 100 tries on an idle machine (the pid was never alive right
   after the exit, and the next child never got it), so the reuse needs many processes starting at
   once. `process.kill(2147483644, 0)` throws `ESRCH` on Windows.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/process.mjs:200-205` (`terminateProcessTree`, win32 branch): runs
  `taskkill` through `runCommand`, which is `spawnSync`. Each call blocks the event loop for about
  1 s.
- `plugins/copilot/scripts/session-lifecycle-hook.mjs:121-146` (`cleanupSessionJobs`): starts the
  stops of every job's `pid` and `copilotPid` with `Promise.all`, for "one shared wait". Because
  each stop blocks until its `taskkill` ends, three jobs make six `taskkill` calls in a row. The
  3500 ms budget (`SESSION_END_BUDGET_MS`) only limits the waits after `taskkill`, not `taskkill`
  itself.
- `tests/state.test.mjs:36-38` (`deadPid`): the pid of an exited child is not guaranteed to stay
  free.

## Root Cause Hypothesis

SessionEnd (confidence: high): the hook's design is to stop all jobs at the same time, but on
Windows each stop runs `taskkill` synchronously. The stops therefore run one after another, and the
time grows by about 1 s for each pid. Three jobs (six pids) take about 6 s, over the 5 s hook
timeout. When Claude Code stops the hook at 5 s, the last state update (which removes the stopped
jobs) may never run. The same blocking also delays `/copilot:cancel` (two pids, about 2 s instead of
1 s). The measured numbers fit: 6 x about 0.9 s plus Node start and two state updates.

Reclaim-lock test (confidence: medium): `deadPid()` relies on a freed pid staying free. On Windows,
a freed pid can go to a new process at once, and the full suite starts many processes. The error
text in the report ("Process 8180 holds the lock" after a timeout) is what the code gives for a
live owner, so the code is right and the helper is wrong.

## Proposed Remediation

**Preferred**:

1. In `plugins/copilot/scripts/lib/process.mjs`, add an exported `runCommandAsync(command, args,
   options)` next to `runCommand`, and make it the default `runCommandImpl` of
   `terminateProcessTree`. It calls `spawn` inside the promise executor (so a synchronous throw,
   such as a null byte in an argument, rejects the promise, as `spawnSync` throws), with an argument
   array, `shell: false`, `windowsHide: true`, stdin ignored, and stdout and stderr decoded with
   `setEncoding("utf8")`, so a character split across chunks stays whole. It takes only the `cwd`
   and `env` options (no `input`, `maxBuffer` or `stdio`), which a comment says. It resolves with
   the same result shape as `runCommand` (`{ command, args, status, signal, stdout, stderr, error }`):
   on `close` with the exit status and signal, or on `error` with that error and `status: null`.
   Node emits `error` before `close` for a spawn failure and does not promise a `close` after every
   `error`, so the runner settles on whichever comes first, and `close` after an `error` changes
   nothing.
   `terminateProcessTree` awaits the runner, so an injected sync `runCommandImpl` (the tests) still
   works. Every caller already awaits `terminateProcessTree`. The hook's six stops then run at the
   same time, about 1 s in all. No change to the hook.
2. In `tests/state.test.mjs`, make `deadPid()` return the fixed pid `2147483644`, and drop the
   `spawnSync` import that only it used. The pid is above the Linux `pid_max` limit of 4194304 and
   the macOS limit of 99999, so those systems never hand it out. Windows documents no ceiling, but
   it gives pids from a handle table, and they stay far below this value in practice;
   `process.kill(2147483644, 0)` throws `ESRCH` on the owner's machine. `deadPid()` asserts that
   `ESRCH` before it returns, so a system that ever has this pid alive fails with a clear message,
   not with a lock timeout.
3. The README bullet on SessionEnd in "Differences from the Codex plugin" says the cleanup ends
   inside the 5 s timeout. Add that on Windows the `taskkill` calls run at the same time, because
   Codex runs them one after another. Update the "Changed from upstream" notice at the top of
   `process.mjs`.

**Alternatives**:

- One `taskkill` call with several `/PID` arguments from the hook: fewer processes, but it changes
  the hook and the `terminateProcessTree` contract (one pid, one outcome), and one failed pid would
  mix its error with the others.
- Raise the test limit: rejected by the issue; the real hook timeout is 5 s.
- Make `deadPid()` spawn and check until the pid is dead: still a race between the check and the
  use.

**Files likely to change**:

- `plugins/copilot/scripts/lib/process.mjs`
- `tests/process.test.mjs`
- `tests/state.test.mjs`
- `README.md`
- the version files and `plugins/copilot/CHANGELOG.md` (patch release 1.0.13)

**Tests to add or update**:

- `tests/process.test.mjs`: on `win32`, two `terminateProcessTree` calls whose injected runner
  returns a promise both start their `taskkill` before either finishes, and each resolves with the
  runner's outcome. This proves on every system that a stop no longer blocks the others.
- `tests/process.test.mjs`: on `win32` with the default runner and an `env` whose `PATH` is an
  empty folder, `taskkill` is missing on every system; `terminateProcessTree` falls back to the
  injected `killImpl` and reports `method: "kill"`. This proves the default runner is wired in and
  gives the `ENOENT` shape.
- `tests/process.test.mjs`, `runCommandAsync` with real `node` children, on every system:
  - a non-zero exit gives its status and the stdout and stderr text (with a non-ASCII
    character), with no error;
  - a child stopped by `SIGTERM` gives `status: null`, `signal: "SIGTERM"` and no error (skipped on
    Windows, like the `runCommand` signal test);
  - a missing command gives `status: null` and `error.code === "ENOENT"`;
  - an argument with a null byte rejects, as `runCommand` throws;
  - it does not block: a `setImmediate` callback queued before the call has run when the result
    arrives (a synchronous runner would resolve first).
- `tests/process.test.mjs`: on `win32`, a runner whose result has an error other than `ENOENT`
  makes `terminateProcessTree` reject with that error.
- The existing SessionEnd test (`tests/runtime.test.mjs:2059`) is the Windows regression test. It
  stays as it is: its 5 s limit is the hook's real timeout.
- `tests/state.test.mjs`: only the `deadPid()` helper changes; the five tests that use it stay.

## Risks & Considerations

- The async runner must report a missing `taskkill` with `error.code === "ENOENT"`, as `spawnSync`
  does, so the `kill` fallback still runs. `spawn` reports it through the `error` event and then
  emits `close` with a made-up status (-4058 on Windows); the result keeps the error and
  `status: null`.
- Two `taskkill /T` calls on one tree (the companion and its Copilot) now run at the same time and
  can race. The outcomes are a "not found" output or a named child that exits during the wait; both
  are handled and already tested (`tests/process.test.mjs`, the missing-process and
  children-exit-during-the-wait tests), and the runner does not change that parsing.
- The runner must not add a shell (constitution Principle IV).
- `taskkill` itself has no time limit. The hook's `forceKillAfterMs` covers only the wait after a
  failed `taskkill`, so a very slow `taskkill` can still use up the 3500 ms budget. That was so
  before; the fix makes it one `taskkill` time instead of six. It is out of scope here.
- Six `taskkill` processes at once use more CPU for about 1 s; that is fine for a hook that ends the
  session.
- Upstream parity: upstream `terminateProcessTree` is synchronous on Windows. The function name,
  its arguments and its result stay the same; only the wait no longer blocks. The reason is
  correctness (the hook timeout) and platform support.

## Open Questions

None.

## Constitution Check

- **I. Upstream parity**: met. `terminateProcessTree` keeps its name, module, arguments and result;
  `runCommandAsync` is a new export beside `runCommand` and replaces no upstream function.
  The difference (async `taskkill` on Windows) is for correctness and platform support, and the
  README "Differences from the Codex plugin" bullet on SessionEnd says so. The file's
  "Changed from upstream" notice is updated.
- **II. Only reviewed code**: met. The code is written in this repo; no dependency is added.
- **III. Copilot CLI through documented interfaces only**: not relevant. No Copilot call or argument
  changes.
- **IV. Safe by default**: met. The new runner uses `spawn` with an argument array and
  `shell: false`. No review path changes; no token is logged.
- **V. Cross-platform**: met. The new code runs only on Windows; the new unit test runs on every
  system with an injected runner, and the SessionEnd test runs on Windows in CI.
- **VI. Tested, including failure paths**: met. The existing process tests cover a failed
  `taskkill` and a missing process with injected runners; the new tests cover stops that run at the
  same time, a missing `taskkill` with the default runner (the `kill` fallback), a spawn error
  other than `ENOENT`, and `runCommandAsync` itself (exit status and output, missing command, bad
  argument, no blocking). Cancel with the child stopped is covered by the SessionEnd and
  cancel tests. This is a patch release, so a release run follows the merge.
