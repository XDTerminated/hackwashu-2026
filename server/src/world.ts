// Authoritative colony state + event bus. Persisted to server/data/world.json
// so agents keep working (and their results keep waiting) while the game is closed.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILDINGS,
  type Approval,
  type BuildingId,
  type Chore,
  type Clod,
  type Deco,
  type GameEvent,
  type Lantern,
  type Progress,
  QUESTS,
  type SeqEvent,
  type Snapshot,
  type VillagerId,
  type VillagerState,
} from "../../shared/game.js";

import { decorById, decorFootprint } from "../../shared/decor.js";
import { SPOTS, applyLayout, buildingRects, canOccupy, footprint, lanternAt, rockRect, rockSpots, type Rect } from "../../shared/layout.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(here, "..", "data", "world.json");

const SAVE_VERSION = 2;

/** What a villager remembers about the player, across texts and visits. */
export interface VillagerMemory {
  /** `notes`: what they found but didn't say yet, so "tell me more" doesn't need another lookup. */
  log: { who: "player" | "me"; text: string; via: "text" | "visit"; at: number; notes?: string }[];
  facts: string[];
  points: number;
  day?: string;
  dayPoints?: number;
}

interface World {
  version: number;
  coins: number;
  chores: Record<string, Chore>;
  /** Phones linked over iMessage, keyed by E.164 number. */
  phones: Record<string, { phone: string; linkedAt: number; photonUserId?: string; line?: string }>;
  choreOptIn: Partial<Record<VillagerId, boolean>>;
  memory: Partial<Record<VillagerId, VillagerMemory>>;
  layout: Partial<Record<BuildingId, { x: number; y: number }>>;
  lastChoreAt: Partial<Record<VillagerId, number>>;
  progress: Progress;
  buildings: Partial<Record<BuildingId, boolean>>;
  villagers: Record<VillagerId, VillagerState>;
  clods: Record<string, Clod>;
  approvals: Record<string, Approval>;
  lanterns: Lantern[];
  decos: Deco[];
  seq: number;
  log: SeqEvent[];
}

const idle = (): VillagerState => ({ status: "idle", activity: "relaxing" });

function freshWorld(): World {
  const buildings: Partial<Record<BuildingId, boolean>> = {};
  for (const b of Object.values(BUILDINGS)) if (b.starter) buildings[b.id] = true;
  const progress: Progress = { quest: 0, count: 0, revealed: Object.values(BUILDINGS).filter((b) => b.starter).map((b) => b.id), sandbox: {} };
  // Demo prep / testing: everything built and revealed, on the last quest.
  if (process.env.UNLOCK_ALL === "1") {
    for (const b of Object.values(BUILDINGS)) buildings[b.id] = true;
    progress.revealed = Object.values(BUILDINGS).map((b) => b.id);
    progress.quest = QUESTS.length - 1;
  }
  return {
    version: SAVE_VERSION,
    coins: 50,
    chores: {},
    phones: {},
    choreOptIn: {},
    memory: {},
    layout: {},
    lastChoreAt: {},
    progress,
    buildings,
    villagers: { jade_rabbit: idle(), postmaster: idle(), timekeeper: idle(), scholar: idle(), stargazer: idle() },
    clods: {},
    approvals: {},
    lanterns: [],
    decos: [],
    seq: 0,
    log: [],
  };
}

function load(file = DATA_FILE): World {
  try {
    if (!existsSync(file)) return freshWorld();
    const w = JSON.parse(readFileSync(file, "utf8")) as World;
    if (w.version !== SAVE_VERSION) {
      console.log("[world] save is from before the unlock chain — starting a fresh colony");
      return freshWorld();
    }
    w.villagers.scholar ??= idle();
    w.chores ??= {};
    w.phones ??= {};
    w.choreOptIn ??= {};
    w.memory ??= {};
    w.layout ??= {};
    w.decos.forEach((d, i) => (d.id ??= `deco_old${i}`));
    w.lastChoreAt ??= {};
    // Anything mid-flight when the server stopped can't resume — its agent loop is gone.
    for (const c of Object.values(w.clods)) {
      if (c.status === "working" || c.status === "stuck") {
        c.status = "failed";
        c.result = "interrupted when the colony server restarted";
      }
    }
    for (const a of Object.values(w.approvals)) if (a.status === "pending") a.status = "denied";
    for (const v of Object.values(w.villagers)) {
      v.status = "idle";
      v.activity = "relaxing";
    }
    return w;
  } catch (err) {
    console.error("[world] couldn't read save, starting fresh:", err);
    return freshWorld();
  }
}

