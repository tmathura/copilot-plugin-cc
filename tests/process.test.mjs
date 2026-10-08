// Changed from upstream codex-plugin-cc (Apache-2.0): renamed for the copilot plugin; adds tests for
// no shell, resolveLauncher and the process tree kill.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import {
  binaryAvailable,
  resolveLauncher,
  runCommand,
  runCommandChecked,
  terminateProcessTree
} from "../plugins/copilot/scripts/lib/process.mjs";
import { makeTempDir } from "./helpers.mjs";

const isWindows = process.platform === "win32";
const NPM_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*',
  ""
].join("\r\n");

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

function startNode(source, options = {}) {
  const child = spawn(process.execPath, ["-e", source], {
    detached: options.detached ?? false,
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const firstLine = new Promise((resolve) => {
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.includes("\n")) {
        resolve(buffer.split("\n")[0].trim());
      }
    });
  });
  return { child, exited, firstLine };
}

function makeDir(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function envWithPath(pathValue) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  return { ...env, PATH: pathValue };
}

test("terminateProcessTree uses taskkill on Windows", async () => {
  let captured = null;
  const outcome = await terminateProcessTree(1234, {
    platform: "win32",
    runCommandImpl(command, args) {
      captured = { command, args };
      return {
        command,
        args,
        status: 0,
        signal: null,
        stdout: "",
        stderr: "",
        error: null
      };
    },
    killImpl() {
      throw new Error("kill fallback should not run");
    }
  });

  assert.deepEqual(captured, {
    command: "taskkill",
    args: ["/PID", "1234", "/T", "/F"]
  });
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.method, "taskkill");
});

test("terminateProcessTree treats missing Windows processes as already stopped", async () => {
  const outcome = await terminateProcessTree(1234, {
    platform: "win32",
    runCommandImpl(command, args) {
      return {
        command,
        args,
        status: 128,
        signal: null,
        stdout: "ERROR: The process \"1234\" not found.",
        stderr: "",
        error: null
      };
    }
  });

  assert.equal(outcome.attempted, true);
  assert.equal(outcome.method, "taskkill");
  assert.equal(outcome.result.status, 128);
  assert.match(outcome.result.stdout, /not found/i);
});

test("runCommand passes spaces and shell characters unchanged and ignores a shell option", () => {
  const args = ["a b", "x&y", "p|q", "s;t", "$HOME", "%PATH%", "say \"hi\"", "it's", "c^d"];

  const result = runCommand(
    process.execPath,
    ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args],
    { shell: true }
  );

  assert.equal(result.error, null);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test("runCommand cannot start a Windows .cmd shim, because it never uses a shell", { skip: !isWindows }, () => {
  const result = runCommand("npm", ["--version"]);

  assert.equal(result.error?.code, "ENOENT");
});

test("runCommandChecked reports a non-zero exit with formatCommandFailure text", () => {
  assert.throws(
    () => runCommandChecked(process.execPath, ["-e", "process.stderr.write('boom'); process.exit(3)"]),
    (error) => error.message.includes("exit=3: boom") && error.message.startsWith(process.execPath)
  );
});

test("a command killed by a signal is not reported as a success", { skip: isWindows }, () => {
  const killSelf = ["-e", "process.kill(process.pid, 'SIGTERM'); setInterval(() => {}, 1000)"];

  const result = runCommand(process.execPath, killSelf);

  assert.equal(result.status, null);
  assert.equal(result.signal, "SIGTERM");
  assert.throws(() => runCommandChecked(process.execPath, killSelf), /signal=SIGTERM/);
  assert.deepEqual(binaryAvailable(process.execPath, killSelf), { available: false, detail: "signal SIGTERM" });
});

test("terminateProcessTree never signals for a pid that is not a positive integer", async () => {
  for (const pid of [0, -5, 1.5, Number.NaN, undefined]) {
    const outcome = await terminateProcessTree(pid, {
      platform: "linux",
      killImpl() {
        throw new Error(`signalled for pid ${pid}`);
      }
    });

    assert.deepEqual(outcome, { attempted: false, delivered: false, method: null });
  }
});

test("terminateProcessTree signals the process itself when it leads no group", async () => {
  const calls = [];
  const outcome = await terminateProcessTree(1234, {
    platform: "linux",
    killImpl(target, signal) {
      calls.push([target, signal]);
      if (target === -1234 || signal === 0) {
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      }
    }
  });

  assert.deepEqual(calls, [
    [-1234, "SIGTERM"],
    [1234, "SIGTERM"],
    [1234, 0]
  ]);
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.method, "process");
});

