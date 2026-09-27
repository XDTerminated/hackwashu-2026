// The town's landmarks and the things you find around the crater, drawn at
// native size in the same outlined pixel style as everything else.
//   Town Hall: the old colony's dome. Ruined (a bent frame, glass everywhere),
//     repaired (a whole dome on its ring), grand (side modules, solar wings,
//     a beacon on the mast). 124 x 136.
//   Market: a collapsed cart, a striped-awning stall, then a little shop. 76 x 80.
//   Harvest spots: ice crystals, a scrap pile, shimmering helium-3 dust, a
//     glowing ore crater. And the mound where a story item waits to be dug up.

import { type Ctx, INK as O, disc, hash, rect } from "./pix";

const METAL = { base: "#8e97a8", dark: "#5e6678", light: "#c3cad6" };
const GLASS = { base: "#7fc0dc", dark: "#4f8fb4", light: "#c8ecf6", line: "#e8f7fb" };
const WARM = "#ffe7a0";

/** Is (x, y) inside the dome's half-ellipse (center cx, base y0, radii rx, ry)? */
const inDome = (x: number, y: number, cx: number, y0: number, rx: number, ry: number) => y <= y0 && ((x - cx) / rx) ** 2 + ((y - y0) / ry) ** 2 <= 1;

/** A glass dome with panel lines, pixel by pixel. `keep` decides which pixels survive (for the ruin). */
function dome(ctx: Ctx, cx: number, y0: number, rx: number, ry: number, keep: (x: number, y: number) => boolean = () => true) {
  for (let y = Math.floor(y0 - ry - 1); y <= y0; y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const inside = inDome(x, y, cx, y0, rx, ry);
      const edge = !inside && (inDome(x - 1, y, cx, y0, rx, ry) || inDome(x + 1, y, cx, y0, rx, ry) || inDome(x, y + 1, cx, y0, rx, ry));
      if (!keep(x, y)) continue;
      if (edge) rect(ctx, O, x, y, 1, 1);
      if (!inside) continue;
      const u = (x - cx) / rx;
      const v = (y0 - y) / ry;
      // panel lines: rings of latitude and a few meridians
      const ring = Math.abs(((v * 5) % 1) - 0.5) > 0.44;
      const mer = Math.abs(((Math.asin(Math.max(-1, Math.min(1, u / Math.sqrt(Math.max(0.05, 1 - v * v))))) / Math.PI) * 6 + 3) % 1 - 0.5) > 0.44;
      let c = GLASS.base;
      if (u < -0.35 && v > 0.35) c = GLASS.light;
      else if (u > 0.45 || v < 0.12) c = GLASS.dark;
      if (ring || mer) c = GLASS.line;
      rect(ctx, c, x, y, 1, 1);
    }
}

/** The metal ring the dome sits on. */
function baseRing(ctx: Ctx, x0: number, x1: number, y: number, cracked = false) {
  rect(ctx, O, x0 - 1, y - 1, x1 - x0 + 2, 14);
  rect(ctx, METAL.base, x0, y, x1 - x0, 12);
  rect(ctx, METAL.light, x0, y, x1 - x0, 2);
  rect(ctx, METAL.dark, x0, y + 10, x1 - x0, 2);
  for (let x = x0 + 4; x < x1 - 2; x += 8) rect(ctx, METAL.dark, x, y + 5, 1, 1);
  if (cracked)
    for (const cx of [x0 + 14, x0 + 47, x1 - 20]) {
      rect(ctx, O, cx, y, 2, 12);
      rect(ctx, "#6f6886", cx + 2, y + 4, 3, 2);
    }
}

function door(ctx: Ctx, cx: number, y: number, lit: boolean) {
  rect(ctx, O, cx - 11, y - 26, 22, 26);
  rect(ctx, METAL.dark, cx - 10, y - 25, 20, 25);
  rect(ctx, lit ? "#ffd98a" : "#3b3a4a", cx - 7, y - 22, 14, 22);
  if (lit) rect(ctx, "#fff2c8", cx - 7, y - 22, 14, 3);
  rect(ctx, METAL.light, cx - 10, y - 25, 20, 1);
}

