# Bug Assessment: A run without a Copilot login does not name /copilot:setup

- **Slug**: 045-setup-hint-missing-login
- **Created**: 2026-10-13
- **Source**: pasted text (issue #45). Written by hand on 2026-10-13, after the fix merged in PR #47, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: low

## Report (verbatim or summarized)

Issue #45, "Name /copilot:setup when a Copilot run fails because there is no login" (2026-10-12):

> When a task, a review or a review gate run fails because Copilot is not logged in, the plugin shows Copilot's own error ("Error: No authentication information found." and its login steps). It does not name `/copilot:setup`. Setup has advice that Copilot's steps lack. For example, `buildSetupReport` in `plugins/copilot/scripts/copilot-companion.mjs` says to set `COPILOT_GITHUB_TOKEN` on a system with no credential store, where `copilot login` saves a token that the plugin cannot read.
>
> For a missing or too old CLI, the error already ends with "rerun `/copilot:setup`" (`INSTALL_HINT`, `UPDATE_HINT` in `scripts/lib/copilot.mjs`). A missing login has no such hint.
>
> A background task has the same gap: the error goes only to the job, and `/copilot:status` and `/copilot:result` show Copilot's text.
>
> The code review of #22 found this.

## Symptom

A task, a review or a review gate run that fails because Copilot is not logged in shows only Copilot's own error. Expected: Copilot's error, plus `/copilot:setup` as the next step, in the foreground output, a background job's result and the review gate's message.

## Reproduction

1. Log out of Copilot (or use the fake CLI's `not-logged-in` mode).
2. Run `/copilot:rescue <task>` or `/copilot:adversarial-review --wait`.
3. The output is "Error: No authentication information found." and Copilot's login steps, with no `/copilot:setup`.
4. (Reconstructed from PR #47.) With the review gate on, the gate's message for the failed run shows the task's raw JSON output.

## Suspected Code Paths

At `861853c`:

- `plugins/copilot/scripts/lib/copilot.mjs:352-355` `captureTurn()`: builds "Copilot stopped before it sent a result" with Copilot's stderr, and no hint. `NOT_LOGGED_IN_PATTERN` in the same file already matches Copilot's login error.
- `plugins/copilot/scripts/copilot-companion.mjs` `describeRunFailure()`: named by the issue as a place to add the hint.

Reconstructed from PR #47 (found during the fix, not in the issue):

- `plugins/copilot/scripts/copilot-companion.mjs:600` `executeTaskRun()`: the task's JSON payload has no failure text.
- `plugins/copilot/scripts/copilot-companion.mjs:362` `executeReviewRun()`: `review --json` returns the raw stderr.
- `plugins/copilot/scripts/stop-review-gate-hook.mjs:279` `runStopReview()`: the gate's message uses `stderr || stdout`; with `--json`, that is the raw JSON.

## Root Cause Hypothesis

The adapter adds a setup hint for a missing or old CLI, but not for a missing login, although it already knows the login error pattern. Confidence: high. (Reconstructed from PR #47: the review gate reads stderr, but a `--json` task puts its reason in stdout.)

## Proposed Remediation

**Preferred**: where the plugin builds a run's failure text (`describeRunFailure` in `copilot-companion.mjs`, or the adapter), add a setup hint when Copilot's stderr matches `NOT_LOGGED_IN_PATTERN`. Keep Copilot's own text. Do not run an extra login check, because it costs a premium request. Update the README entry from #22 if its wording changes. Patch release.

**Files likely to change**:
- `plugins/copilot/scripts/lib/copilot.mjs` or `plugins/copilot/scripts/copilot-companion.mjs`
- `tests/runtime.test.mjs`
- `README.md`

**Tests to add or update**:
- With the fake `not-logged-in` Copilot: a foreground task, a background task's result and an adversarial review all name `/copilot:setup`.

## Risks & Considerations

- Copilot's login error text could change; the pattern is the only signal.
- A login check before each run would cost a premium request.

## Open Questions

- None.

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #47, not only the plan above.

- I. Upstream parity: met. The change departs from upstream for correctness, which Principle I allows, and the README lists it.
- II. Only reviewed code: met. The fix is written in this repo.
- III. Copilot CLI through documented interfaces: met. The hint is added in the adapter, which already owns `NOT_LOGGED_IN_PATTERN`; no new Copilot call.
- IV. Safe by default: met. No credentials are logged; the hint names no token value.
- V. Cross-platform: met. CI runs the tests on Windows, macOS and Linux.
- VI. Tested: met. "No login" is a Principle VI failure path; new tests cover a task, a background result, both reviews, `review --json` and the review gate.
