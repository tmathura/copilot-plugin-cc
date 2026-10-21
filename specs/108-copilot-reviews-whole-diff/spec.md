# Feature Specification: Give Copilot reviews the whole diff of a large change

**Feature Branch**: `feature/108-copilot-reviews-whole-diff`

**Created**: 2026-10-21

**Status**: Draft

**Input**: GitHub issue #108, "Give Copilot reviews the whole diff of a large change".

## Clarifications

### Session 2026-10-21 (plan review)

- Q: How does the split treat `--submodule=diff` output? → A: a `Submodule` line also starts a
  patch, and the next `diff --git` line starts the next one; bytes before the first header go into
  the first patch (research §2).
- Q: Does the untracked text need a new limit now that the file limit is gone? → A: no; it is in
  the prompt in both modes on `main` already (research §2).

### Session 2026-10-21 (code review round 1)

- Q: How does Copilot know that a large patch was cut by the `view` tool? → A: the list gives each
  file's line count, and the guidance asks Copilot to read each file to its last line, in line
  ranges where needed (research §3). Round 1 gave the size in bytes; round 2 changed it to lines,
  because `view` reads by line number.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A review of a usual change sees the whole diff (Priority: P1)

A user runs `/copilot:review` or `/copilot:adversarial-review` on a branch or a working tree that
changes 3 or more files, with a diff of at most 256 KB. Today the plugin gives Copilot one patch
file and Copilot reads only part of it. After this change, the whole diff is in Copilot's prompt.

**Why this priority**: most tickets change more than 2 files. Their reviews must see every file.

**Independent Test**: review a branch with 3 files and a small diff. The prompt holds the diff of
all 3 files, and Copilot gets no patch folder.

**Acceptance Scenarios**:

1. **Given** a branch with 3 or more changed files and a diff of at most 256 KB, **When** the user
   runs a branch review, **Then** the prompt holds the whole diff and no patch folder is made.
2. **Given** a working tree with 3 or more changed files and a staged and unstaged diff of at most
   256 KB, **When** the user runs a working-tree review, **Then** the prompt holds the staged and
   unstaged diffs.

---

### User Story 2 - A review of a very large change can read each file (Priority: P2)

A user reviews a change whose diff is more than 256 KB. The plugin writes one patch per changed
file to its patch folder, and the prompt lists each patch with the changed file that it holds. Each
read is small, and Copilot can see which files it has not read.

**Why this priority**: large diffs are rarer, but one large patch file is the case that Copilot
read only in part.

**Independent Test**: review a change above 256 KB with several files. The patch folder holds one
patch for each file, the patches together are the exact `git diff` bytes, and the prompt lists
them.

**Acceptance Scenarios**:

1. **Given** a branch diff above 256 KB, **When** the user runs a branch review, **Then** the
   folder holds one patch for each changed file, their bytes joined are the exact branch diff, and
   the prompt lists each patch with its file.
2. **Given** a working-tree diff above 256 KB, **When** the user runs a working-tree review,
   **Then** the staged diff and the unstaged diff each give one patch per file, and the untracked
   files keep their own file.
3. **Given** the stop-time review gate is on and the working-tree diff is above 256 KB, **When**
   Claude stops, **Then** the gate gives Copilot the same per-file patches.
4. **Given** a review with a patch folder, **When** the review ends, fails or gets a stop signal,
   **Then** the folder is removed.

---

### User Story 3 - A blind plan gives both reviewers the input files (Priority: P3)

The owner runs the ticket workflow on a task that uses files outside the repo. The "Blind plan" rule
says to paste the text of those files into the prompt file, because the reviewers' sandbox reads
only the repo.

**Why this priority**: it affects planning only, and it happens rarely.

**Independent Test**: read the "Blind plan" rule in `.claude/skills/workflow-common/REFERENCE.md`.

**Acceptance Scenarios**:

