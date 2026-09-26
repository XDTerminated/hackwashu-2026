// The Office's eyes: a live view of your coding agents. Claude Code writes
// every session to ~/.claude/projects/<project>/<session>.jsonl as it works,
// and each sub-agent it spins up gets its own file (plus a little meta file
// with its task) under <session>/subagents/. We tail those files and turn
// them into a lead (the main session) and workers (the sub-agents), each with
// what they're doing right now and a feed of their thinking, messages, tool
// calls and results. Other tools can report in over HTTP (reportEvent).
// Read-only: nothing here steers the agents. Stays on this computer.

import { randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentFeedItem, AgentInfo, AgentLink, AgentSession, AgentsState, AgentStatus } from "../../shared/game.js";

const ROOT = process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
/** A session counts as live if it was written in the last this-many ms. */
const LIVE_MS = 20 * 60_000;
/** Finished workers stay on the board this long. */
const DONE_KEEP_MS = 15 * 60_000;
/** A sub-agent that hasn't written anything in this long has probably been stopped. */
const QUIET_MS = 10 * 60_000;
const FEED = 40;
const CLIP = 320;
/** On first sight of a long session, read only its tail (enough for the recent feed). */
const TAIL_BYTES = 3 * 1024 * 1024;
const MAX_SESSIONS = 4;
const MAX_WORKERS = 30;

// ---------------------------------------------------------------- reading growing files

/** Reads the lines appended to a file since last time (only whole lines). */
class Tail {
  private pos = -1;
  private rest = Buffer.alloc(0);
  private skipFirst = false;
  constructor(readonly file: string, private fromEnd = 0) {}

