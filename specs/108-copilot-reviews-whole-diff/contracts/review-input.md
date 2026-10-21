# Contract: the review input that Copilot gets

## Inline (diff at most 256 KB)

The prompt's review input is the context `content`, as today: the commit log, the diff stat and the
branch diff, or the git status, the staged and unstaged diffs and the untracked files. No
`--add-dir`.

## Patch folder (diff above 256 KB)

The guidance line:

> The repository context below is a lightweight summary. Read every patch file listed below with
> the view tool before finalizing findings. Each one holds the diff of one changed file, and the
> list gives its size. The view tool cuts a long read, so read each file to its end, in line
> ranges where needed.

The review input ends with:

```text
## Patch Files

- <folder>/branch-001.patch (<size> bytes): diff --git a/<path> b/<path>
- <folder>/branch-002.patch (<size> bytes): diff --git a/<old> b/<new>
- <folder>/branch-003.patch (<size> bytes): Submodule <path> <old>..<new>:
```

Each label is the first line of its patch.

For the working tree: the `staged-NNN.patch` entries, then `unstaged-NNN.patch`, then
`- <folder>/untracked.md (<size> bytes): untracked files`. Copilot gets `--add-dir=<folder>`, as today.
