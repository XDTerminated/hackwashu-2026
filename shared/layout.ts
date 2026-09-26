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
}

const CX = WORLD_W / 2;
const CY = WORLD_H / 2;

/** Where every path starts — the central plaza. */
export const PLAZA = { x: CX, y: CY + 70 };

/** Every building sits on one circle around the plaza, evenly spaced, clockwise from north. */
export const RING_RADIUS = 300;
const RING: BuildingId[] = ["player_house", "library", "rocket_pad", "clock_tower", "observatory", "post_office", "rabbit_burrow"];

function onRing(b: BuildingId) {
  const a = -Math.PI / 2 + (RING.indexOf(b) / RING.length) * Math.PI * 2;
  return { x: Math.round(PLAZA.x + Math.cos(a) * RING_RADIUS), y: Math.round(PLAZA.y + Math.sin(a) * RING_RADIUS) };
}

const spot = (b: BuildingId, texture: string, fw: number, fh: number, door: { dx: number; dy: number }): BuildingSpot => ({ ...onRing(b), texture, fw, fh, door });
const PO = onRing("post_office");

export const SPOTS: Record<BuildingId, BuildingSpot> = {
  player_house: spot("player_house", "b_player_house", 22, 18, { dx: 0, dy: 14 }),
  library: spot("library", "b_library", 28, 20, { dx: 0, dy: 14 }),
  rocket_pad: spot("rocket_pad", "b_rocket_pad", 26, 10, { dx: -40, dy: 6 }),
  clock_tower: spot("clock_tower", "b_clock_tower", 16, 14, { dx: 0, dy: 14 }),
  observatory: spot("observatory", "b_observatory", 24, 18, { dx: 0, dy: 14 }),
  post_office: spot("post_office", "b_post_office", 28, 20, { dx: 0, dy: 14 }),
  rabbit_burrow: spot("rabbit_burrow", "b_rabbit_burrow", 24, 16, { dx: 0, dy: 12 }),
  // A prop beside the Post Office (on the outer side, clear of its path), not its own ring slot.
  mailbox: { x: PO.x - 50, y: PO.y + 6, texture: "b_mailbox", fw: 5, fh: 4, door: { dx: 12, dy: 10 } },
};

/** The ship you arrived in: parked just outside the ring, between your house and the Rabbit's. */
export const LANDING = (() => {
  const a = -Math.PI / 2 - Math.PI / RING.length;
  return { x: Math.round(PLAZA.x + Math.cos(a) * (RING_RADIUS + 130)), y: Math.round(PLAZA.y + Math.sin(a) * (RING_RADIUS + 130)) };
})();

/** Lanterns from finished tasks are planted in a ring around the plaza. */
export function lanternSpot(i: number): { x: number; y: number } {
  const ring = Math.floor(i / 16);
  const k = i % 16;
  const a = (k / 16) * Math.PI * 2 + ring * 0.2;
  const rx = 150 + ring * 34;
  const ry = 92 + ring * 22;
  return { x: CX + Math.cos(a) * rx, y: CY + 70 + Math.sin(a) * ry };
}


/** Solar lamps ringing the plaza and standing by each doorway. */
export function lampSpots(built: (b: BuildingId) => boolean = () => true): { x: number; y: number; building?: BuildingId }[] {
  const out: { x: number; y: number; building?: BuildingId }[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    out.push({ x: PLAZA.x + Math.cos(a) * 52, y: PLAZA.y + Math.sin(a) * 46 });
  }
  for (const [b, s] of Object.entries(SPOTS) as [BuildingId, BuildingSpot][]) {
    if (b === "mailbox" || !built(b)) continue;
    out.push({ ...besideDoor(b, -1), building: b });
  }
  return out;
}

/** True if (x, y) is inside any building's solid footprint (with a margin). */
export function nearBuilding(x: number, y: number, margin = 0): boolean {
  return Object.values(SPOTS).some((s) => x > s.x - s.fw - margin && x < s.x + s.fw + margin && y > s.y - s.fh - margin - 40 && y < s.y + margin + 16);
}

type Pt = { x: number; y: number };

/**
 * A building's path, from the plaza's rim to its door. Doors face south, so
 * for buildings below the plaza it doglegs around the side instead of running
 * under the house.
 */
export function pathPoints(b: BuildingId): Pt[] {
  const s = SPOTS[b];
  const door = { x: s.x + s.door.dx, y: s.y + s.door.dy };
  const behind = s.y - s.fh > PLAZA.y;
  const via = behind ? { x: s.x + (PLAZA.x < s.x ? -1 : 1) * (s.fw + 14), y: door.y } : null;
  const first = via ?? door;
  const len = Math.hypot(first.x - PLAZA.x, first.y - PLAZA.y) || 1;
  const start = { x: PLAZA.x + ((first.x - PLAZA.x) / len) * 38, y: PLAZA.y + ((first.y - PLAZA.y) / len) * 38 };
  return via ? [start, via, door] : [start, door];
}

function distToPath(b: BuildingId, x: number, y: number): number {
  const pts = pathPoints(b);
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
 * A spot in front of a building's door, to its left (-1) or right (+1) —
 * where lamps and doorbells go. Steps forward if it would sit on the path.
 */
export function besideDoor(b: BuildingId, side: -1 | 1): Pt {
  const s = SPOTS[b];
  const p = { x: s.x + s.door.dx + side * 24, y: s.y + s.door.dy + 4 };
  for (let i = 0; i < 4 && distToPath(b, p.x, p.y) < 10; i++) p.y += 10;
  return p;
}

// ---------------------------------------------------------------- tiles
// Anything you can move (buildings, plots, decorations) snaps to the 16px tile
// grid and takes up a footprint of whole tiles. Nothing may share a tile.
// Buildings also keep the row in front of their door clear.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the player has moved buildings to (unlisted ones stay on the ring). */
export type Layout = Partial<Record<BuildingId, { x: number; y: number }>>;

const DEFAULT_POS = Object.fromEntries(Object.entries(SPOTS).map(([b, s]) => [b, { x: s.x, y: s.y }])) as Record<BuildingId, { x: number; y: number }>;

/** Move buildings to where the save says they are. SPOTS is read live everywhere. */
export function applyLayout(layout: Layout) {
  for (const b of Object.keys(SPOTS) as BuildingId[]) Object.assign(SPOTS[b], layout[b] ?? DEFAULT_POS[b]);
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

export function buildingTiles(b: BuildingId): { w: number; h: number } {
  const s = SPOTS[b];
  return { w: Math.max(1, Math.ceil((s.fw * 2) / TILE)), h: Math.max(1, Math.ceil(s.fh / TILE)) };
}

export function buildingFootprint(b: BuildingId, at: { x: number; y: number } = SPOTS[b]): Rect {
  const t = buildingTiles(b);
  return footprint(at.x, at.y, t.w, t.h, b === "mailbox" ? 0 : 1);
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Ground nothing can go on: the plaza and the ship you landed in. */
export const RESERVED: Rect[] = [
  { x: PLAZA.x - 56, y: PLAZA.y - 48, w: 112, h: 96 },
  { x: LANDING.x - 24, y: LANDING.y - 24, w: 48, h: 40 },
];

/** Every tile of `r` is on the island and clear of `others` and reserved ground. */
export function canOccupy(r: Rect, others: Rect[]): boolean {
  for (let y = r.y + TILE / 2; y < r.y + r.h; y += TILE) {
    for (let x = r.x + TILE / 2; x < r.x + r.w; x += TILE) if (!inIslandXY(x, y)) return false;
  }
  return ![...RESERVED, ...others].some((o) => overlaps(r, o));
}
