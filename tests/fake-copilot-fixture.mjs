// Changed from upstream codex-plugin-cc (Apache-2.0): fakes the copilot CLI instead of the codex
// app server.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { writeExecutable } from "./helpers.mjs";

export function installFakeCopilot(binDir, behavior = "ok") {
  const scriptPath = path.join(binDir, "copilot");
  const source = `#!/usr/bin/env node
const BEHAVIOR = process.env.FAKE_COPILOT_BEHAVIOR || ${JSON.stringify(behavior)};

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("GitHub Copilot CLI " + (BEHAVIOR === "old-version" ? "1.0.92" : "1.0.93") + ".");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log("Usage: copilot [options] [command]");
  process.exit(0);
}
console.error("fake copilot: unsupported arguments: " + args.join(" "));
process.exit(1);
`;
  writeExecutable(scriptPath, source);

  // On Windows, npm global binaries are invoked via .cmd wrappers.
  if (process.platform === "win32") {
    const cmdWrapper = `@echo off\r\nnode "%~dp0copilot" %*\r\n`;
    fs.writeFileSync(path.join(binDir, "copilot.cmd"), cmdWrapper, { encoding: "utf8" });
  }
}

export function buildEnv(binDir) {
  const sep = process.platform === "win32" ? ";" : ":";
  return {
    ...process.env,
    PATH: `${binDir}${sep}${process.env.PATH}`
  };
}
