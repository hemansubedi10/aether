import * as fs from "node:fs";
import * as path from "node:path";
import { PROVIDER_REGISTRY } from "../src/providers/registry.js";

function parseHealth(statsText: string): { total: number; healthy: number } {
  const lines = statsText.split("\n");
  let inHealth = false;
  let healthy = 0;
  let total = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("Provider health:")) { inHealth = true; continue; }
    if (!inHealth) continue;
    if (!line) continue;
    total++;
    if (/^\s*[\w-]+:\s+healthy\b/.test(line)) healthy++;
  }
  return { total, healthy };
}

function modelCount(): number {
  let n = 0;
  for (const p of PROVIDER_REGISTRY) if (p.enabled) n += p.models.length;
  return n;
}

function main() {
  const statsPath = path.join(process.cwd(), "docs", "stats.md");
  const statsTxtPath = path.join(process.cwd(), "docs", "stats.txt");
  const statsText = fs.existsSync(statsTxtPath) ? fs.readFileSync(statsTxtPath, "utf8") : "";
  const { total, healthy } = parseHealth(statsText);
  const models = modelCount();

  let md = fs.existsSync(statsPath) ? fs.readFileSync(statsPath, "utf8") : "";

  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  md = md.replace(/_Last updated:.*_/, "_Last updated: " + stamp + "_");

  const card = [
    "<!-- stats-start -->",
    "| Metric | Value |",
    "|--------|-------|",
    "| Providers | " + total + " |",
    "| Healthy | " + healthy + " |",
    "| Unhealthy / Open | " + (total - healthy) + " |",
    "| Models (enabled) | " + models + " |",
    "<!-- stats-end -->",
  ].join("\n");

  const start = md.indexOf("<!-- stats-start -->");
  const end = md.indexOf("<!-- stats-end -->");
  if (start !== -1 && end !== -1) {
    md = md.slice(0, start) + card + md.slice(end + "<!-- stats-end -->".length);
  } else {
    md = md.trimEnd() + "\n\n" + card + "\n";
  }

  fs.writeFileSync(statsPath, md, "utf8");
  console.log("Updated docs/stats.md");
}

main();
