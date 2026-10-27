import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseArgs, pollReviews } from "../.claude/skills/workflow-common/poll-reviews.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, ".claude", "skills", "workflow-common", "poll-reviews.mjs");
const SHA = "a".repeat(40);

// The checks run before any gh call; the timeout stops a regression from polling GitHub in CI.
function poll(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 10_000, windowsHide: true });
}

for (const [name, args] of [
  ["no arguments", []],
  ["a short sha", ["abc1234", "56"]],
  ["a pr of 0", [SHA, "0"]],
  ["a pr with a leading zero", [SHA, "056"]],
  ["a non-numeric tries", [SHA, "56", "many"]],
  ["a negative interval", [SHA, "56", "60", "-1"]],
  ["--no-copilot before the sha", ["--no-copilot", SHA, "56"]],
  ["--no-copilot before the pr", [SHA, "--no-copilot", "56"]],
  ["an unknown flag", [SHA, "56", "60", "30", "--wait"]],
  ["an extra argument", [SHA, "56", "60", "30", "9"]]
]) {
  test(`poll-reviews rejects ${name} before calling gh`, () => {
    const result = poll(args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /usage: node poll-reviews\.mjs <40-character head sha>/);
  });
}

test("poll-reviews takes --no-copilot after the pr, also between tries and interval, and twice", () => {
  const expected = { sha: SHA, pr: "56", tries: 3, intervalMs: 5000, skipCopilot: true };
  assert.deepEqual(parseArgs([SHA, "56", "3", "5", "--no-copilot"]), expected);
  assert.deepEqual(parseArgs([SHA, "56", "3", "--no-copilot", "5"]), expected);
  assert.deepEqual(parseArgs([SHA, "56", "--no-copilot", "3", "--no-copilot", "5"]), expected);
  assert.deepEqual(parseArgs([SHA, "56"]), { sha: SHA, pr: "56", tries: 60, intervalMs: 30_000, skipCopilot: false });
});

// GitHub times of one push; the local clock starts the poll a minute later.
const PUSH = Date.parse("2026-10-26T18:00:00Z");
const START = PUSH + 60_000;
const at = (ms) => new Date(ms).toISOString();
const suite = (ms) => ({ app: { slug: "coderabbitai" }, created_at: at(ms) });
const request = (ms, login = "Copilot") => ({
  event: "review_requested",
  created_at: at(ms),
  requested_reviewer: { login, type: "Bot" }
});
const started = (ms) => ({ event: "copilot_work_started", created_at: at(ms) });
const copilotReview = (sha = SHA) => ({ user: { login: "copilot-pull-request-reviewer[bot]" }, commit_id: sha });
const rabbitStatus = (description) => ({ creator: { login: "coderabbitai[bot]" }, state: "success", description });
const RABBIT_DONE = [rabbitStatus("Review completed")];
// CodeRabbit's check run of a clean review, as GitHub sends it.
const rabbitRun = (overrides = {}) => ({
  app: { slug: "coderabbitai" },
  name: "CodeRabbit",
  status: "completed",
  conclusion: "success",
  output: { title: "Finished", summary: "Result: Success - Review completed" },
  ...overrides
});

// A fake `gh api --paginate --slurp`: each value is the items of one page, or a function of the
// local clock, or an Error to throw. Check suites and check runs come wrapped, as GitHub sends them.
function fakeGh(data, clock) {
  const calls = [];
  const ghPages = (apiPath) => {
    calls.push(apiPath);
    const key = ["reviews", "comments", "statuses", "timeline", "check-suites", "check-runs"].find((name) =>
      apiPath.endsWith(`/${name}`)
    );
    let value = data[key] ?? [];
    if (typeof value === "function") {
      value = value(clock.now);
    }
    if (value instanceof Error) {
      throw value;
    }
    if (key === "check-suites") {
      return [{ total_count: value.length, check_suites: value }];
    }
    return key === "check-runs" ? [{ total_count: value.length, check_runs: value }] : [value];
  };
  return { ghPages, calls };
}

async function run(data, { start = START, tries = 60, intervalMs = 30_000, skipCopilot = false, ghPages } = {}) {
  const clock = { now: start };
  const fake = fakeGh(data, clock);
  const result = await pollReviews({
    sha: SHA,
    pr: "56",
    tries,
    intervalMs,
    skipCopilot,
    ghPages: ghPages ?? fake.ghPages,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    }
  });
  return { ...result, calls: fake.calls, waited: clock.now - start };
}

