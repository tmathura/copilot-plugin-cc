# Bug Verification: a branch review fails when the default branch exists only on the remote

- **Slug**: 112-use-remote-default-branch
- **Tested**: 2026-10-27
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The reproduction from the assessment no longer fails: in a `git clone -b feature` clone, the base is
`origin/main` and the review context is collected. The new tests pass, and the full suite shows no
regression.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | The assessment's reproduction, as a Node script outside the repo, run on the fixed `git.mjs` | pass | `baseRef: origin/main`, context collected; on `main` it failed at `merge-base HEAD main` |
| New / updated tests | `node --test --test-name-pattern="default branch\|origin" tests/git.test.mjs` | pass | 8 of 8 (after review round 2), also the existing special-character and no-default-branch tests |
| Tests fail before the fix | the same file with `main`'s `git.mjs` put back for a moment | pass | the 4 remote-only tests fail; the local-case test passes, as planned |
| Regression suite | `npm test` | pass | 443 tests: 419 pass, 24 skipped, 0 fail (after review round 2) |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Version and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.21; validation passed |

## Output Excerpts

```text
origin/HEAD: refs/remotes/origin/main
local branches: refs/heads/feature
baseRef: origin/main
context: ok
```

## Residual Risks

- An `origin/HEAD` that points at a missing ref still fails at `merge-base`, now with
  `origin/<name>`; this is today's failure, kept on purpose and pinned by a test.
- The tests ran on Windows only here; CI runs them on Ubuntu, macOS and Windows.

## Recommendation

Close the bug once CI passes on all three systems: verified end-to-end.
