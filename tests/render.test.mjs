// Changed from upstream codex-plugin-cc (Apache-2.0): renamed for the copilot plugin; only write tasks
// show a resume command.
import test from "node:test";
import assert from "node:assert/strict";

import { renderJobStatusReport, renderReviewResult, renderStoredJobResult } from "../plugins/copilot/scripts/lib/render.mjs";

test("renderReviewResult degrades gracefully when JSON is missing required review fields", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "approve",
        summary: "Looks fine."
      },
      rawOutput: JSON.stringify({
        verdict: "approve",
        summary: "Looks fine."
      }),
      parseError: null
    },
    {
      reviewLabel: "Adversarial Review",
      targetLabel: "working tree diff"
    }
  );

  assert.match(output, /Copilot returned JSON with an unexpected review shape\./);
  assert.match(output, /Missing array `findings`\./);
  assert.match(output, /Raw final message:/);
});

test("renderStoredJobResult prefers rendered output for structured review jobs", () => {
  const output = renderStoredJobResult(
    {
      id: "review-123",
      status: "completed",
      title: "Copilot Adversarial Review",
      jobClass: "review",
      threadId: "thr_123"
    },
    {
      threadId: "thr_123",
      rendered: "# Copilot Adversarial Review\n\nTarget: working tree diff\nVerdict: needs-attention\n",
      result: {
        result: {
          verdict: "needs-attention",
          summary: "One issue.",
          findings: [],
          next_steps: []
        },
        rawOutput:
          '{"verdict":"needs-attention","summary":"One issue.","findings":[],"next_steps":[]}'
      }
    }
  );

  assert.match(output, /^# Copilot Adversarial Review/);
  assert.doesNotMatch(output, /^\{/);
  assert.match(output, /Copilot session ID: thr_123/);
  assert.doesNotMatch(output, /Resume in Copilot/);
});

test("renderStoredJobResult shows a resume command for a write task only", () => {
  const job = { id: "task-1", status: "completed", jobClass: "task", threadId: "sess-1" };
  const storedJob = { threadId: "sess-1", result: { rawOutput: "Done." } };

  const writeOutput = renderStoredJobResult({ ...job, write: true }, { ...storedJob, write: true });
  const readOnlyOutput = renderStoredJobResult(job, storedJob);

  assert.equal(writeOutput, "Done.\n\nCopilot session ID: sess-1\nResume in Copilot: copilot --resume=sess-1\n");
  assert.equal(readOnlyOutput, "Done.\n\nCopilot session ID: sess-1\n");
});

test("renderStoredJobResult reads the native review text from the copilot payload", () => {
  const output = renderStoredJobResult(
    { id: "review-1", status: "completed", jobClass: "review" },
    { result: { copilot: { stdout: "No issues found." } } }
  );

  assert.equal(output, "No issues found.\n");
});

test("renderJobStatusReport uses copilot hints and keeps read-only sessions without a command", () => {
  const output = renderJobStatusReport({
    id: "task-2",
    status: "running",
    kindLabel: "rescue",
    jobClass: "task",
    threadId: "sess-2"
  });

  assert.match(output, /^# Copilot Job Status/);
  assert.match(output, /Copilot session ID: sess-2/);
  assert.match(output, /Cancel: \/copilot:cancel task-2/);
  assert.doesNotMatch(output, /Resume in Copilot/);
});
