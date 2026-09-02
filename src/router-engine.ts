import { HealthTracker } from "./health.js";
import { createProvider, type Provider, type ProviderConfig } from "./providers/index.js";
import { PROVIDER_REGISTRY, type FreeProvider } from "./providers/registry.js";
import { KeyManager, ENV_MAP } from "./keys.js";

export interface RouteAttempt {
  provider: string;
  model: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
}

export interface RouteResult {
  text: string;
  toolCalls: any[];
  usage?: { input_tokens: number; output_tokens: number };
  attempts: RouteAttempt[];
  provider: string;
  model: string;
}

export class RouterEngine {
  private health: HealthTracker;
  private cache = new Map<string, Provider>();
  private configs: ProviderConfig[];
  private keyManager: KeyManager;

  constructor(providers?: FreeProvider[], health?: HealthTracker, keyManager?: KeyManager) {
    this.health = health ?? new HealthTracker();
    this.keyManager = keyManager ?? KeyManager.instance();
    this.configs = (providers ?? PROVIDER_REGISTRY).map((p) => ({
      name: p.name,
      type: p.type,
      baseURL: p.baseURL,
      apiKey: this.keyManager.get(p.name) ?? process.env[ENV_MAP[p.name] ?? ""],
      models: p.models,
      priority: p.priority,
      enabled: p.enabled,
      maxRetries: p.maxRetries,
      timeoutMs: p.timeoutMs,
    }));
  }

  get configs_(): ProviderConfig[] { return this.configs; }
  get healthTracker(): HealthTracker { return this.health; }
  get keys(): KeyManager { return this.keyManager; }

  /** Update the key for a provider and invalidate the cached provider so the
   *  new credential takes effect on the next request. */
  setKey(name: string, key: string): void {
    this.keyManager.set(name, key);
    const cfg = this.configs.find((c) => c.name === name);
    if (cfg) cfg.apiKey = key.trim() || undefined;
    this.cache.delete(name);
  }

  private async getProvider(cfg: ProviderConfig): Promise<Provider> {
    const cached = this.cache.get(cfg.name);
    if (cached) return cached;
    const p = await createProvider(cfg);
    this.cache.set(cfg.name, p);
    return p;
  }

  private sorted(): ProviderConfig[] {
    return [...this.configs].filter((p) => p.enabled).sort((a, b) => a.priority - b.priority);
  }

  async *chatStream(
    messages: any[],
    tools: any[],
    opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal; excludeProviders?: string[] }
  ): AsyncGenerator<any> {
    const order = this.sorted().filter((p) => !opts?.excludeProviders?.includes(p.name));
    if (order.length === 0) {
      yield { type: "error", error: "No providers configured" };
      return;
    }
    let lastError = "";
    for (const cfg of order) {
      if (!this.health.isAvailable(cfg.name)) continue;
      const provider = await this.getProvider(cfg);
      const model = cfg.models[0] ?? "";
      const start = Date.now();
      try {
        let usage: any;
        for await (const chunk of provider.chat(messages, tools, {
          signal: opts?.signal,
          temperature: opts?.temperature,
          maxTokens: opts?.maxTokens,
        })) {
          if (chunk.type === "done") usage = chunk.usage;
          if (chunk.type === "error" && chunk.error) throw new Error(chunk.error);
          yield chunk;
        }
        this.health.recordSuccess(cfg.name);
        if (!usage) yield { type: "done", usage };
        return;
      } catch (err) {
        const msg = (err as Error).message;
        lastError = msg;
        this.health.recordFailure(cfg.name, msg);
        if (opts?.signal?.aborted) {
          yield { type: "error", error: `Aborted: ${msg}` };
          return;
        }
        yield {
          type: "error",
          error: `Provider ${cfg.name} failed (${msg}); failing over...`,
        };
      }
    }
    yield {
      type: "error",
      error: `All ${order.length} providers failed. Last: ${lastError || "unknown"}`,
    };
  }

  async chat(messages: any[], tools: any[], opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal; excludeProviders?: string[] }): Promise<RouteResult> {
    const order = this.sorted().filter((p) => !opts?.excludeProviders?.includes(p.name));
    const attempts: RouteAttempt[] = [];
    let lastError = "";
    for (const cfg of order) {
      if (!this.health.isAvailable(cfg.name)) continue;
      const provider = await this.getProvider(cfg);
      const model = cfg.models[0] ?? "";
      const start = Date.now();
      try {
        let text = "", toolCalls: any[] = [], usage: any;
        for await (const chunk of provider.chat(messages, tools, { signal: opts?.signal, temperature: opts?.temperature, maxTokens: opts?.maxTokens })) {
          if (chunk.type === "text" && chunk.text) text += chunk.text;
          if (chunk.type === "tool_call" && chunk.tool_call) toolCalls.push(chunk.tool_call);
          if (chunk.type === "done") usage = chunk.usage;
          if (chunk.type === "error" && chunk.error) throw new Error(chunk.error);
        }
        this.health.recordSuccess(cfg.name);
        attempts.push({ provider: cfg.name, model, ok: true, latencyMs: Date.now() - start });
        return { text, toolCalls, usage, attempts, provider: cfg.name, model };
      } catch (err) {
        const msg = (err as Error).message;
        lastError = msg;
        this.health.recordFailure(cfg.name, msg);
        attempts.push({ provider: cfg.name, model, ok: false, error: msg, latencyMs: Date.now() - start });
        if (opts?.signal?.aborted) break;
      }
    }
    throw new Error(`All ${order.length} providers failed. Last: ${lastError}. Attempts: ${JSON.stringify(attempts)}`);
  }

  async listFreeModels(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const cfg of this.sorted()) {
      try {
        const p = await this.getProvider(cfg);
        out[cfg.name] = await p.listModels();
      } catch { out[cfg.name] = cfg.models; }
    }
    return out;
  }

  async healthAll() {
    const out: any[] = [];
    for (const cfg of this.configs) {
      if (!cfg.enabled) continue;
      try {
        const provider = await this.getProvider(cfg);
        const status = await provider.health();
        out.push({ provider: cfg.name, ...status });
      } catch {
        out.push({
          provider: cfg.name,
          healthy: false,
          failures: 0,
          lastCheck: 0,
          circuitOpen: false,
          cooldownUntil: 0,
        });
      }
    }
    return out;
  }
  resetHealth() { this.health.resetAll(); }
}