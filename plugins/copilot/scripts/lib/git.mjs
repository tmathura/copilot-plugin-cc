// Changed from upstream codex-plugin-cc (Apache-2.0): every git call writes no index and starts no
// fsmonitor hook or textconv program; non-ASCII file names are not quoted; untracked symlinks, and
// untracked files whose real path is outside the repository (behind a folder link or a junction), are
// not read; the diff is inline up to the byte limit whatever the file count; above it the self-collect
// guidance points Copilot at one patch file per changed file, which writeReviewPatches writes; the
// review sections remove only trailing new lines, so Git Status keeps the leading space of its first line;
// the default branch from origin/HEAD is origin/<name> when there is no local branch of that name.
import fs from "node:fs";
import path from "node:path";

import { isProbablyText } from "./fs.mjs";
import { formatCommandFailure, runCommand, runCommandChecked } from "./process.mjs";

const MAX_UNTRACKED_BYTES = 24 * 1024;
// Codex runs git itself above upstream's 2 files. Copilot can only view a patch file, which cuts each
// read at about 40 KB, so any number of files stays inline up to the byte limit.
const DEFAULT_INLINE_DIFF_MAX_FILES = Infinity;
const DEFAULT_INLINE_DIFF_MAX_BYTES = 256 * 1024;
// Reviews run these calls before Copilot starts, so no Copilot control covers what git itself starts.
// git diff refreshes .git/index even with --no-optional-locks unless diff.autoRefreshIndex is off.
const SAFE_GIT_OPTIONS = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
// Git then prints a non-ASCII name as it is, so the status, the file lists and the patches agree.
// Git still quotes a name with a tab, a newline, a quote or a backslash.
const PATH_OPTIONS = ["-c", "core.quotePath=false"];

function safeGitArgs(args) {
  if (args[0] === "diff") {
    return [...SAFE_GIT_OPTIONS, ...PATH_OPTIONS, "diff", "--no-textconv", ...args.slice(1)];
  }
  return [...SAFE_GIT_OPTIONS, ...PATH_OPTIONS, ...args];
}

// Git is directly executable on Windows. Repository-derived arguments must never pass through a shell.
function git(cwd, args, options = {}) {
  return runCommand("git", safeGitArgs(args), { cwd, ...options, shell: false });
}

function gitChecked(cwd, args, options = {}) {
  return runCommandChecked("git", safeGitArgs(args), { cwd, ...options, shell: false });
}

function listUniqueFiles(...groups) {
  return [...new Set(groups.flat().filter(Boolean))].sort();
}

function normalizeMaxInlineFiles(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_INLINE_DIFF_MAX_FILES;
  }
  return Math.floor(parsed);
}

function normalizeMaxInlineDiffBytes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_INLINE_DIFF_MAX_BYTES;
  }
  return Math.floor(parsed);
}

function measureGitOutputBytes(cwd, args, maxBytes) {
  const result = git(cwd, args, { maxBuffer: maxBytes + 1 });
  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOBUFS") {
    return maxBytes + 1;
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return Buffer.byteLength(result.stdout, "utf8");
}

function measureCombinedGitOutputBytes(cwd, argSets, maxBytes) {
  let totalBytes = 0;
  for (const args of argSets) {
    const remainingBytes = maxBytes - totalBytes;
    if (remainingBytes < 0) {
      return maxBytes + 1;
    }
    totalBytes += measureGitOutputBytes(cwd, args, remainingBytes);
    if (totalBytes > maxBytes) {
      return totalBytes;
    }
  }
  return totalBytes;
}

function buildBranchComparison(cwd, baseRef) {
  const mergeBase = gitChecked(cwd, ["merge-base", "HEAD", baseRef]).stdout.trim();
  return {
    mergeBase,
    commitRange: `${mergeBase}..HEAD`,
    reviewRange: `${baseRef}...HEAD`
  };
}

export function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  const errorCode = result.error && "code" in result.error ? result.error.code : null;
  if (errorCode === "ENOENT") {
    throw new Error("git is not installed. Install Git and retry.");
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.");
  }
  return result.stdout.trim();
}

export function getRepoRoot(cwd) {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

export function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const remoteHead = symbolic.stdout.trim();
    if (remoteHead.startsWith("refs/remotes/origin/")) {
      const name = remoteHead.replace("refs/remotes/origin/", "");
      const local = git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
      return local.status === 0 ? name : `origin/${name}`;
    }
  }

  const candidates = ["main", "master", "trunk"];
  for (const candidate of candidates) {
    const local = git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (local.status === 0) {
      return candidate;
    }
    const remote = git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]);
    if (remote.status === 0) {
      return `origin/${candidate}`;
    }
  }

  throw new Error("Unable to detect the repository default branch. Pass --base <ref> or use --scope working-tree.");
}

