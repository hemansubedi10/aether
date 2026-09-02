import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface SettingsData {
  theme: string;
  streaming: boolean;
  maxSteps: number;
  temperature: number;
  confirmTools: boolean;
  autoSave: boolean;
}

const SETTINGS_DIR = path.join(os.homedir(), ".aether");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");
const SETTINGS_VERSION = 1;

const DEFAULTS: SettingsData = {
  theme: "dark",
  streaming: true,
  maxSteps: 15,
  temperature: 0.7,
  confirmTools: true,
  autoSave: true,
};

interface SettingsSnapshot {
  version: number;
  settings: Partial<SettingsData>;
}

function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function coerce(key: keyof SettingsData, v: unknown): any {
  const def = DEFAULTS[key];
  if (typeof def === "boolean") return isBool(v) ? v : def;
  if (typeof def === "number") return isNum(v) ? v : def;
  return isStr(v) ? v : def;
}

export class Settings {
  private settings: SettingsData = { ...DEFAULTS };
  private dirty = false;

  constructor() {}

  get(key: keyof SettingsData): SettingsData[keyof SettingsData] {
    return this.settings[key];
  }

  set(key: keyof SettingsData, value: SettingsData[keyof SettingsData]): void {
    (this.settings as any)[key] = coerce(key, value);
    this.dirty = true;
  }

  getAll(): SettingsData {
    return { ...this.settings };
  }

  reset(): void {
    this.settings = { ...DEFAULTS };
    this.dirty = true;
  }

  save(): void {
    try {
      if (!fs.existsSync(SETTINGS_DIR)) {
        fs.mkdirSync(SETTINGS_DIR, { recursive: true });
      }
      const snapshot: SettingsSnapshot = { version: SETTINGS_VERSION, settings: { ...this.settings } };
      const tmp = SETTINGS_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), "utf8");
      fs.renameSync(tmp, SETTINGS_FILE);
    } catch {
      // best-effort persistence
    }
    this.dirty = false;
  }

  private restore(snapshot: SettingsSnapshot): void {
    if (!snapshot || typeof snapshot !== "object") return;
    const src = snapshot.settings ?? {};
    for (const key of Object.keys(DEFAULTS) as (keyof SettingsData)[]) {
      if (key in src) {
        (this.settings as any)[key] = coerce(key, (src as any)[key]);
      }
    }
  }

  static load(): Settings {
    const s = new Settings();
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
        s.restore(JSON.parse(raw));
      }
    } catch {
      // ignore malformed settings file
    }
    return s;
  }

  private static instanceCache = new Map<string, Settings>();

  static instance(name: string = "default"): Settings {
    let s = Settings.instanceCache.get(name);
    if (!s) {
      s = name === "default" ? Settings.load() : new Settings();
      Settings.instanceCache.set(name, s);
    }
    return s;
  }
}


