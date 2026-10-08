import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCopilotArgs,
  buildCopilotEnv,
  getCopilotAuthStatus,
  getCopilotAvailability,
  runPromptModeTurn
} from "../plugins/copilot/scripts/lib/copilot.mjs";
import { buildEnv, installFakeCopilot, readFakeCopilotRuns, readFakeVersionPids } from "./fake-copilot-fixture.mjs";
import { makeTempDir } from "./helpers.mjs";

const ALLOW_ALL_FLAGS = ["--allow-all-tools", "--allow-all", "--yolo", "--allow-all-paths"];
const SECRET_FLAG = "--secret-env-vars=GH_TOKEN,COPILOT_PROVIDER_API_KEY,COPILOT_PROVIDER_BEARER_TOKEN";
const COMMON_ARGS = ["--output-format", "json", "--no-ask-user", "--no-auto-update", SECRET_FLAG];

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Condition not met within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// Spaces in the launcher folder, the working folder and the data folder must reach Copilot unchanged.
function setUp(behavior = "ok", extraEnv = {}) {
  const root = makeTempDir();
  const binDir = path.join(root, "bin dir");
  const workDir = path.join(root, "work dir");
  const dataDir = path.join(root, "plugin data");
  fs.mkdirSync(binDir);
  fs.mkdirSync(workDir);
  const { recordPath } = installFakeCopilot(binDir, behavior);
  const env = buildEnv(binDir, { CLAUDE_PLUGIN_DATA: dataDir, ...extraEnv });
  return { binDir, workDir, dataDir, env, runs: () => readFakeCopilotRuns(recordPath) };
}

test("the read-only profile builds exactly the read-only arguments", () => {
  assert.deepEqual(buildCopilotArgs({ sessionId: "s-1" }), [
    ...COMMON_ARGS,
    "--available-tools=view,glob,grep",
    "--deny-tool=write,shell,memory",
    "--session-id=s-1"
  ]);
});

test("the write profile adds the file tools, the platform shell, the push deny rule and the sandbox", () => {
  const writeArgs = (platform) => buildCopilotArgs({ write: true, sessionId: "s-1", platform });
  const tail = ["--allow-tool=write,shell", "--deny-tool=shell(git push)", "--sandbox", "--session-id=s-1"];

  assert.deepEqual(writeArgs("linux"), [
    ...COMMON_ARGS,
    "--available-tools=view,glob,grep,create,edit,apply_patch,bash",
    ...tail
  ]);
  assert.deepEqual(writeArgs("win32"), [
    ...COMMON_ARGS,
    "--available-tools=view,glob,grep,create,edit,apply_patch,powershell",
    ...tail
  ]);
});

test("no profile passes an allow-all flag", () => {
  const variants = [
    buildCopilotArgs({ sessionId: "s" }),
    buildCopilotArgs({ write: true, sessionId: "s", platform: "linux" }),
    buildCopilotArgs({ write: true, sessionId: "s", platform: "win32" }),
    buildCopilotArgs({ resumeSessionId: "s", model: "m", effort: "high", name: "n" })
  ];
  for (const args of variants) {
    for (const arg of args) {
      assert.ok(!ALLOW_ALL_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)), arg);
    }
  }
});

test("optional values become their flags, and a resumed run passes --resume", () => {
  const args = buildCopilotArgs({ resumeSessionId: "s-9", model: "gpt-5", effort: "high", name: "Task" });

  assert.deepEqual(args.slice(-4), ["--resume=s-9", "--model=gpt-5", "--reasoning-effort=high", "--name=Task"]);
  assert.ok(!args.some((arg) => arg.startsWith("--session-id")));
});

