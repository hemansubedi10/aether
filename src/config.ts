import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ProviderConfig } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".aether");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    name: "ollama-local",
    type: "ollama",
    baseURL: process.env.AETHER_BASE_URL || "http://localhost:11434",
    apiKey: undefined,
    models: [],
    priority: 1,
    enabled: true,
    maxRetries: 2,
    timeoutMs: 120000,
  },
  {
    name: "openrouter-free",
    type: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || process.env.AETHER_API_KEY,
    models: [],
    priority: 2,
    enabled: true,
    maxRetries: 2,
    timeoutMs: 120000,
  },
  {
    name: "openai-compatible",
    type: "openai-compatible",
    baseURL: process.env.AETHER_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY || process.env.AETHER_API_KEY,
    models: [],
    priority: 3,
    enabled: true,
    maxRetries: 1,
    timeoutMs: 120000,
  },
];

export interface Config {
  providers: ProviderConfig[];
  defaultModel: string;
  activeProvider?: string;
}

export function loadConfig(): Config {
  let fileConfig: Partial<Config> = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf8");
      fileConfig = JSON.parse(raw);
    }
  } catch {
    // ignore malformed config; fall back to defaults
  }

  const envModel = process.env.AETHER_MODEL;
  const envProvider = process.env.AETHER_PROVIDER;

  let providers: ProviderConfig[];
  if (Array.isArray(fileConfig.providers) && fileConfig.providers.length > 0) {
    providers = fileConfig.providers as ProviderConfig[];
  } else {
    providers = DEFAULT_PROVIDERS.map((p) => ({ ...p }));
  }

  // Apply env overrides on top of file config.
  if (envProvider) {
    providers = providers.map((p) =>
      p.name === envProvider ? { ...p, enabled: true } : p
    );
  }

  const defaultModel = envModel || fileConfig.defaultModel || "";
  const activeProvider = envProvider || fileConfig.activeProvider;

  return { providers, defaultModel, activeProvider };
}

export function saveConfig(cfg: Config): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
  } catch (err) {
    throw new Error(`Failed to save config to ${CONFIG_FILE}: ${(err as Error).message}`);
  }
}

export function getConfig(): Config {
  return loadConfig();
}

export function getActiveProvider(): ProviderConfig | undefined {
  const cfg = loadConfig();
  if (cfg.activeProvider) {
    const match = cfg.providers.find((p) => p.name === cfg.activeProvider);
    if (match) return match;
  }
  const sorted = [...cfg.providers]
    .filter((p) => p.enabled)
    .sort((a, b) => a.priority - b.priority);
  return sorted[0];
}

export function configPath(): string {
  return CONFIG_FILE;
}
