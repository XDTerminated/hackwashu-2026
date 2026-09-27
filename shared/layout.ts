// Island geometry, shared so the server can place meteors and dust on solid ground.
import type { BuildingId } from "./game.js";

export const TILE = 16;
export const MAP_W = 100;
export const MAP_H = 76;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export const ISLAND_CX = MAP_W / 2;
export const ISLAND_CY = MAP_H / 2;

/** Is this (fractional) tile coordinate on the island? */
export function inIsland(tx: number, ty: number): boolean {
  const dx = (tx - ISLAND_CX) / 46;
  const dy = (ty - ISLAND_CY) / 34;
  const r = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  return r <= 0.97 + 0.06 * Math.sin(ang * 3 + 1.7) + 0.04 * Math.sin(ang * 7 + 0.5);
}

export function inIslandXY(x: number, y: number): boolean {
  return inIsland(x / TILE, y / TILE);
}

export interface BuildingSpot {
  /** Bottom-center of the sprite, in world px. */
  x: number;
  y: number;
  texture: string;
  /** Solid footprint half-width / height (from the base up). */
  fw: number;
  fh: number;
  /** Where villagers stand to use it, relative to (x, y). */
  door: { dx: number; dy: number };
  /** How tall the building's sprite stands (for keeping things from spawning behind it). */
  tall: number;
}

const CX = WORLD_W / 2;
const CY = WORLD_H / 2;

// ---------------------------------------------------------------- tiles
// Everything on the map sits on the 16px tile grid and takes up a footprint of
// whole tiles; nothing may share a tile. Positions are bottom-center points: a
// thing an even number of tiles wide is centered on a tile line, an odd one on
// a tile's middle, and its base always sits on a tile line.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Snap a bottom-center point so something `wTiles` wide lines up with the grid. */
export function snapToTiles(x: number, y: number, wTiles: number): { x: number; y: number } {
  return {
    x: wTiles % 2 === 0 ? Math.round(x / TILE) * TILE : (Math.floor(x / TILE) + 0.5) * TILE,
    y: Math.round(y / TILE) * TILE,
  };
}

/** A footprint: `h` tile rows standing on the base line at (x, y), plus `apron` rows in front. */
export function footprint(x: number, y: number, w: number, h: number, apron = 0): Rect {
  return { x: x - (w * TILE) / 2, y: y - h * TILE, w: w * TILE, h: (h + apron) * TILE };
}

