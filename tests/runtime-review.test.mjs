// Changed from upstream codex-plugin-cc (Apache-2.0): split out of tests/runtime.test.mjs;
// the review tests run the Copilot companion against the fake copilot CLI.
import test from "node:test";
import assert from "node:assert/strict";

import {
  FINDING,
  REVIEW_JSON,
  addDirsOf,
  assertReadOnlyRun,
  git,
  makeRepo,
  readJobs,
  runReview,
  setUpTasks
} from "./runtime-helpers.mjs";

test("a review's job summary skips headings and bold labels, and keeps a bold sentence without its markers", () => {
  const cases = [
    ["## Review\n\nThe loop skips the last item.\n", "The loop skips the last item."],
    ["**Review findings**\n\n1. The loop skips the last item.\n", "1. The loop skips the last item."],
    ["**Findings:**\n- The loop skips the last item.\n", "- The loop skips the last item."],
    ["**The change breaks the empty case.**\n\nDetails follow.\n", "The change breaks the empty case."],
    ["## Review\n---\n__Findings__\n```\nThe loop skips the last item.\n", "The loop skips the last item."],
    ["**Findings in my_module**:\n**The get_user call fails for a*b.**\n", "The get_user call fails for a*b."],
    ["**Is the empty case handled?**\n", "Is the empty case handled?"],
    ["**a** and **b** differ.\n", "**a** and **b** differ."],
    ["***Findings***\r\n~~~markdown\r\n***The cache never expires.***\r\n", "The cache never expires."],
    ["~~~\n~~~\n* * *\n-  -  -\n", "Review completed."],
    ["# Review\n\n### Findings\n\n**Summary**\n", "Review completed."]
  ];
  for (const [answer, summary] of cases) {
    const { result, dataDir } = runReview("review", makeRepo(), { env: { FAKE_COPILOT_ANSWER: answer } });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readJobs(dataDir)[0].summary, summary, answer);
  }

  const { companion, dataDir } = setUpTasks("ok", { env: { FAKE_COPILOT_ANSWER: "## Done\n\nI fixed the null check." } });
  assert.equal(companion(["task", "fix it"]).status, 0);
  assert.equal(readJobs(dataDir)[0].summary, "I fixed the null check.");
});

test("review sends /review with the working-tree diff on the read-only profile", () => {
  const repo = makeRepo();
  const { result, runs, dataDir } = runReview("review", repo);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Copilot Review\n\nTarget: working tree diff\n/);
  assert.match(result.stdout, /Fake Copilot answer\./);
  assert.equal(runs.length, 1);
  assert.match(runs[0].prompt, /^\/review the working tree diff\./);
  assert.match(runs[0].prompt, /export const value = items\[0\]\.id;/);
  assertReadOnlyRun(runs[0], dataDir);
  assert.deepEqual(addDirsOf(runs[0]), []);
  assert.equal(readJobs(dataDir)[0].status, "completed");
});

test("review --json gives upstream's payload, with the session as both thread ids", () => {
  const { result, runs } = runReview("review", makeRepo(), { args: ["--json"] });
  const payload = JSON.parse(result.stdout);
  const sessionId = runs[0].args.find((arg) => arg.startsWith("--session-id=")).slice("--session-id=".length);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.review, "Review");
  assert.equal(payload.target.mode, "working-tree");
  assert.equal(payload.threadId, sessionId);
  assert.equal(payload.sourceThreadId, sessionId);
  assert.equal(payload.copilot.status, 0);
  assert.equal(payload.copilot.stdout, "Fake Copilot answer.");
  assert.deepEqual(payload.copilot.reasoning, ["Looked at the request."]);
});

test("review accepts the quoted raw argument style for base-branch review", () => {
  const repo = makeRepo();
  git(repo, "checkout", "-q", "-b", "feature");
  git(repo, "commit", "-qam", "change");

  const { result, runs } = runReview("review", repo, { args: ["--base main"] });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Target: branch diff against main/);
  assert.match(runs[0].prompt, /^\/review the branch diff against main\./);
  assert.match(runs[0].prompt, /export const value = items\[0\]\.id;/);
});

