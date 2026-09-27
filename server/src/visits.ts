// Friends on this island (online). The gateway tells us who each connection
// is: the owner, or a friend visiting (with what the owner lets them do). A
// visitor sees the island, walks around, chats, helps gather (the materials
// stay here; they earn a few coins back home) and leaves gifts. They never
// see the owner's letters, texts, agents' thoughts or accounts, and they can
// only ask a neighbor for real help (with their own accounts, look-only) if
// the owner said so. Everything that touches their own island goes through
// the gateway (relay), which wakes it up if it's asleep.

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket } from "ws";
import { MATERIALS, MATERIAL_NAME, SERVICE_NAMES, VILLAGER_NAMES, VILLAGER_SERVICE, noMaterials, type GameEvent, type Materials, type ServerMessage, type Snapshot, type VillagerId } from "../../shared/game.js";
import { LANDING, WORLD_H, WORLD_W } from "../../shared/layout.js";
import { CHAT_MAX, NO_PERMS, type Peer, type Session, type VisitEntry, type VisitPerms } from "../../shared/visit.js";
import { askLookOnly, friendlyError } from "./agents.js";
import { plainChat } from "./chat.js";
import { signedInAs } from "./connectors/google.js";
import { HOSTED } from "./env.js";
import * as services from "./services.js";
import { audienceNote, personaFor } from "./villagers.js";
import { savePersist, world } from "./world.js";

const KEY = process.env.MOON_INTERNAL_KEY ?? "";
const GATEWAY = process.env.MOON_GATEWAY ?? "";
const OWNER_ID = process.env.MOON_USER_ID || "local";
const ownerName = () => (process.env.MOON_USER_NAME || signedInAs()?.name || "the owner").split(" ")[0];

export interface Who {
  id: string;
  name: string;
  role: "owner" | "visitor";
  tint: number;
  host: { id: string; name: string };
  perms?: VisitPerms;
}