export const world = load();
applyLayout(world.layout);

// ---------------------------------------------------------------- dev mode
// A separate showcase save with everything unlocked. Switching never touches
// the real save: it's written out first, and switching back reloads it as-is.

const DEV_FILE = join(here, "..", "data", "world-dev.json");
let saveFile = DATA_FILE;

export function isDevWorld() {
  return saveFile === DEV_FILE;
}

/** Everything built and revealed, every quest done, sample data so every villager moves in, coins to spend. */
function showcase(w: World): World {
  for (const b of Object.keys(BUILDINGS) as BuildingId[]) w.buildings[b] = true;
  w.progress.revealed = Object.keys(BUILDINGS) as BuildingId[];
  w.progress.quest = QUESTS.length;
  w.progress.count = 0;
  w.progress.sandbox = { ...w.progress.sandbox, google: true, canvas: true };
  w.coins = Math.max(w.coins, 5000);
  for (const a of Object.values(w.approvals)) if (a.status === "pending") a.status = "denied";
  return w;
}

/** Swap between the real save and the dev showcase save. Returns false if already there. */
export function switchWorld(dev: boolean): boolean {
  if (dev === isDevWorld()) return false;
  flushSave();
  const next = dev ? DEV_FILE : DATA_FILE;
  const w = dev && !existsSync(DEV_FILE) ? showcase(JSON.parse(JSON.stringify(world)) as World) : load(next);
  saveFile = next;
  for (const k of Object.keys(world)) delete (world as unknown as Record<string, unknown>)[k];
  Object.assign(world, w);
  applyLayout(world.layout);
  flushSave();
  console.log(`[world] now on the ${dev ? "dev showcase" : "real"} save`);
  return true;
}

function flushSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  mkdirSync(dirname(saveFile), { recursive: true });
  writeFileSync(saveFile, JSON.stringify(world));
}

let saveTimer: NodeJS.Timeout | null = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(saveFile), { recursive: true });
      writeFileSync(saveFile, JSON.stringify(world));
    } catch (err) {
      console.error("[world] save failed:", err);
    }
  }, 250);
}

type Listener = (e: SeqEvent) => void;
const listeners = new Set<Listener>();

