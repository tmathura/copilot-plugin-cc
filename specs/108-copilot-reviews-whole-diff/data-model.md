# Data Model: Give Copilot reviews the whole diff of a large change

## Review context (`collectReviewContext`)

| Field | Change |
| --- | --- |
| `inputMode` | `inline-diff` when the diff is at most `maxInlineDiffBytes` (256 KB) and the file count is at most `maxInlineFiles` (default: no limit); otherwise `self-collect` |
| `collectionGuidance` | `self-collect`: asks Copilot to read every file listed below (one patch per changed file, or git's one-line note on a merge conflict, and for the working tree also `untracked.md`) to its last line, in line ranges where needed |
| others | unchanged |

## Patch folder (`jobs/<id>.patches`)

| Scope | Files |
| --- | --- |
| branch | `branch-001.patch` … one per file or submodule section of the branch diff (research §2) |
| working tree, gate | `staged-NNN.patch`, `unstaged-NNN.patch` (none for an empty diff), one per file, submodule or merge conflict section, and `untracked.md` |

- Numbers are padded to at least 3 digits, and to the digits of the patch count when it is more, so
  the names sort in diff order.
- Joined in order, the patches of one diff are its exact bytes.
- The folder is made with mode `0700`, each file with `0600` and `wx`, as today.

## Patch entry (returned by `writeReviewPatches`)

| Field | Meaning |
| --- | --- |
| `file` | absolute path of the patch file |
| `label` | the patch's first line (its `diff --git`, `diff --cc`, `Submodule` or `* Unmerged path` line, or the first line of bytes before them), or `untracked files` |
| `lines` | the file's line count, shown in the list; a last line with no new line counts (research §3) |