function keyOk(got: unknown) {
  if (!KEY || typeof got !== "string") return false;
  const a = Buffer.from(got);
  const b = Buffer.from(KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Who's connecting. On your computer it's always you; online, only the gateway can say (else null: turned away). */
export function identify(req: IncomingMessage): Who | null {
  if (!HOSTED) {
    const name = ownerName();
    return { id: OWNER_ID, name: name === "the owner" ? "You" : name, role: "owner", tint: 0xffffff, host: { id: OWNER_ID, name } };
  }
  if (!keyOk(req.headers["x-moon-key"])) return null;
  try {
    const w = JSON.parse(Buffer.from(String(req.headers["x-moon-who"] ?? ""), "base64url").toString("utf8")) as Who;
    if (typeof w.id !== "string" || typeof w.name !== "string" || (w.role !== "owner" && w.role !== "visitor")) return null;
    return { ...w, perms: w.role === "visitor" ? { agents: Array.isArray(w.perms?.agents) ? w.perms.agents : [], office: w.perms?.office === true } : undefined };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- who's here

interface Here {
  who: Who;
  peer: Peer;
  wallet?: { coins: number; materials: Materials };
  lastChat: number;
}

const here = new Map<WebSocket, Here>();
let peerSeq = 0;

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function toAll(msg: ServerMessage, except?: WebSocket) {
  for (const ws of here.keys()) if (ws !== except) send(ws, msg);
}
function toOwners(msg: ServerMessage) {
  for (const [ws, h] of here) if (h.who.role === "owner") send(ws, msg);
}

export const whoOf = (ws: WebSocket) => here.get(ws)?.who;
export const isVisitor = (ws: WebSocket) => here.get(ws)?.who.role === "visitor";
/** A visitor the owner lets look inside the Office. */
export const seesOffice = (ws: WebSocket) => {
  const w = here.get(ws)?.who;
  return !!w && (w.role === "owner" || !!w.perms?.office);
};

function sessionOf(h: Here): Session {
  const owner = h.who.role === "owner";
  return {
    role: h.who.role,
    you: { id: h.peer.id, name: h.who.name, tint: h.who.tint },
    host: h.who.host,
    perms: h.who.perms ?? NO_PERMS,
    ...(h.wallet ? { wallet: h.wallet } : {}),
    ...(owner && HOSTED ? { log: (world.visits ?? []).slice(0, 30) } : {}),
  };
}

function sendSession(ws: WebSocket) {
  const h = here.get(ws);
  if (h) send(ws, { type: "session", session: sessionOf(h) });
}

/** Someone connected: tell them who they are and who else is here, and everyone else that they came. */
export function arrive(ws: WebSocket, who: Who) {
  const peer: Peer = { id: `${who.id}~${++peerSeq}`, name: who.name, owner: who.role === "owner", x: LANDING.x + 34, y: LANDING.y + 26, facing: "down", flip: false, moving: false, tint: who.tint };
  const h: Here = { who, peer, lastChat: 0 };
  here.set(ws, h);
  if (who.role === "visitor") {
    // (a visit within the last half hour is the same visit)
    const log = (world.visits ??= []);
    const recent = log.find((e) => e.id === who.id && Date.now() - e.at < 30 * 60_000);
    if (!recent) {
      log.unshift({ id: who.id, name: who.name, at: Date.now(), agents: [], gathered: 0, gifts: [] });
      log.length = Math.min(log.length, 40);
      savePersist();
    }
    toOwners({ type: "notice", text: `${who.name} is visiting your island!`, tone: "ok" });
    void refreshWallet(ws);
  }
  for (const [ows] of here) if (ows !== ws && here.get(ows)!.who.role === "owner") sendSession(ows);
}

/** Their first hello: who they are, and everyone else here. */
export function greet(ws: WebSocket) {
  const h = here.get(ws);
  if (!h) return;
  sendSession(ws);
  send(ws, { type: "peers", peers: [...here.entries()].filter(([o]) => o !== ws).map(([, x]) => x.peer) });
  toAll({ type: "peer", peer: h.peer }, ws);
}

export function depart(ws: WebSocket) {
  const h = here.get(ws);
  if (!h) return;
  here.delete(ws);
  toAll({ type: "peer_left", id: h.peer.id });
  if (h.who.role === "visitor" && ![...here.values()].some((x) => x.who.id === h.who.id)) toOwners({ type: "notice", text: `${h.who.name} headed home.` });
}

function entryFor(h: Here): VisitEntry | undefined {
  return world.visits?.find((e) => e.id === h.who.id);
}

// ---------------------------------------------------------------- what visitors see

/** Island changes anyone standing on it would see. Everything else (agents at work, letters, texts, music) is the owner's. */
const PUBLIC_EVENTS = new Set<GameEvent["type"]>([
  "building_built",
  "building_moved",
  "deco_placed",
  "deco_moved",
  "deco_toggled",
  "deco_sold",
  "lantern_moved",
  "rock_cleared",
  "rock_grown",
  "shard_found",
  "progress",
  "villager_arrived",
  "plot_revealed",
  "plot",
  "landmark_upgraded",
  "item_found",
  "harvested",
  "chore_spawned",
  "chore_cleared",
  "chore_gone",
  "happiness",
  "paths",
]);

export const visitorSees = (e: GameEvent) => PUBLIC_EVENTS.has(e.type);

/** The island as a visitor sees it: no letters, no agents' work or thoughts, no accounts. */
export function visitorSnapshot(s: Snapshot): Snapshot {
  const villagers = Object.fromEntries(Object.entries(s.villagers).map(([v, st]) => [v, { status: st.status === "error" ? "idle" : st.status, activity: st.status === "idle" ? st.activity : "busy" }])) as Snapshot["villagers"];
  return {
    ...s,
    account: null,
    villagers,
    clods: [],
    approvals: [],
    lanterns: s.lanterns.map((l) => ({ ...l, summary: "" })),
    phoneLinked: false,
    connections: { google: { connected: false, configured: false }, spotify: { connected: false, configured: false }, github: { connected: false }, canvas: { connected: false }, photon: { connected: false, phoneLinked: false, phones: [] }, web: { connected: false } },
    friendship: {},
    requests: [],
    introSeen: true,
    devMode: false,
    guest: false,
  };
}

// ---------------------------------------------------------------- moving and chatting

const clamp = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v))));