export function drawTownHall(ctx: Ctx, stage: number) {
  const cx = 62;
  const base = 122;
  if (stage === 0) {
    // the old frame: half a dome, bent struts, glass on the ground
    dome(ctx, cx, base - 12, 44, 56, (x, y) => x < cx + 6 - (base - 12 - y) * 0.5 && y > base - 12 - 44 + hash(x, 3, 7) * 10);
    for (let i = 0; i < 4; i++) rect(ctx, METAL.dark, cx + 10 + i * 7, base - 30 - i * 5, 2, 18 + i * 4);
    baseRing(ctx, 18, 106, base - 12, true);
    for (let i = 0; i < 9; i++) {
      const x = 10 + Math.floor(hash(i, 1, 9) * 100);
      const y = base - 4 + Math.floor(hash(i, 2, 9) * 4);
      rect(ctx, O, x - 1, y - 1, 6, 4);
      rect(ctx, i % 3 ? GLASS.light : METAL.base, x, y, 4, 2);
    }
    // the antenna, fallen over
    rect(ctx, O, 70, base - 4, 40, 3);
    rect(ctx, METAL.light, 71, base - 3, 38, 1);
    disc(ctx, "#6f6886", 110, base - 3, 2.5);
    return;
  }
  // Each level adds to it (6 is grand): a side module each side, a solar wing,
  // a flag, a taller mast, more lit windows, and at last a gold plaque and beacon.
  const level = stage;
  const grand = level >= 6;
  for (const [x0, flip, from] of [[2, 1, 2], [98, -1, 3]] as const) {
    if (level < from) continue;
    rect(ctx, O, x0, base - 34, 24, 34);
    rect(ctx, METAL.base, x0 + 1, base - 33, 22, 32);
    rect(ctx, METAL.light, x0 + 1, base - 33, 22, 2);
    rect(ctx, METAL.dark, x0 + (flip > 0 ? 1 : 21), base - 33, 2, 32);
    disc(ctx, O, x0 + 12, base - 18, 5);
    disc(ctx, WARM, x0 + 12, base - 18, 4);
    disc(ctx, "#fff6d8", x0 + 11, base - 19, 1.5);
  }
  if (level >= 4) {
    // solar wing (left)
    rect(ctx, O, 12, base - 58, 2, 26);
    rect(ctx, O, 0, base - 66, 28, 12);
    for (let i = 0; i < 4; i++) rect(ctx, i % 2 ? "#3f5aa0" : "#4f6fb8", 1 + i * 7, base - 65, 6, 10);
    rect(ctx, "#8fb0f0", 1, base - 65, 26, 1);
  }
  if (level >= 5) {
    // flag (right)
    rect(ctx, O, 112, base - 60, 2, 28);
    rect(ctx, O, 113, base - 60, 11, 8);
    rect(ctx, "#e0708a", 114, base - 59, 9, 6);
    rect(ctx, "#f5c542", 117, base - 57, 2, 2);
  }
  dome(ctx, cx, base - 12, 44, 58);
  // lights inside the dome: more with every level
  const lights = [[52, 88], [72, 90], [62, 70], [44, 80], [80, 82], [54, 95], [72, 96], [62, 86]].slice(0, Math.min(8, 1 + level + (grand ? 2 : 0)));
  for (const [x, y] of lights) rect(ctx, WARM, x, y, 2, 2);
  baseRing(ctx, 18, 106, base - 12);
  door(ctx, cx, base, true);
  // a plaque over the door (gold when grand), with a pip per level
  rect(ctx, O, cx - 9, base - 37, 18, 6);
  rect(ctx, grand ? "#f5c542" : METAL.light, cx - 8, base - 36, 16, 4);
  if (!grand) for (let i = 0; i < level; i++) rect(ctx, "#6f6886", cx - 7 + i * 3, base - 35, 2, 2);
  // the mast on top grows with each level (the beacon glows as a flourish when it's grand)
  const top = 38 - (level - 1) * 3;
  rect(ctx, O, cx - 1, top, 3, base - 70 - top);
  rect(ctx, METAL.light, cx, top, 1, base - 70 - top);
  disc(ctx, O, cx + 0.5, top, 3);
  disc(ctx, grand ? "#ff5a4a" : "#9aa2b4", cx + 0.5, top, 2);
  for (let i = 0; i < Math.floor(level / 2); i++) rect(ctx, O, cx - 5, top + 10 + i * 8, 11, 1);
}

// ---------------------------------------------------------------- the Market

const WOOD = { base: "#b8733a", dark: "#8a4b1f", light: "#d9a06a" };
const STRIPE = ["#e0708a", "#fff6e6"];

