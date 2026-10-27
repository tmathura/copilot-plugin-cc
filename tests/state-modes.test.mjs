// The state folders and job files are owner-only on macOS and Linux (#126).
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { appendLogBlock, appendLogLine, createJobLogFile } from "../plugins/copilot/scripts/lib/tracked-jobs.mjs";
import {
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  resolveStateFile,
  updateState,
  writeJobFile
} from "../plugins/copilot/scripts/lib/state.mjs";

const skip = process.platform === "win32" && "Windows has no Unix modes";
const modeOf = (file) => fs.statSync(file).mode & 0o777;

// The old code gave 0755 folders and 0644 files under this umask, so the checks below fail on it.
function useUmask(t) {
  const previous = process.umask(0o022);
  t.after(() => process.umask(previous));
}

function useDataDir(t, dataDir) {
  const previous = { data: process.env.CLAUDE_PLUGIN_DATA, companion: process.env.COPILOT_COMPANION_PLUGIN_DATA };
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  delete process.env.COPILOT_COMPANION_PLUGIN_DATA;
  t.after(() => {
    process.env.CLAUDE_PLUGIN_DATA = previous.data;
    if (previous.companion === undefined) {
      delete process.env.COPILOT_COMPANION_PLUGIN_DATA;
    } else {
      process.env.COPILOT_COMPANION_PLUGIN_DATA = previous.companion;
    }
  });
}

// A fresh 0755 data folder and a workspace, with the paths the plugin uses for them.
function setUp(t, { existingData = true } = {}) {
  useUmask(t);
  const dataDir = path.join(makeTempDir(), "data");
  if (existingData) {
    fs.mkdirSync(dataDir);
    fs.chmodSync(dataDir, 0o755);
  }
  useDataDir(t, dataDir);
  const workspace = makeTempDir();
  const stateDir = resolveStateDir(workspace);
  return { dataDir, workspace, stateDir, jobsDir: path.join(stateDir, "jobs") };
}

// Folders as an older version made them.
function makeOldFolders(paths) {
  fs.mkdirSync(paths.jobsDir, { recursive: true });
  for (const dir of [path.dirname(paths.stateDir), paths.stateDir, paths.jobsDir]) {
    fs.chmodSync(dir, 0o755);
  }
}

function writeEverything(workspace) {
  updateState(workspace, (state) => {
    state.config.stopReviewGate = true;
  });
  writeJobFile(workspace, "job-1", { id: "job-1", prompt: "secret" });
  return createJobLogFile(workspace, "job-1", "Copilot Task");
}

function assertOwnerOnly(paths, logFile) {
  assert.equal(modeOf(paths.stateDir), 0o700);
  assert.equal(modeOf(paths.jobsDir), 0o700);
  assert.equal(modeOf(resolveStateFile(paths.workspace)), 0o600);
  assert.equal(modeOf(resolveJobFile(paths.workspace, "job-1")), 0o600);
  assert.equal(modeOf(logFile), 0o600);
}

function failFor(t, method, target, code) {
  const real = fs[method];
  t.mock.method(fs, method, (file, ...rest) => {
    if (path.resolve(String(file)) === path.resolve(target)) {
      throw Object.assign(new Error(`${code}: mocked`), { code });
    }
    return real(file, ...rest);
  });
}

test("under CLAUDE_PLUGIN_DATA the state folders and job files are owner-only, and the data folder is left alone", { skip }, (t) => {
  const paths = setUp(t);

  assertOwnerOnly(paths, writeEverything(paths.workspace));
  assert.equal(modeOf(path.dirname(paths.stateDir)), 0o700);
  assert.equal(modeOf(paths.dataDir), 0o755);
});

