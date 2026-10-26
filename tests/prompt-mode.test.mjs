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
    env: buildEnv(binDir, options.env),
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

test("a run whose process cannot be stopped still ends, and the companion can exit", async () => {
  const binDir = makeTempDir();
  const { scriptPath } = installFakeCopilot(binDir, "hang");
  const source = `
    import { CopilotPromptModeClient } from ${JSON.stringify(PROMPT_MODE_URL)};
    const client = CopilotPromptModeClient.start(process.cwd(), {
      command: process.execPath,
      args: [${JSON.stringify(scriptPath)}, "--output-format", "json"],
      prompt: "hello",
      timeoutMs: 200,
      terminateImpl: () => Promise.reject(new Error("kill EPERM"))
    });
    const exit = await client.exitPromise;
    console.log(JSON.stringify({ copilotPid: client.proc.pid, error: exit.error.message }));
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
  const timeout = setTimeout(() => companion.kill(), 10000);

  const code = await exited;
  clearTimeout(timeout);

  assert.equal(code, 0);
  const { copilotPid, error } = JSON.parse(stdout);
  assert.equal(error, "Copilot could not be stopped: kill EPERM");
  await terminateProcessTree(copilotPid);
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

// Raw separators are built at run time, so this file holds none: a tool that reads it by lines would split it.
const SEPARATORS = [
  ["U+2028", String.fromCharCode(0x2028)],
  ["U+2029", String.fromCharCode(0x2029)]
];

for (const [name, separator] of SEPARATORS) {
  test(`an event whose JSON string holds a raw ${name} is read as one event`, async () => {
    const answer = `before${separator}after`;
    const { client, events } = startFake("ok", { env: { FAKE_COPILOT_ANSWER: answer } });

    const exit = await client.exitPromise;

    assert.equal(client.protocolError, null);
    assert.equal(exit.exitCode, 0);
    const messages = events.filter((event) => event.type === "assistant.message");
    assert.equal(messages.at(-1).data.content, answer);
    assert.equal(client.result.exitCode, 0);
  });
}

test("CRLF line ends are read, and no CR stays in the events", async () => {
  const { client, events } = startFake("ok", { env: { FAKE_COPILOT_CRLF: "1" } });

  await client.exitPromise;

  assert.equal(client.protocolError, null);
  assert.equal(events.filter((event) => event.type === "assistant.message").at(-1).data.content, "Fake Copilot answer.");
  assert.ok(events.every((event) => !JSON.stringify(event).includes("\\r")));
  assert.equal(client.result.exitCode, 0);
});

const RESULT_LINE = JSON.stringify({ type: "result", sessionId: "s-1", exitCode: 0 });

// A stand-in Copilot that writes each string as its own chunk, 30 ms apart, then exits or hangs.
function startWriter(writes, { hang = false, ...options } = {}) {
  const source = `
    const writes = ${JSON.stringify(writes)};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    (async () => {
      for (const chunk of writes) {
        process.stdout.write(chunk);
        await sleep(30);
      }
      if (${hang}) {
        setInterval(() => {}, 1000);
      }
    })();
  `;
  const events = [];
  const client = CopilotPromptModeClient.start(makeTempDir(), {
    command: process.execPath,
    args: ["-e", source],
    prompt: "hello",
    onEvent: (event) => events.push(event),
    ...options
  });
  return { client, events };
}

// Only a stand-in that still runs is stopped: an exited pid may belong to another program by now.
function stopIfRunning(child) {
  return child.exitCode === null && child.signalCode === null ? terminateProcessTree(child.pid) : undefined;
}

// The chunks are given to handleChunk directly, because a pipe may join writes that come close together.
test("events are joined across chunks and split within one, also with CR and LF in separate chunks", async (t) => {
  const separator = SEPARATORS[0][1];
  const { client, events } = startWriter([], { hang: true });
  t.after(() => stopIfRunning(client.proc));
  for (const chunk of [
    '{"type":"a.one",',
    '"data":{}}\n{"type":"a.two"}\n{"type":"a.three"}\r',
    "\n",
    `{"type":"a.four","data":{"content":"x${separator}`,
    'y"}}\n'
  ]) {
    client.handleChunk(chunk);
  }
  await client.close();
  await client.exitPromise;

  assert.equal(client.protocolError, null);
  assert.deepEqual(
    events.map((event) => event.type),
    ["a.one", "a.two", "a.three", "a.four"]
  );
  assert.equal(events[3].data.content, `x${separator}y`);
});

