# Bug Fix: a review names the untracked files behind a folder link, and Copilot can read them

- **Slug**: 149-skip-files-through-links
- **Fixed**: 2026-10-28
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`getWorkingTreeState` now turns each untracked path that git reached through a folder link or a
junction into that link folder, once, so the untracked list, the file lists, the count and
`untracked.md` show the link as skipped and nothing behind it. Git Status drops the `??` lines
under those folders. The README states the two limits the plugin cannot remove.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/git.mjs` | modified | `collapseLinkFolders` (a per-call `lstat` cache; a folder that cannot be checked counts as a link); `getWorkingTreeState` returns `linkFolders`; `unquoteGitPath` and `dropLinkedStatusLines`, exported; Git Status filtered; header comment |
| `tests/git.test.mjs` | modified, added tests | The existing link test has one set of checks on every system; new tests below |
| `tests/runtime-review-safety.test.mjs` | modified | The junction review test expects `### linkdir (skipped: symlink)` on every system and no `linkdir/key.txt` |
| `README.md` | modified | A "Differences from the Codex plugin" bullet with the two limits |
| `plugins/copilot/CHANGELOG.md` | modified | `### 1.0.25` entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | `npm run bump-version -- 1.0.25` |

## Diff Highlights (optional)

```js
for (const file of listed) {
  const parts = file.split("/").slice(0, -1);
  const link = parts.map((_, index) => parts.slice(0, index + 1).join("/")).find(isLinkFolder);
  if (!link) {
    untracked.push(file);
  } else if (!linkFolders.includes(link)) {
    linkFolders.push(link);
    untracked.push(link);
  }
}
```

## Tests Added or Updated

Git on macOS and Linux lists a folder symlink as one entry, so the tests marked "Windows" fail on
main only on Windows and guard the result elsewhere. All were run on main's `git.mjs` (with stub
exports for the two new helpers) on Windows, where the listed ones failed.

These fail on the old code:

- "an untracked file behind a folder link or junction that leads outside the repo or into .git is
  not read" (updated; Windows): one `### <link> (skipped: symlink)` for each of `linkdir`,
  `sub/linkdir`, `siblink`, `gitlink`, `innerlink`; no `### <link>/` header or `?? <link>/` line,
  and the names `linkdir/key.txt`, `siblink/key.txt`, `gitlink/config` and `innerlink/ok.txt`
  nowhere in the output, also not in the self-collect Changed Files list.
- "a junction or folder link to a git-ignored folder in the repo leaks no name or text" (Windows).
- "each untracked path behind a link becomes the link once, with no Git Status line behind it"
  (Windows): links with three files and a subfolder, a link in a folder behind a link, links
  named with a space and with `ï`; ` M app.js` stays the first Git Status line; the summary counts 6.
- "a nested repo stays one entry, and a link to a nested repo becomes the link" (Windows).
- "a folder that cannot be checked counts as a link, and no name or text behind it is shown" (every
  system): `fs.lstatSync` throws for `outer/inner`, which shows as `(skipped: broken symlink or
  unreadable file)`; on macOS and Linux also with a tab and a `"` in the names behind it.
- "a folder on many untracked paths is checked once" (every system).
- "forced status colours do not let a name behind a link into Git Status" (every system): with
  `color.status=always` and `color.ui=always`, git put a colour code before `??`, and the filter
  kept the line; the Git Status call now passes `-c color.status=false`.
- "a tracked change under a junction stays in Git Status, and the untracked file beside it is gone"
  (Windows only).
- "a review sends Copilot no file behind a folder link or junction that leads outside the repo"
  (updated, in `tests/runtime-review-safety.test.mjs`; Windows).
- "unquoteGitPath reads git's escapes and never throws on a broken name" and "dropLinkedStatusLines
  drops only the untracked lines under a link folder" (new functions).

This one guards the read-back against git itself:

- "unquoteGitPath reads back each untracked name that git status prints": a space and `é`
  everywhere; a tab, a newline, `"`, `\`, U+0001 and U+007F on macOS and Linux.

## Local Verification

- Commands run: `npm ci --include=dev` (0 vulnerabilities), `npm run build` (pass), `npm test`
  (518 tests: 476 pass, 42 skipped, 0 fail), `npm run check-version` (1.0.25),
  `claude plugin validate .` (pass), on Windows.
- Manual checks: the reproduction script on main's code showed `?? linkdir/key.txt`,
  `?? seclink/key.txt` and the ignored file's text (assessment, Report).

## Deviations from Assessment

- 2026-10-28: the assessment was written by hand in the format of `/speckit-bug-assess`, without
  running that skill.
- 2026-10-28: the README keeps the #110 bullet as it is and adds a new bullet next to it for the
  link folder, the Git Status lines and the two limits, instead of rewording the #110 bullet: the
  #110 bullet is still true, and one bullet per difference is easier to read.
- 2026-10-28, review round 1: the mocked-folder test builds its path from the root that
  `git rev-parse --show-toplevel` prints, as `makeRepoWithUntrackedFile` does, not from
  `fs.realpathSync.native(root)`: that is the root `collectReviewContext` passes on, so the mock
  matches the path the code checks, and the test asserts the mock fired. The folder check builds
  the parent path step by step and stops at the first link. A link made between the `ls-files` and
  the `status` call is not dropped from Git Status for that review (its text stays guarded by
  `formatUntrackedFile`); the next review collapses it.
- 2026-10-28, review round 2: the Git Status call passes `-c color.status=false`, which the
  assessment did not plan: a forced colour setting put a code before `??` and hid lines from the
  filter (Codex). Colour in the diffs is #61's scope.

## Follow-ups

- #153: Copilot's `view` tool reads `.git/config` with no link.
