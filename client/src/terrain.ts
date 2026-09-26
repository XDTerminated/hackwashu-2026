// Bakes the island ground once into a single texture: Stardew-style tiles,
// cliff faces on the rim, lunar moss where the colony has taken root, and
// flagstone paths so you can follow an agent's route across the map.

import Phaser from "phaser";
import { LANDING, MAP_H, MAP_W, PLAZA, SPOTS, TILE, WORLD_H, WORLD_W, inIsland, pathPoints } from "./layout";
export { PLAZA, lampSpots } from "./layout";
import type { BuildingId } from "../../shared/game";
import { type Ctx, hash, rect } from "./pix";

const REGOLITH = ["#b3abc2", "#b3abc2", "#b2aac1"];
const REG_DARK = "#9d95b0";
const REG_LIGHT = "#c9c2d8";
const MOSS = ["#78b86a", "#78b86a", "#77b769"];
const MOSS_DARK = "#4f9e54";
const MOSS_LIGHT = "#9ad48a";
const CLIFF = "#8a7fa0";
const CLIFF_DARK = "#6f6588";
const CLIFF_LIGHT = "#a69cbc";

export const MINIMAP_W = 76;
export const MINIMAP_H = 58;

/** Smooth-ish value noise for organic moss patches. */
function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, yi, 3);
  const b = hash(xi + 1, yi, 3);
  const c = hash(xi, yi + 1, 3);
  const d = hash(xi + 1, yi + 1, 3);
  return a + (b - a) * s(xf) + (c - a) * s(yf) + (a - b - c + d) * s(xf) * s(yf);
}

function isMoss(tx: number, ty: number): boolean {
  if (!inIsland(tx + 0.5, ty + 0.5)) return false;
  const px = (tx + 0.5) * TILE;
  const py = (ty + 0.5) * TILE;
  let d = Math.hypot(px - PLAZA.x, py - PLAZA.y) * 0.8;
  for (const s of Object.values(SPOTS)) d = Math.min(d, Math.hypot(px - s.x, py - (s.y - 10)));
  const n = noise(tx / 5, ty / 5) * 0.65 + noise(tx / 2.2, ty / 2.2) * 0.35;
  return n > 0.28 + d / 260;
}

function regolithTile(ctx: Ctx, tx: number, ty: number) {
  const x0 = tx * TILE;
  const y0 = ty * TILE;
  rect(ctx, REGOLITH[Math.floor(hash(tx, ty) * 3)], x0, y0, TILE, TILE);
  const n = 3 + Math.floor(hash(tx, ty, 1) * 4);
  for (let i = 0; i < n; i++) {
    const x = x0 + Math.floor(hash(tx, ty, i + 10) * 14);
    const y = y0 + Math.floor(hash(tx, ty, i + 20) * 14);
    rect(ctx, REG_DARK, x, y, 2, 1);
    rect(ctx, REG_LIGHT, x, y - 1, 1, 1);
  }
  if (hash(tx, ty, 5) > 0.86) {
    // pebble
    const x = x0 + 3 + Math.floor(hash(tx, ty, 6) * 9);
    const y = y0 + 3 + Math.floor(hash(tx, ty, 7) * 9);
    rect(ctx, "#8a8199", x, y + 1, 3, 2);
    rect(ctx, "#d2cbe0", x, y, 2, 1);
  }
}

function mossTile(ctx: Ctx, tx: number, ty: number) {
  const x0 = tx * TILE;
  const y0 = ty * TILE;
  rect(ctx, MOSS[Math.floor(hash(tx, ty, 2) * 3)], x0, y0, TILE, TILE);
  for (let i = 0; i < 7; i++) {
    const x = x0 + Math.floor(hash(tx, ty, i + 30) * 15);
    const y = y0 + Math.floor(hash(tx, ty, i + 40) * 14);
    rect(ctx, MOSS_DARK, x, y, 1, 2);
    rect(ctx, MOSS_LIGHT, x + 1, y, 1, 1);
  }
  // moon-flowers
  if (hash(tx, ty, 8) > 0.82) {
    const x = x0 + 3 + Math.floor(hash(tx, ty, 9) * 9);
    const y = y0 + 3 + Math.floor(hash(tx, ty, 11) * 9);
    const petal = hash(tx, ty, 12) > 0.5 ? "#fff6ee" : "#f7a8c8";
    rect(ctx, petal, x - 1, y, 3, 1);
    rect(ctx, petal, x, y - 1, 1, 3);
    rect(ctx, "#f5c542", x, y, 1, 1);
  }
}

/**
 * Soften moss edges Stardew-style: ragged grass fringes spill into bare
 * neighbors, with a dark lip, and convex corners get rounded off.
 */