1. **Given** a task that uses a file outside the repo, **When** the blind plan prompt file is
   written, **Then** the rule says to paste that file's text into it.

### Edge Cases

- A changed file whose patch is above about 40 KB, where `view` cuts a read (also one file whose
  diff alone is above 256 KB): it gets one large patch. The list gives its line count, and Copilot
  reads it in parts with the `view` tool's line range.
- A renamed file: its patch holds the rename header and both names, because the patches are split
  from the full diff and not made with a file filter.
- A binary file: its patch holds git's binary patch text, as today.
- A changed submodule: each `Submodule` line is its own patch, and each inner file diff gets its
  own patch, labelled with the submodule path. A file diff after a submodule line is never joined
  to it. The joined bytes stay exact.
- Bytes before the first file or submodule header, or a non-empty diff with no header: they go
  into the first patch, so no byte is lost.
- A patch file that cannot be written: the review fails before Copilot starts, and the folder is
  removed.
- A file name with spaces, non-ASCII letters or a quote: the patch file name is a number, so the
  name cannot leave the folder or clash. The list shows the name as git prints it in the patch.
- The staged or the unstaged diff is empty: it gives no patch files.
- Many untracked files: their text is in the prompt in both modes today, with the 24 KB limit for
  each file. This does not change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A review MUST put the whole diff in the prompt when the diff is at most 256 KB,
  whatever the number of changed files. This applies to branch scope, working-tree scope and the
  stop-time review gate.
- **FR-002**: Above 256 KB, the companion MUST write one patch file per changed file, for the branch
  diff, and for the staged and the unstaged diff. The patches MUST be split from the exact
  `git diff` bytes, so that joined in order they are equal to the full diff.
- **FR-003**: The prompt MUST list each patch file with its line count and the changed file that
  it holds, and MUST ask Copilot to read every listed file to its last line.
- **FR-004**: The patch folder MUST stay in the plugin's job storage and MUST be removed after the
  run and on a stop signal, as today.
- **FR-005**: A review MUST NOT give Copilot a shell or `git`.
- **FR-006**: The README section "Differences from the Codex plugin" MUST say what differs from
  upstream and why.
- **FR-007**: The "Blind plan" rule MUST say that the text of input files outside the repo goes into
  the prompt file.
- **FR-008**: The change MUST raise the plugin version and add a `CHANGELOG.md` entry.
- **FR-009**: Before the code change, a real Copilot adversarial review of the PR #106 diff MUST run
  with the old input (one patch file), and after it with the new input (inline). The PR body MUST
  give the files that Copilot says it read each time.

### Key Entities

- **Review input**: the prompt text that Copilot gets: either the inline diff, or a summary and the
  list of patch files.
- **Patch folder**: `jobs/<job id>.patches` in the plugin's job storage, which holds the per-file
  patches, and for the working tree and the gate also `untracked.md`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A review of a change of 3 to 11 files and at most 256 KB gives Copilot 100% of the diff
  in its prompt.
- **SC-002**: Above 256 KB, each patch file starts at a file or submodule header of the diff (the
  first one can also hold bytes before it), and the joined bytes are equal to the diff.
- **SC-003**: In the PR #106 test, Copilot with the new input says it read every changed file.
- **SC-004**: No patch folder is left after a review that ends, fails or is stopped by a signal.

## Assumptions

- The 256 KB limit from upstream stays. Copilot's prompt goes on stdin, so the Windows command-line
  limit does not apply.
- The `maxInlineFiles` option of `collectReviewContext` stays, as upstream has it, but its default
  becomes no limit. Tests use it to force the patch folder.
- Untracked files keep one `untracked.md` file. Their text is also in the prompt in both modes, so
  splitting it gives Copilot nothing new.
- The port spec `specs/005-copilot-plugin-port/` has merged, so it is history and is not updated
  (constitution, "Implementation-to-Spec Consistency"). The issue asks for research §2 and the
  call-site map there to be updated. This spec and the README record the change instead.
