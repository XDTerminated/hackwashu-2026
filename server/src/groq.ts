// Groq-hosted villager brain (openai/gpt-oss-120b). Same tools, clods,
// handoffs and approval gate as the Claude brain — only the model differs.

import type Anthropic from "@anthropic-ai/sdk";
import Groq from "groq-sdk";
import type { Clod, VillagerId } from "../../shared/game.js";
import { runDelegate, runLeafTool, toolsFor, missingBuildingsNote } from "./agents.js";
import { memoryNote } from "./memory.js";
import { personaFor } from "./villagers.js";
import { emit, newId, putClod, setVillager } from "./world.js";

const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
// Web searches pull in big pages; Groq rate-limits per model, so the Stargazer
// gets her own model (and her own tokens-per-minute budget).
const SEARCH_MODEL = process.env.GROQ_SEARCH_MODEL ?? "openai/gpt-oss-20b";
const MAX_TURNS = 12;

let client: Groq | null = null;
function groq(): Groq {
  // Free tier is 8k tokens/min; a multi-villager task bumps into it. The SDK
  // honors Groq's retry-after hints, so give it room to wait instead of failing.
  client ??= new Groq({ apiKey: process.env.GROQ_API ?? process.env.GROQ_API_KEY, maxRetries: 2 });
  return client;
}

type Msg = Groq.Chat.Completions.ChatCompletionMessageParam;
type GroqTool = Groq.Chat.Completions.ChatCompletionTool;

/** Our tool defs are Anthropic-shaped; Groq speaks OpenAI function-calling. */
function groqTools(v: VillagerId): GroqTool[] {
  if (v === "stargazer") return [{ type: "browser_search" } as unknown as GroqTool];
  return toolsFor(v).flatMap((t) => {
    if (!("input_schema" in t)) return [];
    const def = t as Anthropic.Beta.BetaTool;
    return [{ type: "function", function: { name: def.name, description: def.description ?? "", parameters: def.input_schema as Record<string, unknown> } }];
  });
}

/** Strip gpt-oss browsing citation marks like 【2†L120-L121】 and stray markdown. */
const clean = (s: string) =>
  s
    .replace(/【[^】]*】/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#+\s*/gm, "")
    .trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Free-tier Groq allows ~8k tokens/minute per model. On a 429, wait out the
 * window Groq asks for (it says "try again in 885ms" / sends retry-after)
 * instead of failing the villager's task.
 */
async function withPatience<T>(v: VillagerId, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof Groq.RateLimitError) || attempt >= 5) throw err;
      const header = Number(err.headers?.get?.("retry-after") ?? NaN);
      const hinted = /try again in ([\d.]+)(ms|s)/.exec(err.message);
      const hintMs = hinted ? Number(hinted[1]) * (hinted[2] === "ms" ? 1 : 1000) : NaN;
      const waitMs = Math.min(30_000, Math.max(1_000, Number.isFinite(header) ? header * 1000 : Number.isFinite(hintMs) ? hintMs + 250 : 5_000 * (attempt + 1)));
      setVillager(v, { status: "thinking", activity: "waiting for the line to Earth..." });
      console.log(`[groq] rate limited (${v}), waiting ${(waitMs / 1000).toFixed(1)}s`);
      await sleep(waitMs);
    }
  }
}

function surfaceSearches(v: VillagerId, taskId: string, executed: unknown) {
  if (!Array.isArray(executed)) return;
  for (const t of executed as Array<{ type?: string; arguments?: string }>) {
    if (t.type !== "browser_search") continue;
    let q = "";
    try {
      q = String(JSON.parse(t.arguments ?? "{}").query ?? "");
    } catch {
      /* keep empty */
    }
    const clod: Clod = {
      id: newId("clod"),
      taskId,
      villager: v,
      building: "observatory",
      label: `searching "${q.slice(0, 30)}"`,
      status: "ready",
      reward: 6,
      result: `searched Earth for "${q}"`,
    };
    putClod({ ...clod });
    emit({ type: "tool_start", villager: v, clod: { ...clod, status: "working" } });
    emit({ type: "tool_end", villager: v, clodId: clod.id, ok: true, result: clod.result! });
  }
}

export async function runVillagerGroq(v: VillagerId, taskText: string, taskId: string): Promise<string> {
  const tools = groqTools(v);
  const messages: Msg[] = [
    { role: "system", content: personaFor(v) + missingBuildingsNote(v) + memoryNote(v, true) },
    { role: "user", content: taskText },
  ];
  let finalText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    setVillager(v, { status: "thinking", activity: "thinking…" });
    const res = await withPatience(v, () => groq().chat.completions.create({
      model: v === "stargazer" ? SEARCH_MODEL : MODEL,
      messages,
      ...(tools.length ? { tools } : {}),
      temperature: 0.3,
    }));
    const choice = res.choices[0];
    const msg = choice.message as Groq.Chat.Completions.ChatCompletionMessage & { reasoning?: string; executed_tools?: unknown };

    if (msg.reasoning?.trim()) {
      const thought = msg.reasoning.trim().slice(0, 600);
      setVillager(v, { thought });
      emit({ type: "think", villager: v, text: thought });
    }
    surfaceSearches(v, taskId, msg.executed_tools);
    if (msg.content?.trim()) finalText = clean(msg.content);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) break;

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    if (finalText && v !== "jade_rabbit") emit({ type: "say", villager: v, text: finalText });

    const results = await Promise.all(
      calls.map(async (c) => {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(c.function.arguments || "{}");
        } catch {
          return { role: "tool" as const, tool_call_id: c.id, content: "ERROR: arguments were not valid JSON — try again." };
        }
        const block = { type: "tool_use", id: c.id, name: c.function.name, input } as Anthropic.Beta.BetaToolUseBlock;
        const r = c.function.name === "delegate" ? await runDelegate(v, taskId, block) : await runLeafTool(v, taskId, block);
        const content = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
        return { role: "tool" as const, tool_call_id: c.id, content: r.is_error ? `ERROR: ${content}` : content };
      }),
    );
    messages.push(...results);
  }
  return finalText;
}

/** A plain chat turn (no tools) — texting a villager. */
export async function chatGroq(v: VillagerId, system: string, history: { role: "user" | "assistant"; content: string }[]): Promise<string> {
  const res = await withPatience(v, () =>
    groq().chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: system }, ...history],
      temperature: 0.8,
      reasoning_effort: "low",
    }),
  );
  return (res.choices[0].message.content ?? "").trim();
}

export { Groq, clean };
