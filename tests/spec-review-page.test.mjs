import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { makeTempDir, run } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, ".claude", "skills", "spec-review-page", "build.py");
const TITLE = "Revue de la spec — été";

// Not uv: it can download a Python, and tests use no network. The Windows Store python3 stub fails
// this probe, and so does a Python older than 3.9, which build.py needs.
const PYTHON = ["python3", "python"].find(
  (name) => run(name, ["-c", "import sys; sys.exit(sys.version_info < (3, 9))"]).status === 0
);
const skip = PYTHON ? false : "no Python 3.9 or later as python3 or python on the PATH";

function makeSpec(files) {
  const dir = makeTempDir("spec-review-page-test-");
  const spec = path.join(dir, "spec");
  fs.mkdirSync(spec);
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(spec, name), text, "utf8");
  }
  return { dir, spec, page: path.join(spec, "review.html") };
}

function build({ dir, spec }, content, { snapshot = "abc1234", title = TITLE, out } = {}) {
  const fragment = path.join(dir, "content.html");
  fs.writeFileSync(fragment, content);
  return run(PYTHON, [
    BUILD, spec, fragment,
    "--ticket", "#105", "--title", title, "--snapshot", snapshot, "--date", "2026-10-20",
    ...(out ? ["--out", out] : [])
  ]);
}

function buildOk(ctx, content, options) {
  const result = build(ctx, content, options);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

const SPEC_MD = "# Spec\n\nCafé — the first claim.\n";
const GOOD = '<section id="change"><p>Café — claim <a class="cite" href="#spec-md-L3">spec.md:3</a></p></section>';
const WITH_DELTA = `${GOOD}<section id="delta"><p>Moved <a class="cite" href="#spec-md-L1">spec.md:1</a></p></section>`;

test("a Python is on the PATH in CI", { skip: !process.env.CI }, () => {
  assert.ok(PYTHON, "CI must run the spec-review-page build tests");
});

test("the build writes a page with every citation found and the text unchanged", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  assert.match(buildOk(ctx, GOOD).stdout, /missing anchors: 0/);
  const page = fs.readFileSync(ctx.page, "utf8");
  assert.match(page, /<meta name="spec-review-snapshot" content="abc1234">/);
  assert.ok(page.includes("Revue de la spec — été"));
  assert.ok(page.includes('<span id="spec-md-L3">Café — the first claim.</span>'));
});

test("a refresh reads the previous page's snapshot and adds the What moved entry", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  buildOk(ctx, GOOD);
  assert.ok(!fs.readFileSync(ctx.page, "utf8").includes('href="#delta"'), "no delta section, no entry");
  assert.match(buildOk(ctx, WITH_DELTA, { snapshot: "def5678" }).stdout, /previous page snapshot: abc1234/);
  const page = fs.readFileSync(ctx.page, "utf8");
  assert.match(page, /<meta name="spec-review-snapshot" content="def5678">/);
  assert.ok(page.includes('href="#delta"'));
});

test("the page is written with LF line ends and no temp file is left", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  buildOk(ctx, GOOD);
  assert.ok(!fs.readFileSync(ctx.page, "utf8").includes("\r"));
  assert.deepEqual(fs.readdirSync(ctx.spec).sort(), ["review.html", "spec.md"]);
});

test("a folder without spec.md builds, because the template cites no file", { skip }, () => {
  const ctx = makeSpec({ "plan.md": "# Plan\n" });
  buildOk(ctx, '<section id="change"><a class="cite" href="#plan-md-L1">plan.md:1</a></section>');
});

test("line numbers count LF as git and grep do, CRLF counts once, and a BOM is dropped", { skip }, () => {
  const ctx = makeSpec({ "spec.md": "\ufeff# Spec\r\n\r\nx\fy\u2028y\r\nz\rw\r\r\nlast\n" });
  const result = buildOk(ctx, '<section id="change"><a class="cite" href="#spec-md-L4">spec.md:4</a> <a class="cite" href="#spec-md-L5">spec.md:5</a></section>');
  const page = fs.readFileSync(ctx.page, "utf8");
  assert.ok(page.includes('<span id="spec-md-L1"># Spec</span>'));
  // Characters that could break a line on screen are shown as symbols, so line numbers still match.
  assert.ok(page.includes('<span id="spec-md-L3">x␌y␤y</span><span id="spec-md-L4">z␍w␍</span><span id="spec-md-L5">last</span>'));
  assert.ok(!page.includes("\ufeff") && !page.includes("\r") && !page.includes("\u2028"));
  assert.match(result.stdout, /spec-md:\s+4\s+z␍w␍/);
});

