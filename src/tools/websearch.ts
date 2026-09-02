import type { ToolDef } from "../types.js";

const DDG_URL = "https://html.duckduckgo.com/html/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Parse DuckDuckGo HTML results into a list of {title, url, snippet}.
 * DDG wraps real URLs in a redirect (`uddg` query param); we unwrap them.
 */
export function parseDdgResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  // Each result is an <a class="result__a"> whose href points at the redirect.
  const linkRe = /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  // Snippets live in <a class="result__snippet"> ... </a>.
  const snippetRe = /<a\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const rawSnippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) {
    rawSnippets.push(stripTags(sm[1] ?? ""));
  }

  let idx = 0;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html)) !== null) {
    const href = lm[1] ?? "";
    const title = stripTags(lm[2] ?? "").trim();
    if (!title) continue;
    const url = unwrapRedirect(href);
    if (!url) continue;
    const snippet = rawSnippets[idx] ?? "";
    results.push({ title, url, snippet });
    idx++;
  }
  return results;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapRedirect(href: string): string {
  // DDG wraps real URLs in a redirect like:
  //   //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=...
  // The real destination is the `uddg` query param. The hostname can vary
  // (html.duckduckgo.com or duckduckgo.com) and the link may be protocol-
  // relative, so we key off the /l/ path and the uddg param instead.
  try {
    const u = new URL(href, "https://html.duckduckgo.com/");
    if (u.pathname === "/l/") {
      const target = u.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }
  } catch {
    // fall through
  }
  // Some results are absolute URLs directly.
  if (/^https?:\/\//i.test(href)) return href;
  return "";
}

export function makeWebSearchTool(): { def: ToolDef; execute: (args: Record<string, any>) => Promise<string> } {
  return {
    def: {
      name: "WebSearch",
      description:
        "Search the web for current information. Returns titles, URLs, and snippets. Use for recent events or facts not in the project.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "the search query" },
          maxResults: { type: "number", default: 5, description: "max number of results to return" },
        },
        required: ["query"],
      },
    },
    execute: async (args) => {
      const query = String(args.query ?? "").trim();
      if (!query) return "ERROR: query is required";
      const maxResults = Math.max(1, Math.min(20, Number(args.maxResults) || 5));

      let res: Response;
      try {
        const url = `${DDG_URL}?${new URLSearchParams({ q: query }).toString()}`;
        res = await fetch(url, {
          method: "GET",
          headers: { "User-Agent": USER_AGENT, "Accept": "text/html" },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `ERROR: WebSearch network failure: ${message}`;
      }

      if (!res.ok) {
        return `ERROR: WebSearch failed: HTTP ${res.status}`;
      }

      let html = "";
      try {
        html = await res.text();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `ERROR: WebSearch failed to read response: ${message}`;
      }

      const parsed = parseDdgResults(html).slice(0, maxResults);
      if (parsed.length === 0) {
        return "No matches found";
      }
      return parsed
        .map((r, i) => `${i + 1}. ${r.title} - ${r.url}\n   ${r.snippet}`)
        .join("\n\n");
    },
  };
}