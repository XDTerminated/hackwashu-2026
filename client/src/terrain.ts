// Bakes the island ground once into a single texture: Stardew-style tiles,
// dark basalt maria (the moon's "seas") pocked with little craters, and
// flagstone paths so you can follow an agent's route. The colony sits on the
// floor of a great crater: bakeOuter paints the crater wall rising all round,
// the grey plains beyond it, and the Moon itself curving away into space.

import Phaser from "phaser";
import { ISLAND_CX, ISLAND_CY, LANDING, MAP_H, MAP_W, PLAZA, PLAZA_R, SPOTS, TILE, WORLD_H, WORLD_W, inIsland, pathPoints } from "./layout";
export { PLAZA, lampSpots } from "./layout";
import type { BuildingId } from "../../shared/game";
import { type Ctx, hash, rect } from "./pix";

const REGOLITH = ["#b3abc2", "#b3abc2", "#b2aac1"];
const REG_DARK = "#9d95b0";
const REG_LIGHT = "#c9c2d8";
// Maria: old lava plains, darker and bluer than the dusty highlands, sitting a
// step lower (a shadowed lip along the top, a lit one along the bottom).
const MARE = "#8b85a3";
const MARE_DARK = "#6f6a88";
const MARE_LIGHT = "#a29db8";
const MARE_SHADOW = "#77728f";

export const MINIMAP_W = 76;
export const MINIMAP_H = 58;

/** Smooth-ish value noise for organic maria patches. */
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

