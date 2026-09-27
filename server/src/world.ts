// Authoritative colony state + event bus. Persisted to server/data/world.json
// so agents keep working (and their results keep waiting) while the game is closed.

import type { TeamProject, TeamState } from "../../shared/team.js";
import { oldPathTiles, type PathStyle } from "../../shared/paths.js";
import type { VisitEntry } from "../../shared/visit.js";
import { DATA_DIR, HOSTED } from "./env.js";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
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
  MAX_LANTERNS,
  MOVE_INS,
  type Materials,
  type Progress,
  moveInAt,
  onMap,
  type SeqEvent,
  type Snapshot,
  type VillagerId,
  type VillagerState,
  noMaterials,
} from "../../shared/game.js";
import { freshTown, maxStage } from "../../shared/town.js";

import { decorById, decorFootprint } from "../../shared/decor.js";
import { ROCK_STONE, SHARD_BONUS, SHARD_COUNT, SHARD_REWARD, SPOTS, applyLayout, buildingRects, canOccupy, footprint, lanternAt, lanternSpot, rockKey, rockRect, rockSpots, shardKey, shardSpots, tileAt, type Rect, type RockKind } from "../../shared/layout.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(DATA_DIR, "world.json");

// 3: the town (landmarks, Town Hall room for neighbors): everyone starts fresh.
const SAVE_VERSION = 3;

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
  /** What you've collected around the island, for repairs. */
  materials: Materials;
  chores: Record<string, Chore>;
  /** Phones linked over iMessage, keyed by E.164 number. */
  phones: Record<string, { phone: string; linkedAt: number; photonUserId?: string; line?: string }>;
  choreOptIn: Partial<Record<VillagerId, boolean>>;
  memory: Partial<Record<VillagerId, VillagerMemory>>;
  layout: Partial<Record<BuildingId, { x: number; y: number }>>;
  clearedRocks: string[];
  /** The intro has played for this player (it only plays the first time). */
  introSeen?: boolean;
  /** When the last cleared rock grew back (they return slowly, one at a time). */
  rocksGrewAt?: number;
  /** Friends who've visited (online; newest first), for the owner's visitor log. */
  visits?: VisitEntry[];
  /** The AI team on the Office's project board (see team.ts). */
  team?: { project: TeamProject | null; history: TeamState["history"] };
  /** Paths the player laid, by tile ("tx,ty"). */
  paths: Record<string, PathStyle>;
  /** 1: the old automatic paths became tiles the player owns. */
  pathsV?: number;
  shards: string[];
  requests: { day: string; list: ColonyRequest[]; v?: number };
  lastChoreAt: Partial<Record<VillagerId, number>>;
  progress: Progress;
  buildings: Partial<Record<BuildingId, boolean>>;
  villagers: Record<VillagerId, VillagerState>;
  clods: Record<string, Clod>;
  approvals: Record<string, Approval>;
  lanterns: Lantern[];
  decos: Deco[];
  seq: number;
}

const idle = (): VillagerState => ({ status: "idle", activity: "relaxing" });

function freshWorld(): World {
  const buildings: Partial<Record<BuildingId, boolean>> = {};
  for (const b of Object.values(BUILDINGS)) if (b.starter) buildings[b.id] = true;
  // Neighbors' homes aren't on the map until you buy their plot at the Town Hall and set it down.
  const progress: Progress = { town: freshTown(), revealed: Object.values(BUILDINGS).filter((b) => b.starter).map((b) => b.id), sandbox: {}, movedIn: [], plots: {} };
  // Demo prep / testing: everything built and revealed, everyone home.
  if (process.env.UNLOCK_ALL === "1") {
    for (const b of Object.values(BUILDINGS)) buildings[b.id] = true;
    progress.revealed = Object.values(BUILDINGS).map((b) => b.id);
    everyoneHome(progress);
    progress.town = { ...freshTown(), stages: { town_hall: maxStage("town_hall"), fountain: 2, roads: 2, market: 2 }, used: ["charter", "valve", "lens", "bell"], tasks: ["nova_search", "real_job"] };
  }
  return {
    version: SAVE_VERSION,
    coins: 50,
    materials: noMaterials(),
    chores: {},
    phones: {},
    choreOptIn: {},
    memory: {},
    layout: {},
    paths: {},
    pathsV: 1,
    clearedRocks: [],
    shards: [],
    requests: { day: "", list: [] },
    lastChoreAt: {},
    introSeen: false,
    progress,
    buildings,
    villagers: { jade_rabbit: idle(), postmaster: idle(), timekeeper: idle(), scholar: idle(), stargazer: idle(), manager: idle(), dj: idle(), mechanic: idle() },
    clods: {},
    approvals: {},
    lanterns: [],
    decos: [],
    seq: 0,
  };
}

