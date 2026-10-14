// Changed from upstream codex-plugin-cc (Apache-2.0): never starts a shell; adds resolveLauncher for
// Windows npm shims; terminateProcessTree returns a promise, signals a process that leads no group,
// sends SIGKILL to what is still alive after a wait, and accepts the macOS EPERM for a group whose
// members have exited; a failed taskkill counts only for processes still alive after a wait, and
// its error marks children whose root has exited; taskkill runs through runCommandAsync, so stops
// started together run at the same time; taskkill has a time limit, and a deadline option bounds the
// whole stop.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_FORCE_KILL_AFTER_MS = 5000;
// Not forceKillAfterMs: a caller that asks for a short wait must not stop a healthy taskkill.
const TASKKILL_TIMEOUT_MS = 5000;
const EXIT_POLL_MS = 50;

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer,
    stdio: options.stdio ?? "pipe",
    // A shell would read repository-derived arguments as commands.
    shell: false,
    windowsHide: true
  });

  return {
    command,
    args,
    // A child killed by a signal has no exit status; 0 would report it as a success.
    status: result.status,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

// Like runCommand, but the wait does not block the event loop, so several commands can run at once.
// Its one caller, taskkill, reads no input, so it has no input, maxBuffer or stdio option.
export function runCommandAsync(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      // A shell would read repository-derived arguments as commands.
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let timer = null;
    const finish = (status, signal, error) => {
      clearTimeout(timer);
      resolve({ command, args, status, signal, stdout, stderr, error });
    };
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        const error = Object.assign(new Error(`${command} ${args.join(" ")} did not end within ${options.timeoutMs} ms.`), {
          code: "ETIMEDOUT"
        });
        // Settled first: kill can throw, or emit error from inside the call.
        finish(null, null, error);
        try {
          child.kill();
        } catch {
          // The result is already given.
        } finally {
          // A stopped command's pipes must not keep the caller, such as the SessionEnd hook, alive.
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
        }
      }, options.timeoutMs);
    }
    // A spawn failure emits error before close, and close may not follow, so the first one settles.
    child.on("error", (error) => finish(null, null, error));
    child.on("close", (status, signal) => finish(status, signal, null));
    // With no file handles left (EMFILE), Node makes no pipes and reports the error on the next tick.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
  });
}

export function runCommandChecked(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
}

function readNpmShimScript(shimPath) {
  let source;
  try {
    source = fs.readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }
  const match = source.match(/"%dp0%\\([^"]+)"\s*%\*/);
  return match ? path.join(path.dirname(shimPath), ...match[1].split("\\")) : null;
}

function resolveCmdShim(cmdPath, nodePath) {
  if (!fs.existsSync(cmdPath)) {
    return { command: null, args: [], detail: "not found" };
  }
  const npmCli = path.join(path.dirname(cmdPath), "node_modules", "npm", "bin", "npm-cli.js");
  const isNpm = path.basename(cmdPath).toLowerCase() === "npm.cmd";
  const script = isNpm && fs.existsSync(npmCli) ? npmCli : readNpmShimScript(cmdPath);
  if (script && fs.existsSync(script)) {
    return { command: nodePath, args: [script], detail: null };
  }
  return {
    command: null,
    args: [],
    detail: `not found: ${cmdPath} is not an npm shim, and it cannot start without a shell`
  };
}

// Node cannot start a .cmd file without a shell, so npm shims run their script with node directly.
export function resolveLauncher(name, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return { command: name, args: [], detail: null };
  }

  const nodePath = options.execPath ?? process.execPath;
  // A path names one program, so only a bare name is looked up on the PATH.
  if (/[\\/]/.test(name)) {
    return /\.(cmd|bat)$/i.test(name) ? resolveCmdShim(name, nodePath) : { command: name, args: [], detail: null };
  }

  const baseName = name.replace(/\.(exe|cmd)$/i, "");
  const env = options.env ?? process.env;
  const pathValue = env.PATH ?? env.Path ?? "";
  for (const rawDir of pathValue.split(";")) {
    const dir = rawDir.trim().replace(/^"(.*)"$/, "$1");
    if (!dir) {
      continue;
    }

    const exePath = path.join(dir, `${baseName}.exe`);
    if (fs.existsSync(exePath)) {
      return { command: exePath, args: [], detail: null };
    }

    const cmdPath = path.join(dir, `${baseName}.cmd`);
    if (fs.existsSync(cmdPath)) {
      return resolveCmdShim(cmdPath, nodePath);
    }
  }

  return { command: null, args: [], detail: "not found" };
}

