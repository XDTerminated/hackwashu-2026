// Bakes the island ground once into a single texture: Stardew-style tiles,
// dark basalt maria (the moon's "seas") pocked with little craters, and
// flagstone paths so you can follow an agent's route. The colony sits on the
// floor of a great crater: bakeOuter paints the crater wall rising all round,
// the grey plains beyond it, and the Moon itself curving away into space.

import Phaser from "phaser";
import { ISLAND_CX, ISLAND_CY, LANDING, MAP_H, MAP_W, PLAZA, PLAZA_R, SPOTS, STREET, TILE, WORLD_H, WORLD_W, inIsland, pathPoints } from "./layout";export { PLAZA, lampSpots } from "./layout";
import type { BuildingId } from "../../shared/game";
import { type Ctx, hash, rect } from "./pix";

// The floor sits a step darker than anything built on it, so the buildings,
// lamps and paving stand out against it.
const REGOLITH = ["#a9a1b9", "#a9a1b9", "#a8a0b8"];
const REG_DARK = "#938ba7";
const REG_LIGHT = "#bfb8cf";
// Maria: old lava plains, darker and bluer than the dusty highlands, sitting a
// step lower (a shadowed shore along the top, a lit one along the bottom).
const MARE = "#86809d";
const MARE_DARK = "#6a6583";
const MARE_LIGHT = "#9c97b2";
const MARE_SHADOW = "#726d8a";

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

/** How far a point is from the town: the plaza, Main Street, and every building's lot (0 inside). */
function townDist(px: number, py: number): number {
  let d = Math.hypot(px - PLAZA.x, py - PLAZA.y) - PLAZA_R;
  if (px > STREET.x0 - 16 && px < STREET.x1 + 16) d = Math.min(d, Math.abs(py - STREET.y) - 16);
  for (const s of Object.values(SPOTS)) {
    const dx = Math.max(0, Math.abs(px - s.x) - s.fw);
    const dy = Math.max(0, s.y - s.tall - py, py - s.y - 16);
    d = Math.min(d, Math.hypot(dx, dy));
  }
  return Math.max(0, d);
}

/**
 * Maria lie out in the open ground, never up against the town (where they'd
 * read as shadows under the buildings), in broad basins with ragged shores.
 */
function mareAt(px: number, py: number): boolean {
  if (!inIsland(Math.floor(px / TILE) + 0.5, Math.floor(py / TILE) + 0.5)) return false;
  const d = townDist(px, py);
  const n = noise(px / (TILE * 8), py / (TILE * 8)) * 0.65 + noise(px / (TILE * 3), py / (TILE * 3)) * 0.29 + noise(px / TILE, py / TILE) * 0.06;
  // (rarer and rarer toward town, so the shores curve away from it rather than stopping at a line)
  return n > 0.61 + Math.max(0, 1 - (d - 16) / 110) * 0.4;
}

/** A 4 x 4 ordered-dither threshold in [0, 1): blends two tones without banding. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** Scale a pixel's color (a little bluer as it darkens, like the maria). */
function tint(p: Uint8ClampedArray, i: number, k: number, blue = 1) {
  p[i] *= k;
  p[i + 1] *= k * 0.99;
  p[i + 2] = Math.min(255, p[i + 2] * k * blue);
}

/**
 * The highlands aren't one flat grey: broad, soft swells of lighter and darker
 * dust, dithered together so there are no hard edges.
 */
function mottle(ctx: Ctx) {
  const img = ctx.getImageData(0, 0, WORLD_W, WORLD_H);
  const p = img.data;
  const TONES = [0.955, 1, 1.035];
  for (let y = 0; y < WORLD_H; y++)
    for (let x = 0; x < WORLD_W; x++) {
      const i = (y * WORLD_W + x) * 4;
      if (!p[i + 3]) continue;
      const n = noise((x + 900) / 90, (y + 300) / 90) * 0.7 + noise((x + 50) / 34, (y + 700) / 34) * 0.3;
      const k = TONES[Math.max(0, Math.min(2, Math.floor((n - 0.5) * 6 + 1 + bayer(x, y))))];
      if (k !== 1) tint(p, i, k);
    }
  ctx.putImageData(img, 0, 0);
}

