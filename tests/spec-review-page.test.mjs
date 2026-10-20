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

function build({ dir, spec }, content, extra = ["--no-delta"], snapshot = "abc1234") {
  const fragment = path.join(dir, "content.html");
  fs.writeFileSync(fragment, content, "utf8");
  return run(PYTHON, [
    BUILD, spec, fragment,
    "--ticket", "#105", "--title", TITLE, "--snapshot", snapshot, "--date", "2026-10-20", ...extra
  ]);
}

const SPEC_MD = "# Spec\n\nCafé — the first claim.\n";
const GOOD = '<section id="change"><p>Café — claim <a class="cite" href="#spec-md-L3">spec.md:3</a></p></section>';

test("a Python is on the PATH in CI", { skip: !process.env.CI }, () => {
  assert.ok(PYTHON, "CI must run the spec-review-page build tests");
});

test("the build writes a page with every citation found and the text unchanged", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  const result = build(ctx, GOOD);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /missing anchors: 0/);
  const page = fs.readFileSync(ctx.page, "utf8");
  assert.match(page, /<meta name="spec-review-snapshot" content="abc1234">/);
  assert.ok(page.includes("Revue de la spec — été"));
  assert.ok(page.includes('<span id="spec-md-L3">Café — the first claim.</span>'));
});

test("a refresh reads the previous page's snapshot and adds the What moved entry", { skip }, () => {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  const first = build(ctx, GOOD);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(!fs.readFileSync(ctx.page, "utf8").includes('href="#delta"'), "--no-delta drops the entry");
  const result = build(ctx, GOOD, [], "def5678");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /previous page snapshot: abc1234/);
  const page = fs.readFileSync(ctx.page, "utf8");
  assert.match(page, /<meta name="spec-review-snapshot" content="def5678">/);
  assert.ok(page.includes('href="#delta"'));
});

for (const [name, target] of [
  ["a line past the end", "spec-md-L99"],
  ["line zero", "spec-md-L0"],
  ["a file that does not exist", "plan-md-L1"],
  ["a malformed target", "spec_md-L3"],
  ["a zero-padded line number", "spec-md-L03"]
]) {
  test(`a citation to ${name} fails and keeps the previous page`, { skip }, () => {
    const ctx = makeSpec({ "spec.md": SPEC_MD });
    assert.equal(build(ctx, GOOD).status, 0);
    const before = fs.readFileSync(ctx.page, "utf8");
    const result = build(ctx, GOOD.replace("#spec-md-L3", `#${target}`));
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(`MISSING ${target}`), result.stdout);
    assert.match(result.stderr, /not written: fix the missing anchors first/);
    assert.equal(fs.readFileSync(ctx.page, "utf8"), before);
  });
}

function generatedPage() {
  const ctx = makeSpec({ "spec.md": SPEC_MD });
  assert.equal(build(ctx, GOOD).status, 0);
  return fs.readFileSync(ctx.page, "utf8");
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
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.equal(fs.readFileSync(ctx.page, "utf8"), before);
  });
}
