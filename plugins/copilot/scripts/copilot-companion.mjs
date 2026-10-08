#!/usr/bin/env node
// Changed from upstream codex-plugin-cc (Apache-2.0): ported from codex-companion.mjs for the Copilot
// CLI. Setup checks the Copilot version and runs a login check; there is no transfer subcommand.
// Reviews send the diff in the prompt, write large diffs to a patch folder, and check the
// adversarial review's JSON against the schema.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  CHECK_HINT,
  getCopilotAuthStatus,
  getCopilotAvailability,
  getSessionRuntimeStatus,
  parseStructuredOutput,
  readOutputSchema,
  runPromptModeReview,
  runPromptModeTurn,
  UPDATE_HINT,
  validateReviewOutput
} from "./lib/copilot.mjs";
import { createTempDir } from "./lib/fs.mjs";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget, writeReviewPatches } from "./lib/git.mjs";
import { binaryAvailable } from "./lib/process.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import { generateJobId, getConfig, setConfig } from "./lib/state.mjs";
import {
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  runTrackedJob
} from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { renderNativeReviewResult, renderReviewResult, renderSetupReport } from "./lib/render.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_SCHEMA = path.join(ROOT_DIR, "schemas", "review-output.schema.json");

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/copilot-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  node scripts/copilot-companion.mjs review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>]",
      "  node scripts/copilot-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [focus text]"
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

async function buildSetupReport(cwd, actionsTaken = []) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const npmStatus = binaryAvailable("npm", ["--version"], { cwd });
  const copilotStatus = await getCopilotAvailability(cwd);
  const authStatus = await getCopilotAuthStatus(cwd, { availability: copilotStatus });
  const config = getConfig(workspaceRoot);

  const nextSteps = [];
  if (copilotStatus.missing) {
    nextSteps.push("Install Copilot with `npm install -g @github/copilot`.");
  } else if (copilotStatus.version && !copilotStatus.available) {
    nextSteps.push(`Copilot CLI ${copilotStatus.version} is too old. ${UPDATE_HINT}`);
  } else if (!copilotStatus.available) {
    nextSteps.push(CHECK_HINT);
  }
  if (copilotStatus.available && !authStatus.loggedIn && authStatus.requiresGithubAuth) {
    nextSteps.push("Run `!copilot login`.");
    nextSteps.push("If browser login is blocked, retry with `!copilot login --device-code`.");
    nextSteps.push(
      "On a system without a credential store, `copilot login` saves the token in a file that the plugin cannot read. Set `COPILOT_GITHUB_TOKEN` to a fine-grained token with the \"Copilot Requests\" permission instead."
    );
  }
  if (!config.stopReviewGate) {
    nextSteps.push("Optional: run `/copilot:setup --enable-review-gate` to require a fresh review before stop.");
  }

  return {
    ready: nodeStatus.available && copilotStatus.available && authStatus.loggedIn,
    node: nodeStatus,
    npm: npmStatus,
    copilot: copilotStatus,
    auth: authStatus,
    sessionRuntime: getSessionRuntimeStatus(),
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken,
    nextSteps
  };
}

async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"]
  });

  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken = [];

  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actionsTaken.push(`Enabled the stop-time review gate for ${workspaceRoot}.`);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actionsTaken.push(`Disabled the stop-time review gate for ${workspaceRoot}.`);
  }

  const finalReport = await buildSetupReport(cwd, actionsTaken);
  outputResult(options.json ? finalReport : renderSetupReport(finalReport), options.json);
}

function buildNativeReviewPrompt(context, reviewInput) {
  const template = loadPromptTemplate(ROOT_DIR, "review");
  return interpolateTemplate(template, {
    TARGET_LABEL: context.target.label,
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: reviewInput
  });
}

function buildAdversarialReviewPrompt(context, focusText, reviewInput, schema) {
  const template = loadPromptTemplate(ROOT_DIR, "adversarial-review");
  return interpolateTemplate(template, {
    REVIEW_KIND: "Adversarial Review",
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: reviewInput,
    OUTPUT_SCHEMA: JSON.stringify(schema, null, 2)
  });
}

