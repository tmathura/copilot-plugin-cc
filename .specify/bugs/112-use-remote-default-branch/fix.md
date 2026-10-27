# Bug Fix: a branch review fails when the default branch exists only on the remote

- **Slug**: 112-use-remote-default-branch
- **Fixed**: 2026-10-27
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`detectDefaultBranch` now checks `refs/heads/<name>` for the name that `origin/HEAD` gives, and
returns `origin/<name>` when that local branch does not exist. A branch review in a clone with no
local default branch then compares against the remote-tracking ref, and `git merge-base` works.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/git.mjs` | modified | One `show-ref --verify --quiet refs/heads/<name>` call in the `origin/HEAD` branch; a header comment line for the upstream difference |
| `tests/git.test.mjs` | added tests | Five tests and three small helpers; a header comment line |
| `README.md` | modified | One bullet in "Differences from the Codex plugin" (correctness) |
| `plugins/copilot/CHANGELOG.md` | modified | `### 1.0.21` entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | `npm run bump-version -- 1.0.21` |

## Diff Highlights (optional)

```js
const name = remoteHead.replace("refs/remotes/origin/", "");
const local = git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
return local.status === 0 ? name : `origin/${name}`;
```

## Tests Added or Updated

- `tests/git.test.mjs` "a branch review in a clone with no local default branch runs against
  origin/<name>": a `git clone -b feature` clone has `origin/HEAD` and `origin/main` but no
  `refs/heads/main`; with no scope and with `scope: "branch"`, the base is `origin/main`, the label
  is `branch diff against origin/main`, and the context holds the feature change.
- "a branch review in a single-branch clone runs against origin/<name> once the default branch is
  fetched": `--single-branch -b feature`, then `fetch origin main:refs/remotes/origin/main` and
  `remote set-head origin main`; the same checks.
- "a clone with a local default branch still reviews against <name>": after
  `git branch main origin/main`, the base is `main` and the label `branch diff against main`.
- "an origin/HEAD that points at a missing ref gives origin/<name> and fails at merge-base": pins
  today's failure for a dangling `origin/HEAD`, with the error text.
- "a default branch name with special characters is passed to git literally when only the remote
  has it": `main&branch-helper&x` only as a remote ref; the base is `origin/main&branch-helper&x`,
  the branch diff is collected, and the `.cmd` helper does not run.

## Local Verification

- With the code on `main` put back for a moment, the four remote-only tests fail and the local-case
  test passes; with the fix, all pass.
- Commands run: `npm ci --include=dev` (0 vulnerabilities), `npm run build` (pass), `npm test`
  (442 tests: 418 pass, 24 skipped, 0 fail), `npm run check-version` (1.0.21),
  `claude plugin validate .` (pass).
- Manual checks: the reproduction script from `assessment.md` ("Reproduction") failed on `main`
  with `merge-base HEAD main: exit=128`.

## Deviations from Assessment

None.

## Follow-ups

- Upstream codex-plugin-cc v1.0.6 has the same code (`scripts/lib/git.mjs:94-116`); the owner may
  report it upstream.
