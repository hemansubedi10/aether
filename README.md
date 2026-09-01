# Aether

**An advanced, free, unlimited LLM CLI agent with multi-provider routing, automatic failover, and agentic tool use.**

Aether is a Claude Code / Kilo-class CLI that routes every model through one unified interface. All free, no token limits — it runs local models via Ollama and can also tap OpenRouter free-tier and OpenAI-compatible endpoints. Switch models and providers on the fly, talk to your files with real tools, and track provider health with automatic failover.

## Features

| # | Feature | Status |
|---|---------|--------|
| 1 | **Live Model Arena** — blind A/B voting with Elo ranking, leaderboard page | ? |
| 2 | **Visual Pipeline Studio** — drag-drop DAG editor | ? |
| 3 | **IDE Subscription Interceptor** — MITM proxy | ? |
| 4 | **Provider Health Radar** — rate-limit detection, heatmap, circuit breaker | ? |
| 5 | **Token-Saver (RTK + Caveman)** — input compression | ? |
| 6 | **Streaming Chat Playground** — ChatGPT-style TUI, history, regenerate, side-by-side | ? |
| 7 | **RAG / Document Q&A** — upload, embed, query with citations | ? |
| 8 | **Public Tunnel + Shareable Combos** — Cloudflare tunnel, template library | ? |

## Architecture

Aether is built around a small, clean pipeline:

1. **Router** (`src/router.ts`) — the heart of the system. It holds the list of configured providers, keeps an active provider/model selection, and resolves model IDs to their owning provider. Every chat call flows through `Router.chat()`, which iterates providers in priority order.
2. **Provider** (`src/providers/`) — one interface implemented by three adapters:
   - `ollama.ts` — local Ollama models. Unlimited, no token limits, no auth.
   - `openrouter.ts` — OpenRouter free-tier models.
   - `openai-compat.ts` — any OpenAI-compatible endpoint.
3. **HealthTracker** (`src/health.ts`) — per-provider health state: failures, last check, circuit breaker, and cooldown. `Router.select()` skips providers whose circuit is open, so traffic automatically fails over to the next healthy provider.
4. **Failover** — inside `Router.chat()`, if a provider throws, its failure is recorded and the router moves to the next enabled provider. If every provider fails, a single consolidated error is yielded.
5. **Agentic tool loop** (`src/agent.ts`) — the `Agent` drives the model until it stops requesting tools. Tools (`src/tools/`) include `read_file`, `write_file`, `edit_file`, `list_dir`, and `bash`, registered in a `ToolRegistry`.
6. **Streaming TUI** (`src/tui.ts`) — a ChatGPT-style terminal interface with streaming output, conversation history, regenerate, side-by-side model comparison, and slash commands.
7. **Session persistence** (`src/session.ts`) — save/load/clear named sessions as JSON under `~/.aether/sessions/`.
8. **Arena** (`src/arena.ts`) — blind A/B voting between models with Elo ranking and a leaderboard.

```
CLI (index.ts)
  +- Router -- HealthTracker -- Provider (ollama | openrouter | openai-compat)
                   ¦
                   +- Agent -- ToolRegistry (filesystem tools)
                   +- Session (JSON persistence)
                   +- Arena (Elo ranking)
```

## Getting Started

```bash
cd aether
npx tsx src/index.ts "your prompt here"   # one-shot
npx tsx src/index.ts                       # interactive TUI
```

Aether is TypeScript and runs via `tsx` — zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/model <name>` | Switch the active model |
| `/provider <name>` | Switch the active provider |
| `/models` | List all available models across providers |
| `/providers` | Show provider health status |
| `/session save [name] \| load <name> \| list \| clear` | Manage sessions |
| `/arena` | Enter arena mode (compare models) |
| `/exit` (or `/quit`) | Exit the TUI |

## Providers

- **Ollama local** — unlimited, no token limits, no auth. Just make sure Ollama is running and the models are pulled.
- **OpenRouter free-tier** — access free models on the OpenRouter network.
- **OpenAI-compatible** — point at any OpenAI-compatible endpoint.

Configure providers in your Aether config; priority order and enable/disable are all configurable.

## License

MIT
