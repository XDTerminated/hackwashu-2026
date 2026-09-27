// The AI team, on the Office's project board: a team of LLM sub-agents for
// developers. The player is the project manager: they write a brief on the
// board, the team lead (the model) spins up workers with a spawn_worker tool,
// and each worker is someone at a desk whose current step streams in live.
// When the workers report back, the lead combines their results into one
// deliverable. (The Office's other board, and Ada, are your Claude Code.)
//
// Providers: Claude (Anthropic SDK, with web search + code execution), and
// GPT / Groq / Gemini / OpenRouter through the OpenAI-compatible chat API
// (Groq adds web search). Keys: see aikeys.ts.

// (the SDK loads the first time the team uses Claude: a small host needn't carry it otherwise)
import type Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TeamProject, TeamProvider, TeamState, TeamWorker } from "../../shared/team.js";
import { DATA_DIR } from "./env.js";
import { newId, savePersist, world } from "./world.js";
import { cachedOpenRouterModels, chosenModel, keyFor, keySource, maskedKey, openRouterModels } from "./aikeys.js";

const MAX_WORKERS = 5;
const MAX_LEAD_TURNS = 6;
const MAX_WORKER_TURNS = 8;
// (not Ada: she's the Office's Team Lead, for your Claude Code)
const WORKER_NAMES = ["Linus", "Grace", "Alan", "Margaret", "Dennis", "Radia", "Ken", "Barbara", "Guido", "Hedy", "Tim"];

const REPORTS = join(DATA_DIR, "team");

// ---------------------------------------------------------------- providers

/** OpenRouter's model: the one the player picked, else the first on the menu (free ones come first). */
const openRouterModel = () => chosenModel("openrouter") ?? cachedOpenRouterModels()[0] ?? "google/gemini-2.5-flash";

const PROVIDERS: Record<TeamProvider, { name: string; lead: () => string; worker: () => string }> = {
  claude: {
    name: "Claude",
    lead: () => process.env.OFFICE_CLAUDE_MODEL ?? "claude-opus-5",
    worker: () => process.env.OFFICE_CLAUDE_MODEL ?? "claude-opus-5",
  },
  openai: {
    name: "GPT",
    lead: () => process.env.OFFICE_OPENAI_MODEL ?? "gpt-5",
    worker: () => process.env.OFFICE_OPENAI_MODEL ?? "gpt-5",
  },
  groq: {
    name: "Groq",
    lead: () => process.env.OFFICE_GROQ_MODEL ?? "openai/gpt-oss-120b",
    // Workers on their own model: Groq rate-limits per model, and they run in parallel.
    worker: () => process.env.OFFICE_GROQ_WORKER_MODEL ?? "openai/gpt-oss-20b",
  },
  gemini: {
    name: "Gemini",
    lead: () => process.env.OFFICE_GEMINI_MODEL ?? "gemini-2.5-flash",
    worker: () => process.env.OFFICE_GEMINI_MODEL ?? "gemini-2.5-flash",
  },
  openrouter: {
    name: "OpenRouter",
    lead: openRouterModel,
    worker: openRouterModel,
  },
};

const available = (p: TeamProvider) => !!keyFor(p);

export function teamState(): TeamState {
  return {
    providers: (Object.keys(PROVIDERS) as TeamProvider[]).map((id) => ({
      id,
      name: PROVIDERS[id].name,
      model: PROVIDERS[id].lead(),
      available: available(id),
      source: keySource(id),
      masked: maskedKey(id),
      ...(id === "openrouter" ? { models: cachedOpenRouterModels() } : {}),
    })),
    project: team().project,
    history: team().history,
  };
}

// ---------------------------------------------------------------- live updates

/** The team's part of the save (made on first use). */
function team() {
  return (world.team ??= { project: null, history: [] });
}

const listeners = new Set<(s: TeamState) => void>();
export function onTeamChange(fn: (s: TeamState) => void) {
  listeners.add(fn);
}

/** On start: a project the colony was in the middle of when it stopped won't finish now. */
export function initTeam() {
  const p = team().project;
  if (p && !["done", "failed"].includes(p.status)) {
    p.status = "failed";
    p.error = "the colony restarted mid-project";
    p.lead = `stuck: ${p.error}`;
    p.doneAt = Date.now();
    for (const w of p.workers) if (w.status === "working") w.status = "failed";
    savePersist();
  }
}

/** Keys or models changed: refresh OpenRouter's menu if needed and tell the game. */
export async function providersChanged() {
  if (keyFor("openrouter")) await openRouterModels();
  announce(true);
}