/** The single tile something small (a lamp, a doorbell, a lantern) stands on. */
export function tileAt(p: { x: number; y: number }): Rect {
  return footprint(p.x, p.y, 1, 1);
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Where every path starts: the central plaza (its center sits on a tile corner). */
export const PLAZA = { x: Math.round(CX / TILE) * TILE, y: Math.round((CY + 70) / TILE) * TILE };

/** The plaza's radius (its paving; the grand fountain stands in the middle). */
export const PLAZA_R = 120;

/** Every building starts on one circle around the plaza, evenly spaced, clockwise from north: the Town Hall faces the fountain. */
export const RING_RADIUS = 300;
const RING: BuildingId[] = ["town_hall", "library", "market", "clock_tower", "observatory", "post_office", "player_house", "rabbit_burrow"];

function onRing(b: BuildingId) {
  const a = -Math.PI / 2 + (RING.indexOf(b) / RING.length) * Math.PI * 2;
  return { x: Math.round(PLAZA.x + Math.cos(a) * RING_RADIUS), y: Math.round(PLAZA.y + Math.sin(a) * RING_RADIUS) };
}

const spot = (b: BuildingId, texture: string, fw: number, fh: number, tall: number, door: { dx: number; dy: number }): BuildingSpot => ({ ...onRing(b), texture, fw, fh, tall, door });

export const SPOTS: Record<BuildingId, BuildingSpot> = {
  player_house: spot("player_house", "b_player_house", 52, 40, 108, { dx: 0, dy: 14 }),
  // The town's landmarks (their look changes with each stage: see town.ts).
  town_hall: spot("town_hall", "b_town_hall", 60, 40, 132, { dx: 0, dy: 14 }),
  market: spot("market", "b_market", 36, 24, 76, { dx: 0, dy: 12 }),
  library: spot("library", "b_library", 60, 40, 120, { dx: 0, dy: 14 }),
  // Hoot's Mail Rocket: an annex built onto the Post Office (placed beside it, below).
  rocket_pad: { x: 0, y: 0, texture: "b_rocket_pad", fw: 24, fh: 24, tall: 112, door: { dx: 0, dy: 14 } },
  clock_tower: spot("clock_tower", "b_clock_tower", 28, 28, 180, { dx: 0, dy: 14 }),
  observatory: spot("observatory", "b_observatory", 52, 40, 124, { dx: 0, dy: 14 }),
  post_office: spot("post_office", "b_post_office", 52, 40, 116, { dx: 0, dy: 14 }),
  rabbit_burrow: spot("rabbit_burrow", "b_rabbit_burrow", 48, 28, 96, { dx: 0, dy: 12 }),
  mailbox: { x: 0, y: 0, texture: "b_mailbox", fw: 5, fh: 4, tall: 24, door: { dx: 12, dy: 10 } },
  // Off the ring, out to the northeast: the developers' building.
  office: { x: 1328, y: 432, texture: "b_office", fw: 60, fh: 40, tall: 156, door: { dx: 0, dy: 14 } },
};

export function buildingTiles(b: BuildingId): { w: number; h: number } {
  const s = SPOTS[b];
  return { w: Math.max(1, Math.ceil((s.fw * 2) / TILE)), h: Math.max(1, Math.ceil(s.fh / TILE)) };
}

/**
 * Annexes aren't buildings of their own on the map: the mailbox stands just
 * outside the Post Office's doorway lamp, and the Mail Rocket (Hoot's upgrade)
 * is built onto the Post Office's other side. The Mail Rocket moves with it.
 */
export const isAnnex = (b: BuildingId) => b === "mailbox" || b === "rocket_pad";

/** Where the Mail Rocket stands, for the Post Office at `po`. */
export function mailRocketAt(po: Pt): Pt {
  return { x: po.x + ((buildingTiles("post_office").w + buildingTiles("rocket_pad").w) / 2) * TILE, y: po.y };
}

// Snap the starting spots to the grid.
for (const b of Object.keys(SPOTS) as BuildingId[]) Object.assign(SPOTS[b], snapToTiles(SPOTS[b].x, SPOTS[b].y, buildingTiles(b).w));
Object.assign(SPOTS.mailbox, { x: SPOTS.post_office.x - (buildingTiles("post_office").w / 2 + 1.5) * TILE, y: SPOTS.post_office.y });
Object.assign(SPOTS.rocket_pad, mailRocketAt(SPOTS.post_office));

/** The ship you arrived in: parked just outside the ring, between your house and the Rabbit's. */
export const LANDING = (() => {
  const a = -Math.PI / 2 - Math.PI / RING.length;
  return snapToTiles(PLAZA.x + Math.cos(a) * (RING_RADIUS + 130), PLAZA.y + Math.sin(a) * (RING_RADIUS + 130), 2);
})();

/** Lanterns from finished tasks are planted on a ring of tiles around the plaza. */
export function lanternSpot(i: number): { x: number; y: number } {
  const ring = Math.floor(i / 16);
  const k = i % 16;
  const a = (k / 16) * Math.PI * 2 + ring * 0.2;
  const rx = 205 + ring * 26;
  const ry = 184 + ring * 20;
  return snapToTiles(PLAZA.x + Math.cos(a) * rx, PLAZA.y + Math.sin(a) * ry, 1);
}

/** Where a task lantern stands: where the player put it, or its slot on the ring. */
export function lanternAt(l: { x?: number; y?: number }, i: number): { x: number; y: number } {
  return l.x !== undefined && l.y !== undefined ? { x: l.x, y: l.y } : lanternSpot(i);
}

/** Solar lamps: around the plaza, and beside each built doorway. */
export function lampSpots(built: (b: BuildingId) => boolean = () => true): { x: number; y: number; building?: BuildingId }[] {
  const out: { x: number; y: number; building?: BuildingId }[] = plazaRing().lamps.map((p) => ({ ...p }));
  for (const b of Object.keys(SPOTS) as BuildingId[]) {
    if (isAnnex(b) || !built(b)) continue;
    out.push({ ...besideDoor(b, -1), building: b });
  }
  return out;
}

/** True if (x, y) is inside any building's solid footprint (with a margin). */
export function nearBuilding(x: number, y: number, margin = 0): boolean {
  return Object.values(SPOTS).some((s) => x > s.x - s.fw - margin && x < s.x + s.fw + margin && y > s.y - s.tall - margin && y < s.y + margin + 16);
}

type Pt = { x: number; y: number };

/**
 * A building's path, from the plaza's rim to its door. Doors face south, so
 * for buildings below the plaza it doglegs around the side instead of running
 * under the house.
 */
export function pathPoints(b: BuildingId, at: Pt = SPOTS[b]): Pt[] {
  const s = { ...SPOTS[b], ...at };
  const door = { x: s.x + s.door.dx, y: s.y + s.door.dy };
  const behind = s.y - s.fh > PLAZA.y;
  const via = behind ? { x: s.x + (PLAZA.x < s.x ? -1 : 1) * (s.fw + 14), y: door.y } : null;
  const first = via ?? door;
  const len = Math.hypot(first.x - PLAZA.x, first.y - PLAZA.y) || 1;
  const start = { x: PLAZA.x + ((first.x - PLAZA.x) / len) * (PLAZA_R + 2), y: PLAZA.y + ((first.y - PLAZA.y) / len) * (PLAZA_R + 2) };
  return via ? [start, via, door] : [start, door];
}

function distToPath(b: BuildingId, x: number, y: number, at: Pt): number {
  const pts = pathPoints(b, at);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    const l2 = (c.x - a.x) ** 2 + (c.y - a.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * (c.x - a.x) + (y - a.y) * (c.y - a.y)) / l2));
    best = Math.min(best, Math.hypot(x - (a.x + t * (c.x - a.x)), y - (a.y + t * (c.y - a.y))));
  }
  return best;
}

