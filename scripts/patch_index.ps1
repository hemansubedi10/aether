$ErrorActionPreference = "Stop"
$src = Get-Content -LiteralPath "C:\Users\heman\aether\src\index.ts" -Raw

$src = $src.Replace("function makeRouterAdapter(engine: RouterEngine) {", "function makeRouterAdapter(engine: RouterEngine, combos: any) {")

$src = $src.Replace("`n    configs: engine.configs_,", "`n    combos: combos,")

$src = $src.Replace("`n    listAllModels: () => engine.listFreeModels(),", "`n    combos: combos,`n    applyCombo: (name: string) => {`n      const c = combos.select(name);`n      if (!c) return 'Combo ' + name + ' not found.';`n      const summary = engine.applyCombo(c);`n      adapter.activeProvider = c.providers[0];`n      return summary;`n    },`n    listAllModels: () => engine.listFreeModels(),")

$src = $src.Replace("import { KeyManager } from './keys.js';", "import { KeyManager } from './keys.js';`nimport { ComboManager } from './combos.js';")

$src = $src.Replace("  const engine = new RouterEngine(undefined, undefined, KeyManager.instance());`n  const router = makeRouterAdapter(engine);`n  const registry = new ToolRegistry();", "  const engine = new RouterEngine(undefined, undefined, KeyManager.instance());`n  const combos = ComboManager.instance();`n  const router = makeRouterAdapter(engine, combos);`n  const registry = new ToolRegistry();")

$src = $src.Replace("  const engine = new RouterEngine(undefined, undefined, KeyManager.instance());`n  const router = makeRouterAdapter(engine);`n  const registry = new ToolRegistry();`n  for (const make of [makeReadFileTool", "  const engine = new RouterEngine(undefined, undefined, KeyManager.instance());`n  const combos = ComboManager.instance();`n  const router = makeRouterAdapter(engine, combos);`n  const registry = new ToolRegistry();`n  for (const make of [makeReadFileTool")

Set-Content -LiteralPath "C:\Users\heman\aether\src\index.ts" -Value $src -NoNewline
Write-Host "edited index.ts"