test("without CLAUDE_PLUGIN_DATA the fallback state folders and job files are owner-only", { skip }, (t) => {
  useUmask(t);
  const previous = { home: process.env.HOME, data: process.env.CLAUDE_PLUGIN_DATA, companion: process.env.COPILOT_COMPANION_PLUGIN_DATA };
  process.env.HOME = makeTempDir();
  delete process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.COPILOT_COMPANION_PLUGIN_DATA;
  t.after(() => {
    process.env.HOME = previous.home;
    process.env.CLAUDE_PLUGIN_DATA = previous.data;
    if (previous.companion !== undefined) {
      process.env.COPILOT_COMPANION_PLUGIN_DATA = previous.companion;
    }
  });
  const workspace = makeTempDir();
  const stateDir = resolveStateDir(workspace);
  assert.ok(stateDir.startsWith(path.join(process.env.HOME, ".copilot-companion")));

  assertOwnerOnly({ workspace, stateDir, jobsDir: path.join(stateDir, "jobs") }, writeEverything(workspace));
});

test("a data folder that does not exist yet gets the default mode, and the state folders under it are owner-only", { skip }, (t) => {
  const paths = setUp(t, { existingData: false });

  writeEverything(paths.workspace);

  assert.equal(modeOf(paths.dataDir), 0o755);
  assert.equal(modeOf(path.dirname(paths.stateDir)), 0o700);
  assert.equal(modeOf(paths.stateDir), 0o700);
});

test("state folders and a log from an older version are tightened, and an existing state folder above them is not", { skip }, (t) => {
  const paths = setUp(t);
  makeOldFolders(paths);
  const logFile = path.join(paths.jobsDir, "job-1.log");
  fs.writeFileSync(logFile, "old log\n");
  fs.chmodSync(logFile, 0o644);

  assertOwnerOnly(paths, writeEverything(paths.workspace));
  assert.equal(modeOf(path.dirname(paths.stateDir)), 0o755);
});

test("job files of an older version become owner-only when they are written again", { skip }, (t) => {
  const paths = setUp(t);
  writeEverything(paths.workspace);
  fs.chmodSync(resolveStateFile(paths.workspace), 0o644);
  fs.chmodSync(resolveJobFile(paths.workspace, "job-1"), 0o644);

  writeEverything(paths.workspace);

  assert.equal(modeOf(resolveStateFile(paths.workspace)), 0o600);
  assert.equal(modeOf(resolveJobFile(paths.workspace, "job-1")), 0o600);
});

test("a log that either append helper creates is owner-only", { skip }, (t) => {
  const paths = setUp(t);
  const lineLog = resolveJobLogFile(paths.workspace, "line");
  const blockLog = resolveJobLogFile(paths.workspace, "block");

  appendLogLine(lineLog, "first line");
  appendLogBlock(blockLog, "Title", "body");

  assert.equal(modeOf(lineLog), 0o600);
  assert.equal(modeOf(blockLog), 0o600);
});

test("the temp file of a state write is owner-only before its rename", { skip }, (t) => {
  const paths = setUp(t);
  const stateFile = resolveStateFile(paths.workspace);
  let tempMode;
  t.mock.method(fs, "renameSync", (from) => {
    tempMode = modeOf(from);
    throw Object.assign(new Error("EIO: mocked"), { code: "EIO" });
  });

  assert.throws(() => updateState(paths.workspace, () => {}), /EIO/);
  assert.equal(tempMode, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(stateFile)).filter((name) => name.endsWith(".tmp")), []);
});

test("a jobs folder that links elsewhere keeps its target's mode while the workspace folder is tightened", { skip }, (t) => {
  const paths = setUp(t);
  fs.mkdirSync(paths.stateDir, { recursive: true });
  fs.chmodSync(paths.stateDir, 0o755);
  const target = makeTempDir();
  fs.chmodSync(target, 0o755);
  fs.symlinkSync(target, paths.jobsDir, "dir");

  writeJobFile(paths.workspace, "job-1", { id: "job-1" });

  assert.equal(modeOf(paths.stateDir), 0o700);
  assert.equal(modeOf(target), 0o755);
});

