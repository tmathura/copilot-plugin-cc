// Changed from upstream codex-plugin-cc (Apache-2.0): renamed for the copilot plugin; no transfer, no
// spark and no README checks yet; the review commands' git commands must write no index and start no
// repository programs, and rescue keeps a continued task in its mode.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "copilot");
const SAFE_GIT = "git --no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false ";

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

test("review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Copilot's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /review "\$ARGUMENTS"/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/copilot-companion\.mjs" review "\$ARGUMENTS"`/);
  assert.match(source, /description:\s*"Copilot review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /status --short --untracked-files=all/);
  assert.match(source, /diff --shortstat/);
  assert.match(source, /Treat untracked files or directories as reviewable work/i);
  assert.match(source, /Recommend waiting only when the review is clearly tiny, roughly 1-2 files total/i);
  assert.match(source, /In every other case, including unclear size, recommend background/i);
  assert.match(source, /The companion script parses `--wait` and `--background`/i);
  assert.match(source, /Claude Code's `Bash\(..., run_in_background: true\)` is what actually detaches the run/i);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /does not support staged-only review, unstaged-only review, or extra focus text/i);
});

test("adversarial review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/adversarial-review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Copilot's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /adversarial-review "\$ARGUMENTS"/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\] \[focus \.\.\.\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/copilot-companion\.mjs" adversarial-review "\$ARGUMENTS"`/);
  assert.match(source, /description:\s*"Copilot adversarial review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /status --short --untracked-files=all/);
  assert.match(source, /diff --shortstat/);
  assert.match(source, /Treat untracked files or directories as reviewable work/i);
  assert.match(source, /Recommend waiting only when the scoped review is clearly tiny, roughly 1-2 files total/i);
  assert.match(source, /In every other case, including unclear size, recommend background/i);
  assert.match(source, /The companion script parses `--wait` and `--background`/i);
  assert.match(source, /Claude Code's `Bash\(..., run_in_background: true\)` is what actually detaches the run/i);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /uses the same review target selection as `\/copilot:review`/i);
  assert.match(source, /supports working-tree review, branch review, and `--base <ref>`/i);
  assert.match(source, /does not support `--scope staged` or `--scope unstaged`/i);
  assert.match(source, /can still take extra focus text after the flags/i);
});