/** Maria gather around the colony (the plaza and the homes), in smooth, rounded basins. */
function mareAt(px: number, py: number): boolean {
  if (!inIsland(Math.floor(px / TILE) + 0.5, Math.floor(py / TILE) + 0.5)) return false;
  let d = Math.hypot(px - PLAZA.x, py - PLAZA.y) * 0.8;
  for (const s of Object.values(SPOTS)) d = Math.min(d, Math.hypot(px - s.x, py - (s.y - 10)));
  const n = noise(px / (TILE * 5), py / (TILE * 5)) * 0.65 + noise(px / (TILE * 2.2), py / (TILE * 2.2)) * 0.35;
  return n > 0.28 + d / 260;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Darken the ground into maria, pixel by pixel (so the edges curve instead of
 * following tiles). The grit shows through, just darker and bluer. Each basin
 * sits a step lower: shadowed along its top and left lips, lit along the
 * bottom and right. Returns the mask (1 = mare) for the craters and minimap.
 */
function maria(ctx: Ctx, rnd: Phaser.Math.RandomDataGenerator): Uint8Array {
  const W = WORLD_W;
  const H = WORLD_H;
  const m = new Uint8Array(W * H);
  // (the field is smooth, so sample every other pixel and fill in)
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (mareAt(x + 1, y + 1)) m[y * W + x] = m[y * W + x + 1] = m[(y + 1) * W + x] = m[(y + 1) * W + x + 1] = 1;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1;
  const img = ctx.getImageData(0, 0, W, H);
  const p = img.data;
  const [dark, shadow, light] = [rgb(MARE_DARK), rgb(MARE_SHADOW), rgb(MARE_LIGHT)];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      const i = (y * W + x) * 4;
      const lip = !at(x, y - 1) || !at(x - 1, y) ? dark : !at(x, y - 2) ? shadow : !at(x, y + 1) || !at(x + 1, y) ? light : null;
      if (lip) [p[i], p[i + 1], p[i + 2]] = lip;
      else [p[i], p[i + 1], p[i + 2]] = [p[i] * 0.78, p[i + 1] * 0.78, p[i + 2] * 0.84];
    }
  ctx.putImageData(img, 0, 0);
  // craterlets, well inside the basins
  for (let i = 0; i < 700; i++) {
    const x = rnd.between(8, W - 8);
    const y = rnd.between(8, H - 8);
    if (at(x, y) && at(x - 6, y - 5) && at(x + 6, y - 5) && at(x - 6, y + 5) && at(x + 6, y + 5)) craterlet(ctx, x, y, rnd.frac() > 0.7 ? 3 : 2);
  }
  return m;
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

/** A little bowl punched into the ground, lit from above. */
function craterlet(ctx: Ctx, cx: number, cy: number, r: number) {
  for (let y = -r; y <= r; y++)
    for (let x = -r - 1; x <= r + 1; x++) {
      const d = (x / (r + 1)) ** 2 + (y / r) ** 2;
      if (d > 1) continue;
      const rim = d > 0.55;
      rect(ctx, rim ? (y < 0 ? MARE_DARK : MARE_LIGHT) : y < 0 ? MARE_SHADOW : MARE, cx + x, cy + y, 1, 1);
    }
}

// Flagstone tones: fill, top light, edge. Mostly cream, some cooler and warmer.
const STONES: [number, string, string, string][] = [
  [0.45, "#d8d0c4", "#ece6dc", "#8f8578"], // cream
  [0.25, "#cac6d2", "#e3e0ea", "#86808f"], // cool grey
  [0.2, "#d6c6ae", "#ebdfcc", "#8f7f68"], // warm tan
  [0.1, "#c3cad6", "#dde3ec", "#7f8796"], // blue-grey
];

/**
 * A flagstone path on packed regolith, no two alike: each path has its own
 * width (a two-row walk up to a broad three-row way), which swells and
 * narrows as it goes. Stones come in mixed
 * sizes and tones, with the odd cracked, sunken or missing one, and gravel.
 */
function flagstonePath(ctx: Ctx, ax: number, ay: number, bx: number, by: number) {
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const px = -uy;
  const py = ux;
  // every path gets its own pattern, from where it starts
  const seed = Math.floor(hash(Math.round(ax), Math.round(ay), 11) * 9973);
  const r = (i: number, k: number) => hash(seed + i, k, 5);
  // its width: a walk, a broad walk or a wide way, then swelling and narrowing along the way
  const base = [6, 7, 8, 9, 11][Math.floor(r(0, 30) * 5)];
  const halfAt = (t: number) => Math.max(5, base + Math.round((noise(t / 22 + seed, seed * 0.37) - 0.5) * 6));
  // the packed band, with gravel
  for (let t = 0; t <= len; t += 1) {
    const half = halfAt(t);
    const x = ax + ux * t;
    const y = ay + uy * t;
    for (let w = -half; w <= half; w++) {
      const g = hash(Math.round(x + px * w), Math.round(y + py * w), seed % 97);
      const c = Math.abs(w) === half ? "#978c93" : g > 0.93 ? "#b3a9ae" : g < 0.06 ? "#8e848a" : "#a4999f";
      rect(ctx, c, Math.round(x + px * w), Math.round(y + py * w), 1, 1);
    }
    // a pebble kicked just off the edge now and then
    if (r(t, 21) > 0.94) {
      const side = r(t, 22) > 0.5 ? 1 : -1;
      rect(ctx, "#8e848a", Math.round(x + px * side * (half + 2)), Math.round(y + py * side * (half + 2)), 1, 1);
    }
  }
  // the stones: rows to suit the width right here
  let i = 0;
  for (let t = 1; t <= len - 2; i++) {
    const half = halfAt(t);
    const big = half >= 5 && r(i, 1) > 0.9;
    const rows = big ? [0] : half <= 7 ? [-half / 2, half / 2] : [-half * 0.6, 0, half * 0.6];
    rows.forEach((side, n) => {
      const k = i * 5 + n;
      if (r(k, 2) < 0.07) return; // missing
      const w = big ? 7 + Math.floor(r(k, 3) * 3) : 4 + Math.floor(r(k, 3) * 3);
      const h = big ? 5 : 3 + Math.floor(r(k, 4) * 2);
      // staggered rows, a little off true
      const along = t + (n % 2 ? 3 : 0) + (r(k, 5) - 0.5) * 2;
      const across = side + (r(k, 6) - 0.5) * 2;
      const x = Math.round(ax + ux * along + px * across - w / 2);
      const y = Math.round(ay + uy * along + py * across - h / 2);
      stone(ctx, x, y, w, h, r(k, 7), r(k, 8));
    });
    t += big ? 9 : 6 + Math.floor(r(i, 9) * 3);
  }
}

/** One flagstone: `tone` picks its color, `wear` makes the odd one cracked or sunken. */
function stone(ctx: Ctx, x: number, y: number, w: number, h: number, tone: number, wear: number) {
  let acc = 0;
  const [, fill, light, edge] = STONES.find(([p]) => (acc += p) >= tone) ?? STONES[0];
  rect(ctx, edge, x + 1, y, w - 2, h);
  rect(ctx, edge, x, y + 1, w, h - 2);
  const sunken = wear > 0.94;
  rect(ctx, sunken ? edge : fill, x + 1, y + 1, w - 2, h - 2);
  if (sunken) rect(ctx, fill, x + 1, y + 2, w - 2, h - 3);
  else rect(ctx, light, x + 1, y + 1, w - 3, 1);
  // a hairline crack
  if (wear < 0.08 && w >= 5) {
    rect(ctx, edge, x + 2, y + 1, 1, 1);
    rect(ctx, edge, x + 3, y + 2, 1, 1);
    if (h > 3) rect(ctx, edge, x + 3, y + 3, 1, 1);
  }
}

function plaza(ctx: Ctx) {
  const R = PLAZA_R;
  // Marble laid in concentric courses, each course split into slabs.
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, y);
      if (d > R) continue;
      const a = Math.atan2(y, x);
      const course = Math.floor(d / 9);
      const slabs = Math.max(6, Math.round((course + 1) * 5.5));
      const slab = Math.floor(((a + Math.PI) / (Math.PI * 2)) * slabs + (course % 2) * 0.5);
      const seamR = d % 9 < 1;
      const seamA = Math.abs((((a + Math.PI) / (Math.PI * 2)) * slabs + (course % 2) * 0.5) % 1) < 0.06 * (9 / Math.max(9, d)) * 3;
      let c = hash(course, slab, 5) > 0.5 ? "#d8d2e0" : "#cfc8d9";
      if (hash(course, slab, 6) > 0.85) c = "#e2dce8";
      if (seamR || seamA) c = "#a49cb3";
      else if (d % 9 < 2) c = "#e8e3ee";
      // inlays
      const ray = Math.abs(Math.cos((8 * a) / 2));
      const ray2 = Math.abs(Math.cos((8 * (a + Math.PI / 8)) / 2));
      if (d > R - 3) c = "#6f6880";
      else if (d > R - 8 && d <= R - 6.5) c = "#c99a3e";
      else if (d > R - 6.5 && d <= R - 3) c = "#8a8298";
      else if (d > 66 && d < R - 12 && ray > 0.994) c = "#c4bccf";
      else if (d > 74 && d < R - 14 && ray2 > 0.997) c = "#c9c2d4";
      else if (d > 62 && d <= 64) c = "#c99a3e";
      else if (d <= 62 && d > 60) c = "#8a8298";
      if (d <= 60) {
        // the fountain court: a star of coral and cream
        const star = Math.abs(Math.cos((16 * a) / 2));
        c = d > 58 ? "#c99a3e" : star > 0.93 && d > 34 ? "#ddd6e4" : hash(Math.floor(x / 5), Math.floor(y / 5), 7) > 0.5 ? "#c2bbcd" : "#c9c2d4";
      }
      rect(ctx, c, PLAZA.x + x, PLAZA.y + y, 1, 1);
    }
  }
}