function awning(ctx: Ctx, x0: number, x1: number, y: number, h: number, scallop: boolean) {
  rect(ctx, O, x0 - 1, y - 1, x1 - x0 + 2, h + 2);
  for (let x = x0; x < x1; x++) rect(ctx, STRIPE[Math.floor((x - x0) / 6) % 2], x, y, 1, h);
  rect(ctx, "#b44f6c", x0, y + h - 1, x1 - x0, 1);
  if (scallop)
    for (let x = x0; x < x1; x += 6) {
      rect(ctx, O, x, y + h, 6, 2);
      rect(ctx, STRIPE[Math.floor((x - x0) / 6) % 2], x + 1, y + h, 4, 1);
    }
}

function goods(ctx: Ctx, x: number, y: number, n: number) {
  const cols = ["#f5c542", "#e0708a", "#5fb58a", "#8fd0f0", "#b7a4f0", "#ffb347"];
  for (let i = 0; i < n; i++) {
    rect(ctx, O, x + i * 6, y, 5, 4);
    rect(ctx, cols[i % cols.length], x + i * 6 + 1, y + 1, 3, 2);
  }
}

function crate(ctx: Ctx, x: number, y: number, w: number, h: number) {
  rect(ctx, O, x, y, w, h);
  rect(ctx, WOOD.base, x + 1, y + 1, w - 2, h - 2);
  rect(ctx, WOOD.dark, x + 1, y + Math.floor(h / 2), w - 2, 1);
  rect(ctx, WOOD.light, x + 1, y + 1, w - 2, 1);
}

export function drawMarket(ctx: Ctx, stage: number) {
  const base = 78;
  if (stage === 0) {
    // a collapsed cart: a tilted bed, a broken wheel, the awning torn and draped
    for (let i = 0; i < 40; i++) rect(ctx, O, 14 + i, base - 20 + Math.round(i * 0.25), 1, 9);
    for (let i = 0; i < 38; i++) rect(ctx, i % 9 === 0 ? WOOD.dark : WOOD.base, 15 + i, base - 19 + Math.round(i * 0.25), 1, 7);
    disc(ctx, O, 22, base - 8, 7.5);
    disc(ctx, WOOD.dark, 22, base - 8, 6.5);
    disc(ctx, "#6f6886", 22, base - 8, 4.5);
    rect(ctx, WOOD.base, 16, base - 9, 12, 2);
    for (let i = 0; i < 18; i++) rect(ctx, STRIPE[Math.floor(i / 5) % 2], 36 + i, base - 26 + Math.round(Math.sin(i / 3) * 2), 1, 5);
    crate(ctx, 50, base - 11, 12, 11);
    rect(ctx, O, 58, base - 30, 2, 20);
    return;
  }
  const shop = stage === 2;
  // posts and counter
  for (const x of [8, 66]) {
    rect(ctx, O, x, base - 50, 4, 50);
    rect(ctx, WOOD.base, x + 1, base - 49, 2, 49);
  }
  if (shop) {
    // a back wall of planks, and a roof with a sign board
    rect(ctx, O, 10, base - 48, 58, 30);
    for (let y = base - 47; y < base - 19; y++) rect(ctx, (y - base) % 6 === 0 ? WOOD.dark : "#c98f5a", 11, y, 56, 1);
    rect(ctx, O, 20, 2, 38, 14);
    rect(ctx, WOOD.base, 21, 3, 36, 12);
    rect(ctx, WOOD.light, 21, 3, 36, 1);
    // a gold star on the sign
    rect(ctx, "#f5c542", 37, 6, 4, 6);
    rect(ctx, "#f5c542", 35, 8, 8, 2);
    rect(ctx, O, 38, 16, 2, 6);
  }
  awning(ctx, 4, 74, base - 56, 10, shop);
  rect(ctx, O, 6, base - 22, 66, 22);
  rect(ctx, WOOD.base, 7, base - 21, 64, 20);
  rect(ctx, WOOD.light, 7, base - 21, 64, 2);
  for (let x = 12; x < 70; x += 10) rect(ctx, WOOD.dark, x, base - 18, 1, 16);
  goods(ctx, 14, base - 27, shop ? 9 : 4);
  if (shop) {
    crate(ctx, 0, base - 12, 12, 12);
    crate(ctx, 64, base - 14, 12, 14);
    goods(ctx, 1, base - 16, 2);
    // lanterns hanging from the awning (they glow as a flourish)
    for (const x of [10, 64]) {
      rect(ctx, O, x, base - 45, 5, 7);
      rect(ctx, WARM, x + 1, base - 44, 3, 5);
    }
  }
}

