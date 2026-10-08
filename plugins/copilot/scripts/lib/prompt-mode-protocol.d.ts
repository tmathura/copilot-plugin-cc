// Changed from upstream codex-plugin-cc (Apache-2.0): ported from app-server-protocol.d.ts. Copilot
// publishes no schema for its JSON events, so these types are written by hand. They hold only the
// events and fields the adapter reads; Copilot prints other events, which the adapter ignores.

export interface TurnStartEvent {
  type: "assistant.turn_start";
  data: { turnId: string };
}

export interface AssistantMessageEvent {
  type: "assistant.message";
  data: { content: string };
}

export interface AssistantReasoningEvent {
  type: "assistant.reasoning";
  data: { content: string };
}

export interface ToolExecutionStartEvent {
  type: "tool.execution_start";
  data: { toolCallId: string; toolName: string; arguments?: Record<string, unknown> };
}

export interface ToolExecutionCompleteEvent {
  type: "tool.execution_complete";
  data: { toolCallId: string; success: boolean; error?: { message?: string } };
}

export interface ResultEvent {
  type: "result";
  sessionId: string;
  exitCode: number;
  usage?: { codeChanges?: { filesModified?: string[] } };
}

export type PromptModeEvent =
  | TurnStartEvent
  | AssistantMessageEvent
  | AssistantReasoningEvent
  | ToolExecutionStartEvent
  | ToolExecutionCompleteEvent
  | ResultEvent;

export type PromptModeEventHandler = (event: PromptModeEvent) => void;

export interface CopilotPromptModeClientOptions {
  command: string;
  args: string[];
  prompt: string;
  env?: NodeJS.ProcessEnv;
  onEvent?: PromptModeEventHandler;
  resultGraceMs?: number;
  timeoutMs?: number;
  terminateImpl?: (pid: number) => Promise<unknown>;
}

export interface PromptModeExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error: Error | null;
}
