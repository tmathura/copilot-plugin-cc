// Changed from upstream codex-plugin-cc (Apache-2.0): when git fails inside a repository, the
// workspace is the nearest folder above the real path that holds .git, not the working folder.
import fs from "node:fs";
import path from "node:path";

import { ensureGitRepository } from "./git.mjs";

// Git looks from the real path, so a repository opened through a link is found the same way.
export function findGitMarkerRoot(cwd) {
  let start = path.resolve(cwd);
  try {
    start = fs.realpathSync.native(start);
  } catch {
    // A folder that cannot be resolved is walked as written.
  }
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    if (path.dirname(dir) === dir) {
      return null;
    }
  }
}

// A broken or missing git in a subfolder must still find the state that was saved under the
// repository root, or the hooks would read a fresh default and skip the gate and the cleanup.
export function resolveWorkspaceRoot(cwd) {
  try {
    return ensureGitRepository(cwd);
  } catch {
    return findGitMarkerRoot(cwd) ?? cwd;
  }
}
