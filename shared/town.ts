// The town: four landmarks the colony rebuilds, Stardew-style, with Yutu as
// mayor. Each goes ruined -> repaired -> grand, paid for in materials (and, for
// the grand stages, a story item, and once or twice a real job for a neighbor).
// The Town Hall sets how many new neighbors can move in; the Fountain brings
// daily wishes and then faster friendships; fixing the Roads opens the north
// and then the south of the crater; the Market stocks more decorations.
// Shared so the server enforces exactly what the game shows.

import { PLAZA, PLAZA_R, STREET, WORLD_W, inIsland, nearBuilding } from "./layout.js";
import type { DecorDef } from "./decor.js";
import type { Materials, VillagerId } from "./game.js";

export type LandmarkId = "town_hall" | "fountain" | "roads" | "market";
export const LANDMARK_IDS: LandmarkId[] = ["town_hall", "fountain", "roads", "market"];
/** 0 ruined, 1 repaired, 2 grand. */
export type Stage = 0 | 1 | 2;
export const STAGE_NAME = ["ruined", "repaired", "grand"] as const;

export type TownItem = "charter" | "valve" | "lens" | "bell";
export type TownTask = "nova_search" | "real_job";

export interface UpgradeDef {
  needs: Partial<Materials>;
  item?: TownItem;
  task?: TownTask;
}

export interface LandmarkDef {
  name: string;
  /** What each stage gives you. */
  perks: [string, string, string];
  /** What it takes to reach stage 1, then stage 2. */
  up: [UpgradeDef, UpgradeDef];
}

export const LANDMARKS: Record<LandmarkId, LandmarkDef> = {
  town_hall: {
    name: "Town Hall",
    perks: ["Room for 1 new neighbor", "Room for 2 new neighbors", "Room for every neighbor"],
    up: [{ needs: { moonstone: 4, stardust: 3, ore: 1 } }, { needs: { moonstone: 4, ice: 2, scrap: 2 }, item: "charter", task: "real_job" }],
  },
  fountain: {
    name: "Fountain",
    perks: ["Dry and cracked", "Water flows again: neighbors make daily wishes", "The star turns: friendships grow faster"],
    up: [{ needs: { moonstone: 3, stardust: 2 } }, { needs: { shard: 2, ice: 2, helium: 1 }, item: "valve", task: "nova_search" }],
  },
  roads: {
    name: "Roads & Lamps",
    perks: ["Broken roads; rockfalls seal off the north and south", "Roads fixed: the north of the crater opens up", "Grand roads: the south opens up too"],
    up: [{ needs: { moonstone: 3, stardust: 2 } }, { needs: { ice: 2, ore: 1 }, item: "lens" }],
  },
  market: {
    name: "Market",
    perks: ["A collapsed cart: no shop yet", "A proper stall: the Shop opens (Garden and Cozy decorations)", "A real shop: everything, Sci-Fi and Party too"],
    // (the stall is the tutorial's first build: just what a boulder and a sweep turn up)
    up: [{ needs: { moonstone: 2, stardust: 2 } }, { needs: { scrap: 2, helium: 2 }, item: "bell" }],
  },
};

export const ITEMS: Record<TownItem, { name: string; line: string; from: string }> = {
  charter: { name: "Old Colony Charter", line: "Article 1: no bouncing indoors.", from: "dig it up at the Town Hall once it's repaired" },
  valve: { name: "Fountain Valve", line: "Still a little damp. Somehow.", from: "a gift from Yutu when your first new neighbor moves in" },
  lens: { name: "Lamp Lens", line: "Makes everything look 12% more romantic.", from: "out in the north, once the roads are fixed" },
  bell: { name: "Shop Bell", line: "Ding! (It only knows the one word.)", from: "a housewarming gift from your second new neighbor" },
};

export const TASKS: Record<TownTask, string> = {
  nova_search: "Ask Nova to look something up",
  real_job: "Have Hoot, Cog, Mabel or Yutu do a real job for you",
};

export interface Town {
  stages: Record<LandmarkId, Stage>;
  /** Story items you're holding (spent on the grand stages). */
  items: TownItem[];
  used: TownItem[];
  tasks: TownTask[];
  /** Dig spots already found. */
  dug: string[];
  /** Harvest spots picked today (they grow back overnight). */
  harvested: string[];
  day: string;
}

export const freshTown = (): Town => ({ stages: { town_hall: 0, fountain: 0, roads: 0, market: 0 }, items: [], used: [], tasks: [], dug: [], harvested: [], day: "" });

/** How many new neighbors' plots the Town Hall has room for (Nova, the tutorial, doesn't count). */
export const neighborCap = (t: Town) => [1, 2, 5][t.stages.town_hall];
/** New neighbors home so far (not counting Nova). */
export const newNeighborCount = (movedIn: VillagerId[]) => movedIn.filter((v) => v !== "stargazer").length;
export const hasItem = (t: Town, i: TownItem) => t.items.includes(i) || t.used.includes(i);

/** Why a landmark can't go up a stage right now (or null if it can). */
export function upgradeBlocker(t: Town, id: LandmarkId, materials: Materials): string | null {
  const stage = t.stages[id];
  if (stage >= 2) return `The ${LANDMARKS[id].name} is as grand as it gets.`;
  const up = LANDMARKS[id].up[stage as 0 | 1];
  const short = (Object.keys(up.needs) as (keyof Materials)[]).filter((m) => (up.needs[m] ?? 0) > materials[m]);
  const parts: string[] = [];
  if (short.length) parts.push(short.map((m) => `${(up.needs[m] ?? 0) - materials[m]} more ${m === "ore" ? "glow ore" : m === "helium" ? "helium-3" : m === "shard" ? "moon shard" : m === "ice" ? "ice crystal" : m}`).join(", "));
  if (up.item && !t.items.includes(up.item)) parts.push(`the ${ITEMS[up.item].name} (${ITEMS[up.item].from})`);
  if (up.task && !t.tasks.includes(up.task)) parts.push(TASKS[up.task][0].toLowerCase() + TASKS[up.task].slice(1));
  return parts.length ? `Still needed: ${parts.join("; ")}.` : null;
}

