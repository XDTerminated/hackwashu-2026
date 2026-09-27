// Paths you lay yourself: bought from the Shop (PATHS) and painted onto the
// tile grid, a tile at a time or by dragging. Neighboring tiles join up on
// their own (edges and corners). Main Street and the plaza are the town's;
// everything else is yours to pave.

import type { BuildingId } from "./game.js";
import { RESERVED, TILE, buildingFootprint, inIsland, isAnnex, pathPoints, type Rect } from "./layout.js";

export type PathStyle = "dirt" | "stone" | "brick" | "glow";

export interface PathDef {
  id: PathStyle;
  name: string;
  /** Coins per tile (given back when you take it up). */
  price: number;
  /** The Market stage that stocks it (1 repaired, 2 grand). */
  market: number;
  blurb: string;
}

export const PATHS: PathDef[] = [
  { id: "dirt", name: "Dirt Track", price: 0, market: 1, blurb: "Packed regolith, worn smooth." },
  { id: "stone", name: "Flagstones", price: 1, market: 1, blurb: "Pale stones, no two alike." },
  { id: "brick", name: "Red Brick", price: 2, market: 1, blurb: "Warm brick, like home." },
  { id: "glow", name: "Glow Tiles", price: 3, market: 2, blurb: "Moon-glass with glowing seams." },
];

export const pathDef = (s: unknown): PathDef | undefined => PATHS.find((p) => p.id === s);
export const pathKey = (tx: number, ty: number) => `${tx},${ty}`;
export function fromKey(key: string): { tx: number; ty: number } {
  const [tx, ty] = key.split(",").map(Number);
  return { tx, ty };
}

const inside = (r: Rect, px: number, py: number) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;

/** Can this tile be paved? On the crater floor, not on the plaza or the landing pad, and not under a building. */
export function pathTileOk(tx: number, ty: number, built: Partial<Record<BuildingId, boolean>>): boolean {
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || !inIsland(tx + 0.5, ty + 0.5)) return false;
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  if (RESERVED.some((r) => inside(r, cx, cy))) return false;
  for (const b of Object.keys(built) as BuildingId[]) {
    if (!built[b]) continue;
    // (the row in front of a door is fine: that's where a path goes)
    const r = buildingFootprint(b);
    if (inside({ ...r, h: r.h - (isAnnex(b) ? 0 : TILE) }, cx, cy)) return false;
  }
  return true;
}

/**
 * The paths the game used to lay by itself (from each building to the plaza
 * or Main Street), as tiles: old saves keep them, now as paths you own.
 */
export function oldPathTiles(built: Partial<Record<BuildingId, boolean>>): string[] {
  const out = new Set<string>();
  for (const b of Object.keys(built) as BuildingId[]) {
    if (!built[b] || isAnnex(b)) continue;
    const pts = pathPoints(b);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const c = pts[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.y - a.y) / 4));
      for (let k = 0; k <= steps; k++) {
        const x = a.x + ((c.x - a.x) * k) / steps;
        const y = a.y + ((c.y - a.y) * k) / steps;
        const tx = Math.floor(x / TILE);
        const ty = Math.floor(y / TILE);
        if (pathTileOk(tx, ty, built)) out.add(pathKey(tx, ty));
      }
    }
  }
  return [...out];
}
