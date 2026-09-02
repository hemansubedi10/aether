import type { ChatChunk } from "./types.js";

import * as path from "node:path";

import * as os from "node:os";

import * as fs from "node:fs";

import { Session } from "./session.js";

import { CostTracker } from "./cost.js";

import { Settings, type SettingsData } from "./settings.js";

import { Skills } from "./skills.js";



function coerceSetting(key: string, raw: string): SettingsData[keyof SettingsData] {

  const s = Settings.instance().getAll();

  const cur = (s as any)[key];

  if (typeof cur === "boolean") {

    const v = raw.trim().toLowerCase();

    if (["true","1","yes","on"].includes(v)) return true as any;

    if (["false","0","no","off"].includes(v)) return false as any;

    return cur as any;

  }

  if (typeof cur === "number") {

    const n = Number(raw);

    return (Number.isFinite(n) ? n : cur) as any;

  }

  return raw as any;

}





export interface CommandContext {

  tui: any;

  agent: any;

  router: any;

  session: any;

  arena: any;

  costTracker?: any;

  settings?: Settings;

  skills?: any;

}



export interface CommandHandler {

  help: string;

  run: (args: string[], ctx: CommandContext) => Promise<string | void> | string | void;

}



export function parseCommand(input: string): { command: string; args: string[] } {

  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {

    return { command: "", args: [] };

  }

  const parts = trimmed.slice(1).split(/\s+/);

  const command = parts.shift() ?? "";

  return { command, args: parts };

}



