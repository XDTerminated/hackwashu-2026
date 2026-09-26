// Colony requests: three small goals a day from the villagers, paid in coins.
// They're picked fresh each (local) day and progress by watching what happens
// on the island (a swept drift, a caught meteor, a cleared rock...), so
// nothing else has to know about them.

import { VILLAGER_NAMES, type ColonyRequest, type GameEvent, type RequestKind, type VillagerId } from "../../shared/game.js";
import { SHARD_COUNT, rockSpots } from "../../shared/layout.js";
import { DECOR, happinessFor } from "../../shared/decor.js";
import { isResident, rubbleLeft } from "./services.js";
import { decoRects, emit, onEvent, savePersist, world } from "./world.js";

interface Template {
  kind: RequestKind;
  villager: VillagerId;
  text: string;
  goal: number;
  reward: number;
}

const POOL: Template[] = [
  { kind: "sweep", villager: "jade_rabbit", text: "Sweep 3 moondust drifts so the lamps shine", goal: 3, reward: 30 },
  { kind: "meteor", villager: "stargazer", text: "Catch a moon-rock that falls from the sky", goal: 1, reward: 40 },
  { kind: "rock", villager: "timekeeper", text: "Clear a rock or a heap of rubble", goal: 1, reward: 30 },
  { kind: "decorate", villager: "scholar", text: "Brighten someone's yard with a decoration", goal: 1, reward: 35 },
  { kind: "shard", villager: "stargazer", text: "Find a Moon Shard hidden on the island", goal: 1, reward: 30 },
  { kind: "text", villager: "postmaster", text: "Text a neighbor on the MoonPad", goal: 1, reward: 15 },
  { kind: "visit", villager: "jade_rabbit", text: "Ask a neighbor for help in person", goal: 1, reward: 20 },
  { kind: "pop", villager: "jade_rabbit", text: "Pop 2 glowing stars", goal: 2, reward: 25 },
  { kind: "place", villager: "jade_rabbit", text: "Place 3 new decorations around the colony", goal: 3, reward: 30 },
];

/** Bump when the kinds of requests change, so today's list is re-picked. */
const REQUESTS_VERSION = 3;

/**
 * Today's wish: a neighbor who lives here asks for a decoration they love
 * that isn't in their yard yet. Placing it there makes them happier too.
 */
function wish(seed: number): ColonyRequest | null {
  const who = (["jade_rabbit", "stargazer", "postmaster", "timekeeper", "scholar"] as VillagerId[]).filter(isResident);
  if (!who.length) return null;
  const v = who[Math.floor(seeded(seed + 91) * who.length)];
  const have = new Set(happinessFor(v, world.decos).items.map((i) => i.name));
  const options = DECOR.filter((d) => d.likes.includes(v) && d.price <= 100 && !have.has(d.name));
  if (!options.length) return null;
  const d = options[Math.floor(seeded(seed + 97) * options.length)];
  return {
    id: "",
    kind: "wish",
    villager: v,
    text: `${VILLAGER_NAMES[v]}: I'd love a ${d.name} by my home!`,
    goal: 1,
    count: 0,
    reward: 20 + Math.round(d.price / 2),
    done: false,
    item: d.id,
  };
}

const today = () => new Date().toDateString();

function seeded(n: number) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Today's three, picked by the date so they're stable all day. */
function pick(day: string): ColonyRequest[] {
  const seed = [...day].reduce((h, c) => h * 31 + c.charCodeAt(0), 7);
  // Only ask for what's still out there: shards left to find, rocks or rubble left to clear.
  const rocksLeft = rockSpots(decoRects(), world.clearedRocks).length + rubbleLeft();
  const pool = POOL.filter((t) => (t.kind !== "shard" || world.shards.length < SHARD_COUNT) && (t.kind !== "rock" || rocksLeft > 0));
  const order = pool.map((t, i) => ({ t, r: seeded(seed + i * 17) })).sort((a, b) => a.r - b.r);
  const w = wish(seed);
  const picked = order.slice(0, w ? 2 : 3).map(({ t }, i) => {
    // Neighbors who haven't moved in yet can't ask; your guide asks instead.
    const villager = isResident(t.villager) ? t.villager : "jade_rabbit";
    return {
      id: `${day.replace(/\s/g, "")}-${i}`,
      kind: t.kind,
      villager,
      text: `${VILLAGER_NAMES[villager]}: ${t.text}`,
    goal: t.goal,
      count: 0,
      reward: t.reward,
      done: false,
    };
  });
  const list = w ? [w, ...picked] : picked;
  return list.map((r, i) => ({ ...r, id: `${day.replace(/\s/g, "")}-${i}` }));
}

/** The requests for right now (a new day brings new ones). */
export function currentRequests(): ColonyRequest[] {
  const day = today();
  if (world.requests.day !== day || (world.requests.v ?? 1) < REQUESTS_VERSION) {
    world.requests = { day, list: pick(day), v: REQUESTS_VERSION };
    savePersist();
  }
  return world.requests.list;
}

function progress(kind: RequestKind, amount = 1) {
  const list = currentRequests();
  let changed = false;
  let completed: ColonyRequest | undefined;
  for (const r of list) {
    if (r.done || r.kind !== kind) continue;
    r.count = Math.min(r.goal, r.count + amount);
    changed = true;
    if (r.count >= r.goal) {
      r.done = true;
      world.coins += r.reward;
      completed = r;
    }
  }
  if (!changed) return;
  savePersist();
  emit({ type: "requests", requests: list, ...(completed ? { completed } : {}), coins: world.coins });
}

/** A wished-for decoration just landed in that villager's yard. */
function grantWish(v: VillagerId, itemName: string) {
  const list = currentRequests();
  const r = list.find((x) => !x.done && x.kind === "wish" && x.villager === v && DECOR.find((d) => d.id === x.item)?.name === itemName);
  if (!r) return;
  r.count = r.goal;
  r.done = true;
  world.coins += r.reward;
  savePersist();
  emit({ type: "requests", requests: list, completed: r, coins: world.coins });
}

function watch(e: GameEvent) {
  if (e.type === "chore_cleared") progress(e.kind === "dust" ? "sweep" : "meteor");
  else if (e.type === "rock_cleared" || e.type === "rubble_cleared") progress("rock");
  else if (e.type === "clod_popped") progress("pop");
  else if (e.type === "shard_found") progress("shard");
  else if (e.type === "happiness" && e.gained) {
    progress("decorate");
    grantWish(e.villager, e.gained.item);
  } else if (e.type === "deco_placed") progress("place");
  else if (e.type === "text" && e.direction === "in") progress("text");
  else if (e.type === "task_start" && e.from === "game") progress("visit");
}

export function startRequests() {
  currentRequests();
  onEvent(watch);
}