/** How far a shard key ("x,y") is from a point. */
const dist = (key: string, x: number, y: number) => {
  const [kx, ky] = key.split(",").map(Number);
  return Math.hypot(kx - x, ky - y);
};

/** Finished records (popped stars, answered letters) only matter for a while: keep the latest few. */
const KEEP_RESOLVED = 50;
function trimResolved<T>(rec: Record<string, T>, done: (t: T) => boolean) {
  const old = Object.keys(rec).filter((k) => done(rec[k]));
  for (const k of old.slice(0, Math.max(0, old.length - KEEP_RESOLVED))) delete rec[k];
}

/** Save files from a newer server version: kept exactly as they are, never written over. */
const frozen = new Set<string>();

function load(file = DATA_FILE): World {
  try {
    if (!existsSync(file)) return freshWorld();
    const w = JSON.parse(readFileSync(file, "utf8")) as World;
    if (w.version !== SAVE_VERSION) {
      // Never lose a colony to a version change: keep a copy beside it first.
      const aside = `${file}.v${w.version}-${Date.now()}`;
      copyFileSync(file, aside);
      if (typeof w.version === "number" && w.version > SAVE_VERSION) {
        // A save from a newer server: don't write over it at all. Play on a fresh
        // colony in memory only, so the newer server finds it untouched.
        frozen.add(file);
        console.error(`[world] ${file} is save version ${w.version}, newer than this server's ${SAVE_VERSION}: NOT loading it or saving over it (a copy is kept as ${aside}); nothing this session will be saved`);
      } else console.log(`[world] save is version ${w.version}, older than ${SAVE_VERSION}: kept it as ${aside}, starting a fresh colony`);
      return freshWorld();
    }
    w.villagers.scholar ??= idle();
    w.villagers.manager ??= idle();
    w.villagers.dj ??= idle();
    w.villagers.mechanic ??= idle();
    w.chores ??= {};
    w.phones ??= {};
    w.choreOptIn ??= {};
    w.memory ??= {};
    w.layout ??= {};
    w.clearedRocks ??= [];
    w.shards ??= [];
    // (a save from before this was kept: anyone who's got going has seen the intro)
    w.introSeen ??= (Array.isArray(w.progress.movedIn) && w.progress.movedIn.length > 0) || (w.progress.town?.stages?.town_hall ?? 0) > 0;
    // A shard found at a spot that has since moved (the town's layout changed)
    // counts as found at the nearest spot you haven't found yet.
    const spots = shardSpots().map(shardKey);
    w.shards = w.shards.map((k) => {
      if (spots.includes(k)) return k;
      const [x, y] = k.split(",").map(Number);
      const open = spots.filter((s) => !w.shards.includes(s));
      return open.sort((a, b) => dist(a, x, y) - dist(b, x, y))[0] ?? k;
    });
    w.requests ??= { day: "", list: [] };
    w.materials = { ...noMaterials(), ...w.materials };
    w.progress.town ??= freshTown();
    // Nova used to be here from the start; in older town saves she's already home.
    if (w.buildings.observatory && !w.progress.movedIn.includes("stargazer")) w.progress.movedIn.unshift("stargazer");
    // Saves from the old quest chain: whoever had a house then has moved in. The quest counters go.
    if (!Array.isArray(w.progress.movedIn)) {
      const old = w.progress as Progress & { quest?: number; count?: number };
      w.progress.movedIn = MOVE_INS.filter((m) => w.buildings[m.home]).map((m) => m.villager);
      delete old.quest;
      delete old.count;
    }
    // Ada's Office used to be bought outright; now it's her plot, like every neighbor's.
    if (w.buildings.office && !w.progress.movedIn.includes("manager")) w.progress.movedIn.push("manager");
    // Neighbors' lots used to be fixed ruins to clear and repair; now you buy
    // their plot and set it down. Whoever's home keeps their house where it
    // stands; the rest are off the map, their plots for sale at the Town Hall.
    if (!w.progress.plots) {
      w.progress.plots = {};
      for (const m of MOVE_INS) {
        if (w.progress.movedIn.includes(m.villager)) w.progress.plots[m.home] = { placed: true, stage: 1 };
        else {
          delete w.buildings[m.home];
          delete w.layout[m.home];
        }
      }
      w.progress.revealed = w.progress.revealed.filter((b) => !moveInAt(b) || w.progress.plots[b]);
    }
    delete (w.progress as Progress & { lots?: unknown }).lots;
    // The Town Hall used to have three stages; now it goes up a level per neighbor.
    // Keep room for everyone who already has a plot (and a grand hall stays grand).
    if (!w.progress.town.v) {
      const old = w.progress.town.stages.town_hall;
      w.progress.town.stages.town_hall = Math.max([0, 2, maxStage("town_hall")][old] ?? 0, Object.keys(w.progress.plots).length);
      w.progress.town.v = 2;
    }
    if (w.buildings.office && !w.progress.plots.office) w.progress.plots.office = { placed: true, stage: 1 };
    // (a home is only on the map once its plot's been bought)
    w.progress.revealed = w.progress.revealed.filter((b) => !moveInAt(b) || w.progress.plots[b]);
    // The old brief-a-project Office kept its projects in the save; the Office
    // is a live view of your coding agents now, with nothing to save.
    delete (w as { office?: unknown }).office;
    w.decos.forEach((d, i) => (d.id ??= `deco_old${i}`));
    // Lanterns keep their spot for good (older ones stood wherever their place in the list put them).
    w.lanterns ??= [];
    w.lanterns.forEach((l, i) => Object.assign(l, lanternAt(l, i)));
    // (the event log used to be saved; nothing ever read it back)
    delete (w as { log?: unknown }).log;
    trimResolved(w.clods, (c) => c.status === "popped");
    trimResolved(w.approvals, (a) => a.status !== "pending");
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
    // Keep the unreadable file for recovery instead of overwriting it.
    const aside = `${file}.bad-${Date.now()}`;
    try {
      renameSync(file, aside);
    } catch {
      /* nothing to move */
    }
    console.error(`[world] couldn't read save (kept it as ${aside}), starting fresh:`, err);
    return freshWorld();
  }
}

