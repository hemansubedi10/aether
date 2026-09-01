import type {
  ChatChunk,
  Message,
  ProviderConfig,
  RouteDecision,
  ToolDef,
  HealthStatus,
} from "./types.js";
import { HealthTracker } from "./health.js";
import { createProvider, type Provider } from "./providers/index.js";

export class Router {
  readonly configs: ProviderConfig[];
  private health: HealthTracker;
  private cache = new Map<string, Provider>();
  private modelCache = new Map<string, Provider>();

  activeProvider?: string;
  activeModel?: string;

  constructor(providers: ProviderConfig[], health: HealthTracker) {
    this.configs = providers;
    this.health = health;
  }

  private async getProvider(config: ProviderConfig): Promise<Provider> {
    const cached = this.cache.get(config.name);
    if (cached) return cached;
    const p = await createProvider(config);
    this.cache.set(config.name, p);
    return p;
  }

  private sortedConfigs(): ProviderConfig[] {
    return [...this.configs]
      .filter((p) => p.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  private findConfig(name?: string): ProviderConfig | undefined {
    if (!name) return undefined;
    return this.configs.find((c) => c.name === name);
  }

  resolveModel(modelId: string): { provider: ProviderConfig; model: string } | null {
    const exact = this.configs.find((c) => c.models.includes(modelId));
    if (exact) return { provider: exact, model: modelId };
    const first = this.sortedConfigs()[0];
    return first ? { provider: first, model: modelId } : null;
  }

  async getModelProvider(modelId: string): Promise<Provider> {
    const cached = this.modelCache.get(modelId);
    if (cached) return cached;
    const cfg = this.configs.find((c) => c.models.includes(modelId)) || this.sortedConfigs()[0];
    if (!cfg) throw new Error(`No provider configured to serve model "${modelId}"`);
    const override: ProviderConfig = { ...cfg, models: [modelId] };
    const p = await createProvider(override);
    this.modelCache.set(modelId, p);
    return p;
  }

  select(): RouteDecision | null {
    const cfg = this.findConfig(this.activeProvider) || this.sortedConfigs()[0];
    if (cfg && this.health.isAvailable(cfg.name)) {
      return {
        provider: cfg.name,
        model: this.activeModel || cfg.models[0] || "",
        reason: this.activeProvider ? `selected (active: ${this.activeProvider})` : `selected by priority ${cfg.priority}`,
      };
    }
    for (const c of this.sortedConfigs()) {
      if (this.health.isAvailable(c.name)) {
        return { provider: c.name, model: this.activeModel || c.models[0] || "", reason: "fallback" };
      }
    }
    return null;
  }

  setActiveProvider(name?: string): void {
    this.activeProvider = name;
  }

  setActiveModel(model: string): void {
    this.activeModel = model;
    const cfg = this.findConfig(this.activeProvider) || this.sortedConfigs()[0];
    if (cfg) {
      cfg.models = [model];
    }
  }

  getActiveProvider(): string | undefined {
    return this.activeProvider;
  }

  getActiveModel(): string | undefined {
    return this.activeModel;
  }

  getProviderNames(): string[] {
    return this.configs.filter((c) => c.enabled).map((c) => c.name);
  }

  getModelsFor(name?: string): string[] {
    const cfg = name
      ? this.configs.find((c) => c.name === name)
      : this.activeProvider
        ? this.configs.find((c) => c.name === this.activeProvider)
        : this.sortedConfigs()[0];
    return cfg?.models ?? [];
  }

  async *chat(
    messages: Message[],
    tools: ToolDef[],
    opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
  ): AsyncIterable<ChatChunk> {
    const order = this.sortedConfigs();
    if (order.length === 0) {
      yield { type: "error", error: "No providers configured" };
      return;
    }

    let lastError: Error | null = null;
    for (const cfg of order) {
      if (!this.health.isAvailable(cfg.name)) continue;
      const provider = await this.getProvider(cfg);
      try {
        for await (const chunk of provider.chat(messages, tools, {
          signal: opts?.signal,
          temperature: opts?.temperature,
          maxTokens: opts?.maxTokens,
        })) {
          if (chunk.type === "error" && chunk.error) {
            throw new Error(chunk.error);
          }
          yield chunk;
        }
        this.health.recordSuccess(cfg.name);
        return;
      } catch (err) {
        lastError = err as Error;
        this.health.recordFailure(cfg.name, lastError?.message);
        if (opts?.signal?.aborted) {
          yield { type: "error", error: `Aborted: ${lastError.message}` };
          return;
        }
        yield {
          type: "error",
          error: `Provider ${cfg.name} failed (${lastError.message}); failing over...`,
        };
        continue;
      }
    }

    yield {
      type: "error",
      error: `All providers failed. Last error: ${lastError?.message ?? "unknown"}`,
    };
  }

  async listAllModels(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const cfg of this.sortedConfigs()) {
      try {
        const provider = await this.getProvider(cfg);
        out[cfg.name] = await provider.listModels();
      } catch {
        out[cfg.name] = [];
      }
    }
    return out;
  }

  async healthAll(): Promise<HealthStatus[]> {
    const out: HealthStatus[] = [];
    for (const cfg of this.configs) {
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
}