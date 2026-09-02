# Install Aether

Aether is a free LLM CLI agent with multi-provider routing, failover, and agentic tool use.
Install it with one command on Windows, macOS, or Linux.

## One-command install

| OS | Command |
|---|---|
| Windows | `powershell -ExecutionPolicy Bypass -File install.ps1` |
| macOS / Linux | `bash install.sh` |

Both scripts accept a non-interactive flag so you can run them headless:

| OS | Non-interactive |
|---|---|
| Windows | `powershell -ExecutionPolicy Bypass -File install.ps1 -Yes` |
| macOS / Linux | `bash install.sh --yes` |

## Manual install

1. Ensure you have **Node.js >= 20** installed.
2. Clone the repo:

   ```bash
   git clone https://github.com/hemansubedi10/aether.git
   cd aether
   ```

3. Install dependencies:

   ```bash
   npm install typescript tsx @types/node
   ```

4. Run it directly:

   ```bash
   npx tsx src/index.ts "your prompt here"
   ```

   Or start the HTTP server:

   ```bash
   npx tsx src/server.ts
   ```

## Requirements

- Node.js **>= 20**
- (Optional) An API key for your preferred provider, configured via `/connect` or `/keys` inside the CLI.

## Verify

After installing, confirm the CLI is on your PATH:

```bash
aether --version
```
