export interface ChatResult {
  text: string;
  toolCalls: any[];
  usage?: { input_tokens: number; output_tokens: number };
  attempts: any[];
  provider: string;
  model: string;
}

export interface HealthResult {
  status: string;
  providers: number;
  healthy: number;
}

export interface ModelEntry {
  id: string;
  object: string;
  owned_by?: string;
}

export interface ModelsList {
  object: string;
  data: ModelEntry[];
}

export interface ProviderStatus {
  provider: string;
  healthy: boolean;
  failures: number;
  lastCheck: number;
  lastError?: string;
  circuitOpen: boolean;
  cooldownUntil: number;
}

export interface ClientOptions {
  baseURL?: string;
  timeoutMs?: number;
  retries?: number;
}

function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = (init as any).signal
    ? AbortSignal.any([(init as any).signal, controller.signal])
    : controller.signal;
  return fetch(url, { ...init, signal }).finally(() => clearTimeout(timer));
}

export class FreeRouterClient {
  readonly baseURL: string;
  readonly timeoutMs: number;
  readonly retries: number;

  constructor(baseURL?: string, opts: ClientOptions = {}) {
    this.baseURL = (baseURL ?? opts.baseURL ?? "http://localhost:31415").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.retries = opts.retries ?? 3;
  }

  private async request<T>(path: string, init: RequestInit = {}, tryNextPort = false): Promise<T> {
    let lastErr: Error | null = null;
    const ports = tryNextPort ? [31415, 31416, 31417, 31418] : [null];

    for (const port of ports) {
      const base = port ? `http://localhost:${port}` : this.baseURL;
      const url = `${base}${path}`;
      for (let attempt = 0; attempt <= this.retries; attempt++) {
        try {
          const res = await fetchWithTimeout(url, init, this.timeoutMs);
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            let body: any = {};
            try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
            const msg = body?.error?.message || body?.error || `HTTP ${res.status}`;
            throw new Error(`${msg} (status ${res.status})`);
          }
          return (await res.json()) as T;
        } catch (err) {
          lastErr = err as Error;
          // small backoff before retrying the same URL
          if (attempt < this.retries) {
            await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          }
        }
      }
    }

    throw lastErr ?? new Error("Request failed");
  }

  async health(): Promise<HealthResult> {
    return this.request<HealthResult>("/health");
  }

  async providers(): Promise<ProviderStatus[]> {
    return this.request<ProviderStatus[]>("/providers");
  }

  async listModels(): Promise<ModelsList> {
    return this.request<ModelsList>("/v1/models");
  }

  async chat(
    messages: any[],
    opts?: {
      model?: string;
      tools?: any[];
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    }
  ): Promise<ChatResult> {
    const body: any = {
      model: opts?.model,
      messages,
      tools: opts?.tools ?? [],
      temperature: opts?.temperature,
      max_tokens: opts?.maxTokens,
    };
    if (opts?.stream) body.stream = true;

    return this.request<ChatResult>(
      "/v1/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      true
    );
  }

  async chatCompletion(
    messages: any[],
    opts?: {
      model?: string;
      tools?: any[];
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    }
  ): Promise<any> {
    const body: any = {
      model: opts?.model,
      messages,
      tools: opts?.tools ?? [],
      temperature: opts?.temperature,
      max_tokens: opts?.maxTokens,
      stream: !!opts?.stream,
    };
    return this.request<any>(
      "/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      true
    );
  }

  async resetHealth(): Promise<{ status: string; message: string }> {
    return this.request<{ status: string; message: string }>(
      "/reset-health",
      { method: "POST", headers: { "Content-Type": "application/json" } },
      true
    );
  }
}