export function moved(ws: WebSocket, msg: { x: unknown; y: unknown; facing: unknown; flip: unknown; moving: unknown }) {
  const h = here.get(ws);
  if (!h || !Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) return;
  const p = h.peer;
  p.x = clamp(msg.x, 0, WORLD_W);
  p.y = clamp(msg.y, 0, WORLD_H);
  p.facing = msg.facing === "up" || msg.facing === "side" ? msg.facing : "down";
  p.flip = msg.flip === true;
  p.moving = msg.moving === true;
  toAll({ type: "peer", peer: p }, ws);
}

export function chat(ws: WebSocket, raw: unknown) {
  const h = here.get(ws);
  if (!h || typeof raw !== "string") return;
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, CHAT_MAX);
  if (!text || Date.now() - h.lastChat < 600) return;
  h.lastChat = Date.now();
  toAll({ type: "peer_chat", id: h.peer.id, name: h.who.name, text });
}

/** The owner sends a visitor home. */
export function sendHome(visitorId: string, text: string) {
  for (const [ws, h] of here) {
    if (h.who.role !== "visitor" || (visitorId !== "*" && h.who.id !== visitorId)) continue;
    send(ws, { type: "kicked", text });
    // (a moment to read it; then gone, even if their end never answers)
    setTimeout(() => ws.terminate(), 300);
  }
}

// ---------------------------------------------------------------- their own island (through the gateway)

async function relay(to: string, path: string, body: object): Promise<Record<string, unknown>> {
  if (!GATEWAY || !KEY) throw new Error("Visiting only works online.");
  const r = await fetch(`${GATEWAY}/internal/relay`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-moon-key": KEY },
    body: JSON.stringify({ to, path, body }),
    signal: AbortSignal.timeout(path === "/internal/ask" ? 125_000 : 20_000),
  });
  const out = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(typeof out.error === "string" ? out.error : "Their island didn't answer.");
  return out;
}

const asWallet = (o: Record<string, unknown>) => {
  const m = noMaterials();
  const src = (o.materials ?? {}) as Record<string, unknown>;
  for (const k of MATERIALS) m[k] = Math.max(0, Math.floor(Number(src[k]) || 0));
  return { coins: Math.max(0, Math.floor(Number(o.coins) || 0)), materials: m };
};

async function refreshWallet(ws: WebSocket) {
  const h = here.get(ws);
  if (!h || h.who.role !== "visitor") return;
  try {
    h.wallet = asWallet(await relay(h.who.id, "/internal/wallet", {}));
    sendSession(ws);
  } catch (err) {
    console.warn("[visit] couldn't read a visitor's wallet:", err instanceof Error ? err.message : err);
  }
}

/**
 * A visitor gathered something here: the materials stay on this island (they
 * already went into its stockpile), and the coins go home with them.
 */
export async function thankGatherer(ws: WebSocket, coins: number) {
  const h = here.get(ws);
  if (!h || h.who.role !== "visitor") return;
  const e = entryFor(h);
  if (e) {
    e.gathered++;
    savePersist();
  }
  if (coins <= 0) return;
  try {
    h.wallet = asWallet(await relay(h.who.id, "/internal/credit", { coins, why: `helping out on ${ownerName()}'s island` }));
    sendSession(ws);
  } catch (err) {
    console.warn("[visit] couldn't pay a visitor:", err instanceof Error ? err.message : err);
  }
}

