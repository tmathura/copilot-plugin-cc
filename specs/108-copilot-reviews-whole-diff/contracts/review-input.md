# Contract: the review input that Copilot gets

## Inline (diff at most 256 KB)

The prompt's review input is the context `content`, as today: the commit log, the diff stat and the
branch diff, or the git status, the staged and unstaged diffs and the untracked files. No
`--add-dir`.

## Patch folder (diff above 256 KB)

The guidance line:

> The repository context below is a lightweight summary. Read every file listed below with the
> view tool before finalizing findings. Each patch file holds the diff of one changed file. The
> list gives the line count of each file. The view tool cuts a long read, so read each file to
> its last line, in line ranges where needed.

The review input ends with:

```text
## Patch Files

- <folder>/branch-001.patch (<n> lines): diff --git a/<path> b/<path>
- <folder>/branch-002.patch (<n> lines): diff --git a/<old> b/<new>
- <folder>/branch-003.patch (<n> lines): Submodule <path> <old>..<new>:
```

Each label is the first line of its patch.

For the working tree: the `staged-NNN.patch` entries, then `unstaged-NNN.patch`, then
`- <folder>/untracked.md (<n> lines): untracked files`. Copilot gets `--add-dir=<folder>`, as today.