export function getCurrentBranch(cwd) {
  return gitChecked(cwd, ["branch", "--show-current"]).stdout.trim() || "HEAD";
}

// Without the index refresh, --name-only would also list files whose content matches the index but
// whose cached stat data is stale. --numstat compares the content, and quotes paths as --name-only does.
function listUnstagedFiles(cwd) {
  return gitChecked(cwd, ["diff", "--numstat", "--no-renames"])
    .stdout.split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t").slice(2).join("\t"));
}

export function getWorkingTreeState(cwd) {
  // No trim() in the name lists: an unquoted name can end with a no-break space (U+00A0).
  const staged = gitChecked(cwd, ["diff", "--cached", "--name-only"]).stdout.split("\n").filter(Boolean);
  const unstaged = listUnstagedFiles(cwd);
  // -z gives the real names: without it git quotes a name with a tab, a newline, a quote or a
  // backslash, and the file cannot be read.
  const untracked = gitChecked(cwd, ["ls-files", "-z", "--others", "--exclude-standard"]).stdout.split("\0").filter(Boolean);

  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0
  };
}

export function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd);

  const requestedScope = options.scope ?? "auto";
  const baseRef = options.base ?? null;
  const state = getWorkingTreeState(cwd);
  const supportedScopes = new Set(["auto", "working-tree", "branch"]);

  if (baseRef) {
    return {
      mode: "branch",
      label: `branch diff against ${baseRef}`,
      baseRef,
      explicit: true
    };
  }

  if (requestedScope === "working-tree") {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: true
    };
  }

  if (!supportedScopes.has(requestedScope)) {
    throw new Error(
      `Unsupported review scope "${requestedScope}". Use one of: auto, working-tree, branch, or pass --base <ref>.`
    );
  }

  if (requestedScope === "branch") {
    const detectedBase = detectDefaultBranch(cwd);
    return {
      mode: "branch",
      label: `branch diff against ${detectedBase}`,
      baseRef: detectedBase,
      explicit: true
    };
  }

  if (state.isDirty) {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: false
    };
  }

  const detectedBase = detectDefaultBranch(cwd);
  return {
    mode: "branch",
    label: `branch diff against ${detectedBase}`,
    baseRef: detectedBase,
    explicit: false
  };
}

// Only trailing new lines go: a leading space is the staged column of `git status --short`, and a
// file name or a patch line can end in white space.
function formatSection(title, body) {
  return [`## ${title}`, "", body.trim() ? body.replace(/\n+$/, "") : "(none)", ""].join("\n");
}

// A bare startsWith("..") would also match an in-repo name such as "..notes.txt".
function isOutside(root, file) {
  const relative = path.relative(root, file);
  return relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function formatUntrackedFile(cwd, relativePath) {
  const absolutePath = path.join(cwd, relativePath);
  let stat;
  let isLink;
  try {
    stat = fs.statSync(absolutePath);
    // A folder link or a Windows junction above the file leaves the leaf a plain file, and Git for
    // Windows lists the files behind a junction.
    isLink =
      fs.lstatSync(absolutePath).isSymbolicLink() ||
      isOutside(fs.realpathSync.native(cwd), fs.realpathSync.native(absolutePath));
  } catch {
    return `### ${relativePath}\n(skipped: broken symlink or unreadable file)`;
  }
  // A link can point outside the repository, for example at a key file.
  if (isLink) {
    return `### ${relativePath}\n(skipped: symlink)`;
  }
  if (stat.isDirectory()) {
    return `### ${relativePath}\n(skipped: directory)`;
  }
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return `### ${relativePath}\n(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`;
  }

  let buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch {
    return `### ${relativePath}\n(skipped: broken symlink or unreadable file)`;
  }
  if (!isProbablyText(buffer)) {
    return `### ${relativePath}\n(skipped: binary file)`;
  }

  return [`### ${relativePath}`, "```", buffer.toString("utf8").trimEnd(), "```"].join("\n");
}

