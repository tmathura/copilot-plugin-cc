# Bug Verification: the state folder and job files are readable by others under CLAUDE_PLUGIN_DATA

- **Slug**: 126-state-folder-owner-only
- **Tested**: 2026-10-27 (locally after review round 3, and in CI on PR #150)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The fix holds. The full suite passes on Windows with no regression. The 18 mode tests, which cover
the reproduction (a 0755 data folder, umask 022) and skip on Windows, passed in CI on Ubuntu and
macOS on the PR head 9326446.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | The assessment's steps (a 0755 data folder, umask 022), as the first tests in `tests/state-modes.test.mjs` | pass | In CI on Ubuntu and macOS; not on this Windows machine, which has no Unix modes |
| New / updated tests | `npm test` in CI (`CI (ubuntu-latest)`, `CI (macos-latest)`, run 40563294064) | pass | All 18 tests ran and passed on both, none skipped |
| Regression suite | `npm test` | pass | Windows: 503 tests, 461 pass, 42 skipped, 0 fail. Ubuntu and macOS CI: 503 tests, 498 pass, 5 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Version and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.23; validation passed |

## Output Excerpts

```text
CI (ubuntu-latest) and CI (macos-latest), npm test:
ok 427 - under CLAUDE_PLUGIN_DATA the state folders and job files are owner-only, and the data folder is left alone
# tests 503
# pass 498
# fail 0
# skipped 5
```

## Residual Risks

- A folder or log that the plugin cannot change stays open (accepted in the assessment).

## Recommendation

Close the bug: verified by the mode tests in CI on Ubuntu and macOS.
