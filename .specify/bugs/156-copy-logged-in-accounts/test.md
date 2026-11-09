# Bug Verification: setup says "not logged in" when the token is in the Linux keyring

- **Slug**: 156-copy-logged-in-accounts
- **Tested**: 2026-11-09 (again after review round 2)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

The new tests pass with the fake Copilot CLI, the full suite passes, and the real setup on Windows
still reports "logged in" and copies nothing. The Linux keyring reproduction was not run, because
it needs the reporter's Linux system. That is the only reason the result is `partial`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `/copilot:setup` on Linux with GNOME Keyring and Copilot CLI 1.0.105 | not-run | Needs the reporter's Linux system; this session runs on Windows |
| Windows setup, real CLI | `node plugins/copilot/scripts/copilot-companion.mjs setup --json` with its own `CLAUDE_PLUGIN_DATA` | pass | `ready: true`, "logged in"; the plugin's `config.json` has no `loggedInUsers`, as before the fix |
| New / updated tests | part of `npm test` (`tests/copilot.test.mjs`, `tests/runtime-setup.test.mjs`) | pass | The letter-case test of review round 1 was taken out with its code in round 2 |
| Regression suite | `npm test` | pass | 524 tests: 482 passed, 0 failed, 42 skipped (platform-only) |
| Lint / type-check | `npm run build` | pass | `tsc` |
| Versions | `npm run check-version` | pass | All version metadata matches 1.0.26 |
| Plugin | `claude plugin validate .` | pass | Validation passed |

## Output Excerpts

```text
ℹ tests 524
ℹ pass 482
ℹ fail 0
ℹ skipped 42
All version metadata matches 1.0.26.
✔ Validation passed
```

## Residual Risks

- The fix rests on the reporter's probe that the two keys alone let Copilot CLI 1.0.105 find the
  keyring login. CI cannot check this against a real keyring.
- A later Copilot version can move or rename the keys; the copy then copies nothing, which is the
  behaviour before the fix.

## Recommendation

Merge. The owner can confirm the fix on the Linux system of the report after the update.
