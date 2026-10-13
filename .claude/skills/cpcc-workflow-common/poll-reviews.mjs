// Wait until every bot reviewer has finished with one PR head.
// Usage: node poll-reviews.mjs <head sha> <pr> [tries=60] [intervalSec=30]
// Exit 0: all reviewers done. Exit 1: timed out (prints who is still pending). Exit 2: gh failed.
//
// Reviewers (keep in step with the "Bot reviewers" table in REFERENCE.md):
// - copilot: done when it has a review on the head SHA.
// - coderabbit: done when it has a review on the head SHA, or, when its reviews are paused, when it
//   posted "Review finished" after this script started and is no longer "Currently processing", or when
//   its commit status on the head SHA is "success" (a review with no findings posts no review).
import { execFileSync } from "node:child_process";

const [rawSha = "", pr = "", tries = "60", intervalSec = "30"] = process.argv.slice(2);
const positive = /^[1-9]\d*$/;
// A short SHA never matches a review's commit_id, so the poll would wait until it timed out.
if (!/^[0-9a-f]{40}$/i.test(rawSha) || ![pr, tries, intervalSec].every((value) => positive.test(value))) {
  console.error("usage: node poll-reviews.mjs <40-character head sha> <pr number> [tries] [intervalSec]");
  process.exit(2);
}
const sha = rawSha.toLowerCase();

const repo = "repos/tmathura/copilot-plugin-cc";
const startedAt = new Date().toISOString();

function gh(path) {
  return JSON.parse(execFileSync("gh", ["api", path, "--paginate", "--slurp"], { encoding: "utf8" })).flat();
}

const reviewers = {
  copilot: (reviews) => reviews.some((r) => /copilot-pull-request-reviewer/.test(r.user.login) && r.commit_id === sha),
  coderabbit: (reviews, comments, statuses) => {
    const mine = comments.filter((c) => /coderabbit/.test(c.user.login));
    if (mine.some((c) => /Currently processing/.test(c.body))) {
      return false;
    }
    const reviewedHead = reviews.some((r) => /coderabbit/.test(r.user.login) && r.commit_id === sha);
    const finishedSince = mine.some((c) => c.updated_at > startedAt && /Review finished|Review completed/.test(c.body));
    // A review with no findings posts no review object, only a commit status on the head.
    // A paused CodeRabbit also reports success ("Review paused"); that is not a review of this head.
    const headStatusDone = statuses.some(
      (s) => /coderabbit/i.test(s.context) && s.state === "success" && !/paused/i.test(s.description ?? "")
    );
    return reviewedHead || finishedSince || headStatusDone;
  }
};

let pending = Object.keys(reviewers);
for (let attempt = 1; attempt <= Number(tries); attempt += 1) {
  let reviews;
  let comments;
  let statuses;
  try {
    reviews = gh(`${repo}/pulls/${pr}/reviews`);
    comments = gh(`${repo}/issues/${pr}/comments`);
    statuses = gh(`${repo}/commits/${sha}/statuses`);
  } catch (error) {
    console.error(`gh failed: ${error.message}`);
    process.exit(2);
  }
  pending = Object.entries(reviewers)
    .filter(([, done]) => !done(reviews, comments, statuses))
    .map(([name]) => name);
  if (pending.length === 0) {
    console.log(`all reviewers done after ${attempt} check(s)`);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, Number(intervalSec) * 1000));
}
console.log(`timed out; still pending: ${pending.join(", ")}`);
process.exit(1);
