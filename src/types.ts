export type Role = "system" | "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImageUrlPart {
  type: "image_url";
  image_url: { url: string } | string;
}

export type ContentPart = TextPart | ImageUrlPart;

export interface Message {
  role: Role;
  content: string | ContentPart[];
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

/** Extract a plain-text representation of a message's content. */
export function messageText(m: Message): string {
  if (typeof m.content === "string") return m.content;
  return m.content
    .map((p) => (p.type === "text" ? p.text : "[image]"))
    .join("");
}