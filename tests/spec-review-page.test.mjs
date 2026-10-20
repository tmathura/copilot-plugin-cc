import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { makeTempDir, run } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, ".claude", "skills", "spec-review-page", "build.py");
const TITLE = "Revue de la spec — été";

// Not uv: it can download a Python, and tests use no network. The Windows Store python3 stub fails --version.
const PYTHON = ["python3", "python"].find((name) => run(name, ["--version"]).status === 0);
const skip = PYTHON ? false : "no python3 or python on the PATH";

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
  const ctx = makeSpec({ "spec.md": "﻿# Spec\r\n\r\nx\fy\r\nz\rw\nlast\n" });
  buildOk(ctx, '<section id="change"><a class="cite" href="#spec-md-L5">spec.md:5</a></section>');
  const page = fs.readFileSync(ctx.page, "utf8");
  assert.ok(page.includes('<span id="spec-md-L1"># Spec</span>'));
  // A lone CR is shown as ␍, so neither the browser nor the terminal breaks the line there.
  assert.ok(page.includes('<span id="spec-md-L3">x\fy</span><span id="spec-md-L4">z␍w</span><span id="spec-md-L5">last</span>'));
  assert.ok(!page.includes("﻿") && !page.includes("\r"));
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

test("a delta section is allowed when the previous page has an empty snapshot, or in an --out preview", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  buildOk(ctx, GOOD, { snapshot: "" });
  buildOk(ctx, WITH_DELTA);
  buildOk(ctx, WITH_DELTA, { out: path.join(ctx.dir, "preview.html") });
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
