// Changed from upstream codex-plugin-cc (Apache-2.0): fakes the copilot CLI in prompt mode instead of
// the codex app server.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { writeExecutable } from "./helpers.mjs";

// Copied from Copilot CLI 1.0.93 with no login available (stderr, exit 1, nothing on stdout).
export const NOT_LOGGED_IN_STDERR = [
  "Error: No authentication information found.",
  "",
  "Copilot can be authenticated with GitHub using an OAuth Token or a Fine-Grained Personal Access Token.",
  "",
  "To authenticate, you can use any of the following methods:",
  "  • Start 'copilot' and run the '/login' command",
  "  • Set the COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN environment variable",
  "  • Run 'gh auth login' to authenticate with the GitHub CLI",
  ""
].join("\n");

// Behaviours:
//   ok                  a turn with one view tool call, an answer and a result, plus a JSON
//                       line that is not an event
//   old-version         --version reports 1.0.92
//   pinned-old-version  1.0.99 without --no-auto-update, 1.0.92 with it
//   unreadable-version  --version prints no version number
//   hang-version        --version starts a child with the same pipes, and neither answers
//   not-logged-in       the real "no authentication" output
//   bad-json            a line that is not JSON, then exits
//   truncated           exits 1 before the result event
//   fail                a result with exitCode 1, then exits 1
//   forbidden-tool      sends FAKE_COPILOT_ANSWER if set, starts the create tool, then runs until killed
//   hang                starts a child, then runs until killed
//   hang-after-result   a full successful turn, then runs until killed
//   write-attempt       writes a file in its working folder if the create tool is available
//   reject-flags        rejects its arguments and exits 1 before it reads the prompt
// Every run records its arguments, environment, prompt, pid and the files of each --add-dir folder
// (base64, so the bytes stay exact).
// FAKE_COPILOT_ANSWER replaces the final answer text.
export function installFakeCopilot(binDir, behavior = "ok") {
  const scriptPath = path.join(binDir, "copilot");
  const recordPath = path.join(binDir, "fake-copilot-runs.jsonl");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const BEHAVIOR = process.env.FAKE_COPILOT_BEHAVIOR || ${JSON.stringify(behavior)};
const RECORD_PATH = ${JSON.stringify(recordPath)};
const PIDS_PATH = ${JSON.stringify(path.join(binDir, "fake-copilot-pids.jsonl"))};
const NOT_LOGGED_IN_STDERR = ${JSON.stringify(NOT_LOGGED_IN_STDERR)};

const args = process.argv.slice(2);
if (args.includes("--version") && BEHAVIOR === "hang-version") {
  // Like the npm loader: a native child that inherits the pipes, and both stall.
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
  fs.appendFileSync(PIDS_PATH, JSON.stringify([process.pid, child.pid]) + "\\n");
  setInterval(() => {}, 1000);
  return;
}
if (args.includes("--version") && BEHAVIOR === "unreadable-version") {
  console.log("GitHub Copilot CLI dev build");
  process.exit(0);
}
if (args.includes("--version")) {
  let version = BEHAVIOR === "old-version" ? "1.0.92" : "1.0.93";
  if (BEHAVIOR === "pinned-old-version") {
    version = args.includes("--no-auto-update") ? "1.0.92" : "1.0.99";
  }
  console.log("GitHub Copilot CLI " + version + ".");
  console.log("Run 'copilot update' to check for updates.");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log("Usage: copilot [OPTIONS] [COMMAND]");
  process.exit(0);
}
if (!args.includes("--output-format") || args[args.indexOf("--output-format") + 1] !== "json") {
  console.error("fake copilot: unsupported arguments: " + args.join(" "));
  process.exit(1);
}

if (BEHAVIOR === "reject-flags") {
  console.error("error: unknown option '" + args.find((arg) => arg.startsWith("--available-tools")) + "'");
  process.exit(1);
}

function readAddDirFiles() {
  const files = {};
  for (const arg of args.filter((value) => value.startsWith("--add-dir="))) {
    const dir = arg.slice("--add-dir=".length);
    for (const name of fs.readdirSync(dir)) {
      files[name] = fs.readFileSync(dir + "/" + name).toString("base64");
    }
  }
  return files;
}

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\\n");
}

function runForever() {
  setInterval(() => {}, 1000);
}

function sessionId() {
  const flag = args.find((arg) => arg.startsWith("--session-id=") || arg.startsWith("--resume="));
  return flag ? flag.slice(flag.indexOf("=") + 1) : "fake-session";
}