test("a Copilot request with no start is reported as dropped 2 minutes after the poll started", async () => {
  const result = await run({ statuses: RABBIT_DONE, timeline: [request(PUSH + 5000)], "check-suites": [suite(PUSH)] });
  assert.equal(result.code, 4);
  assert.equal(result.waited, 120_000);
  assert.equal(
    result.message,
    `copilot dropped the request made at ${at(PUSH + 5000)}: no copilot_work_started since then`
  );
});

test("a dropped request ends the poll while CodeRabbit is still pending", async () => {
  const result = await run({ timeline: [request(PUSH + 5000)], "check-suites": [suite(PUSH)] });
  assert.equal(result.code, 4);
});

test("a Copilot start, then a review on the head, ends the wait", async () => {
  const result = await run({
    reviews: (now) => (now >= START + 300_000 ? [copilotReview()] : []),
    statuses: RABBIT_DONE,
    timeline: [request(PUSH + 5000), started(PUSH + 35_000)],
    "check-suites": [suite(PUSH)]
  });
  assert.equal(result.code, 0, result.message);
  assert.equal(result.waited, 300_000);
});

test("a Copilot start with no review waits until the poll times out", async () => {
  const result = await run(
    { statuses: RABBIT_DONE, timeline: [request(PUSH + 5000), started(PUSH + 35_000)], "check-suites": [suite(PUSH)] },
    { tries: 10 }
  );
  assert.equal(result.code, 1);
  assert.equal(result.message, "timed out; still pending: copilot");
});

test("a dropped push leaves only an earlier push's request and start, so it is reported", async () => {
  const result = await run({
    statuses: RABBIT_DONE,
    timeline: [request(PUSH - 120_000), started(PUSH - 90_000)],
    "check-suites": [suite(PUSH)]
  });
  assert.equal(result.code, 4);
  assert.match(result.message, new RegExp(at(PUSH)));
});

test("a start before the request time does not count", async () => {
  const result = await run({
    statuses: RABBIT_DONE,
    timeline: [started(PUSH + 1000), request(PUSH + 5000)],
    "check-suites": [suite(PUSH)]
  });
  assert.equal(result.code, 4);
});

test("a request newer than the check suite wins over a start between the two", async () => {
  const result = await run({
    statuses: RABBIT_DONE,
    timeline: [started(PUSH + 20_000), request(PUSH + 30_000)],
    "check-suites": [suite(PUSH)]
  });
  assert.equal(result.code, 4);
});

test("a review on the head wins with no start event", async () => {
  const result = await run({ reviews: [copilotReview()], statuses: RABBIT_DONE, timeline: new Error("not read") });
  assert.equal(result.code, 0);
  assert.equal(result.waited, 0);
});

test("a review that arrives in the check where the drop would be reported wins", async () => {
  const result = await run({
    reviews: (now) => (now >= START + 120_000 ? [copilotReview()] : []),
    statuses: RABBIT_DONE,
    timeline: [request(PUSH + 5000)],
    "check-suites": [suite(PUSH)]
  });
  assert.equal(result.code, 0);
});

test("a Copilot review of an older commit is not a review of the head", async () => {
  const result = await run(
    {
      reviews: [copilotReview("b".repeat(40))],
      statuses: RABBIT_DONE,
      timeline: [request(PUSH + 5000), started(PUSH + 35_000)],
      "check-suites": [suite(PUSH)]
    },
    { tries: 2 }
  );
  assert.equal(result.code, 1);
  assert.equal(result.message, "timed out; still pending: copilot");
});

test("the drop is reported at 2 minutes after the poll start, not 1 ms before", async () => {
  const data = { statuses: RABBIT_DONE, timeline: [request(PUSH + 5000)], "check-suites": [suite(PUSH)] };
  assert.equal((await run(data, { tries: 2, intervalMs: 119_999 })).code, 1);
  assert.equal((await run(data, { tries: 2, intervalMs: 120_000 })).code, 4);
});

test("the window runs on the local clock, also when it is far ahead of GitHub's", async () => {
  const result = await run(
    { statuses: RABBIT_DONE, timeline: [request(PUSH + 5000)], "check-suites": [suite(PUSH)] },
    { start: PUSH + 600_000 }
  );
  assert.equal(result.code, 4);
  assert.equal(result.waited, 120_000);
});

test("a second poll for the same head reports a drop 2 minutes after its own start", async () => {
  const data = { statuses: RABBIT_DONE, timeline: [request(PUSH + 5000)], "check-suites": [suite(PUSH)] };
  assert.equal((await run(data)).code, 4);
  const second = await run(data, { start: START + 300_000 });
  assert.equal(second.code, 4);
  assert.equal(second.waited, 120_000);
});

