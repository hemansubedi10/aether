// API key manager for Aether.
//
// WARNING: Keys are stored PLAINTEXT in ~/.aether/keys.json on this machine.
// This is intentional for a local CLI tool running on your own machine --
// anyone with read access to that file can use your keys. Do not share the
// file, do not commit it, and do not run Aether on machines you do not trust.
// For temporary keys, prefer environment variables (they are never written
// to disk by this module).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Provider name -> environment variable that may hold its API key.
export const ENV_MAP: Record<string, string> = {
  "openrouter-free": "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  cohere: "COHERE_API_KEY",
  huggingface: "HUGGINGFACE_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  together: "TOGETHER_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  gemini: "GEMINI_API_KEY",
  xai: "XAI_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  nvidia: "NVIDIA_NIM_API_KEY",
  jina: "JINA_API_KEY",
  parasail: "PARASAIL_API_KEY",
  featherless: "FEATHERLESS_API_KEY",
  voyage: "VOYAGE_API_KEY",
  cloudflare: "CLOUDFLARE_API_KEY",
};

function keysPath(): string {
  return path.join(os.homedir(), ".aether", "keys.json");
}

export class KeyManager {
  private keys: Map<string, string> = new Map();
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      const p = keysPath();
      if (!fs.existsSync(p)) return;
      const raw = fs.readFileSync(p, "utf8");
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === "string" && v) this.keys.set(k, v);
        }
      }
    } catch {
      // Ignore a missing or corrupt keys file; we'll just have no keys.
    }
  }

  /** Store a key (or remove it when given an empty/falsy value). */
  set(providerName: string, key: string): void {
    this.ensureLoaded();
    if (key && key.trim()) this.keys.set(providerName, key.trim());
    else this.keys.delete(providerName);
    this.save();
  }

  get(providerName: string): string | undefined {
    this.ensureLoaded();
    return this.keys.get(providerName);
  }

  has(providerName: string): boolean {
    this.ensureLoaded();
    return this.keys.has(providerName);
  }

  remove(providerName: string): void {
    this.ensureLoaded();
    this.keys.delete(providerName);
    this.save();
  }

  /** Every known provider and whether a key is currently configured. */
  list(): { provider: string; hasKey: boolean }[] {
    this.ensureLoaded();
    return Object.keys(ENV_MAP).map((provider) => ({
      provider,
      hasKey: this.keys.has(provider),
    }));
  }

  /** Scan process.env for known key env vars and load any found into the map. */
  detectFromEnv(): this {
    this.ensureLoaded();
    for (const [provider, envVar] of Object.entries(ENV_MAP)) {
      const v = process.env[envVar];
      if (v && v.trim()) this.keys.set(provider, v.trim());
    }
    return this;
  }

  /** Persist the current in-memory keys to disk atomically. */
  save(): void {
    this.ensureLoaded();
    const file = keysPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const obj: Record<string, string> = {};
    for (const [k, v] of this.keys) obj[k] = v;
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }

  /** Singleton: load from disk AND env. */
  static load(): KeyManager {
    if (!KeyManager._instance) KeyManager._instance = new KeyManager();
    const km = KeyManager._instance;
    km.ensureLoaded();
    km.detectFromEnv();
    return km;
  }

  static instance(): KeyManager {
    return KeyManager.load();
  }

  private static _instance: KeyManager | null = null;
}