// ---------------------------------------------------------------- guests
// Playing as a guest: a brand-new colony kept only in memory, and nothing is
// ever written. Online, a guest's whole copy (MOON_GUEST=1) is thrown away
// when they leave; on your own computer, the real save is put aside untouched
// and comes back when you play signed in.
let guest = process.env.MOON_GUEST === "1";
export const isGuest = () => guest;

/** Bumped every time the live world is swapped for another (guest, dev save, reset), so late work can tell its save is gone. */
let gen = 0;
export function worldGen(): number {
  return gen;
}

export const world = guest ? freshWorld() : load();
applyLayout(world.layout);
ensurePaths();

/**
 * Paths used to be laid by the game (every building to the plaza or Main Street).
 * Now they're yours: an old save keeps them, as flagstone tiles you can take up.
 */
function ensurePaths() {
  world.paths ??= {};
  if (world.pathsV) return;
  for (const k of oldPathTiles(world.buildings)) world.paths[k] ??= "stone";
  world.pathsV = 1;
}

/** Swap the live world's contents for another save's, in place (everyone holds the same `world` object). */
function replaceWorld(w: World) {
  gen++;
  for (const k of Object.keys(world)) delete (world as unknown as Record<string, unknown>)[k];
  Object.assign(world, w);
  applyLayout(world.layout);
  ensurePaths();
}

/** Into guest play (a fresh colony, in memory only) or back to the real save. */
export function setGuest(on: boolean) {
  // (already there: a reconnect asking again keeps the guest colony as it is)
  if (on === guest) return false;
  // (the real save, just as it stands, before it's put aside)
  if (!guest) flushSave();
  guest = on;
  replaceWorld(on ? freshWorld() : load(saveFile));
  console.log(on ? "[world] playing as a guest (nothing is saved)" : "[world] back on the real save");
  return true;
}

// ---------------------------------------------------------------- dev mode
// A separate showcase save with everything unlocked. Switching never touches
// the real save: it's written out first, and switching back reloads it as-is.

const DEV_FILE = join(DATA_DIR, "world-dev.json");
let saveFile = DATA_FILE;

export function isDevWorld() {
  return saveFile === DEV_FILE;
}

/** Everyone moved in, in grand houses where they usually stand. */
function everyoneHome(p: Progress) {
  p.movedIn = MOVE_INS.map((m) => m.villager);
  for (const m of MOVE_INS) p.plots[m.home] = { placed: true, stage: 2 };
}