/** A visitor leaves the owner a gift, out of their own coins and materials. */
export async function gift(ws: WebSocket, msg: { coins?: unknown; materials?: unknown }): Promise<string | null> {
  const h = here.get(ws);
  if (!h || h.who.role !== "visitor") return null;
  const coins = clamp(msg.coins ?? 0, 0, 5000);
  const materials: Partial<Materials> = {};
  const src = (msg.materials && typeof msg.materials === "object" ? msg.materials : {}) as Record<string, unknown>;
  for (const k of MATERIALS) {
    const n = clamp(src[k] ?? 0, 0, 999);
    if (n > 0) materials[k] = n;
  }
  if (!coins && !Object.keys(materials).length) return "Pick something to give first.";
  try {
    const r = await relay(h.who.id, "/internal/debit", { coins, materials });
    if (r.ok !== true) return typeof r.error === "string" ? r.error : "You don't have that much.";
    h.wallet = asWallet(r);
    sendSession(ws);
  } catch (err) {
    return err instanceof Error ? err.message : "That didn't go through.";
  }
  world.coins += coins;
  for (const [k, n] of Object.entries(materials) as [keyof Materials, number][]) world.materials[k] += n;
  const what = [...(coins ? [`${coins}¢`] : []), ...Object.entries(materials).map(([k, n]) => `${n} ${MATERIAL_NAME[k as keyof Materials]}`)].join(", ");
  const e = entryFor(h);
  if (e) e.gifts.unshift(what);
  savePersist();
  services.announceProgress(materials);
  toAll({ type: "notice", text: `${h.who.name} left ${ownerName()} a gift: ${what}!`, tone: "ok" });
  for (const [ows, x] of here) if (x.who.role === "owner") sendSession(ows);
  return null;
}

// ---------------------------------------------------------------- talking to the neighbors

/** Questions a visitor has asked in the last hour (a friend's island isn't a free-for-all). */
const asked = new Map<string, number[]>();
const ASKS_PER_HOUR = 20;

/**
 * A visitor talks to one of the neighbors here. Allowed to ask that neighbor for
 * help? Then it's answered on the visitor's own island, with their own accounts,
 * look-only. Otherwise it's small talk. Either way the answer is said out loud,
 * so everyone on the island hears it.
 */
export async function visitorTalk(ws: WebSocket, v: VillagerId, raw: string) {
  const h = here.get(ws);
  if (!h) return;
  const text = raw.trim().slice(0, 1000);
  const say = (reply: string) => toAll({ type: "event", event: { type: "say", villager: v, text: reply, seq: world.seq, at: Date.now() } });
  if (!services.residents().includes(v)) return say(`${VILLAGER_NAMES[v]} doesn't live here.`);
  const times = (asked.get(h.who.id) ?? []).filter((t) => Date.now() - t < 3_600_000);
  if (times.length >= ASKS_PER_HOUR) return say("Phew, that's a lot of questions! Give me a little while.");
  times.push(Date.now());
  asked.set(h.who.id, times);
  try {
    if (h.who.perms?.agents.includes(v)) {
      const r = await relay(h.who.id, "/internal/ask", { villager: v, text, host: ownerName(), asker: h.who.name });
      const e = entryFor(h);
      if (e && !e.agents.includes(v)) {
        e.agents.push(v);
        savePersist();
        for (const [ows, x] of here) if (x.who.role === "owner") sendSession(ows);
      }
      return say(typeof r.reply === "string" && r.reply ? r.reply : "Hmm, I came up empty.");
    }
    const service = VILLAGER_SERVICE[v];
    const system =
      personaFor(v) +
      audienceNote("talk") +
      `\n\nRIGHT NOW ${h.who.name.toUpperCase()}, A FRIEND OF ${ownerName().toUpperCase()}'S, IS VISITING and talking to you. You work for ${ownerName()}, whose island this is. Chat with ${h.who.name} warmly, in character, about the Moon, the island and yourself. Never share or guess anything about ${ownerName()}'s ${service && service !== "web" ? SERVICE_NAMES[service] : "life"}, work, messages or plans. If ${h.who.name} asks you to look something up or do something, explain kindly that ${ownerName()} hasn't said you can help visitors with that (they can ask ${ownerName()} to allow it).`;
    return say(await plainChat(v, system, [{ role: "user", content: text }]));
  } catch (err) {
    console.warn(`[visit] ${v} couldn't answer a visitor:`, err instanceof Error ? err.message : err);
    return say(err instanceof Error && /Connect|online/.test(err.message) ? err.message : friendlyError(err));
  }
}

