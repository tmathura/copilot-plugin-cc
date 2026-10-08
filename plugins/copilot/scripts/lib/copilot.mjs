// Changed from upstream codex-plugin-cc (Apache-2.0): ported from codex.mjs for the Copilot CLI.
// Each run starts its own Copilot process, so there is never a shared runtime.
export function getSessionRuntimeStatus() {
  return {
    mode: "direct",
    label: "direct startup",
    detail: "Each review or task command starts its own Copilot process.",
    endpoint: null
  };
}