// ---------------------------------------------------------------- the Market's stock

/** Is the Shop open at all? (Not until the Market is repaired.) */
export const shopOpen = (t: Town) => t.stages.market >= 1;

/** Can the Market sell this decoration yet? */
export function inStock(stage: Stage, d: Pick<DecorDef, "id" | "cat">): boolean {
  if (stage >= 2) return true;
  if (stage === 1) return d.cat === "garden" || d.cat === "cozy";
  return false;
}

// ---------------------------------------------------------------- the crater's north and south

/** Above this line is the north of the crater; below SOUTH_Y the south. Rockfalls seal both until the roads are fixed. */
export const NORTH_Y = 250;
export const SOUTH_Y = 1040;

export type Area = "north" | "main" | "south";
export const areaAt = (_x: number, y: number): Area => (y < NORTH_Y ? "north" : y > SOUTH_Y ? "south" : "main");
export const areaOpen = (t: Town, a: Area) => a === "main" || (a === "north" ? t.stages.roads >= 1 : t.stages.roads >= 2);
/** Is this part of the crater open (for gathering, spawning, pathing)? */
export const openAt = (t: Town, x: number, y: number) => areaOpen(t, areaAt(x, y));

/**
 * Can your feet go here? Like openAt, but a closed rockfall is a solid wall
 * the full depth of its boulders: you stop in front of it (south of the
 * north one, north of the south one) instead of stepping into the rocks.
 */
export function walkableAt(t: Town, x: number, y: number) {
  if (!areaOpen(t, "north") && y < NORTH_Y + 20) return false;
  if (!areaOpen(t, "south") && y > SOUTH_Y - 10) return false;
  return true;
}

// ---------------------------------------------------------------- things to find

export type NodeKind = "ice" | "scrap" | "helium" | "ore";

export interface HarvestNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
}

/** Spread `n` spots along a band of the crater floor (inside the island, a little in from the edge). */
function band(prefix: string, kind: NodeKind, n: number, y0: number, y1: number, seed: number): HarvestNode[] {
  const out: HarvestNode[] = [];
  let tries = 0;
  for (let i = 0; out.length < n && tries < 400; tries++) {
    const r = (k: number) => {
      const s = Math.sin((tries + 1) * 91.7 + seed * 13.3 + k * 7.1) * 43758.5453;
      return s - Math.floor(s);
    };
    const x = Math.round(160 + r(1) * (WORLD_W - 320));
    const y = Math.round(y0 + r(2) * (y1 - y0));
    const ok = [[0, 0], [-20, 0], [20, 0], [0, -30], [0, 16]].every(([dx, dy]) => inIsland((x + dx) / 16, (y + dy) / 16));
    // (clear of the buildings, the fountain square and Main Street)
    const inTown = nearBuilding(x, y, 24) || Math.hypot(x - PLAZA.x, y - PLAZA.y) < PLAZA_R + 30 || Math.abs(y - STREET.y) < 34;
    if (!ok || inTown || out.some((o) => Math.hypot(o.x - x, o.y - y) < 70)) continue;
    out.push({ id: `${prefix}${i++}`, kind, x, y });
  }
  return out;
}

export const NODES: HarvestNode[] = [
  // ice crystals in the shadowed north
  ...band("ice", "ice", 7, 130, NORTH_Y - 30, 1),
  // wreck scrap and shimmering helium-3 dust in the south
  ...band("scrap", "scrap", 5, SOUTH_Y + 30, 1130, 2),
  ...band("he", "helium", 4, SOUTH_Y + 25, 1120, 3),
  // glowing ore in a few old impact craters near town (meteors bring more)
  ...band("ore", "ore", 3, 420, 900, 4).filter((n) => Math.abs(n.x - WORLD_W / 2) > 330),
];

export const NODE_MATERIAL: Record<NodeKind, keyof Materials> = { ice: "ice", scrap: "scrap", helium: "helium", ore: "ore" };

/** Story items waiting to be dug up: where, and when it shows up. */
export interface DigSpot {
  id: string;
  item: TownItem;
  x: number;
  y: number;
  when: (t: Town) => boolean;
  /** Who tells you about it. */
  hint: string;
}

export function digSpots(townHall: { x: number; y: number }): DigSpot[] {
  return [
    { id: "dig_charter", item: "charter", x: townHall.x + 84, y: townHall.y - 6, when: (t) => t.stages.town_hall >= 1, hint: "Something's glinting in the rubble by the Town Hall. Dig it up (E)!" },
    { id: "dig_lens", item: "lens", x: WORLD_W / 2 + 180, y: 190, when: (t) => t.stages.roads >= 1, hint: "With the north open, something shiny is sparkling up there. Go look!" },
  ];
}

/** Who gives what, when neighbors move in (the Nth new neighbor, counting from 1). */
export const ARRIVAL_GIFTS: { nth: number; item: TownItem; by: VillagerId | "newcomer"; text: string }[] = [
  { nth: 1, item: "valve", by: "jade_rabbit", text: "A new neighbor! Here, I found this Fountain Valve in my burrow. It might get the fountain going properly." },
  { nth: 2, item: "bell", by: "newcomer", text: "A little housewarming gift for the town: the old Shop Bell. The Market could use it." },
];