  read(): Record<string, unknown>[] {
    let size: number;
    try {
      size = statSync(this.file).size;
    } catch {
      return [];
    }
    if (this.pos < 0) {
      this.pos = Math.max(0, size - this.fromEnd);
      this.skipFirst = this.pos > 0;
    }
    if (size < this.pos) {
      // rewritten from scratch
      this.pos = 0;
      this.rest = Buffer.alloc(0);
    }
    if (size === this.pos) return [];
    const len = Math.min(size - this.pos, 16 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    const fd = openSync(this.file, "r");
    try {
      readSync(fd, buf, 0, len, this.pos);
    } finally {
      closeSync(fd);
    }
    this.pos += len;
    const all = Buffer.concat([this.rest, buf]);
    const cut = all.lastIndexOf(0x0a);
    if (cut < 0) {
      this.rest = all;
      return [];
    }
    this.rest = all.subarray(cut + 1);
    let lines = all.subarray(0, cut).toString("utf8").split("\n");
    if (this.skipFirst) {
      lines = lines.slice(1);
      this.skipFirst = false;
    }
    const out: Record<string, unknown>[] = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        out.push(JSON.parse(l));
      } catch {
        /* a torn line; skip it */
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------- making sense of entries

const clip = (s: unknown, n = CLIP) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};
const firstLine = (s: unknown, n = 80) => clip(String(s ?? "").split("\n").find((l) => l.trim()) ?? "", n);
const base = (p: unknown) => String(p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
/** The end of a path ("client/src/scenes/UIScene.ts"): enough to know where, short enough to read. */
const tailPath = (p: unknown) => {
  const parts = String(p ?? "").split(/[\\/]/).filter(Boolean);
  return parts.length > 4 ? `.../${parts.slice(-4).join("/")}` : parts.join("/");
};
const host = (u: unknown) => {
  try {
    return new URL(String(u)).host;
  } catch {
    return clip(u, 40);
  }
};

type Input = Record<string, unknown>;

/** One plain line for a tool call ("Reading GameScene.ts"). */
export function toolLine(name: string, i: Input): string {
  switch (name) {
    case "Read":
      return `Reading ${base(i.file_path)}`;
    case "Write":
      return `Writing ${base(i.file_path)}`;
    case "Edit":
    case "MultiEdit":
      return `Editing ${base(i.file_path)}`;
    case "NotebookEdit":
      return `Editing ${base(i.notebook_path)}`;
    case "Bash":
      return i.description ? clip(i.description, 70) : `Running ${firstLine(i.command, 60)}`;
    case "Grep":
      return `Searching for "${clip(i.pattern, 40)}"`;
    case "Glob":
      return `Finding ${clip(i.pattern, 50)}`;
    case "WebFetch":
      return `Reading ${host(i.url)}`;
    case "WebSearch":
      return `Searching the web: ${clip(i.query, 50)}`;
    case "Agent":
    case "Task":
      return `Sending out a helper: ${clip(i.description, 50)}`;
    case "TodoWrite":
      return "Updating the to-do list";
    case "AskUserQuestion":
      return "Asking you a question";
    case "Skill":
      return `Using the ${clip(i.skill, 30)} skill`;
    case "ToolSearch":
      return "Looking up tools";
    case "Workflow":
      return "Running a workflow";
    default:
      return name.startsWith("mcp__") ? `Using ${name.split("__").slice(1).join(" ")}` : `Using ${name}`;
  }
}

/** The details under a tool call in the feed: the command, the pattern, the change. */
function toolDetail(name: string, i: Input): string {
  if (name === "Bash") return `$ ${clip(i.command, 240)}`;
  if (name === "Grep") return clip(`${i.pattern}${i.path ? ` in ${tailPath(i.path)}` : ""}`, 160);
  if (name === "Edit") return clip(`- ${firstLine(i.old_string, 100)}\n+ ${firstLine(i.new_string, 100)}`, 240);
  if (name === "Write") return clip(`${tailPath(i.file_path)}: ${firstLine(i.content, 120)}`, 240);
  if (name === "Read") return clip(tailPath(i.file_path), 160);
  if (name === "WebFetch") return clip(i.url, 160);
  if (name === "Agent" || name === "Task") return clip(i.prompt, 240);
  return "";
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "")).join(" ");
  return "";
}

interface Runtime {
  info: AgentInfo;
  pending: Map<string, { name: string; line: string; at: number }>;
  msgIds: Set<string>;
  isLead: boolean;
}

function newAgent(id: string, name: string, kind: string, at: number, isLead: boolean, parent: string | null = null, depth = 0): Runtime {
  return {
    info: { id, name, kind, depth, parent, status: "thinking", now: isLead ? "Starting up" : "Getting started", model: "", startedAt: at, lastAt: at, tools: 0, tokens: 0, task: "", result: "", feed: [] },
    pending: new Map(),
    msgIds: new Set(),
    isLead,
  };
}

function push(a: Runtime, item: AgentFeedItem) {
  if (!item.text) return;
  const feed = a.info.feed;
  feed.push(item);
  if (feed.length > FEED) feed.splice(0, feed.length - FEED);
}

/**
 * Fold one log entry into an agent. Returns spawn requests it saw
 * (tool-use ids of Agent/Task calls, so their sub-agents can find a parent).
 */
function ingest(a: Runtime, e: Record<string, unknown>, at: number, spawns: Map<string, string>) {
  const info = a.info;
  const msg = (e.message ?? {}) as { content?: unknown; stop_reason?: string; model?: string; id?: string; usage?: { output_tokens?: number } };
  if (e.type !== "user" && e.type !== "assistant") return;
  if (e.isMeta) return;
  info.lastAt = Math.max(info.lastAt, at);

  if (e.type === "user") {
    const content = msg.content;
    if (typeof content === "string") {
      if (content.startsWith("<task-notification>")) {
        const summary = content.match(/<summary>([\s\S]*?)<\/summary>/)?.[1];
        push(a, { at, kind: "result", text: clip(summary ? `Heard back: ${summary}` : "A background job reported in", 200) });
      } else if (/^<(command-|local-command|system-reminder)/.test(content)) {
        /* bookkeeping, not something anyone said */
      } else if (!info.task && !a.isLead) {
        info.task = clip(content, 1500);
        push(a, { at, kind: "prompt", text: clip(content, 400) });
      } else {
        push(a, { at, kind: "prompt", text: clip(content, 400) });
        info.status = "thinking";
        info.now = "Reading your message";
      }
      return;
    }
    if (!Array.isArray(content)) return;
    for (const b of content as Record<string, unknown>[]) {
      if (b.type === "tool_result") {
        const id = String(b.tool_use_id ?? "");
        const p = a.pending.get(id);
        a.pending.delete(id);
        const text = clip(resultText(b.content), 200);
        if (b.is_error) push(a, { at, kind: "error", text: `${p ? `${p.line}: ` : ""}${text || "failed"}` });
        else if (text) push(a, { at, kind: "result", text });
        // Back to thinking; "now" keeps saying what it just did.
        if (!a.pending.size && info.status !== "waiting") info.status = "thinking";
      } else if (b.type === "text" && typeof b.text === "string" && !/^<(command-|system-reminder)/.test(b.text)) {
        if (!info.task && !a.isLead) info.task = clip(b.text, 1500);
        push(a, { at, kind: "prompt", text: clip(b.text, 400) });
      }
    }
    return;
  }

  // assistant
  if (msg.model && msg.model !== "<synthetic>") info.model = msg.model;
  if (msg.id && !a.msgIds.has(msg.id)) {
    a.msgIds.add(msg.id);
    info.tokens += msg.usage?.output_tokens ?? 0;
  }
  const blocks = Array.isArray(msg.content) ? (msg.content as Record<string, unknown>[]) : [];
  for (const b of blocks) {
    if (b.type === "thinking") {
      const t = String(b.thinking ?? "");
      if (t.trim()) push(a, { at, kind: "think", text: clip(t, 360) });
      info.status = "thinking";
    } else if (b.type === "text") {
      const t = String(b.text ?? "");
      if (!t.trim()) continue;
      push(a, { at, kind: "say", text: clip(t, 500) });
      info.now = firstLine(t, 90);
      if (!a.isLead) info.result = clip(t, 1500);
    } else if (b.type === "tool_use") {
      const name = String(b.name ?? "tool");
      const input = (b.input ?? {}) as Input;
      const line = toolLine(name, input);
      a.pending.set(String(b.id ?? ""), { name, line, at });
      info.tools++;
      info.status = name === "AskUserQuestion" ? "waiting" : "working";
      info.now = line;
      const detail = toolDetail(name, input);
      push(a, { at, kind: "tool", text: detail ? `${line}\n${detail}` : line });
      if ((name === "Agent" || name === "Task") && b.id) spawns.set(String(b.id), info.id);
    }
  }
  if (msg.stop_reason === "end_turn") {
    a.pending.clear();
    if (a.isLead) {
      info.status = "waiting";
      info.now = "Waiting for you";
    } else {
      info.status = "done";
      info.doneAt = at;
      info.now = "Done";
    }
  }
}

// ---------------------------------------------------------------- sessions

interface Tracked {
  id: string;
  source: AgentSession["source"];
  title: string;
  project: string;
  branch: string;
  lead: Runtime;
  workers: Map<string, Runtime>;
  /** Agent/Task tool-use id -> the agent that asked for it. */
  spawns: Map<string, string>;
  tails: Map<string, Tail>;
  dir: string;
  lastAt: number;
  replay?: AgentSession["replay"];
}

function newSession(id: string, source: AgentSession["source"], at: number, dir = ""): Tracked {
  return { id, source, title: "", project: "", branch: "", lead: newAgent("lead", "Claude", "main", at, true), workers: new Map(), spawns: new Map(), tails: new Map(), dir, lastAt: at };
}

function sessionMeta(s: Tracked, e: Record<string, unknown>) {
  if (e.type === "ai-title" && typeof e.aiTitle === "string") s.title = e.aiTitle;
  if (typeof e.cwd === "string" && e.cwd) s.project = basename(e.cwd);
  if (typeof e.gitBranch === "string" && e.gitBranch) s.branch = e.gitBranch;
}

const at = (e: Record<string, unknown>) => {
  const t = Date.parse(String(e.timestamp ?? ""));
  return Number.isFinite(t) ? t : Date.now();
};

function readMeta(file: string): { description?: string; agentType?: string; toolUseId?: string; spawnDepth?: number } {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** A sub-agent's worker, created the first time we see its file. */
function workerFor(s: Tracked, agentId: string, meta: ReturnType<typeof readMeta>, when: number): Runtime {
  let w = s.workers.get(agentId);
  if (!w) {
    const parent = (meta.toolUseId && s.spawns.get(meta.toolUseId)) || "lead";
    w = newAgent(agentId, clip(meta.description || "Helper", 60), meta.agentType || "agent", when, false, parent, meta.spawnDepth ?? 1);
    s.workers.set(agentId, w);
  }
  return w;
}

const tracked = new Map<string, Tracked>();

/** Look for new and growing Claude Code sessions. */
function scan() {
  if (!existsSync(ROOT)) return;
  const now = Date.now();
  let projects: string[] = [];
  try {
    projects = readdirSync(ROOT);
  } catch {
    return;
  }
  for (const p of projects) {
    const dir = join(ROOT, p);
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = join(dir, f);
      const id = f.slice(0, -".jsonl".length);
      let mtime = 0;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        continue;
      }
      let s = tracked.get(id);
      if (!s && now - mtime > LIVE_MS) continue;
      if (!s) {
        s = newSession(id, "claude-code", mtime, join(dir, id));
        s.tails.set(file, new Tail(file, TAIL_BYTES));
        tracked.set(id, s);
      }
      pump(s, file, null);
      // its sub-agents
      const subs = join(s.dir, "subagents");
      if (!existsSync(subs)) continue;
      let names: string[] = [];
      try {
        names = readdirSync(subs).filter((n) => n.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const n of names) {
        const sf = join(subs, n);
        if (!s.tails.has(sf)) {
          // Only sub-agents from this stretch of work (not hours-old ones).
          let m = 0;
          try {
            m = statSync(sf).mtimeMs;
          } catch {
            continue;
          }
          if (now - m > DONE_KEEP_MS) continue;
          s.tails.set(sf, new Tail(sf));
        }
        pump(s, sf, n.replace(/^agent-/, "").replace(/\.jsonl$/, ""));
      }
    }
  }
  // forget sessions that have gone quiet
  for (const [id, s] of tracked) if (s.source === "claude-code" && now - s.lastAt > LIVE_MS * 3) tracked.delete(id);
}

function pump(s: Tracked, file: string, agentId: string | null) {
  const entries = s.tails.get(file)?.read() ?? [];
  if (!entries.length) return;
  const w = agentId ? workerFor(s, agentId, readMeta(file.replace(/\.jsonl$/, ".meta.json")), at(entries[0])) : null;
  for (const e of entries) {
    const t = at(e);
    sessionMeta(s, e);
    ingest(w ?? s.lead, e, t, s.spawns);
    if (e.type === "user" || e.type === "assistant") s.lastAt = Math.max(s.lastAt, t);
  }
}

// ---------------------------------------------------------------- other tools report in

export interface ReportedEvent {
  session: string;
  title?: string;
  project?: string;
  agent?: string;
  name?: string;
  parent?: string;
  status?: AgentStatus;
  activity?: string;
  say?: string;
  tool?: string;
  result?: string;
  model?: string;
}

/** POST /agents/event: any tool (Codex, Gemini, a script) can put its agents in the Office. */
export function reportEvent(ev: ReportedEvent): string | null {
  if (!ev || typeof ev.session !== "string" || !ev.session.trim()) return "needs a session";
  const now = Date.now();
  const key = `api:${clip(ev.session, 80)}`;
  let s = tracked.get(key);
  if (!s) tracked.set(key, (s = newSession(key, "api", now)));
  if (ev.title) s.title = clip(ev.title, 80);
  if (ev.project) s.project = clip(ev.project, 40);
  s.lastAt = now;
  const isLead = !ev.agent || ev.agent === "lead";
  let a = isLead ? s.lead : s.workers.get(clip(ev.agent, 80));
  if (!a) {
    a = newAgent(clip(ev.agent, 80), clip(ev.name ?? ev.agent, 60), "agent", now, false, ev.parent ? clip(ev.parent, 80) : "lead", 1);
    s.workers.set(a.info.id, a);
  }
  const info = a.info;
  info.lastAt = now;
  if (ev.name) info.name = clip(ev.name, 60);
  if (ev.model) info.model = clip(ev.model, 40);
  if (ev.tool) {
    info.tools++;
    push(a, { at: now, kind: "tool", text: clip(ev.tool, 300) });
    info.now = firstLine(ev.tool, 90);
    info.status = "working";
  }
  if (ev.say) {
    push(a, { at: now, kind: "say", text: clip(ev.say, 500) });
    info.now = firstLine(ev.say, 90);
  }
  if (ev.activity) info.now = clip(ev.activity, 90);
  if (ev.result) info.result = clip(ev.result, 1500);
  if (ev.status && ["thinking", "working", "waiting", "done", "failed"].includes(ev.status)) {
    info.status = ev.status;
    if (ev.status === "done" || ev.status === "failed") info.doneAt = now;
  }
  changed();
  return null;
}

// ---------------------------------------------------------------- replay

/** A past stretch of work: every log entry, in order, ready to play back. */
export interface Recording {
  title: string;
  events: { at: number; agent: string | null; e: Record<string, unknown> }[];
  metas: Record<string, { description?: string; agentType?: string; toolUseId?: string; spawnDepth?: number }>;
}

/** Sub-agents started more than this long apart belong to different batches. */
const BATCH_GAP_MS = 10 * 60_000;

const readAll = (file: string) => {
  const out: Record<string, unknown>[] = [];
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      /* skip */
    }
  }
  return out;
};