test("a lone CR does not end a line, so two events joined by it fail with the quoting error", async () => {
  const { client, events } = startWriter(['{"type":"a.one"}\r{"type":"a.two"}\n']);

  await client.exitPromise;

  assert.match(client.protocolError.message, /Failed to parse Copilot JSON output/);
  assert.ok(client.protocolError.message.includes('{"type":"a.one"}'));
  assert.deepEqual(events, []);
});

test("a last line with no LF is still read: a result is kept, and text that is not JSON fails", async () => {
  const valid = startWriter(['{"type":"a.one"}\n', RESULT_LINE]);
  await valid.client.exitPromise;
  assert.equal(valid.client.protocolError, null);
  assert.equal(valid.client.result.exitCode, 0);
  assert.deepEqual(
    valid.events.map((event) => event.type),
    ["a.one", "result"]
  );

  const broken = startWriter(["not json at the end"]);
  await broken.client.exitPromise;
  assert.match(broken.client.protocolError.message, /Failed to parse Copilot JSON output/);
  assert.match(broken.client.protocolError.message, /not json at the end/);
});

test("a run that times out with part of a line kept keeps its timeout error", async (t) => {
  const { client, events } = startWriter(['{"type":"a.one"}\n{"type":"par'], { hang: true, timeoutMs: 500 });
  t.after(() => stopIfRunning(client.proc));

  await client.exitPromise;

  assert.match(client.protocolError.message, /did not finish within 0\.5 seconds/);
  assert.deepEqual(
    events.map((event) => event.type),
    ["a.one"]
  );
});

// A Copilot that stays alive after its result, and cannot be stopped, ends the run with no protocol
// error. Its pipes are closed then, so the late output is given to handleChunk directly: here only the
// exited guard keeps it from replacing the result.
test("output after the run has finished changes nothing", async (t) => {
  const { client, events } = startWriter([`${RESULT_LINE}\n`], {
    hang: true,
    resultGraceMs: 100,
    terminateImpl: () => Promise.reject(new Error("kill EPERM"))
  });
  // The stand-in runs on after the failed stop, also when an assertion below fails.
  t.after(() => stopIfRunning(client.proc));

  const exit = await client.exitPromise;
  client.handleChunk(`{"type":"result","sessionId":"s-2","exitCode":7}\n{"type":"a.late"}\nnot json\n`);

  assert.equal(exit.error.message, "Copilot could not be stopped: kill EPERM");
  assert.equal(client.forcedExit, true);
  assert.equal(client.protocolError, null);
  assert.equal(client.result.exitCode, 0);
  assert.deepEqual(
    events.map((event) => event.type),
    ["result"]
  );
});

test("output after a protocol error is not read, also in the same chunk", (t) => {
  const { client, events } = startWriter([], { hang: true });
  t.after(() => stopIfRunning(client.proc));
  client.handleChunk(`not json\n{"type":"a.late"}\n{"type":"par`);
  client.handleChunk(`tial"}\n${RESULT_LINE}\n{"type":"more`);

  assert.match(client.protocolError.message, /not json/);
  assert.deepEqual(events, []);
  assert.equal(client.result, null);
  assert.deepEqual(client.lineParts, []);
  return client.exitPromise;
});

test("a separator cut inside its UTF-8 bytes across two pipe chunks is read whole", async () => {
  const source = `
    const line = Buffer.from(JSON.stringify({ type: "a.sep", data: { content: "x" + String.fromCharCode(0x2028) + "y" } }) + "\\n");
    const cut = line.indexOf(0xe2) + 1;
    process.stdout.write(line.subarray(0, cut));
    setTimeout(() => process.stdout.write(line.subarray(cut)), 100);
  `;
  const events = [];
  const client = CopilotPromptModeClient.start(makeTempDir(), {
    command: process.execPath,
    args: ["-e", source],
    prompt: "hello",
    onEvent: (event) => events.push(event)
  });

  await client.exitPromise;

  assert.equal(client.protocolError, null);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.content, `x${SEPARATORS[0][1]}y`);
});

test("an event of more than 1 MB, written in many chunks, is read whole", async () => {
  const source = `
    const line = JSON.stringify({ type: "big", data: { content: "x".repeat(1500000) } }) + "\\n";
    for (let index = 0; index < line.length; index += 65536) {
      process.stdout.write(line.slice(index, index + 65536));
    }
  `;
  const events = [];
  const client = CopilotPromptModeClient.start(makeTempDir(), {
    command: process.execPath,
    args: ["-e", source],
    prompt: "hello",
    onEvent: (event) => events.push(event)
  });

  await client.exitPromise;

  assert.equal(client.protocolError, null);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.content.length, 1500000);
});
