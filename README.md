  _   _      _      __  __  ___  
 | \ | |    / \    |  \/  |/ _ \
 |  \| |   / _ \   | |\/| | | | |
 | |\  |  / ___ \  | |  | | |_| |
 |_| \_| /_/   \_\ |_|  |_|\___/

# Aether

[![GitHub stars](https://img.shields.io/github/stars/hemansubedi10/aether?style=for-the-badge&color=blue)](https://github.com/hemansubedi10/aether)
[![GitHub forks](https://img.shields.io/github/forks/hemansubedi10/aether?style=for-the-badge&color=green)](https://github.com/hemansubedi10/aether)
[![GitHub issues](https://img.shields.io/github/issues/hemansubedi10/aether?style=for-the-badge&color=red)](https://github.com/hemansubedi10/aether)
[![GitHub workflow status](https://img.shields.io/github/actions/workflow/status/hemansubedi10/aether/update-preview.yml?style=for-the-badge&color=blueviolet)](https://github.com/hemansubedi10/aether/actions)
[![Node version](https://img.shields.io/node/v?style=for-the-badge&color=yellow)](https://nodejs.org)
[![License](https://img.shields.io/github/license/hemansubedi10/aether?style=for-the-badge&color=orange)](https://github.com/hemansubedi10/aether/blob/main/LICENSE)

**An advanced, free, unlimited LLM CLI agent with multi-provider routing, automatic failover, and agentic tool use.**

Aether is a Claude Code / Kilo-class AI agent for your terminal. It unifies every model behind one interface — local Ollama models, OpenRouter free-tier, and any OpenAI-compatible endpoint — so you can switch models on the fly without changing your workflow. It runs fully local with **zero token limits and zero cost**, tracks provider health with a circuit breaker, and drives real tools (read, write, edit, glob, grep, bash, git, web search, and vision) in an agentic loop. No API keys required to get started.

## What is Aether?

Aether is a TypeScript CLI agent that turns your terminal into an autonomous coding assistant. At its heart is a **router** that keeps a priority-ordered list of providers and automatically fails over when one degrades. A **health tracker** opens a circuit breaker on repeated failures, so bad providers get skipped instead of blocking you. Everything streams through a ChatGPT-style TUI, and sessions, costs, checkpoints, and custom skills all persist on disk.

## Features

| Feature | Description |
|---------|-------------|
| **?? Multi-provider routing** | One unified interface over Ollama, OpenRouter free-tier, and any OpenAI-compatible endpoint. Switch with `/model` and `/provider`. |
| **??? Automatic failover** | If a provider throws, the router records the failure and moves to the next enabled provider. A single consolidated error is yielded only if every provider is down. |
| **?? Circuit breaker health tracking** | Per-provider health state: failures, last check, circuit open/closed, and cooldown. `/providers` shows live status. |
| **?? Agentic tool loop** | The model drives tools until it stops requesting them: `read_file`, `write_file`, `edit_file`, `list_dir`, `bash`, `glob`, `grep`, `web_search`, `vision`, and `git`. |
| **?? Streaming TUI** | A ChatGPT-style terminal interface with streaming output, conversation history, regenerate, and side-by-side model comparison. |
| **?? Persistent memory** | Long-term memory stored on disk so the agent remembers you across sessions. |
| **?? Plan / Yolo modes** | `--plan` for step-by-step approval, `--yolo` for autonomous execution. |
| **?? Token & cost tracker** | Per-provider, per-model request, input/output token counts, and estimated USD cost. `/cost` and `/reset-cost`. |
| **?? Tournament arena with Elo** | Blind A/B voting between models with Elo ranking and a leaderboard. `/arena`. |
| **? Custom slash commands (skills)** | Drop `.md` files in `~/.aether/skills/` to define reusable commands. `/skills` and `/skill <name>`. |
| **?? Checkpoint / undo** | Snapshot file state before edits so you can roll back. |
| **?? Session persistence** | Save, load, list, and clear named sessions as JSON under `~/.aether/sessions/`. |

## Terminal Preview

```text
+- Aether --------------------------------------------------+
¦                                                             ¦
¦  ollama-local · qwen2.5-coder:7b                           ¦
¦                                                             ¦
¦  ? Build a REST API in Node.js with CRUD endpoints          ¦
¦                                                             ¦
¦  ? [tool: read_file] src/index.ts                           ¦
¦  ? [tool: glob] src/**/*.ts                                 ¦
¦  ? [tool: edit_file] src/index.ts                           ¦
¦  ?                                                           ¦
¦  Here's a complete REST API with CRUD endpoints...          ¦
¦                                                             ¦
¦  ? Created src/routes/users.ts                              ¦
¦  ? Created src/routes/posts.ts                              ¦
¦  ? Created tests/routes/users.test.ts                       ¦
¦                                                             ¦
¦  ? _                                                         ¦
+-------------------------------------------------------------+
```

One-shot mode:

```text
$ npx tsx src/index.ts "explain this repo"
Aether is a TypeScript CLI agent that turns your terminal into an
autonomous coding assistant. At its heart is a router that keeps a
priority-ordered list of providers and automatically fails over when
one degrades...
```

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
| `/cost` | Show token usage and estimated cost summary |
| `/reset-cost` | Reset cost and token counters |
| `/settings [set <key> <value> \| reset]` | View or modify settings |
| `/stats` | Show session stats, cost summary, and provider health |
| `/skills` | List available custom skills |
| `/skill <name> [args]` | Run a custom skill |
| `/exit` (or `/quit`) | Exit the TUI |

## Getting Started

Aether is TypeScript and runs via `tsx` — zero runtime dependencies.

```bash
git clone https://github.com/hemansubedi10/aether.git
cd aether
npx tsx src/index.ts "your prompt here"   # one-shot
npx tsx src/index.ts                       # interactive TUI
```

Optional env vars for one-shot mode:

```bash
AETHER_PROVIDER=ollama-local AETHER_MODEL=qwen2.5-coder:7b \
  npx tsx src/index.ts "refactor this"
```

## Providers

- **Ollama local** — unlimited, no token limits, no auth. Make sure Ollama is running and the models are pulled.
- **OpenRouter free-tier** — access free models on the OpenRouter network.
- **OpenAI-compatible** — point at any OpenAI-compatible endpoint.

Configure providers in your Aether config; priority order and enable/disable are all configurable.

## Why Aether?

| | Claude Code / Kilo | Aether |
|---|---|---|
| **Cost** | Paid API usage | **Free & unlimited** via local Ollama |
| **Provider lock-in** | One vendor | **Multi-provider** with automatic failover |
| **Offline** | Cloud-only | **Fully local** when Ollama is running |
| **Token limits** | Bounded by vendor | **Unlimited** on local models |
| **Health awareness** | Retry only | **Circuit breaker** + health radar |
| **License** | Proprietary | **MIT** |

Aether is not affiliated with Anthropic, Kilo, or any provider. It is an independent, open-source project.

## License

MIT
