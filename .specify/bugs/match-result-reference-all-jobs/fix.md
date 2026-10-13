# Bug Fix: /copilot:result with a running job's id shows another job's result

- **Slug**: match-result-reference-all-jobs
- **Fixed**: 2026-10-12
- **Assessment**: ./assessment.md
- **Status**: applied

Written by hand on 2026-10-13 from PR #41 (squash commit `839df3a6db1cfbe7a54e1cb054cc3146deceb725`), for #59.

## Summary

`resolveResultJob` matches an explicit reference against every job first, then checks its status. A queued or running job gives "Job <id> is still <status>". Released as 1.0.5.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `plugins/copilot/scripts/lib/job-control.mjs` | modified | match all jobs first; unreachable message removed; change notice updated |
| `tests/job-control.test.mjs` | added tests | running vs finished prefix, exact finished id, no reference |
| `README.md` | modified | "Differences from the Codex plugin" entry |
| `plugins/copilot/CHANGELOG.md` | modified | 1.0.5 entry |
| `package.json`, `package-lock.json`, `plugins/copilot/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modified | version 1.0.5 |

## Diff Highlights (optional)

```js
const isActive = (job) => job.status === "queued" || job.status === "running";

// The exact id of a running job must not select a different, finished job that it is a prefix of.
const selected = reference ? matchJobReference(jobs, reference) : (jobs.find((job) => !isActive(job)) ?? jobs[0]);

if (!selected) {
  throw new Error("No finished Copilot jobs found for this repository yet.");
}
if (isActive(selected)) {
  throw new Error(`Job ${selected.id} is still ${selected.status}. Check /copilot:status and try again once it finishes.`);
}
```

## Tests Added or Updated

- `tests/job-control.test.mjs` "result with the exact id of a running job says it is still running, not another job's result" (also a queued job, and an ambiguous prefix that fits a finished and a running job).
- `tests/job-control.test.mjs` "result with the exact id of a finished job wins over a longer id that shares its prefix" (also an ambiguous prefix and an unknown reference).
- `tests/job-control.test.mjs` "result without a reference picks the newest finished job, not a newer running one".

## Local Verification

As recorded in PR #41:

- Commands run: `npm test` → 230 pass, 13 skipped, 0 fail; `npm run build`, `npm run check-version`, `claude plugin validate .` → pass (Windows).

## Deviations from Assessment

- The old "No finished job found for <reference>" message is removed. It could never run, because the lookup threw "No job found" first.

## Follow-ups

- None.