test("the review size estimates write no index and start no repository programs", () => {
  for (const file of ["commands/review.md", "commands/adversarial-review.md"]) {
    const commands = [...read(file).matchAll(/`(git [^`]*)`/g)].map((match) => match[1]);
    assert.equal(commands.length, 4, file);
    for (const command of commands) {
      assert.ok(command.startsWith(SAFE_GIT), `${file}: ${command}`);
      if (command.startsWith(`${SAFE_GIT}diff `)) {
        assert.match(command, / --no-textconv\b/, `${file}: ${command}`);
      }
    }
  }
});

test("continue is not exposed as a user-facing command", () => {
  const commandFiles = fs.readdirSync(path.join(PLUGIN_ROOT, "commands")).sort();
  assert.deepEqual(commandFiles, [
    "adversarial-review.md",
    "cancel.md",
    "rescue.md",
    "result.md",
    "review.md",
    "setup.md",
    "status.md"
  ]);
});

test("rescue command absorbs continue semantics", () => {
  const rescue = read("commands/rescue.md");
  const agent = read("agents/copilot-rescue.md");
  const runtimeSkill = read("skills/copilot-cli-runtime/SKILL.md");

  assert.match(rescue, /The final user-visible response must be Copilot's output verbatim/i);
  assert.match(rescue, /allowed-tools:\s*Bash\(node:\*\),\s*AskUserQuestion,\s*Agent/);
  // An upstream regression: the command must name the subagent transport and run inline, or a
  // forked subagent without the Agent tool falls back to Skill and re-enters this command.
  assert.match(rescue, /subagent_type: "copilot:copilot-rescue"/);
  assert.match(rescue, /do not call `Skill\(copilot:copilot-rescue\)`/i);
  assert.doesNotMatch(rescue, /^context:\s*fork\b/m);
  assert.match(rescue, /--background\|--wait/);
  assert.match(rescue, /--resume\|--fresh/);
  assert.match(rescue, /--model <model>\]/);
  assert.match(rescue, /--effort <none\|minimal\|low\|medium\|high\|xhigh>/);
  assert.match(rescue, /task-resume-candidate --json/);
  assert.match(rescue, /AskUserQuestion/);
  assert.match(rescue, /Continue current Copilot thread/);
  assert.match(rescue, /Start a new Copilot thread/);
  assert.match(rescue, /run the `copilot:copilot-rescue` subagent in the background/i);
  assert.match(rescue, /default to foreground/i);
  assert.match(rescue, /Do not forward them to `task`/i);
  assert.match(rescue, /`--model` and `--effort` are runtime-selection flags/i);
  assert.match(rescue, /Leave `--effort` unset unless the user explicitly asks for a specific reasoning effort/i);
  assert.match(rescue, /If the request includes `--resume`, do not ask whether to continue/i);
  assert.match(rescue, /If the request includes `--fresh`, do not ask whether to continue/i);
  assert.match(rescue, /If the user chooses continue, add `--resume`/i);
  assert.match(rescue, /Still run the helper below, only to read the mode of the task that continues/i);
  assert.match(rescue, /tell the subagent the mode of that task from the helper's `candidate\.write`/i);
  assert.match(rescue, /If the user chooses a new thread, add `--fresh`/i);
  assert.match(rescue, /thin forwarder only/i);
  assert.match(rescue, /Return the Copilot companion stdout verbatim to the user/i);
  assert.match(rescue, /Do not paraphrase, summarize, rewrite, or add commentary before or after it/i);
  assert.match(rescue, /return that command's stdout as-is/i);
  assert.match(rescue, /Leave `--resume` and `--fresh` in the forwarded request/i);
  assert.match(agent, /--resume/);
  assert.match(agent, /--fresh/);
  assert.match(agent, /thin forwarding wrapper/i);
  assert.match(agent, /prefer foreground for a small, clearly bounded rescue request/i);
  assert.match(agent, /If the user did not explicitly choose `--background` or `--wait` and the task looks complicated, open-ended, multi-step, or likely to keep Copilot running for a long time, prefer background execution/i);
  assert.match(agent, /Use exactly one `Bash` call/i);
  assert.match(agent, /Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own/i);
  assert.match(agent, /Do not call `review`, `adversarial-review`, `status`, `result`, or `cancel`/i);
  assert.match(agent, /Leave `--effort` unset unless the user explicitly requests a specific reasoning effort/i);
  assert.match(agent, /Leave model unset by default/i);
  assert.match(agent, /If the user asks for a concrete model name such as `gpt-5\.4-mini`, pass it through with `--model`/i);
  assert.match(agent, /If the request says that the continued task is read-only, do not add `--write`\. If it says that the continued task is a `--write` task, add `--write`/i);
  assert.match(agent, /Return the stdout of the `copilot-companion` command exactly as-is/i);
  assert.match(agent, /If the Bash call fails or Copilot cannot be invoked, return nothing/i);
  assert.match(agent, /gpt-5-4-prompting/);
  assert.match(agent, /only to tighten the user's request into a better Copilot prompt/i);
  assert.match(agent, /Do not use that skill to inspect the repository, reason through the problem yourself, draft a solution, or do any independent work/i);
  assert.match(runtimeSkill, /only job is to invoke `task` once and return that stdout unchanged/i);
  assert.match(runtimeSkill, /Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel`/i);
  assert.match(runtimeSkill, /use the `gpt-5-4-prompting` skill to rewrite the user's request into a tighter Copilot prompt/i);
  assert.match(runtimeSkill, /That prompt drafting is the only Claude-side work allowed/i);
  assert.match(runtimeSkill, /Leave `--effort` unset unless the user explicitly requests a specific effort/i);
  assert.match(runtimeSkill, /Leave model unset by default/i);
  assert.match(runtimeSkill, /If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only/i);
  assert.match(runtimeSkill, /Strip it before calling `task`/i);
  assert.match(runtimeSkill, /`--effort`: accepted values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`/i);
  assert.match(runtimeSkill, /Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own/i);
  assert.match(runtimeSkill, /If the Bash call fails or Copilot cannot be invoked, return nothing/i);
  for (const source of [rescue, agent, runtimeSkill]) {
    assert.doesNotMatch(source, /spark/i);
  }
});

test("status, result, and cancel commands are exposed as deterministic runtime entrypoints", () => {
  for (const name of ["status", "result", "cancel"]) {
    const source = read(`commands/${name}.md`);
    assert.match(source, /disable-model-invocation:\s*true/, name);
    assert.match(source, new RegExp(`copilot-companion\\.mjs" ${name} "\\$ARGUMENTS"`), name);
  }
});

test("internal docs use task terminology for rescue runs", () => {
  const runtimeSkill = read("skills/copilot-cli-runtime/SKILL.md");
  const promptingSkill = read("skills/gpt-5-4-prompting/SKILL.md");
  const promptRecipes = read("skills/gpt-5-4-prompting/references/copilot-prompt-recipes.md");

  assert.match(runtimeSkill, /copilot-companion\.mjs" task "<raw arguments>"/);
  assert.match(runtimeSkill, /Use `task` for every rescue request/i);
  assert.match(runtimeSkill, /task --resume-last/i);
  assert.match(promptingSkill, /Use `task` when the task is diagnosis/i);
  assert.match(promptRecipes, /Copilot task prompts/i);
  assert.match(promptRecipes, /Use these as starting templates for Copilot task prompts/i);
  assert.match(promptRecipes, /## Diagnosis/);
  assert.match(promptRecipes, /## Narrow Fix/);
});

test("the result handling skill keeps Copilot failures from becoming Claude-side work", () => {
  const resultHandling = read("skills/copilot-result-handling/SKILL.md");

  assert.match(resultHandling, /do not turn a failed or incomplete Copilot run into a Claude-side implementation attempt/i);
  assert.match(resultHandling, /if Copilot was never successfully invoked, do not generate a substitute answer at all/i);
});