test("every control and separator character in a line is shown as a symbol", { skip }, () => {
  const ch = (...codes) => String.fromCharCode(...codes);
  // NUL, ESC, backspace, VT, FS, US, DEL, C1 edges and middle, NEL, LS, PS, an RLO; a tab stays.
  const raw = `a${ch(0x00, 0x1b, 0x08, 0x0b, 0x1c, 0x1f, 0x7f, 0x80, 0x90, 0x9f, 0x85, 0x2028, 0x2029, 0x202e)}\tb`;
  const shown = `a${ch(0x2400, 0x241b, 0x2408, 0x240b, 0x241c, 0x241f, 0x2421, 0x2426, 0x2426, 0x2426, 0x2424, 0x2424, 0x2424, 0xfffd)}\tb`;
  const ctx = makeSpec({ "spec.md": `# Spec\n${raw}\n` });
  const result = buildOk(ctx, '<section id="change"><a class="cite" href="#spec-md-L2">spec.md:2</a></section>');
  assert.ok(fs.readFileSync(ctx.page, "utf8").includes(`<span id="spec-md-L2">${shown}</span>`));
  assert.ok(result.stdout.includes(`spec-md:   2  ${shown}`), result.stdout);
});

test("{{...}} text in the content and the title is not filled in again", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  buildOk(ctx, `${GOOD}<p>{{SOURCES}}</p>`, { title: "{{CONTENT}}" });
  const page = fs.readFileSync(ctx.page, "utf8");
  assert.equal(page.match(/<details id="spec-md">/g).length, 1);
  assert.ok(page.includes("<p>{{SOURCES}}</p>"));
  assert.ok(page.includes("<title>#105 Spec Review</title>"));
  assert.ok(page.includes(">{{CONTENT}}</h1>"));
});

test("open words and diagrams skip details bodies, diagram text and comments, in any case or quoting", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  const content = `<section id='change'><p>one two</p>
    <figure><PRE class='mermaid' aria-label="x">graph LR
      a-->b</PRE></figure>
    <DETAILS><summary>three</summary><pre class="mermaid">graph TD
      c-->d</pre> four five</DETAILS >
    <!-- six <section id="delta"> --><p data-id="delta">seven</p></section>`;
  const result = buildOk(ctx, content);
  assert.match(result.stdout, /open-section words: 3 /);
  assert.match(result.stdout, /open diagrams: 1 /);
  assert.ok(!fs.readFileSync(ctx.page, "utf8").includes('href="#delta"'), "a comment or data-id is no delta section");
});

test("a single-quoted delta section gets the What moved entry", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  buildOk(ctx, GOOD);
  buildOk(ctx, `${GOOD}<SECTION id='delta'><p>Moved</p></SECTION>`);
  assert.ok(fs.readFileSync(ctx.page, "utf8").includes('href="#delta"'));
});

test("a delta section with no previous page fails", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  const result = build(ctx, WITH_DELTA);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /no previous page to compare with/);
  assert.ok(!fs.existsSync(ctx.page));
});

test("a delta section is allowed when the previous page has an empty snapshot", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  buildOk(ctx, GOOD, { snapshot: "" });
  buildOk(ctx, WITH_DELTA);
  assert.ok(fs.readFileSync(ctx.page, "utf8").includes('href="#delta"'));
});

test("an --out preview compares with the spec folder's page, not with the preview file", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  const preview = path.join(ctx.dir, "preview.html");
  const none = build(ctx, WITH_DELTA, { out: preview });
  assert.equal(none.status, 1, none.stderr);
  assert.match(none.stderr, /no previous page to compare with/);
  assert.ok(!fs.existsSync(preview));
  buildOk(ctx, GOOD, { snapshot: "page123" });
  const page = fs.readFileSync(ctx.page, "utf8");
  const result = buildOk(ctx, WITH_DELTA, { out: preview, snapshot: "new456" });
  assert.match(result.stdout, /previous page snapshot: page123/);
  assert.ok(fs.readFileSync(preview, "utf8").includes('href="#delta"'));
  assert.equal(fs.readFileSync(ctx.page, "utf8"), page, "a preview leaves the spec folder's page alone");
});

