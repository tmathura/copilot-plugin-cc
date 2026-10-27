# Bug Assessment: a review reads an untracked file behind a directory junction, outside the repo

- **Slug**: 110-skip-files-behind-junction
- **Created**: 2026-10-27
- **Source**: pasted text (GitHub issue #110)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

Summarized from #110. On Windows, a review reads a file that lies outside the repo when a directory
junction inside the repo points at it. `formatUntrackedFile`
(`plugins/copilot/scripts/lib/git.mjs`) runs `lstat` on the leaf path only. Git for Windows
descends into a junction and lists `linkdir/key.txt` as untracked; the leaf is a plain file, so its
text goes into the prompt and into `untracked.md`. A junction needs no privilege to create. The
README and the `git.mjs` header say a review never reads the target of an untracked link, which is
false on Windows. On macOS and Linux git lists a symlinked directory as one entry and does not
descend into it. The issue asks that a review never read a file whose real path is outside the repo
root, with a skip note, on every platform, with tests, a README line and a patch release.

## Symptom

On Windows, a working-tree review of a repo with an untracked directory junction that points
outside the repo puts the text of the files behind the junction into the prompt (inline) and into
`untracked.md` (above the inline limit). Expected: such a file is skipped with a note, as an
untracked file link is today.

## Reproduction

Reproduced on 2026-10-27 on Windows with the code on `main` (18527bc), from a Node script outside
the repo:

1. Make a temp folder with `outside/key.txt` (text `SECRET_OUTSIDE_MARKER`) and a repo `repo/` with
   one commit.
2. Create `repo/linkdir` as a directory junction to `outside`
   (`fs.symlinkSync(outside, link, "junction")`).
3. `getWorkingTreeState(repo).untracked` is `["linkdir/key.txt"]`.
4. `collectReviewContext(repo, resolveReviewTarget(repo, {})).content` contains
   `SECRET_OUTSIDE_MARKER`.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/git.mjs:234-266` (`formatUntrackedFile`): `lstat` of the leaf only;
  the leaf behind a junction is a plain file, so it is read.
- `plugins/copilot/scripts/lib/git.mjs:277` and `:287` (`collectWorkingTreeContext`, inline and
  lightweight context) and `:418` (`writeReviewPatches`, `untracked.md`): the three callers, all
  with the repo root as `cwd`.
- `plugins/copilot/scripts/lib/git.mjs:1-5` (header) and `README.md:294` ("Differences from the
  Codex plugin"): the claim that a review never reads the target of an untracked link.
- `tests/git.test.mjs:508` covers a file link only.

## Root Cause Hypothesis

`formatUntrackedFile` checks whether the leaf itself is a link, not whether its real path is inside
the repo. A directory junction makes the leaf a plain file whose real path is outside, and Git for
Windows lists files behind it. Confidence: high (reproduced).

## Proposed Remediation

**Preferred**: in `formatUntrackedFile`, keep the leaf-link check, and inside the same `try` also
take `fs.realpathSync.native` of the file and of the repo root (`cwd`). When
`rel = path.relative(realRoot, realFile)` is `""`, is `..`, starts with `..` followed by
`path.sep`, or is absolute (another drive), return `### <path>\n(skipped: symlink)`, the note a
file link gets today. A bare `startsWith("..")` would also skip an in-repo name such as
`..notes.txt`. Order: the leaf-link check first (a file link keeps its note), then the real-path
check, then the directory and size checks. A failed `realpath` gives the existing "broken symlink
or unreadable file" note. All three callers use this function, so the
context and `untracked.md` are both covered. Update the header comment.

**Alternatives**:
- `lstat` every path component: more calls, and the real-path check also covers a junction in any
  folder above the file inside the repo.

**Files likely to change**:
- `plugins/copilot/scripts/lib/git.mjs`
- `tests/git.test.mjs`, `tests/runtime-review-safety.test.mjs`
- `README.md` ("Differences from the Codex plugin")
- `plugins/copilot/CHANGELOG.md` and the version files (`npm run bump-version -- 1.0.22`)

**Tests to add or update**:
- `tests/git.test.mjs`: a temp folder with `outside/key.txt` (a marker) and a repo with `linkdir`
  and `sub/linkdir`, directory junctions on Windows and directory symlinks elsewhere, plus an
  ordinary untracked file in a real subfolder and one named `..notes.txt` in the root. For the
  inline context and for the lightweight context (`maxInlineFiles`), and for the files that
  `writeReviewPatches` writes: the marker is in none of them, and the ordinary files' text is. On
  Windows the test also checks the note `### linkdir/key.txt\n(skipped: symlink)`; elsewhere git
  lists `linkdir` as one link, which gets the same note under its own name.
- A sibling folder whose name starts with the repo's name (`repo` and `repo2`): a junction to
  `repo2` is still outside, so `path.relative` and not a string prefix decides.
- A junction or directory link that points inside the repo: on Windows its files are read (they are
  inside); elsewhere git lists the link itself, which the leaf check skips.
- The real-path branch on every platform: `fs.realpathSync.native` mocked (as the existing
  `fs.lstatSync` mock test does) so that a plain untracked file resolves outside the repo: the file
  is skipped with the symlink note and not read. On Windows only, a mock that resolves it to another
  drive (an absolute `path.relative`) gives the same note. Each mock matches the exact unresolved
  path it gets (the file's `path.join(root, name)`, or the root) and passes every other path to the
  real function.
- `fs.realpathSync.native` mocked to throw, once for the file and once for the root, after the stat
  checks pass: the "broken symlink or unreadable file" note, and the file is not read, in the inline
  context, the lightweight context and the files that `writeReviewPatches` writes.
- `tests/runtime-review-safety.test.mjs`: with the fake copilot CLI, a review inline and one above
  the inline limit. The marker is in neither the prompt nor any patch file the CLI captured. The
  exact skip note is in the inline prompt, and in the captured `untracked.md` above the limit. On
  macOS and Linux this test passes on the current code too (git lists the link itself), so there it
  guards against a regression; on POSIX the mocked tests above are the ones that fail before the
  fix. The companion runs in a child process, where `fs` cannot be mocked, so the acceptance item
  "a test proves it on Windows and POSIX with the fake copilot CLI" is met in full on Windows and,
  on POSIX, only as that regression guard plus the in-process mocked tests.
- The `git.mjs` header (lines 2-3) and the README bullet (lines 294-295) name directory links and
  junctions, and say that a review reads no file whose real path is outside the repo.

**Checks**: `npm ci --include=dev`, `npm run build`, `npm test`, `npm run check-version` and
`claude plugin validate .` must pass before the PR; CI runs the tests on Ubuntu, macOS and Windows.

## Risks & Considerations

- On macOS and Linux, git lists a symlinked directory as one link, which the leaf check already
  skips. So a real junction reaches the new real-path branch only on Windows (here and in CI); the
  mocked `realpathSync.native` tests run that branch on every platform. A dangling junction lists
  no file behind it, and a junction to a parent of the repo makes git walk a loop, so neither is a
  test case.
- A repo whose root is itself reached through a link: both sides are real paths, so files inside
  the repo still count as inside.
- One more `realpath` per untracked file (and one of the root): small next to reading the file.
- Accepted: a path that someone swaps for a link between the `realpath` check and the read is not
  covered; that needs a process working in the repo during the review, as for the existing leaf
  check.
- A file inside the repo reached through an inner junction is read: its real path is inside, so it
  holds nothing from outside.
- The difference from upstream (Codex reads such a file) goes in the README bullet, which now
  speaks of a file whose real path is outside the repo, and names directory links and junctions.

## Open Questions

None.

## Constitution Check

- **I. Upstream parity**: met. Function and note names stay; the change is a correctness and safety
  difference, recorded in the README section "Differences from the Codex plugin" and the `git.mjs`
  header comment.
- **II. Only reviewed code**: met. Node's `fs.realpathSync.native` and `path.relative`; no new
  dependency.
- **III. Copilot CLI through documented interfaces only**: met. No change to how Copilot is called.
- **IV. Safe by default**: met; this is the point of the fix. A review reads no file whose real path
  is outside the repo; nothing is written.
- **V. Cross-platform**: met. The test makes a junction on Windows and a directory symlink
  elsewhere; CI runs Ubuntu, macOS and Windows.
- **VI. Tested, including failure paths**: met. Junction and directory-link cases (also nested), a
  sibling-prefix folder, an inner link, a `..notes.txt` file, a mocked outside real path and another
  drive, a failed `realpath`, inline and above-limit contexts, the patch files, and a runtime review
  with the fake CLI. Patch release with its `CHANGELOG.md` entry, and the release run after the merge.
