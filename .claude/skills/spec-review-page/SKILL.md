---
name: spec-review-page
description: Build a one-page reading companion for a Spec Kit spec folder (specs/NNN-<name>/) or a bug triage folder (.specify/bugs/NNN-<slug>/) so a reviewer can judge it without reading every Markdown file. Writes review.html into the spec folder with the change in one screen, what moved since the last read, two or three mechanism diagrams, a few worked examples, what breaks for consumers, a short list of things to check, and the source files embedded with line-cited claims. Use when asked to make a spec easier to review, to build or refresh the review page, or after a spec has been updated and needs re-reviewing. Invoke with an optional spec directory, for example "/spec-review-page specs/NNN-<name>".
allowed-tools: Read, Glob, Grep, Bash, Write
---

# Spec review page

One HTML page that lets a reviewer decide on a spec in about ten minutes. It condenses, it does not
duplicate. Nothing on the page asks the reviewer for input.

It works for both kinds of planning folder that the ticket workflow commits: a spec folder
`specs/NNN-<name>/` (spec flow) and a bug folder `.specify/bugs/NNN-<slug>/` (bug triage, with
`assessment.md`, `fix.md` and `test.md`). "Spec folder" below means either.

The page is a plain file, `review.html`, written into the spec folder next to the Markdown it
condenses. It opens from disk in any browser. It needs network access for the mermaid script and
the Google fonts, unless the browser has them cached. The template pins the mermaid version and carries its hash, so the browser
refuses a changed file. Without network the diagrams show as text, and the page uses system fonts.

## What the page must be

The reviewer's complaint that created this skill: reading spec, plan, research, data model,
contract, quickstart and tasks is too much to hold in one head. The page fixes that by answering, in
order: what is this, what changed since I last looked, how does it work, what does it look like in
practice, who does it break, what should I check. Everything else is collapsed until needed.

Rules that came from reviewer feedback. Do not relax them.

- **No review controls.** No dropdowns, checkboxes, note boxes, verdicts, progress counters or
  exports. The one input the template ships is the search box that filters the embedded source
  files in the appendix; it reads nothing from the reviewer and keeps no state.
- **Budget.** Sections 1 to 6 together stay under about 1800 words. At most three diagrams open on
  the page. At most five worked examples. At most ten things to check. If there is more, the page is
  becoming the problem it solves. Cut, or collapse into section 7.
- **Every claim carries a citation** to a source line, as a chip that jumps to the embedded file.
- **Diagrams show a mechanism**, not a list of boxes. What flows where, which edge is added or
  removed, what a request passes through. Prefer a before-and-after. Use mermaid in
  `<pre class="mermaid">`; the template's mermaid script renders it. Do not put `;` in diagram
  text: mermaid reads it as the end of a statement, and the diagram shows a syntax error.
- **Plain writing.** Simplified Technical English. Short sentences, one thought each, everyday words.
  Keep exact identifiers, metric names and codes as written.

## Step 1: Locate the spec and the previous page

1. If a spec directory was given, use it. Otherwise `git rev-parse --abbrev-ref HEAD`, take `<n>`
   from the branch `<type>/<n>-<slug>`, pad it to 3 digits (`printf '%03d' <n>`) and glob
   `specs/NNN-*` and `.specify/bugs/NNN-*` (no trailing `/`). If nothing matches, ask for the path. The ticket number `<n>` for step 4 is the
   folder's `NNN` without its leading zeros, because the folder carries the issue number. A folder
   with no number yet (`specs/<name>/`, before the issue exists) takes `<n>` from the branch; if
   there is none, ask. Before you read any file in it, check that no folder on the way to it, nor
   the folder, nor anything in it is a link. For `specs/NNN-<name>`:
   `find specs "<spec dir>" -maxdepth 0 -type l` and `find "<spec dir>" -type l` both print
   nothing; for `.specify/bugs/NNN-<slug>` the first command is
   `find .specify .specify/bugs "<spec dir>" -maxdepth 0 -type l`; for a folder elsewhere, list
   every folder on its path in the first command. Write the
   paths without a trailing `/`, or `find` follows a linked folder and prints nothing. A link can point at a file outside
   the folder, such as a `.env`, and reading it would put its text in the page. If it prints
   anything, stop and ask. The build refuses such a folder too, for every folder from the repo
   root down; folders above the repo root are not its to check.