/**
 * The latest batch of sub-agents on this computer (the most recent session
 * that used them, and only its last burst of them), as a recording.
 */
export function recordLatestBatch(): Recording | null {
  if (!existsSync(ROOT)) return null;
  let best: { file: string; subs: string[]; mtime: number } | null = null;
  for (const p of readdirSync(ROOT)) {
    const dir = join(ROOT, p);
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const subsDir = join(dir, f.slice(0, -6), "subagents");
      if (!existsSync(subsDir)) continue;
      const subs = readdirSync(subsDir).filter((n) => n.endsWith(".jsonl")).map((n) => join(subsDir, n));
      if (!subs.length) continue;
      const mtime = Math.max(...subs.map((x) => statSync(x).mtimeMs));
      if (!best || mtime > best.mtime) best = { file: join(dir, f), subs, mtime };
    }
  }
  if (!best) return null;
  // Each sub-agent's entries; then keep only the last batch (a long session can have several, hours apart).
  const agents = best.subs
    .map((sf) => ({ id: basename(sf).replace(/^agent-/, "").replace(/\.jsonl$/, ""), meta: readMeta(sf.replace(/\.jsonl$/, ".meta.json")), entries: readAll(sf) }))
    .filter((x) => x.entries.length)
    .map((x) => ({ ...x, first: at(x.entries[0]), last: at(x.entries[x.entries.length - 1]) }))
    .sort((a, b) => a.first - b.first);
  if (!agents.length) return null;
  let from = agents.length - 1;
  while (from > 0 && agents[from].first - agents[from - 1].last < BATCH_GAP_MS && agents[from].first - agents[from - 1].first < BATCH_GAP_MS * 3) from--;
  const batch = agents.slice(from);
  const start = Math.min(...batch.map((x) => x.first)) - 25_000;
  const end = Math.max(...batch.map((x) => x.last)) + 12_000;
  const events: Recording["events"] = [];
  const metas: Recording["metas"] = {};
  for (const x of batch) {
    metas[x.id] = x.meta;
    for (const e of x.entries) events.push({ at: at(e), agent: x.id, e });
  }
  let title = "";
  for (const e of readAll(best.file)) {
    if (e.type === "ai-title" && typeof e.aiTitle === "string") title = e.aiTitle;
    const t = at(e);
    if (t >= start && t <= end && (e.type === "user" || e.type === "assistant")) events.push({ at: t, agent: null, e });
  }
  events.sort((a, b) => a.at - b.at);
  events.unshift({ at: start, agent: null, e: { type: "marker" } });
  events.push({ at: end, agent: null, e: { type: "marker" } });
  return { title, events, metas };
}