export const CommandHandler: Record<string, CommandHandler> = {

  help: {

    help: "/help - Show all available commands",

    run: (_args: string[], ctx: CommandContext) => {

      const lines: string[] = [];

      lines.push("Commands:");

      for (const [name, h] of Object.entries(CommandHandler)) {

        lines.push(`  ${h.help}`);

      }

      ctx.tui.showSystem(lines.join("\n"));

    },

  },



  model: {

    help: "/model <name> - Switch the active model",

    run: (args: string[], ctx: CommandContext) => {

      const name = args.join(" ").trim();

      if (!name) {

        ctx.tui.showSystem(

          `Current model: ${ctx.router.getActiveModel() ?? "(default)"}. Usage: /model <name>`

        );

        return;

      }

      ctx.router.setActiveModel(name);

      ctx.tui.showSystem(`Active model set to: ${name}`);

    },

  },



  provider: {

    help: "/provider <name> - Switch the active provider",

    run: (args: string[], ctx: CommandContext) => {

      const name = args.join(" ").trim();

      if (!name) {

        ctx.tui.showSystem(

          `Current provider: ${ctx.router.getActiveProvider() ?? "(auto)"}. Usage: /provider <name>`

        );

        return;

      }

      const names = ctx.router.getProviderNames();

      if (!names.includes(name)) {

        ctx.tui.showSystem(

          `Unknown provider "${name}". Available: ${names.join(", ") || "(none)"}`

        );

        return;

      }

      ctx.router.setActiveProvider(name);

      ctx.tui.showSystem(`Active provider set to: ${name}`);

    },

  },



  models: {

    help: "/models - List all available models across providers",

    run: async (_args, ctx) => {

      const all = await ctx.router.listAllModels();

      const lines: string[] = [];

      for (const [provider, models] of Object.entries(all)) {

        const list = (models as string[]).length ? (models as string[]).join(",  ") : "(none returned)";

        lines.push(`${provider}: ${list}`);

      }

      ctx.tui.showSystem(lines.join("\n") || "No models available.");

    },

  },



  providers: {

    help: "/providers - Show provider health status",

    run: async (_args, ctx) => {

      const statuses = await ctx.router.healthAll();

      const lines = statuses.map((s: any) => {

        const state = s.healthy ? "healthy" : s.circuitOpen ? "OPEN" : "unhealthy";

        const err = s.lastError ? ` (${s.lastError})` : "";

        return `${s.provider}: ${state}${err}`;

      });

      ctx.tui.showSystem(lines.join("\n") || "No providers.");

    },

  },



  session: {

    help: "/session save [name] | load <name> | list | clear - Manage sessions",

    run: (args: string[], ctx: CommandContext) => {

      const sub = args[0]?.toLowerCase() ?? "";

      const name = args.slice(1).join(" ").trim();

      const dir = path.join(os.homedir(), ".aether", "sessions");



      switch (sub) {

        case "save": {

          const file = name

            ? path.join(dir, `${name}.json`)

            : path.join(dir, "session.json");

          fs.mkdirSync(path.dirname(file), { recursive: true });

          Session.save(file, ctx.session);

          ctx.tui.showSystem(`Session saved to: ${file}`);

          break;

        }

        case "load": {

          if (!name) {

            ctx.tui.showSystem("Usage: /session load <name>");

            break;

          }

          const candidates = [

            path.join(dir, `${name}.json`),

            path.join(dir, name),

          ];

          const target = candidates.find((f: string) => fs.existsSync(f));

          if (!target) {

            ctx.tui.showSystem(`Session "${name}" not found.`);

            break;

          }

          const loaded = Session.load(target);

          ctx.session.messages = loaded.messages;

          ctx.session.createdAt = loaded.createdAt;

          ctx.session.updatedAt = loaded.updatedAt;

          ctx.tui.showSystem(

            `Loaded session "${name}" (${loaded.messages.length} messages) from ${target}`

          );

          break;

        }

        case "list": {

          const list = Session.list();

          if (list.length === 0) {

            ctx.tui.showSystem("No saved sessions.");

            break;

          }

          const lines = list.map(

            (s: any) =>

              `${path.basename(s.file)}  (${s.size} bytes, ${new Date(s.mtime).toLocaleString()})`

          );

          ctx.tui.showSystem(lines.join("\n"));

          break;

        }

        case "clear": {

          ctx.session.clear();

          ctx.tui.showSystem("Session cleared.");

          break;

        }

        default:

          ctx.tui.showSystem(

            "Usage: /session save [name] | load <name> | list | clear"

          );

      }

    },

  },



  arena: {

    help: "/arena - Enter arena mode (compare models)",

    run: (_args: string[], ctx: CommandContext) => {

      ctx.tui.enterArena();

    },

  },



  exit: {

    help: "/exit - Exit the TUI",

    run: (_args: string[], ctx: CommandContext) => {

      ctx.tui.exit();

    },

  },



  cost: {

    help: "/cost - Show token usage and estimated cost summary",

    run: (_args: string[], ctx: CommandContext) => {

      const tracker = ctx.tui.costTracker;

      if (!tracker) {

        ctx.tui.showSystem("Cost tracking not available.");

        return;

      }

      ctx.tui.showSystem(tracker.formatSummary());

    },

  },



  "reset-cost": {

    help: "/reset-cost - Reset cost and token counters",

    run: (_args: string[], ctx: CommandContext) => {

      const tracker = ctx.tui.costTracker;

      if (!tracker) {

        ctx.tui.showSystem("Cost tracking not available.");

        return;

      }

      tracker.reset();

      try {

        CostTracker.save(tracker);

      } catch {

        // best-effort persistence

      }

      ctx.tui.showSystem("Cost counters reset.");

    },

  },



  settings: {

    help: "/settings [set <key> <value> | reset] - View or modify settings",

    run: (args: string[], ctx: CommandContext) => {

      const settings = ctx.settings ?? Settings.instance();

      const sub = args[0]?.toLowerCase() ?? "";



      if (sub === "set") {

        const key = args[1];

        const value = args.slice(2).join(" ").trim();

        if (!key) {

          return "Usage: /settings set <key> <value>";

        }

        if (!(key in settings.getAll())) {

          return `Unknown setting "${key}". Available: ${Object.keys(settings.getAll()).join(", ")}`;

        }

        const coerced = coerceSetting(key, value);

        settings.set(key as keyof SettingsData, coerced);

        settings.save();

        return `Set ${key} = ${coerced}`;

      }



      if (sub === "reset") {

        settings.reset();

        settings.save();

        return "Settings reset to defaults.";

      }



      const s = settings.getAll();

      const lines = [

        "Settings:",

        ...Object.entries(s).map(([k, v]) => `  ${k}: ${v}`),

        "",

        "Usage: /settings set <key> <value> | reset",

      ];

      return lines.join("\n");

    },

  },



  stats: {

    help: "/stats - Show session stats, cost summary, and provider health",

    run: async (_args, ctx) => {

      const lines: string[] = [];

      const session = ctx.session;

      const messages = session?.messages ?? [];

      const userCount = messages.filter((m: any) => m.role === "user").length;

      const assistantCount = messages.filter((m: any) => m.role === "assistant").length;

      const toolCount = messages.filter((m: any) => m.role === "tool").length;

      lines.push("Session:");

      lines.push(`  messages: ${messages.length} (user: ${userCount}, assistant: ${assistantCount}, tool: ${toolCount})`);



      const tracker = ctx.costTracker ?? ctx.tui.costTracker;

      if (tracker) {

        lines.push("");

        lines.push("Cost:");

        lines.push(tracker.formatSummary());

      } else {

        lines.push("");

        lines.push("Cost: (not available)");

      }



      lines.push("");

      lines.push("Provider health:");

      try {

        const statuses = await ctx.router.healthAll();

        if (statuses.length === 0) {

          lines.push("  (no providers)");

        } else {

          for (const s of statuses) {

            const state = s.healthy ? "healthy" : s.circuitOpen ? "OPEN" : "unhealthy";

            const err = s.lastError ? ` (${s.lastError})` : "";

            lines.push(`  ${s.provider}: ${state}${err}`);

          }

        }

      } catch (err) {

        lines.push(`  (health check failed: ${(err as Error).message})`);

      }

      return lines.join("\n");

    },

  },



  quit: {



    help: "/quit - Exit the TUI",

    run: (_args: string[], ctx: CommandContext) => {

      ctx.tui.exit();

    },

  },




  "reset-health": {
    help: "/reset-health - Reset health state for all providers",
    run: (_args: string[], ctx: CommandContext) => {
      ctx.router.resetHealth();
      ctx.tui.showSystem("Health state reset for all providers.");
    },
  },

  skills: {

    help: "/skills - List available custom skills",

    run: (_args: string[], ctx: CommandContext) => {

      const skills = (ctx.skills ?? Skills.instance()) as Skills;

      const list = skills.list();

      if (list.length === 0) {

        ctx.tui.showSystem("No skills found. Add .md files to ~/.aether/skills/.");

        return;

      }

      const lines = list.map((s) => `  ${s.name} - ${s.description}`);

      ctx.tui.showSystem("Skills:\n" + lines.join("\n"));

    },

  },



  skill: {

    help: "/skill <name> [args] - Run a custom skill",

    run: async (args: string[], ctx: CommandContext) => {

      const skills = (ctx.skills ?? Skills.instance()) as Skills;

      const name = args[0];

      if (!name) {

        return "Usage: /skill <name> [args]";

      }

      const skill = skills.get(name);

      if (!skill) {

        return `Unknown skill "${name}". Available: ${skills.list().map((s) => s.name).join(", ") || "(none)"}`;

      }

      const rest = args.slice(1);

      const argsObj: Record<string, string> = {};

      for (let i = 0; i < rest.length; i++) {

        const part = rest[i];

        const eq = part.indexOf("=");

        if (eq !== -1) {

          argsObj[part.slice(0, eq).trim()] = part.slice(eq + 1);

        } else if (skill.arguments[i]) {

          argsObj[skill.arguments[i]] = part;

        } else {

          argsObj["arg" + i] = part;

        }

      }

      const prompt = skills.render(name, argsObj);

      let result = "";

      try {

        for await (const chunk of ctx.agent.run(prompt, ctx.session.messages)) {

          if (chunk.type === "text" && chunk.text) result += chunk.text;

          if (chunk.type === "error" && chunk.error) {

            result += "\n[error] " + chunk.error;

          }

        }

      } catch (err) {

        return `Skill error: ${(err as Error).message}`;

      }

      if (!result.trim()) return "(no output)";

      ctx.tui.showSystem(result);

    },
  },

  connect: {

    help: "/connect <provider> <api_key> - Connect an API key for a provider",

    run: async (args: string[], ctx: CommandContext) => {

      const provider = args[0] ?? "";

      const key = args.slice(1).join("").trim();

      if (!provider) {

        ctx.tui.showSystem("Usage: /connect <provider> <api_key>");

        return;

      }

      if (!key) {

        ctx.tui.showSystem("Usage: /connect <provider> <api_key>");

        return;

      }

      const names = ctx.router.getProviderNames();

      if (!names.includes(provider)) {

        ctx.tui.showSystem(`Unknown provider "${provider}". Available: ${names.join(", ") || "(none)"}`);

        return;

      }

      ctx.router.setKey(provider, key);

      ctx.tui.showSystem(`Connected ${provider}.`);

      ctx.tui.showSystem("Testing...");

      try {

        const statuses = await ctx.router.healthAll();

        const s = statuses.find((x: any) => x.provider === provider);

        if (s) {

          const state = s.healthy ? "healthy" : s.circuitOpen ? "OPEN" : "unhealthy";

          ctx.tui.showSystem(`${provider}: ${state}${s.lastError ? " (" + s.lastError + ")" : ""}`);

        } else {

          ctx.tui.showSystem(`${provider}: no status returned`);

        }

      } catch (err) {

        ctx.tui.showSystem(`Health check failed: ${(err as Error).message}`);

      }

    },

  },



  keys: {

    help: "/keys - List which providers have API keys configured",

    run: (_args: string[], ctx: CommandContext) => {

      const list = ctx.router.keys ? ctx.router.keys.list() : [];

      if (list.length === 0) {

        ctx.tui.showSystem("No known providers.");

        return;

      }

      const lines = list.map((e: any) => `  ${e.provider}: ${e.hasKey ? "yes" : "no"}`);

      ctx.tui.showSystem("API keys:\n" + lines.join("\n"));

    },

  },



  disconnect: {

    help: "/disconnect <provider> - Remove an API key",

    run: (args: string[], ctx: CommandContext) => {

      const provider = args.join(" ").trim();

      if (!provider) {

        ctx.tui.showSystem("Usage: /disconnect <provider>");

        return;

      }

      if (ctx.router.keys && ctx.router.keys.has(provider)) {

        ctx.router.keys.remove(provider);

        ctx.router.setKey(provider, "");

        ctx.tui.showSystem(`Disconnected ${provider}.`);

      } else {

        ctx.tui.showSystem(`No key configured for ${provider}.`);

      }

    },

  },

};









