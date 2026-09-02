import { fetchWithTimeout } from "./index.js";
import type { ChatChunk, HealthStatus, Message, ProviderConfig, ToolDef } from "../types.js";
import { Provider } from "./index.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

export class OllamaProvider implements Provider {
  readonly name: string;
  readonly config: ProviderConfig;
  private resolvedModel?: string;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.config = config;
  }

  private get base(): string {
    return this.config.baseURL.replace(/\/$/, "");
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetchWithTimeout(`${this.base}/api/tags`, {}, this.config.timeoutMs);
      if (!res.ok) return [];
      const data = (await res.json()) as any;
      return (data?.models ?? []).map((m: any) => m.name).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Query /api/tags and return the installed models together with their
   * Ollama-reported capabilities (e.g. ["completion","tools","vision"]).
   */
  async listModelsWithCapabilities(): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    try {
      const res = await fetchWithTimeout(`${this.base}/api/tags`, {}, this.config.timeoutMs);
      if (!res.ok) return out;
      const data = (await res.json()) as any;
      for (const m of data?.models ?? []) {
        const name = m?.name;
        if (!name) continue;
        const caps = Array.isArray(m?.capabilities) ? m.capabilities.map(String) : [];
        out.set(name, caps);
      }
    } catch {
      // ignore
    }
    return out;
  }

  /**
   * Resolve the actual model to use for a request.
   *
   * 1. If the configured model (config.models[0]) is installed locally, use it.
   * 2. Otherwise fall back to the first installed model that supports tools
   *    (its capabilities include "tools") — this is what lets the agent call
   *    tools without failing over to cloud providers.
   * 3. If no installed model supports tools, fall back to the first installed
   *    model, else a sane default.
   *
   * The result is cached so /api/tags is only hit once per provider instance.
   */
  async resolveModel(): Promise<string> {
    if (this.resolvedModel) return this.resolvedModel;
    const configured = this.config.models[0];
    const withCaps = await this.listModelsWithCapabilities();
    const installed = Array.from(withCaps.keys());

    let chosen: string;
    if (configured && installed.includes(configured)) {
      chosen = configured;
    } else {
      // Prefer a tool-capable installed model so the agent can call tools.
      const toolCapable = installed.find((n) => (withCaps.get(n) ?? []).includes("tools"));
      chosen = toolCapable ?? installed[0] ?? configured ?? "aether";
    }
    this.resolvedModel = chosen;
    return chosen;
  }

  async health(): Promise<Omit<HealthStatus, "provider">> {
    const start = Date.now();
    try {
      const res = await fetchWithTimeout(`${this.base}/api/version`, {}, 5000);
      if (!res.ok) {
        return { healthy: false, failures: 0, lastCheck: start, lastError: `HTTP ${res.status}`, circuitOpen: false, cooldownUntil: 0 };
      }
      return { healthy: true, failures: 0, lastCheck: start, circuitOpen: false, cooldownUntil: 0 };
    } catch (err) {
      return { healthy: false, failures: 0, lastCheck: start, lastError: (err as Error).message, circuitOpen: false, cooldownUntil: 0 };
    }
  }

  async countTokens(text: string): Promise<number> {
    try {
      const res = await fetchWithTimeout(
        `${this.base}/api/count`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
        5000
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        if (typeof data?.count === "number") return data.count;
      }
    } catch {
      // fall back to estimation
    }
    return estimateTokens(text);
  }

  async *chat(
    messages: Message[],
    tools: ToolDef[],
    opts?: { signal?: AbortSignal; temperature?: number; maxTokens?: number }
  ): AsyncIterable<ChatChunk> {
    // Auto-detect the real installed model at runtime; fall back gracefully.
    const model = await this.resolveModel();
    const body: any = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name ? { name: m.name } : {}),
        // Ollama vision: top-level `images` array of base64 strings on a message.
        ...(Array.isArray((m as any).images) && (m as any).images.length > 0
          ? { images: (m as any).images }
          : {}),
      })),
      stream: true,
      options: {
        temperature: opts?.temperature ?? 0.7,
        num_ctx: 4096,
      },
    };
    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (opts?.maxTokens) {
      body.options.num_predict = opts.maxTokens;
    }

    const res = await fetchWithTimeout(
      `${this.base}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts?.signal,
      },
      this.config.timeoutMs
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama chat failed: HTTP ${res.status} ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("Ollama chat: no response body");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) {
          const obj = JSON.parse(line);
          if (obj?.message?.content) {
            yield { type: "text", text: obj.message.content };
          }
          if (Array.isArray(obj?.message?.tool_calls)) {
            for (const tc of obj.message.tool_calls) {
              yield {
                type: "tool_call",
                tool_call: {
                  id: tc.id || `call_${Date.now()}`,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments ?? "",
                  },
                },
              };
            }
          }
          if (typeof obj?.prompt_eval_count === "number") inputTokens = obj.prompt_eval_count;
          if (typeof obj?.eval_count === "number") outputTokens = obj.eval_count;
          if (obj?.done) {
            yield {
              type: "done",
              usage: { input_tokens: inputTokens, output_tokens: outputTokens },
            };
          }
        }
        idx = buffer.indexOf("\n");
      }
    }
  }
}