test("a refresh over a read-only page leaves no temp file", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  buildOk(ctx, GOOD);
  fs.chmodSync(ctx.page, 0o444);
  const result = build(ctx, GOOD);
  fs.chmodSync(ctx.page, 0o644);
  // Windows refuses to replace a read-only file; POSIX replaces it. Either way nothing is left behind.
  if (process.platform === "win32") {
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /not written: /);
  } else {
    assert.equal(result.status, 0, result.stderr);
  }
  assert.ok(!result.stderr.includes("Traceback"), result.stderr);
  assert.deepEqual(fs.readdirSync(ctx.spec).sort(), ["review.html", "spec.md"]);
});

const posix = skip || (process.platform === "win32" && "POSIX file modes");

test("a new page gets the mode a plain write gives, and a refresh keeps the old page's mode", { skip: posix }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  buildOk(ctx, GOOD);
  const plain = path.join(ctx.dir, "plain.txt");
  fs.writeFileSync(plain, "x");
  assert.equal(fs.statSync(ctx.page).mode & 0o777, fs.statSync(plain).mode & 0o777);
  fs.chmodSync(ctx.page, 0o640);
  buildOk(ctx, GOOD);
  assert.equal(fs.statSync(ctx.page).mode & 0o777, 0o640);
});

test("a previous page that cannot be read fails with a message", { skip: posix || (process.getuid?.() === 0 && "root reads any file") }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  buildOk(ctx, GOOD);
  fs.chmodSync(ctx.page, 0o000);
  const result = build(ctx, GOOD);
  fs.chmodSync(ctx.page, 0o644);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /cannot read the previous page/);
  assert.ok(!result.stderr.includes("Traceback"), result.stderr);
});

const unreadable = posix || (process.getuid?.() === 0 && "root reads any file");

test("a preview with no delta section builds, with a note, when the spec folder's page cannot be read", { skip: unreadable }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  buildOk(ctx, GOOD);
  const page = fs.readFileSync(ctx.page, "utf8");
  const preview = path.join(ctx.dir, "preview.html");
  fs.chmodSync(ctx.page, 0o000);
  const result = build(ctx, GOOD, { out: preview });
  fs.chmodSync(ctx.page, 0o644);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /note: cannot read the previous page/);
  assert.ok(fs.existsSync(preview));
  assert.equal(fs.readFileSync(ctx.page, "utf8"), page);
});

test("a preview with a delta section fails when the spec folder's page cannot be read", { skip: unreadable }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  buildOk(ctx, GOOD);
  const preview = path.join(ctx.dir, "preview.html");
  fs.chmodSync(ctx.page, 0o000);
  const result = build(ctx, WITH_DELTA, { out: preview });
  fs.chmodSync(ctx.page, 0o644);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /no previous page to compare with \(it cannot be read: /);
  assert.ok(!fs.existsSync(preview));
});

// A file symlink on Windows needs developer mode, so such a case skips there; a folder link is made
// as a junction on Windows, which needs no rights, so those cases run on every system.
for (const [name, makeLink, message] of [
  ["a Markdown file link to a file outside the spec folder", (ctx, secret) => {
    fs.symlinkSync(secret, path.join(ctx.spec, "leak.md"), "file");
  }, /leak\.md is a link/],
  ["a folder link (a junction on Windows) to a folder outside", (ctx, secret) => {
    fs.symlinkSync(path.dirname(secret), path.join(ctx.spec, "linked"), "junction");
  }, /linked is a link/],
  ["a folder link inside a subfolder", (ctx, secret) => {
    fs.mkdirSync(path.join(ctx.spec, "contracts"));
    fs.symlinkSync(path.dirname(secret), path.join(ctx.spec, "contracts", "linked"), "junction");
  }, /contracts\/linked is a link/],
  ["a folder link back into the spec folder (a loop)", (ctx) => {
    fs.symlinkSync(ctx.spec, path.join(ctx.spec, "loop"), "junction");
  }, /loop is a link/],
  ["a review.html that is a link", (ctx, secret) => {
    fs.symlinkSync(secret, ctx.page, "file");
  }, /review\.html is a link/]
]) {
  test(`${name} is refused`, { skip }, (t) => {
    const ctx = makeSpec({ "spec.md": SPEC_MD });
    const outside = path.join(ctx.dir, "outside");
    fs.mkdirSync(outside);
    const secret = path.join(outside, "secret.md");
    fs.writeFileSync(secret, "TOKEN=do-not-embed\n");
    try {
      makeLink(ctx, secret);
    } catch {
      t.skip("this system cannot make this kind of link");
      return;
    }
    const result = build(ctx, GOOD);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.equal(fs.readFileSync(secret, "utf8"), "TOKEN=do-not-embed\n");
    const page = fs.lstatSync(ctx.page, { throwIfNoEntry: false });
    assert.ok(!page || page.isSymbolicLink(), "no page was written");
  });
}