let announceTimer: NodeJS.Timeout | null = null;
/** Tell the game (at most ~4 times a second; steps stream in fast). */
function announce(now = false) {
  savePersist();
  if (now) {
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = null;
    listeners.forEach((fn) => fn(teamState()));
    return;
  }
  if (announceTimer) return;
  announceTimer = setTimeout(() => {
    announceTimer = null;
    listeners.forEach((fn) => fn(teamState()));
  }, 250);
}

function step(w: TeamWorker, text: string) {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 140);
  if (!t || t === w.step) return;
  w.step = t;
  w.steps.push({ at: Date.now(), text: t });
  if (w.steps.length > 40) w.steps.splice(0, w.steps.length - 40);
  announce();
}

/** The tail of what's being written, as a step ("writing: ...the last few words"). */
function writing(text: string) {
  const tail = text.replace(/\s+/g, " ").trim().slice(-70);
  return tail ? `writing: ...${tail}` : "";
}

// ---------------------------------------------------------------- prompts

const LEAD_PROMPT = `You are the team lead of a small office of AI workers in a cozy colony on the Moon.
The player is your project manager and has just handed you a brief.

Plan the work, then call spawn_worker once per worker. Spawn every independent piece in parallel in
your FIRST turn (usually 2 to 4 workers). Give each a short role title ("Researcher", "Backend dev",
"Copywriter", "Reviewer") and a complete, self-contained task: workers can't see the brief, the plan
or each other, so include everything they need. If the brief is tiny, one worker is fine. You can
spawn a follow-up worker (for example a reviewer) after results come back, but don't overdo it.

When the results are in, write the final deliverable for the project manager: lead with the answer,
use clear markdown headings, and include the actual code, text or findings the workers produced where
it matters. Don't describe the process; deliver the work.`;

const workerPrompt = (w: TeamWorker) => `You are ${w.name}, a ${w.role} in the Moon colony's Office, doing one piece of a larger project.
Do the task completely and return your finished work (not a plan or a promise). Be concrete and
efficient; use your tools only when they genuinely help. Your reply goes straight back to the team lead.`;

const SPAWN_DESC = "Spin up a new worker (a sub-agent) to do one self-contained piece of the project. Returns their finished work.";
const SPAWN_SCHEMA = {
  type: "object" as const,
  properties: {
    role: { type: "string", description: "Short job title, e.g. 'Researcher' or 'Frontend dev'." },
    task: { type: "string", description: "The complete, self-contained task. The worker sees nothing else." },
  },
  required: ["role", "task"],
};

// ---------------------------------------------------------------- workers

function hire(p: TeamProject, role: string, task: string): TeamWorker {
  const taken = new Set(p.workers.map((w) => w.name));
  const free = WORKER_NAMES.filter((n) => !taken.has(n));
  const name = free[Math.floor(Math.random() * free.length)] ?? `Worker ${p.workers.length + 1}`;
  const w: TeamWorker = {
    id: newId("worker"),
    name,
    role: role.slice(0, 40) || "Worker",
    task: task.slice(0, 4000),
    status: "working",
    step: "reading the task",
    steps: [{ at: Date.now(), text: "reading the task" }],
    startedAt: Date.now(),
  };
  p.workers.push(w);
  announce(true);
  return w;
}

async function runWorker(p: TeamProject, w: TeamWorker): Promise<string> {
  try {
    const result = p.provider === "claude" ? await claudeWorker(w) : await chatWorker(p.provider, w);
    w.result = result || "(no output)";
    w.status = "done";
    w.doneAt = Date.now();
    step(w, "done - handed my work to the lead");
    announce(true);
    return w.result;
  } catch (err) {
    console.error(`[office] ${w.name} failed:`, err);
    w.status = "failed";
    w.doneAt = Date.now();
    step(w, `stuck: ${errorText(err)}`);
    announce(true);
    return `ERROR: ${w.name} couldn't finish (${errorText(err)}).`;
  }
}

function errorText(err: unknown) {
  // (an SDK API error, told apart by its shape so the SDK needn't be loaded)
  const status = err && typeof err === "object" && "status" in err ? (err as { status?: unknown }).status : undefined;
  if (typeof status === "number" && "headers" in (err as object)) return `API error ${status}`;
  return err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
}

/** Validate a spawn_worker call's input (it can arrive truncated or malformed). */
function spawnInput(input: unknown): { role: string; task: string } | null {
  const i = input as { role?: unknown; task?: unknown } | null;
  if (!i || typeof i.role !== "string" || typeof i.task !== "string" || !i.task.trim()) return null;
  return { role: i.role.trim(), task: i.task.trim() };
}

