# Aether

<p align="center"><img src="assets/aether-banner.svg" alt="Aether Banner" width="100%"></p>

[![GitHub stars](https://img.shields.io/github/stars/hemansubedi10/aether?style=for-the-badge&color=blue)](https://github.com/hemansubedi10/aether)
[![GitHub forks](https://img.shields.io/github/forks/hemansubedi10/aether?style=for-the-badge&color=green)](https://github.com/hemansubedi10/aether)
[![GitHub issues](https://img.shields.io/github/issues/hemansubedi10/aether?style=for-the-badge&color=red)](https://github.com/hemansubedi10/aether)
[![GitHub workflow status](https://img.shields.io/github/actions/workflow/status/hemansubedi10/aether/update-preview.yml?style=for-the-badge&color=blueviolet)](https://github.com/hemansubedi10/aether/actions)
[![Node version](https://img.shields.io/node/v?style=for-the-badge&color=yellow)](https://nodejs.org)
[![License](https://img.shields.io/github/license/hemansubedi10/aether?style=for-the-badge&color=orange)](https://github.com/hemansubedi10/aether/blob/main/LICENSE)

**The free, unlimited, multi-provider LLM CLI -- install like KiloCode, run like Claude Code.**

<p align="center"><img src="assets/aether-router.svg" alt="Multi-provider routing with automatic failover" width="100%"></p>

Aether is a Claude Code / Kilo-class AI agent for your terminal. It unifies every model behind one interface -- local Ollama models, OpenRouter free-tier, and any OpenAI-compatible endpoint -- so you can switch models on the fly without changing your workflow. It runs fully local with **zero token limits and zero cost**, tracks provider health with a circuit breaker, and drives real tools (read, write, edit, glob, grep, bash, git, web search, and vision) in an agentic loop. No API keys required to get started.

## What is Aether?

Aether is a TypeScript CLI agent that turns your terminal into an autonomous coding assistant. At its heart is a **router** that keeps a priority-ordered list of providers and automatically fails over when one degrades. A **health tracker** opens a circuit breaker on repeated failures, so bad providers get skipped instead of blocking you. Everything streams through a ChatGPT-style TUI, and sessions, costs, checkpoints, and custom skills all persist on disk.

## Features

<p align="center"><img src="assets/aether-arena.svg" alt="Live Model Arena" width="100%"></p>

| Feature | Description |
|---------|-------------|
| Multi-provider routing | One unified interface over Ollama, OpenRouter free-tier, and any OpenAI-compatible endpoint. Switch with `/model` and `/provider`. |
| Automatic failover | If a provider throws, the router records the failure and moves to the next enabled provider. A single consolidated error is yielded only if every provider is down. |
| Circuit breaker health tracking | Per-provider health state: failures, last check, circuit open/closed, and cooldown. `/providers` shows live status. |
| Agentic tool loop | The model drives tools until it stops requesting them: `read_file`, `write_file`, `edit_file`, `list_dir`, `bash`, `glob`, `grep`, `web_search`, `vision`, and `git`. |
| Streaming TUI | A ChatGPT-style terminal interface with streaming output, conversation history, regenerate, and side-by-side model comparison. |
| Persistent memory | Long-term memory stored on disk so the agent remembers you across sessions. |
| Plan / Yolo modes | `--plan` for step-by-step approval, `--yolo` for autonomous execution. |
| Token & cost tracker | Per-provider, per-model request, input/output token counts, and estimated USD cost. `/cost` and `/reset-cost`. |
| Tournament arena with Elo | Blind A/B voting between models with Elo ranking and a leaderboard. `/arena`. |
| Custom slash commands (skills) | Drop `.md` files in `~/.aether/skills/` to define reusable commands. `/skills` and `/skill <name>`. |
| Checkpoint / undo | Snapshot file state before edits so you can roll back. |
| Session persistence | Save, load, list, and clear named sessions as JSON under `~/.aether/sessions/`. |
| Named combos | Group providers into named combos and switch between them in one step. `/combo`. |
| One repo, two tools | The same routing engine powers both the CLI agent and an HTTP server (`npx tsx src/server.ts`). |
## The CLI

Aether installs like KiloCode and runs like Claude Code. One line, no setup beyond Node.js 20+.

### CLI flags

`aether-ai` understands standard flags before the prompt:

| Flag | Description |
|------|-------------|
| `-v`, `--version` | Print the version (`aether-ai 1.0.0`) and exit |
| `-h`, `--help` | Print the help text (same as `/help`) and exit |
| `--plan` | Start in plan mode (step-by-step approval) |
| `--yolo` | Start in yolo mode (autonomous execution) |
| `--no-stream` | Disable streaming output in one-shot mode |

```text
$ aether-ai --version
aether-ai 1.0.0

$ aether-ai --help
Aether - the free, unlimited, multi-provider LLM CLI

Usage: aether-ai [options] [prompt]

Options:
  -h, --help        Show this help text and exit
  -v, --version     Print the version and exit
  --plan            Run in plan mode (step-by-step approval)
  --yolo            Run in yolo mode (autonomous execution)
  --no-stream       Disable streaming output in one-shot mode
```

Flags are parsed from `process.argv` before the remaining args are treated as the prompt, so `aether-ai --yolo "fix the tests"` runs the prompt in yolo mode.
### Install

| Platform | Command |
|----------|---------|
| Windows | `irm install.ps1 | iex` |
| macOS / Linux | `curl -fsSL install.sh | bash` |
| Manual | `git clone https://github.com/hemansubedi10/aether && cd aether && npx tsx src/index.ts` |

The installers drop `aether` and `aether-server` on your `PATH`, install dependencies, and verify Node.js 20+.

### Zero install for a try

`npx` runs the source directly -- no clone, no install:

```text
$ npx tsx src/index.ts "explain this repo"
Aether is a TypeScript CLI agent that turns your terminal into an
autonomous coding assistant. At its heart is a router that keeps a
priority-ordered list of providers and automatically fails over when
one degrades...
```

## Visual Demo

```text
$ npx tsx src/index.ts

+- Aether --------------------------------------------------+
|                                                           |
|  ollama-local Â· qwen2.5:7b                                |
|                                                           |
|  ? Build a REST API in Node.js with CRUD endpoints         |
|                                                           |
|  ? [tool: read_file] src/index.ts                          |
|  ? [tool: glob] src/**/*.ts                                |
|  ? [tool: edit_file] src/routes/users.ts                   |
|  ?                                                         |
|  Here's a complete REST API with CRUD endpoints...         |
|                                                           |
|  ? Created src/routes/users.ts                             |
|  ? Created src/routes/posts.ts                             |
|  ? Created tests/routes/users.test.ts                      |
|                                                           |
|  ? _                                                       |
+-----------------------------------------------------------+
```

Arena output:

```text
$ npx tsx src/index.ts /arena

  ? Prompt: write a hello world server
  ? Running 3 models in parallel...
  ? [Model A] ollama-local Â· qwen2.5:7b
  ? [Model B] openrouter-free Â· llama-3.1-8b:free
  ? [Model C] groq Â· llama-3.1-8b-instant
  ? Voting...
  ? Winner: Model A (Elo +12)

  ELO LEADERBOARD
  1. Model A    1240  ââââââââââââ
  2. Model B    1215  ââââââââââ
  3. Model C    1142  ââââââââ
```

Session stats:

```text
$ npx tsx src/index.ts /stats

  Aether Stats
  ------------
  Requests:      47
  Input tokens:  182,431
  Output tokens: 41,092
  Est. cost:     $0.00 (all free providers)

  Provider health
  ollama-local       healthy  0 failures
  openrouter-free    healthy  0 failures
  groq               healthy  0 failures
```

## Features

| Feature | Description |
|---------|-------------|
| Multi-provider routing | One interface over Ollama, OpenRouter free-tier, and any OpenAI-compatible endpoint. `/model` and `/provider`. |
| Automatic failover | On error the router moves to the next enabled provider. One consolidated error only if every provider is down. |
| Circuit breaker | 3 failures open the circuit for 60s; the provider is skipped instead of blocking you. |
| Agentic tool loop | `read_file`, `write_file`, `edit_file`, `list_dir`, `bash`, `glob`, `grep`, `web_search`, `vision`, `git`. |
| Streaming TUI | ChatGPT-style interface with streaming, history, regenerate, and model comparison. |
| Persistent memory | Long-term memory on disk -- the agent remembers you across sessions. |
| Plan / Yolo | `--plan` for step-by-step approval, `--yolo` for autonomous execution. |
| Cost tracker | Per-provider, per-model input/output token counts and USD estimates. `/cost`, `/reset-cost`. |
| Arena with Elo | Blind A/B voting between models with Elo ranking. `/arena`. |
| Custom skills | Drop `.md` files in `~/.aether/skills/`. `/skills`, `/skill <name>`. |
| Checkpoint / undo | Snapshot file state before edits so you can roll back. |
| Sessions | Save, load, list, and clear named sessions as JSON. |
| Combos | Named groups of providers -- create and switch in one step. |
| HTTP server | Same engine as a server (`npx tsx src/server.ts`) for embedding. |

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/model <name>` | Switch the active model |
| `/provider <name>` | Switch the active provider |
| `/models` | List all available models across providers |
| `/providers` | Show provider health status |
| `/combo list | create <name> [provider...] | select <name> | delete <name>` | Manage named provider/model combos |
| `/session save [name] | load <name> | list | clear` | Manage sessions |
| `/arena` | Enter arena mode (compare models) |
| `/cost` | Show token usage and estimated cost summary |
| `/reset-cost` | Reset cost and token counters |
| `/settings [set <key> <value> | reset]` | View or modify settings |
| `/stats` | Show session stats, cost summary, and provider health |
| `/skills` | List available custom skills |
| `/skill <name> [args]` | Run a custom skill |
| `/connect <provider> <api_key>` | Connect an API key (saved to `~/.aether/keys.json`) |
| `/keys` | List which providers have API keys configured |
| `/disconnect <provider>` | Remove an API key |
| `/exit` (or `/quit`) | Exit the TUI |

## How It Works

Your prompt flows from the CLI, through the Router, and out to whichever provider is best right now.

```text
  Your Prompt
      v
  +-------------+
  |  Aether CLI  |  <- streaming TUI, tools, memory, arena
  +------^-------+
         v
  +-------------+
  |   Router    |  <- priority order, circuit breaker, automatic failover
  +------^-------+
    v v v v v v v
  +---+---+---+---+---+---+---+
  |Ollama|OpenRouter|Groq|Gemini|Mistral|...|  <- 17 free providers
  +---+---+---+---+---+---+---+
```

- **CLI** -- the streaming TUI (`npx tsx src/index.ts`) plus the one-shot runner. It holds your tools, memory, sessions, and skills.
- **Router** (`src/router-engine.ts`) -- keeps a priority-ordered list of providers, runs a circuit breaker, and fails over automatically when one degrades. API keys live in the `KeyManager` (`src/keys.ts`).
- **Providers** -- local Ollama, OpenRouter free-tier, and any OpenAI-compatible endpoint. Each is wrapped behind one interface so the router never cares which one is speaking.

## Combos

Combos are named groups of providers/models that you create once and switch between in a single step -- no more juggling `/provider` and `/model` separately. Combos persist to `~/.aether/combos.json`.

Two built-ins ship with every install:

- `local` -- Ollama only (priority 1, truly unlimited, no key)
- `cloud` -- every enabled cloud provider

```text
# Create a fast combo: Ollama + Groq
npx tsx src/index.ts /combo create fast ollama-local groq

# Select it (sets the active provider + model in one step)
npx tsx src/index.ts /combo select fast

# List all combos
npx tsx src/index.ts /combo list

# Delete a custom combo
npx tsx src/index.ts /combo delete fast
```

Combos are unique to Aether: they let you define a "mode" once -- `fast`, `cheap`, `max-quality`, `local-only` -- and flip between them instantly.

## The Providers

Aether is **one repo, two tools**. The same routing engine powers the CLI agent and an HTTP server, so you can embed Aether into any app, gateway, or proxy.

## Install the Provider Server

Run the server and it becomes an OpenAI-compatible API backed by all 17 free providers with automatic failover.

```text
$ npx tsx src/server.ts
Aether free-model server running at http://localhost:31415
Endpoints:
  GET  /health
  GET  /v1/models
  POST /v1/chat/completions
  POST /v1/chat
  GET  /providers
  POST /reset-health
Providers: 17 configured
```

Set a custom port with `AETHER_PORT=8080 npx tsx src/server.ts`.

| Method & Path | Description |
|---------------|-------------|
| `GET /health` | Overall status: provider count and healthy count |
| `GET /v1/models` | OpenAI-compatible model list across all providers |
| `GET /providers` | Live health status for every provider |
| `POST /v1/chat/completions` | OpenAI-compatible chat (streaming + non-streaming) |
| `POST /v1/chat` | Aether-native chat (includes `provider`, `attempts`) |
| `POST /reset-health` | Reset the circuit breaker for all providers |

```text
# Any OpenAI client now talks to Aether:
$ curl -s http://localhost:31415/v1/models | jq '.data[].id' | head
llama-3.1-8b-instant
mistral-small-latest
deepseek-chat
```

## Provider List

All 17 providers ship in the registry (`src/providers/registry.ts`). Priority 1 is local Ollama -- truly unlimited and key-free.

| # | Provider | Type | Free | Priority |
|---|----------|------|------|----------|
| 1 | **ollama-local** | Ollama | free, unlimited | 1 |
| 2 | **openrouter-free** | OpenRouter | free tier | 2 |
| 3 | **groq** | OpenAI-compat | 1M tokens/day | 3 |
| 4 | **mistral** | OpenAI-compat | free tier | 4 |
| 5 | **cohere** | OpenAI-compat | free tier | 5 |
| 6 | **huggingface** | OpenAI-compat | free | 6 |
| 7 | **fireworks** | OpenAI-compat | free tier | 7 |
| 8 | **together** | OpenAI-compat | free tier | 8 |
| 9 | **deepseek** | OpenAI-compat | pay-as-you-go | 9 |
| 10 | **gemini** | OpenAI-compat | free tier | 10 |
| 11 | **xai** | OpenAI-compat | free tier | 11 |
| 12 | **perplexity** | OpenAI-compat | free tier | 12 |
| 13 | **cerebras** | OpenAI-compat | free tier | 13 |
| 14 | **nvidia** | OpenAI-compat | free tier | 14 |
| 15 | **jina** | OpenAI-compat | free | 15 |
| 16 | **parasail** | OpenAI-compat | free tier | 16 |
| 17 | **featherless** | OpenAI-compat | free tier | 17 |

Disabled by default (need a custom base URL): `openai-compatible`, `cloudflare`, `voyage`. Enable them by setting a base URL in `~/.aether/config.json`.

## Connect Cloud Providers

Two methods -- env vars for a quick session, `/connect` for permanent keys saved to `~/.aether/keys.json`.

```text
# Method A: environment variables (temporary, per-session)
export OPENROUTER_API_KEY="sk-or-..."
export GROQ_API_KEY="gsk_..."
npx tsx src/index.ts "ask groq something"

# Method B: /connect command (permanent, saved to ~/.aether/keys.json)
npx tsx src/index.ts /connect openrouter-free sk-or-...
npx tsx src/index.ts /connect groq gsk_...
npx tsx src/index.ts /keys        # list what is connected

# Remove a key
npx tsx src/index.ts /disconnect groq
```

Keys are stored locally in `~/.aether/keys.json` and are never uploaded.

## Health & Failover

Aether never blocks on a bad provider. The router (`src/health.ts`) runs a **circuit breaker**:

- Each provider tracks `failures`, `lastCheck`, `circuitOpen`, and `cooldownUntil`.
- After **3 failures** the circuit opens and the provider is skipped for **60 seconds**.
- After cooldown the circuit goes half-open: one probe request is allowed. If it succeeds, the circuit closes; if it fails, the cooldown restarts.
- Requests always try providers in **priority order** and automatically fail over. A single consolidated error is returned only if every enabled provider is down.

```text
$ npx tsx src/index.ts /providers

  Provider         Status   Failures   Circuit
  ollama-local     healthy  0          closed
  openrouter-free  healthy  0          closed
  groq             warning  3          open (42s left)
  mistral          healthy  0          closed
```

Use `/reset-health` (or `POST /reset-health` on the server) to clear the circuit breaker at any time.

## Free API Keys

No credit card required for any of these:

- **OpenRouter** (openrouter.ai) -- free tier, no card, many free models. Sign up in 10 seconds.
- **Groq** (groq.com) -- 1M tokens/day free, great speed.
- **HuggingFace** (huggingface.co) -- free inference API, no card.
- **Cohere** (cohere.ai) -- free tier for `command-r`.
- **Mistral** (mistral.ai) -- free tier for `mistral-small`.
- **DeepSeek** (deepseek.com) -- pay-as-you-go, very cheap (not free, but near-zero cost).

Local Ollama needs **no key at all** -- just `ollama serve` running.

---

## Wrap-Up

Aether is the CLI that installs like KiloCode and runs like Claude Code, with two unique ideas that no other agent has:

1. **Combos** -- named groups of providers you create and switch between in one step (`/combo`).
2. **Circuit breaker** -- providers that fail get blacklisted temporarily, so they never block you.

Add in local-first Ollama (priority 1, zero cost), zero-install one-shot mode (`npx tsx src/index.ts "prompt"`), and one repo powering both a CLI and an HTTP server, and you have the free, unlimited, multi-provider LLM agent.

[MIT License](LICENSE) -- built by [Hemansubedi10](https://github.com/hemansubedi10).

Full docs: [docs/aether.md](docs/aether.md) | [INSTALL.md](INSTALL.md) | [Report an issue](https://github.com/hemansubedi10/aether/issues)

## Install via npm

```bash
npm install -g aether-ai
aether-ai "your prompt"
```

The package is published on npm: [npmjs.com/package/aether-ai](https://www.npmjs.com/package/aether-ai).

## Publishing

Aether is published on npm as **`aether-ai`**. New versions are published automatically by a GitHub Actions workflow using npm **Trusted Publishing**. There is no npm token to manage — GitHub Actions authenticates to npm via OpenID Connect.

### Trusted Publishing (OIDC - no token needed)

To release a new version:

```bash
./scripts/release.sh patch   # or minor / major
```

That script bumps the version, commits, tags (e.g. `v1.0.1`), and pushes. Pushing a `v*` tag triggers the `publish.yml` workflow, which builds and runs `npm publish --access public` with no token.

You can also trigger a publish manually from the Actions tab.