/** Everything built and revealed, everyone moved in, sample data so they all work, coins and materials to spend. */
function showcase(w: World): World {
  for (const b of Object.keys(BUILDINGS) as BuildingId[]) w.buildings[b] = true;
  w.progress.revealed = Object.keys(BUILDINGS) as BuildingId[];
  everyoneHome(w.progress);
  w.materials = { moonstone: 99, stardust: 99, shard: 12, ore: 20, ice: 20, scrap: 20, helium: 20 };
  w.progress.town = { ...freshTown(), stages: { town_hall: maxStage("town_hall"), fountain: 2, roads: 2, market: 2 }, used: ["charter", "valve", "lens", "bell"], tasks: ["nova_search", "real_job"] };
  w.progress.sandbox = { ...w.progress.sandbox, google: true, canvas: true };
  w.coins = Math.max(w.coins, 5000);
  for (const a of Object.values(w.approvals)) if (a.status === "pending") a.status = "denied";
  return w;
}

/** Swap between the real save and the dev showcase save. Returns false if already there. */
export function switchWorld(dev: boolean): boolean {
  if (dev === isDevWorld() || guest) return false;
  flushSave();
  const next = dev ? DEV_FILE : DATA_FILE;
  const w = dev && !existsSync(DEV_FILE) ? showcase(JSON.parse(JSON.stringify(world)) as World) : load(next);
  saveFile = next;
  replaceWorld(w);
  flushSave();
  console.log(`[world] now on the ${dev ? "dev showcase" : "real"} save`);
  return true;
}

/** Start this save over from scratch (for testing). The old one is kept beside it, just in case. */
export function resetWorld(): string {
  if (guest) {
    // (a guest's colony was never saved: just start it fresh)
    replaceWorld(freshWorld());
    return "";
  }
  flushSave();
  const backup = `${saveFile}.before-reset-${Date.now()}`;
  if (existsSync(saveFile)) copyFileSync(saveFile, backup);
  replaceWorld(freshWorld());
  flushSave();
  console.log(`[world] reset to a fresh colony (the old save is kept as ${backup})`);
  return backup;
}

