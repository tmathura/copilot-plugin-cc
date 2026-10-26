---

description: "Tasks for #108: give Copilot reviews the whole diff of a large change"
---

# Tasks: Give Copilot reviews the whole diff of a large change

**Input**: Design documents from `specs/108-copilot-reviews-whole-diff/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/review-input.md

**Tests**: required by the constitution (Principle VI).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to

## Phase 1: Setup

- [x] T001 Run the cause test with the old input (research §0): a Copilot adversarial review of the PR #106 diff with the 1.0.17 plugin, and record which files it read and its `view` calls

## Phase 2: User Story 1 - A review of a usual change sees the whole diff (Priority: P1)

**Goal**: a diff of at most 256 KB is inline, whatever the file count (FR-001).

**Independent Test**: T003.

- [x] T002 [US1] Set `DEFAULT_INLINE_DIFF_MAX_FILES` to no limit in `plugins/copilot/scripts/lib/git.mjs`, and update the file's change notice
- [x] T003 [US1] In `tests/git.test.mjs`, change the 3-file test to expect `inline-diff` with all 3 diffs, for the working tree and for a branch; keep the lightweight checks by passing `maxInlineFiles: 0`; a diff of exactly `maxInlineDiffBytes` stays inline and one byte more does not

## Phase 3: User Story 2 - A review of a very large change can read each file (Priority: P2)

**Goal**: above 256 KB, one patch per changed file and a list of them (FR-002 to FR-004).

**Independent Test**: T005 and T006.

- [x] T004 [US2] In `plugins/copilot/scripts/lib/git.mjs`, make `writeReviewPatches` read each diff file as bytes and split it at the split points of research §2 into numbered patches, and return `{ file, label }` entries; change the self-collect guidance (contracts/review-input.md). In `plugins/copilot/scripts/copilot-companion.mjs`, list each entry as `- <file>: <label>` in `withReviewPatches`
- [x] T004b [US2] (code review round 1) Give each entry its size in bytes, show it in the list as `- <file> (<bytes> bytes): <label>`, and ask Copilot in the guidance to read each file to its end, in line ranges where needed (research §3); compare header bytes in place in `startsPatch`; share `gitBytes` and `DIFF_ARGS` from `tests/runtime-helpers.mjs`
- [x] T004c [US2] (code review round 2) Show the line count in place of the size (`- <file> (<n> lines): <label>`), and say in the guidance that each patch file holds one changed file's diff and that Copilot reads each file to its last line (research §3); move `git`, `gitBytes`, `DIFF_ARGS` and `countLines` to `tests/helpers.mjs`, add `patchListEntry` to `tests/runtime-helpers.mjs`, and check the new guidance in the gate test
- [x] T004d [US2] (code review round 3) Import `git` from `tests/helpers.mjs` in `tests/runtime-review.test.mjs` and `tests/runtime-review-safety.test.mjs`, with no re-export from `tests/runtime-helpers.mjs`; say in `data-model.md` that the guidance covers `untracked.md` too, for the working tree (round 4), and the same in `spec.md` Key Entities (round 5)
- [x] T004e [US2] (PR review round 1) Also split at `diff --cc ` and `* Unmerged path ` lines in `plugins/copilot/scripts/lib/git.mjs`, and test an unresolved merge, with an edited file that the other side deleted (a note patch, then a diff patch), in `tests/git.test.mjs`; say in the guidance that a patch can be git's one-line note on a merge conflict (research §2)
- [x] T005 [US2] In `tests/runtime-review-safety.test.mjs`, check per-file patches for the working tree and the branch: one per file, joined bytes equal `git diff`, a rename stays one patch, an empty staged diff gives no staged patch, the prompt lists each entry, and the folder is removed
- [x] T005b [US2] In `tests/git.test.mjs`, check `writeReviewPatches` directly: a branch with a changed submodule (its `Submodule` line and each inner diff are separate patches) and an ordinary file after it (its own patch), a working tree whose submodule has modified content (its `Submodule` line is its own patch), a binary file, CRLF content and a file with no newline at its end gives joined bytes equal to `git diff`; 1000 changed files give names with 4 digits that sort in diff order; a patch file that exists already makes it throw. In `tests/runtime-review-safety.test.mjs`, a write failure makes the review fail before Copilot starts and removes the folder
- [x] T006 [US2] In `tests/runtime-hooks.test.mjs` and `tests/runtime-helpers.mjs`, make the gate's large-diff fixture exceed 256 KB, and check its per-file patches and the folder removal after success, failure and a stop signal
- [x] T007 [P] [US2] Update the comment in `plugins/copilot/scripts/stop-review-gate-hook.mjs` and the review flow in `docs/architecture.md`

## Phase 4: User Story 3 - A blind plan gives both reviewers the input files (Priority: P3)

- [x] T008 [P] [US3] Add the line for files outside the repo to "Blind plan", step 1, in `.claude/skills/workflow-common/REFERENCE.md` (research §5)

## Phase 5: Polish

- [x] T009 Update the README section "Differences from the Codex plugin" (the large-diff and the review gate items)
- [x] T010 Run `npm run bump-version -- 1.0.18` and add the `### 1.0.18` entry to `plugins/copilot/CHANGELOG.md`
- [x] T011 Run the commands from "Commands" in REFERENCE.md
- [x] T012 Run the cause test with the new input (research §0) and put both results in the PR body

## Dependencies

- T001 before T002. T002 before T003. T004 before T005, T005b and T006. T011 after all code tasks. T012
  after T002 and T004.