function emitTurn() {
  emit({ type: "session.tools_updated", data: { model: "fake-model" }, ephemeral: true });
  process.stdout.write("null\\n");
  emit({ type: "assistant.turn_start", data: { turnId: "0" } });
  emit({ type: "assistant.reasoning", data: { content: "Looked at the request." } });
  emit({ type: "assistant.message", data: { content: "", toolRequests: [{ toolCallId: "call-1", name: "view" }] } });
  emit({ type: "tool.execution_start", data: { toolCallId: "call-1", toolName: "view", arguments: { path: "a.txt" } } });
  emit({ type: "tool.execution_complete", data: { toolCallId: "call-1", success: true } });
  emit({ type: "assistant.turn_start", data: { turnId: "1" } });
  emit({ type: "assistant.message", data: { content: process.env.FAKE_COPILOT_ANSWER ?? "Fake Copilot answer." } });
}

function emitResult(exitCode) {
  emit({
    type: "result",
    sessionId: sessionId(),
    exitCode,
    usage: { premiumRequests: 1, codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: [] } }
  });
}

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  prompt += chunk;
});
process.stdin.on("end", () => {
  const record = { args, cwd: process.cwd(), env: process.env, prompt, pid: process.pid, addDirFiles: readAddDirFiles() };
  fs.appendFileSync(RECORD_PATH, JSON.stringify(record) + "\\n");

  switch (BEHAVIOR) {
    case "not-logged-in":
      process.stderr.write(NOT_LOGGED_IN_STDERR);
      process.exit(1);
      break;
    case "bad-json":
      emit({ type: "assistant.turn_start", data: { turnId: "0" } });
      process.stdout.write("this is not json\\n");
      process.exit(0);
      break;
    case "truncated":
      emit({ type: "assistant.turn_start", data: { turnId: "0" } });
      process.stderr.write("fake copilot: connection lost\\n");
      process.exit(1);
      break;
    case "fail":
      emit({ type: "assistant.turn_start", data: { turnId: "0" } });
      process.stderr.write("\\nfake copilot: model request failed\\n\\n");
      emitResult(1);
      process.exit(1);
      break;
    case "forbidden-tool":
      emit({ type: "assistant.turn_start", data: { turnId: "0" } });
      if (process.env.FAKE_COPILOT_ANSWER) {
        emit({ type: "assistant.message", data: { content: process.env.FAKE_COPILOT_ANSWER } });
      }
      emit({ type: "tool.execution_start", data: { toolCallId: "call-1", toolName: "create", arguments: { path: "x.txt" } } });
      runForever();
      break;
    case "hang": {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      emit({ type: "fake.child", data: { pid: child.pid } });
      emit({ type: "assistant.turn_start", data: { turnId: "0" } });
      runForever();
      break;
    }
    case "write-attempt": {
      const tools = (args.find((arg) => arg.startsWith("--available-tools=")) || "").split("=")[1] || "";
      if (tools.split(",").includes("create")) {
        fs.writeFileSync("fake-write.txt", "written by the fake copilot\\n");
      }
      emitTurn();
      emitResult(0);
      process.exit(0);
      break;
    }
    case "hang-after-result":
      emitTurn();
      emitResult(0);
      runForever();
      break;
    default:
      emitTurn();
      emitResult(0);
      process.exit(0);
  }
});
`;
  writeExecutable(scriptPath, source);

  // On Windows, npm installs a .cmd shim, which resolveLauncher reads to find the script.
  if (process.platform === "win32") {
    const cmdShim = `@ECHO off\r\nSET dp0=%~dp0\r\nnode "%dp0%\\copilot" %*\r\n`;
    fs.writeFileSync(path.join(binDir, "copilot.cmd"), cmdShim, { encoding: "utf8" });
  }

  return { scriptPath, recordPath };
}

// One [probe pid, child pid] pair for each hang-version check that started.
export function readFakeVersionPids(binDir) {
  const pidsPath = path.join(binDir, "fake-copilot-pids.jsonl");
  if (!fs.existsSync(pidsPath)) {
    return [];
  }
  return fs
    .readFileSync(pidsPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function readFakeCopilotRuns(recordPath) {
  if (!fs.existsSync(recordPath)) {
    return [];
  }
  return fs
    .readFileSync(recordPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Tests must not depend on a login or a provider set on the machine that runs them.
const MACHINE_AUTH_VARS = [
  "COPILOT_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "COPILOT_PROVIDER_BASE_URL",
  "COPILOT_PROVIDER_TYPE",
  "COPILOT_HOME",
  "CLAUDE_PLUGIN_DATA",
  "FAKE_COPILOT_BEHAVIOR",
  "FAKE_COPILOT_ANSWER"
];

// Windows keeps the search path as "Path"; a second "PATH" key would leave the child with either one.
export function buildEnv(binDir, extra = {}) {
  const sep = process.platform === "win32" ? ";" : ":";
  const dropped = [...MACHINE_AUTH_VARS, "PATH"];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !dropped.includes(key.toUpperCase())));
  return {
    ...env,
    PATH: `${binDir}${sep}${process.env.PATH}`,
    ...extra
  };
}
