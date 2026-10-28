# Bug Assessment: a review names the untracked files behind a folder link, and Copilot can read them

- **Slug**: 149-skip-files-through-links
- **Created**: 2026-10-28
- **Source**: pasted text (issue #149, with a probe of Copilot CLI 1.0.95 made on 2026-10-28)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

Issue #149, "Read no untracked file that git reaches only through a link". #110 stopped a review
from putting the text of an untracked file whose real path is outside the repo or in a `.git` folder
into the prompt and `untracked.md`. Code review of #110 found three gaps:

- Git for Windows walks into an untracked directory junction and lists every file behind it. The
  names still reach Git Status, the changed-file list and the untracked headers, and git walks the
  whole outside tree, which can be slow.
- In self-collect mode Copilot runs in the repo with its own file tools; a junction lets them open
  files outside the repo.
- A junction to a git-ignored folder inside the repo makes git list its files as untracked. Their
  real path is inside the repo and not in `.git`, so their text is read.

Expected: a review reads no untracked file that git reaches only through a link, and sends Copilot
no names of such files; Copilot's file tools cannot reach a file through a link, or the README
states the limit.

The probe (Windows, real Copilot CLI 1.0.95, a read-only task, the same tool profile as a review):
in a repo with `linkdir` as a junction to an outside folder holding `key.txt`, Copilot's `view` tool
opened `linkdir\key.txt` and printed its marker. `glob` (`**/*.txt`) and `grep` did not follow the
junction. A second probe, in a repo with no link: `view` opened `.git/config` and printed a marker
set with `git config`.

## Symptom

On Windows, a working-tree review names each file behind an untracked junction, in Git Status, the
untracked list and (self-collect) the changed-file list, and reads the text of one whose real path is
inside the repo, such as an ignored `secrets/` folder reached through a junction. On every system,
Copilot's `view` tool can open a file through a folder link in the repo. Expected: no name or text of
such a file reaches Copilot; the link itself is shown once as skipped.

## Reproduction

1. On Windows, in a git repo, make `secrets/` with `key.txt` holding a marker, add `secrets/` to
   `.gitignore`, and make `seclink` a junction to `secrets`. Make `linkdir` a junction to a folder
   outside the repo with `key.txt`.
2. `collectReviewContext` (working tree) gives `### seclink/key.txt` with the marker's text,
   `### linkdir/key.txt (skipped: symlink)`, and `?? linkdir/key.txt` and `?? seclink/key.txt` in
   Git Status.
3. On macOS and Linux, git lists `linkdir` and `seclink` as single untracked entries (a symlink), so
   only the Copilot tool gap applies there.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/git.mjs:156` `getWorkingTreeState`: takes `git ls-files --others`
  as is; every caller (the untracked list, the changed-file list, the counts, `writeReviewPatches`)
  uses it.
- `plugins/copilot/scripts/lib/git.mjs:289` `collectWorkingTreeContext`: Git Status is a separate
  `git status --short --untracked-files=all`.
- `plugins/copilot/scripts/lib/git.mjs:251` `formatUntrackedFile`: skips the text of a file whose
  real path is outside the repo or in `.git`, but keeps its name, and reads one whose real path is
  inside (the ignored-folder case).
- `plugins/copilot/scripts/lib/copilot.mjs` `READ_ONLY_TOOLS`: `view`, `glob`, `grep`; Copilot CLI
  checks a path as written, so `view` follows a junction.

## Root Cause Hypothesis

The untracked list keeps every path git prints, and Git for Windows walks into a junction because it
treats it as a folder. The real-path check of #110 runs per file and only for the text, so the name
stays, and a link to an ignored folder inside the repo passes it. Copilot CLI's own path check uses
the path as written. Confidence: high (the code and the probe).

## Proposed Remediation

**Preferred**:

- In `getWorkingTreeState`, for each untracked path (git prints it relative to the repo root, the
  `cwd` that `collectReviewContext` and `writeReviewPatches` pass), `lstat` each folder on it, from
  the top: every part but the last, and for an entry that ends in `/` (git prints a nested repo as
  `nested/`) every part. When one is a symbolic link or a junction (Node's `isSymbolicLink()` is
  true for both), replace the path with that folder's path, once. So `linkdir/key.txt` and
  `linkdir/sub/x.txt` become one entry `linkdir`, which `formatUntrackedFile` already shows as
  `(skipped: symlink)`, as on macOS and Linux. A folder that cannot be checked counts as a link.
  An entry with no link on it stays as it is, `nested/` too. The answer for each folder is kept for
  the call, so a folder is checked once however many files lie behind it. `resolveReviewTarget` may
  pass a subfolder; git then prints paths relative to it and a link above it is not seen, but that
  caller uses only `isDirty`, which the filter does not change. `getWorkingTreeState` also returns
  the link folders it found, as `linkFolders`.
- In `collectWorkingTreeContext`, Git Status stays the one `git status --short
  --untracked-files=all` call; `dropLinkedStatusLines(status, linkFolders)` (exported from
  `git.mjs` for its test) drops each `?? ` line whose name starts with `<link folder>/`, so also a
  file that appears behind the link between the two git calls. A name that git put in double
  quotes is read back first, by `unquoteGitPath` (exported too). It never throws: an unknown escape
  keeps its character, a missing closing quote takes the rest of the line, and bytes that are not
  UTF-8 become U+FFFD, so a broken line is still dropped when its start is under a link and kept
  otherwise. git writes `\a \b \t \n \v \f \r \" \\` and
  `\ooo` (octal bytes of the UTF-8 name) inside the quotes, and quotes a name with a space too
  (checked on 2026-10-28: `?? "a b.txt"`). Reading git's quotes back, not predicting them, keeps
  the match whichever names a git version quotes. Real links collapse only on Windows, but a folder
  that cannot be checked collapses on every system. Tracked lines
  are not touched, so a tracked change under a junction stays, and no git call or argument is
  added. The `?? <link>` line is then missing from Git Status on Windows; the Untracked Files section
  shows the link.
- `formatUntrackedFile` keeps its real-path check as a second guard.
- Copilot's `view` tool: the plugin cannot limit it (Copilot CLI has no flag that makes its path
  check follow links, and a prompt line enforces nothing). The README states the limit: in a review,
  Copilot's `view` tool can open a file through a folder link or junction in the repo.
