# Bug Assessment: a branch review fails when the default branch exists only on the remote

- **Slug**: 112-use-remote-default-branch
- **Created**: 2026-10-27
- **Source**: pasted text (GitHub issue #112)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

Summarized from #112. `detectDefaultBranch` (`plugins/copilot/scripts/lib/git.mjs`) reads
`refs/remotes/origin/HEAD`. When it points at `origin/main`, the function returns `main` and does
not check that `refs/heads/main` exists. The candidate loop below it checks the local branch, then
the remote one, but it runs only when `origin/HEAD` is not set. `git clone -b feature <origin>`
gives `origin/HEAD`, `origin/main` and a local `feature` only. `resolveReviewTarget` then returns
`baseRef: "main"`, and `collectReviewContext` fails with
`merge-base HEAD main: exit=128: fatal: Not a valid object name main`. The issue asks that the base
be `origin/<name>` unless `refs/heads/<name>` exists, with a test, a README difference line, and a
patch release.

## Symptom

A branch review (`/copilot:review` or `/copilot:adversarial-review` on a clean tree, or with
`--scope branch`) in a clone that has no local default branch fails at `git merge-base`. Expected:
the review runs against `origin/<name>`.

## Reproduction

Reproduced on 2026-10-27 with the code on `main` (757e52b), from a Node script outside the repo:

1. Make a repo with `main` (one commit) and `feature` (one more commit), with `main` checked out.
2. `git clone -b feature <that repo> clone`. In the clone, `git symbolic-ref
   refs/remotes/origin/HEAD` prints `refs/remotes/origin/main`, and the only local branch is
   `refs/heads/feature`.
3. In the clone, `resolveReviewTarget(clone, {})` returns `baseRef: "main"`.
4. `collectReviewContext(clone, target)` throws `... merge-base HEAD main: exit=128: fatal: Not a
   valid object name main`.

## Suspected Code Paths

- `plugins/copilot/scripts/lib/git.mjs:114-121` (`detectDefaultBranch`): the `origin/HEAD` branch
  returns the bare name with no check of `refs/heads/<name>`.
- `plugins/copilot/scripts/lib/git.mjs:123-133`: the candidate loop already checks the local
  branch, then `origin/<candidate>`. It runs only when `origin/HEAD` is not set.
- `plugins/copilot/scripts/lib/git.mjs:199` and `:216` (`resolveReviewTarget`): the two callers.
  The base goes into the label and into `merge-base HEAD <base>` at `git.mjs:90`.
- Upstream codex-plugin-cc v1.0.6 (`scripts/lib/git.mjs:94-116`, read from the installed Codex
  plugin) has the same code.

## Root Cause Hypothesis

`detectDefaultBranch` takes the name that `origin/HEAD` points to and assumes that a local branch of
that name exists. A clone made with `-b <other branch>`, a single-branch clone, and many CI
checkouts have only the remote-tracking ref, so the bare name is not a valid object and
`git merge-base` fails. Confidence: high (reproduced, and the code path is short).

## Proposed Remediation

**Preferred**: in the `origin/HEAD` branch of `detectDefaultBranch`, after the prefix is removed,
run `git show-ref --verify --quiet refs/heads/<name>` with the existing `git` helper (no shell, so
the name is passed literally). Return `<name>` when it exists, and `origin/<name>` when it does
not. This is the rule that the candidate loop already uses. The loop and the error stay as they
are.

**Alternatives**:
- Always return `origin/<name>`: one line less, but a clone with a local default branch would
  review against the remote ref, which can be older or newer than the local one. The issue asks
  for `<name>` in that case.

**Files likely to change**:
- `plugins/copilot/scripts/lib/git.mjs` (and its "Changed from upstream" header comment)
- `tests/git.test.mjs` (and its "Changed from upstream" header comment)
- `README.md` ("Differences from the Codex plugin")
- `plugins/copilot/CHANGELOG.md` and the version files (`npm run bump-version -- 1.0.21`)

**Tests to add or update**:
- The source is a temp repo with `main` (one commit) and `feature` (one more commit), with `main`
  checked out, so that a clone's `origin/HEAD` points at `origin/main`.
- A clone made with `git clone -b feature`: the test checks that `origin/HEAD` and `origin/main`
  exist and `refs/heads/main` does not. Then `resolveReviewTarget` (with no scope and with
  `scope: "branch"`) returns `baseRef: "origin/main"` and the label `branch diff against
  origin/main`, and `collectReviewContext` gives a branch diff with the feature change. This test
  fails on the current code.
- A clone made with `git clone --single-branch -b feature`, then `git fetch origin
  main:refs/remotes/origin/main` and `git remote set-head origin main`, so it has the same refs:
  the same checks. This is the single-branch clone that the issue names.
- The `-b feature` clone after `git branch main origin/main`: the base is `main` and the label
  `branch diff against main`. This passes on the current code too; it guards the local case
  against a regression.
- An `origin/HEAD` that points at `refs/remotes/origin/gone`, which does not exist, with no local
  `gone`: the base is `origin/gone`, and `collectReviewContext` fails with an error that names
  `merge-base HEAD origin/gone`. This pins today's failure, which stays as it is (see "Risks &
  Considerations"); it is not a requirement.
- The existing test for a default branch name with special characters (it has a local branch)
  must still pass, so the name still reaches git literally. A remote-only variant of it (it checks
  out `feature/test`, then deletes the local branch of that name with `git branch -D`, run with
  `shell: false`) gives `origin/main&branch-helper&x` and creates no helper file, so the new
  `show-ref` call and the `origin/<name>` return pass the name literally too.
- The header comment of `tests/git.test.mjs` names the remote-only default-branch tests.

**Checks**: `npm ci --include=dev`, `npm run build`, `npm test`, `npm run check-version` and
`claude plugin validate .` must pass before the PR.

## Risks & Considerations

- A label changes: the review says "branch diff against origin/main" in such a clone, where today
  it fails. A clone with the local branch keeps "main".
- An `origin/HEAD` that points at a ref that does not exist (a dangling symbolic ref) still fails at
  `merge-base`, now with `origin/<name>` in the message. That is the same failure as today, and the
  issue does not ask to change it.
- A `show-ref` that fails for any reason counts as "no local branch", as in the candidate loop.
  The base is then `origin/<name>`, which `merge-base` checks.
- `origin/<name>` is the remote-tracking ref as of the last fetch. The plugin does not fetch, as
  today.
- The difference from upstream is a correctness change; the README section gets one bullet.

## Open Questions

None.

## Constitution Check

- **I. Upstream parity**: met. The function name and its candidate loop stay. The one change from
  upstream is a correctness difference, listed in the README section "Differences from the Codex
  plugin" with its reason, and in the "Changed from upstream" header comments of `git.mjs` and
  `tests/git.test.mjs`.
- **II. Only reviewed code**: met. One `show-ref` call written here, after the candidate loop's own
  check; no new dependency.
- **III. Copilot CLI through documented interfaces only**: met. No change to how Copilot is called.
- **IV. Safe by default**: met. A read-only `git show-ref`, started with no shell; the name is passed
  as one argument.
- **V. Cross-platform**: met. Plain git refs and a local clone in a temp folder; CI runs the test on
  Ubuntu, macOS and Windows.
- **VI. Tested, including failure paths**: met. Tests for the remote-only case (a `-b` clone and a
  single-branch clone, auto and branch scope), the local case, and an `origin/HEAD` that points at a
  missing ref; the special-character test and the no-default-branch error test stay.
  Patch release with its `CHANGELOG.md` entry, and the release run after the merge.
