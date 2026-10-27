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
| `README.md` | modified | The "Differences from the Codex plugin" bullet: no untracked file whose real path is outside the repo or in a `.git` folder, also behind a folder link or a junction |
| `plugins/copilot/CHANGELOG.md` | modified | `### 1.0.22` entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | `npm run bump-version -- 1.0.22` |

## Diff Highlights (optional)

```js
function isOutsideWorkTree(root, file) {
  const relative = path.relative(root, file);
  const parts = relative.split(path.sep);
  return (
    relative === "" ||
    parts[0] === ".." ||
    parts.some((part) => part.toLowerCase() === ".git") ||
    path.isAbsolute(relative)
  );
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
  do hold the inside files (`sub/plain.txt`, `..notes.txt`, `inner/ok.txt`, `.github/ci.yml`,
  `.gitattributes`). On Windows the skip notes name the files behind the junctions, and the file
  behind the inner junction is read; elsewhere the links themselves are skipped.
- "an untracked file whose real path is outside the repo is skipped as a symlink" (mocked
  `realpathSync.native`; runs the new branch on every platform).
- "an untracked file whose real path is in a .git folder, in any case, is skipped as a symlink"
  (mocked: `.git`, `.GIT` and `vendor/lib/.git`, on every platform).
- "an untracked file whose real path is on another drive is skipped as a symlink" (Windows only).
- "an untracked file whose real path cannot be read for the file / for the repo root is skipped as
  unreadable" (two tests).
- `tests/runtime-review-safety.test.mjs` "a review sends Copilot no file behind a folder link or
  junction that leads outside the repo": the inline prompt has the exact skip note and no marker;
  above the inline limit, `untracked.md` has the note, and no captured patch file or the prompt has
  the marker.

## Local Verification

- With `main`'s `git.mjs` put back for a moment (run again after review round 3), the six new
  `git.test.mjs` tests and the runtime test fail on Windows; with the fix, all pass.
- The reproduction script from `assessment.md` ("Reproduction"): on `main` the marker is in the
  context; with the fix it is not.
- Commands run (after review round 3): `npm ci --include=dev` (0 vulnerabilities), `npm run build`
  (pass), `npm test` (485 tests: 461 pass, 24 skipped, 0 fail), `npm run check-version` (1.0.22),
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
- 2026-10-27, review round 3 (`code-review`): the real-link test also reads `.github/ci.yml` and
  `.gitattributes`, names that only start with `.git`; the README says "a `.git` folder"; the
  header comment gives the reason for the case-free check (a case-insensitive file system uses a
  folder stored as `.GIT`, and `realpath` keeps that case). A Linux folder named `.Git` is skipped
  too, which fails closed.

## Follow-ups

- Upstream codex-plugin-cc reads untracked symlink targets (the README difference); the junction
  case belongs to the same difference.