/** The demo that ships with the game, for a server with no Claude Code of its own (the hosted game). */
function demoRecording(): Recording | null {
  try {
    const DEMO = join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "replay.json");
    return JSON.parse(readFileSync(DEMO, "utf8")) as Recording;
  } catch {
    return null;
  }
}

let replay: { timer: NodeJS.Timeout; key: string } | null = null;

/** Play back past sub-agents, sped up, so the Office is never empty. */
export function startReplay(): string | null {
  stopReplay();
  const rec = (!HOSTED_WATCH_OFF && recordLatestBatch()) || demoRecording();
  if (!rec || rec.events.length < 3) return "There's no past session with subagents to replay yet.";
  const events = rec.events;
  const start = events[0].at;
  const end = events[events.length - 1].at;
  const title = rec.title;
  // About a minute and a half, whatever the real length.
  const speed = Math.min(60, Math.max(2, (end - start) / 90_000));
  const t0 = Date.now();
  const key = `replay:${t0}`;
  const s = newSession(key, "replay", t0);
  s.title = title;
  s.replay = { speed: Math.round(speed), progress: 0 };
  tracked.set(key, s);
  const real = (t: number) => t0 + (t - start) / speed;
  let i = 0;
  const tick = () => {
    const now = Date.now();
    const virtual = start + (now - t0) * speed;
    while (i < events.length && events[i].at <= virtual) {
      const { agent, e, at: when } = events[i++];
      const t = real(when);
      sessionMeta(s, e);
      if (title) s.title = title;
      if (e.type !== "user" && e.type !== "assistant") continue;
      const a = agent ? workerFor(s, agent, rec.metas[agent] ?? {}, t) : s.lead;
      ingest(a, e, t, s.spawns);
      s.lastAt = Math.max(s.lastAt, t);
    }
    s.replay = { speed: Math.round(speed), progress: Math.min(1, (virtual - start) / Math.max(1, end - start)) };
    changed();
    if (virtual >= end) {
      clearInterval(timer);
      // leave the finished replay up for a moment, then clear it
      setTimeout(() => {
        if (replay?.key === key) stopReplay();
      }, 20_000);
    }
  };
  const timer = setInterval(tick, 250);
  replay = { timer, key };
  tick();
  return null;
}

