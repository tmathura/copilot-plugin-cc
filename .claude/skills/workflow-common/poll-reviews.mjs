// Wait until every bot reviewer has finished with one PR head.
// Usage: node poll-reviews.mjs <head sha> <pr> [tries=60] [intervalSec=30] [--no-copilot]
// Exit 0: all reviewers done. Exit 1: timed out (prints who is still pending).
// Exit 2: bad arguments (prints the usage line) or gh failed (prints "gh failed").
// Exit 4: Copilot dropped its request (prints the request time): 2 minutes after this poll started,
//   the PR timeline has no copilot_work_started event since the request. Ends the poll at once.
// --no-copilot: wait for CodeRabbit only (after Copilot dropped a second request for this head).
//
// Reviewers (keep in step with the "Bot reviewers" table in REFERENCE.md):
// - copilot: done when it has a review on the head SHA. Its request time is the later of its newest
//   review_requested event and the head's first check suite (made at the push), because a dropped
//   request leaves no event. Both are GitHub times; the 2-minute window uses only the local clock.
//   Limits: copilot_work_started names no head, so a late start of an earlier push's review counts
//   as a start (the poll then times out, as before). A head whose first check suite comes after
//   Copilot's start gives a false drop.
// - coderabbit: done when it has a review on the head SHA, or, when its reviews are paused, when it
//   posted "Review finished" after this script started and is no longer "Currently processing", or when
//   its commit status on the head SHA is "success" (a review with no findings posts no review).
//   A "Review finished" from before this poll started does not count, also when an earlier poll
//   for the same head saw none.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = "repos/tmathura/copilot-plugin-cc";
const DROP_GRACE_MS = 120_000;
const USAGE = "usage: node poll-reviews.mjs <40-character head sha> <pr number> [tries] [intervalSec] [--no-copilot]";

// Exact bot logins, so a look-alike account cannot end the wait. The REST API may add "[bot]".
const isCopilot = (login) => /^copilot-pull-request-reviewer(\[bot\])?$/.test(login);
const isCodeRabbit = (login) => /^coderabbitai(\[bot\])?$/.test(login);
const time = (value) => Date.parse(value ?? "");

// `gh api --paginate --slurp` prints one entry per page; a check-suites page wraps its list.
function items(pages) {
  return pages.flatMap((page) => (Array.isArray(page) ? page : (page?.check_suites ?? [])));
}

export function parseArgs(argv) {
  const flag = argv.indexOf("--no-copilot");
  const [rawSha = "", pr = "", tries = "60", intervalSec = "30", ...extra] = argv.filter(
    (arg) => arg !== "--no-copilot"
  );
  const positive = /^[1-9]\d*$/;
  // A short SHA never matches a review's commit_id, so the poll would wait until it timed out.
  if (
    (flag !== -1 && flag < 2) ||
    extra.length > 0 ||
    !/^[0-9a-f]{40}$/i.test(rawSha) ||
    ![pr, tries, intervalSec].every((value) => positive.test(value))
  ) {
    return null;
  }
  return {
    sha: rawSha.toLowerCase(),
    pr,
    tries: Number(tries),
    intervalMs: Number(intervalSec) * 1000,
    skipCopilot: flag !== -1
  };
}

export async function pollReviews({
  sha,
  pr,
  tries,
  intervalMs,
  skipCopilot = false,
  ghPages,
  now = Date.now,
  sleep,
  dropGraceMs = DROP_GRACE_MS
}) {
  const startedAt = now();
  const read = (path) => items(ghPages(`${repo}/${path}`));
  let pushedAt;
  let copilotStarted = false;

  const reviewers = {
    copilot: (reviews) => reviews.some((r) => isCopilot(r.user.login) && r.commit_id === sha),
    coderabbit: (reviews, comments, statuses) => {
      const mine = comments.filter((c) => isCodeRabbit(c.user.login));
      if (mine.some((c) => /Currently processing/.test(c.body))) {
        return false;
      }
      const reviewedHead = reviews.some((r) => isCodeRabbit(r.user.login) && r.commit_id === sha);
      const finishedSince = mine.some(
        (c) => time(c.updated_at) > startedAt && /Review finished|Review completed/.test(c.body)
      );
      // A review with no findings posts no review object, only a commit status on the head.
      // A paused or rate-limited CodeRabbit also reports success; that is not a review of this head.
      const headStatusDone = statuses.some(
        (s) =>
          isCodeRabbit(s.creator?.login) && s.state === "success" && !/paused|rate limited/i.test(s.description ?? "")
      );
      return reviewedHead || finishedSince || headStatusDone;
    }
  };
  if (skipCopilot) {
    delete reviewers.copilot;
  }

  let pending = Object.keys(reviewers);
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    let reviews;
    let comments;
    let statuses;
    try {
      reviews = read(`pulls/${pr}/reviews`);
      comments = read(`issues/${pr}/comments`);
      statuses = read(`commits/${sha}/statuses`);
    } catch (error) {
      return { code: 2, message: `gh failed: ${error.message}` };
    }
    pending = Object.entries(reviewers)
      .filter(([, done]) => !done(reviews, comments, statuses))
      .map(([name]) => name);
    if (pending.length === 0) {
      return { code: 0, message: `all reviewers done after ${attempt} check(s)` };
    }
    // The timeline is long and paged; read it only when a drop could be reported, until a start shows.
    if (pending.includes("copilot") && !copilotStarted && now() - startedAt >= dropGraceMs) {
      let timeline;
      try {
        timeline = read(`issues/${pr}/timeline`);
        // Suites do not change once made; an empty read is asked again on the next check.
        if (pushedAt === undefined) {
          const suiteTimes = read(`commits/${sha}/check-suites`)
            .map((s) => time(s.created_at))
            .filter(Number.isFinite);
          pushedAt = suiteTimes.length > 0 ? Math.min(...suiteTimes) : undefined;
        }
      } catch (error) {
        return { code: 2, message: `gh failed: ${error.message}` };
      }
      const requestTimes = timeline
        .filter((e) => e.event === "review_requested" && e.requested_reviewer?.login === "Copilot")
        .map((e) => time(e.created_at))
        .filter(Number.isFinite);
      const requestedAt = Math.max(pushedAt ?? -Infinity, ...requestTimes);
      const started = timeline.some((e) => e.event === "copilot_work_started" && time(e.created_at) >= requestedAt);
      if (!started) {
        const at = Number.isFinite(requestedAt) ? new Date(requestedAt).toISOString() : "an unknown time";
        return { code: 4, message: `copilot dropped the request made at ${at}: no copilot_work_started since then` };
      }
      // Without the push time, the start may be an earlier push's; read again until a suite shows.
      copilotStarted = pushedAt !== undefined;
    }
    if (attempt < tries) {
      await sleep(intervalMs);
    }
  }
  return { code: 1, message: `timed out; still pending: ${pending.join(", ")}` };
}

const entry = process.argv[1];
if (entry && fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error(USAGE);
    process.exit(2);
  }
  const result = await pollReviews({
    ...options,
    ghPages: (path) =>
      JSON.parse(
        execFileSync("gh", ["api", path, "--paginate", "--slurp"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      ),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  });
  (result.code === 2 ? console.error : console.log)(result.message);
  process.exit(result.code);
}