// ---------------------------------------------------------------- harvest spots

export function drawIceNode(ctx: Ctx) {
  const crystal = (x: number, h: number, w: number) => {
    for (let y = 0; y < h; y++) {
      const half = Math.max(0.5, (w / 2) * Math.min(1, (h - y) / (h * 0.35)));
      const x0 = Math.round(x - half);
      const x1 = Math.round(x + half);
      rect(ctx, O, x0 - 1, 20 - h + y, x1 - x0 + 2, 1);
      rect(ctx, "#8fd0f0", x0, 20 - h + y, x1 - x0, 1);
      rect(ctx, "#d8f4ff", x0, 20 - h + y, 1, 1);
      rect(ctx, "#5aa0c8", x1 - 1, 20 - h + y, 1, 1);
    }
  };
  crystal(6, 12, 6);
  crystal(14, 16, 7);
  crystal(10, 18, 6);
  rect(ctx, O, 1, 19, 18, 2);
  rect(ctx, "#6f6886", 2, 19, 16, 1);
}

export function drawScrapNode(ctx: Ctx) {
  // a pile of old hull plates and a bent pipe
  const plate = (x: number, y: number, w: number, h: number, c: string) => {
    rect(ctx, O, x - 1, y - 1, w + 2, h + 2);
    rect(ctx, c, x, y, w, h);
    rect(ctx, METAL.light, x, y, w, 1);
  };
  plate(2, 8, 10, 5, METAL.base);
  plate(9, 5, 11, 6, "#a0583a");
  plate(5, 3, 7, 4, METAL.dark);
  rect(ctx, O, 14, 1, 3, 9);
  rect(ctx, METAL.light, 15, 1, 1, 8);
  rect(ctx, O, 14, 1, 7, 3);
  rect(ctx, METAL.light, 15, 2, 5, 1);
  for (const [x, y] of [[4, 9], [12, 7], [7, 4]]) rect(ctx, "#3b3a4a", x, y, 1, 1);
}

export function drawHeliumNode(ctx: Ctx, f: number) {
  const blobs = [[7, 7, 6, 2.6], [15, 6, 6, 3], [11, 8, 9, 2]] as const;
  for (const [x, y, rx, ry] of blobs) disc(ctx, "#4f8f86", x, y + 0.6, rx + 1, ry + 1);
  for (const [x, y, rx, ry] of blobs) disc(ctx, "#a8e8d0", x, y, rx, ry);
  for (const [x, y, rx, ry] of blobs) disc(ctx, "#e4fff4", x - 1, y - 1, rx * 0.45, ry * 0.4);
  const glints = f ? [[5, 5], [17, 4], [12, 8]] : [[9, 4], [14, 7], [3, 7]];
  for (const [x, y] of glints) rect(ctx, "#ffffff", x, y, 1, 1);
}

export function drawOreNode(ctx: Ctx) {
  disc(ctx, O, 10, 8, 9.5, 4.5);
  disc(ctx, "#6f6886", 10, 8, 8.5, 3.6);
  disc(ctx, "#4f4a63", 10, 8.6, 6.5, 2.6);
  for (const [x, y] of [[6, 7], [11, 6], [14, 8], [9, 9]]) {
    rect(ctx, O, x - 1, y - 1, 4, 3);
    rect(ctx, "#ffb347", x, y, 2, 1);
    rect(ctx, "#ffe7a0", x, y, 1, 1);
  }
}

/** A mound of turned-up dirt where something's buried (it sparkles as a flourish). */
export function drawDigSpot(ctx: Ctx, f: number) {
  disc(ctx, O, 8, 7, 7.5, 3.5);
  disc(ctx, "#8a8199", 8, 7, 6.5, 2.6);
  disc(ctx, "#b3abc2", 7, 6, 4, 1.6);
  const glint = f ? [4, 4] : [11, 5];
  rect(ctx, "#fff6c8", glint[0] - 1, glint[1], 3, 1);
  rect(ctx, "#fff6c8", glint[0], glint[1] - 1, 1, 3);
}
