import { fetchWithTimeout } from "./index.js";
import type { ChatChunk, HealthStatus, Message, ProviderConfig, ToolCall, ToolDef } from "../types.js";
import { Provider } from "./index.js";

const FREE_MARKERS = ["/free", "free-", "-free", "zero", "lite", "nemo"];

function isFree(id: string): boolean {
  const lower = id.toLowerCase();
  return FREE_MARKERS.some((m) => lower.includes(m));
}

export class OpenRouterProvider implements Provider {
  readonly name: string;
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.config = config;
  }

  private get base(): string {
    return this.config.baseURL.replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiKey) {
      h.Authorization = `Bearer ${this.config.apiKey}`;
    }
    h["HTTP-Referer"] = "https://github.com/kilocode/aether";
    h["X-Title"] = "aether";
    return h;
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetchWithTimeout(`${this.base}/models`, { headers: this.headers() }, this.config.timeoutMs);
      if (!res.ok) return [];
      const data = (await res.json()) as any;
      const all: string[] = (data?.data ?? []).map((m: any) => m.id).filter(Boolean);
      return all.filter(isFree);
    } catch {
      return [];
    }
  }

  async health(): Promise<Omit<HealthStatus, "provider">> {
    const start = Date.now();
    try {
      const res = await fetchWithTimeout(`${this.base}/models`, { headers: this.headers() }, 5000);
      if (!res.ok) {
        return { healthy: false, failures: 0, lastCheck: start, lastError: `HTTP ${res.status}`, circuitOpen: false, cooldownUntil: 0 };
      }
      return { healthy: true, failures: 0, lastCheck: start, circuitOpen: false, cooldownUntil: 0 };
    } catch (err) {
      return { healthy: false, failures: 0, lastCheck: start, lastError: (err as Error).message, circuitOpen: false, cooldownUntil: 0 };
    }
  }

  async *chat(
    messages: Message[],
    tools: ToolDef[],
    opts?: { signal?: AbortSignal; temperature?: number; maxTokens?: number }
  ): AsyncIterable<ChatChunk> {
    const body: any = {
      model: this.config.models[0] || "openrouter/auto",
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      stream: true,
      temperature: opts?.temperature ?? 0.7,
    };
    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (opts?.maxTokens) {
      body.max_tokens = opts.maxTokens;
    }

    const res = await fetchWithTimeout(
      `${this.base}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: opts?.signal,
      },
      this.config.timeoutMs
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter chat failed: HTTP ${res.status} ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("OpenRouter chat: no response body");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    const toolParts: Record<number, { id?: string; name: string; arguments: string }> = {};
    let inputTokens = 0;
    let outputTokens = 0;
    let sawDone = false;

    const emitToolCalls = (): ChatChunk | null => {
      const calls: ToolCall[] = [];
      for (const idx of Object.keys(toolParts).map(Number).sort((a, b) => a - b)) {
        const p = toolParts[idx];
        if (!p) continue;
        calls.push({
          id: p.id || `call_${idx}`,
          type: "function",
          function: { name: p.name, arguments: p.arguments },
        });
      }
      Object.keys(toolParts).forEach((k) => delete toolParts[Number(k)]);
      return calls.length ? { type: "tool_call", tool_call: calls[0] } : null;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const rawLine = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const line = rawLine.trim();
        if (!line) continue;
        if (line === "data: [DONE]") {
          sawDone = true;
          continue;
        }
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let obj: any;
        try {
          obj = JSON.parse(payload);
        } catch {
          continue;
        }
        if (obj?.error) {
          throw new Error(`OpenRouter error: ${JSON.stringify(obj.error)}`);
        }
        const choice = obj?.choices?.[0];
        if (!choice) {
          if (obj?.usage) {
            inputTokens = obj.usage.prompt_tokens ?? inputTokens;
            outputTokens = obj.usage.completion_tokens ?? outputTokens;
          }
          continue;
        }
        const delta = choice.delta ?? {};
        if (delta.content) {
          yield { type: "text", text: delta.content };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0;
            if (!toolParts[i]) toolParts[i] = { name: "", arguments: "" };
            if (tc.id) toolParts[i].id = tc.id;
            if (tc.function?.name) toolParts[i].name = tc.function.name;
            if (tc.function?.arguments) toolParts[i].arguments += tc.function.arguments;
          }
        }
        if (obj?.usage) {
          inputTokens = obj.usage.prompt_tokens ?? inputTokens;
          outputTokens = obj.usage.completion_tokens ?? outputTokens;
        }
        if (choice.finish_reason) {
          const tc = emitToolCalls();
          if (tc) yield tc;
          yield {
            type: "done",
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          };
          sawDone = true;
        }
        idx = buffer.indexOf("\n");
      }
    }
    if (!sawDone) {
      const tc = emitToolCalls();
      if (tc) yield tc;
      yield { type: "done", usage: { input_tokens: inputTokens, output_tokens: outputTokens } };
    }
  }
}