/**
 * The tile just outside a building's footprint, left (-1) or right (+1), in
 * the row in front of its door: its doorway lamp and doorbell go here. Steps a
 * row forward if its path runs through that tile.
 */
export function besideDoor(b: BuildingId, side: -1 | 1, at: Pt = SPOTS[b]): Pt {
  const s = { ...SPOTS[b], ...at };
  const p = { x: s.x + side * ((buildingTiles(b).w * TILE) / 2 + TILE / 2), y: s.y + TILE };
  for (let i = 0; i < 3 && distToPath(b, p.x, p.y - TILE / 2, at) < 12; i++) p.y += TILE;
  return p;
}

/**
 * The plaza's rim furniture, placed in the gaps between the paths that leave
 * the plaza (so nothing ever blocks a path): a grand lamppost on the rim, and
 * a marble obelisk standing just outside it. The paving itself stays open.
 * Recomputed as buildings move.
 */
export function plazaRing(): { lamps: Pt[]; obelisks: Pt[] } {
  const angles = (Object.keys(SPOTS) as BuildingId[])
    .filter((b) => !isAnnex(b))
    .map((b) => {
      const p = pathPoints(b)[0];
      return Math.atan2(p.y - PLAZA.y, p.x - PLAZA.x);
    });
  angles.push(Math.atan2(LANDING.y - PLAZA.y, LANDING.x - PLAZA.x));
  angles.sort((a, b) => a - b);
  const lamps: Pt[] = [];
  const obelisks: Pt[] = [];
  const at = (a: number, r: number) => snapToTiles(PLAZA.x + Math.cos(a) * r, PLAZA.y + Math.sin(a) * r + 8, 1);
  angles.forEach((a, i) => {
    const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
    const gap = next - a;
    const mid = a + gap / 2;
    lamps.push(at(mid, PLAZA_R - 6));
    if (gap > 0.5) obelisks.push(at(mid, PLAZA_R + 18));
  });
  return { lamps, obelisks };
}

