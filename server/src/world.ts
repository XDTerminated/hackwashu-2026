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
  type ColonyRequest,
  type Deco,
  type GameEvent,
  type Lantern,
  type OfficeProject,
  type OfficeState,
  type Progress,
  QUESTS,
  type SeqEvent,
  type Snapshot,
  type VillagerId,
  type VillagerState,
} from "../../shared/game.js";

import { decorById, decorFootprint } from "../../shared/decor.js";
<<<<<<< Updated upstream
import { SPOTS, applyLayout, buildingFootprint, canOccupy, type Rect } from "../../shared/layout.js";
=======
import { ROCK_COST, SHARD_BONUS, SHARD_COUNT, SHARD_REWARD, SPOTS, applyLayout, buildingRects, canOccupy, footprint, lanternAt, rockKey, rockRect, rockSpots, shardKey, shardSpots, type Rect, type RockKind } from "../../shared/layout.js";
>>>>>>> Stashed changes

const here = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(here, "..", "data", "world.json");

const SAVE_VERSION = 2;

/** What a villager remembers about the player, across texts and visits. */
export interface VillagerMemory {
  log: { who: "player" | "me"; text: string; via: "text" | "visit"; at: number }[];
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
  clearedRocks: string[];
  shards: string[];
  requests: { day: string; list: ColonyRequest[] };
  office: { project: OfficeProject | null; history: OfficeState["history"] };
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
  const progress: Progress = { quest: 0, count: 0, revealed: [...Object.values(BUILDINGS).filter((b) => b.starter).map((b) => b.id), "office"], sandbox: {} };
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
    clearedRocks: [],
    shards: [],
    requests: { day: "", list: [] },
    office: { project: null, history: [] },
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

function load(): World {
  try {
    if (!existsSync(DATA_FILE)) return freshWorld();
    const w = JSON.parse(readFileSync(DATA_FILE, "utf8")) as World;
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
    w.clearedRocks ??= [];
    w.shards ??= [];
    w.requests ??= { day: "", list: [] };
    w.office ??= { project: null, history: [] };
    // An office project mid-flight when the server stopped can't resume.
    const op = w.office.project;
    if (op && !["done", "failed"].includes(op.status)) {
      op.status = "failed";
      op.error = "interrupted when the colony server restarted";
      op.lead = "stuck: the server restarted mid-project";
      for (const wk of op.workers) if (wk.status === "working") wk.status = "failed";
    }
    // The office is open to everyone from the start (a plot to build).
    if (!w.progress.revealed.includes("office")) w.progress.revealed.push("office");
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

let saveTimer: NodeJS.Timeout | null = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      writeFileSync(DATA_FILE, JSON.stringify(world));
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
<<<<<<< Updated upstream
=======
    devMode: isDevWorld(),
    clearedRocks: world.clearedRocks,
    shards: world.shards,
    requests: world.requests.list,
    // filled in by index.ts from office.ts (it knows which providers are set up)
    office: { providers: [], project: world.office.project, history: world.office.history },
>>>>>>> Stashed changes
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

/** Footprints of everything placed, except the one thing being moved. */
export function occupied(except?: { building?: BuildingId; deco?: string }): Rect[] {
  const out: Rect[] = [];
  for (const b of Object.keys(SPOTS) as BuildingId[]) {
    if (b === except?.building) continue;
    const shown = owns(b) || (world.progress.revealed.includes(b) && b !== "mailbox");
    if (shown) out.push(buildingFootprint(b));
  }
  for (const d of world.decos) {
    const def = decorById(d.item);
    if (def && d.id !== except?.deco) out.push(decorFootprint(def, d.x, d.y));
  }
<<<<<<< Updated upstream
  return out;
}

=======
  world.lanterns.forEach((l, i) => {
    if (l.id === except?.lantern) return;
    const p = lanternAt(l, i);
    out.push(footprint(p.x, p.y, 1, 1));
  });
  for (const r of rockSpots(decoRects(), world.clearedRocks)) out.push(rockRect(r));
  return out;
}

/**
 * What turns up under a rock. Crystal outcrops always pay, arches usually
 * do, so clearing is a little gamble (sometimes a big win).
 */
const LOOT: Record<RockKind, { chance: number; min: number; max: number; what: string }> = {
  small: { chance: 0.3, min: 5, max: 15, what: "a few moon pennies" },
  big: { chance: 0.5, min: 10, max: 45, what: "a geode" },
  spire: { chance: 0.55, min: 15, max: 50, what: "an old probe part" },
  crystal: { chance: 1, min: 20, max: 90, what: "raw moon-crystal" },
  arch: { chance: 0.75, min: 30, max: 130, what: "a fossilized meteorite" },
};

/** Pay to clear a rock away for good. */
export function clearRock(x: number, y: number): { ok: true; cost: number; loot?: { coins: number; what: string } } | { ok: false; reason: string } {
  const rock = rockSpots(decoRects(), world.clearedRocks).find((r) => r.x === x && r.y === y);
  if (!rock) return { ok: false, reason: "There's no rock there." };
  const cost = ROCK_COST[rock.kind];
  if (world.coins < cost) return { ok: false, reason: `Clearing that costs ${cost}¢.` };
  world.coins -= cost;
  world.clearedRocks.push(rockKey(rock));
  const l = LOOT[rock.kind];
  let loot: { coins: number; what: string } | undefined;
  if (Math.random() < l.chance) {
    loot = { coins: Math.round(l.min + Math.random() * (l.max - l.min)), what: l.what };
    world.coins += loot.coins;
  }
  persist();
  return { ok: true, cost, ...(loot ? { loot } : {}) };
}

/** Pick up a Moon Shard (each spot once); finding them all pays a bonus. */
export function collectShard(x: number, y: number): { ok: true; reward: number; bonus?: number } | { ok: false } {
  const spot = shardSpots().find((p) => p.x === x && p.y === y);
  if (!spot || world.shards.includes(shardKey(spot))) return { ok: false };
  world.shards.push(shardKey(spot));
  world.coins += SHARD_REWARD;
  const bonus = world.shards.length === SHARD_COUNT ? SHARD_BONUS : undefined;
  if (bonus) world.coins += bonus;
  persist();
  return { ok: true, reward: SHARD_REWARD, ...(bonus ? { bonus } : {}) };
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

>>>>>>> Stashed changes
/** Buildings (and revealed plots) can be moved anywhere their tiles fit. */
export function moveBuilding(b: BuildingId, x: number, y: number): boolean {
  if (!SPOTS[b] || (!owns(b) && !world.progress.revealed.includes(b))) return false;
  if (!canOccupy(buildingFootprint(b, { x, y }), occupied({ building: b }))) return false;
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
