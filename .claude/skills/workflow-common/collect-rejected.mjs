// Print the rejected-finding entries of a ticket's review round commits.
// Usage: node collect-rejected.mjs <issue number>
// Exit 0: the entries, as `rejected: <reviewer>: <finding>: <reason>` lines up to the next blank line
// (nothing when there are none). Exit 1: an entry in another form (prints the commit and the line).
// Exit 2: bad arguments (prints the usage line) or git failed (prints "git failed").
//
// Reads the same commits as REFERENCE.md "Code review round": the first-parent commits in
// origin/main..HEAD whose message matches `^\[#<n>\] Address review round [0-9]`.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.length !== 1 || !/^[1-9]\d*$/.test(args[0])) {
  console.error("usage: node collect-rejected.mjs <issue number>");
  process.exit(2);
}
const issue = args[0];

let output;
try {
  output = execFileSync(
    "git",
    [
      "log",
      "--first-parent",
      `--grep=^\\[#${issue}\\] Address review round [0-9]`,
      "--format=%h%x00%s%x00%b%x1e",
      "origin/main..HEAD"
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
  );
} catch (error) {
  console.error(`git failed: ${error.stderr?.trim() || error.message}`);
  process.exit(2);
}

const commits = output
  .split("\x1e")
  .filter((record) => record.trim() !== "")
  .map((record) => {
    const [sha, subject, ...body] = record.replace(/^\n/, "").split("\x00");
    return { sha, subject, lines: body.join("\x00").replace(/\r\n/g, "\n").split("\n") };
  });

// A list marker or indent before `rejected:` hides the entry from the column-0 match below.
const wrongForm = /^(?:\s+|\s*(?:[-*+]|\d+[.)])\s*)rejected:/i;
const problems = commits.flatMap((commit) =>
  commit.lines
    .filter((line) => wrongForm.test(line))
    .map((line) => `${commit.sha} "${commit.subject}": ${JSON.stringify(line)}`)
);
if (problems.length > 0) {
  console.error("collect-rejected: these lines hold an entry in another form:");
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  console.error("Write each entry as `rejected: <reviewer>: <finding>: <reason>` at the start of a line.");
  process.exit(1);
}

// `git log --format=%b` ends each body with a blank line, which ends its last entry.
const printed = [];
for (const commit of commits) {
  let inEntry = false;
  for (const line of [...commit.lines, ""]) {
    if (line.startsWith("rejected:")) {
      inEntry = true;
    }
    if (inEntry) {
      printed.push(line);
    }
    if (line === "") {
      inEntry = false;
    }
  }
}
if (printed.length > 0) {
  process.stdout.write(`${printed.join("\n")}\n`);
}