/** Where the player has moved buildings to (unlisted ones stay on the ring). */
export type Layout = Partial<Record<BuildingId, { x: number; y: number }>>;

const DEFAULT_POS = Object.fromEntries(Object.entries(SPOTS).map(([b, s]) => [b, { x: s.x, y: s.y }])) as Record<BuildingId, { x: number; y: number }>;

/** Move buildings to where the save says they are. SPOTS is read live everywhere. */
export function applyLayout(layout: Layout) {
  for (const b of Object.keys(SPOTS) as BuildingId[]) Object.assign(SPOTS[b], layout[b] ?? DEFAULT_POS[b]);
  // The Mail Rocket is part of the Post Office: it goes wherever the Post Office goes.
  Object.assign(SPOTS.rocket_pad, mailRocketAt(SPOTS.post_office));
}

/** The building's own tiles plus the row in front of its door (kept clear for the door). */
export function buildingFootprint(b: BuildingId, at: Pt = SPOTS[b]): Rect {
  const t = buildingTiles(b);
  return footprint(at.x, at.y, t.w, t.h, isAnnex(b) ? 0 : 1);
}

/** Every tile a building claims: its footprint, and the tiles of its doorway lamp and doorbell. */
export function buildingRects(b: BuildingId, at: Pt = SPOTS[b]): Rect[] {
  // The Mail Rocket's tiles belong to the Post Office (kept free for it, and moved with it).
  if (b === "rocket_pad") return [];
  const rects = [buildingFootprint(b, at)];
  if (b !== "mailbox") rects.push(tileAt(besideDoor(b, -1, at)), tileAt(besideDoor(b, 1, at)));
  if (b === "post_office") rects.push(buildingFootprint("rocket_pad", mailRocketAt(at)));
  return rects;
}

/** Ground nothing can go on: the plaza (with its lamps) and the ship you landed in. */
export const RESERVED: Rect[] = [
  // the round plaza (with its rim lamps and the obelisks just outside), as an octagon
  { x: PLAZA.x - 152, y: PLAZA.y - 80, w: 304, h: 160 },
  { x: PLAZA.x - 120, y: PLAZA.y - 120, w: 240, h: 240 },
  { x: PLAZA.x - 80, y: PLAZA.y - 152, w: 160, h: 304 },
  footprint(LANDING.x, LANDING.y, 2, 2),
];

/** Every tile of every rect is on the island and clear of `others` and reserved ground. */
export function canOccupy(rects: Rect | Rect[], others: Rect[]): boolean {
  for (const r of Array.isArray(rects) ? rects : [rects]) {
    for (let y = r.y + TILE / 2; y < r.y + r.h; y += TILE) {
      for (let x = r.x + TILE / 2; x < r.x + r.w; x += TILE) if (!inIslandXY(x, y)) return false;
    }
    if ([...RESERVED, ...others].some((o) => overlaps(r, o))) return false;
  }
  return true;
}

// ---------------------------------------------------------------- moon rocks
// Boulders, crystal outcrops, spires and arches scattered over the island, plus
// little rock gardens framing the plaza. Deterministic (same island every
// load, on client and server alike), on the grid, and kept clear of the plaza,
// buildings, paths and task lanterns. They take up their tiles like anything else.