function validateNativeReviewRequest(target, focusText) {
  if (focusText.trim()) {
    throw new Error(
      `\`/copilot:review\` now maps directly to the built-in reviewer and does not support custom focus text. Retry with \`/copilot:adversarial-review ${focusText.trim()}\` for focused review instructions.`
    );
  }

  if (target.mode !== "working-tree" && target.mode !== "branch") {
    throw new Error("This `/copilot:review` target is not supported by the built-in reviewer. Retry with `/copilot:adversarial-review` for custom targeting.");
  }
}

// Copilot has no shell in a review, so above the inline limit it reads the exact patches from a folder
// that only this run can see. The folder is removed after the run, whatever the outcome.
async function withReviewPatches(context, run) {
  if (context.inputMode !== "self-collect") {
    return run({ reviewInput: context.content, addDirs: [] });
  }

  const patchDir = createTempDir("copilot-review-");
  const removePatchDir = () => fs.rmSync(patchDir, { recursive: true, force: true });
  // A companion stopped with SIGTERM or SIGINT exits from its signal handler, where finally does not run.
  process.once("exit", removePatchDir);
  try {
    const files = writeReviewPatches(context, patchDir);
    const reviewInput = [context.content.trimEnd(), "", "## Patch Files", "", ...files.map((file) => `- ${file}`), ""].join("\n");
    return await run({ reviewInput, addDirs: [patchDir] });
  } finally {
    process.off("exit", removePatchDir);
    removePatchDir();
  }
}

// The run's own error comes first; Copilot's stderr is added unless the error already quotes it.
function describeRunFailure(result) {
  const message = result.error?.message ?? "";
  return message.includes(result.stderr) ? message : [message, result.stderr].filter(Boolean).join("\n");
}

async function executeReviewRun(request) {
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });
  const focusText = request.focusText?.trim() ?? "";
  const reviewName = request.reviewName ?? "Review";
  if (reviewName === "Review") {
    validateNativeReviewRequest(target, focusText);
    const context = collectReviewContext(request.cwd, target);
    const result = await withReviewPatches(context, ({ reviewInput, addDirs }) =>
      runPromptModeReview(context.repoRoot, {
        prompt: buildNativeReviewPrompt(context, reviewInput),
        addDirs,
        model: request.model,
        onProgress: request.onProgress
      })
    );
    const payload = {
      review: reviewName,
      target,
      threadId: result.threadId,
      // Copilot has no separate review thread.
      sourceThreadId: result.threadId,
      copilot: {
        status: result.status,
        stderr: result.stderr,
        stdout: result.reviewText,
        reasoning: result.reasoningSummary
      }
    };
    const rendered = renderNativeReviewResult(
      {
        status: result.status,
        stdout: result.reviewText,
        stderr: describeRunFailure(result)
      },
      { reviewLabel: reviewName, targetLabel: target.label, reasoningSummary: result.reasoningSummary }
    );

    return {
      exitStatus: result.status,
      threadId: result.threadId,
      turnId: result.turnId,
      payload,
      rendered,
      summary: firstMeaningfulLine(result.reviewText, `${reviewName} completed.`),
      jobTitle: `Copilot ${reviewName}`,
      jobClass: "review",
      targetLabel: target.label
    };
  }

  const context = collectReviewContext(request.cwd, target);
  const schema = readOutputSchema(REVIEW_SCHEMA);
  const result = await withReviewPatches(context, ({ reviewInput, addDirs }) =>
    runPromptModeTurn(context.repoRoot, {
      prompt: buildAdversarialReviewPrompt(context, focusText, reviewInput, schema),
      addDirs,
      model: request.model,
      onProgress: request.onProgress
    })
  );
  const failureMessage = describeRunFailure(result);
  let parsed = parseStructuredOutput(result.finalMessage, {
    status: result.status,
    failureMessage
  });
  // A stopped run failed, even if it sent JSON first. Codex enforced the schema; here an answer of the
  // wrong shape fails the job like broken JSON.
  let reviewError = parsed.parseError;
  if (result.error) {
    reviewError = failureMessage;
  } else if (!reviewError) {
    const schemaError = validateReviewOutput(parsed.parsed, schema);
    reviewError = schemaError && `The JSON does not match the review schema: ${schemaError}`;
  }
  if (reviewError !== parsed.parseError) {
    parsed = { ...parsed, parsed: null, parseError: reviewError };
  }
  const payload = {
    review: reviewName,
    target,
    threadId: result.threadId,
    context: {
      repoRoot: context.repoRoot,
      branch: context.branch,
      summary: context.summary
    },
    copilot: {
      status: result.status,
      stderr: result.stderr,
      stdout: result.finalMessage,
      reasoning: result.reasoningSummary
    },
    result: parsed.parsed,
    rawOutput: parsed.rawOutput,
    parseError: parsed.parseError,
    reasoningSummary: result.reasoningSummary
  };

  return {
    exitStatus: result.status !== 0 ? result.status : parsed.parseError ? 1 : 0,
    threadId: result.threadId,
    turnId: result.turnId,
    payload,
    rendered: renderReviewResult(parsed, {
      reviewLabel: reviewName,
      targetLabel: context.target.label,
      reasoningSummary: result.reasoningSummary
    }),
    summary: parsed.parsed?.summary ?? parsed.parseError ?? firstMeaningfulLine(result.finalMessage, `${reviewName} finished.`),
    jobTitle: `Copilot ${reviewName}`,
    jobClass: "review",
    targetLabel: context.target.label
  };
}

