# Feature Specification: Copilot plugin port

**Feature Branch**: set by the ticket workflow for each ticket

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "Port OpenAI's codex-plugin-cc (Apache-2.0, baseline v1.0.6, commit
db52e28f4d9ded852ab3942cea316258ae4ef346) to a Claude Code plugin named "copilot" that lets Claude
hand code reviews and coding tasks to the GitHub Copilot CLI. The repo is also its own plugin
marketplace. Keep the port as close to upstream as possible. Features: review, adversarial-review,
rescue (--background, --write, --model), status, result, cancel, setup, the copilot-rescue subagent
and the optional Stop-hook review gate. Drop transfer. The first ticket chooses the Copilot transport
(ACP or `copilot -p ... --output-format json`) and maps every Codex call site to its Copilot match."

## Clarifications

### Session 2026-10-08

- Q: Which Copilot transport? → A: Prompt mode (`copilot --output-format json`, prompt on stdin).
  ACP was chosen first and then rejected, because a live check showed it runs the reviewed
  repository's hooks (research.md §2 and §6).
- Q: How are `--write` tasks confined? → A: Edit tools plus the shell, with Copilot's `--sandbox` on a
  best-effort basis (owner's decision). The User Story 3 test checks the requested edit and the
  write profile, not that nothing outside the repository changes. Rejected alternatives: edits only,
  with no shell; and refusing `--write` unless the sandbox is confirmed (research.md §3).

## User Scenarios & Testing *(mandatory)*

The user is a developer who works in Claude Code and has the GitHub Copilot CLI. The owner is the
person who keeps this port in step with upstream codex-plugin-cc.

### User Story 1 - Install the plugin and check setup (Priority: P1)

The user adds the marketplace, installs the plugin, and runs `/copilot:setup`. Setup says whether
the Copilot CLI is ready. If it is not ready, setup says what is wrong and what to do.

**Why this priority**: Nothing else works until the plugin is installed and Copilot is ready.

**Independent Test**: Install from the marketplace on a clean machine. Run `/copilot:setup` with no
CLI, with an old CLI, with no login, and when ready. Each case gives the correct message.

**Acceptance Scenarios**:

1. **Given** a machine with Claude Code, **When** the user runs
   `claude plugin marketplace add tmathura/copilot-plugin-cc` and
   `claude plugin install copilot@tmathura-copilot`, **Then** the `/copilot:*` commands are
   available, and later releases arrive as plugin updates.
2. **Given** no Copilot CLI, **When** the user runs `/copilot:setup`, **Then** setup says the CLI is
   missing and, if npm is available, offers to install it once.
3. **Given** a Copilot CLI older than the lowest supported version, **When** the user runs
   `/copilot:setup`, **Then** setup names the installed version, the lowest supported version, and
   how to update.
4. **Given** a Copilot CLI with no login, **When** the user runs `/copilot:setup`, **Then** setup
   tells the user to run `copilot` and then `/login`.
5. **Given** a ready CLI, **When** the user runs `/copilot:setup --enable-review-gate` or
   `--disable-review-gate`, **Then** setup turns the review gate on or off for this repository and
   reports the new state.

---

### User Story 2 - Review local changes with Copilot (Priority: P1)

The user runs `/copilot:review` or `/copilot:adversarial-review` on the current repository. Copilot
reviews the working tree or the branch against a base. Claude shows the review exactly as Copilot
gave it. Copilot cannot change any file in the repository or any remote during the review.

**Why this priority**: Code review is the main reason to use the plugin.

**Independent Test**: In a test repository with changes, run both review commands in the
foreground and in the background. Check that the output matches the review format, and that the
repository and its remotes are byte-for-byte the same after the review.

**Acceptance Scenarios**:

1. **Given** uncommitted changes, **When** the user runs `/copilot:review --wait`, **Then** Claude
   shows Copilot's review of the working tree without changes or comments of its own.
2. **Given** a branch with commits, **When** the user runs
   `/copilot:review --base main --scope branch`, **Then** Copilot reviews the branch diff against
   `main`.
3. **Given** no `--wait` or `--background`, **When** the user runs a review command, **Then** Claude
   estimates the review size and asks once whether to wait or run in the background, as upstream
   does.
4. **Given** focus text, **When** the user runs `/copilot:adversarial-review <focus>`, **Then** the
   review questions the design and the assumptions, with that focus.
5. **Given** any review, **When** Copilot tries to write a file, run a command that changes the
   repository, or push, **Then** the Copilot CLI blocks it.
6. **Given** a Copilot CLI that cannot be held to read-only mode, **When** the user starts a
   review, **Then** the review refuses to run and says why.

---

### User Story 3 - Hand a task to Copilot (Priority: P2)

The user runs `/copilot:rescue <task>`, or Claude uses the `copilot-rescue` subagent on its own. The
task runs in Copilot in the foreground or in the background. It is read-only unless `--write` is
given. The user can choose a model with `--model`.

**Why this priority**: Delegating work is the second main use, after review.

**Independent Test**: Run a read-only task and a `--write` task in a test repository. Check that the
read-only task changes nothing, and that the write task makes the requested edit in the repository
and runs with the write profile, including `--sandbox` (research.md §3). Where the host cannot run
Copilot's sandbox, shell commands are not confined; the README says so.

**Acceptance Scenarios**:

1. **Given** a task with no `--write`, **When** it runs, **Then** Copilot can read the repository
   but cannot change it.
2. **Given** `--write`, **When** the task runs, **Then** Copilot can edit files in the repository
   with the fewest permissions that do the job.
3. **Given** `--model <name>`, **When** the task runs, **Then** Copilot uses that model.
4. **Given** `--background`, **When** the user starts a task, **Then** Claude returns at once and
   tells the user to check `/copilot:status`.
5. **Given** an earlier task in this Claude session, **When** the user asks to continue it, **Then**
   the plugin offers to continue the earlier Copilot session or start a new one, as upstream does,
   if Copilot can resume sessions.

---

### User Story 4 - Track background jobs (Priority: P2)

The user runs `/copilot:status`, `/copilot:result` and `/copilot:cancel` to follow, read and stop
background reviews and tasks in this repository.

**Why this priority**: Background work is useless if the user cannot see or stop it.

**Independent Test**: Start a background task. Check its status while it runs, read its result when
it ends, and cancel a second task while it runs.

**Acceptance Scenarios**:

1. **Given** running and finished jobs, **When** the user runs `/copilot:status`, **Then** Claude
   shows one compact table with job id, kind, status, phase, time and summary.
2. **Given** a job id, **When** the user runs `/copilot:status <id>`, **Then** Claude shows the full
   job report.
3. **Given** a finished job, **When** the user runs `/copilot:result [id]`, **Then** Claude shows the
   full stored output.
4. **Given** a running job, **When** the user runs `/copilot:cancel [id]`, **Then** the Copilot
   process and its child processes stop, and the job shows as cancelled.

---

### User Story 5 - Review gate before Claude stops (Priority: P3)

When the review gate is on, Copilot reviews Claude's last turn before Claude stops. If Copilot finds
a problem, Claude must keep working. If not, Claude stops.

**Why this priority**: It is optional and off by default.

**Independent Test**: Turn the gate on. End a turn that leaves a clear bug, and end a turn that
leaves clean work. The first is blocked, the second is not.

**Acceptance Scenarios**:

1. **Given** the gate is off, **When** Claude stops, **Then** nothing runs.
2. **Given** the gate is on and Copilot finds a problem, **When** Claude stops, **Then** the stop is
   blocked and Claude gets the reason.
3. **Given** the gate is on and Copilot finds nothing, **When** Claude stops, **Then** Claude stops.
4. **Given** the gate is on, **When** the review runs, **Then** it is read-only, as in User Story 2.

---

### User Story 6 - Follow upstream releases (Priority: P3)

The owner reads a new upstream release and finds where each change goes in this port.

**Why this priority**: It keeps the port useful over time, but users do not see it.

**Independent Test**: Take one upstream file. Find the file with the same name in this port. Find
the matching function names in it.

**Acceptance Scenarios**:

1. **Given** an upstream change to a file, **When** the owner looks for it here, **Then** the same
   file path exists, with `codex` changed to `copilot`.
2. **Given** an upstream call to Codex, **When** the owner looks at the call-site map, **Then** the
   map gives the Copilot match or says why there is none.
3. **Given** a behaviour that differs from upstream, **When** the owner reads the README, **Then**
   the section "Differences from the Codex plugin" lists it with its reason.

### Edge Cases

- The Copilot CLI is missing, too old, or not logged in when a command other than setup runs. The
  command stops and points to `/copilot:setup`.
- Copilot writes broken or cut-off output. The plugin reports a parse error with the most useful
  error lines, and does not guess.
- Copilot exits with a non-zero code. The plugin reports the failure and stops.
- A run keeps going for a long time. Like upstream, there is no general deadline: the user cancels
  it, and the review gate stops after 14 minutes (840 s). A process that sends its final event but does not
  exit is killed after a short grace period.
- The user cancels a job whose process has already ended. Cancel reports the true state.
- There is nothing to review. The command says so only when the chosen scope is really empty,
  including untracked files.
- Arguments contain spaces, quotes or shell characters. They reach Copilot unchanged, and no shell
  reads them.
- The repository path contains spaces, on any of the three operating systems.
- Two Claude sessions run jobs in the same repository. Each job keeps its own state.
- The user asks for `--write` on a review. Reviews stay read-only.

## Requirements *(mandatory)*

### Functional Requirements

**Distribution and licensing**

- **FR-001**: The repository MUST be a Claude Code plugin marketplace named `tmathura-copilot` that
  offers one plugin named `copilot`.
- **FR-002**: The repository MUST ship the Apache-2.0 `LICENSE`, the applicable upstream `NOTICE`
  text, and a notice in each changed upstream file that says it was changed.
- **FR-003**: The package, plugin and marketplace versions MUST match, and a check MUST enforce it.
  The first release is version 1.0.0.

**Upstream parity**

- **FR-004**: The plugin MUST keep the upstream layout, file names and command, agent, skill and
  hook names, with `codex` changed to `copilot`.
- **FR-005**: Each command MUST accept the upstream arguments and flags and print the upstream output
  shape, except where Copilot cannot do the same thing.
- **FR-006**: Every difference from upstream MUST be listed with its reason in the README section
  "Differences from the Codex plugin".
- **FR-007**: The plugin MUST NOT have a `transfer` command.
- **FR-008**: The repository MUST record the upstream commit that was last checked, and the status of
  each upstream change since then.

**Transport decision and call-site map (ticket 1)**

- **FR-009**: Before any plugin code exists, the repository MUST hold a written transport decision.
  It compares ACP with prompt mode (`copilot --output-format json`, prompt on stdin) on permission
  control, streaming, cancel, sessions, Windows
  support and CLI version support first, and on closeness to upstream second. It uses the official
  Copilot CLI docs, reads the named community ports for ideas only, and includes any other Claude
  Code to Copilot CLI plugin with more than 20 stars and a push in the last three months.
- **FR-010**: The repository MUST hold a call-site map that lists every place in upstream v1.0.6
  that calls Codex, with its Copilot match or the reason there is none.
- **FR-011**: The owner MUST choose the transport. The plan records the choice.

**Setup**

- **FR-012**: `/copilot:setup` MUST report a clear error, with the next step, when the CLI is
  missing, its version is not supported, or the user is not logged in.
- **FR-013**: `/copilot:setup` MUST offer to install the CLI once when it is missing and npm is
  available.
- **FR-014**: `/copilot:setup` MUST turn the review gate on and off.
- **FR-015**: The supported Copilot CLI versions MUST be documented.

**Reviews**

- **FR-016**: `/copilot:review` and `/copilot:adversarial-review` MUST support working-tree and
  branch scope, `--base <ref>`, `--wait` and `--background`, as upstream does.
  `/copilot:adversarial-review` MUST also accept focus text.
- **FR-017**: Reviews and the review gate MUST NOT change the target repository or any remote. The
  Copilot CLI's own permission controls MUST enforce this, not words in the prompt.
- **FR-018**: A review MUST refuse to run if it cannot run read-only.
- **FR-019**: Adversarial review results MUST follow the upstream review output schema. The native
  review returns free text, as upstream does. For both review commands, Claude MUST show the result
  without changes and MUST NOT fix anything without the user's choice.

**Tasks and jobs**

- **FR-020**: `/copilot:rescue` and the `copilot-rescue` subagent MUST run a task read-only unless
  `--write` is given. `--write` MUST give the fewest Copilot permissions that do the job.
- **FR-021**: Tasks MUST support `--background` and `--model`.
- **FR-022**: Tasks MUST support continuing an earlier session (`--resume`, `--fresh`) and reasoning
  effort (`--effort`) where the Copilot CLI supports them. Where it does not, the difference MUST be
  listed under FR-006.
- **FR-023**: `/copilot:status`, `/copilot:result` and `/copilot:cancel` MUST show, return and stop
  background jobs for the current repository, as upstream does.
- **FR-024**: Cancel MUST stop the Copilot process and its child processes.

**Review gate and session hooks**

- **FR-025**: The plugin MUST offer an optional Stop-hook review gate, off by default, that blocks a
  stop only when Copilot finds a problem.
- **FR-026**: The plugin MUST have session start and end hooks that do the same job as upstream.

**Safety and platform**

- **FR-027**: The plugin MUST start child processes without a shell, on every operating system.
- **FR-028**: The plugin MUST NOT store tokens or other credentials in the repository, job files or
  logs. Login stays with the Copilot CLI.
- **FR-029**: The plugin MUST work the same on macOS, Linux and Windows, with Node 22 or later and no
  runtime npm dependencies.
- **FR-030**: The plugin MUST NOT run Copilot with all tools allowed outside a throwaway test
  repository unless the owner approves.

**Prompting guidance**

- **FR-031**: The upstream `gpt-5-4-prompting` skill and its references MUST be ported with the same
  name, with `Codex` changed to `Copilot`. The rescue subagent uses it only to shape its prompt, as
  upstream does.

**Testing**

- **FR-032**: Automated tests MUST run with no network and no real login, using a fake Copilot CLI.
  They MUST cover the failure paths in the constitution, Principle VI.
- **FR-033**: Before the first release, a person MUST run the plugin on a real git repository: a
  review, a background task with status and result, cancel, and the review gate.

### Key Entities

- **Job**: one review or task run. It has an id, kind, status, phase, start and end time, summary,
  the Copilot session id when there is one, the process id while running, and the stored result.
- **Repository state**: per-repository plugin settings, such as whether the review gate is on, and
  the list of jobs.
- **Review result**: the verdict, summary, findings with file and line, and next steps, in the
  upstream schema.
- **Transport decision**: the comparison, the chosen transport, the reasons, and the lowest
  supported Copilot CLI version.
- **Call-site map entry**: an upstream file and place, what it asks Codex to do, the Copilot match,
  and the ticket that ports it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user goes from no plugin to a first review result in under 10 minutes, with only
  the documented install and login steps.
- **SC-002**: In 100% of test runs, reviews and the review gate leave the target repository and its
  remotes unchanged.
- **SC-003**: Every one of the 7 commands, the subagent and the review gate passes the manual
  release run on macOS, Linux or Windows, and the automated tests pass on all three.
- **SC-004**: Every upstream file in v1.0.6 has a matching file here, or a line in "Differences from
  the Codex plugin" that says why not.
- **SC-005**: For a new upstream release, the owner can place each changed upstream file in this
  port in under 1 minute per file.
- **SC-006**: Every setup failure (no CLI, old CLI, no login) gives a message that names the next
  step, in 100% of test runs.
- **SC-007**: Cancel stops a running job and all its child processes within 10 seconds.

## Assumptions

- The user has Node 22 or later and a GitHub account with Copilot access.
- The owner reads every upstream file line by line before it is ported. Code from other Copilot
  ports is never copied.
- Upstream behaviour that Copilot supports (session resume, reasoning effort, `task-resume-candidate`)
  is in scope even though the request named only `--background`, `--write` and `--model`, because
  the constitution asks for parity wherever Copilot supports it.
- The `spark` model alias is upstream-specific. A Copilot alias is added only if Copilot has a clear
  match.
- The lowest supported Copilot CLI version is set in the transport decision, from the features the
  chosen transport needs. It is not lower than the version tested here (1.0.93 at the time of
  writing).
- The work is split into 8 tickets: transport and call-site map; base layout and test setup; shared
  runtime modules; Copilot adapter and setup; review commands; rescue and background jobs; review
  gate and session hooks; first release.