function mossEdges(ctx: Ctx) {
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (!isMoss(tx, ty)) continue;
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      const bare = (dx: number, dy: number) => !isMoss(tx + dx, ty + dy) && inIsland(tx + dx + 0.5, ty + dy + 0.5);
      const N = bare(0, -1), S = bare(0, 1), W = bare(-1, 0), E = bare(1, 0);
      for (let i = 0; i < TILE; i++) {
        const d = (k: number) => 1 + Math.floor(hash(tx * 16 + i, ty * 16, k) * 3);
        if (S) {
          const n = d(1);
          rect(ctx, MOSS[0], x0 + i, y0 + TILE, 1, n);
          rect(ctx, MOSS_DARK, x0 + i, y0 + TILE + n, 1, 1);
        }
        if (N) {
          const n = d(2);
          rect(ctx, MOSS[0], x0 + i, y0 - n, 1, n);
          rect(ctx, MOSS_LIGHT, x0 + i, y0 - n, 1, 1);
        }
        if (W) {
          const n = d(3);
          rect(ctx, MOSS[0], x0 - n, y0 + i, n, 1);
          rect(ctx, MOSS_DARK, x0 - n, y0 + i, 1, 1);
        }
        if (E) {
          const n = d(4);
          rect(ctx, MOSS[0], x0 + TILE, y0 + i, n, 1);
          rect(ctx, MOSS_DARK, x0 + TILE + n - 1, y0 + i, 1, 1);
        }
      }
      // Round convex corners back to bare regolith.
      const cut = (cx: number, cy: number, sx: number, sy: number) => {
        for (let k = 0; k < 4; k++) for (let j = 0; j < 4 - k; j++) rect(ctx, REGOLITH[0], cx + sx * k, cy + sy * j, 1, 1);
        rect(ctx, MOSS_DARK, cx + sx * 4, cy, 1, 1);
        rect(ctx, MOSS_DARK, cx, cy + sy * 4, 1, 1);
      };
      if (N && W) cut(x0 - 3, y0 - 3, 1, 1);
      if (N && E) cut(x0 + TILE + 2, y0 - 3, -1, 1);
      if (S && W) cut(x0 - 3, y0 + TILE + 2, 1, -1);
      if (S && E) cut(x0 + TILE + 2, y0 + TILE + 2, -1, -1);
    }
  }
}

/** Two staggered lines of flagstones on packed regolith. */
function flagstonePath(ctx: Ctx, ax: number, ay: number, bx: number, by: number) {
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const px = -uy;
  const py = ux;
  for (let t = 0; t <= len; t += 2) {
    const x = ax + ux * t;
    const y = ay + uy * t;
    for (let w = -6; w <= 6; w++) rect(ctx, "#a4999f", x + px * w, y + py * w, 1, 1);
  }
  for (let t = 0, i = 0; t <= len; t += 7, i++) {
    for (const side of [-3, 3]) {
      const jitter = (hash(i, side, 4) - 0.5) * 2;
      const x = Math.round(ax + ux * (t + (side > 0 ? 3 : 0)) + px * side + jitter);
      const y = Math.round(ay + uy * (t + (side > 0 ? 3 : 0)) + py * side + jitter * 0.5);
      stone(ctx, x - 2, y - 2, 5, 4, i + side);
    }
  }
}

function stone(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number) {
  rect(ctx, "#8f8578", x + 1, y, w - 2, h);
  rect(ctx, "#8f8578", x, y + 1, w, h - 2);
  const fill = hash(seed, 1, 9) > 0.5 ? "#d8d0c4" : "#cfc6b8";
  rect(ctx, fill, x + 1, y + 1, w - 2, h - 2);
  rect(ctx, "#ece6dc", x + 1, y + 1, w - 3, 1);
}

function plaza(ctx: Ctx) {
  const R = 40;
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) if (x * x + y * y <= R * R) rect(ctx, "#a4999f", PLAZA.x + x, PLAZA.y + y, 1, 1);
  for (let y = -R + 2, row = 0; y <= R - 4; y += 5, row++) {
    for (let x = -R + (row % 2 ? 3 : 0); x <= R - 4; x += 6) {
      if ((x + 2) ** 2 + (y + 2) ** 2 > (R - 3) ** 2) continue;
      stone(ctx, PLAZA.x + x, PLAZA.y + y, 6, 5, x * 31 + y);
    }
  }
}