function craters(ctx: Ctx, rnd: Phaser.Math.RandomDataGenerator, mare: Uint8Array) {
  for (let i = 0; i < 26; i++) {
    const cx = rnd.between(120, WORLD_W - 120);
    const cy = rnd.between(120, WORLD_H - 120);
    if (!inIsland(cx / TILE, cy / TILE) || mare[cy * WORLD_W + cx]) continue;
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

  // The crater floor. (Everything outside it stays clear: the crater wall
  // and the world beyond live on the "outer" texture underneath.)
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const touches = [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]].some(([ox, oy]) => inIsland(tx + ox, ty + oy));
      if (touches) regolithTile(ctx, tx, ty);
    }
  }
  const mare = maria(ctx, rnd);
  craters(ctx, rnd, mare);
  // Trim to the crater floor's true (curved) edge, pixel by pixel.
  const img = ctx.getImageData(0, 0, WORLD_W, WORLD_H);
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) if (!inIsland((x + 0.5) / TILE, (y + 0.5) / TILE)) img.data[(y * WORLD_W + x) * 4 + 3] = 0;
  ctx.putImageData(img, 0, 0);

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
      rect(mctx, mare[Math.floor(ty * TILE) * WORLD_W + Math.floor(tx * TILE)] ? "#6c6785" : "#8a82a0", px, py, 1, 1);
    }
  mm.refresh();
}

