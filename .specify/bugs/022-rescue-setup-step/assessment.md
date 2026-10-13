# Bug Assessment: /copilot:rescue gives an empty answer when Copilot cannot run

- **Slug**: 022-rescue-setup-step
- **Created**: 2026-10-13
- **Source**: pasted text (issue #22 and its comments). Written by hand on 2026-10-13, after the fix merged in PR #46, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

Issue #22, "Show the /copilot:setup step when rescue cannot run Copilot" (2026-10-09):

> `/copilot:rescue` cannot tell the user to run `/copilot:setup` when Copilot is missing, too old or not logged in.
>
> - `plugins/copilot/commands/rescue.md` says: "If the helper reports that Copilot is missing or unauthenticated, stop and tell the user to run `/copilot:setup`." But the helper, `task-resume-candidate --json`, only returns `available`, `sessionId` and `candidate`. It never checks the CLI, so this rule can never fire.
> - The `copilot-rescue` agent and the `copilot-cli-runtime` skill say: "If the Bash call fails or Copilot cannot be invoked, return nothing." The companion's `task` error does name the fix [...], but the subagent drops it.
> - So a missing or logged-out Copilot gives the user an empty answer.
>
> Upstream codex-plugin-cc (commit `db52e28`) has the same flaw.

Comment (2026-10-11): already reported upstream as openai/codex-plugin-cc#350.

## Symptom

When Copilot is missing, too old or not logged in, `/copilot:rescue` returns nothing. Expected: the user sees the reason and, where it applies, `/copilot:setup` as the next step. A normal rescue still returns Copilot's answer verbatim.

## Reproduction

1. Remove the Copilot CLI from `PATH` (or put an old version first).
2. Run `/copilot:rescue <task>`.
3. The companion's `task` call fails with "Copilot CLI is not installed (...). Install it with `npm install -g @github/copilot`, then rerun `/copilot:setup`."
4. The subagent follows "return nothing", so the user sees an empty answer.

Steps 2 and 4 need a live Claude Code session; the tests check the rule text and the companion output instead.

## Suspected Code Paths

At `1e29b92`:

- `plugins/copilot/agents/copilot-rescue.md:42`: "If the Bash call fails or Copilot cannot be invoked, return nothing."
- `plugins/copilot/skills/copilot-cli-runtime/SKILL.md:43`: the same rule.
- `plugins/copilot/commands/rescue.md:49`: the helper rule that can never fire, because `task-resume-candidate` does not check the CLI.

## Root Cause Hypothesis

The instruction text tells the subagent to drop a failed command's output, and the only rule that names `/copilot:setup` depends on data that the helper never returns. The companion already gives a correct error. Confidence: high.

## Proposed Remediation

**Preferred** (the issue offered two ways, and asked to pick one):
- the helper reports readiness (for example `task-resume-candidate` adds the result of the version check), so `rescue.md` can stop before routing; or
- the subagent returns the companion's stderr when `task` fails before Copilot starts, instead of nothing.

Record the decision in the spec folder (a new spec or a dated entry, per `docs/development.md` "Keeping the spec current"). Either way, do not run the login check on every rescue (it costs a premium request). Change `rescue.md`, `agents/copilot-rescue.md` and `skills/copilot-cli-runtime/SKILL.md` together, and add the change to the README section "Differences from the Codex plugin" (correctness).

**Files likely to change**:
- `plugins/copilot/commands/rescue.md`
- `plugins/copilot/agents/copilot-rescue.md`
- `plugins/copilot/skills/copilot-cli-runtime/SKILL.md`
- `tests/commands.test.mjs`
- `README.md`

**Tests to add or update**:
- With the CLI missing, and with an old CLI, the rescue path gives a message that names `/copilot:setup`.
- A normal rescue still returns Copilot's output verbatim.
- `tests/commands.test.mjs` checks the new rules in the three files.

## Risks & Considerations

- The agent and the skill must carry the same rule, as upstream's do.
- A login check on every rescue would cost a premium request.

## Open Questions

- None left. The choice was made in the issue comment of 2026-10-12 (see `fix.md`).

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #46, not only the plan above.

- I. Upstream parity: met. The change departs from upstream for correctness, which Principle I allows, and the README lists it.
- II. Only reviewed code: met. The text is written in this repo.
- III. Copilot CLI through documented interfaces: met. No new Copilot call; the companion's existing checks give the error.
- IV. Safe by default: met. No permission changes; `--write` rules are unchanged.
- V. Cross-platform: met. Text only, plus tests that CI runs on Windows, macOS and Linux.
- VI. Tested: met. A missing CLI and an old CLI are tested with the `/copilot:setup` step. A missing login is tested too: it shows Copilot's own login steps, and its `/copilot:setup` hint moved to #45. Principle VI lists these failure paths.