// ---------------------------------------------------------------- Claude

let anthropic: { key: string; client: Anthropic } | null = null;
/** A Claude client for whichever key is connected (a player's, or the server's). */
async function claude(): Promise<Anthropic> {
  const key = keyFor("claude") ?? "";
  if (anthropic?.key !== key) {
    const { default: Sdk } = await import("@anthropic-ai/sdk");
    anthropic = { key, client: new Sdk({ apiKey: key }) };
  }
  return anthropic.client;
}

async function claudeLead(p: TeamProject): Promise<string> {
  const tools: Anthropic.ToolUnion[] = [{ name: "spawn_worker", description: SPAWN_DESC, input_schema: SPAWN_SCHEMA, eager_input_streaming: true }];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Project brief from your project manager:\n\n${p.brief}` }];
  let final = "";
  for (let turn = 0; turn < MAX_LEAD_TURNS; turn++) {
    let text = "";
    const stream = (await claude()).messages.stream({ model: p.model, max_tokens: 32000, system: LEAD_PROMPT, tools, messages });
    stream.on("text", (d) => {
      text += d;
      p.lead = writing(text);
      announce();
    });
    const msg = await stream.finalMessage();
    if (text.trim()) final = text.trim();
    if (msg.stop_reason === "refusal") throw new Error("the model declined this brief");
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uses.length || msg.stop_reason === "max_tokens") break;
    messages.push({ role: "assistant", content: msg.content });
    p.status = "working";
    p.lead = `spun up ${uses.length} worker${uses.length === 1 ? "" : "s"} - waiting on their work`;
    const results = await Promise.all(
      uses.map(async (u): Promise<Anthropic.ToolResultBlockParam> => {
        const input = spawnInput(u.input);
        if (!input) return { type: "tool_result", tool_use_id: u.id, content: "INVALID_INPUT: spawn_worker needs a role and a task (strings). Try again.", is_error: true };
        if (p.workers.length >= MAX_WORKERS) return { type: "tool_result", tool_use_id: u.id, content: `The office is full (${MAX_WORKERS} workers). Do this piece yourself.`, is_error: true };
        const w = hire(p, input.role, input.task);
        return { type: "tool_result", tool_use_id: u.id, content: await runWorker(p, w) };
      }),
    );
    messages.push({ role: "user", content: results });
    p.status = "wrapping";
    p.lead = "reading everyone's work";
    announce(true);
  }
  return final;
}

async function claudeWorker(w: TeamWorker): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: w.task }];
  const tools: Anthropic.ToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: 5 },
    { type: "code_execution_20260120", name: "code_execution" },
  ];
  let final = "";
  for (let turn = 0; turn < MAX_WORKER_TURNS; turn++) {
    let text = "";
    let lastStep = 0;
    const stream = (await claude()).messages.stream({ model: PROVIDERS.claude.worker(), max_tokens: 32000, system: workerPrompt(w), tools, messages });
    stream.on("text", (d) => {
      text += d;
      if (Date.now() - lastStep > 900) {
        lastStep = Date.now();
        step(w, writing(text));
      }
    });
    stream.on("streamEvent", (e) => {
      if (e.type === "content_block_start" && e.content_block.type === "thinking") step(w, "thinking it through");
    });
    stream.on("contentBlock", (b) => {
      if (b.type === "server_tool_use") {
        const input = b.input as { query?: string; code?: string; command?: string };
        if (b.name === "web_search") step(w, `searching the web: ${input.query ?? ""}`);
        else step(w, `running code: ${(input.code ?? input.command ?? "").split("\n")[0]}`);
      } else if (b.type === "web_search_tool_result") {
        step(w, "reading search results");
      }
    });
    const msg = await stream.finalMessage();
    if (text.trim()) final = text.trim();
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    break;
  }
  return final;
}

// ---------------------------------------------------------------- GPT / Groq (OpenAI-compatible)

type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

const CHAT_URL: Record<Exclude<TeamProvider, "claude">, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

function endpoint(provider: TeamProvider) {
  return { url: CHAT_URL[provider as Exclude<TeamProvider, "claude">], key: keyFor(provider) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One streamed chat completion. `onDelta` sees the text and reasoning so far.
 * Waits out rate limits (Groq's free tier is tight) instead of failing.
 */
async function chat(
  provider: TeamProvider,
  body: Record<string, unknown>,
  onDelta: (text: string, reasoning: string) => void,
  onWait?: (s: number) => void,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const { url, key } = endpoint(provider);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(provider === "openrouter" ? { "x-title": "Fl-AI Me to the Moon" } : {}),
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (res.status === 429 && attempt < 6) {
      const detail = await res.text().catch(() => "");
      const hinted = /try again in ([\d.]+)(ms|s)/.exec(detail);
      const header = Number(res.headers.get("retry-after"));
      const ms = Math.min(30_000, Math.max(1_000, Number.isFinite(header) && header > 0 ? header * 1000 : hinted ? Number(hinted[1]) * (hinted[2] === "ms" ? 1 : 1000) + 300 : 4_000 * (attempt + 1)));
      onWait?.(Math.round(ms / 1000));
      await sleep(ms);
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
    let text = "";
    let reasoning = "";
    const calls: ToolCall[] = [];
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let json: { choices?: { delta?: { content?: string; reasoning?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const d = json.choices?.[0]?.delta;
        if (!d) continue;
        if (d.content) text += d.content;
        if (d.reasoning) reasoning += d.reasoning;
        for (const tc of d.tool_calls ?? []) {
          const c = (calls[tc.index] ??= { id: tc.id ?? `call_${tc.index}`, type: "function", function: { name: "", arguments: "" } });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.function.name += tc.function.name;
          if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
        }
        onDelta(text, reasoning);
      }
    }
    return { text: clean(text), toolCalls: calls.filter(Boolean) };
  }
}

/** Strip gpt-oss browsing citation marks like 【2†L120-L121】. */
const clean = (s: string) => s.replace(/【[^】]*】/g, "").trim();

function throttled(fn: (text: string, reasoning: string) => void) {
  let last = 0;
  return (text: string, reasoning: string) => {
    if (Date.now() - last < 900) return;
    last = Date.now();
    fn(text, reasoning);
  };
}

async function chatLead(p: TeamProject): Promise<string> {
  const tools = [{ type: "function", function: { name: "spawn_worker", description: SPAWN_DESC, parameters: SPAWN_SCHEMA } }];
  const messages: ChatMsg[] = [
    { role: "system", content: LEAD_PROMPT },
    { role: "user", content: `Project brief from your project manager:\n\n${p.brief}` },
  ];
  let final = "";
  for (let turn = 0; turn < MAX_LEAD_TURNS; turn++) {
    const out = await chat(
      p.provider,
      { model: p.model, messages, tools, parallel_tool_calls: true, ...(p.provider === "groq" ? { temperature: 0.4 } : {}) },
      throttled((text, reasoning) => {
        p.lead = text ? writing(text) : reasoning ? `thinking: ${reasoning.replace(/\s+/g, " ").slice(-70)}` : p.lead;
        announce();
      }),
      (s) => {
        p.lead = `waiting ${s}s for the line to Earth (rate limit)`;
        announce();
      },
    );
    if (out.text) final = out.text;
    const spawns = out.toolCalls.filter((c) => c.function.name === "spawn_worker");
    if (!spawns.length) break;
    messages.push({ role: "assistant", content: out.text, tool_calls: spawns });
    p.status = "working";
    p.lead = `spun up ${spawns.length} worker${spawns.length === 1 ? "" : "s"} - waiting on their work`;
    const results = await Promise.all(
      spawns.map(async (c): Promise<ChatMsg> => {
        let input: { role: string; task: string } | null = null;
        try {
          input = spawnInput(JSON.parse(c.function.arguments || "{}"));
        } catch {
          input = null;
        }
        if (!input) return { role: "tool", tool_call_id: c.id, content: "INVALID_INPUT: spawn_worker needs JSON with a role and a task. Try again." };
        if (p.workers.length >= MAX_WORKERS) return { role: "tool", tool_call_id: c.id, content: `The office is full (${MAX_WORKERS} workers). Do this piece yourself.` };
        const w = hire(p, input.role, input.task);
        return { role: "tool", tool_call_id: c.id, content: await runWorker(p, w) };
      }),
    );
    messages.push(...results);
    p.status = "wrapping";
    p.lead = "reading everyone's work";
    announce(true);
  }
  return final;
}

async function chatWorker(provider: TeamProvider, w: TeamWorker): Promise<string> {
  const messages: ChatMsg[] = [
    { role: "system", content: workerPrompt(w) },
    { role: "user", content: w.task },
  ];
  // Groq's gpt-oss models can search the web on their own.
  const tools = provider === "groq" ? [{ type: "browser_search" }] : undefined;
  const out = await chat(
    provider,
    { model: PROVIDERS[provider].worker(), messages, ...(tools ? { tools } : {}), ...(provider === "groq" ? { temperature: 0.4 } : {}) },
    throttled((text, reasoning) => {
      if (text) step(w, writing(text));
      else if (reasoning) {
        const r = reasoning.replace(/\s+/g, " ");
        step(w, /search|look up|browse/i.test(r.slice(-200)) ? `searching the web: ${r.slice(-60)}` : `thinking: ${r.slice(-70)}`);
      }
    }),
    (s) => step(w, `waiting ${s}s for the line to Earth (rate limit)`),
  );
  return out.text;
}

// ---------------------------------------------------------------- projects

let running = false;

export function startProject(brief: string, provider: TeamProvider): string | null {
  if (running) return "The team is still on the current project.";
  if (!PROVIDERS[provider]) return "Pick an AI for the team first.";
  if (!available(provider)) return `${PROVIDERS[provider].name} isn't connected. Use CONNECT AI on the project board.`;
  const text = brief.trim().slice(0, 4000);
  if (!text) return "Write a brief first.";
  const p: TeamProject = {
    id: newId("project"),
    brief: text,
    provider,
    model: PROVIDERS[provider].lead(),
    status: "planning",
    lead: "reading the brief",
    workers: [],
    startedAt: Date.now(),
  };
  team().project = p;
  running = true;
  announce(true);
  void (async () => {
    try {
      const result = provider === "claude" ? await claudeLead(p) : await chatLead(p);
      p.result = result || p.workers.map((w) => `## ${w.name} (${w.role})\n\n${w.result ?? ""}`).join("\n\n");
      p.status = "done";
      p.lead = "project delivered";
      saveReport(p);
    } catch (err) {
      console.error("[office] project failed:", err);
      p.status = "failed";
      p.error = errorText(err);
      p.lead = `stuck: ${p.error}`;
    } finally {
      p.doneAt = Date.now();
      running = false;
      team().history.unshift({ id: p.id, brief: p.brief.slice(0, 200), provider: p.provider, doneAt: p.doneAt });
      team().history.splice(10);
      announce(true);
    }
  })();
  return null;
}

