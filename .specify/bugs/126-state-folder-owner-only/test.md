# Bug Verification: the state folder and job files are readable by others under CLAUDE_PLUGIN_DATA

- **Slug**: 126-state-folder-owner-only
- **Tested**: 2026-10-27 (again after review round 3)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

The fix is in place and the full suite passes on Windows with no regression, but the reproduction
and the 18 mode tests apply only to macOS and Linux and did not run here. CI on Ubuntu and macOS runs
them; the result becomes verified when they pass there.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | The assessment's steps (a 0755 data folder, umask 022) | not-run | Unix modes only; this machine is Windows, and WSL is not reachable from the session. `tests/state-modes.test.mjs` covers the steps in CI |
| New / updated tests | `node --test tests/state-modes.test.mjs` | skipped | 18 tests, all skipped on Windows; they run in CI on Ubuntu and macOS |
| Regression suite | `npm test` | pass | 503 tests: 461 pass, 42 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Version and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.23; validation passed |

## Output Excerpts

```text
node --test tests/state-modes.test.mjs
ℹ tests 18
ℹ pass 0
ℹ skipped 18
```

## Residual Risks

- The mode tests have not run yet; a mistake in them shows only in CI.
- A folder or log that the plugin cannot change stays open (accepted in the assessment).

## Recommendation

Hold the merge until CI on Ubuntu and macOS passes the 18 mode tests; then the fix is verified.