test("tries that run out before the window end in a timeout, not a drop", async () => {
  const result = await run(
    { statuses: RABBIT_DONE, timeline: [request(PUSH + 5000)], "check-suites": [suite(PUSH)] },
    { tries: 3 }
  );
  assert.equal(result.code, 1);
});

test("with no request event and no check suite, any start counts and no start is a drop", async () => {
  const none = await run({ statuses: RABBIT_DONE });
  assert.equal(none.code, 4);
  assert.match(none.message, /made at an unknown time/);
  const any = await run({ statuses: RABBIT_DONE, timeline: [started(PUSH - 600_000)] }, { tries: 10 });
  assert.equal(any.code, 1);
});

test("a request for another reviewer is ignored", async () => {
  const result = await run(
    {
      statuses: RABBIT_DONE,
      timeline: [started(PUSH + 35_000), request(PUSH + 60_000, "someone")],
      "check-suites": [suite(PUSH)]
    },
    { tries: 10 }
  );
  assert.equal(result.code, 1);
});

test("a team request and an event with no time do not break the poll", async () => {
  const result = await run(
    {
      statuses: RABBIT_DONE,
      timeline: [
        { event: "review_requested", requested_team: { slug: "core" } },
        { event: "copilot_work_started" },
        request(PUSH + 5000),
        started(PUSH + 35_000)
      ],
      "check-suites": [suite(PUSH)]
    },
    { tries: 10 }
  );
  assert.equal(result.code, 1);
});

test("a re-trigger that Copilot takes counts as started", async () => {
  const result = await run(
    {
      reviews: (now) => (now >= PUSH + 400_000 ? [copilotReview()] : []),
      statuses: RABBIT_DONE,
      timeline: [request(PUSH + 200_000), started(PUSH + 230_000)],
      "check-suites": [suite(PUSH)]
    },
    { start: PUSH + 210_000 }
  );
  assert.equal(result.code, 0);
});

test("a check suite found on a later check replaces an earlier push's request", async () => {
  const result = await run({
    statuses: RABBIT_DONE,
    timeline: [request(PUSH - 120_000), started(PUSH - 90_000)],
    "check-suites": (now) => (now >= START + 150_000 ? [suite(PUSH)] : [])
  });
  assert.equal(result.code, 4);
  assert.equal(result.waited, 150_000);
});

test("the timeline is not read before the window, nor after a start is seen", async () => {
  const early = await run({ statuses: RABBIT_DONE, timeline: new Error("not read") }, { tries: 4 });
  assert.equal(early.code, 1);
  assert.ok(!early.calls.some((call) => /timeline|check-suites/.test(call)), early.calls.join(" "));
  const seen = await run(
    { statuses: RABBIT_DONE, timeline: [request(PUSH + 5000), started(PUSH + 35_000)], "check-suites": [suite(PUSH)] },
    { tries: 10 }
  );
  assert.equal(seen.code, 1);
  assert.equal(seen.calls.filter((call) => call.endsWith("/timeline")).length, 1);
  assert.equal(seen.calls.filter((call) => call.endsWith("/check-suites")).length, 1);
  const noSuite = await run(
    { statuses: RABBIT_DONE, timeline: [request(PUSH + 5000), started(PUSH + 35_000)] },
    { tries: 10 }
  );
  assert.equal(noSuite.code, 1);
  assert.equal(noSuite.calls.filter((call) => call.endsWith("/timeline")).length, 6);
  assert.equal(noSuite.calls.filter((call) => call.endsWith("/check-suites")).length, 6);
});

test("limit: with no check suite, an earlier push's start counts and the poll times out", async () => {
  const result = await run(
    { statuses: RABBIT_DONE, timeline: [request(PUSH - 120_000), started(PUSH - 90_000)] },
    { tries: 10 }
  );
  assert.equal(result.code, 1);
});

test("limit: a check suite made after Copilot's start gives a false drop", async () => {
  const result = await run({
    statuses: RABBIT_DONE,
    timeline: [request(PUSH + 5000), started(PUSH + 35_000)],
    "check-suites": [suite(PUSH + 60_000)]
  });
  assert.equal(result.code, 4);
});