test("review rejects focus text because it is native-review only", () => {
  const { result, runs } = runReview("review", makeRepo(), { args: ["--scope working-tree focus on auth"] });

  assert.equal(result.status > 0, true);
  assert.match(result.stderr, /does not support custom focus text/i);
  assert.match(result.stderr, /\/copilot:adversarial-review focus on auth/i);
  assert.deepEqual(runs, []);
});

test("review refuses --write instead of running a review that can write", () => {
  const { result, runs } = runReview("review", makeRepo(), { args: ["--write"] });

  assert.equal(result.status > 0, true);
  assert.match(result.stderr, /does not support custom focus text/i);
  assert.deepEqual(runs, []);
});

test("review and adversarial review reject staged-only scope", () => {
  for (const subcommand of ["review", "adversarial-review"]) {
    const repo = makeRepo();
    git(repo, "add", "src/app.js");
    const { result } = runReview(subcommand, repo, { args: ["--scope", "staged"] });

    assert.equal(result.status > 0, true, subcommand);
    assert.match(result.stderr, /Unsupported review scope "staged"/i);
    assert.match(result.stderr, /Use one of: auto, working-tree, branch, or pass --base <ref>/i);
  }
});

test("adversarial review renders structured findings and puts the schema in the prompt", () => {
  const { result, runs, dataDir } = runReview("adversarial-review", makeRepo(), {
    env: { FAKE_COPILOT_ANSWER: REVIEW_JSON }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verdict: needs-attention/);
  assert.match(result.stdout, /\[high\] Missing empty-state guard \(src\/app\.js:1\)/);
  assert.match(runs[0].prompt, /You are Copilot performing an adversarial software review/);
  assert.match(runs[0].prompt, /<output_schema>\n\{\n {2}"\$schema"/);
  assert.match(runs[0].prompt, /"needs-attention"/);
  assertReadOnlyRun(runs[0], dataDir);
});

test("adversarial review accepts the same base-branch targeting as review", () => {
  const repo = makeRepo();
  git(repo, "checkout", "-q", "-b", "feature");
  git(repo, "commit", "-qam", "change");

  const { result } = runReview("adversarial-review", repo, {
    args: ["--base", "main"],
    env: { FAKE_COPILOT_ANSWER: REVIEW_JSON }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Target: branch diff against main/);
  assert.match(result.stdout, /Missing empty-state guard/);
});

test("adversarial review accepts JSON inside one code fence", () => {
  const { result } = runReview("adversarial-review", makeRepo(), {
    env: { FAKE_COPILOT_ANSWER: `\`\`\`json\n${REVIEW_JSON}\n\`\`\`` }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Missing empty-state guard/);
});

test("adversarial review reads the verdict from one code fence with text around it", () => {
  const fence = `\`\`\`json\n${REVIEW_JSON}\n\`\`\``;
  for (const answer of [
    `Fine; EPERM treated as alive (conservative).\n\n${fence}`,
    `${fence}\n\nThat is the verdict.`,
    `Here it is:\n${fence}\nDone.`,
    `Here it is:\r\n\r\n${fence.replace(/\n/g, "\r\n")}\r\n`
  ]) {
    const { result } = runReview("adversarial-review", makeRepo(), { env: { FAKE_COPILOT_ANSWER: answer } });

    assert.equal(result.status, 0, `${JSON.stringify(answer)}\n${result.stderr}`);
    assert.match(result.stdout, /Missing empty-state guard/, JSON.stringify(answer));
  }
});

// The error that the first parse gives: the whole answer, or the content of a fence that is the
// whole answer.
function firstParseError(answer) {
  const fenced = /^\s*```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```\s*$/.exec(answer);
  try {
    JSON.parse(fenced ? fenced[1] : answer);
  } catch (error) {
    return error.message;
  }
  throw new Error(`The answer parses: ${answer}`);
}

test("an answer without exactly one closed JSON fence fails the job with the first parse error", () => {
  const fence = (body) => `\`\`\`json\n${body}\n\`\`\``;
  const verdict = fence(REVIEW_JSON);
  const notJson = "```js\nconst x = 1;\n```";
  const empty = "```\n```";
  for (const answer of [
    `${verdict}\n${verdict}`,
    `Two verdicts:\n${verdict}\nand\n${verdict}`,
    `${verdict}\n${notJson}`,
    `${notJson}\n${verdict}`,
    `${verdict}\n${empty}`,
    `${empty}\n${verdict}`,
    fence("{not json"),
    `Here it is:\n${fence("{not json")}\nDone.`,
    `Here it is:\n\`\`\`json\n${REVIEW_JSON}`,
    `${verdict}\nAnd one more:\n\`\`\`json\n${REVIEW_JSON}`
  ]) {
    const { result, dataDir } = runReview("adversarial-review", makeRepo(), {
      args: ["--json"],
      env: { FAKE_COPILOT_ANSWER: answer }
    });
    const payload = JSON.parse(result.stdout);

    assert.equal(result.status, 1, answer);
    assert.equal(payload.parseError, firstParseError(answer), answer);
    assert.equal(payload.result, null, answer);
    assert.equal(payload.rawOutput, answer, answer);
    assert.equal(readJobs(dataDir)[0].status, "failed", answer);
  }

  const twoVerdicts = `${verdict}\n${verdict}`;
  const { result } = runReview("adversarial-review", makeRepo(), { env: { FAKE_COPILOT_ANSWER: twoVerdicts } });
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes(`Parse error: ${firstParseError(twoVerdicts)}`), result.stdout);
  assert.ok(result.stdout.includes(twoVerdicts), result.stdout);
});

test("a fenced verdict with text around it that has the wrong shape gets the schema error", () => {
  const answer = `Here it is:\n\`\`\`json\n${JSON.stringify({ ...JSON.parse(REVIEW_JSON), verdict: "maybe" })}\n\`\`\`\nDone.`;
  const { result } = runReview("adversarial-review", makeRepo(), {
    args: ["--json"],
    env: { FAKE_COPILOT_ANSWER: answer }
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.parseError, "The JSON does not match the review schema: `verdict` must be one of: approve, needs-attention.");
  assert.equal(payload.rawOutput, answer);
});

test("broken review JSON fails the job and keeps the raw output", () => {
  const answer = "The change looks fine to me.";
  const { result, dataDir } = runReview("adversarial-review", makeRepo(), {
    args: ["--json"],
    env: { FAKE_COPILOT_ANSWER: answer }
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.match(payload.parseError, /JSON/);
  assert.equal(payload.result, null);
  assert.equal(payload.rawOutput, answer);
  assert.equal(readJobs(dataDir)[0].status, "failed");
});

test("valid review JSON with the wrong shape fails the job and keeps the raw output", () => {
  const review = JSON.parse(REVIEW_JSON);
  const { file, ...findingWithoutFile } = FINDING;
  assert.equal(file, "src/app.js");
  const cases = [
    [null, "The review output must be of type object."],
    [{}, "The review output is missing `verdict`."],
    [{ ...review, verdict: "maybe" }, "`verdict` must be one of: approve, needs-attention."],
    [{ ...review, findings: [findingWithoutFile] }, "`findings[0]` is missing `file`."],
    [{ ...review, constructor: "unexpected" }, "The review output has the unknown field `constructor`."],
    [{ ...review, findings: [{ ...FINDING, toString: "unexpected" }] }, "`findings[0]` has the unknown field `toString`."]
  ].map(([value, error]) => [value, `The JSON does not match the review schema: ${error}`]);

  for (const [value, expectedError] of cases) {
    const answer = JSON.stringify(value);
    const { result, dataDir } = runReview("adversarial-review", makeRepo(), {
      args: ["--json"],
      env: { FAKE_COPILOT_ANSWER: answer }
    });
    const payload = JSON.parse(result.stdout);

    assert.equal(result.status, 1, answer);
    assert.equal(payload.parseError, expectedError);
    assert.equal(payload.result, null);
    assert.equal(payload.rawOutput, answer);
    assert.equal(readJobs(dataDir)[0].status, "failed", answer);
  }
});