export function stopReplay() {
  if (!replay) return;
  clearInterval(replay.timer);
  tracked.delete(replay.key);
  replay = null;
  changed();
}

// ---------------------------------------------------------------- your Claude Code, linked from your computer (hosted)
// The hosted game can't see your files. Instead you run a small script on
// your own computer (the LINK command): it reads your Claude Code logs with
// this same code and sends what it sees here, to your copy of the game only.

/** Hosted: this server has no Claude Code of its own to watch. */
let HOSTED_WATCH_OFF = false;
let linkCode: { code: string; command: string; expiresAt: number } | null = null;
let bridge: { token: string; host: string; sessions: AgentSession[]; seen: number } | null = null;
/** No word from the linked computer for this long: show the link as lost. */
const LINK_STALE_MS = 35_000;
const CODE_MS = 10 * 60_000;
let pairFails = 0;

/** Hosted: turn on linking (and off watching this server's own files). */
export function useLinking() {
  HOSTED_WATCH_OFF = true;
  setInterval(changed, 5000); // "lost" shows up even when nothing's arriving
}

/** A fresh one-time code (the old one stops working). `command` builds the line to paste. */
export function newLinkCode(command: (code: string) => string) {
  // No look-alike characters (0/O, 1/I/L), easy to read out loud.
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const raw = [...bytes].map((b) => abc[b % abc.length]).join("");
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  linkCode = { code, command: command(code), expiresAt: Date.now() + CODE_MS };
  pairFails = 0;
  changed();
}

