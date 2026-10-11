// Changed from upstream codex-plugin-cc (Apache-2.0): temp folder prefix renamed for the copilot plugin;
// readStdinIfPiped checks for a terminal without opening process.stdin.
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

// Opening process.stdin makes a pipe non-blocking on macOS and Linux, and a read of a large prompt
// then fails with EAGAIN.
export function readStdinIfPiped() {
  if (tty.isatty(0)) {
    return "";
  }
  return fs.readFileSync(0, "utf8");
}
