import type { ChatChunk } from "./types.js";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { Session } from "./session.js";

export interface CommandContext {
  tui: any;
  agent: any;
  router: any;
  session: any;
  arena: any;
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
    run: (_args, ctx) => {
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
    run: (args, ctx) => {
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
    run: (args, ctx) => {
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
    run: (args, ctx) => {
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
    run: (_args, ctx) => {
      ctx.tui.enterArena();
    },
  },

  exit: {
    help: "/exit - Exit the TUI",
    run: (_args, ctx) => {
      ctx.tui.exit();
    },
  },

  quit: {
    help: "/quit - Exit the TUI",
    run: (_args, ctx) => {
      ctx.tui.exit();
    },
  },
};