# Implementation Plan: Give Copilot reviews the whole diff of a large change

**Branch**: `feature/108-copilot-reviews-whole-diff` | **Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/108-copilot-reviews-whole-diff/spec.md`

## Summary

A review now puts the whole diff in the prompt when it is at most 256 KB, whatever the file count:
the default of `maxInlineFiles` in `collectReviewContext` becomes no limit. Above 256 KB,
`writeReviewPatches` splits each `git diff` output at its `diff --git` and `Submodule` lines into
one numbered patch per changed file (research §2), and `withReviewPatches` lists each patch with
its size and first line (research §3). The
folder, its removal and the stop-time gate path stay as they are (research §1 to §3). The "Blind
plan" rule gets one line for files outside the repo (research §5).

## Technical Context

**Language/Version**: Node.js 22 or later, ESM `.mjs`, no runtime dependencies

**Primary Dependencies**: Node built-ins (`node:fs`, `node:path`); `git`; the Copilot CLI in prompt mode

**Storage**: the plugin's job storage, `jobs/<job id>.patches` (gate: `jobs/stop-gate-<pid>-<random>.patches`)

**Testing**: `node --test` with the fake copilot CLI (`tests/fake-copilot-fixture.mjs`)

**Target Platform**: macOS, Linux and Windows

**Project Type**: Claude Code plugin (CLI companion script)

**Performance Goals**: none new. The prompt goes on stdin, so 256 KB inline has no command-line limit.

**Constraints**: patch bytes exact; no shell or `git` for Copilot; folder removed after the run and on a signal

**Scale/Scope**: 2 plugin code files, 1 skill file, 3 test files, README, architecture doc, CHANGELOG and version files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Proof |
| --- | --- | --- |
| I. Upstream parity | Met, with a listed difference | Upstream inlines at most 2 files and 256 KB, and Codex runs `git` above that. Copilot has no shell in a review, so the file limit is dropped and large diffs are split per file. The reason is "Copilot cannot do the same thing". The README section "Differences from the Codex plugin" lists it (T009). Function names and the `maxInlineFiles` option stay. |
| II. Only reviewed code | Met | Code written in this repo. No upstream code comes in. |
| III. Copilot CLI through documented interfaces | Met | Only the prompt text and the existing `--add-dir` change. No new flag. The adapter is not changed. |
| IV. Safe by default | Met | The review tools stay read-only, with no shell (FR-005). The patch folder stays in job storage and is removed after the run and on a signal (tests T005, T006). Numbered patch names keep repo file names out of the folder's paths. |
| V. Cross-platform | Met | Paths through `node:path`; the split works on bytes, so CRLF files and binary patches stay exact. CI runs on all three systems. |
| VI. Tested, including failure paths | Met | Tests cover the inline path with 3 files and the 256 KB boundary, the split for branch, working tree and the gate, exact bytes with a submodule, a binary file, CRLF and a missing end newline, a rename, a patch write that fails before Copilot starts, and the folder removal after success, failure and a signal (T003 to T006). |

No principle is "not met". Re-check after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/108-copilot-reviews-whole-diff/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/review-input.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
plugins/copilot/scripts/lib/git.mjs            # default maxInlineFiles; per-file split in writeReviewPatches; guidance text
plugins/copilot/scripts/copilot-companion.mjs  # withReviewPatches lists each patch with its size and file
plugins/copilot/scripts/stop-review-gate-hook.mjs  # comment only, it already uses withReviewPatches
.claude/skills/workflow-common/REFERENCE.md    # "Blind plan" line for files outside the repo
tests/git.test.mjs                             # 3 files inline; split helper
tests/runtime-review-safety.test.mjs           # per-file patches, branch and working tree
tests/runtime-hooks.test.mjs, tests/runtime-helpers.mjs  # gate above 256 KB
README.md, docs/architecture.md                # differences section, review flow
plugins/copilot/CHANGELOG.md + version files   # release 1.0.18
```

**Structure Decision**: the existing layout. No new module.

## Complexity Tracking

None.