test("terminateProcessTree reports a group it is not allowed to signal", async () => {
  const calls = [];

  await assert.rejects(
    terminateProcessTree(1234, {
      platform: "linux",
      killImpl(target, signal) {
        calls.push([target, signal]);
        throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
      }
    }),
    /operation not permitted/
  );
  assert.deepEqual(calls, [[-1234, "SIGTERM"]]);
});

test("terminateProcessTree reports a process that is already gone", async () => {
  const outcome = await terminateProcessTree(1234, {
    platform: "linux",
    killImpl() {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    }
  });

  assert.equal(outcome.delivered, false);
  assert.equal(outcome.method, "process");
});

test("terminateProcessTree sends SIGKILL when the group outlives the wait", async () => {
  const calls = [];
  await terminateProcessTree(1234, {
    platform: "linux",
    forceKillAfterMs: 50,
    killImpl(target, signal) {
      calls.push([target, signal]);
    }
  });

  assert.deepEqual(calls[0], [-1234, "SIGTERM"]);
  assert.deepEqual(calls.at(-1), [-1234, "SIGKILL"]);
});

test("terminateProcessTree kills a detached child and its grandchild", { skip: isWindows }, async () => {
  const { child, exited, firstLine } = startNode(
    `const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log(grandchild.pid);
setInterval(() => {}, 1000);`,
    { detached: true }
  );
  const grandchildPid = Number(await firstLine);
  const startedAt = Date.now();

  const outcome = await terminateProcessTree(child.pid);

  assert.equal(outcome.method, "process-group");
  assert.equal((await exited).signal, "SIGTERM");
  // The caller's own child is reaped during the wait, so a child that obeys SIGTERM ends it early.
  assert.ok(Date.now() - startedAt < 4000, "waited for the full SIGKILL timeout");
  await waitFor(() => !isAlive(grandchildPid));
});

test("terminateProcessTree stops a child that leads no group", { skip: isWindows }, async () => {
  const { child, exited, firstLine } = startNode("console.log('ready'); setInterval(() => {}, 1000);");
  await firstLine;
  const startedAt = Date.now();

  const outcome = await terminateProcessTree(child.pid);

  assert.equal(outcome.method, "process");
  assert.equal((await exited).signal, "SIGTERM");
  assert.ok(Date.now() - startedAt < 4000, "waited for the full SIGKILL timeout");
});

test("terminateProcessTree sends SIGKILL to a child that ignores SIGTERM", { skip: isWindows }, async () => {
  const { child, exited, firstLine } = startNode(
    "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);",
    { detached: true }
  );
  await firstLine;

  await terminateProcessTree(child.pid, { forceKillAfterMs: 300 });

  assert.equal((await exited).signal, "SIGKILL");
});

test("terminateProcessTree kills a Windows tree, including a detached child whose parent runs", { skip: !isWindows }, async () => {
  const { child, exited, firstLine } = startNode(
    `const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore", windowsHide: true });
console.log(grandchild.pid);
setInterval(() => {}, 1000);`
  );
  const grandchildPid = Number(await firstLine);

  const outcome = await terminateProcessTree(child.pid);

  assert.equal(outcome.method, "taskkill");
  assert.equal(outcome.delivered, true);
  await exited;
  await waitFor(() => !isAlive(grandchildPid));
});

test("resolveLauncher uses the name itself on macOS and Linux", () => {
  assert.deepEqual(resolveLauncher("copilot", { platform: "linux" }), { command: "copilot", args: [], detail: null });
});

test("resolveLauncher finds a Windows .exe on the PATH", () => {
  const root = makeTempDir("copilot plugin launcher ");
  const emptyDir = makeDir(root, "empty dir");
  const exeDir = makeDir(root, "Program Files");
  writeFile(path.join(exeDir, "copilot.exe"));

  for (const name of ["copilot", "copilot.exe"]) {
    const launcher = resolveLauncher(name, {
      platform: "win32",
      env: { PATH: `${emptyDir};"${exeDir}"` }
    });

    assert.deepEqual(launcher, { command: path.join(exeDir, "copilot.exe"), args: [], detail: null });
  }
});

