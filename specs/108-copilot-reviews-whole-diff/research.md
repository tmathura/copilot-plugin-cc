# Research: Give Copilot reviews the whole diff of a large change

## §0 The cause test (2026-10-21)

A real Copilot adversarial review of the PR #106 diff (merge `960d3c1` against `829d37f`, 11 files,
82 KB, 1507 patch lines) ran with the 1.0.17 plugin, which gives one `branch.patch`. The focus text
asked Copilot to list each file as read in full, read in part, or not read.

- Copilot said it read every file in full.
- Its session log shows 5 `view` calls on `branch.patch`, with the line ranges 1–120, 120–620,
  565–1000, 873–1130 and 1130–1507. Each result stopped at about 40 KB (21 to 44 KB of text). After
  the 120–620 and 565–1000 calls, Copilot started again before the end it asked for, because the
  result was cut there.
- So the `view` tool cuts a large read, and a full read depends on Copilot seeing the cut and
  asking again. On PR #106 it did not. This time it did.

The same review with the new code (the diff inline, same focus text and target) made no tool call.
Copilot listed all 11 files as read in full, and named the last line of the last file
(`tests/spec-review-page.test.mjs`). Its verdict was `approve`, where the old run raised two
findings (a Principle II wording point and a missing CSP); a model gives different findings on
different runs, so the test compares only what was read.

## §1 Inline limit

- **Decision**: put the diff inline when it is at most 256 KB, whatever the file count. The
  `maxInlineFiles` option stays, with the default "no limit".
- **Rationale**: upstream's 2-file limit exists because Codex can run `git diff` itself, one file at
  a time. Copilot has no shell in a review, so above the limit it can only `view` a file, which cuts
  at about 40 KB (§0). Inline text needs no tool call. The prompt goes to Copilot on stdin, so there
  is no command-line limit: `tests/prompt-mode.test.mjs` already checks that a 300 KB prompt reaches
  stdin unchanged, and `tests/runtime-hooks.test.mjs` runs the gate with 100 KB on stdin (plan
  review round 5 asked for such a test). The 256 KB byte limit stays, as upstream has it.
- **Alternatives rejected**: keep the 2-file limit and only split the patch (most tickets would
  still need many `view` calls); a higher byte limit (no evidence that it is needed); remove the
  `maxInlineFiles` option (upstream has it, and tests use it to force the patch folder).

## §2 Per-file patches above 256 KB

- **Decision**: git still writes each diff straight to a file. `writeReviewPatches` then reads that
  file as bytes and splits it into `branch-001.patch`, `branch-002.patch` and so on
  (`staged-NNN.patch` and `unstaged-NNN.patch` for the working tree), and removes the full file. It
  returns each patch with its first line as the label. The number has at least 3 digits, and more
  when there are more patches, so the names sort in diff order.
- **Split points** (decided 2026-10-21, plan review rounds 1 and 2): a new patch starts at each
  line that starts with `diff --git ` or `Submodule `. So a changed submodule gives its
  `Submodule <path> a..b:` header as one small patch, then one patch per inner file
  (`--submodule=diff` prints the inner files as `diff --git a/<path>/<inner> …`, so each label names
  the submodule path). A `Submodule <path> contains modified content` line is its own patch. Bytes
  before the first split point go into the first patch, and a non-empty diff with no split point is
  one patch, so no byte is lost. Rejected alternatives: split at `diff --git ` lines only, which
  leaves a submodule's header at the end of the patch before it and labels it wrongly (round 1);
  keep a submodule header with the `diff --git` line after it, which joins an unrelated file to a
  header that has no diff of its own (round 2).
- **Rationale**: a split of one diff keeps the bytes exact (joined in order, the parts are the full
  diff) and keeps renames, binary patches and submodule lines as git prints them. A content line
  of a patch starts with a space, `+`, `-` or `\`, and a binary patch line has no space, so no
  content line starts with `diff --git ` or `Submodule `. Numbered names keep repo file names out of
  the folder's paths, so a name cannot leave the folder or clash.
- **Failure**: a write that fails partway (for example a patch file that exists already, since
  each file is made with `wx`) throws. `withReviewPatches` already removes the whole folder in its
  `finally`, and Copilot does not start. A test covers it.
- **Memory** (2026-10-21, plan review round 3): the split reads each diff file whole. A Node
  Buffer lives outside the script heap; a file above 2 GB makes the read throw, so the review fails
  with that error before Copilot starts, and the folder is removed. Copilot could not read such a
  patch today either. The patch list adds one line per file, and the summary already lists every
  file name. Rejected alternative: a streaming split in chunks, which adds code for a case that
  gives no usable review.
- **Patch count** (2026-10-21, plan review round 4): above 256 KB, a change of many small files
  needs one `view` call per file, where one large patch needed one call per 40 KB. This is
  accepted: the issue asks for one patch per changed file, so that Copilot can see which files it
  has not read. Rejected alternative: group small patches into parts of about 40 KB, which brings
  back files that hold several changes.
- **Alternatives rejected**: one `git diff -- <file>` per file (a rename then shows as an add and a
  delete, unless both names are passed; more git calls; quoted names need parsing); file names made
  from the repo path (clashes, long paths on Windows, odd characters).
- Untracked files keep one `untracked.md`: their text is also in the prompt in both modes, with the
  24 KB limit for each file, so a split gives Copilot nothing new.
- **Untracked text and the prompt size** (2026-10-21, plan review): the plan review said that
  without the file limit, many untracked files make the prompt unbounded. On `main` the untracked
  text is in the prompt in both modes already, so the file limit never bounded it; this change adds
  at most 256 KB of diff. Not changed here. Rejected alternative: count the untracked bytes toward
  the 256 KB limit, which changes behaviour that the issue does not ask about.

## §3 Prompt list

- **Decision** (changed 2026-10-21, code review rounds 1 and 2): the `## Patch Files` section lists
  `- <patch path> (<n> lines): <first line of the patch>` (untracked:
  `- <path> (<n> lines): untracked files`). The guidance asks Copilot to read every listed file to
  its last line, in line ranges where needed, because the `view` tool cuts a long read.
- **Rationale**: Copilot can see which file each patch holds and which it has not read. A patch
  above about 40 KB is still one file (spec edge cases), and `view` reads by line number, so the
  line count tells Copilot where the file ends and that a read was cut. Rejected alternatives: the
  list with no count and no word about cut reads (the first plan; Copilot and `code-review` found
  that a large single-file patch gave no hint); the size in bytes (round 1; `view` takes line
  numbers, so bytes do not say which line is last, round 2); splitting one file's patch into parts
  (more code, and a part would hold half a hunk).

## §4 The port spec

- **Decision**: do not edit `specs/005-copilot-plugin-port/`. Record the change here and in the
  README section "Differences from the Codex plugin".
- **Rationale**: the issue asks for research §2 and the call-site map in spec 005 to be updated, but
  spec 005 has merged, and the constitution ("Implementation-to-Spec Consistency") says a merged
  spec folder is history that later work does not update. The constitution wins.
- **Alternative rejected**: edit spec 005 as the issue asks.

## §5 Blind plan input files

- **Decision**: add to the "Blind plan" rule, step 1: when the task uses files outside the repo,
  paste their text into the prompt file. The same holds for a plan review prompt file.
- **Rationale**: the reviewers' sandbox reads only the repo (#105's blind plan).

## §6 Release level

- **Decision**: patch, 1.0.18.
- **Rationale**: no command, flag or output changes. Only the review input that Copilot gets
  changes ("Is this ticket a release?": a change users do not notice in commands, flags or output).
