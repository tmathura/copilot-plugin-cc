import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import { CopilotPromptModeClient } from "../plugins/copilot/scripts/lib/prompt-mode.mjs";
import { terminateProcessTree } from "../plugins/copilot/scripts/lib/process.mjs";
import { buildEnv, installFakeCopilot, readFakeCopilotRuns } from "./fake-copilot-fixture.mjs";
import { makeTempDir } from "./helpers.mjs";

const PROMPT_MODE_URL = pathToFileURL(
  path.resolve(import.meta.dirname, "..", "plugins", "copilot", "scripts", "lib", "prompt-mode.mjs")
).href;

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

function startFake(behavior, options = {}) {
  const binDir = makeTempDir();
  const { scriptPath, recordPath } = installFakeCopilot(binDir, behavior);
  const events = [];
  const client = CopilotPromptModeClient.start(binDir, {
    command: process.execPath,
    args: [scriptPath, "--output-format", "json", "--session-id=s-1"],
    env: buildEnv(binDir),
    prompt: options.prompt ?? "hello",
    resultGraceMs: options.resultGraceMs,
    onEvent: (event) => events.push(event)
  });
  return { client, events, recordPath };
}

test("the prompt reaches stdin unchanged, including shell characters and 300 KB of text", async () => {
  const unit = `quote " apostrophe ' & | % ^ < > $HOME \`tick\` ünïcødé 日本 `;
  const prompt = unit.repeat(Math.ceil((300 * 1024) / unit.length));
  const { client, recordPath } = startFake("ok", { prompt });

  const exit = await client.exitPromise;

  assert.equal(exit.exitCode, 0);
  const [run] = readFakeCopilotRuns(recordPath);
  assert.equal(run.prompt, prompt);
  assert.ok(Buffer.byteLength(run.prompt) > 300 * 1024);
});

test("events reach the handler in order, JSON that is not an event is skipped, and the result is kept", async () => {
  const { client, events } = startFake("ok");

  await client.exitPromise;

  assert.equal(client.protocolError, null);
  assert.ok(events.every((event) => event && typeof event.type === "string"));
  const known = events.map((event) => event.type).filter((type) => !type.startsWith("session."));
  assert.deepEqual(known, [
    "assistant.turn_start",
    "assistant.reasoning",
    "assistant.message",
    "tool.execution_start",
    "tool.execution_complete",
    "assistant.turn_start",
    "assistant.message",
    "result"
  ]);
  assert.equal(client.result.exitCode, 0);
  assert.equal(client.result.sessionId, "s-1");
  assert.equal(client.forcedExit, false);
});

test("a line that is not JSON ends the run with an error that quotes it", async () => {
  const { client } = startFake("bad-json");

  await client.exitPromise;

  assert.match(client.protocolError.message, /Failed to parse Copilot JSON output/);
  assert.match(client.protocolError.message, /this is not json/);
});

test("output cut off before the result reports the exit code and stderr", async () => {
  const { client } = startFake("truncated");

  const exit = await client.exitPromise;

  assert.equal(exit.exitCode, 1);
  assert.equal(client.result, null);
  assert.match(client.stderr, /connection lost/);
});

test("close kills a running process tree", async () => {
  const { client, events } = startFake("hang");
  await waitFor(() => events.some((event) => event.type === "assistant.turn_start"));
  const grandchildPid = events.find((event) => event.type === "fake.child").data.pid;

  await client.close();

  assert.equal(isAlive(client.proc.pid), false);
  await waitFor(() => !isAlive(grandchildPid));
});

test("a process that stays alive after the result is killed, and the result is kept", async () => {
  const { client } = startFake("hang-after-result", { resultGraceMs: 200 });

  await client.exitPromise;

  assert.equal(client.forcedExit, true);
  assert.equal(client.result.exitCode, 0);
});

test("a run that passes its time limit is stopped with an error", async () => {
  const binDir = makeTempDir();
  const { scriptPath } = installFakeCopilot(binDir, "hang");
  const client = CopilotPromptModeClient.start(binDir, {
    command: process.execPath,
    args: [scriptPath, "--output-format", "json"],
    prompt: "hello",
    timeoutMs: 300
  });

  await client.exitPromise;

  assert.match(client.protocolError.message, /did not finish within 0\.3 seconds/);
  assert.equal(isAlive(client.proc.pid), false);
});

test("a run whose process cannot be stopped still ends, with the kill error", async () => {
  const binDir = makeTempDir();
  const { scriptPath } = installFakeCopilot(binDir, "hang");
  const client = CopilotPromptModeClient.start(binDir, {
    command: process.execPath,
    args: [scriptPath, "--output-format", "json"],
    prompt: "hello",
    timeoutMs: 200,
    terminateImpl: () => Promise.reject(new Error("kill EPERM"))
  });

  const exit = await client.exitPromise;

  assert.equal(exit.error.message, "Copilot could not be stopped: kill EPERM");
  assert.match(client.protocolError.message, /did not finish within 0\.2 seconds/);
  await terminateProcessTree(client.proc.pid);
});

test("a missing program ends the run with the spawn error", async () => {
  const client = CopilotPromptModeClient.start(makeTempDir(), {
    command: path.join(makeTempDir(), "no-such-copilot"),
    args: [],
    prompt: "hello"
  });

  const exit = await client.exitPromise;

  assert.equal(exit.error.code, "ENOENT");
});

test(
  "a companion stopped with SIGTERM stops its Copilot process group",
  { skip: process.platform === "win32" && "Windows stops the tree with taskkill /T" },
  async () => {
    const binDir = makeTempDir();
    const { scriptPath } = installFakeCopilot(binDir, "hang");
    const source = `
      import { CopilotPromptModeClient } from ${JSON.stringify(PROMPT_MODE_URL)};
      const client = CopilotPromptModeClient.start(process.cwd(), {
        command: process.execPath,
        args: [${JSON.stringify(scriptPath)}, "--output-format", "json"],
        prompt: "hello",
        onEvent: (event) => {
          if (event.type === "fake.child") {
            console.log(JSON.stringify({ copilotPid: client.proc.pid, grandchildPid: event.data.pid }));
          }
        }
      });
    `;
    const companion = spawn(process.execPath, ["--input-type=module", "-e", source], {
      cwd: binDir,
      stdio: ["ignore", "pipe", "inherit"]
    });
    let stdout = "";
    companion.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const exited = new Promise((resolve) => companion.on("exit", (code) => resolve(code)));
    await waitFor(() => stdout.includes("\n"));
    const { copilotPid, grandchildPid } = JSON.parse(stdout);

    companion.kill("SIGTERM");

    assert.equal(await exited, 143);
    await waitFor(() => !isAlive(copilotPid) && !isAlive(grandchildPid));
  }
);