function collectWorkingTreeContext(cwd, state, options = {}) {
  const includeDiff = options.includeDiff !== false;
  const status = gitChecked(cwd, ["status", "--short", "--untracked-files=all"]).stdout;
  const changedFiles = listUniqueFiles(state.staged, state.unstaged, state.untracked);

  let parts;
  if (includeDiff) {
    const stagedDiff = gitChecked(cwd, ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout;
    const unstagedDiff = gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout;
    const untrackedBody = state.untracked.map((file) => formatUntrackedFile(cwd, file)).join("\n\n");
    parts = [
      formatSection("Git Status", status),
      formatSection("Staged Diff", stagedDiff),
      formatSection("Unstaged Diff", unstagedDiff),
      formatSection("Untracked Files", untrackedBody)
    ];
  } else {
    const stagedStat = gitChecked(cwd, ["diff", "--shortstat", "--cached"]).stdout.trim();
    const unstagedStat = gitChecked(cwd, ["diff", "--shortstat"]).stdout.trim();
    const untrackedBody = state.untracked.map((file) => formatUntrackedFile(cwd, file)).join("\n\n");
    parts = [
      formatSection("Git Status", status),
      formatSection("Staged Diff Stat", stagedStat),
      formatSection("Unstaged Diff Stat", unstagedStat),
      formatSection("Changed Files", changedFiles.join("\n")),
      formatSection("Untracked Files", untrackedBody)
    ];
  }

  return {
    mode: "working-tree",
    summary: `Reviewing ${state.staged.length} staged, ${state.unstaged.length} unstaged, and ${state.untracked.length} untracked file(s).`,
    content: parts.join("\n"),
    changedFiles
  };
}

function collectBranchContext(cwd, baseRef, options = {}) {
  const includeDiff = options.includeDiff !== false;
  const comparison = options.comparison ?? buildBranchComparison(cwd, baseRef);
  const currentBranch = getCurrentBranch(cwd);
  const changedFiles = gitChecked(cwd, ["diff", "--name-only", comparison.commitRange]).stdout.split("\n").filter(Boolean);
  const logOutput = gitChecked(cwd, ["log", "--oneline", "--decorate", comparison.commitRange]).stdout.trim();
  const diffStat = gitChecked(cwd, ["diff", "--stat", comparison.commitRange]).stdout.trim();

  return {
    mode: "branch",
    summary: `Reviewing branch ${currentBranch} against ${baseRef} from merge-base ${comparison.mergeBase}.`,
    content: includeDiff
      ? [
          formatSection("Commit Log", logOutput),
          formatSection("Diff Stat", diffStat),
          formatSection(
            "Branch Diff",
            gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff", comparison.commitRange]).stdout
          )
        ].join("\n")
      : [
          formatSection("Commit Log", logOutput),
          formatSection("Diff Stat", diffStat),
          formatSection("Changed Files", changedFiles.join("\n"))
        ].join("\n"),
    changedFiles,
    comparison
  };
}

function buildAdversarialCollectionGuidance(options = {}) {
  if (options.includeDiff !== false) {
    return "Use the repository context below as primary evidence.";
  }

  return "The repository context below is a lightweight summary. Read every file listed below with the view tool before finalizing findings. Each patch file holds the diff of one changed file, or git's one-line note on a merge conflict. The list gives the line count of each file. The view tool cuts a long read, so read each file to its last line, in line ranges where needed.";
}

// Git writes straight to the file: a large patch has no buffer limit, and its bytes stay exact.
function writeGitOutput(cwd, args, file) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    gitChecked(cwd, args, { stdio: ["ignore", fd, "pipe"] });
  } finally {
    fs.closeSync(fd);
  }
  return file;
}

// An unresolved conflict gives a "diff --cc" header or a "* Unmerged path" note, in either diff.
const PATCH_HEADERS = ["diff --git ", "diff --cc ", "Submodule ", "* Unmerged path "].map((header) => Buffer.from(header));

function startsPatch(buffer, offset) {
  return PATCH_HEADERS.some(
    (header) => buffer.compare(header, 0, header.length, offset, Math.min(offset + header.length, buffer.length)) === 0
  );
}

// A patch line starts with a space, "+", "-" or "\", and a binary patch line has no space, so only a
// file, submodule or conflict line starts with these words. Bytes before the first one stay in the
// first part, so the parts joined are the exact diff.
function splitPatch(buffer) {
  const starts = [];
  for (let offset = 0; offset < buffer.length; ) {
    if (startsPatch(buffer, offset)) {
      starts.push(offset);
    }
    const end = buffer.indexOf(0x0a, offset);
    offset = end === -1 ? buffer.length : end + 1;
  }
  if (buffer.length > 0) {
    starts[0] = 0;
  }
  return starts.map((start, index) => buffer.subarray(start, starts[index + 1] ?? buffer.length));
}

