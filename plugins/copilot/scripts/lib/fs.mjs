// Changed from upstream codex-plugin-cc (Apache-2.0): temp folder prefix renamed for the copilot plugin;
// readStdinIfPiped checks for a terminal without opening process.stdin, and stdin reads retry EAGAIN.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tty from "node:tty";

export function ensureAbsolutePath(cwd, maybePath) {
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(cwd, maybePath);
}

export function createTempDir(prefix = "copilot-plugin-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function safeReadFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

export function isProbablyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const value of sample) {
    if (value === 0) {
      return false;
    }
  }
  return true;
}

// A pipe from a Node parent can be non-blocking, also on macOS when process.stdin was never opened, so
// a read before the parent has written everything fails with EAGAIN. Such a read waits and retries.
export function readStdinSync() {
  const chunks = [];
  const buffer = Buffer.alloc(64 * 1024);
  for (;;) {
    let bytes;
    try {
      bytes = fs.readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error?.code === "EAGAIN") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        continue;
      }
      // Windows reports the end of a pipe as an error.
      if (error?.code === "EOF") {
        break;
      }
      throw error;
    }
    if (bytes === 0) {
      break;
    }
    chunks.push(Buffer.from(buffer.subarray(0, bytes)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Opening process.stdin would make the pipe non-blocking too.
export function readStdinIfPiped() {
  if (tty.isatty(0)) {
    return "";
  }
  return readStdinSync();
}
