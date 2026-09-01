export type Role = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: Role;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON schema
}

export interface ChatChunk {
  type: "text" | "tool_call" | "done" | "error";
  text?: string;
  tool_call?: ToolCall;
  error?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface ProviderConfig {
  name: string;
  type: "ollama" | "openrouter" | "openai-compatible";
  baseURL: string;
  apiKey?: string;
  models: string[];
  priority: number; // lower = preferred
  enabled: boolean;
  maxRetries: number;
  timeoutMs: number;
}

export interface HealthStatus {
  provider: string;
  healthy: boolean;
  failures: number;
  lastCheck: number;
  lastError?: string;
  circuitOpen: boolean; // circuit breaker open = do not try
  cooldownUntil: number;
}

export interface RouteDecision {
  provider: string;
  model: string;
  reason: string;
}