/** A building's flagstone path (see pathPoints for the route). */
export function drawBuildingPath(ctx: Ctx, b: BuildingId) {
  const pts = pathPoints(b);
  for (let i = 0; i < pts.length - 1; i++) flagstonePath(ctx, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
}

// ---------------------------------------------------------------- the crater and beyond

/** How far past the world's edge the view can go (the crater wall, the plains, the curve). */
export const OUTER = 320;

// The Moon's surface outside the crater, darkest to lightest (the middle one matches the floor).
const RAMP = ["#4f4a63", "#665f7d", "#817a98", "#9c95b2", "#b3abc2", "#c9c3d8", "#ddd8e8"].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const FLAT = 4;
const SPACE = [11, 10, 26];

/**
 * Where a point sits relative to the crater's edge: its distance outside the
 * floor in pixels (negative inside), and its angle around the crater.
 */
function outside(px: number, py: number) {
  const dx = (px / TILE - ISLAND_CX) / 46;
  const dy = (py / TILE - ISLAND_CY) / 34;
  const ang = Math.atan2(dy, dx);
  const edge = 0.97 + 0.06 * Math.sin(ang * 3 + 1.7) + 0.04 * Math.sin(ang * 7 + 0.5);
  const pxPerUnit = TILE * Math.hypot(46 * Math.cos(ang), 34 * Math.sin(ang));
  return { d: (Math.hypot(dx, dy) - edge) * pxPerUnit, ang };
}

/**
 * The land around the colony: the crater wall rising from the floor's edge (lit
 * on the slopes that face the light, in shadow on the rest), the grey plains
 * beyond with their own craters and boulders, and then the Moon curving away
 * into starry space. Drawn once; it sits under the ground texture, OUTER
 * pixels past the world on every side, and nothing out here is walkable.
 */
export function bakeOuter(scene: Phaser.Scene) {
  if (scene.textures.exists("outer")) return;
  const W = WORLD_W + OUTER * 2;
  const H = WORLD_H + OUTER * 2;
  const tex = scene.textures.createCanvas("outer", W, H)!;
  const ctx = tex.getContext();
  const img = ctx.createImageData(W, H);
  const p = img.data;
  const cx = ISLAND_CX * TILE + OUTER;
  const cy = ISLAND_CY * TILE + OUTER;
  // The Moon's limb: a big ellipse around the crater, well inside the view's reach.
  const LX = 46 * TILE + 250;
  const LY = 34 * TILE + 205;

  // Height of the land: the wall climbs fast from the floor to an uneven crest,
  // then falls away slowly across the plains.
  const height = new Float32Array(W * H);
  const CREST = 30;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const { d, ang } = outside(x - OUTER + 0.5, y - OUTER + 0.5);
      if (d <= 0) continue;
      const amp = 1 + 0.35 * Math.sin(ang * 5 + 0.6) + 0.2 * Math.sin(ang * 13 + 2.1) + 0.25 * (noise((x + 7) / 23, (y + 3) / 23) - 0.5);
      const t = Math.min(1, d / CREST);
      const rise = t * t * (3 - 2 * t);
      const fall = d > CREST ? Math.exp(-(d - CREST) / 75) : 1;
      // (plus a slow roll to the plains, never busy)
      height[y * W + x] = 26 * amp * rise * fall + 6 * noise(x / 46, y / 46);
    }

  // Light from the upper left, a little from above.
  const L = [-0.55, -0.62, 0.56];
  const flatLight = L[2];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const ex = (x - cx) / LX;
      const ey = (y - cy) / LY;
      const e = Math.hypot(ex, ey);
      if (e > 1) {
        // space, with stars
        const star = hash(x, y, 31);
        const c = star > 0.9985 ? [255, 255, 255] : star > 0.997 ? [154, 168, 204] : SPACE;
        [p[i], p[i + 1], p[i + 2], p[i + 3]] = [c[0], c[1], c[2], 255];
        continue;
      }
      const h = (xx: number, yy: number) => height[Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))];
      const gx = (h(x + 1, y) - h(x - 1, y)) / 2;
      const gy = (h(x, y + 1) - h(x, y - 1)) / 2;
      const nl = Math.hypot(gx, gy, 1);
      const lit = (-gx * L[0] - gy * L[1] + L[2]) / nl;
      // quantize, with a light ordered dither between steps
      const dither = ((x & 1) * 2 + (y & 1) * 3) % 4 / 4 - 0.375;
      let step = FLAT + Math.round((lit - flatLight) * 6 + dither * 0.3);
      // the far plains fade a touch darker, and the ground darkens toward the Moon's edge
      const { d } = outside(x - OUTER + 0.5, y - OUTER + 0.5);
      if (d > 110) step -= 1;
      if (e > 0.94) step -= Math.round(((e - 0.94) / 0.06) * 3);
      step = Math.max(0, Math.min(RAMP.length - 1, step));
      let c = RAMP[step];
      // grit, like the floor's
      const g = hash(x, y, 17);
      if (g > 0.985) c = RAMP[Math.max(0, step - 1)];
      else if (g < 0.008) c = RAMP[Math.min(RAMP.length - 1, step + 1)];
      // the Moon's rim: a bright sunlit edge on the upper left, a dark one elsewhere
      if (e > 0.992) c = ex + ey < -0.4 ? RAMP[RAMP.length - 1] : RAMP[0];
      [p[i], p[i + 1], p[i + 2], p[i + 3]] = [c[0], c[1], c[2], 255];
    }
  ctx.putImageData(img, 0, 0);

  // Craters out on the plains, and boulders scattered along the crest.
  const rnd = new Phaser.Math.RandomDataGenerator(["rim"]);
  for (let n = 0; n < 90; n++) {
    const x = rnd.between(0, W - 1);
    const y = rnd.between(0, H - 1);
    const { d } = outside(x - OUTER, y - OUTER);
    if (Math.hypot((x - cx) / LX, (y - cy) / LY) > 0.9 || d < 70) continue;
    const r = rnd.between(4, 13);
    for (let yy = -r; yy <= r; yy++)
      for (let xx = -r; xx <= r; xx++) {
        const q = (xx / r) ** 2 + (yy / (r * 0.7)) ** 2;
        if (q > 1) continue;
        const rim = q > 0.7;
        const col = rim ? (yy < 0 ? "#665f7d" : "#c9c3d8") : yy < 0 ? "#817a98" : "#9c95b2";
        rect(ctx, col, x + xx, y + yy, 1, 1);
      }
  }
  for (let n = 0; n < 260; n++) {
    const x = rnd.between(0, W - 1);
    const y = rnd.between(0, H - 1);
    const { d } = outside(x - OUTER, y - OUTER);
    if (d < 14 || d > 60 || Math.hypot((x - cx) / LX, (y - cy) / LY) > 0.95) continue;
    const w = rnd.between(2, 4);
    rect(ctx, "#4f4a63", x, y + 1, w + 1, 2);
    rect(ctx, "#9c95b2", x, y, w, 2);
    rect(ctx, "#ddd8e8", x, y, Math.max(1, w - 1), 1);
  }
  tex.refresh();
}