function buildReviewJobMetadata(reviewName, target) {
  return {
    kind: reviewName === "Adversarial Review" ? "adversarial-review" : "review",
    title: reviewName === "Review" ? "Copilot Review" : `Copilot ${reviewName}`,
    summary: `${reviewName} ${target.label}`
  };
}

function getJobKindLabel(kind, jobClass) {
  if (kind === "adversarial-review") {
    return "adversarial-review";
  }
  return jobClass === "review" ? "review" : "rescue";
}

function createCompanionJob({ prefix, kind, title, workspaceRoot, jobClass, summary, write = false }) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: getJobKindLabel(kind, jobClass),
    title,
    workspaceRoot,
    jobClass,
    summary,
    write
  });
}

function createTrackedProgress(job, options = {}) {
  const logFile = options.logFile ?? createJobLogFile(job.workspaceRoot, job.id, job.title);
  return {
    logFile,
    progress: createProgressReporter({
      stderr: Boolean(options.stderr),
      logFile,
      onEvent: createJobProgressUpdater(job.workspaceRoot, job.id)
    })
  };
}

async function runForegroundCommand(job, runner, options = {}) {
  const { logFile, progress } = createTrackedProgress(job, {
    logFile: options.logFile,
    stderr: !options.json
  });
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
  return execution;
}

async function handleReviewCommand(argv, config) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd"],
    booleanOptions: ["json", "background", "wait"],
    aliasMap: {
      m: "model"
    }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();
  const target = resolveReviewTarget(cwd, {
    base: options.base,
    scope: options.scope
  });

  config.validateRequest?.(target, focusText);
  const metadata = buildReviewJobMetadata(config.reviewName, target);
  const job = createCompanionJob({
    prefix: "review",
    kind: metadata.kind,
    title: metadata.title,
    workspaceRoot,
    jobClass: "review",
    summary: metadata.summary
  });
  await runForegroundCommand(
    job,
    (progress) =>
      executeReviewRun({
        cwd,
        base: options.base,
        scope: options.scope,
        model: options.model,
        focusText,
        reviewName: config.reviewName,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleReview(argv) {
  return handleReviewCommand(argv, {
    reviewName: "Review",
    validateRequest: validateNativeReviewRequest
  });
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      await handleSetup(argv);
      break;
    case "review":
      await handleReview(argv);
      break;
    case "adversarial-review":
      await handleReviewCommand(argv, {
        reviewName: "Adversarial Review"
      });
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
