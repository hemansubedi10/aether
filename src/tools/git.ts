import * as path from "node:path";
import { GitTool } from "../git.js";

export function makeGitTool(rootDir: string) {
  return {
    def: {
      name: "Git",
      description: "Run git operations: status, diff, commit, log, branch. Use this to inspect version control state or make commits.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["status", "diff", "commit", "log", "branch"], description: "The git operation to perform" },
          message: { type: "string", description: "Commit message (required for commit)" },
          file: { type: "string", description: "Optional file path to limit diff" },
          count: { type: "number", description: "Number of commits to show (for log)", default: 5 }
        },
        required: ["action"]
      }
    },
    execute: async (args: Record<string, any>) => {
      if (!GitTool.isRepo(rootDir)) {
        return `ERROR: ${rootDir} is not a git repository.`;
      }
      try {
        switch (args.action) {
          case "status": {
            const files = await GitTool.status(rootDir);
            if (files.length === 0) return "Working tree clean.";
            return files.map((f) => `${f.status}\t${f.file}`).join("\n");
          }
          case "diff": {
            const d = await GitTool.diff(rootDir, args.file);
            return d || "(no differences)";
          }
          case "commit": {
            return await GitTool.commit(rootDir, args.message || "");
          }
          case "log": {
            const commits = await GitTool.log(rootDir, args.count ?? 5);
            return commits.map((c) => `${c.hash} ${c.date} ${c.message}`).join("\n");
          }
          case "branch": {
            return `Current branch: ${await GitTool.branch(rootDir)}`;
          }
          default:
            return `ERROR: unknown git action "${args.action}"`;
        }
      } catch (err) {
        return `ERROR: ${(err as Error).message}`;
      }
    }
  };
}