function cliffs(ctx: Ctx) {
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const here = inIsland(tx + 0.5, ty + 0.5);
      if (!here) continue;
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      // Cliff face drops below any south-facing edge.
      if (!inIsland(tx + 0.5, ty + 1.5)) {
        const y = y0 + TILE;
        rect(ctx, CLIFF, x0, y, TILE, 18);
        rect(ctx, CLIFF_LIGHT, x0, y, TILE, 2);
        for (let sx = x0 + (tx % 2 ? 2 : 6); sx < x0 + TILE; sx += 7) rect(ctx, CLIFF_DARK, sx, y + 3, 1, 12);
        rect(ctx, CLIFF_DARK, x0, y + 9, TILE, 1);
        rect(ctx, "#5a5170", x0, y + 16, TILE, 2);
      }
      // Darker rim on every other edge.
      if (!inIsland(tx + 0.5, ty - 0.5)) rect(ctx, CLIFF_LIGHT, x0, y0, TILE, 2);
      if (!inIsland(tx - 0.5, ty + 0.5)) rect(ctx, CLIFF_DARK, x0, y0, 2, TILE);
      if (!inIsland(tx + 1.5, ty + 0.5)) rect(ctx, CLIFF_DARK, x0 + TILE - 2, y0, 2, TILE);
    }
  }
}

function craters(ctx: Ctx, rnd: Phaser.Math.RandomDataGenerator) {
  for (let i = 0; i < 26; i++) {
    const cx = rnd.between(120, WORLD_W - 120);
    const cy = rnd.between(120, WORLD_H - 120);
    if (!inIsland(cx / TILE, cy / TILE) || isMoss(Math.floor(cx / TILE), Math.floor(cy / TILE))) continue;
    if (Object.values(SPOTS).some((s) => Math.hypot(s.x - cx, s.y - cy) < 90) || Math.hypot(PLAZA.x - cx, PLAZA.y - cy) < 190) continue;
    const r = rnd.between(7, 18);
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = (x / r) ** 2 + (y / (r * 0.7)) ** 2;
        if (d > 1) continue;
        const rim = d > 0.72;
        const upper = y < 0;
        rect(ctx, rim ? (upper ? "#8a8199" : "#d2cbe0") : upper ? "#9d95b0" : "#a8a0b8", cx + x, cy + y, 1, 1);
      }
    }
  }
}

export function bakeTerrain(scene: Phaser.Scene) {
  if (scene.textures.exists("ground")) return;
  const tex = scene.textures.createCanvas("ground", WORLD_W, WORLD_H)!;
  const ctx = tex.getContext();
  const rnd = new Phaser.Math.RandomDataGenerator(["luna"]);

  // Deep space.
  rect(ctx, "#0b0a1a", 0, 0, WORLD_W, WORLD_H);
  for (let i = 0; i < 2000; i++) {
    const x = rnd.between(0, WORLD_W - 1);
    const y = rnd.between(0, WORLD_H - 1);
    if (inIsland(x / TILE, y / TILE)) continue;
    ctx.globalAlpha = rnd.realInRange(0.3, 1);
    rect(ctx, rnd.pick(["#ffffff", "#c8d2f0", "#9aa8cc", "#f5d7a8"]), x, y, 1, 1);
  }
  ctx.globalAlpha = 1;

  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (!inIsland(tx + 0.5, ty + 0.5)) continue;
      if (isMoss(tx, ty)) mossTile(ctx, tx, ty);
      else regolithTile(ctx, tx, ty);
    }
  }
  mossEdges(ctx);
  cliffs(ctx);
  craters(ctx, rnd);

  // Only the landing path exists at first; each building lays its own path when built.
  flagstonePath(ctx, PLAZA.x, PLAZA.y, LANDING.x, LANDING.y + 12);
  plaza(ctx);

  tex.refresh();

  // Island silhouette for the minimap, drawn at its exact on-screen size.
  const mm = scene.textures.createCanvas("minimap", MINIMAP_W, MINIMAP_H)!;
  const mctx = mm.getContext();
  for (let py = 0; py < MINIMAP_H; py++)
    for (let px = 0; px < MINIMAP_W; px++) {
      const tx = ((px + 0.5) / MINIMAP_W) * MAP_W;
      const ty = ((py + 0.5) / MINIMAP_H) * MAP_H;
      if (!inIsland(tx, ty)) continue;
      rect(mctx, isMoss(Math.floor(tx), Math.floor(ty)) ? "#5e9a58" : "#8a82a0", px, py, 1, 1);
    }
  mm.refresh();
}

/** A building's flagstone path (see pathPoints for the route). */
export function drawBuildingPath(ctx: Ctx, b: BuildingId) {
  const pts = pathPoints(b);
  for (let i = 0; i < pts.length - 1; i++) flagstonePath(ctx, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
}