test("a workspace folder that cannot be tightened still lets the jobs folder be tightened", { skip }, (t) => {
  const paths = setUp(t);
  makeOldFolders(paths);
  failFor(t, "chmodSync", paths.stateDir, "EPERM");

  writeJobFile(paths.workspace, "job-1", { id: "job-1" });

  assert.equal(modeOf(paths.stateDir), 0o755);
  assert.equal(modeOf(paths.jobsDir), 0o700);
});

test("a jobs folder that cannot be checked still lets the workspace folder be tightened", { skip }, (t) => {
  const paths = setUp(t);
  makeOldFolders(paths);
  failFor(t, "lstatSync", paths.jobsDir, "EACCES");

  writeJobFile(paths.workspace, "job-1", { id: "job-1" });

  assert.equal(modeOf(paths.stateDir), 0o700);
  assert.equal(modeOf(paths.jobsDir), 0o755);
});

// These pass on the old code too; they guard what the fix must not break.

test("an existing state folder above the workspace folders keeps its mode", { skip }, (t) => {
  const paths = setUp(t);
  makeOldFolders(paths);

  writeEverything(paths.workspace);

  assert.equal(modeOf(path.dirname(paths.stateDir)), 0o755);
});

for (const [name, method, which, code] of [
  ["the workspace folder cannot be tightened", "chmodSync", "state", "EPERM"],
  ["the jobs folder cannot be tightened", "chmodSync", "jobs", "EROFS"],
  ["the log cannot be tightened", "chmodSync", "log", "EPERM"],
  ["the workspace folder cannot be checked (ENOENT)", "lstatSync", "state", "ENOENT"],
  ["the workspace folder cannot be checked (EACCES)", "lstatSync", "state", "EACCES"],
  ["the jobs folder cannot be checked", "lstatSync", "jobs", "EACCES"],
  ["the log cannot be checked", "lstatSync", "log", "EACCES"]
]) {
  test(`state updates, job files, logs and reads still work when ${name}`, { skip }, (t) => {
    const paths = setUp(t);
    makeOldFolders(paths);
    const logFile = path.join(paths.jobsDir, "job-1.log");
    fs.writeFileSync(logFile, "old log\n");
    fs.chmodSync(logFile, 0o644);
    const target = { state: paths.stateDir, jobs: paths.jobsDir, log: logFile }[which];
    failFor(t, method, target, code);

    const created = writeEverything(paths.workspace);

    assert.equal(created, logFile);
    assert.match(fs.readFileSync(logFile, "utf8"), /Starting Copilot Task\./);
    assert.equal(resolveJobLogFile(paths.workspace, "job-1"), logFile);
    assert.equal(JSON.parse(fs.readFileSync(resolveJobFile(paths.workspace, "job-1"), "utf8")).prompt, "secret");
    if (method === "lstatSync" && which === "state") {
      // A workspace folder that cannot be checked may be a link, so neither folder is changed.
      assert.equal(modeOf(paths.stateDir), 0o755);
      assert.equal(modeOf(paths.jobsDir), 0o755);
    }
  });
}

test("a workspace folder that links elsewhere, and a log that links elsewhere, keep their targets' modes", { skip }, (t) => {
  const paths = setUp(t);
  fs.mkdirSync(path.dirname(paths.stateDir), { recursive: true });
  const target = makeTempDir();
  fs.mkdirSync(path.join(target, "jobs"));
  fs.chmodSync(target, 0o755);
  fs.chmodSync(path.join(target, "jobs"), 0o755);
  fs.symlinkSync(target, paths.stateDir, "dir");
  const logTarget = path.join(makeTempDir(), "elsewhere.log");
  fs.writeFileSync(logTarget, "");
  fs.chmodSync(logTarget, 0o644);
  fs.symlinkSync(logTarget, path.join(target, "jobs", "job-1.log"));

  writeEverything(paths.workspace);

  assert.equal(modeOf(target), 0o755);
  assert.equal(modeOf(path.join(target, "jobs")), 0o755);
  assert.equal(modeOf(logTarget), 0o644);
});
