# Bug Fix: SessionEnd overruns its 5 s timeout on Windows, and a test helper's dead pid can be alive

- **Slug**: 072-timing-tests-pass-windows
- **Fixed**: 2026-10-14
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`terminateProcessTree` now runs `taskkill` through a new `runCommandAsync`, which does not block
the event loop, so the stops that the SessionEnd hook and cancel start together run at the same
time. The `deadPid()` test helper now returns a fixed pid that no system hands out, and checks it.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/process.mjs` | modified | adds the exported `runCommandAsync`; `terminateProcessTree` uses it by default and awaits the runner; the "Changed from upstream" notice says so |
| `tests/process.test.mjs` | added tests | `runCommandAsync` (exit status and output, signal, missing command, bad argument, no blocking); `terminateProcessTree` on Windows (stops at the same time, `kill` fallback with the default runner, a start error other than `ENOENT`) |
| `tests/runtime.test.mjs` | modified | the unwritable job file test leaves the real stop's time out of its 1500 ms limit (scope change, see Deviations) |
| `tests/state.test.mjs` | modified | `deadPid()` returns 2147483644 after it asserts `ESRCH`; the unused `spawnSync` import is gone |
| `README.md` | modified | the SessionEnd bullet in "Differences from the Codex plugin" says that on Windows the `taskkill` calls run at the same time |
| `plugins/copilot/CHANGELOG.md`, version files | modified | patch release 1.0.13 |

## Diff Highlights (optional)

```js
const runCommandImpl = options.runCommandImpl ?? runCommandAsync;
...
const result = await runCommandImpl("taskkill", ["/PID", String(pid), "/T", "/F"], { ... });
```

```js
child.on("error", (error) => resolve({ command, args, status: null, signal: null, stdout, stderr, error }));
child.on("close", (status, signal) => resolve({ command, args, status, signal, stdout, stderr, error: null }));
// With no file handles left (EMFILE), Node makes no pipes and reports the error on the next tick.
child.stdout?.setEncoding("utf8");
```

## Tests Added or Updated

- `tests/process.test.mjs`, "runCommandAsync gives the exit status and the output of a command that
  fails": status, UTF-8 stdout and stderr, no error.
- "runCommandAsync reports a command killed by a signal with no exit status" (not on Windows).
- "runCommandAsync reports a missing command as ENOENT with no exit status".
- "runCommandAsync rejects an argument that no command can receive, as runCommand throws".
- "runCommandAsync does not block the event loop while the command runs".
- "terminateProcessTree on Windows lets stops started together run at the same time": both
  `taskkill` calls start before either ends. It fails on the old code, which did not await the
  runner.
- "terminateProcessTree on Windows falls back to kill when taskkill cannot be found": the default
  runner with an empty `PATH`.
- "terminateProcessTree on Windows rejects with a taskkill start error other than a missing
  command".
- `tests/state.test.mjs`, `deadPid()`: used by five lock tests, unchanged.
- `tests/runtime.test.mjs`, the SessionEnd test: unchanged; it is the Windows regression test.

## Local Verification

- `node --test --test-name-pattern="SessionEnd stops three" tests/runtime.test.mjs`, 5 runs: before
  the fix 5 failed (hook 5334 to 6110 ms); after the fix 5 passed (whole test 3514 to 3813 ms,
  about 7 s before).
- `node --test tests/process.test.mjs tests/state.test.mjs` → 64 passed, 0 failed, 8 skipped.
- On the final code, `node --test tests/runtime.test.mjs` passed 20 runs of 20, and
  `node --test tests/state.test.mjs` passed 20 runs of 20 (see `test.md`).
- `npm test` → 262 passed, 0 failed, 14 skipped.
- `npm run build` → passed (after `npm ci` in the new worktree).
- `npm run check-version` → all version metadata matches 1.0.13.
- `claude plugin validate .` → passed.

## Deviations from Assessment

- 2026-10-14, code review before the first commit: `runCommandAsync` adds its `error` and `close`
  listeners before it touches the pipes, and reads them with `?.`. For `EMFILE` and `ENFILE`, Node
  makes no pipes and emits `error` on the next tick, so the old order threw a `TypeError` and left
  that `error` with no listener, which crashes the process. No test: `EMFILE` cannot be caused on
  demand without a fake `spawn`.
- 2026-10-14, scope change approved by the owner: a 20-run loop of `tests/runtime.test.mjs` failed
  3 runs of 20, each time in "SessionEnd still closes the session and stops a job whose job file
  cannot be written" (`tests/runtime.test.mjs:2216`), one of 8 runs showing 1603 ms against its
  1500 ms limit. A timing script showed the cleanup without the stop takes a steady 228 to 248 ms,
  and the one real `taskkill` takes 746 to 1401 ms, the same on `main` (890 to 1257 ms, totals up to
  1497 ms). The limit is there to tell the 200 ms job file retry from the state's 2 s retry; the
  stop has nothing to do with it. The test now wraps the real `terminateProcessTree` and leaves its
  time out of the limit, which stays 1500 ms.

## Follow-ups

- `taskkill` itself has no time limit (assessment, Risks). Out of scope.