test("the read-only environment uses the plugin home and drops allow-all and prompt-mode opt-ins", () => {
  const env = buildCopilotEnv({
    env: {
      CLAUDE_PLUGIN_DATA: path.join("data", "dir"),
      COPILOT_HOME: "user-home",
      copilot_allow_all: "true",
      COPILOT_ALLOW_ALL: "true",
      GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: "true",
      GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP: "true",
      GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: "true",
      COPILOT_GITHUB_TOKEN: "token"
    }
  });

  assert.deepEqual(env, {
    CLAUDE_PLUGIN_DATA: path.join("data", "dir"),
    COPILOT_GITHUB_TOKEN: "token",
    COPILOT_HOME: path.join("data", "dir", "copilot-home")
  });
});

test("the write environment keeps the user's home and drops allow-all", () => {
  const env = buildCopilotEnv({ write: true, env: { COPILOT_HOME: "user-home", COPILOT_ALLOW_ALL: "1" } });

  assert.deepEqual(env, { COPILOT_HOME: "user-home" });
});

test("the version check uses --no-auto-update and enforces the 1.0.93 floor", async () => {
  assert.deepEqual(await getCopilotAvailability(".", { env: setUp("ok").env }), {
    available: true,
    detail: "GitHub Copilot CLI 1.0.93",
    version: "1.0.93"
  });

  const old = await getCopilotAvailability(".", { env: setUp("old-version").env });
  assert.equal(old.available, false);
  assert.equal(old.version, "1.0.92");
  assert.match(old.detail, /1\.0\.93 or later is needed/);

  // A bare --version reports a newer cached build; the pinned launch is the one that runs.
  assert.equal((await getCopilotAvailability(".", { env: setUp("pinned-old-version").env })).available, false);
});

test("a version check that does not answer is stopped at its time limit, with the child that holds its pipes", async () => {
  const { binDir, env } = setUp("hang-version");

  const status = await getCopilotAvailability(".", { env, timeoutMs: 500 });

  assert.deepEqual(status, {
    available: false,
    detail: "copilot --version did not answer within 0.5 seconds",
    version: null
  });
  const pids = readFakeVersionPids(binDir).flat();
  await waitFor(() => pids.every((pid) => !isAlive(pid)));
});

test("a read-only run starts the resolved launcher with the read-only arguments and environment", async () => {
  const { workDir, dataDir, env, runs } = setUp("ok");

  const result = await runPromptModeTurn(workDir, { prompt: "Review this.", env });

  assert.equal(result.status, 0);
  assert.equal(result.finalMessage, "Fake Copilot answer.");
  assert.deepEqual(result.reasoningSummary, ["Looked at the request."]);
  assert.equal(result.turnId, "1");
  assert.deepEqual(result.touchedFiles, []);
  const [run] = runs();
  assert.equal(run.prompt, "Review this.");
  assert.equal(fs.realpathSync(run.cwd), fs.realpathSync(workDir));
  assert.deepEqual(run.args, buildCopilotArgs({ sessionId: result.threadId }));
  assert.equal(run.env.COPILOT_HOME, path.join(dataDir, "copilot-home"));
  assert.ok(fs.existsSync(path.join(dataDir, "copilot-home")));
  assert.ok(!Object.keys(run.env).some((key) => /^(COPILOT_ALLOW_ALL|GITHUB_COPILOT_PROMPT_MODE_)/i.test(key)));
});

test("a write run passes shell characters in its arguments unchanged, so no shell runs", async () => {
  const { workDir, env, runs } = setUp("ok", { COPILOT_ALLOW_ALL: "true" });
  const model = `gpt "5" & echo hacked | %PATH% $HOME`;

  const result = await runPromptModeTurn(workDir, { prompt: "Fix it.", write: true, model, env });

  assert.equal(result.status, 0);
  const [run] = runs();
  assert.deepEqual(run.args, buildCopilotArgs({ write: true, sessionId: result.threadId, model }));
  assert.ok(run.args.includes("--deny-tool=shell(git push)"));
  assert.equal(run.env.COPILOT_ALLOW_ALL, undefined);
});

test("a read-only run stops when Copilot starts a tool it does not allow", async () => {
  const { workDir, env } = setUp("forbidden-tool");

  const result = await runPromptModeTurn(workDir, { prompt: "Review this.", env });

  assert.equal(result.status, 1);
  assert.match(result.error.message, /"create", which a read-only run does not allow/);
});

