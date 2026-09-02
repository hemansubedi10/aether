// Combo manager for Aether.
//
// A "combo" is a named group of providers/models that can be created, saved,
// and later selected in a single step (replacing /provider + /model).
// Combos persist to ~/.aether/combos.json and are loaded lazily on first use.
//
// Two built-in combos are always available, even before the user creates any:
//   local  - ollama-local only
//   cloud  - every enabled cloud provider

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PROVIDER_REGISTRY, type FreeProvider } from "./providers/registry.js";

export interface Combo {
  name: string;
  description?: string;
  providers: string[];
  models: string[];
  default?: boolean;
  createdAt: number;
}

function combosPath(): string {
  return path.join(os.homedir(), ".aether", "combos.json");
}

function cloudProviderNames(): string[] {
  return PROVIDER_REGISTRY.filter(
    (p: FreeProvider) => p.enabled && p.name !== "ollama-local",
  ).map((p: FreeProvider) => p.name);
}

function firstModels(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const p = PROVIDER_REGISTRY.find((x: FreeProvider) => x.name === n);
    if (p && p.models[0]) out.push(p.models[0]);
  }
  return out;
}

const DEFAULT_COMBOS: Omit<Combo, "createdAt">[] = [
  {
    name: "local",
    description: "Local Ollama only",
    providers: ["ollama-local"],
    models: firstModels(["ollama-local"]),
    default: true,
  },
  {
    name: "cloud",
    description: "All cloud providers",
    providers: cloudProviderNames(),
    models: firstModels(cloudProviderNames()),
    default: true,
  },
];

export class ComboManager {
  private combos: Map<string, Combo> = new Map();
  private active?: string;
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      const p = combosPath();
      const raw = fs.readFileSync(p, "utf8");
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        const arr = Array.isArray(obj) ? obj : obj.combos ?? [];
        if (Array.isArray(arr)) {
          for (const c of arr) {
            if (c && typeof c.name === "string") this.combos.set(c.name, c as Combo);
          }
        }
      }
    } catch {
      // Missing or corrupt combos file: start with an empty set.
    }
    this.ensureDefaults();
  }

  /** Re-add built-in combos if the user removed them from disk. */
  private ensureDefaults(): void {
    for (const d of DEFAULT_COMBOS) {
      if (!this.combos.has(d.name)) {
        this.combos.set(d.name, { ...d, createdAt: Date.now() } as Combo);
      }
    }
  }

  /** Create a new combo. Returns undefined if the name is empty or already used. */
  create(
    name: string,
    opts: { description?: string; providers?: string[]; models?: string[] } = {},
  ): Combo | undefined {
    const n = (name ?? "").trim();
    if (!n) return undefined;
    this.ensureLoaded();
    if (this.combos.has(n)) return undefined;
    const providers = (opts.providers ?? [])
      .map((p: string) => p.trim())
      .filter(Boolean);
    const combo: Combo = {
      name: n,
      description: opts.description,
      providers,
      models: opts.models ?? [],
      createdAt: Date.now(),
    };
    this.combos.set(n, combo);
    this.save();
    return combo;
  }

  get(name: string): Combo | undefined {
    this.ensureLoaded();
    return this.combos.get(name);
  }

  /** All combos sorted alphabetically (built-ins included). */
  list(): Combo[] {
    this.ensureLoaded();
    return [...this.combos.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Remove a combo. Built-in combos cannot be deleted. */
  delete(name: string): boolean {
    this.ensureLoaded();
    const c = this.combos.get(name);
    if (!c) return false;
    if (c.default) return false;
    this.combos.delete(name);
    if (this.active === name) this.active = undefined;
    this.save();
    return true;
  }

  /** Select a combo as the active one. Returns the combo or undefined. */
  select(name: string): Combo | undefined {
    this.ensureLoaded();
    const c = this.combos.get(name);
    if (!c) return undefined;
    this.active = name;
    return c;
  }

  /** The currently selected combo, or undefined. */
  getActive(): Combo | undefined {
    this.ensureLoaded();
    return this.active ? this.combos.get(this.active) : undefined;
  }

  /** Human-readable description of which providers/models a combo uses. */
  render(name: string): string {
    this.ensureLoaded();
    const c = this.combos.get(name);
    if (!c) return `Combo "${name}" not found.`;
    const lines: string[] = [`Combo: ${c.name}`];
    if (c.description) lines.push(`  ${c.description}`);
    lines.push(
      `  providers: ${c.providers.length ? c.providers.join(", ") : "(none)"}`,
    );
    lines.push(`  models: ${c.models.length ? c.models.join(", ") : "(none)"}`);
    return lines.join("\n");
  }

  /** Persist combos to disk atomically. */
  save(): void {
    this.ensureLoaded();
    const file = combosPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const arr = [...this.combos.values()];
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }

  /** Singleton: load combos from disk (and re-add built-ins). */
  static load(): ComboManager {
    if (!ComboManager._instance) ComboManager._instance = new ComboManager();
    ComboManager._instance.ensureLoaded();
    return ComboManager._instance;
  }

  static instance(): ComboManager {
    return ComboManager.load();
  }

  private static _instance: ComboManager | null = null;
}