export type RockKind = "small" | "big" | "crystal" | "spire" | "arch";
export const ROCK_TILES: Record<RockKind, number> = { small: 1, big: 2, crystal: 1, spire: 1, arch: 3 };
/** What it costs to clear a rock away, and what to call it. */
/** How much moonstone each kind of rock breaks into when you clear it (clearing is free). */
export const ROCK_STONE: Record<RockKind, number> = { small: 1, big: 2, spire: 2, crystal: 3, arch: 3 };
export const ROCK_NAME: Record<RockKind, string> = { small: "Pebbles", big: "Boulder", crystal: "Crystal Outcrop", spire: "Rock Spire", arch: "Stone Arch" };
export const rockKey = (r: { x: number; y: number }) => `${r.x},${r.y}`;
export interface Rock {
  kind: RockKind;
  x: number;
  y: number;
}

const noise = (x: number, y: number, seed: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

function segDist(px: number, py: number, a: Pt, c: Pt) {
  const l2 = (c.x - a.x) ** 2 + (c.y - a.y) ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * (c.x - a.x) + (py - a.y) * (c.y - a.y)) / l2));
  return Math.hypot(px - (a.x + t * (c.x - a.x)), py - (a.y + t * (c.y - a.y)));
}

const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 });

let rockCache: { key: string; rocks: Rock[] } | null = null;

/** Where nothing wild (rocks, shards) may go: the plaza, buildings (now and at their start), paths, lanterns. */
function wildsKeepOut(avoid: Rect[]): { keepOut: Rect[]; paths: Pt[][] } {
  // Decorations keep rocks off their own tiles only: growing them would let a
  // cheap shrub placed beside a rock make it vanish without paying to clear it.
  const keepOut: Rect[] = [...RESERVED.map((r) => grow(r, TILE)), ...avoid];
  const paths: Pt[][] = [[PLAZA, { x: LANDING.x, y: LANDING.y + 12 }]];
  for (const b of Object.keys(SPOTS) as BuildingId[]) {
    for (const at of [SPOTS[b], DEFAULT_POS[b]]) {
      const s = { ...SPOTS[b], ...at };
      for (const r of buildingRects(b, at)) keepOut.push(grow(r, TILE));
      keepOut.push({ x: s.x - s.fw - 16, y: s.y - s.tall - 8, w: s.fw * 2 + 32, h: s.tall + 8 });
      if (!isAnnex(b)) paths.push(pathPoints(b, at));
    }
  }
  for (let i = 0; i < 32; i++) keepOut.push(grow(tileAt(lanternSpot(i)), TILE));
  return { keepOut, paths };
}

/**
 * Every rock on the island. `avoid`: things already placed (decorations,
 * lanterns) that rocks must not sit on. `cleared`: rocks the player paid to
 * remove (removed after generation, so clearing one never shifts the others).
 */
export function rockSpots(avoid: Rect[] = [], cleared: string[] = []): Rock[] {
  const key = JSON.stringify([Object.values(SPOTS).map((s) => [s.x, s.y]), avoid.map((r) => [r.x, r.y, r.w, r.h]), cleared]);
  if (rockCache?.key === key) return rockCache.rocks;

  const { keepOut, paths } = wildsKeepOut(avoid);

  const rocks: Rock[] = [];
  const taken: Rect[] = [];
  const tryPlace = (kind: RockKind, x: number, y: number) => {
    const w = ROCK_TILES[kind];
    const p = snapToTiles(x, y, w);
    const r = footprint(p.x, p.y, w, 1);
    for (let ty = r.y - TILE; ty < r.y + r.h + TILE; ty += TILE) {
      for (let tx = r.x - TILE; tx < r.x + r.w + TILE; tx += TILE) if (!inIslandXY(tx + TILE / 2, ty + TILE / 2)) return;
    }
    if (keepOut.some((k) => overlaps(k, r)) || taken.some((t) => overlaps(grow(t, TILE), r))) return;
    const cx = p.x;
    const cy = p.y - TILE / 2;
    if (paths.some((pts) => pts.some((a, i) => i < pts.length - 1 && segDist(cx, cy, a, pts[i + 1]) < 20 + (w * TILE) / 2))) return;
    rocks.push({ kind, x: p.x, y: p.y });
    taken.push(r);
  };

  // The wilds.
  for (let ty = 2; ty < MAP_H - 2; ty++) {
    for (let tx = 2; tx < MAP_W - 2; tx++) {
      // Sparse on purpose: a few rocks read as scenery, a lot read as clutter.
      if (noise(tx, ty, 41) > 0.024) continue;
      const k = noise(tx, ty, 42);
      const kind: RockKind = k < 0.4 ? "small" : k < 0.68 ? "big" : k < 0.82 ? "crystal" : k < 0.95 ? "spire" : "arch";
      tryPlace(kind, tx * TILE + TILE / 2, (ty + 1) * TILE);
    }
  }
  const gone = new Set(cleared);
  const kept = rocks.filter((r) => !gone.has(rockKey(r)));
  rockCache = { key, rocks: kept };
  return kept;
}