test("timeline and check suites are read over every page", async () => {
  const clock = { now: START };
  const ghPages = (apiPath) => {
    if (apiPath.endsWith("/statuses")) {
      return [RABBIT_DONE];
    }
    if (apiPath.endsWith("/timeline")) {
      return [[request(PUSH + 5000)], [started(PUSH + 35_000)]];
    }
    if (apiPath.endsWith("/check-suites")) {
      return [
        { total_count: 2, check_suites: [suite(PUSH + 50_000)] },
        { total_count: 2, check_suites: [suite(PUSH)] }
      ];
    }
    return [[]];
  };
  const result = await pollReviews({
    sha: SHA,
    pr: "56",
    tries: 10,
    intervalMs: 30_000,
    ghPages,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    }
  });
  assert.equal(result.code, 1, result.message);
});

test("a check-suites page with no list or no page at all does not break the poll", async () => {
  const clock = { now: START };
  const ghPages = (apiPath) => {
    if (apiPath.endsWith("/statuses")) {
      return [RABBIT_DONE];
    }
    if (apiPath.endsWith("/timeline")) {
      return [[request(PUSH + 5000), started(PUSH + 35_000)]];
    }
    return apiPath.endsWith("/check-suites") ? [{ total_count: 0 }, null] : [[]];
  };
  const result = await pollReviews({
    sha: SHA,
    pr: "56",
    tries: 10,
    intervalMs: 30_000,
    ghPages,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    }
  });
  assert.equal(result.code, 1, result.message);
});

test("check runs are read over every page, and a page with no list or no page at all does not break the poll", async () => {
  const clock = { now: START };
  const ghPages = (apiPath) =>
    apiPath.endsWith("/check-runs")
      ? [{ total_count: 0 }, null, { total_count: 2, check_runs: [rabbitRun({ name: "CI" })] }, { total_count: 2, check_runs: [rabbitRun()] }]
      : [[]];
  const result = await pollReviews({
    sha: SHA,
    pr: "56",
    tries: 2,
    intervalMs: 30_000,
    skipCopilot: true,
    ghPages,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    }
  });
  assert.equal(result.code, 0, result.message);
});

test("a review and comments with no user are skipped", async () => {
  const ghost = (body) => ({ user: null, updated_at: at(START + 1000), body });
  const ghosts = {
    reviews: [{ user: null, commit_id: SHA }],
    comments: [ghost("Currently processing"), ghost("Review finished.")]
  };
  const done = await run({
    ...ghosts,
    reviews: [...ghosts.reviews, copilotReview()],
    statuses: RABBIT_DONE
  });
  assert.equal(done.code, 0, done.message);
  const pending = await run(ghosts, { tries: 2 });
  assert.equal(pending.code, 1);
  assert.equal(pending.message, "timed out; still pending: copilot, coderabbit");
});

test("a clean CodeRabbit review with only a check run ends the wait", async () => {
  for (const runOfHead of [rabbitRun(), rabbitRun({ output: undefined }), rabbitRun({ output: null })]) {
    const alone = await run({ "check-runs": [runOfHead] }, { skipCopilot: true });
    assert.equal(alone.code, 0, alone.message);
    assert.ok(alone.calls.includes(`repos/tmathura/copilot-plugin-cc/commits/${SHA}/check-runs`), alone.calls.join(" "));
  }
  const withCopilot = await run({ reviews: [copilotReview()], "check-runs": [rabbitRun()] });
  assert.equal(withCopilot.code, 0, withCopilot.message);
  const copilotPending = await run({ "check-runs": [rabbitRun()] }, { tries: 2 });
  assert.equal(copilotPending.message, "timed out; still pending: copilot");
});

for (const [name, runOfHead] of [
  ["a paused title", rabbitRun({ output: { title: "Review paused", summary: "" } })],
  ["a rate-limited summary", rabbitRun({ output: { title: "Finished", summary: "Review rate limited" } })],
  ["a paused summary with no title", rabbitRun({ output: { title: null, summary: "Reviews paused" } })],
  ["a rate-limit-exceeded summary", rabbitRun({ output: { title: "Finished", summary: "Rate limit exceeded" } })],
  ["a limit-reached summary", rabbitRun({ output: { title: "Finished", summary: "Review limit reached" } })],
  ["a skipped title", rabbitRun({ output: { title: "Review skipped", summary: "" } })],
  ["a failure", rabbitRun({ conclusion: "failure" })],
  ["a neutral conclusion", rabbitRun({ conclusion: "neutral" })],
  ["a skipped conclusion", rabbitRun({ conclusion: "skipped" })],
  ["no conclusion", rabbitRun({ conclusion: null })],
  ["a run in progress", rabbitRun({ status: "in_progress", conclusion: null })],
  ["a run in progress that says success", rabbitRun({ status: "in_progress" })],
  ["another app", rabbitRun({ app: { slug: "github-actions" } })],
  ["no app", rabbitRun({ app: null })],
  ["another name", rabbitRun({ name: "CodeRabbit lint" })]
]) {
  test(`a CodeRabbit check run with ${name} does not end the wait`, async () => {
    const result = await run({ "check-runs": [runOfHead] }, { skipCopilot: true, tries: 2 });
    assert.equal(result.code, 1, result.message);
  });
}

