// Changed from upstream codex-plugin-cc (Apache-2.0): the setup tests run the Copilot companion
// against the fake copilot CLI. Reviews, tasks, jobs and hooks come in later tickets.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCopilot, readFakeCopilotRuns, readFakeVersionPids } from "./fake-copilot-fixture.mjs";
import { makeTempDir, run } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "copilot");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "copilot-companion.mjs");

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

function runSetup(behavior, options = {}) {
  const binDir = makeTempDir();
  const { recordPath } = installFakeCopilot(binDir, behavior);
  const cwd = options.cwd ?? makeTempDir();
  const result = run(process.execPath, [SCRIPT, "setup", ...(options.args ?? ["--json"])], {
    cwd,
    env: buildEnv(binDir, { CLAUDE_PLUGIN_DATA: makeTempDir(), ...options.env })
  });
  return { result, runs: () => readFakeCopilotRuns(recordPath) };
}

function parsePayload(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("setup reports ready when fake copilot is installed and logged in", () => {
  const payload = parsePayload(runSetup("ok").result);

  assert.equal(payload.ready, true);
  assert.equal(payload.copilot.detail, "GitHub Copilot CLI 1.0.93");
  assert.equal(payload.auth.loggedIn, true);
  assert.equal(payload.sessionRuntime.mode, "direct");
  assert.equal(payload.reviewGateEnabled, false);
});

test("setup reports a missing CLI, and that npm is available to install it", () => {
  // The Node folder holds npm but not copilot, so only resolveLauncher can find npm there on Windows.
  const { result, runs } = runSetup("ok", { env: { PATH: path.dirname(process.execPath) } });
  const payload = parsePayload(result);

  assert.equal(payload.ready, false);
  assert.equal(payload.copilot.available, false);
  assert.equal(payload.copilot.missing, true);
  assert.equal(payload.npm.available, true);
  assert.ok(payload.nextSteps.includes("Install Copilot with `npm install -g @github/copilot`."));
  assert.deepEqual(runs(), []);
});

test("setup refuses a Copilot version below 1.0.93", () => {
  for (const behavior of ["old-version", "pinned-old-version"]) {
    const { result, runs } = runSetup(behavior);
    const payload = parsePayload(result);

    assert.equal(payload.ready, false, behavior);
    assert.equal(payload.copilot.missing, false, behavior);
    assert.match(payload.copilot.detail, /1\.0\.92 is not supported/);
    assert.ok(payload.nextSteps.includes("Update Copilot with `npm install -g @github/copilot`."));
    assert.deepEqual(runs(), []);
  }
});

test("setup asks to check an installed Copilot whose version cannot be read, not to install it", () => {
  const payload = parsePayload(runSetup("unreadable-version").result);

  assert.equal(payload.ready, false);
  assert.equal(payload.copilot.missing, false);
  assert.match(payload.copilot.detail, /cannot read the Copilot version/);
  assert.ok(payload.nextSteps.includes("Check that `copilot --no-auto-update --version` works, then rerun `/copilot:setup`."));
  assert.ok(!payload.nextSteps.some((step) => step.startsWith("Install Copilot")));
});

test("setup without a login names copilot login and the token variable", () => {
  const payload = parsePayload(runSetup("not-logged-in").result);

  assert.equal(payload.ready, false);
  assert.equal(payload.auth.detail, "not logged in");
  assert.ok(payload.nextSteps.includes("Run `!copilot login`."));
  assert.ok(payload.nextSteps.some((step) => step.includes("`COPILOT_GITHUB_TOKEN`")));
});

test("setup gives no login steps when the check fails for another reason", () => {
  const payload = parsePayload(runSetup("fail").result);

  assert.equal(payload.ready, false);
  assert.match(payload.auth.detail, /model request failed/);
  assert.ok(!payload.nextSteps.some((step) => step.includes("copilot login")));
});

test(
  "setup without a plugin data folder keeps the fallback folder private",
  { skip: process.platform === "win32" && "a Windows profile folder is private already" },
  () => {
    const home = makeTempDir();
    const { result } = runSetup("ok", { env: { CLAUDE_PLUGIN_DATA: "", HOME: home } });

    assert.equal(parsePayload(result).ready, true);
    assert.equal(fs.statSync(path.join(home, ".copilot-companion")).mode & 0o777, 0o700);
  }
);

test(
  "a companion stopped during a stalled version check stops it and starts no other check",
  { skip: process.platform === "win32" && "Windows stops the tree with taskkill /T" },
  async () => {
    for (const [signal, exitCode] of [["SIGTERM", 143], ["SIGINT", 130]]) {
      const binDir = makeTempDir();
      installFakeCopilot(binDir, "hang-version");
      const companion = spawn(process.execPath, [SCRIPT, "setup", "--json"], {
        cwd: makeTempDir(),
        env: buildEnv(binDir, { CLAUDE_PLUGIN_DATA: makeTempDir() }),
        stdio: "ignore"
      });
      const exited = new Promise((resolve) => companion.on("exit", (code) => resolve(code)));
      await waitFor(() => readFakeVersionPids(binDir).length > 0);

      companion.kill(signal);

      assert.equal(await exited, exitCode, signal);
      // Setup runs a second check after the first; a check that starts during the stop would leak.
      const checks = readFakeVersionPids(binDir);
      assert.equal(checks.length, 1, signal);
      await waitFor(() => checks.flat().every((pid) => !isAlive(pid)));
    }
  }
);

test("setup counts a BYOK provider as ready", () => {
  const payload = parsePayload(
    runSetup("not-logged-in", { env: { COPILOT_PROVIDER_BASE_URL: "http://localhost:11434/v1" } }).result
  );

  assert.equal(payload.ready, true);
  assert.equal(payload.auth.source, "byok");
  assert.ok(!payload.nextSteps.some((step) => step.includes("copilot login")));
});

test("a token variable reaches the login check, and setup prints its name but never its value", () => {
  const secret = "github_pat_fake_value_for_tests";
  const { result, runs } = runSetup("ok", { env: { COPILOT_GITHUB_TOKEN: secret } });
  const payload = parsePayload(result);

  assert.equal(payload.auth.detail, "logged in; COPILOT_GITHUB_TOKEN is set");
  assert.equal(runs()[0].env.COPILOT_GITHUB_TOKEN, secret);
  assert.ok(!result.stdout.includes(secret));
});

test("setup turns the review gate on and off", () => {
  const cwd = makeTempDir();
  const binDir = makeTempDir();
  installFakeCopilot(binDir, "ok");
  const env = buildEnv(binDir, { CLAUDE_PLUGIN_DATA: makeTempDir() });
  const setup = (...args) => run(process.execPath, [SCRIPT, "setup", "--json", ...args], { cwd, env });

  const enabled = parsePayload(setup("--enable-review-gate"));
  assert.equal(enabled.reviewGateEnabled, true);
  assert.match(enabled.actionsTaken[0], /^Enabled the stop-time review gate/);
  assert.ok(!enabled.nextSteps.some((step) => step.includes("--enable-review-gate")));

  const disabled = parsePayload(setup("--disable-review-gate"));
  assert.equal(disabled.reviewGateEnabled, false);
  assert.match(disabled.actionsTaken[0], /^Disabled the stop-time review gate/);

  const both = setup("--enable-review-gate", "--disable-review-gate");
  assert.equal(both.status, 1);
  assert.match(both.stderr, /Choose either --enable-review-gate or --disable-review-gate/);
});

test("setup without --json renders the report", () => {
  const { result } = runSetup("ok", { args: [] });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Copilot Setup\n\nStatus: ready\n/);
  assert.match(result.stdout, /- copilot: GitHub Copilot CLI 1\.0\.93/);
});

test("the setup command file runs the companion and offers the Copilot npm package", () => {
  const command = fs.readFileSync(path.join(PLUGIN_ROOT, "commands", "setup.md"), "utf8");

  assert.match(command, /copilot-companion\.mjs" setup --json \$ARGUMENTS/);
  assert.match(command, /Copilot is missing \(`copilot\.missing` is `true`\) and npm is available/);
  assert.match(command, /npm install -g @github\/copilot/);
  assert.match(command, /!copilot login/);
});