test("resolveLauncher runs an npm global-package shim with node", () => {
  const root = makeTempDir("copilot plugin launcher ");
  const shimDir = makeDir(root, "npm global");
  const loader = path.join(shimDir, "node_modules", "@github", "copilot", "npm-loader.js");
  writeFile(path.join(shimDir, "copilot.cmd"), NPM_SHIM);
  writeFile(loader);

  const launcher = resolveLauncher("copilot", {
    platform: "win32",
    env: { Path: shimDir },
    execPath: "C:\\Program Files\\nodejs\\node.exe"
  });

  assert.deepEqual(launcher, { command: "C:\\Program Files\\nodejs\\node.exe", args: [loader], detail: null });
});

test("resolveLauncher runs npm.cmd from the Node install through npm-cli.js", () => {
  const root = makeTempDir("copilot plugin launcher ");
  const nodeDir = makeDir(root, "node js");
  const npmCli = path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
  writeFile(path.join(nodeDir, "npm.cmd"), ":: Created by npm, please don't edit manually.\r\n");
  writeFile(npmCli);

  const launcher = resolveLauncher("npm", { platform: "win32", env: { PATH: nodeDir }, execPath: "node.exe" });

  assert.deepEqual(launcher, { command: "node.exe", args: [npmCli], detail: null });
});

test("resolveLauncher resolves an explicit .cmd path in its own folder", () => {
  const root = makeTempDir("copilot plugin launcher ");
  const nodeDir = makeDir(root, "node js");
  const npmCli = path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
  const npmCmd = path.join(nodeDir, "npm.cmd");
  writeFile(npmCmd, ":: Created by npm, please don't edit manually.\r\n");
  writeFile(npmCli);
  writeFile(path.join(nodeDir, "npm.exe"));

  const launcher = resolveLauncher(npmCmd, { platform: "win32", env: { PATH: "" }, execPath: "node.exe" });

  assert.deepEqual(launcher, { command: "node.exe", args: [npmCli], detail: null });

  fs.rmSync(npmCmd);
  const missing = resolveLauncher(npmCmd, { platform: "win32", env: { PATH: "" }, execPath: "node.exe" });
  assert.deepEqual(missing, { command: null, args: [], detail: "not found" });
});

test("resolveLauncher refuses an unknown .cmd file and a missing command", () => {
  const root = makeTempDir("copilot plugin launcher ");
  const dir = makeDir(root, "other tools");
  writeFile(path.join(dir, "copilot.cmd"), "@echo off\r\nnode \"%~dp0copilot\" %*\r\n");

  const unknown = resolveLauncher("copilot", { platform: "win32", env: { PATH: dir } });
  const missing = resolveLauncher("gh", { platform: "win32", env: { PATH: dir } });

  assert.equal(unknown.command, null);
  assert.match(unknown.detail, /not an npm shim, and it cannot start without a shell/);
  assert.deepEqual(missing, { command: null, args: [], detail: "not found" });
});

test("binaryAvailable starts a resolved npm shim without a shell", () => {
  const root = makeTempDir("copilot plugin launcher ");
  const shimDir = makeDir(root, "npm & global");
  writeFile(path.join(shimDir, "copilot.cmd"), NPM_SHIM);
  writeFile(
    path.join(shimDir, "node_modules", "@github", "copilot", "npm-loader.js"),
    "console.log('GitHub Copilot CLI ' + process.argv.slice(2).join(' '));\n"
  );

  const result = binaryAvailable("copilot", ["--version", "a&b"], { platform: "win32", env: envWithPath(shimDir) });

  assert.deepEqual(result, { available: true, detail: "GitHub Copilot CLI --version a&b" });
});

test("resolveLauncher keeps a Windows program path as given", () => {
  const programPath = "C:\\Program Files\\nodejs\\node.exe";

  assert.deepEqual(resolveLauncher(programPath, { platform: "win32", env: { PATH: "" } }), {
    command: programPath,
    args: [],
    detail: null
  });
});

test("binaryAvailable accepts the path of the running node", () => {
  const result = binaryAvailable(process.execPath);

  assert.equal(result.available, true, result.detail);
  assert.equal(result.detail, process.version);
});

test("binaryAvailable finds npm with no shell", () => {
  const result = binaryAvailable("npm");

  assert.equal(result.available, true, result.detail);
  assert.match(result.detail, /^\d+\.\d+\.\d+/);
});
