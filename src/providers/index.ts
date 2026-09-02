import type {
  ChatChunk,
  HealthStatus,
  Message,
  ProviderConfig,
  ToolDef,
} from "../types.js";

export type { ProviderConfig };

export interface Provider {
  readonly name: string;
  readonly config: ProviderConfig;
  listModels(): Promise<string[]>;
  chat(
    messages: Message[],
    tools: ToolDef[],
    opts?: { signal?: AbortSignal; temperature?: number; maxTokens?: number }
  ): AsyncIterable<ChatChunk>;
  health(): Promise<Omit<HealthStatus, "provider">>;
  countTokens?(text: string): Promise<number>;
}

export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = opts.signal
    ? AbortSignal.any([controller.signal, opts.signal])
    : controller.signal;
  try {
    const res = await fetch(url, { ...opts, signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function createProvider(config: ProviderConfig): Promise<Provider> {
  switch (config.type) {
    case "ollama": {
      const { OllamaProvider } = await import("./ollama.js");
      return new OllamaProvider(config);
    }
    case "openrouter": {
      const { OpenRouterProvider } = await import("./openrouter.js");
      return new OpenRouterProvider(config);
    }
    case "openai-compatible": {
      const { OpenAICompatProvider } = await import("./openai-compat.js");
      return new OpenAICompatProvider(config);
    }
    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}
