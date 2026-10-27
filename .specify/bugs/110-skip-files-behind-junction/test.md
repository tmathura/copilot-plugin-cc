# Bug Verification: a review reads an untracked file behind a directory junction, outside the repo

- **Slug**: 110-skip-files-behind-junction
- **Tested**: 2026-10-27
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The reproduction from the assessment no longer leaks: the file behind the junction is still listed,
but its text is not in the context. The new tests pass on Windows, they fail on `main`'s code, and
the full suite shows no regression.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | The assessment's reproduction, as a Node script outside the repo, on Windows, run on the fixed `git.mjs` | pass | `untracked: ["linkdir/key.txt"]`, marker in context: false; on `main` it was true |
| New / updated tests | `node --test --test-name-pattern="real path\|folder link or junction" tests/git.test.mjs tests/runtime-review-safety.test.mjs` | pass | 6 of 6 on Windows after review round 1, also a junction to `.git` (the other-drive test runs on Windows only) |
| Tests fail before the fix | the same tests with `main`'s `git.mjs` put back for a moment | pass | all six fail on Windows (run again after review round 1) |
| Regression suite | `npm test` | pass | 484 tests: 460 pass, 24 skipped, 0 fail (after review round 1) |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Version and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.22; validation passed |

## Output Excerpts

```text
untracked: ["linkdir/key.txt"]
marker in context: false
```

## Residual Risks

- The tests ran on Windows only here. On macOS and Linux, git lists a folder link as one entry, so
  the real-link tests and the runtime test pass there on `main`'s code too; the mocked
  `realpathSync.native` tests run the new branch there. CI runs all of them on Ubuntu, macOS and
  Windows.
- A path swapped for a link between the check and the read is not covered (accepted in the
  assessment).

## Recommendation

Close the bug once CI passes on all three systems: verified end-to-end on Windows.