2. Snapshot: `git log -1 --format='%h %ad' --date=short -- <spec dir>`. If the folder's Markdown has
   uncommitted changes (`git status --porcelain -- ':(icase)<spec dir>/*.md'` prints something), use
   the working tree, pass `--snapshot <hash>-wip` so the page says so, and say it
   again in the change section. The next refresh diffs from `<hash>`, so changes already shown
   from a working tree can appear as new once more; that is accepted. If the folder has no commit
   yet (the command prints nothing), use the repository `HEAD` hash with `-wip` and today's date
   for `--date`. The delta rule is one rule, used in steps 2, 3 and 4: the page gets a delta
   section only when a previous page exists **and** the spec Markdown has at least one commit;
   otherwise skip the diff and omit the section.
3. Previous page: if `<spec dir>/review.html` exists and carries this skill's marker comment in
   its head (the build checks the first 4000 characters; the template puts the marker right after
   the viewport meta), read the snapshot hash from its `spec-review-snapshot` meta tag. That hash is where "what moved
   since last time" starts. The build prints it too. A value such as `a1b2c3d-wip` came from a
   working-tree build: drop the `-wip` suffix before any git command and keep it only when you
   quote the previous page. If the file exists without the marker, someone else wrote it: stop and
   ask before touching it.

## Step 2: Read everything, then the code where the spec makes a claim about it

Read every Markdown file in the folder, including `contracts/` and `checklists/`. Do not skim.

Then verify against the code the claims a reviewer would most want checked: a statement that a path
does or does not do something today, a count of files or call sites, a version, a line the spec says
exists. Use Grep. A verified claim is stated on the page as verified. An unverifiable one is not
stated as fact.

When the delta rule of step 1 holds (a previous page exists and the Markdown has a commit), run
`git diff <hash> -- "<spec dir>" ':(exclude)<spec dir>/review.html'` with the `-wip` suffix
dropped, and read the commit messages since. For a `-wip` build, also list new Markdown files
with `git status --porcelain -- ':(icase)<spec dir>/*.md'` (any case, as the build reads them), because `git diff` does not show untracked
files. The generated page is left out of both because it is not spec content. That is the raw material for section 2. When the rule does not hold, there is no
section 2.

## Step 3: Write the content fragment

Write `content.html` to the scratchpad. It is a fragment: the `<section>` blocks only, no head, no
nav, no sources. `template.html` in this skill folder supplies everything around it, and its nav
lists the section ids below, so keep them.

Section order and content:

| id | Title | Holds |
| --- | --- | --- |
| `change` | The change | Problem in two sentences. Fix in one. What grew since the first draft, if anything. A stat strip: decisions, requirements, tasks, public changes, things that do not change. One short card per settled decision, named by its label in the spec (a heading, or a bold label such as `**Decision (read-only runs)**`), with one citation. |
| `delta` | What moved since you last read it | Only when the delta rule of step 1 holds. One table: then, now, citation. One line saying how many of the previous page's checks are resolved and which are still open. Otherwise omit the section and its nav entry. |
| `how` | How it works | Two or three mermaid diagrams, each with a caption that states the claim. A before-and-after of the defect if there is one. The mechanism that the decisions turn on. Further mechanisms go in `<details>` under this section, closed. |
| `examples` | Examples | At most five cards. Each names a concrete input, the expected outcome in one line, and why it matters in one or two sentences. Choose cases that changed the design or are easy to get wrong. Say that nothing was run. |
| `breaks` | What breaks for someone else | One table: who, what changes, where listed. Include the case where nothing changes if that is a guarantee the spec makes. Delivery order goes in a closed `<details>` here, one line per phase. |
| `check` | What to check before approving | Numbered list, at most ten. Each item is a contradiction between two files, a promise with no task behind it, a stale count, or a decision left to implementation. Bold first line, one or two sentences, citations to both sides. Mark items carried over from the previous page. Close with one sentence naming what the spec defers on purpose. |
| `lookup` | Look-ups | All in closed `<details>`: glossary of the words the spec leans on, rename tables, one line per requirement and success criterion with its id linking to its source line. |