// ---------------------------------------------------------------- the gateway's notes to this island

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error("too big");
  }
  const v = JSON.parse(raw || "{}");
  return v && typeof v === "object" ? v : {};
}

let onPermsChanged: (ws: WebSocket) => void = () => {};
/** (index.ts: a visitor may now see the Office, or not) */
export function whenPermsChange(fn: (ws: WebSocket) => void) {
  onPermsChanged = fn;
}

export async function internalRoute(req: IncomingMessage, res: ServerResponse, url: URL) {
  const json = (status: number, out: object) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
  };
  if (!HOSTED || req.method !== "POST" || !keyOk(req.headers["x-moon-key"])) return json(404, { error: "no such thing" });
  let b: Record<string, unknown>;
  try {
    b = await body(req);
  } catch {
    return json(400, { error: "bad request" });
  }
  const wallet = () => ({ coins: world.coins, materials: { ...world.materials } });
  switch (url.pathname) {
    // ---- about this player, while they're off visiting a friend
    case "/internal/wallet":
      return json(200, wallet());
    case "/internal/credit": {
      const coins = clamp(b.coins ?? 0, 0, 1000);
      world.coins += coins;
      savePersist();
      services.announceProgress();
      return json(200, wallet());
    }
    case "/internal/debit": {
      const coins = clamp(b.coins ?? 0, 0, 5000);
      const want = (b.materials && typeof b.materials === "object" ? b.materials : {}) as Record<string, unknown>;
      const m: Partial<Materials> = {};
      for (const k of MATERIALS) {
        const n = clamp(want[k] ?? 0, 0, 999);
        if (n) m[k] = n;
      }
      if (world.coins < coins) return json(200, { ok: false, error: `You only have ${world.coins}¢ back home.` });
      const short = (Object.entries(m) as [keyof Materials, number][]).find(([k, n]) => world.materials[k] < n);
      if (short) return json(200, { ok: false, error: `You only have ${world.materials[short[0]]} ${MATERIAL_NAME[short[0]]} back home.` });
      world.coins -= coins;
      for (const [k, n] of Object.entries(m) as [keyof Materials, number][]) world.materials[k] -= n;
      savePersist();
      services.announceProgress();
      return json(200, { ok: true, ...wallet() });
    }
    case "/internal/ask": {
      const v = String(b.villager ?? "") as VillagerId;
      if (!Object.hasOwn(VILLAGER_NAMES, v)) return json(400, { error: "who?" });
      const service = VILLAGER_SERVICE[v];
      if (service && service !== "web" && !services.ready(service))
        return json(200, { reply: `I'd love to, but I'd need your ${SERVICE_NAMES[service]}: connect it on your own island first, then ask me again here.` });
      try {
        return json(200, { reply: await askLookOnly(v, String(b.text ?? "").slice(0, 1000), String(b.host ?? "your friend").slice(0, 40), String(b.asker ?? "a friend").slice(0, 40)) });
      } catch (err) {
        console.error(`[visit] ${v} failed a friend's question:`, err);
        return json(200, { reply: friendlyError(err) });
      }
    }
    // ---- about this island's visitors
    case "/internal/perms": {
      const id = String(b.id ?? "");
      const p = b.perms as VisitPerms | undefined;
      const perms: VisitPerms = { agents: Array.isArray(p?.agents) ? p.agents : [], office: p?.office === true };
      for (const [ws, h] of here) {
        if (h.who.role !== "visitor" || h.who.id !== id) continue;
        h.who.perms = perms;
        sendSession(ws);
        onPermsChanged(ws);
      }
      return json(200, { ok: true });
    }
    case "/internal/kick":
      sendHome(b.all === true ? "*" : String(b.id ?? ""), String(b.text ?? "You were sent home.").slice(0, 200));
      return json(200, { ok: true });
    case "/internal/social":
      toOwners({ type: "social", ...(typeof b.text === "string" ? { text: b.text.slice(0, 200) } : {}) });
      return json(200, { ok: true });
  }
  return json(404, { error: "no such thing" });
}
