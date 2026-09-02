import type { Message } from "./types.js";

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

export function estimateMessageTokens(m: Message): number {
  let n = estimateTokens(typeof m.content === "string" ? m.content : m.content.map((p) => p.type === "text" ? p.text : "").join(""));
  if (m.tool_calls) {
    for (const tc of m.tool_calls) {
      n += estimateTokens(tc.function.name) + estimateTokens(tc.function.arguments);
    }
  }
  return n + 4; // role/name overhead
}

export function compressText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim();
}

export function compressHistory(
  messages: Message[],
  maxTokens: number
): Message[] {
  if (messages.length === 0) return [];

  const system = messages.find((m) => m.role === "system");
  const rest = system ? messages.slice(1) : messages;

  let budget = maxTokens;
  if (system) budget -= estimateMessageTokens(system);

  const kept: Message[] = [];
  let used = 0;
  // Walk from the newest backwards.
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(rest[i]);
    if (used + cost > budget) break;
    kept.unshift(rest[i]);
    used += cost;
  }

  const dropped = rest.length - kept.length;
  const result: Message[] = [];
  if (system) result.push(system);
  if (dropped > 0) {
    result.push({
      role: "system",
      content: `[${dropped} earlier message(s) omitted to fit context]`,
    });
  }
  result.push(...kept);
  return result;
}