export function unlink() {
  bridge = null;
  linkCode = null;
  changed();
}

/** The script on your computer trades the code for a token. */
export function pairBridge(code: string, host: string): { token: string } | { error: string; status: number } {
  if (!linkCode || Date.now() > linkCode.expiresAt) return { error: "That code has expired. Press LINK in the game for a new one.", status: 410 };
  if (String(code).trim().toUpperCase() !== linkCode.code) {
    // A few typos are fine; guessing isn't.
    if (++pairFails >= 5) linkCode = null;
    changed();
    return { error: "That code doesn't match. Check it against the game.", status: 403 };
  }
  linkCode = null;
  bridge = { token: randomBytes(24).toString("base64url"), host: clip(host || "your computer", 40), sessions: [], seen: Date.now() };
  changed();
  return { token: bridge.token };
}

const sameToken = (t: string) => !!bridge && typeof t === "string" && t.length === bridge.token.length && t === bridge.token;

/** What the linked computer sees right now. */
export function bridgeUpdate(token: string, raw: unknown): boolean {
  if (!sameToken(token) || !bridge) return false;
  bridge.sessions = cleanSessions(raw);
  bridge.seen = Date.now();
  changed();
  return true;
}

export function bridgeBye(token: string) {
  if (!sameToken(token)) return false;
  bridge = null;
  changed();
  return true;
}