/** Workers go home; the board is ready for a new brief. */
export function clearProject(): string | null {
  if (running) return "The team is still working.";
  team().project = null;
  announce(true);
  return null;
}

function saveReport(p: TeamProject) {
  try {
    mkdirSync(REPORTS, { recursive: true });
    const body = `# ${p.brief.split("\n")[0].slice(0, 80)}\n\n_Brief:_ ${p.brief}\n\n_Team (${PROVIDERS[p.provider].name}, ${p.model}):_ ${p.workers.map((w) => `${w.name} (${w.role})`).join(", ")}\n\n---\n\n${p.result ?? ""}\n`;
    writeFileSync(join(REPORTS, `${p.id}.md`), body);
  } catch (err) {
    console.error("[office] couldn't save report:", err);
  }
}

export function reportPath(id: string) {
  return /^[a-z0-9_]+$/i.test(id) ? join(REPORTS, `${id}.md`) : null;
}

/** Check in on a worker: they answer from what they're doing (no steering). */
export async function askWorker(workerId: string, question: string): Promise<string> {
  const p = team().project;
  const w = p?.workers.find((x) => x.id === workerId);
  if (!p || !w) return "They've gone home.";
  const context = `You are ${w.name}, a ${w.role} in the Moon colony's Office. Your project manager is checking in on you.
Answer their question in first person, briefly (2-4 sentences), like a colleague giving a status
update: what you're doing, how far along you are, anything tricky. Don't paste your work; don't invent progress.

Your task: ${w.task}
Your status: ${w.status}
What you've done so far (oldest first):
${w.steps.map((s) => `- ${s.text}`).join("\n")}
${w.result ? `\nYour finished work (excerpt):\n${w.result.slice(0, 3000)}` : ""}`;
  try {
    if (p.provider === "claude") {
      const msg = await (await claude()).messages.create({ model: PROVIDERS.claude.worker(), max_tokens: 1000, system: context, messages: [{ role: "user", content: question.slice(0, 1000) }] });
      return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim() || "...";
    }
    const out = await chat(p.provider, { model: PROVIDERS[p.provider].worker(), messages: [{ role: "system", content: context }, { role: "user", content: question.slice(0, 1000) }] }, () => {});
    return out.text || "...";
  } catch (err) {
    return `(${w.name} can't answer right now: ${errorText(err)})`;
  }
}