function firstLine(buffer) {
  const end = buffer.indexOf(0x0a);
  return buffer.toString("utf8", 0, end === -1 ? buffer.length : end);
}

// The view tool reads by line number, so the line count tells Copilot where a file ends.
function countLines(buffer) {
  let lines = 0;
  for (let offset = buffer.indexOf(0x0a); offset !== -1; offset = buffer.indexOf(0x0a, offset + 1)) {
    lines += 1;
  }
  return buffer.length > 0 && buffer[buffer.length - 1] !== 0x0a ? lines + 1 : lines;
}

// One small file per changed file: Copilot's view tool cuts each read of a large file.
function writeSplitPatch(cwd, args, dir, name) {
  const fullPatch = writeGitOutput(cwd, args, path.join(dir, `${name}.patch`));
  const parts = splitPatch(fs.readFileSync(fullPatch));
  fs.rmSync(fullPatch);
  const width = Math.max(3, String(parts.length).length);
  return parts.map((part, index) => {
    const file = path.join(dir, `${name}-${String(index + 1).padStart(width, "0")}.patch`);
    fs.writeFileSync(file, part, { flag: "wx", mode: 0o600 });
    return { file, label: firstLine(part), lines: countLines(part) };
  });
}

// Above the inline limit Copilot cannot run git itself, so it reads the same patches from files.
export function writeReviewPatches(context, dir) {
  const { repoRoot } = context;
  const diffArgs = ["diff", "--binary", "--no-ext-diff", "--submodule=diff"];
  if (context.mode === "branch") {
    return writeSplitPatch(repoRoot, [...diffArgs, context.comparison.commitRange], dir, "branch");
  }

  const { untracked } = getWorkingTreeState(repoRoot);
  const untrackedFile = path.join(dir, "untracked.md");
  const untrackedText = untracked.map((file) => formatUntrackedFile(repoRoot, file)).join("\n\n");
  fs.writeFileSync(untrackedFile, untrackedText, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  return [
    ...writeSplitPatch(repoRoot, [...diffArgs, "--cached"], dir, "staged"),
    ...writeSplitPatch(repoRoot, diffArgs, dir, "unstaged"),
    { file: untrackedFile, label: "untracked files", lines: countLines(Buffer.from(untrackedText)) }
  ];
}

export function collectReviewContext(cwd, target, options = {}) {
  const repoRoot = getRepoRoot(cwd);
  const currentBranch = getCurrentBranch(repoRoot);
  const maxInlineFiles = normalizeMaxInlineFiles(options.maxInlineFiles);
  const maxInlineDiffBytes = normalizeMaxInlineDiffBytes(options.maxInlineDiffBytes);
  let details;
  let includeDiff;
  let diffBytes;

  if (target.mode === "working-tree") {
    const state = getWorkingTreeState(repoRoot);
    diffBytes = measureCombinedGitOutputBytes(
      repoRoot,
      [
        ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"],
        ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]
      ],
      maxInlineDiffBytes
    );
    includeDiff =
      options.includeDiff ??
      (listUniqueFiles(state.staged, state.unstaged, state.untracked).length <= maxInlineFiles &&
        diffBytes <= maxInlineDiffBytes);
    details = collectWorkingTreeContext(repoRoot, state, { includeDiff });
  } else {
    const comparison = buildBranchComparison(repoRoot, target.baseRef);
    const fileCount = gitChecked(repoRoot, ["diff", "--name-only", comparison.commitRange]).stdout.split("\n").filter(Boolean).length;
    diffBytes = measureGitOutputBytes(
      repoRoot,
      ["diff", "--binary", "--no-ext-diff", "--submodule=diff", comparison.commitRange],
      maxInlineDiffBytes
    );
    includeDiff = options.includeDiff ?? (fileCount <= maxInlineFiles && diffBytes <= maxInlineDiffBytes);
    details = collectBranchContext(repoRoot, target.baseRef, { includeDiff, comparison });
  }

  return {
    cwd: repoRoot,
    repoRoot,
    branch: currentBranch,
    target,
    fileCount: details.changedFiles.length,
    diffBytes,
    inputMode: includeDiff ? "inline-diff" : "self-collect",
    collectionGuidance: buildAdversarialCollectionGuidance({ includeDiff }),
    ...details
  };
}