/** Write to a temp file and rename, so a crash mid-write can't leave half a save. */
function writeSave() {
  // (a guest's colony is never written anywhere)
  // (nor is a newer server's save we couldn't load)
  if (guest || frozen.has(saveFile)) return;
  mkdirSync(dirname(saveFile), { recursive: true });
  const tmp = `${saveFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(world));
  renameSync(tmp, saveFile);
}

function flushSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  writeSave();
}

let saveTimer: NodeJS.Timeout | null = null;
/** Saves are batched: at most one write a second (stopping writes the last one right away). */
const SAVE_EVERY_MS = 1000;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeSave();
    } catch (err) {
      console.error("[world] save failed:", err);
    }
  }, SAVE_EVERY_MS);
}

// Stopping (the gateway stops a copy with SIGTERM; Ctrl-C locally): write the pending save first.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    try {
      if (saveTimer) flushSave();
    } catch (err) {
      console.error("[world] final save failed:", err);
    }
    process.exit(0);
  });
}

type Listener = (e: SeqEvent) => void;
const listeners = new Set<Listener>();

export function onEvent(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(e: GameEvent) {
  const evt = { ...e, seq: ++world.seq, at: Date.now() } as SeqEvent;
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
    materials: world.materials,
    // filled in by services.ts, which knows about connected accounts
    connections: { google: { connected: false, configured: false }, spotify: { connected: false, configured: false }, github: { connected: false }, canvas: { connected: false }, photon: { connected: false, phoneLinked: false, phones: [] }, web: { connected: false } },
    residents: [],
    rabbitTeamwork: false,
    chores: Object.values(world.chores),
    choreOptIn: world.choreOptIn,
    friendship: Object.fromEntries(Object.entries(world.memory).map(([v, m]) => [v, m!.points])),
    layout: world.layout,
    devMode: isDevWorld(),
    introSeen: !!world.introSeen,
    guest,
    paths: world.paths,
    serverNow: Date.now(),
    clearedRocks: world.clearedRocks,
    shards: world.shards,
    requests: world.requests.list,
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
  trimResolved(world.approvals, (a) => a.status !== "pending");
  persist();
}

/**
 * Plant a task lantern on the first free slot of the rings around the plaza
 * (on the island, clear of homes, decorations, rocks and other lanterns), and
 * keep it there. Past MAX_LANTERNS the oldest one is retired.
 */
export function addLantern(l: Lantern) {
  if (world.lanterns.length >= MAX_LANTERNS) world.lanterns.splice(0, world.lanterns.length - MAX_LANTERNS + 1);
  const taken = occupied();
  let at: { x: number; y: number } | undefined;
  for (let i = 0; i < 16 * 10 && !at; i++) {
    const p = lanternSpot(i);
    if (canOccupy(tileAt(p), taken)) at = p;
  }
  // (nowhere free: squeeze onto the inner ring, which is always on the island)
  Object.assign(l, at ?? lanternSpot(world.lanterns.length % 16));
  world.lanterns.push(l);
  persist();
}

export function popClod(clodId: string): { ok: true; reward: number } | { ok: false; reason: string } {
  const c = typeof clodId === "string" && Object.hasOwn(world.clods, clodId) ? world.clods[clodId] : undefined;
  if (!c) return { ok: false, reason: "no such star" };
  if (c.status !== "ready" && c.status !== "failed") return { ok: false, reason: `that star is ${c.status}` };
  const reward = c.status === "ready" ? c.reward : 1;
  c.status = "popped";
  world.coins += reward;
  trimResolved(world.clods, (c) => c.status === "popped");
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
    if (onMap(b, world.progress, world.buildings)) out.push(...buildingRects(b));
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
  for (const r of rockSpots(decoRects(), world.clearedRocks)) out.push(rockRect(r));
  const found = new Set(world.shards);
  for (const p of shardSpots()) if (!found.has(shardKey(p))) out.push(footprint(p.x, p.y, 1, 1));
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

/** Clear a rock away for good: it breaks into moonstone (and sometimes a find). */
export function clearRock(x: number, y: number): { ok: true; stone: number; loot?: { coins: number; what: string } } | { ok: false; reason: string } {
  const rock = rockSpots(decoRects(), world.clearedRocks).find((r) => r.x === x && r.y === y);
  if (!rock) return { ok: false, reason: "There's no rock there." };
  world.clearedRocks.push(rockKey(rock));
  const stone = ROCK_STONE[rock.kind];
  world.materials.moonstone += stone;
  const l = LOOT[rock.kind];
  let loot: { coins: number; what: string } | undefined;
  if (Math.random() < l.chance) {
    loot = { coins: Math.round(l.min + Math.random() * (l.max - l.min)), what: l.what };
    world.coins += loot.coins;
  }
  persist();
  return { ok: true, stone, ...(loot ? { loot } : {}) };
}

/** How long a cleared rock takes to grow back (one at a time, the longest-gone first where there's room). */
const REGROW_MS = Number(process.env.ROCK_REGROW_MS) || 4 * 60_000;

/** Grow back the cleared rocks that are due (a few at most, to catch up after a break); returns where. */
export function regrowRocks(): { x: number; y: number }[] {
  const now = Date.now();
  world.rocksGrewAt ??= now;
  const due = Math.floor((now - world.rocksGrewAt) / REGROW_MS);
  if (due <= 0) return [];
  world.rocksGrewAt = due > 3 ? now : world.rocksGrewAt + due * REGROW_MS;
  const grown: { x: number; y: number }[] = [];
  for (const key of [...world.clearedRocks]) {
    if (grown.length >= Math.min(due, 3)) break;
    // (only where it still fits: not under a decoration, a building or a lantern placed since)
    const rest = world.clearedRocks.filter((k) => k !== key);
    const rock = rockSpots(decoRects(), rest).find((r) => rockKey(r) === key);
    if (!rock || !canOccupy(rockRect(rock), occupied())) continue;
    world.clearedRocks = rest;
    grown.push({ x: rock.x, y: rock.y });
  }
  if (grown.length) persist();
  return grown;
}

/** Pick up a Moon Shard (each spot once); finding them all pays a bonus. */
/** Shards found, counting only ones that are still on the map (old saves may hold stale keys). */
export function shardsFound() {
  const found = new Set(world.shards);
  return shardSpots().filter((p) => found.has(shardKey(p))).length;
}

export function collectShard(x: number, y: number): { ok: true; reward: number; bonus?: number } | { ok: false } {
  const spot = shardSpots().find((p) => p.x === x && p.y === y);
  if (!spot || world.shards.includes(shardKey(spot))) return { ok: false };
  world.shards.push(shardKey(spot));
  world.coins += SHARD_REWARD;
  // Found for good (the beacon counts them), and one to spend on repairs.
  world.materials.shard += 1;
  const bonus = shardsFound() === SHARD_COUNT ? SHARD_BONUS : undefined;
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

/** Buildings (and revealed plots) can be moved anywhere their tiles fit. */
export function moveBuilding(b: BuildingId, x: number, y: number): boolean {
  // The Mail Rocket is built onto the Post Office: it moves when the Post Office does.
  if (b === "rocket_pad" || b === "workshop") return false;
  if (!SPOTS[b] || !onMap(b, world.progress, world.buildings)) return false;
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
