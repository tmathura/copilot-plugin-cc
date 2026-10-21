# Quickstart: check the feature

1. `npm ci --include=dev`, `npm run build`, `npm test`, `npm run check-version` and
   `claude plugin validate .` pass.
2. In `tests/git.test.mjs`, a working tree and a branch with 3 changed files give `inline-diff`, and
   the content holds all 3 diffs.
3. In `tests/git.test.mjs`, `writeReviewPatches` keeps exact bytes with a submodule, a binary file,
   CRLF and a missing end newline, numbers 1000 patches with 4 digits, and throws on a patch file
   that exists already.
4. In `tests/runtime-review-safety.test.mjs`, a patch write that fails stops the review before
   Copilot starts and removes the folder. Also, a review above 256 KB gets one patch per file, the
   joined patches equal `git diff`, the prompt lists each patch with its line count and `diff --git` line, and the
   folder is gone after the run.
5. In `tests/runtime-hooks.test.mjs`, the gate above 256 KB gets the same per-file patches and
   removes the folder after success, failure and a stop signal.
6. The cause test (research §0): a Copilot adversarial review of the PR #106 diff with the new code
   gets the diff inline and says which files it read. The PR body gives both runs.
