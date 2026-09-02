import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { RouterEngine } from "./router-engine.js";
import type { ChatChunk } from "./types.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  engine?: RouterEngine;
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

function sendSSE(res: http.ServerResponse, chunk: ChatChunk): void {
  const data = JSON.stringify(chunk);
  res.write(`data: ${data}\n\n`);
}

async function writeSSEStream(
  res: http.ServerResponse,
  gen: AsyncGenerator<ChatChunk>
): Promise<void> {
  try {
    for await (const chunk of gen) {
      if (res.writableEnded) break;
      sendSSE(res, chunk);
    }
  } finally {
    if (!res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}

function modelsToList(models: Record<string, string[]>) {
  const data: { id: string; object: string; owned_by?: string }[] = [];
  for (const [provider, list] of Object.entries(models)) {
    for (const id of list) {
      data.push({ id, object: "model", owned_by: provider });
    }
  }
  return { object: "list", data };
}

export function createServer(opts: ServerOptions = {}): http.Server {
  const engine = opts.engine ?? new RouterEngine();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (method === "GET" && path === "/health") {
        const [all, healthies] = await Promise.all([
          engine.listFreeModels(),
          engine.healthAll(),
        ]);
        const providerCount = Object.keys(all).length;
        const healthyCount = healthies.filter((h) => h.healthy).length;
        return sendJson(res, 200, {
          status: "ok",
          providers: providerCount,
          healthy: healthyCount,
        });
      }

      if (method === "GET" && (path === "/v1/models" || path === "/models")) {
        const models = await engine.listFreeModels();
        return sendJson(res, 200, modelsToList(models));
      }

      if (method === "GET" && path === "/providers") {
        const statuses = await engine.healthAll();
        return sendJson(res, 200, statuses);
      }

      if (method === "POST" && path === "/reset-health") {
        engine.resetHealth();
        return sendJson(res, 200, { status: "ok", message: "Health state reset" });
      }

      if (method === "POST" && path === "/v1/chat/completions") {
        const body = await parseJsonBody(req);
        const { model, messages, tools, stream, temperature, max_tokens } = body ?? {};
        if (!Array.isArray(messages)) {
          return sendJson(res, 400, { error: { message: "messages array is required", type: "invalid_request_error" } });
        }

        const opts = {
          temperature: typeof temperature === "number" ? temperature : undefined,
          maxTokens: typeof max_tokens === "number" ? max_tokens : undefined,
        };

        if (stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const gen = engine.chatStream(messages, tools ?? [], opts);
          await writeSSEStream(res, gen);
          return;
        }

        const result = await engine.chat(messages, tools ?? [], opts);
        const chosenModel = model || result.model;
        return sendJson(res, 200, {
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: chosenModel,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: result.text,
                ...(result.toolCalls.length
                  ? { tool_calls: result.toolCalls.map((tc: any) => ({
                      id: tc.id || `call_${Date.now()}`,
                      type: "function",
                      function: { name: tc.function.name, arguments: tc.function.arguments ?? "" },
                    })) }
                  : {}),
              },
              finish_reason: result.toolCalls.length ? "tool_calls" : "stop",
            },
          ],
          usage: result.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          _aether: {
            attempts: result.attempts,
            provider: result.provider,
          },
        });
      }

      if (method === "POST" && path === "/v1/chat") {
        const body = await parseJsonBody(req);
        const { model, messages, tools, temperature, max_tokens } = body ?? {};
        if (!Array.isArray(messages)) {
          return sendJson(res, 400, { error: "messages array is required" });
        }
        const result = await engine.chat(messages, tools ?? [], {
          temperature: typeof temperature === "number" ? temperature : undefined,
          maxTokens: typeof max_tokens === "number" ? max_tokens : undefined,
        });
        return sendJson(res, 200, {
          text: result.text,
          toolCalls: result.toolCalls,
          usage: result.usage,
          attempts: result.attempts,
          provider: result.provider,
          model: model || result.model,
        });
      }

      sendJson(res, 404, { error: { message: `Not found: ${method} ${path}`, type: "not_found_error" } });
    } catch (err) {
      const msg = (err as Error).message;
      sendJson(res, 500, { error: { message: msg, type: "internal_error" } });
    }
  });

  return server;
}

export function startServer(opts: ServerOptions = {}): http.Server {
  const envPort = Number(process.env.AETHER_PORT);
  const port = opts.port ?? (Number.isFinite(envPort) && envPort > 0 ? envPort : 31415);
  const host = opts.host ?? "0.0.0.0";
  const engine = opts.engine ?? new RouterEngine();
  const server = createServer({ ...opts, engine });
  server.listen(port, host, () => {
    const providerCount = engine.configs_.filter((c) => c.enabled).length;
    console.log(`Aether free-model server running at http://localhost:${port}`);
    console.log(`Endpoints:`);
    console.log(`  GET  /health`);
    console.log(`  GET  /v1/models`);
    console.log(`  POST /v1/chat/completions`);
    console.log(`  POST /v1/chat`);
    console.log(`  GET  /providers`);
    console.log(`  POST /reset-health`);
    console.log(`Providers: ${providerCount} configured`);
  });
  return server;
}




if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  try {
    const server = startServer();
    server.on("error", (err: NodeJS.ErrnoException) => {
      console.error("Failed to start server:", err);
      process.exit(1);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}