export function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const launcher = resolveLauncher(command, options);
  if (!launcher.command) {
    return { available: false, detail: launcher.detail };
  }
  const result = runCommand(launcher.command, [...launcher.args, ...versionArgs], options);
  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail =
      result.stderr.trim() || result.stdout.trim() || (result.signal ? `signal ${result.signal}` : `exit ${result.status}`);
    return { available: false, detail };
  }
  return { available: true, detail: result.stdout.trim() || result.stderr.trim() || "ok" };
}

function looksLikeMissingProcessMessage(text) {
  return /not found|no running instance|cannot find|does not exist|no such process/i.test(text);
}

// macOS answers EPERM for a group that holds an exited process not yet reaped, though the others
// still get the signal; there the leader shows whether the refusal is real. Elsewhere EPERM is real.
function isMacGroupRefusal(error, target, darwin) {
  return darwin && target < 0 && error?.code === "EPERM";
}

function isAlive(target, killImpl, darwin = false) {
  try {
    killImpl(target, 0);
    return true;
  } catch (error) {
    if (isMacGroupRefusal(error, target, darwin)) {
      return isAlive(-target, killImpl);
    }
    return error?.code !== "ESRCH";
  }
}

function killLeaderOrThrow(pid, killImpl) {
  try {
    killImpl(pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

// The processes that taskkill could not stop. Each line names its process first; a later PID is its
// parent, which can be the caller itself.
function namedByTaskkill(result) {
  return `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .filter((line) => !/^SUCCESS/i.test(line.trim()))
    .map((line) => /\bPID\s+(\d+)/i.exec(line)?.[1])
    .filter(Boolean)
    .map(Number);
}

function hasDeadline(options) {
  return Number.isFinite(options.deadline);
}

// A deadline ends the whole stop; forceKillAfterMs counts from the signal or the taskkill.
function stopDeadline(options) {
  return hasDeadline(options) ? options.deadline : Date.now() + (options.forceKillAfterMs ?? DEFAULT_FORCE_KILL_AFTER_MS);
}

// A process that ignores SIGTERM would otherwise outlive cancel. The wait must not block the event
// loop: Node reaps the caller's own exited child only from the loop, and until then it looks alive.
async function forceKillAfterWait(target, options, killImpl) {
  const deadline = stopDeadline(options);
  const darwin = (options.platform ?? process.platform) === "darwin";
  while (isAlive(target, killImpl, darwin)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      try {
        killImpl(target, "SIGKILL");
      } catch (error) {
        if (isMacGroupRefusal(error, target, darwin)) {
          killLeaderOrThrow(-target, killImpl);
        } else if (error?.code !== "ESRCH") {
          throw error;
        }
      }
      return;
    }
    await delay(Math.min(EXIT_POLL_MS, remaining));
  }
}

export async function terminateProcessTree(pid, options = {}) {
  // kill(0) signals the caller's own group, and a negative pid flips the group target.
  if (!Number.isInteger(pid) || pid <= 0) {
    return { attempted: false, delivered: false, method: null };
  }

  const platform = options.platform ?? process.platform;
  const runCommandImpl = options.runCommandImpl ?? runCommandAsync;
  const killImpl = options.killImpl ?? process.kill.bind(process);

  if (platform === "win32") {
    // A caller with a deadline (the SessionEnd hook) must end by then, taskkill included.
    let timeoutMs = TASKKILL_TIMEOUT_MS;
    if (hasDeadline(options)) {
      timeoutMs = options.deadline - Date.now();
      if (timeoutMs <= 0) {
        // An exited pid may be reused, so the caller must clear it, not keep it for a retry.
        if (!isAlive(pid, killImpl)) {
          return { attempted: false, delivered: false, method: null };
        }
        throw Object.assign(new Error(`taskkill /PID ${pid} /T /F was not started: no time was left.`), {
          code: "ETIMEDOUT"
        });
      }
    }
    // One taskkill /T takes about a second; a blocking call would make stops started together run
    // one after another.
    const result = await runCommandImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: options.cwd,
      env: options.env,
      timeoutMs
    });

    if (!result.error && result.status === 0) {
      return { attempted: true, delivered: true, method: "taskkill", result };
    }

    if (result.error?.code === "ENOENT") {
      try {
        killImpl(pid);
        return { attempted: true, delivered: true, method: "kill" };
      } catch (error) {
        if (error?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "kill" };
        }
        throw error;
      }
    }

    // A root that has exited is stopped, and its pid may be reused, so a retry must not get it. Only
    // the children that taskkill named before it ran out of time can be checked, and with no wait.
    if (result.error?.code === "ETIMEDOUT" && !isAlive(pid, killImpl)) {
      // A line cut off by the stop could hold a short, wrong PID.
      const wholeLines = (text) => text.slice(0, text.lastIndexOf("\n") + 1);
      const stillRunning = namedByTaskkill({ stdout: wholeLines(result.stdout), stderr: wholeLines(result.stderr) }).filter(
        (candidate) => isAlive(candidate, killImpl)
      );
      if (stillRunning.length === 0) {
        return { attempted: true, delivered: true, method: "taskkill", result };
      }
      throw Object.assign(
        new Error(`${result.error.message}\nStill running: ${stillRunning.map((candidate) => `PID ${candidate}`).join(", ")}.`),
        { stillRunning, orphans: true }
      );
    }

    if (result.error) {
      throw result.error;
    }

    // taskkill /T also fails on short-lived children, such as gh.exe at Copilot's start, that exit
    // while it walks the tree. Only a process that is still alive after the wait is a failure.
    const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
    const named = namedByTaskkill(result);
    // Output that names no process cannot show that the tree stopped, unless the root was already gone.
    if (named.length === 0) {
      if (looksLikeMissingProcessMessage(combinedOutput)) {
        return { attempted: true, delivered: false, method: "taskkill", result };
      }
      throw new Error(formatCommandFailure(result));
    }
    let alive = [...new Set([pid, ...named])];
    const deadline = stopDeadline(options);
    for (;;) {
      alive = alive.filter((candidate) => isAlive(candidate, killImpl));
      if (alive.length === 0) {
        return { attempted: true, delivered: true, method: "taskkill", result };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      await delay(Math.min(EXIT_POLL_MS, remaining));
    }
    // A new taskkill on a root that has exited cannot reach its children, so the caller must not
    // offer a retry for them.
    throw Object.assign(
      new Error(`${formatCommandFailure(result)}\nStill running: ${alive.map((candidate) => `PID ${candidate}`).join(", ")}.`),
      { stillRunning: alive, orphans: !alive.includes(pid) }
    );
  }

  let target = -pid;
  let method = "process-group";
  try {
    killImpl(-pid, "SIGTERM");
  } catch (error) {
    // A process that Claude's Bash tool started leads no group (ESRCH), but it must still stop. Any
    // other error, apart from the macOS group refusal, means the group could not be signalled, and the
    // caller must know.
    if (error?.code !== "ESRCH" && !isMacGroupRefusal(error, -pid, platform === "darwin")) {
      throw error;
    }
    if (error.code === "ESRCH") {
      target = pid;
      method = "process";
    }
    try {
      killImpl(pid, "SIGTERM");
    } catch (innerError) {
      if (innerError?.code === "ESRCH") {
        return { attempted: true, delivered: false, method };
      }
      throw innerError;
    }
  }
  await forceKillAfterWait(target, options, killImpl);
  return { attempted: true, delivered: true, method };
}

export function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  } else {
    parts.push(`exit=${result.status}`);
  }
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}