- Docs: the README bullet of #110 ("not a file behind a folder link") now says a folder link is
  shown once as a skipped entry, with no name or text behind it, and its Git Status lines are left
  out; it also states the two limits (Copilot's `view` tool, and git still walking a junction). It
  is a deliberate difference from upstream, for safety: Codex reads such files. On Windows the Git
  Status lines behind a link are dropped; elsewhere git never lists them. A tracked file reached
  through a junction keeps its name and diff, as today. The `git.mjs` header comment says the
  same. The CHANGELOG entry names the walk limit.

**Alternatives**:

- Run Git Status with `":(exclude,literal)<link>"` pathspecs, so git does not walk the link for that
  call: needs a second call for the tracked lines, and some thousand links would pass Windows'
  command-line limit, a new way for a review to fail.
- Rebuild the `??` lines of Git Status from the filtered list: one source of truth, but it copies
  git's quoting rules for names with `"`, `\` and control characters.
- Drop the via-link paths with no entry for the link: less output, but the review would not show
  that a link was skipped, and macOS and Linux already show it.

**Files likely to change**:

- `plugins/copilot/scripts/lib/git.mjs` (the filter, Git Status, the header comment)
- `tests/git.test.mjs`, `tests/runtime-review-safety.test.mjs`
- `README.md`, `plugins/copilot/CHANGELOG.md`, and the version files (`npm run bump-version -- 1.0.25`)

**Tests to add or update**: the tests that make a junction on Windows use a folder symlink
elsewhere, as the existing tests do. Git on macOS and Linux lists a folder symlink as one entry, so
the tests marked "fails on Windows" pass there today and guard the result; only the Windows CI job
shows the fix.

- `tests/git.test.mjs`, the existing test "an untracked file behind a folder link or junction ...":
  its `win32` branch, which expects `### linkdir/key.txt (skipped: symlink)` and reads
  `innerlink/ok.txt`, is removed. One set of checks then holds on every system: one `### linkdir
  (skipped: symlink)` (and the same for `sub/linkdir`, `siblink`, `gitlink`, `innerlink`), and no
  `linkdir/key.txt`, `gitlink/config` or `innerlink/ok.txt` anywhere in the output, also in Git
  Status (fails on Windows today).
- A junction or folder link to a git-ignored folder in the repo: neither its files' names nor their
  text appear; the link is shown as skipped (fails on Windows today).
- `getWorkingTreeState` on one repo: a link with two files and a subfolder behind it gives one entry;
  a link nested in a folder behind another link gives only the top link; a link named with a space
  (git quotes its `??` lines) and one with a non-ASCII letter give one entry each and no Git Status
  line behind them; a plain untracked file and an untracked folder's files stay; the summary counts
  each link once (fails on Windows today).
- `dropLinkedStatusLines` on a status text with ` M app.js`, `?? linkdir/old.txt`,
  `?? linkdir/new.txt` (a file `ls-files` never listed), `?? "link dir/a b.txt"`, `?? linkdir2.txt`
  and `?? other/x.txt`, with the link folders `linkdir` and `link dir`: only ` M app.js`,
  `?? linkdir2.txt` and `?? other/x.txt` stay (a prefix needs the `/`).
- `unquoteGitPath`: `"a\tb"` gives `a<tab>b`, `"caf\303\251"` gives `café`, `"a\qb"` (an unknown
  escape) gives `aqb`, `"linkdir/x` (no closing quote) gives `linkdir/x`, and `"linkdir/\377x"`
  (a byte that is not UTF-8) gives `linkdir/` then U+FFFD and `x`. Through `dropLinkedStatusLines`,
  the last two lines and `?? "linkdir/\qy"` are dropped under the link folder `linkdir`, and
  `?? "other/\qy"` stays.
- A nested repo: `nested/` stays as it is; a junction to a nested repo, listed as `linkdir/`, becomes
  `linkdir` (the nested repo case is a guard; the junction case fails on Windows today).
- `fs.lstatSync` mocked to throw for one folder on an untracked path, the second folder of
  `outer/inner/secret.txt` (matched by its whole resolved path, built from the real repo root,
  `fs.realpathSync.native(root)`, as the `mockRealpath` tests in `tests/git.test.mjs` do; every
  other path goes to the real function; the test also checks that the mock was called, and calls
  `getWorkingTreeState` and `collectReviewContext` with that real root): the entry collapses to
  `outer/inner`, shown as `(skipped: broken symlink or unreadable file)`
  (its own `formatUntrackedFile` call meets the same throw), and no name or text behind it appears
  in the state, in Git Status, in either context mode, or in `untracked.md`; other files stay (fails
  on the current code on every system). Skipped on Windows, a second case puts files named with a
  tab and with `"` in that folder: their quoted `??` lines are gone too. Windows cannot make such
  names, so a quoted name behind a real junction is guarded only by this mock and the
  `dropLinkedStatusLines` test.
- `unquoteGitPath`, on every system with the names it allows (a space and a non-ASCII
  letter everywhere; a tab, a newline, `"`, `\`, U+0001 and U+007F on macOS and Linux): for each
  untracked file, the name read back from its `??` line in `git status --short
  --untracked-files=all` equals its name in `git ls-files -z --others` (a guard of the function
  against git itself).
- `fs.lstatSync` counted, for that folder's path only (every call goes to the real function),
  over one `getWorkingTreeState` call, for a plain folder with three untracked files behind it: it
  is checked once.
- The stop-review-gate builds its context with `collectReviewContext` too
  (`stop-review-gate-hook.mjs`), so these tests cover it.
- The tests that check the filtered list also check `state.linkFolders`; the existing tests
  compare only `state.untracked` and the context, so the new field does not change them.
- The self-collect context (`includeDiff: false`) and `writeReviewPatches`' `untracked.md`: no name
  through a link (fails on Windows today).
- A tracked, changed file next to a link still shows in Git Status, as the first line with its
  leading space (a guard; passes today).
- Windows only: commit `tracked/file.txt`, then replace the folder `tracked` with a junction to a
  copy in which `file.txt` is changed and `new.txt` is added (checked on 2026-10-28: git then shows
  ` M tracked/file.txt` and `?? tracked/new.txt`). After the fix, Git Status keeps
  ` M tracked/file.txt` and its diff, has no `tracked/new.txt` line, and the Untracked Files section
  shows `### tracked (skipped: symlink)` (fails on Windows today).
- `tests/runtime-review-safety.test.mjs`: its `win32` branch is removed; the review test with a
  junction expects `### linkdir (skipped: symlink)` on every system, and the prompt Copilot gets
  holds no `linkdir/key.txt` (fails on Windows today).

**Checks**: `npm ci --include=dev`, `npm run build`, `npm test`, `npm run check-version`,
`claude plugin validate .`; CI on all three systems; the release run after the merge.

## Risks & Considerations

- `git ls-files --others` and `git status` still walk into a junction, so a junction to a big folder
  can be slow. Git has no option to skip it.
- Copilot's `view` tool can still open a file through a link in the repo, and quote it in its
  answer. The probe ran on Windows with a junction; the README states it as seen there, and that a
  folder symlink elsewhere is likely the same. The stop-review-gate needs no test of its own: it
  builds its context with `collectReviewContext`.
- Out of scope, and older than this change: Copilot's `view` tool opens `.git/config` directly, with
  no link (the second probe), so a token in a remote URL can reach Copilot's answer and the job file.
  That breaks Principle IV's job-file rule on main already; ticket #153 covers it.
- A tracked or changed file reached through a junction stays in the diffs and Git Status, as today.
  Git cannot track a path through a symlink; through a junction on Windows it is rare.
- The untracked count in the summary counts the link once.

## Open Questions

- None.

## Constitution Check

- **I. Upstream parity**: met. Function names and layout stay; the filter and the README limit are
  differences, recorded in the README section "Differences from the Codex plugin" and the `git.mjs`
  header.
- **II. Only reviewed code**: met. Node's `fs.lstatSync`; no new dependency.
- **III. Copilot CLI through documented interfaces only**: met. No change to how Copilot is called;
  the tool limit is documented, not worked around.
- **IV. Safe by default**: met for this change. Reviews stay read-only (no change to the tool
  profile), and the content the plugin builds (the prompt, the untracked list and the patch files)
  now holds no name or text behind a link. This plan adds no way for a credential to reach a job
  file and removes one. What Copilot's own `view` tool reads is not part of this plan: on main it
  already reads files in the repo with or without a link, `.git/config` too, and can quote them in
  its answer. That older gap against the job-file rule is #153's scope. #149's third acceptance
  criterion lets this plan state the link case in the README instead.
- **V. Cross-platform**: met. Junctions on Windows, folder symlinks elsewhere; CI runs all three.
- **VI. Tested, including failure paths**: met. Links outside, into `.git`, to an ignored folder and
  inside the repo, nested links, `nested/` entries, a folder that cannot be checked (also with
  quoted names), the quoting against git, inline and self-collect, patch files, a tracked change
  next to and under a link, and the summary count. No git call is
  added. Patch release 1.0.25 with its `CHANGELOG.md` entry, then the release run on the merge
  commit.
