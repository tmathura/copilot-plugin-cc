# Bug Verification: a review names the untracked files behind a folder link, and Copilot can read them

- **Slug**: 149-skip-files-through-links
- **Tested**: 2026-10-28
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The reproduction no longer shows the bug on Windows: a review of a repo with a junction to an
outside folder and a junction to a git-ignored folder names neither link's files and reads no text
behind them. The full suite passes with no regression; the checks ran again after review round 1.
Copilot's `view` tool reaching through a link is not changed; it is the README limit the issue
allows.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | `collectReviewContext` on a repo with `linkdir` (a junction outside) and `seclink` (a junction to the ignored `secrets/`), main's `git.mjs` | fail (as expected) | `?? linkdir/key.txt`, `?? seclink/key.txt`, both `###` headers, and the ignored file's text |
| Reproduction (post-fix) | The same with this branch's `git.mjs` | pass | ` M app.js`, `### linkdir` and `### seclink` as skipped; no name or text behind them |
| New / updated tests | `node --test tests/git.test.mjs tests/runtime-review-safety.test.mjs` | pass | The tests listed in `fix.md` as failing on the old code failed on main's code on Windows and pass now |
| Regression suite | `npm test` | pass | 517 tests: 475 pass, 42 skipped, 0 fail |
| Lint / type-check | `npm run build` | pass | `tsc` type check |
| Version and plugin | `npm run check-version`, `claude plugin validate .` | pass | 1.0.25; validation passed |

## Output Excerpts

```text
main:         ?? linkdir/key.txt
              ?? seclink/key.txt
              ### seclink/key.txt
              SECRET_IGNORED_MARKER
this branch:  M app.js
              ### linkdir
              ### seclink
```

## Residual Risks

- Git still walks into a junction, so a junction to a big folder can make a review slow.
- Copilot's `view` tool can open a file through a link in the repo (README limit); it can also open
  `.git/config` with no link (#153).
- The quoted-name cases behind a real junction cannot exist on Windows; the mocked-folder test and
  the `dropLinkedStatusLines` test guard them. CI runs the macOS and Linux cases.

## Recommendation

Close the bug: verified on Windows, where git walks into junctions; CI covers macOS and Linux.