/**
 * Darken the ground into maria, pixel by pixel (so the shores curve instead of
 * following tiles). The grit shows through, just darker and bluer, mottled
 * deeper in places and flecked. Each basin sits a step lower: its shore is
 * dithered into the highlands, shadowed along the top and left and lit along
 * the bottom and right. Returns the mask (1 = mare) for the craters and minimap.
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
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      const i = (y * W + x) * 4;
      const upper = !at(x, y - 1) || !at(x - 1, y) || !at(x, y - 2) || !at(x - 2, y);
      const lower = !at(x, y + 1) || !at(x + 1, y) || !at(x, y + 2) || !at(x + 2, y);
      const shore = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
      let k: number;
      if (shore) {
        // the very edge: half its pixels still highland, half a step down
        if ((x + y) & 1) continue;
        k = upper ? 0.88 : 0.95;
      } else if (upper) k = 0.8;
      else if (lower) k = 0.93;
      else {
        // the basin floor, deeper in patches, with the odd pale or dark fleck
        const deep = noise((x + 2000) / 38, (y + 1000) / 38) + (bayer(x, y) - 0.5) * 0.08 > 0.58;
        const f = hash(x, y, 41);
        k = f > 0.994 ? 0.94 : f < 0.004 ? 0.72 : deep ? 0.81 : 0.86;
      }
      tint(p, i, k, 1.07);
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
  if (hash(tx, ty, 5) > 0.84) {
    // pebble
    const x = x0 + 3 + Math.floor(hash(tx, ty, 6) * 9);
    const y = y0 + 3 + Math.floor(hash(tx, ty, 7) * 9);
    rect(ctx, "#7f7690", x, y + 1, 3, 2);
    rect(ctx, "#cdc6db", x, y, 2, 1);
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
function flagstonePath(ctx: Ctx, ax: number, ay: number, bx: number, by: number, broken = false, wide?: number) {
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const px = -uy;
  const py = ux;
  // every path gets its own pattern, from where it starts
  const seed = Math.floor(hash(Math.round(ax), Math.round(ay), 11) * 9973);
  const r = (i: number, k: number) => hash(seed + i, k, 5);
  // its width: a walk, a broad walk or a wide way, then swelling and narrowing along the way
  const base = wide ?? [6, 7, 8, 9, 11][Math.floor(r(0, 30) * 5)];
  const halfAt = (t: number) => Math.max(5, base + Math.round((noise(t / 22 + seed, seed * 0.37) - 0.5) * 6));
  // the packed band, with gravel
  for (let t = 0; t <= len; t += 1) {
    const half = halfAt(t);
    const x = ax + ux * t;
    const y = ay + uy * t;
    for (let w = -half; w <= half; w++) {
      const gx = Math.round(x + px * w);
      const gy = Math.round(y + py * w);
      const g = hash(gx, gy, seed % 97);
      // (a broken road is just a packed-dirt track: tidy, a shade darker than the ground)
      const c = broken
        ? Math.abs(w) === half ? "#968ea8" : g < 0.04 ? "#938ba5" : "#a098b0"
        : Math.abs(w) === half ? "#978c93" : g > 0.93 ? "#b3a9ae" : g < 0.06 ? "#8e848a" : "#a4999f";
      rect(ctx, c, gx, gy, 1, 1);
    }
    // a pebble kicked just off the edge now and then
    if (!broken && r(t, 21) > 0.94) {
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
      if (r(k, 2) < (broken ? 0.85 : 0.07)) return; // missing (most of them, on a broken road)
      const w = big ? 7 + Math.floor(r(k, 3) * 3) : 4 + Math.floor(r(k, 3) * 3);
      const h = big ? 5 : 3 + Math.floor(r(k, 4) * 2);
      // staggered rows, a little off true
      const along = t + (n % 2 ? 3 : 0) + (r(k, 5) - 0.5) * 2;
      const across = side + (r(k, 6) - 0.5) * 2;
      const x = Math.round(ax + ux * along + px * across - w / 2);
      const y = Math.round(ay + uy * along + py * across - h / 2);
      // broken roads: what's left is cracked or sunken, with chips of stone around
      stone(ctx, x, y, w, h, r(k, 7), broken ? r(k, 8) * 0.12 + (r(k, 9) > 0.5 ? 0.9 : 0) : r(k, 8));

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
      // (a soft marble, a step lighter than the ground, not glaring white)
      let c = hash(course, slab, 5) > 0.5 ? "#cec7d8" : "#c6bfd1";
      if (hash(course, slab, 6) > 0.85) c = "#d7d1e0";
      if (seamR || seamA) c = "#9a92ab";
      else if (d % 9 < 2) c = "#dcd7e5";
      // inlays: one gold band round the rim, one round the fountain court
      const ray = Math.abs(Math.cos((8 * a) / 2));
      const ray2 = Math.abs(Math.cos((8 * (a + Math.PI / 8)) / 2));
      if (d > R - 3) c = "#6a637b";
      else if (d > R - 8 && d <= R - 6.5) c = "#c99a3e";
      else if (d > R - 6.5 && d <= R - 3) c = "#857d93";
      else if (d > 66 && d < R - 12 && ray > 0.994) c = "#bcb4c8";
      else if (d > 74 && d < R - 14 && ray2 > 0.997) c = "#c0b9cc";
      else if (d <= 63 && d > 60) c = "#857d93";
      if (d <= 60) {
        // the fountain court: a star of cream on grey
        const star = Math.abs(Math.cos((16 * a) / 2));
        c = d > 58 ? "#c99a3e" : star > 0.93 && d > 34 ? "#d3cddd" : hash(Math.floor(x / 5), Math.floor(y / 5), 7) > 0.5 ? "#bbb4c8" : "#c2bbce";
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
        rect(ctx, rim ? (upper ? "#7f7690" : "#c6bfd4") : upper ? "#908aa6" : "#9c95b0", cx + x, cy + y, 1, 1);
      }
    }
  }
}

/**
 * Signs of life out on the open ground: old rover tracks looping across the
 * crater (half buried by dust in places), trails of boot prints, and pebbles
 * kicked into little clusters. All pressed into the ground, never in town.
 */