/** Only what the Office draws, sized sensibly: it came over the internet. */
function cleanSessions(raw: unknown): AgentSession[] {
  const list = (raw as { sessions?: unknown })?.sessions;
  if (!Array.isArray(list)) return [];
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const statuses: AgentStatus[] = ["thinking", "working", "waiting", "done", "failed"];
  const kinds: AgentFeedItem["kind"][] = ["think", "say", "tool", "result", "error", "prompt"];
  const agent = (a: Record<string, unknown>, lead: boolean): AgentInfo => ({
    id: lead ? "lead" : str(a.id, 80) || "agent",
    name: str(a.name, 80) || (lead ? "Claude" : "Helper"),
    kind: str(a.kind, 40) || "agent",
    depth: Math.min(9, num(a.depth)),
    parent: typeof a.parent === "string" ? a.parent.slice(0, 80) : null,
    status: statuses.includes(a.status as AgentStatus) ? (a.status as AgentStatus) : "thinking",
    now: str(a.now, 120),
    model: str(a.model, 60),
    startedAt: num(a.startedAt),
    lastAt: num(a.lastAt),
    doneAt: a.doneAt ? num(a.doneAt) : undefined,
    tools: num(a.tools),
    tokens: num(a.tokens),
    task: str(a.task, 1600),
    result: str(a.result, 1600),
    feed: (Array.isArray(a.feed) ? a.feed : []).slice(-FEED).map((f: Record<string, unknown>) => ({
      at: num(f?.at),
      kind: kinds.includes(f?.kind as AgentFeedItem["kind"]) ? (f.kind as AgentFeedItem["kind"]) : "say",
      text: str(f?.text, 600),
    })),
  });
  return list.slice(0, MAX_SESSIONS).map((x: Record<string, unknown>, i) => ({
    id: `linked:${str(x.id, 80) || i}`,
    source: "claude-code" as const,
    title: str(x.title, 120) || "Claude Code session",
    project: str(x.project, 60),
    branch: str(x.branch, 60),
    lead: agent((x.lead ?? {}) as Record<string, unknown>, true),
    workers: (Array.isArray(x.workers) ? x.workers : []).slice(0, MAX_WORKERS).map((w: Record<string, unknown>) => agent(w ?? {}, false)),
    live: true,
    lastAt: num(x.lastAt),
  }));
}

