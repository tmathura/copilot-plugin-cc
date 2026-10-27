# Bug Fix: a review reads an untracked file behind a directory junction, outside the repo

- **Slug**: 110-skip-files-behind-junction
- **Fixed**: 2026-10-27
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`formatUntrackedFile` now also skips an untracked file whose real path is outside the repo or in a
`.git` folder, after the leaf-link check: it compares `fs.realpathSync.native` of the file with that
of the repo root. A file behind a directory junction (or any folder link) that leads there gets
`(skipped: symlink)`, in the inline context, the lightweight context and `untracked.md`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/git.mjs` | modified | `isOutsideWorkTree` helper (first path part `..`, any part `.git` in any case, an absolute path, or `""`); real-path check in `formatUntrackedFile` after the leaf check, in the same `try`; header comment |
| `tests/git.test.mjs` | added tests | Real junctions or folder links (outside, nested, sibling `repo2`, inner, `.git`), `..notes.txt`; mocked `realpathSync.native` (outside, a `.git` folder as `.git`, `.GIT` and nested, another drive on Windows, a throw for the file and for the root); three helpers |
| `tests/runtime-review-safety.test.mjs` | added test | A review with the fake copilot CLI, inline and above the inline limit |
| `README.md` | modified | The "Differences from the Codex plugin" bullet: no untracked file whose real path is outside the repo or in its `.git` folder, also behind a folder link or a junction |
| `plugins/copilot/CHANGELOG.md` | modified | `### 1.0.22` entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | `npm run bump-version -- 1.0.22` |

## Diff Highlights (optional)

```js
function isOutsideWorkTree(root, file) {
  const relative = path.relative(root, file);
  const [first] = relative.split(path.sep);
  return relative === "" || first === ".." || first === ".git" || path.isAbsolute(relative);
}
// in formatUntrackedFile, inside the existing try:
isLink =
  fs.lstatSync(absolutePath).isSymbolicLink() ||
  isOutsideWorkTree(fs.realpathSync.native(cwd), fs.realpathSync.native(absolutePath));
```

## Tests Added or Updated

- `tests/git.test.mjs` "an untracked file behind a folder link or junction that leads outside the
  repo or into .git is not read": `linkdir` and `sub/linkdir` to an outside folder, `siblink` to
  `repo2`, `innerlink` to a folder inside, `gitlink` to `.git` (whose config holds a marker); the
  inline context, the lightweight context and `untracked.md` hold no outside or `.git` marker and
  do hold the inside files (`sub/plain.txt`, `..notes.txt`,
  `inner/ok.txt`). On Windows the skip notes name the files behind the junctions, and the file behind
  the inner junction is read; elsewhere the links themselves are skipped.
- "an untracked file whose real path is outside the repo is skipped as a symlink" (mocked
  `realpathSync.native`; runs the new branch on every platform).
- "an untracked file whose real path is on another drive is skipped as a symlink" (Windows only).
- "an untracked file whose real path cannot be read for the file / for the repo root is skipped as
  unreadable" (two tests).
- `tests/runtime-review-safety.test.mjs` "a review sends Copilot no file behind a folder link or
  junction that leads outside the repo": the inline prompt has the exact skip note and no marker;
  above the inline limit, `untracked.md` has the note, and no captured patch file or the prompt has
  the marker.

## Local Verification

- With `main`'s `git.mjs` put back for a moment, the five new `git.test.mjs` tests and the runtime
  test fail on Windows; with the fix, all pass.
- The reproduction script from `assessment.md` ("Reproduction"): on `main` the marker is in the
  context; with the fix it is not.
- Commands run: `npm ci --include=dev` (0 vulnerabilities), `npm run build` (pass), `npm test`
  (484 tests: 460 pass, 24 skipped, 0 fail), `npm run check-version` (1.0.22),
  `claude plugin validate .` (pass).

## Deviations from Assessment

- 2026-10-27, review round 1 (`code-review`): a junction to the repo's own `.git` folder still sent
  `.git/config` (which can hold a token) to Copilot: its real path is inside the root. The check
  now also skips a real path in `<root>/.git`, by its first path part (`isOutsideWorkTree`); the
  same first-part test replaces the `..` prefix test. The real-link test adds `gitlink`; the README
  bullet, the header and the CHANGELOG name `.git`. The mocked tests now match paths built from
  git's root, which can differ from the temp folder (`/var` is `/private/var` on macOS). The root's
  `realpath` runs once per untracked file, a small call next to reading the file.
- 2026-10-27, review round 2 (Codex, `code-review`): the `.git` test now looks at every path part,
  without case: a case-insensitive file system also finds the folder as `.GIT`, and a nested
  clone's `.git` (`vendor/lib/.git`) holds a config too. A mocked test covers `.git`, `.GIT` and the
  nested folder on every platform; with the `.git` line taken out, it and the real-link test fail.
  The POSIX branch of the real-link test also checks the `siblink` and `gitlink` notes.

## Follow-ups

- Upstream codex-plugin-cc reads untracked symlink targets (the README difference); the junction
  case belongs to the same difference.