**For a bug folder** the same sections and ids hold, filled from `assessment.md`, `fix.md` and
`test.md`. A folder that has no `fix.md` or `test.md` yet (an assessment before the fix) leaves
those parts out.

| id | Holds, for a bug folder |
| --- | --- |
| `change` | The symptom in two sentences ("Symptom"), the fix in one ("Summary" in `fix.md`). A stat strip: files changed, tests added, checks passed and failed ("Checks Performed"), deviations. One card each for the root cause ("Root Cause Hypothesis") and the remediation chosen. |
| `delta` | As above. |
| `how` | The defect as a before-and-after diagram of the code path ("Suspected Code Paths", "Root Cause Hypothesis"), and what the fix changes in it ("Changes"). |
| `examples` | The reproduction ("Reproduction") and the checks that prove the fix ("Tests Added or Updated", "Checks Performed"). |
| `breaks` | Who the fix affects ("Risks & Considerations"), and what stays the same. |
| `check` | Each deviation from the assessment ("Deviations from Assessment"), a check that failed, was skipped or is partial, an open question still open, a residual risk ("Residual Risks"), and the Constitution Check rows that need proof. |
| `lookup` | Glossary, and one line per changed file with its line in "Changes". |

Markup to use, all styled by the template: `.eyebrow`, `.stat` (one `div` per figure, the number
in `b`, the label and its citation in `span`), `.grid2` with `.card`, `.pill`
(`new`, `del`, `open`, `mod`, `p1`), `.callout`, `figure` with `pre.mermaid` and `figcaption`,
`.tbl` around `table`, `ol.checks`, `ol.phases`, `ul.req`, `ul.gloss`, `details` with a
`summary` and a `.body` div, and `.note`.

### Citations

Every chip is `<a class="cite" href="#<slug>-L<n>"><label></a>`. The slug is the file path,
lower-cased, every run of characters outside `a-z0-9` replaced by one hyphen, trimmed:
`spec.md` → `spec-md`, `contracts/companion-cli.md` → `contracts-companion-cli-md`,
`checklists/requirements.md` → `checklists-requirements-md`. The label is short and reads
`<file>:<line>`, as the template's legend says: `spec.md:142`, `companion-cli:9`, `checklist:11`,
`tasks:282`.

Cite the line where the claim starts, not the heading above it. The build step prints every cited
line so you can check each one landed. Fix any that did not before you hand the page over.

## Step 4: Build and check

```bash
uv run --no-project --python '>=3.9' python .claude/skills/spec-review-page/build.py "<spec dir>" "<scratchpad>/content.html" --ticket '#<n>' --title '<spec title>' --snapshot <hash> --date <yyyy-mm-dd>
```

Write each `'` in the title as `'\''`. Double quotes would run a backtick or `$(...)` in it.

The build writes `<spec dir>/review.html`. It overwrites only a file that carries its own marker, so
a page someone wrote by hand is never lost. It embeds every Markdown file with one anchored span per
line, substitutes the header fields, and then:

- fails if any citation points at an anchor that does not exist;
- refuses a spec folder that is a link or holds one (a symlink or a Windows junction), and an
  `--out` that is a link;
- prints every cited line, so each can be read against the claim it supports;
- prints the word count and the diagram count of the fragment outside `<details>`, so the budget
  can be checked.

The nav shows the "What moved" entry only when the fragment has a `delta` section. A `delta`
section with no previous page in the spec folder fails the build. To write somewhere else, pass
`--out <file>`; the previous page is still the spec folder's `review.html`.

## Step 5: Hand over

Tell the reviewer, in a few lines: the path of the page, what moved since the last page if there was
one, and which items in section 6 are new. Do not repeat the page. Whether `review.html` is committed
with the spec is the reviewer's call; do not commit it unasked.

## What not to do

- Do not write anything into the spec folder except `review.html`. The content fragment and any
  helper output stay in the scratchpad.
- Do not add a section the table above does not name. Fold it into `lookup` or drop it.
- Do not paraphrase a claim you have not read in the source. Read first, then cite.
- Do not present a finding about the code as fact without a Grep that shows it.
