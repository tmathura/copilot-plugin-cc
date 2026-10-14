// Changed from upstream codex-plugin-cc (Apache-2.0): renamed for the copilot plugin; adds tests for
// no shell, resolveLauncher and the process tree kill.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import assert from "node:assert/strict";

import {
  binaryAvailable,
  resolveLauncher,
  runCommand,
  runCommandAsync,
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

test("terminateProcessTree on Windows lets stops started together run at the same time", async () => {
  const started = [];
  const finishers = [];
  const runCommandImpl = (command, args) => {
    started.push(args[1]);
    return new Promise((resolve) => {
      finishers.push(() => resolve({ command, args, status: 0, signal: null, stdout: "", stderr: "", error: null }));
    });
  };
  const killImpl = () => {
    throw new Error("kill fallback should not run");
  };

  const stops = [1234, 5678].map((pid) => terminateProcessTree(pid, { platform: "win32", runCommandImpl, killImpl }));
  assert.deepEqual(started, ["1234", "5678"]);
  for (const finish of finishers) {
    finish();
  }

  const outcomes = await Promise.all(stops);
  assert.deepEqual(outcomes.map((outcome) => [outcome.delivered, outcome.method]), [[true, "taskkill"], [true, "taskkill"]]);
});

test("terminateProcessTree on Windows falls back to kill when taskkill cannot be found", async () => {
  const calls = [];
  const outcome = await terminateProcessTree(1234, {
    platform: "win32",
    cwd: makeTempDir(),
    env: envWithPath(makeTempDir()),
    killImpl(pid, signal) {
      calls.push([pid, signal]);
    }
  });

  assert.deepEqual(calls, [[1234, undefined]]);
  assert.deepEqual(outcome, { attempted: true, delivered: true, method: "kill" });
});

test("terminateProcessTree on Windows rejects with a taskkill start error other than a missing command", async () => {
  const failure = Object.assign(new Error("spawn taskkill EPERM"), { code: "EPERM" });

  await assert.rejects(
    terminateProcessTree(1234, {
      platform: "win32",
      runCommandImpl: async (command, args) => ({ command, args, status: null, signal: null, stdout: "", stderr: "", error: failure }),
      killImpl() {
        throw new Error("kill fallback should not run");
      }
    }),
    failure
  );
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

// PID 1000 is the caller, so it stays alive; 2222 was stopped, and its pid may be reused at once.
const TASKKILL_CHILD_FAILURE = [
  "SUCCESS: The process with PID 2222 (child process of PID 1234) has been terminated.",
  "ERROR: The process with PID 5678 (child process of PID 1234) could not be terminated.",
  "Reason: The operation attempted is not supported.",
  "SUCCESS: The process with PID 1234 (child process of PID 1000) has been terminated."
].join("\r\n");

function failedTaskkill(command, args) {
  return { command, args, status: 128, signal: null, stdout: "", stderr: TASKKILL_CHILD_FAILURE, error: null };
}

test("terminateProcessTree reports success when taskkill names children that exit during the wait", async () => {
  const checks = new Map();
  const outcome = await terminateProcessTree(1234, {
    platform: "win32",
    runCommandImpl: failedTaskkill,
    killImpl(pid, signal) {
      assert.equal(signal, 0);
      checks.set(pid, (checks.get(pid) ?? 0) + 1);
      // The child is still exiting at the first check; the caller and a reused pid stay alive.
      if ((pid === 5678 && checks.get(pid) === 1) || pid === 1000 || pid === 2222) {
        return true;
      }
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    }
  });

  assert.equal(outcome.delivered, true);
  assert.equal(outcome.method, "taskkill");
  assert.deepEqual([...checks.keys()].sort(), [1234, 5678]);
  assert.equal(checks.get(5678), 2);
});

test("terminateProcessTree reports a failed taskkill for a named process that stays alive", async () => {
  await assert.rejects(
    terminateProcessTree(1234, {
      platform: "win32",
      forceKillAfterMs: 100,
      runCommandImpl: failedTaskkill,
      killImpl(pid) {
        if (pid === 5678) {
          return true;
        }
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      }
    }),
    (error) => {
      assert.match(error.message, /^taskkill \/PID 1234 \/T \/F: exit=128: .*could not be terminated/s);
      assert.match(error.message, /Still running: PID 5678\.$/);
      return true;
    }
  );
});

test("terminateProcessTree checks every named process even when taskkill also reports a missing one", async () => {
  const output = [
    'ERROR: The process "1234" not found.',
    "ERROR: The process with PID 5678 (child process of PID 1234) could not be terminated.",
    "Reason: Access is denied."
  ].join("\r\n");
  const aliveOnly = (living) => (pid) => {
    if (living.includes(pid)) {
      return true;
    }
    throw Object.assign(new Error("no such process"), { code: "ESRCH" });
  };
  const run = (command, args) => ({ command, args, status: 128, signal: null, stdout: output, stderr: "", error: null });

  await assert.rejects(
    terminateProcessTree(1234, { platform: "win32", forceKillAfterMs: 100, runCommandImpl: run, killImpl: aliveOnly([5678]) }),
    /Still running: PID 5678\.$/
  );
  await assert.rejects(
    terminateProcessTree(1234, { platform: "win32", forceKillAfterMs: 100, runCommandImpl: failedTaskkill, killImpl: aliveOnly([1234]) }),
    /Still running: PID 1234\.$/
  );
});

test("a failed taskkill marks whether only children whose root has exited are left", async () => {
  const aliveOnly = (living) => (pid) => {
    if (living.includes(pid)) {
      return true;
    }
    throw Object.assign(new Error("no such process"), { code: "ESRCH" });
  };
  const stop = (living) =>
    terminateProcessTree(1234, { platform: "win32", forceKillAfterMs: 100, runCommandImpl: failedTaskkill, killImpl: aliveOnly(living) });

  await assert.rejects(stop([5678]), (error) => {
    assert.equal(error.orphans, true);
    assert.deepEqual(error.stillRunning, [5678]);
    return true;
  });
  await assert.rejects(stop([1234, 5678]), (error) => {
    assert.equal(error.orphans, false);
    assert.deepEqual(error.stillRunning, [1234, 5678]);
    return true;
  });
});

test("terminateProcessTree reports a failed taskkill whose output names no process", async () => {
  const run = (command, args) => ({ command, args, status: 1, signal: null, stdout: "", stderr: "FEHLER: Zugriff verweigert.", error: null });

  await assert.rejects(
    terminateProcessTree(1234, {
      platform: "win32",
      runCommandImpl: run,
      killImpl() {
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      }
    }),
    (error) => {
      assert.equal(error.message, "taskkill /PID 1234 /T /F: exit=1: FEHLER: Zugriff verweigert.");
      return true;
    }
  );
});

test("terminateProcessTree on Windows gives taskkill the time to its deadline, or 5 s without one", async () => {
  const limits = [];
  const runCommandImpl = (command, args, options) => {
    limits.push(options.timeoutMs);
    return { command, args, status: 0, signal: null, stdout: "", stderr: "", error: null };
  };

  await terminateProcessTree(1234, { platform: "win32", deadline: Date.now() + 1000, forceKillAfterMs: 10, runCommandImpl });
  await terminateProcessTree(1234, { platform: "win32", forceKillAfterMs: 10, runCommandImpl });
  await terminateProcessTree(1234, { platform: "win32", deadline: Number.NaN, runCommandImpl });

  assert.ok(limits[0] > 0 && limits[0] <= 1000, `${limits[0]} ms`);
  assert.deepEqual(limits.slice(1), [5000, 5000]);
});

test("terminateProcessTree on Windows rejects when taskkill runs out of time, unless the root has exited", async () => {
  const timedOut = Object.assign(new Error("taskkill /PID 1234 /T /F did not end within 1000 ms."), { code: "ETIMEDOUT" });
  const stop = (killImpl) =>
    terminateProcessTree(1234, {
      platform: "win32",
      deadline: Date.now() + 1000,
      runCommandImpl: async (command, args) => ({ command, args, status: null, signal: null, stdout: "", stderr: "", error: timedOut }),
      killImpl
    });

  await assert.rejects(
    stop((pid, signal) => {
      assert.deepEqual([pid, signal], [1234, 0]);
      return true;
    }),
    timedOut
  );
  // The pid may be reused, so a retry must not get it.
  const outcome = await stop(() => {
    throw Object.assign(new Error("no such process"), { code: "ESRCH" });
  });
  assert.deepEqual([outcome.delivered, outcome.method, outcome.result.error], [true, "taskkill", timedOut]);
});

test("a timed-out taskkill whose root has exited still names a child it reported that stays alive", async () => {
  const timedOut = Object.assign(new Error("taskkill /PID 1234 /T /F did not end within 1000 ms."), { code: "ETIMEDOUT" });
  const stop = (living) =>
    terminateProcessTree(1234, {
      platform: "win32",
      deadline: Date.now() + 1000,
      runCommandImpl: async (command, args) => ({
        command,
        args,
        status: null,
        signal: null,
        stdout: "",
        stderr: TASKKILL_CHILD_FAILURE,
        error: timedOut
      }),
      killImpl(pid) {
        if (living.includes(pid)) {
          return true;
        }
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      }
    });

  await assert.rejects(stop([5678]), (error) => {
    assert.equal(error.orphans, true);
    assert.deepEqual(error.stillRunning, [5678]);
    assert.match(error.message, /did not end within 1000 ms\.\nStill running: PID 5678\.$/);
    return true;
  });
  const outcome = await stop([]);
  assert.equal(outcome.delivered, true);
});

test("terminateProcessTree on Windows starts no taskkill when its deadline has passed", async () => {
  for (const deadline of [Date.now(), Date.now() - 1000]) {
    await assert.rejects(
      terminateProcessTree(1234, {
        platform: "win32",
        deadline,
        runCommandImpl() {
          throw new Error("taskkill should not start");
        },
        killImpl() {
          throw new Error("kill fallback should not run");
        }
      }),
      (error) => {
        assert.equal(error.code, "ETIMEDOUT");
        assert.equal(error.message, "taskkill /PID 1234 /T /F was not started: no time was left.");
        assert.equal(error.orphans, undefined);
        return true;
      }
    );
  }
});

test("terminateProcessTree on Windows ends the wait after a slow taskkill at its deadline", async () => {
  const started = Date.now();
  await assert.rejects(
    terminateProcessTree(1234, {
      platform: "win32",
      deadline: started + 1800,
      forceKillAfterMs: 5000,
      runCommandImpl: async (command, args) => {
        await delay(1500);
        return failedTaskkill(command, args);
      },
      killImpl(pid) {
        if (pid === 5678) {
          return true;
        }
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      }
    }),
    /Still running: PID 5678\.$/
  );
  const elapsed = Date.now() - started;

  // A wait that started after taskkill would end at 3300 ms; one with no deadline at 6500 ms.
  assert.ok(elapsed < 3000, `${elapsed} ms`);
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

test("runCommandAsync gives the exit status and the output of a command that fails", async () => {
  const result = await runCommandAsync(process.execPath, [
    "-e",
    "process.stdout.write('out é'); process.stderr.write('err é'); process.exit(3)"
  ]);

  assert.deepEqual(result, {
    command: process.execPath,
    args: ["-e", "process.stdout.write('out é'); process.stderr.write('err é'); process.exit(3)"],
    status: 3,
    signal: null,
    stdout: "out é",
    stderr: "err é",
    error: null
  });
});

test("runCommandAsync reports a command killed by a signal with no exit status", { skip: isWindows }, async () => {
  const result = await runCommandAsync(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM'); setInterval(() => {}, 1000)"]);

  assert.equal(result.status, null);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.error, null);
});

test("runCommandAsync reports a missing command as ENOENT with no exit status", async () => {
  const result = await runCommandAsync("copilot-plugin-missing-command", []);

  assert.equal(result.status, null);
  assert.equal(result.error?.code, "ENOENT");
});

test("runCommandAsync rejects an argument that no command can receive, as runCommand throws", async () => {
  await assert.rejects(runCommandAsync(process.execPath, ["-e", "\0"]), { code: "ERR_INVALID_ARG_VALUE" });
});

test("runCommandAsync does not block the event loop while the command runs", async () => {
  let ticked = false;
  setImmediate(() => {
    ticked = true;
  });

  const result = await runCommandAsync(process.execPath, ["-e", ""]);

  assert.equal(result.status, 0);
  assert.equal(ticked, true);
});

test("runCommandAsync stops a command that runs past its time limit", async () => {
  const forever = ["-e", "console.log(process.pid); setInterval(() => {}, 1000)"];
  const started = Date.now();
  // Long enough for a slow runner to start node, which prints the pid.
  const result = await runCommandAsync(process.execPath, forever, { timeoutMs: 3000 });
  const elapsed = Date.now() - started;
  const pid = Number(result.stdout.trim());
  try {
    assert.equal(result.status, null);
    assert.equal(result.error?.code, "ETIMEDOUT");
    assert.match(result.error.message, /did not end within 3000 ms\.$/);
    // Timers can fire a little early.
    assert.ok(elapsed >= 2950 && elapsed < 8000, `${elapsed} ms`);
    assert.ok(pid > 0, result.stdout);
    await waitFor(() => !isAlive(pid));
  } finally {
    if (pid > 0 && isAlive(pid)) {
      process.kill(pid, "SIGKILL");
    }
  }

  // Node takes longer than 0 ms to start, and this command ends by itself if the kill misses it.
  const none = await runCommandAsync(process.execPath, ["-e", ""], { timeoutMs: 0 });
  assert.equal(none.error?.code, "ETIMEDOUT");
});

test("runCommandAsync leaves nothing that keeps its caller alive after it settles", () => {
  const moduleUrl = new URL("../plugins/copilot/scripts/lib/process.mjs", import.meta.url).href;
  const source = `
import { runCommandAsync } from ${JSON.stringify(moduleUrl)};
const results = [
  await runCommandAsync(process.execPath, ["-e", ""], { timeoutMs: 60000 }),
  await runCommandAsync("copilot-plugin-missing-command", [], { timeoutMs: 60000 }),
  await runCommandAsync(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 200 })
];
console.log(JSON.stringify(results.map((result) => result.error?.code ?? result.status)));
`;
  const started = Date.now();
  // A timer or a pipe left behind would keep the caller running for the full 60 s.
  const caller = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: 30000 });
  const elapsed = Date.now() - started;

  assert.equal(caller.status, 0, caller.stderr);
  assert.deepEqual(JSON.parse(caller.stdout), [0, "ENOENT", "ETIMEDOUT"]);
  assert.ok(elapsed < 15000, `${elapsed} ms`);
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
  // Only macOS gives EPERM for exited members, so elsewhere the leader is not tried.
  assert.deepEqual(calls, [[-1234, "SIGTERM"]]);
});

test("terminateProcessTree accepts the macOS EPERM for a group whose members have exited", async () => {
  const eperm = () => Object.assign(new Error("operation not permitted"), { code: "EPERM" });
  const esrch = () => Object.assign(new Error("no such process"), { code: "ESRCH" });

  // The leader has exited too: nothing is left to stop.
  const gone = await terminateProcessTree(1234, {
    platform: "darwin",
    killImpl(target) {
      throw target < 0 ? eperm() : esrch();
    }
  });
  assert.equal(gone.delivered, false);

  // The leader still runs, takes the signal and then exits; the group keeps answering EPERM.
  let leaderAlive = true;
  const calls = [];
  const stopped = await terminateProcessTree(1234, {
    platform: "darwin",
    forceKillAfterMs: 1000,
    killImpl(target, signal) {
      calls.push([target, signal]);
      if (target < 0) {
        throw eperm();
      }
      if (!leaderAlive) {
        throw esrch();
      }
      if (signal === "SIGTERM") {
        leaderAlive = false;
      }
    }
  });
  assert.equal(stopped.delivered, true);
  assert.ok(!calls.some(([, signal]) => signal === "SIGKILL"), JSON.stringify(calls));
});

test("terminateProcessTree sends SIGKILL to a leader that outlives SIGTERM when its group answers EPERM", async () => {
  const eperm = () => Object.assign(new Error("operation not permitted"), { code: "EPERM" });
  const run = (leaderKill) => {
    const calls = [];
    const outcome = terminateProcessTree(1234, {
      platform: "darwin",
      forceKillAfterMs: 50,
      killImpl(target, signal) {
        calls.push([target, signal]);
        if (target < 0) {
          throw eperm();
        }
        if (signal === "SIGKILL") {
          leaderKill();
        }
      }
    });
    return { calls, outcome };
  };

  const killed = run(() => {});
  await killed.outcome;
  assert.deepEqual(killed.calls.at(-1), [1234, "SIGKILL"]);

  const refused = run(() => {
    throw eperm();
  });
  await assert.rejects(refused.outcome, /operation not permitted/);
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

test("terminateProcessTree on macOS and Linux sends SIGKILL at its deadline", async () => {
  // With no deadline, the wait would last the default 5 s.
  for (const [offset, limit] of [
    [300, 3000],
    [-1000, 1000]
  ]) {
    const calls = [];
    const started = Date.now();
    await terminateProcessTree(1234, {
      platform: "linux",
      deadline: started + offset,
      killImpl(target, signal) {
        calls.push([target, signal]);
      }
    });
    const elapsed = Date.now() - started;

    assert.deepEqual(calls[0], [-1234, "SIGTERM"]);
    assert.deepEqual(calls.at(-1), [-1234, "SIGKILL"]);
    assert.ok(elapsed < limit, `${elapsed} ms`);
  }
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