test("a spec folder that is itself a link is refused", { skip }, (t) => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  const linked = path.join(ctx.dir, "linked-spec");
  try {
    fs.symlinkSync(ctx.spec, linked, "junction");
  } catch {
    t.skip("this system cannot make a folder link");
    return;
  }
  const result = build({ dir: ctx.dir, spec: linked }, GOOD);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /linked-spec is a link/);
  assert.ok(!fs.existsSync(ctx.page));
});

function buildFrom(cwd, spec, content) {
  const fragment = path.join(cwd, "content.html");
  fs.writeFileSync(fragment, content);
  return run(PYTHON, [BUILD, spec, fragment, "--ticket", "#105", "--title", TITLE, "--snapshot", "abc1234", "--date", "2026-10-20"], { cwd });
}

test("a relative spec path through a linked parent folder (a committed specs link) is refused", { skip }, (t) => {
  const repo = makeTempDir("spec-review-page-test-");
  const outside = makeTempDir("spec-review-page-test-");
  fs.mkdirSync(path.join(outside, "105-x"));
  fs.writeFileSync(path.join(outside, "105-x", "spec.md"), "TOKEN=do-not-embed\n");
  try {
    fs.symlinkSync(outside, path.join(repo, "specs"), "junction");
  } catch {
    t.skip("this system cannot make a folder link");
    return;
  }
  const result = buildFrom(repo, path.join("specs", "105-x"), GOOD);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /specs is a link/);
  assert.ok(!fs.existsSync(path.join(outside, "105-x", "review.html")));
});

test("a relative spec path with '..' and no link builds", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  const sub = path.join(ctx.dir, "sub");
  fs.mkdirSync(sub);
  const result = buildFrom(sub, path.join("..", "spec"), GOOD);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(ctx.page));
});

test("a spec path with '..' is refused, because the system resolves '..' through a link", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  fs.mkdirSync(path.join(ctx.spec, "sub"));
  // A plain string: path.join would remove the '..' before the build sees it.
  const result = build({ dir: ctx.dir, spec: `${ctx.spec}${path.sep}sub${path.sep}..` }, GOOD);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /pass the spec folder without '\.\.'/);
});

test("a FIFO named like a Markdown file is not read, so the build does not hang", { skip: posix }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  assert.equal(run("mkfifo", [path.join(ctx.spec, "pipe.md")]).status, 0);
  const result = buildOk(ctx, GOOD);
  assert.match(result.stdout, /files: 1 /);
});

test("an --out that is a link is refused", { skip }, (t) => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  const elsewhere = path.join(ctx.dir, "elsewhere.html");
  fs.writeFileSync(elsewhere, "<!doctype html><p>somewhere else</p>\n");
  const out = path.join(ctx.dir, "preview.html");
  try {
    fs.symlinkSync(elsewhere, out, "file");
  } catch {
    t.skip("this system cannot make a symlink (Windows without developer mode)");
    return;
  }
  const result = build(ctx, GOOD, { out });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /refusing to use .*preview\.html: it is a link/);
  assert.equal(fs.readFileSync(elsewhere, "utf8"), "<!doctype html><p>somewhere else</p>\n");
});

test("a folder named like a Markdown file is not read as one; an upper-case .MD file is", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD, "UPPER.MD": "# Upper\n" });
  fs.mkdirSync(path.join(ctx.spec, "notes.md"));
  fs.writeFileSync(path.join(ctx.spec, "notes.md", "inner.md"), "# Inner\n");
  const result = buildOk(ctx, '<section id="change"><a class="cite" href="#notes-md-inner-md-L1">inner:1</a> <a class="cite" href="#upper-md-L1">upper:1</a></section>');
  assert.match(result.stdout, /files: 3 /);
});

