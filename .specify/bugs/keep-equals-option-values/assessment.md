# Bug Assessment: A long option value loses everything after its second equals sign

- **Slug**: keep-equals-option-values
- **Created**: 2026-10-13
- **Source**: pasted text (issue #17). Written by hand on 2026-10-13, after the fix merged in PR #38, for #59. The bug skills were not run.
- **Verdict**: valid
- **Severity**: low

## Report (verbatim or summarized)

Issue #17, "Keep equals signs in long option values" (2026-10-08):

> `parseArgs` in `plugins/copilot/scripts/lib/args.mjs` splits a long option with `token.slice(2).split("=", 2)`. JavaScript's `split` with a limit drops everything after the second piece, so `--option=a=b` gives the value `a` instead of `a=b`. A value that contains `=` is cut short without any error, for example `--base=refs/x=y` or a `--model` or focus value with `=` in it.
>
> This bug comes from upstream codex-plugin-cc (commit `db52e28`). #7 copied `args.mjs` unchanged under T021.

## Symptom

`parseArgs(["--option=a=b"], { valueOptions: ["option"] })` gives `option: "a"`. Expected: `option: "a=b"`. No error tells the user that the value was cut.

## Reproduction

1. Call `parseArgs(["--base=refs/x=y"], { valueOptions: ["base"] })`.
2. The result has `base: "refs/x"`.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/args.mjs:28` (at `a1db422`): `const [rawKey, inlineValue] = token.slice(2).split("=", 2);`. A split with a limit drops the rest of the text.

## Root Cause Hypothesis

`String.prototype.split` with a limit returns at most that many pieces and discards the rest. It does not keep the remainder in the last piece. Confidence: high.

## Proposed Remediation

**Preferred**: split a long option at the first `=` only, and keep the rest of the token as the value. Change nothing else in `parseArgs` or `splitRawArgumentString`. Add the upstream change notice to the top of `args.mjs`, and add the change to the README section "Differences from the Codex plugin" (correctness).

**Files likely to change**:
- `plugins/copilot/scripts/lib/args.mjs`
- `tests/args.test.mjs` (new)
- `README.md`

**Tests to add or update**:
- `--option=a=b` gives `a=b`, and `--option=` gives an empty string.
- `--flag`, `--flag=false`, `--option value`, `-x value` and `--` keep their behaviour.

## Risks & Considerations

- Every command parses its arguments here, so a mistake changes every command. The tests for the old behaviour guard against that.
- A boolean option written as `--flag=false` must still be false.

## Open Questions

- None.

## Constitution Check

Checked by hand against constitution v1.2.0, on 2026-10-13. It was written after the fix, so it judges the merged fix in PR #38, not only the plan above.

- I. Upstream parity: met. The change departs from upstream for correctness, which Principle I allows. The README section "Differences from the Codex plugin" lists it, and `args.mjs` gets the change notice.
- II. Only reviewed code: met. The fix is written in this repo.
- III. Copilot CLI through documented interfaces: not relevant. No Copilot call changes.
- IV. Safe by default: not relevant. Argument parsing does not change permissions.
- V. Cross-platform: met. Plain string code; CI runs the tests on Windows, macOS and Linux.
- VI. Tested: met. A new `tests/args.test.mjs` covers the bug and the old behaviour.