function wear(ctx: Ctx, rnd: Phaser.Math.RandomDataGenerator) {
  const W = WORLD_W;
  const H = WORLD_H;
  const img = ctx.getImageData(0, 0, W, H);
  const p = img.data;
  // (each pixel is pressed only once, so crossings don't pile up darker)
  const done = new Uint8Array(W * H);
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && p[(y * W + x) * 4 + 3] > 0 && townDist(x, y) > 10;
  const shade = (fx: number, fy: number, k: number) => {
    const x = Math.round(fx);
    const y = Math.round(fy);
    if (!open(x, y) || done[y * W + x]) return;
    done[y * W + x] = 1;
    tint(p, (y * W + x) * 4, k);
  };

  // Rover tracks: two ruts on a lazy curve, with tread marks, fading at the ends.
  for (let n = 0, made = 0; n < 60 && made < 4; n++) {
    const a = { x: rnd.between(80, W - 80), y: rnd.between(80, H - 80) };
    const ang = rnd.frac() * Math.PI * 2;
    const len = rnd.between(280, 560);
    const b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len * 0.8 };
    if (!open(a.x, a.y) || !open(Math.round(b.x), Math.round(b.y))) continue;
    made++;
    const bend = (rnd.frac() - 0.5) * len * 0.9;
    const c = { x: (a.x + b.x) / 2 - Math.sin(ang) * bend, y: (a.y + b.y) / 2 + Math.cos(ang) * bend };
    const steps = Math.ceil(len * 1.3);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // faded where dust has blown over, and toward the ends
      if (noise(s / 45 + n * 7, n) < 0.3 || hash(s, n, 9) > Math.min(1, t * 8, (1 - t) * 8)) continue;
      const x = (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x;
      const y = (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y;
      const dx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
      const dy = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
      const l = Math.hypot(dx, dy) || 1;
      const [px, py] = [-dy / l, dx / l];
      for (const side of [-4, 3]) {
        shade(x + px * side, y + py * side, 0.9);
        shade(x + px * (side + 1), y + py * (side + 1), s % 3 === 0 ? 0.82 : 0.93);
      }
    }
  }

  // Boot prints: a wandering trail of little dents, shadowed at the top and lit below.
  for (let n = 0, made = 0; n < 60 && made < 6; n++) {
    let x = rnd.between(80, W - 80);
    let y = rnd.between(80, H - 80);
    if (!open(x, y) || townDist(x, y) < 30) continue;
    made++;
    let ang = rnd.frac() * Math.PI * 2;
    for (let s = 0; s < 28; s++) {
      ang += (rnd.frac() - 0.5) * 0.35;
      x += Math.cos(ang) * 6;
      y += Math.sin(ang) * 5;
      const side = s % 2 ? 2 : -2;
      const fx = x - Math.sin(ang) * side;
      const fy = y + Math.cos(ang) * side;
      for (const ox of [0, 1]) {
        shade(fx + ox, fy, 0.8);
        shade(fx + ox, fy + 1, 0.87);
        shade(fx + ox, fy + 2, 1.07);
      }
    }
  }

  // Pebble clusters: lit on top, each with a little shadow.
  for (let n = 0; n < 160; n++) {
    const cx = rnd.between(40, W - 40);
    const cy = rnd.between(40, H - 40);
    if (!open(cx, cy)) continue;
    for (let k = rnd.between(2, 5); k > 0; k--) {
      const x = cx + rnd.between(-8, 8);
      const y = cy + rnd.between(-5, 5);
      const w = rnd.between(1, 3);
      for (let i = 0; i < w; i++) {
        shade(x + i, y, 1.18);
        shade(x + i, y + 1, 0.96);
        shade(x + i + 1, y + 2, 0.74);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
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
  mottle(ctx);
  const mare = maria(ctx, rnd);
  craters(ctx, rnd, mare);
  wear(ctx, rnd);
  // Trim to the crater floor's true (curved) edge, pixel by pixel.
  const img = ctx.getImageData(0, 0, WORLD_W, WORLD_H);
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) if (!inIsland((x + 0.5) / TILE, (y + 0.5) / TILE)) img.data[(y * WORLD_W + x) * 4 + 3] = 0;
  ctx.putImageData(img, 0, 0);

  // (Main Street and every building's path are drawn on their own layer: see drawStreet.)
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
/** Main Street (broad, three rows of flagstones) and the spur down to your ship. */
export function drawStreet(ctx: Ctx, broken = false) {
  flagstonePath(ctx, STREET.x0, STREET.y, STREET.x1, STREET.y, broken, 14);
  flagstonePath(ctx, LANDING.x, STREET.y, LANDING.x, LANDING.y + 12, broken, 7);
}

export function drawBuildingPath(ctx: Ctx, b: BuildingId, broken = false) {
  const pts = pathPoints(b);
  for (let i = 0; i < pts.length - 1; i++) flagstonePath(ctx, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, broken);
}

// ---------------------------------------------------------------- the crater and beyond

/** How far past the world's edge the view can go (the crater wall, the plains, the curve). */
export const OUTER = 320;

// The Moon's surface outside the crater, darkest to lightest (FLAT matches the floor).
const RAMP_HEX = ["#4b465e", "#605a76", "#7a7390", "#938da8", "#a9a1b9", "#beb8cc", "#d1ccdb"];
const RAMP = RAMP_HEX.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
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
        const col = rim ? (yy < 0 ? RAMP_HEX[1] : RAMP_HEX[5]) : yy < 0 ? RAMP_HEX[2] : RAMP_HEX[3];
        rect(ctx, col, x + xx, y + yy, 1, 1);
      }
  }
  for (let n = 0; n < 260; n++) {
    const x = rnd.between(0, W - 1);
    const y = rnd.between(0, H - 1);
    const { d } = outside(x - OUTER, y - OUTER);
    if (d < 14 || d > 60 || Math.hypot((x - cx) / LX, (y - cy) / LY) > 0.95) continue;
    const w = rnd.between(2, 4);
    rect(ctx, RAMP_HEX[0], x, y + 1, w + 1, 2);
    rect(ctx, RAMP_HEX[3], x, y, w, 2);
    rect(ctx, RAMP_HEX[6], x, y, Math.max(1, w - 1), 1);
  }
  tex.refresh();
}