export function rockRect(r: Rock): Rect {
  return footprint(r.x, r.y, ROCK_TILES[r.kind], 1);
}

// ---------------------------------------------------------------- moon shards
// Twelve glowing shards hidden out in the wilds, spread across the whole island
// (each spot is the candidate farthest from the ones already picked). Walk over
// one to pick it up; find them all for a bonus. Fixed per island, so the
// client and server agree without talking about it.

export const SHARD_COUNT = 12;
export const SHARD_REWARD = 15;
export const SHARD_BONUS = 200;

let shardCache: Pt[] | null = null;

/**
 * Where the 12 shards are. Worked out from the default layout, so they don't
 * shift when buildings are moved and the game and server always agree (the
 * tiles are kept free: nothing can be placed on an unfound shard).
 */
export function shardSpots(): Pt[] {
  if (shardCache) return shardCache;
  const moved = Object.fromEntries((Object.keys(SPOTS) as BuildingId[]).map((b) => [b, { x: SPOTS[b].x, y: SPOTS[b].y }])) as Layout;
  applyLayout({});
  try {
    shardCache = computeShards();
  } finally {
    applyLayout(moved);
  }
  return shardCache;
}

function computeShards(): Pt[] {
  const { keepOut, paths } = wildsKeepOut([]);
  const rocks = rockSpots([]).map((r) => grow(rockRect(r), TILE));
  const candidates: Pt[] = [];
  for (let ty = 3; ty < MAP_H - 3; ty += 2) {
    for (let tx = 3; tx < MAP_W - 3; tx += 2) {
      const p = { x: tx * TILE + TILE / 2, y: (ty + 1) * TILE };
      const r = tileAt(p);
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1 && ok; dx++) ok = inIslandXY(p.x + dx * TILE * 2, p.y - TILE / 2 + dy * TILE * 2);
      if (!ok || keepOut.some((k) => overlaps(k, r)) || rocks.some((k) => overlaps(k, r))) continue;
      if (paths.some((pts) => pts.some((a, i) => i < pts.length - 1 && segDist(p.x, p.y - 8, a, pts[i + 1]) < 28))) continue;
      candidates.push(p);
    }
  }
  const picked: Pt[] = [];
  if (candidates.length) picked.push(candidates.reduce((a, b) => (noise(b.x, b.y, 71) < noise(a.x, a.y, 71) ? b : a)));
  while (picked.length < SHARD_COUNT && picked.length < candidates.length) {
    let best: Pt | null = null;
    let bestD = -1;
    for (const c of candidates) {
      const d = Math.min(...picked.map((p) => Math.hypot(p.x - c.x, p.y - c.y))) + noise(c.x, c.y, 72) * 24;
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    picked.push(best!);
  }
  shardCache = picked;
  return picked;
}

export const shardKey = (p: Pt) => `${p.x},${p.y}`;