test("a run fails on a line that is not JSON, on output cut off before the result, and on a failed result", async () => {
  const bad = setUp("bad-json");
  const badJson = await runPromptModeTurn(bad.workDir, { prompt: "x", env: bad.env });
  assert.equal(badJson.status, 1);
  assert.match(badJson.error.message, /this is not json/);

  const cut = setUp("truncated");
  const truncated = await runPromptModeTurn(cut.workDir, { prompt: "x", env: cut.env });
  assert.equal(truncated.status, 1);
  assert.match(truncated.error.message, /before it sent a result \(exit 1\)\.\nfake copilot: connection lost/);

  const failed = setUp("fail");
  const failedResult = await runPromptModeTurn(failed.workDir, { prompt: "x", env: failed.env });
  assert.equal(failedResult.status, 1);
  assert.equal(failedResult.error, null);
  assert.equal(failedResult.stderr, "fake copilot: model request failed");
});

test("a process that hangs after a successful result still counts as a success", async () => {
  const { workDir, env } = setUp("hang-after-result");

  const result = await runPromptModeTurn(workDir, { prompt: "x", env, resultGraceMs: 200 });

  assert.equal(result.status, 0);
  assert.equal(result.finalMessage, "Fake Copilot answer.");
});

test("a run refuses to start when Copilot is missing or too old", async () => {
  const missingEnv = buildEnv(makeTempDir(), { PATH: makeTempDir() });
  await assert.rejects(runPromptModeTurn(".", { prompt: "x", env: missingEnv }), /npm install -g @github\/copilot/);

  const old = setUp("old-version");
  await assert.rejects(runPromptModeTurn(old.workDir, { prompt: "x", env: old.env }), /1\.0\.92 is not supported/);
  assert.deepEqual(old.runs(), []);
});

test("the login check runs one read-only prompt in the plugin data folder", async () => {
  const { dataDir, env, runs } = setUp("ok");

  const auth = await getCopilotAuthStatus(".", { env });

  assert.equal(auth.loggedIn, true);
  assert.equal(auth.verified, true);
  assert.equal(auth.detail, "logged in");
  const [run] = runs();
  assert.equal(fs.realpathSync(run.cwd), fs.realpathSync(dataDir));
  assert.ok(run.args.includes("--available-tools=view,glob,grep"));
});

test("the login check reports no login from Copilot's real output", async () => {
  const { env } = setUp("not-logged-in");

  const auth = await getCopilotAuthStatus(".", { env });

  assert.equal(auth.loggedIn, false);
  assert.equal(auth.detail, "not logged in");
  assert.equal(auth.requiresGithubAuth, true);
});

test("a login check that fails for another reason reports it on one line, not as a missing login", async () => {
  const { env } = setUp("truncated");

  const auth = await getCopilotAuthStatus(".", { env });

  assert.equal(auth.loggedIn, false);
  assert.equal(auth.detail, "Copilot stopped before it sent a result (exit 1). fake copilot: connection lost");
  assert.equal(auth.requiresGithubAuth, null);
});

test("a login check that hangs is stopped at its time limit", async () => {
  const { env } = setUp("hang");

  const auth = await getCopilotAuthStatus(".", { env, timeoutMs: 300 });

  assert.equal(auth.loggedIn, false);
  assert.match(auth.detail, /did not finish within 0\.3 seconds/);
});

test("a BYOK provider counts as logged in without a GitHub login check", async () => {
  const { env, runs } = setUp("not-logged-in", {
    COPILOT_PROVIDER_BASE_URL: "http://localhost:11434/v1",
    COPILOT_PROVIDER_TYPE: "anthropic"
  });

  const auth = await getCopilotAuthStatus(".", { env });

  assert.equal(auth.loggedIn, true);
  assert.equal(auth.source, "byok");
  assert.equal(auth.provider, "anthropic");
  assert.deepEqual(runs(), []);
});