export function onEvent(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(e: GameEvent) {
  const evt = { ...e, seq: ++world.seq, at: Date.now() } as SeqEvent;
  world.log.push(evt);
  if (world.log.length > 400) world.log.splice(0, world.log.length - 400);
  persist();
  for (const fn of listeners) fn(evt);
}

export function snapshot(): Snapshot {
  return {
    coins: world.coins,
    buildings: world.buildings,
    villagers: world.villagers,
    clods: Object.values(world.clods).filter((c) => c.status !== "popped"),
    approvals: Object.values(world.approvals).filter((a) => a.status === "pending"),
    lanterns: world.lanterns,
    decos: world.decos,
    lastSeq: world.seq,
    phoneLinked: false,
    progress: world.progress,
    // filled in by services.ts, which knows about connected accounts
    connections: { google: { connected: false, configured: false }, canvas: { connected: false }, photon: { connected: false, phoneLinked: false, phones: [] }, web: { connected: false } },
    residents: [],
    rabbitTeamwork: false,
    chores: Object.values(world.chores),
    choreOptIn: world.choreOptIn,
    friendship: Object.fromEntries(Object.entries(world.memory).map(([v, m]) => [v, m!.points])),
    layout: world.layout,
    devMode: isDevWorld(),
  };
}

export function owns(b: BuildingId) {
  return world.buildings[b] === true;
}

export function setVillager(id: VillagerId, patch: Partial<VillagerState>) {
  Object.assign(world.villagers[id], patch);
  persist();
}

export function putClod(c: Clod) {
  world.clods[c.id] = c;
  persist();
}

export function putApproval(a: Approval) {
  world.approvals[a.id] = a;
  persist();
}

export function addLantern(l: Lantern) {
  world.lanterns.push(l);
  persist();
}

export function popClod(clodId: string): { ok: true; reward: number } | { ok: false; reason: string } {
  const c = world.clods[clodId];
  if (!c) return { ok: false, reason: "no such clod" };
  if (c.status !== "ready" && c.status !== "failed") return { ok: false, reason: `clod is ${c.status}` };
  const reward = c.status === "ready" ? c.reward : 1;
  c.status = "popped";
  world.coins += reward;
  persist();
  return { ok: true, reward };
}

export function build(b: BuildingId): { ok: true } | { ok: false; reason: string } {
  const def = BUILDINGS[b];
  if (!def) return { ok: false, reason: "unknown building" };
  if (owns(b)) return { ok: false, reason: `${def.name} is already built` };
  if (!world.progress.revealed.includes(b)) return { ok: false, reason: `nobody has discovered where the ${def.name} goes yet` };
  if (world.coins < def.price) return { ok: false, reason: `${def.name} costs ${def.price} coins` };
  world.coins -= def.price;
  world.buildings[b] = true;
  if (b === "post_office") world.buildings.mailbox = true;
  persist();
  return { ok: true };
}

export function placeDeco(d: Deco, price: number): { ok: true } | { ok: false; reason: string } {
  if (world.coins < price) return { ok: false, reason: "not enough coins" };
  world.coins -= price;
  world.decos.push(d);
  persist();
  return { ok: true };
}

/** Where decorations and task lanterns stand (rocks keep clear of them). */
export function decoRects(): Rect[] {
  const out: Rect[] = [];
  for (const d of world.decos) {
    const def = decorById(d.item);
    if (def) out.push(decorFootprint(def, d.x, d.y));
  }
  world.lanterns.forEach((l, i) => {
    const p = lanternAt(l, i);
    out.push(footprint(p.x, p.y, 1, 1));
  });
  return out;
}

/** Footprints of everything placed, except the one thing being moved. */
export function occupied(except?: { building?: BuildingId; deco?: string; lantern?: string }): Rect[] {
  const out: Rect[] = [];
  for (const b of Object.keys(SPOTS) as BuildingId[]) {
    if (b === except?.building) continue;
    const shown = owns(b) || (world.progress.revealed.includes(b) && b !== "mailbox");
    if (shown) out.push(...buildingRects(b));
  }
  for (const d of world.decos) {
    const def = decorById(d.item);
    if (def && d.id !== except?.deco) out.push(decorFootprint(def, d.x, d.y));
  }
  world.lanterns.forEach((l, i) => {
    if (l.id === except?.lantern) return;
    const p = lanternAt(l, i);
    out.push(footprint(p.x, p.y, 1, 1));
  });
  for (const r of rockSpots(decoRects())) out.push(rockRect(r));
  return out;
}

/** Task lanterns can be moved (but not sold: they're earned). */
export function moveLantern(id: string, x: number, y: number): boolean {
  const l = world.lanterns.find((l) => l.id === id);
  if (!l || !canOccupy(footprint(x, y, 1, 1), occupied({ lantern: id }))) return false;
  l.x = x;
  l.y = y;
  persist();
  return true;
}

/** Buildings (and revealed plots) can be moved anywhere their tiles fit. */
export function moveBuilding(b: BuildingId, x: number, y: number): boolean {
  if (!SPOTS[b] || (!owns(b) && !world.progress.revealed.includes(b))) return false;
  if (!canOccupy(buildingRects(b, { x, y }), occupied({ building: b }))) return false;
  world.layout[b] = { x, y };
  applyLayout(world.layout);
  persist();
  return true;
}

export function moveDeco(id: string, x: number, y: number): boolean {
  const d = world.decos.find((d) => d.id === id);
  if (!d) return false;
  d.x = x;
  d.y = y;
  persist();
  return true;
}

/** Removes a placed decoration; returns the item id, or null if it doesn't exist. */
export function removeDeco(id: string, refund: number): string | null {
  const i = world.decos.findIndex((d) => d.id === id);
  if (i < 0) return null;
  const [d] = world.decos.splice(i, 1);
  world.coins += refund;
  persist();
  return d.item;
}

let idCounter = 0;
export function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`;
}

export function savePersist() {
  persist();
}
