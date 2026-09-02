import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolDef } from "../types.js";
import { getConfig } from "../config.js";
import { createProvider } from "../providers/index.js";

// Locally-installed vision-capable model (verified 2026-09-02).
const VISION_MODEL = "hf.co/OBLITERATUS/Qwen3.8-27B-OBLITERATED:Q4_K_M";

export interface VisionProvider {
  name: string;
  chatVision(
    messages: Array<{ role: string; content: string; images?: string[] }>,
    opts?: { signal?: AbortSignal; maxTokens?: number }
  ): AsyncIterable<{ text?: string; error?: string }>;
}

/**
 * Find a vision-capable provider by inspecting the configured models for the
 * known vision model. Falls back to any provider that lists the vision model.
 */
export async function findVisionProvider(): Promise<VisionProvider | null> {
  const cfg = getConfig();

  // 1. Any provider that has the vision model configured. Force the provider
  //    to use ONLY the vision model so resolveModel()/models[0] picks it.
  for (const p of cfg.providers) {
    if (!p.enabled) continue;
    if (p.models.includes(VISION_MODEL)) {
      try {
        const visionConfig: any = { ...p, models: [VISION_MODEL] };
        return wrapProvider(await createProvider(visionConfig), p.name);
      } catch {
        // try next
      }
    }
  }

  // 2. Any provider whose listModels() includes the vision model.
  for (const p of cfg.providers) {
    if (!p.enabled) continue;
    try {
      const probe = await createProvider(p);
      const models = await probe.listModels();
      if (models.includes(VISION_MODEL)) {
        const visionConfig: any = { ...p, models: [VISION_MODEL] };
        return wrapProvider(await createProvider(visionConfig), p.name);
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function wrapProvider(provider: any, name: string): VisionProvider {
  return {
    name,
    async *chatVision(messages, opts?) {
      try {
        // Ollama's OpenAI-compatible endpoint expects `content` as a string
        // plus a top-level `images` array of base64 strings on the message.
        // Other OpenAI-compatible providers accept content arrays; send the
        // Ollama form since that is the primary vision path here.
        const serialised = messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.images ? { images: m.images } : {}),
        }));
        for await (const chunk of provider.chat(serialised as any, [], {
          signal: opts?.signal,
          maxTokens: opts?.maxTokens,
        })) {
          if (chunk.type === "text" && chunk.text) yield { text: chunk.text };
          if (chunk.type === "error" && chunk.error) yield { error: chunk.error };
        }
      } catch (err) {
        yield { error: (err as Error).message };
      }
    },
  };
}

export function makeVisionTool(rootDir: string): { def: ToolDef; execute: (args: Record<string, any>) => Promise<string> } {
  return {
    def: {
      name: "DescribeImage",
      description:
        "Describe an image file at a given path using a vision-capable model. Returns a textual description.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "path to the image file" },
          question: { type: "string", default: "Describe this image in detail.", description: "question about the image" },
        },
        required: ["path"],
      },
    },
    execute: async (args) => {
      const rel = String(args.path ?? "");
      // Resolve relative to the project root, but allow absolute paths to
      // image files anywhere on the filesystem (that is the tool's purpose).
      const target = path.isAbsolute(rel)
        ? rel
        : path.resolve(rootDir, rel);
      const question = String(args.question ?? "Describe this image in detail.");

      let buf: Buffer;
      try {
        if (!fs.existsSync(target)) {
          return `ERROR: image not found: ${rel}`;
        }
        if (!fs.statSync(target).isFile()) {
          return `ERROR: path "${rel}" is not a file`;
        }
        buf = fs.readFileSync(target);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `ERROR reading image "${rel}": ${message}`;
      }

      const b64 = buf.toString("base64");

      const provider = await findVisionProvider();
      if (!provider) {
        return "No vision-capable provider available.";
      }

      const messages = [
        {
          role: "user",
          content: question,
          images: [b64],
        },
      ];

      let text = "";
      try {
        for await (const chunk of provider.chatVision(messages, { maxTokens: 1024 })) {
          if (chunk.text) text += chunk.text;
          if (chunk.error) return `ERROR: vision provider failed: ${chunk.error}`;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `ERROR: vision provider failed: ${message}`;
      }

      return text.trim() || "(no description returned)";
    },
  };
}