for (const [name, block, message] of [
  ["a Markdown file", (ctx) => path.join(ctx.spec, "spec.md"), /cannot read .*spec\.md/],
  ["a folder", (ctx) => { fs.mkdirSync(path.join(ctx.spec, "contracts")); return path.join(ctx.spec, "contracts"); }, /cannot read .*contracts/]
]) {
  test(`${name} that cannot be read fails with a message, not a traceback`, { skip: unreadable }, () => {
    const ctx = makeSpec({ "spec.md": SPEC_MD });
    const target = block(ctx);
    fs.chmodSync(target, 0o000);
    const result = build(ctx, GOOD);
    fs.chmodSync(target, 0o755);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.ok(!result.stderr.includes("Traceback"), result.stderr);
  });
}

for (const [name, files, content, message] of [
  ["a Markdown file", { "spec.md": SPEC_MD, "plan.md": Buffer.from([0x23, 0x20, 0xff, 0x0a]) }, GOOD, /plan\.md is not UTF-8/],
  ["the content fragment", { "spec.md": SPEC_MD }, Buffer.from([0x3c, 0x70, 0x3e, 0xff]), /content\.html is not UTF-8/]
]) {
  test(`${name} that is not UTF-8 fails with its name, not a traceback`, { skip }, () => {
    const result = build(makeSpec(files), content);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.ok(!result.stderr.includes("Traceback"), result.stderr);
  });
}

for (const [name, out, message] of [
  ["an --out folder that does not exist", (ctx) => path.join(ctx.dir, "missing", "review.html"), /not written: .*review\.html/],
  ["an --out that is a folder", (ctx) => ctx.dir, /is a folder; pass a file path/]
]) {
  test(`${name} fails with a message, not a traceback`, { skip }, () => {
    const ctx = makeSpec({ "spec.md": SPEC_MD });
    const result = build(ctx, GOOD, { out: out(ctx) });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.ok(!result.stderr.includes("Traceback"), result.stderr);
    assert.deepEqual(fs.readdirSync(ctx.spec), ["spec.md"]);
  });
}

for (const [name, target] of [
  ["a line past the end", "spec-md-L99"],
  ["line zero", "spec-md-L0"],
  ["a file that does not exist", "plan-md-L1"],
  ["a malformed target", "spec_md-L3"],
  ["a zero-padded line number", "spec-md-L03"]
]) {
  test(`a citation to ${name} fails and keeps the previous page`, { skip }, () => {
    const ctx = makeSpec({ "spec.md": SPEC_MD });
    buildOk(ctx, GOOD);
    const before = fs.readFileSync(ctx.page, "utf8");
    const result = build(ctx, GOOD.replace("#spec-md-L3", `#${target}`));
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stdout.includes(`MISSING ${target}`), result.stdout);
    assert.match(result.stderr, /not written: fix the missing anchors first/);
    assert.equal(fs.readFileSync(ctx.page, "utf8"), before);
  });
}

let cachedPage;
function generatedPage() {
  if (cachedPage === undefined) {
    const ctx = makeSpec({ "spec.md": SPEC_MD });
    buildOk(ctx, GOOD);
    cachedPage = fs.readFileSync(ctx.page, "utf8");
  }
  return cachedPage;
}

const HAND_WRITTEN = "<!doctype html><p>Written by hand.</p>\n";

for (const [name, files, existing, message] of [
  ["a hand-written review.html", { "spec.md": SPEC_MD }, () => HAND_WRITTEN, /refusing to overwrite/],
  ["a folder with no Markdown", {}, generatedPage, /no Markdown files/],
  ["two files with the same anchor name", { "a-b.md": "one\n", "a_b.md": "two\n" }, generatedPage, /slug collision/]
]) {
  test(`${name} fails and leaves review.html unchanged`, { skip }, () => {
    const ctx = makeSpec(files);
    const before = existing();
    fs.writeFileSync(ctx.page, before, "utf8");
    const result = build(ctx, GOOD);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.equal(fs.readFileSync(ctx.page, "utf8"), before);
  });
}