test("a successful CodeRabbit check run does not end the wait while it is still processing", async () => {
  const processing = { user: { login: "coderabbitai[bot]" }, updated_at: at(START), body: "Currently processing new changes" };
  const result = await run({ comments: [processing], "check-runs": [rabbitRun()] }, { skipCopilot: true, tries: 2 });
  assert.equal(result.code, 1, result.message);
});

test("a CodeRabbit check run that shows on the second try ends the wait then", async () => {
  const result = await run({ "check-runs": (now) => (now > START ? [rabbitRun()] : []) }, { skipCopilot: true });
  assert.equal(result.code, 0, result.message);
  assert.equal(result.waited, 30_000);
  assert.equal(result.calls.filter((call) => call.endsWith("/check-runs")).length, 2);
});

for (const name of ["reviews", "comments", "statuses", "check-runs"]) {
  test(`a failed ${name} read exits 2`, async () => {
    const result = await run({ statuses: RABBIT_DONE, reviews: [copilotReview()], [name]: new Error("HTTP 502") });
    assert.equal(result.code, 2);
    assert.equal(result.message, "gh failed: HTTP 502");
  });
}

test("a failed timeline or check-suites read exits 2", async () => {
  const timeline = await run({ statuses: RABBIT_DONE, timeline: new Error("HTTP 502") });
  assert.equal(timeline.code, 2);
  assert.equal(timeline.message, "gh failed: HTTP 502");
  const suites = await run({ statuses: RABBIT_DONE, "check-suites": new Error("HTTP 403") });
  assert.equal(suites.code, 2);
});

test("finished reviewers skip the timeline and check-suites reads", async () => {
  const result = await run({
    reviews: [copilotReview()],
    statuses: RABBIT_DONE,
    timeline: new Error("not read"),
    "check-suites": new Error("not read")
  });
  assert.equal(result.code, 0);
  assert.ok(!result.calls.some((call) => /timeline|check-suites/.test(call)), result.calls.join(" "));
});

test("--no-copilot waits for CodeRabbit only and reads no timeline", async () => {
  const pending = await run({ timeline: new Error("not read") }, { skipCopilot: true, tries: 2 });
  assert.equal(pending.code, 1);
  assert.equal(pending.message, "timed out; still pending: coderabbit");
  assert.ok(!pending.calls.some((call) => /timeline|check-suites/.test(call)));
  const done = await run({ statuses: RABBIT_DONE }, { skipCopilot: true });
  assert.equal(done.code, 0);
});

for (const description of ["Review rate limited", "Review paused"]) {
  test(`a CodeRabbit success status "${description}" is not a review of the head`, async () => {
    const result = await run({ statuses: [rabbitStatus(description)] }, { skipCopilot: true, tries: 2 });
    assert.equal(result.code, 1);
  });
}

test("a CodeRabbit review completed after a rate limit ends the wait, in any order", async () => {
  const result = await run(
    { statuses: [rabbitStatus("Review rate limited"), rabbitStatus("Review completed")] },
    { skipCopilot: true }
  );
  assert.equal(result.code, 0);
});

test("a CodeRabbit rate-limit comment does not end the wait", async () => {
  const result = await run(
    {
      statuses: [rabbitStatus("Review rate limited")],
      comments: [{ user: { login: "coderabbitai[bot]" }, updated_at: at(START + 1000), body: "Review limit reached" }]
    },
    { skipCopilot: true, tries: 2 }
  );
  assert.equal(result.code, 1);
});

test("limit: a CodeRabbit 'Review finished' from before the poll start does not end the wait", async () => {
  const finished = { user: { login: "coderabbitai[bot]" }, updated_at: at(START - 1000), body: "Review finished." };
  const before = await run({ comments: [finished] }, { skipCopilot: true, tries: 2 });
  assert.equal(before.code, 1);
  const after = await run(
    { comments: [{ ...finished, updated_at: at(START + 1000) }] },
    { skipCopilot: true, tries: 2 }
  );
  assert.equal(after.code, 0);
});