function linkView(): AgentLink | null {
  if (!HOSTED_WATCH_OFF) return null;
  const now = Date.now();
  if (bridge) return { status: now - bridge.seen > LINK_STALE_MS ? "lost" : "linked", host: bridge.host, at: bridge.seen };
  if (linkCode && now < linkCode.expiresAt) return { status: "waiting", code: linkCode.code, command: linkCode.command, expiresAt: linkCode.expiresAt };
  return { status: "off" };
}

// ---------------------------------------------------------------- the state everyone sees

function view(a: Runtime, now: number): AgentInfo {
  const info = { ...a.info, feed: a.info.feed.slice(-FEED) };
  // A sub-agent that went quiet mid-task was most likely stopped.
  if (!a.isLead && info.status !== "done" && info.status !== "failed" && now - info.lastAt > QUIET_MS) {
    info.status = "failed";
    info.now = "Went quiet (stopped?)";
    info.doneAt = info.lastAt;
  }
  // The lead with nothing in flight for a while is waiting on you.
  if (a.isLead && info.status !== "waiting" && !a.pending.size && now - info.lastAt > 3 * 60_000) {
    info.status = "waiting";
    info.now = "Waiting for you";
  }
  return info;
}

export function agentsState(): AgentsState {
  const now = Date.now();
  const sessions: AgentSession[] = [];
  for (const s of tracked.values()) {
    const workers = [...s.workers.values()]
      .map((w) => view(w, now))
      .filter((w) => (w.status !== "done" && w.status !== "failed") || now - (w.doneAt ?? w.lastAt) < DONE_KEEP_MS)
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(-MAX_WORKERS);
    const busy = workers.some((w) => w.status !== "done" && w.status !== "failed");
    const live = s.source === "replay" || busy || now - s.lastAt < LIVE_MS;
    if (!live) continue;
    const lead = view(s.lead, now);
    if (s.source === "claude-code") lead.name = "Claude";
    sessions.push({ id: s.id, source: s.source, title: s.title || (s.source === "replay" ? "Replay" : "Claude Code session"), project: s.project, branch: s.branch, lead, workers, live, lastAt: s.lastAt, replay: s.replay });
  }
  // Your linked computer's sessions (hosted), while the link is alive.
  if (bridge && now - bridge.seen <= LINK_STALE_MS) sessions.push(...bridge.sessions);
  // Replays and sessions with workers first, then the most recent.
  sessions.sort((a, b) => Number(b.source === "replay") - Number(a.source === "replay") || b.lastAt - a.lastAt);
  return {
    watching: !HOSTED_WATCH_OFF && existsSync(ROOT) ? ROOT.replace(homedir(), "~") : null,
    link: linkView(),
    sessions: sessions.slice(0, MAX_SESSIONS + 1),
  };
}

// ---------------------------------------------------------------- change notifications

const listeners = new Set<(s: AgentsState) => void>();
let lastSent = "";
let pendingEmit: NodeJS.Timeout | null = null;
let lastEmitAt = 0;

function changed() {
  if (pendingEmit) return;
  const wait = Math.max(0, 400 - (Date.now() - lastEmitAt));
  pendingEmit = setTimeout(() => {
    pendingEmit = null;
    lastEmitAt = Date.now();
    const state = agentsState();
    const json = JSON.stringify(state);
    if (json === lastSent) return;
    lastSent = json;
    listeners.forEach((fn) => fn(state));
  }, wait);
}

export function onAgentsChange(fn: (s: AgentsState) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let started = false;

/** Start watching (once). */
export function startAgentWatch() {
  if (started) return;
  started = true;
  const loop = () => {
    try {
      scan();
    } catch (err) {
      console.error("[agents] scan failed:", err);
    }
    changed();
  };
  loop();
  setInterval(loop, 1000);
  console.log(existsSync(ROOT) ? `[agents] watching Claude Code sessions in ${ROOT.replace(homedir(), "~")}` : "[agents] no Claude Code sessions folder yet (the Office will show replays and reported agents)");
}
