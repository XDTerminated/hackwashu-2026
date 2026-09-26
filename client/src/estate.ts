// The grand estates: every villager's home (and the colony's civic buildings)
// drawn big — Stardew charm at manor scale, with a Moon twist. Native size,
// 1 art pixel = 1 pixel, like everything else.

import { STONE, TRIM, WOOD, door, planks, shingles, stoneBase, win } from "./buildings";
import { type Ctx, WOOD_INK as O, box, disc, hash, rect } from "./pix";

type Tone = { base: string; dark: string; light: string };

const GOLD = "#f5c542";
const GOLD_DARK = "#c99a3e";
const GOLD_LIGHT = "#fff1b0";
const GLASS = "#ffd98a";
const GLASS_HI = "#fff3c4";
const PLASTER = "#f2e6cc";
const RED_ROOF: Tone = { base: "#c4553f", dark: "#8e3a2d", light: "#e07a5a" };
const BLUE_ROOF: Tone = { base: "#4f6fb0", dark: "#34508a", light: "#7390cc" };
const TEAL_ROOF: Tone = { base: "#3f8a7a", dark: "#2c6a5c", light: "#5fb5a0" };
const COPPER: Tone = { base: "#4f8a5a", dark: "#35663f", light: "#74b07a" };
const PURPLE: Tone = { base: "#7e5fb8", dark: "#5f4596", light: "#9d80d6" };
const GOLD_ROOF: Tone = { base: "#c99a3e", dark: "#8f6a26", light: "#e6c070" };
const CREAM: Tone = { base: "#e8c89a", dark: "#c9a06a", light: "#f5dcb0" };
const BRICK = { base: "#a8503a", dark: "#7a3426", light: "#c26a4e" };

// ---------------------------------------------------------------- parts

function plaster(ctx: Ctx, x: number, y: number, w: number, h: number, fill = PLASTER) {
  rect(ctx, O, x, y, w, h);
  rect(ctx, fill, x + 1, y + 1, w - 2, h - 1);
}

function bricks(ctx: Ctx, x: number, y: number, w: number, h: number) {
  rect(ctx, O, x, y, w, h);
  rect(ctx, BRICK.base, x + 1, y + 1, w - 2, h - 1);
  for (let by = y + 1, row = 0; by < y + h; by += 4, row++) {
    rect(ctx, BRICK.light, x + 1, by, w - 2, 1);
    if (by + 3 < y + h) rect(ctx, BRICK.dark, x + 1, by + 3, w - 2, 1);
    for (let bx = x + 1 + (row % 2 ? 4 : 0); bx < x + w - 1; bx += 8) rect(ctx, BRICK.dark, bx, by, 1, 3);
  }
}

function stoneWall(ctx: Ctx, x: number, y: number, w: number, h: number) {
  rect(ctx, O, x, y, w, h);
  rect(ctx, STONE.base, x + 1, y + 1, w - 2, h - 1);
  for (let by = y + 1, row = 0; by < y + h; by += 5, row++) {
    rect(ctx, STONE.light, x + 1, by, w - 2, 1);
    if (by + 4 < y + h) rect(ctx, STONE.dark, x + 1, by + 4, w - 2, 1);
    for (let bx = x + 1 + (row % 2 ? 5 : 0); bx < x + w - 1; bx += 10) rect(ctx, STONE.dark, bx, by, 1, 4);
  }
}

/** A classical column, `h` tall, 5 wide. */
function column(ctx: Ctx, x: number, top: number, h: number) {
  rect(ctx, O, x, top + 3, 5, h - 6);
  rect(ctx, "#efe0c0", x + 1, top + 3, 3, h - 6);
  rect(ctx, "#fff6e6", x + 1, top + 3, 1, h - 6);
  rect(ctx, "#d2c09a", x + 3, top + 3, 1, h - 6);
  for (const y of [top, top + h - 3]) {
    rect(ctx, O, x - 1, y, 7, 3);
    rect(ctx, "#fff6e6", x, y + 1, 5, 1);
  }
}

/** A window with a round top. `w` even. */
function archWindow(ctx: Ctx, x: number, y: number, w: number, h: number, frame = TRIM, glass = GLASS) {
  const r = w / 2;
  const cx = x + r;
  disc(ctx, O, cx, y + r, r, r, y + r);
  rect(ctx, O, x, y + r, w, h - r);
  disc(ctx, frame, cx, y + r, r - 1, r - 1, y + r);
  rect(ctx, frame, x + 1, y + r, w - 2, h - r - 1);
  disc(ctx, glass, cx, y + r, r - 2, r - 2, y + r);
  rect(ctx, glass, x + 2, y + r, w - 4, h - r - 2);
  rect(ctx, GLASS_HI, x + 2, y + r - 1, Math.max(1, Math.floor((w - 4) / 2)), Math.max(2, Math.floor((h - r) / 2)));
  rect(ctx, frame, Math.floor(cx) - (w % 4 === 0 ? 0 : 0), y + 2, 1, h - 3);
  rect(ctx, frame, x + 1, y + r + Math.floor((h - r) / 2), w - 2, 1);
}

function roundWindow(ctx: Ctx, cx: number, cy: number, r: number, frame = TRIM) {
  disc(ctx, O, cx, cy, r + 1);
  disc(ctx, frame, cx, cy, r);
  disc(ctx, GLASS, cx, cy, r - 1.2);
  disc(ctx, GLASS_HI, cx - r * 0.3, cy - r * 0.3, r * 0.35);
  rect(ctx, frame, cx - 0.5, cy - r, 1, r * 2);
  rect(ctx, frame, cx - r, cy - 0.5, r * 2, 1);
}

/** A dome sitting on `baseY`, with ribs and a gold band. */
function dome(ctx: Ctx, cx: number, baseY: number, rx: number, ry: number, c: Tone, ribs = [-0.6, 0, 0.6]) {
  disc(ctx, O, cx, baseY, rx + 1, ry + 1, baseY);
  disc(ctx, c.base, cx, baseY, rx, ry, baseY);
  disc(ctx, c.light, cx - rx * 0.4, baseY - ry * 0.5, rx * 0.3, ry * 0.3);
  for (const k of ribs) {
    for (let y = Math.ceil(baseY - ry + 1); y < baseY; y++) {
      const half = rx * Math.sqrt(Math.max(0, 1 - ((baseY - y) / ry) ** 2));
      rect(ctx, c.dark, Math.round(cx + k * half - 0.5), y, 1, 1);
    }
  }
  rect(ctx, O, cx - rx - 2, baseY, rx * 2 + 4, 2);
  rect(ctx, GOLD, cx - rx - 1, baseY, rx * 2 + 2, 1);
}

function finial(ctx: Ctx, cx: number, top: number, h: number) {
  rect(ctx, O, cx - 1, top, 2, h);
  disc(ctx, O, cx, top + 2, 2.5);
  disc(ctx, GOLD, cx, top + 2, 1.6);
  rect(ctx, GOLD_LIGHT, cx - 1, top + 1, 1, 1);
}

function pennant(ctx: Ctx, x: number, y: number, color: string, len = 8) {
  rect(ctx, O, x, y, 1, 12);
  for (let i = 0; i < 4; i++) {
    const w = Math.round(len * (1 - i / 4));
    rect(ctx, O, x + 1, y + i, w + 1, 1);
    rect(ctx, color, x + 1, y + i, w, 1);
  }
  rect(ctx, O, x + 1, y + 4, 2, 1);
}

function banner(ctx: Ctx, x: number, y: number, h: number, color: string, emblem = GOLD) {
  rect(ctx, O, x - 1, y - 1, 9, 2);
  rect(ctx, GOLD, x, y - 1, 7, 1);
  rect(ctx, O, x, y, 7, h);
  rect(ctx, color, x + 1, y, 5, h - 3);
  rect(ctx, emblem, x + 3, y + 2, 1, 4);
  rect(ctx, emblem, x + 2, y + 3, 3, 1);
  rect(ctx, color, x + 1, y + h - 3, 2, 2);
  rect(ctx, color, x + 4, y + h - 3, 2, 2);
  rect(ctx, O, x + 3, y + h - 3, 1, 3);
}

function chimney(ctx: Ctx, x: number, top: number, h: number) {
  rect(ctx, O, x, top, 9, h);
  rect(ctx, STONE.base, x + 1, top + 1, 7, h - 1);
  rect(ctx, STONE.light, x + 1, top + 1, 7, 1);
  for (let y = top + 5; y < top + h; y += 5) rect(ctx, STONE.dark, x + 1, y, 7, 1);
  rect(ctx, O, x - 1, top - 1, 11, 2);
  rect(ctx, STONE.light, x, top - 1, 9, 1);
}

/** Wide front steps, `steps` high, ending on `bottom`. */
function stairs(ctx: Ctx, cx: number, bottom: number, w: number, steps: number) {
  for (let i = 0; i < steps; i++) {
    const sw = w - i * 4;
    const y = bottom - (i + 1) * 2;
    rect(ctx, O, cx - sw / 2, y, sw, 2);
    rect(ctx, STONE.light, cx - sw / 2 + 1, y, sw - 2, 1);
  }
}

function hedge(ctx: Ctx, x: number, y: number, w: number, seed: number) {
  for (let bx = x; bx < x + w; bx += 6) disc(ctx, O, bx + 3, y, 4.5, 3.5);
  for (let bx = x; bx < x + w; bx += 6) disc(ctx, "#4f9e54", bx + 3, y, 3.5, 2.5);
  for (let bx = x; bx < x + w; bx += 6) disc(ctx, "#6fbf6a", bx + 2, y - 1, 2, 1.2);
  for (let i = 0; i < w / 3; i++) {
    const fx = x + Math.floor(hash(i, seed, 1) * w);
    rect(ctx, ["#f07a9a", GOLD, "#cfe7ff", "#b7a4f0"][i % 4], fx, y - 2 + Math.floor(hash(i, seed, 2) * 3), 1, 1);
  }
}

/** A little brass-and-glass wall lamp by a door. */
function hangingLantern(ctx: Ctx, x: number, y: number) {
  rect(ctx, O, x + 1, y, 1, 2);
  rect(ctx, O, x - 1, y + 2, 5, 1);
  rect(ctx, O, x - 1, y + 3, 5, 6);
  rect(ctx, "#fff2b0", x, y + 4, 3, 4);
  rect(ctx, GOLD_LIGHT, x + 1, y + 4, 1, 4);
  rect(ctx, O, x, y + 9, 3, 1);
}

function balustrade(ctx: Ctx, x: number, y: number, w: number) {
  rect(ctx, O, x, y, w, 2);
  rect(ctx, TRIM, x, y, w, 1);
  for (let bx = x + 1; bx < x + w - 1; bx += 3) {
    rect(ctx, O, bx, y + 2, 2, 3);
    rect(ctx, TRIM, bx, y + 2, 1, 3);
  }
  rect(ctx, O, x, y + 5, w, 1);
}

/** Tall arched double door with a glowing fanlight. */
function grandDoor(ctx: Ctx, cx: number, bottom: number, w: number, h: number, color = "#6b4a3a") {
  const r = w / 2;
  const top = bottom - h;
  disc(ctx, O, cx, top + r + 1, r + 1, r + 1, top + r + 1);
  rect(ctx, O, cx - r - 1, top + r + 1, w + 2, h - r - 1);
  disc(ctx, TRIM, cx, top + r + 1, r, r, top + r + 1);
  disc(ctx, GLASS, cx, top + r + 1, r - 1, r - 1, top + r + 1);
  for (let i = -2; i <= 2; i++) rect(ctx, TRIM, Math.round(cx + i * r * 0.35 - 0.5), top + 3, 1, r - 1);
  rect(ctx, TRIM, cx - r, top + r + 1, w, 1);
  rect(ctx, color, cx - r + 1, top + r + 2, w - 2, h - r - 2);
  rect(ctx, O, cx - 0.5, top + r + 2, 1, h - r - 2);
  for (let x = cx - r + 3; x < cx + r - 1; x += 3) rect(ctx, "rgba(0,0,0,0.18)", x, top + r + 2, 1, h - r - 2);
  rect(ctx, GOLD, cx - 3, top + r + Math.floor((h - r) / 2), 1, 2);
  rect(ctx, GOLD, cx + 2, top + r + Math.floor((h - r) / 2), 1, 2);
}

function pediment(ctx: Ctx, cx: number, top: number, h: number, half: number, fill = "#efe0c0") {
  for (let i = 0; i < h; i++) {
    const hw = Math.round((half * (i + 1)) / h);
    rect(ctx, O, cx - hw - 1, top + i, hw * 2 + 2, 1);
    rect(ctx, i === 0 ? O : fill, cx - hw, top + i, hw * 2, 1);
  }
  rect(ctx, O, cx - half - 2, top + h, half * 2 + 4, 3);
  rect(ctx, "#fff6e6", cx - half - 1, top + h, half * 2 + 2, 1);
}

// ---------------------------------------------------------------- the estates

/** Your House: a manor with a round tower, gabled center, porch and balcony. 112 x 108. */
export function drawManor(ctx: Ctx) {
  chimney(ctx, 70, 3, 22);
  chimney(ctx, 12, 32, 20);
  // weathervane over the gable
  rect(ctx, O, 55, 0, 2, 9);
  rect(ctx, GOLD, 50, 2, 12, 1);
  rect(ctx, GOLD, 61, 1, 1, 3);
  rect(ctx, GOLD, 50, 1, 1, 3);
  shingles(ctx, 56, 9, 24, 2, 30, RED_ROOF);
  roundWindow(ctx, 56, 24, 4);
  // upper storey
  rect(ctx, O, 28, 35, 56, 26);
  planks(ctx, 29, 36, 54, 25, CREAM);
  for (const wx of [33, 52, 71]) win(ctx, wx, 39, 9, 9);
  balustrade(ctx, 26, 57, 60);
  // left wing
  shingles(ctx, 17, 46, 13, 7, 14, RED_ROOF);
  rect(ctx, O, 8, 48, 13, 5);
  rect(ctx, "#2f4f8f", 9, 49, 11, 3);
  rect(ctx, "#6f9fe8", 14, 49, 1, 3);
  rect(ctx, "#6f9fe8", 9, 50, 11, 1);
  rect(ctx, O, 2, 61, 28, 40);
  planks(ctx, 3, 62, 26, 39);
  win(ctx, 7, 70, 18, 13);
  hangingLantern(ctx, 14, 88);
  // round tower on the right
  rect(ctx, O, 84, 40, 24, 61);
  rect(ctx, PLASTER, 85, 41, 22, 60);
  for (let y = 41; y < 100; y += 6) {
    rect(ctx, STONE.base, 85, y, 3, 3);
    rect(ctx, STONE.base, 104, y, 3, 3);
    rect(ctx, STONE.dark, 85, y + 3, 3, 1);
    rect(ctx, STONE.dark, 104, y + 3, 3, 1);
  }
  archWindow(ctx, 91, 47, 10, 15);
  archWindow(ctx, 91, 71, 10, 15);
  shingles(ctx, 96, 12, 28, 1, 15, TEAL_ROOF);
  pennant(ctx, 95, 0, "#d97757");
  // porch
  shingles(ctx, 56, 65, 5, 29, 31, RED_ROOF);
  rect(ctx, O, 28, 72, 56, 29);
  planks(ctx, 29, 73, 54, 28);
  win(ctx, 32, 80, 11, 10);
  win(ctx, 69, 80, 11, 10);
  grandDoor(ctx, 56, 101, 14, 24);
  for (const x of [26, 44, 63, 81]) column(ctx, x, 72, 29);
  hangingLantern(ctx, 48, 73);
  hangingLantern(ctx, 62, 73);
  stoneBase(ctx, 1, 101, 110, 5);
  stairs(ctx, 56, 108, 26, 3);
  hedge(ctx, 3, 104, 36, 1);
  hedge(ctx, 73, 104, 36, 2);
}

/** The Jade Rabbit's Hollow: a great mossy hill under a blossoming tree. 112 x 96. */
export function drawHollow(ctx: Ctx) {
  // the tree grows up behind the hill
  rect(ctx, O, 73, 16, 9, 42);
  rect(ctx, "#8a5a3b", 74, 17, 7, 41);
  rect(ctx, "#a86f43", 74, 17, 2, 41);
  rect(ctx, O, 66, 24, 9, 3);
  rect(ctx, "#8a5a3b", 66, 25, 8, 1);
  rect(ctx, O, 81, 20, 10, 3);
  rect(ctx, "#8a5a3b", 82, 21, 8, 1);
  const lobes: [number, number, number, number][] = [
    [78, 16, 22, 13],
    [58, 20, 12, 9],
    [98, 21, 12, 9],
    [78, 4, 13, 5],
    [64, 8, 9, 6],
    [92, 8, 9, 6],
  ];
  for (const [x, y, rx, ry] of lobes) disc(ctx, O, x, y, rx + 1, ry + 1);
  for (const [x, y, rx, ry] of lobes) disc(ctx, "#3f7a36", x, y, rx, ry);
  for (const [x, y, rx, ry] of lobes) disc(ctx, "#5a9a44", x - 1, y - 1, rx - 2, ry - 2);
  for (const [x, y, rx, ry] of lobes) disc(ctx, "#7cbf55", x - 3, y - 3, rx * 0.4, ry * 0.35);
  for (let i = 0; i < 110; i++) {
    const x = 44 + Math.floor(hash(i, 1, 13) * 68);
    const y = Math.floor(hash(i, 2, 13) * 34);
    if (lobes.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 0.8)) rect(ctx, hash(i, 3, 13) < 0.5 ? GOLD : "#ffe08a", x, y, 1, 1);
  }
  // the hill
  disc(ctx, O, 56, 97, 55, 60, 94);
  disc(ctx, "#4f9e54", 56, 97, 54, 59, 93);
  disc(ctx, "#6fbf6a", 52, 95, 48, 54, 91);
  disc(ctx, "#94d886", 40, 58, 15, 9);
  for (let i = 0; i < 180; i++) {
    const x = 4 + Math.floor(hash(i, 4, 13) * 104);
    const y = 40 + Math.floor(hash(i, 5, 13) * 54);
    if (((x - 56) / 52) ** 2 + ((y - 97) / 57) ** 2 < 1) rect(ctx, hash(i, 6, 13) > 0.5 ? "#3f8a4a" : "#a8e89a", x, y, 1, 2);
    if (hash(i, 7, 13) > 0.93 && ((x - 56) / 50) ** 2 + ((y - 97) / 55) ** 2 < 1) rect(ctx, ["#f07a9a", GOLD, "#cfe7ff"][i % 3], x, y, 1, 1);
  }
  // stone chimney pipe
  rect(ctx, O, 22, 38, 7, 16);
  rect(ctx, STONE.base, 23, 39, 5, 15);
  rect(ctx, STONE.light, 23, 39, 5, 1);
  rect(ctx, O, 21, 37, 9, 2);
  // round windows with flower boxes
  for (const [cx, cy, r] of [[24, 72, 7], [89, 70, 7], [44, 55, 4]] as const) {
    roundWindow(ctx, cx, cy, r);
    if (r > 5) {
      box(ctx, "#8a5a3b", cx - 7, cy + r + 1, 14, 3, O);
      for (let fx = cx - 6; fx < cx + 7; fx += 2) rect(ctx, fx % 4 ? "#f07a9a" : GOLD, fx, cy + r, 1, 1);
    }
  }
  // the great round door in a stone arch
  disc(ctx, O, 56, 82, 17, 17, 94);
  disc(ctx, STONE.base, 56, 82, 16, 16, 94);
  for (let a = Math.PI; a <= Math.PI * 2 + 0.01; a += Math.PI / 7) {
    rect(ctx, STONE.dark, Math.round(56 + Math.cos(a) * 14.5), Math.round(82 + Math.sin(a) * 14.5), 2, 2);
    rect(ctx, STONE.light, Math.round(56 + Math.cos(a + 0.2) * 15.2), Math.round(82 + Math.sin(a + 0.2) * 15.2), 1, 1);
  }
  disc(ctx, O, 56, 82, 12.5, 12.5, 94);
  disc(ctx, "#8a5a3b", 56, 82, 11.5, 11.5, 94);
  for (let x = 47; x < 66; x += 3) rect(ctx, "#6b4a3a", x, 71, 1, 23);
  disc(ctx, O, 56, 80, 3.5);
  disc(ctx, GLASS, 56, 80, 2.5);
  rect(ctx, GOLD, 62, 84, 2, 2);
  rect(ctx, STONE.light, 42, 94, 28, 2);
  // warm fairy lights from the chimney to the tree
  for (let x = 28; x <= 73; x++) {
    const y = Math.round(40 + 7 * Math.sin(((x - 28) / 45) * Math.PI));
    rect(ctx, O, x, y, 1, 1);
    if ((x - 28) % 5 === 2) rect(ctx, (x - 28) % 10 === 2 ? "#fff2b0" : GOLD_LIGHT, x, y + 1, 1, 1);
  }
  // herb garden, mortar and pestle, carrots, mushrooms
  rect(ctx, O, 2, 88, 18, 7);
  rect(ctx, "#6b4a3a", 3, 89, 16, 5);
  for (let x = 4; x < 19; x += 3) {
    rect(ctx, "#6fbf6a", x, 86, 1, 4);
    rect(ctx, "#4f9e54", x + 1, 87, 1, 3);
  }
  disc(ctx, O, 30, 91, 5.5, 3.5);
  disc(ctx, "#8fdcb0", 30, 91, 4.5, 2.5);
  disc(ctx, "#5fb58a", 30, 90, 3.5, 1.5);
  rect(ctx, O, 31, 81, 2, 9);
  rect(ctx, TRIM, 31, 82, 1, 7);
  rect(ctx, O, 90, 88, 20, 7);
  rect(ctx, "#6b4a3a", 91, 89, 18, 5);
  for (const x of [92, 96, 100, 104]) {
    rect(ctx, "#6fbf6a", x, 85, 1, 4);
    rect(ctx, "#4f9e54", x + 1, 86, 1, 3);
    rect(ctx, "#f08a3a", x, 90, 2, 3);
  }
  for (const [x, y] of [[10, 80], [102, 78], [72, 90]] as const) {
    disc(ctx, O, x, y, 4, 3, y);
    disc(ctx, "#d9503f", x, y, 3, 2, y);
    rect(ctx, "#fff6ee", x - 1, y - 1, 1, 1);
    rect(ctx, O, x - 1, y + 1, 3, 3);
    rect(ctx, TRIM, x, y + 1, 1, 2);
  }
}

/** The Grand Post Office: portico, mansard roof, bell cupola and a mail rocket. 112 x 116. */
export function drawGrandPost(ctx: Ctx) {
  // mail rocket on its launch rail
  rect(ctx, O, 95, 2, 3, 52);
  rect(ctx, "#8f93a3", 96, 3, 1, 50);
  rect(ctx, O, 99, 10, 10, 32);
  rect(ctx, "#fff6ee", 100, 12, 8, 29);
  rect(ctx, "#d9dbe6", 105, 12, 3, 29);
  rect(ctx, O, 100, 6, 8, 4);
  rect(ctx, O, 102, 3, 4, 3);
  rect(ctx, "#d97757", 101, 7, 6, 4);
  rect(ctx, "#4f6fb0", 100, 22, 8, 3);
  roundWindow(ctx, 104, 17, 2, "#c9cbd6");
  rect(ctx, O, 97, 36, 3, 8);
  rect(ctx, O, 108, 36, 3, 8);
  rect(ctx, "#d97757", 98, 37, 1, 6);
  rect(ctx, "#d97757", 109, 37, 1, 6);
  // flag
  rect(ctx, O, 10, 6, 2, 44);
  rect(ctx, GOLD, 10, 5, 2, 1);
  rect(ctx, O, 12, 7, 16, 11);
  rect(ctx, "#d97757", 13, 8, 14, 9);
  box(ctx, "#fff6ee", 16, 9, 8, 6, O);
  rect(ctx, O, 17, 10, 3, 1);
  rect(ctx, O, 20, 10, 3, 1);
  // cupola with a bell and a little blue dome
  rect(ctx, O, 45, 12, 22, 22);
  rect(ctx, PLASTER, 46, 13, 20, 20);
  for (const x of [46, 64]) rect(ctx, "#8a5a3b", x, 13, 2, 20);
  disc(ctx, "#3b2a3a", 56, 19, 5, 4, 19);
  rect(ctx, "#3b2a3a", 51, 19, 10, 11);
  disc(ctx, O, 56, 24, 4.5, 4);
  disc(ctx, GOLD, 56, 24, 3.5, 3);
  rect(ctx, GOLD_LIGHT, 54, 22, 1, 2);
  rect(ctx, GOLD_DARK, 56, 28, 1, 1);
  dome(ctx, 56, 12, 12, 8, BLUE_ROOF, [0]);
  finial(ctx, 56, 0, 5);
  // mansard roof with dormers
  shingles(ctx, 56, 34, 20, 42, 52, BLUE_ROOF);
  for (const x of [18, 36, 70, 88]) {
    rect(ctx, O, x - 1, 37, 11, 12);
    rect(ctx, BLUE_ROOF.dark, x, 37, 9, 1);
    win(ctx, x, 39, 9, 9, false);
  }
  // walls
  plaster(ctx, 3, 56, 106, 50);
  rect(ctx, BLUE_ROOF.base, 4, 57, 104, 2);
  rect(ctx, BLUE_ROOF.dark, 4, 59, 104, 1);
  // side windows under striped awnings
  for (const x of [9, 89]) {
    archWindow(ctx, x, 70, 14, 24);
    for (let ax = x - 2; ax < x + 16; ax++) rect(ctx, Math.floor((ax - x + 2) / 3) % 2 ? "#fff6ee" : BLUE_ROOF.base, ax, 64, 1, 5);
    rect(ctx, O, x - 3, 63, 20, 1);
    for (let ax = x - 2; ax < x + 16; ax += 3) rect(ctx, O, ax, 69, 2, 1);
  }
  // portico: pediment with a gold envelope, four columns, the grand door
  pediment(ctx, 56, 58, 13, 34);
  box(ctx, GOLD, 50, 62, 12, 8, O);
  for (let i = 0; i < 6; i++) {
    rect(ctx, O, 51 + i, 63 + Math.floor(i / 2), 1, 1);
    rect(ctx, O, 60 - i, 63 + Math.floor(i / 2), 1, 1);
  }
  grandDoor(ctx, 56, 106, 16, 28, BLUE_ROOF.dark);
  for (const x of [27, 40, 67, 80]) column(ctx, x, 74, 32);
  hangingLantern(ctx, 46, 75);
  hangingLantern(ctx, 64, 75);
  stoneBase(ctx, 1, 106, 110, 5);
  stairs(ctx, 56, 116, 34, 4);
  // parcels waiting to fly
  for (const [x, y, w, h] of [[3, 98, 10, 8], [5, 91, 7, 7], [100, 99, 9, 7]] as const) {
    box(ctx, "#c98f5a", x, y, w, h, O);
    rect(ctx, "#fff6ee", x + Math.floor(w / 2), y + 1, 1, h - 2);
    rect(ctx, "#d97757", x + 1, y + 1, 2, 1);
  }
}

/** The Clock Tower: stone plinth, timber shaft, a huge gilded clock, belfry and gold spire. 72 x 180. */
export function drawGrandClock(ctx: Ctx) {
  // plinth with buttresses and an arched door
  stoneWall(ctx, 8, 146, 56, 30);
  for (const x of [5, 61]) {
    rect(ctx, O, x, 150, 6, 26);
    rect(ctx, STONE.base, x + 1, 151, 4, 25);
    rect(ctx, STONE.light, x + 1, 151, 4, 1);
  }
  grandDoor(ctx, 36, 176, 14, 24);
  stairs(ctx, 36, 180, 24, 2);
  // shaft with timber framing
  plaster(ctx, 14, 104, 44, 42);
  for (const bx of [15, 55]) rect(ctx, "#8a5a3b", bx, 105, 2, 41);
  rect(ctx, "#8a5a3b", 15, 124, 42, 2);
  for (let i = 0; i < 19; i++) {
    rect(ctx, "#8a5a3b", 17 + i, 126 + i, 2, 1);
    rect(ctx, "#8a5a3b", 53 - i, 126 + i, 2, 1);
  }
  for (const x of [22, 44]) archWindow(ctx, x, 108, 8, 13);
  // the clock storey (the hands are drawn live, showing the real time)
  stoneWall(ctx, 10, 64, 52, 41);
  disc(ctx, O, 36, 84, 19);
  disc(ctx, GOLD, 36, 84, 18);
  disc(ctx, GOLD_DARK, 36, 85, 17.5);
  disc(ctx, GOLD, 36, 84, 17);
  disc(ctx, O, 36, 84, 15);
  disc(ctx, "#fff8e6", 36, 84, 14);
  disc(ctx, "#f2e6cc", 37, 85, 11, 11);
  disc(ctx, "#fff8e6", 36, 84, 10.5);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = i % 3 ? 12 : 11.5;
    rect(ctx, i % 3 ? GOLD_DARK : O, Math.round(36 + Math.cos(a) * r - 0.5), Math.round(84 + Math.sin(a) * r - 0.5), i % 3 ? 1 : 2, i % 3 ? 1 : 2);
  }
  for (const [x, y] of [[13, 66], [55, 66], [13, 97], [55, 97]] as const) {
    rect(ctx, O, x, y, 5, 5);
    rect(ctx, GOLD, x + 1, y + 1, 3, 3);
  }
  // balcony and banners
  balustrade(ctx, 6, 60, 60);
  banner(ctx, 11, 66, 18, BLUE_ROOF.base);
  banner(ctx, 54, 66, 18, BLUE_ROOF.base);
  // belfry: three bells
  plaster(ctx, 12, 34, 48, 26);
  for (const bx of [16, 31, 46]) {
    disc(ctx, O, bx + 5, 42, 5.5, 5.5, 42);
    rect(ctx, O, bx - 0.5, 42, 11, 14);
    disc(ctx, "#3b2a3a", bx + 5, 42, 4.5, 4.5, 42);
    rect(ctx, "#3b2a3a", bx + 0.5, 42, 9, 13);
    disc(ctx, O, bx + 5, 47, 3.8, 3.5);
    disc(ctx, GOLD, bx + 5, 47, 2.8, 2.5);
    rect(ctx, GOLD, bx + 2, 49, 7, 1);
    rect(ctx, GOLD_LIGHT, bx + 4, 45, 1, 2);
    rect(ctx, GOLD_DARK, bx + 5, 51, 1, 1);
  }
  // corner pinnacles and the spire
  for (const x of [9, 57]) {
    shingles(ctx, x + 3, 22, 11, 0, 4, GOLD_ROOF);
    rect(ctx, O, x + 2, 16, 2, 6);
    rect(ctx, GOLD, x + 2, 16, 2, 1);
  }
  shingles(ctx, 36, 8, 25, 1, 23, GOLD_ROOF);
  for (const y of [14, 22]) {
    rect(ctx, O, 34, y, 5, 5);
    rect(ctx, GLASS, 35, y + 1, 3, 3);
  }
  // orb and weathervane
  rect(ctx, O, 35, 0, 2, 9);
  disc(ctx, O, 36, 5, 3);
  disc(ctx, GOLD, 36, 5, 2);
  rect(ctx, GOLD_LIGHT, 35, 4, 1, 1);
  rect(ctx, O, 29, 1, 14, 1);
  rect(ctx, "#6fe3e1", 35, 0, 2, 1);
}

/** The Observatory: a great split dome with a giant telescope, ring, annexes and an orrery. 112 x 124. */
export function drawGrandObservatory(ctx: Ctx) {
  // the giant telescope, pointing at Earth
  for (let i = 0; i <= 42; i++) {
    const x = 56 + i;
    const y = Math.round(58 - i * 1.1);
    rect(ctx, O, x - 3, y - 3, 7, 7);
  }
  for (let i = 0; i <= 42; i++) {
    const x = 56 + i;
    const y = Math.round(58 - i * 1.1);
    rect(ctx, i % 9 === 4 ? GOLD_DARK : "#d9a441", x - 2, y - 2, 5, 5);
    rect(ctx, GOLD_LIGHT, x - 2, y - 2, 2, 1);
  }
  disc(ctx, O, 100, 11, 5);
  disc(ctx, GOLD_DARK, 100, 11, 4);
  disc(ctx, "#6fe3e1", 100, 11, 2.6);
  rect(ctx, "#dff9fb", 99, 10, 1, 1);
  // annexes
  stoneWall(ctx, 2, 88, 30, 33);
  dome(ctx, 17, 88, 13, 10, PURPLE, [0]);
  finial(ctx, 17, 70, 8);
  stoneWall(ctx, 80, 88, 30, 33);
  // orrery on the right annex
  rect(ctx, O, 94, 72, 2, 16);
  for (const [rx, ry] of [[14, 4], [9, 3]] as const) {
    for (let a = 0; a < Math.PI * 2; a += 0.12) rect(ctx, GOLD_DARK, Math.round(95 + Math.cos(a) * rx), Math.round(74 + Math.sin(a) * ry), 1, 1);
  }
  disc(ctx, O, 95, 74, 3);
  disc(ctx, "#ff9a4a", 95, 74, 2);
  disc(ctx, O, 81, 74, 2);
  disc(ctx, "#7fc6e6", 81, 74, 1.2);
  disc(ctx, O, 104, 76, 1.8);
  disc(ctx, "#cfc6d8", 104, 76, 1);
  // main tower
  stoneWall(ctx, 22, 70, 68, 51);
  for (const x of [28, 76]) archWindow(ctx, x, 84, 8, 14, TRIM, "#bfe0ff");
  grandDoor(ctx, 56, 121, 14, 26, PURPLE.dark);
  banner(ctx, 40, 76, 20, PURPLE.base);
  banner(ctx, 65, 76, 20, PURPLE.base);
  // the great dome, split open for the telescope
  dome(ctx, 56, 72, 36, 30, PURPLE, [-0.8, -0.45, 0.45, 0.8]);
  for (let y = 44; y < 72; y++) {
    rect(ctx, O, 54, y, 7, 1);
    rect(ctx, "#1f2a4d", 55, y, 5, 1);
    if (hash(y, 3, 17) > 0.8) rect(ctx, "#ffffff", 56 + Math.floor(hash(y, 4, 17) * 3), y, 1, 1);
  }
  for (const [x, y] of [[30, 58], [40, 50], [74, 52], [84, 60], [36, 66], [78, 66]] as const) {
    rect(ctx, PURPLE.light, x, y, 1, 1);
    rect(ctx, PURPLE.dark, x, y + 1, 1, 1);
  }
  // a gold ring around the dome: front half over it, back half only where it shows
  const cx = 56;
  const cy = 62;
  for (let x = 0; x < 112; x++) {
    const t = (x + 0.5 - cx) / 55;
    if (Math.abs(t) > 1) continue;
    const dy = 8 * Math.sqrt(1 - t * t);
    for (const [y, front] of [[Math.round(cy + dy), true], [Math.round(cy - dy), false]] as const) {
      const behindDome = !front && ((x - 56) / 36) ** 2 + ((y - 72) / 30) ** 2 < 1 && y < 72;
      if (behindDome) continue;
      rect(ctx, GOLD, x, y, 1, 1);
      rect(ctx, front ? GOLD_DARK : O, x, y + 1, 1, 1);
    }
  }
  stoneBase(ctx, 0, 120, 112, 4);
}

/** The Grand Library: a columned hall with a great copper dome and two domed towers. 128 x 120. */
export function drawGrandLibrary(ctx: Ctx) {
  // side towers with little domes
  for (const x of [0, 104]) {
    stoneWall(ctx, x, 44, 24, 68);
    dome(ctx, x + 12, 44, 11, 10, COPPER, [0]);
    finial(ctx, x + 12, 26, 9);
    archWindow(ctx, x + 7, 52, 10, 16);
    archWindow(ctx, x + 7, 78, 10, 16);
    banner(ctx, x + 8, 97, 12, COPPER.base);
  }
  // drum and great dome
  rect(ctx, O, 40, 30, 48, 22);
  rect(ctx, "#efe0c0", 41, 31, 46, 21);
  for (let x = 43; x < 86; x += 6) {
    rect(ctx, "#d2c09a", x, 31, 1, 21);
    rect(ctx, "#fff6e6", x + 1, 31, 1, 21);
  }
  for (const x of [46, 58, 70]) {
    archWindow(ctx, x + 1, 34, 6, 14);
  }
  dome(ctx, 64, 30, 26, 22, COPPER, [-0.7, -0.35, 0, 0.35, 0.7]);
  // lantern cupola on top
  rect(ctx, O, 59, 2, 10, 8);
  rect(ctx, "#efe0c0", 60, 3, 8, 6);
  rect(ctx, GLASS, 62, 4, 4, 4);
  dome(ctx, 64, 3, 6, 3, COPPER, []);
  finial(ctx, 64, -2, 4);
  // the hall
  bricks(ctx, 22, 52, 84, 60);
  for (const x of [30, 88]) archWindow(ctx, x, 70, 10, 26);
  // portico
  pediment(ctx, 64, 50, 14, 38);
  box(ctx, "#fff6ee", 56, 55, 16, 8, O);
  rect(ctx, O, 64, 56, 1, 6);
  for (let y = 57; y < 62; y += 2) {
    rect(ctx, "#b8a88a", 58, y, 4, 1);
    rect(ctx, "#b8a88a", 66, y, 4, 1);
  }
  roundWindow(ctx, 64, 74, 7);
  grandDoor(ctx, 64, 112, 16, 28, "#6b4a3a");
  for (const x of [28, 40, 52, 71, 83, 95]) column(ctx, x, 67, 45);
  stoneBase(ctx, 0, 111, 128, 5);
  stairs(ctx, 64, 120, 48, 4);
  // gold owl statues on the stair ends
  for (const x of [34, 91]) {
    rect(ctx, O, x, 110, 6, 4);
    rect(ctx, STONE.light, x + 1, 111, 4, 2);
    disc(ctx, O, x + 3, 105, 3.5, 5);
    disc(ctx, GOLD, x + 3, 105, 2.5, 4);
    rect(ctx, O, x + 2, 103, 1, 1);
    rect(ctx, O, x + 4, 103, 1, 1);
    rect(ctx, O, x + 1, 100, 1, 2);
    rect(ctx, O, x + 5, 100, 1, 2);
  }
}

/** The Launch Complex: a towering rocket, gantry, fuel tanks and floodlights. 112 x 132. */
export function drawLaunchComplex(ctx: Ctx) {
  // launch pad
  disc(ctx, O, 56, 120, 55, 11.5);
  disc(ctx, "#7d7494", 56, 120, 54, 10.5);
  disc(ctx, "#a49cb8", 56, 119, 46, 8);
  for (let x = 16; x < 96; x += 8) rect(ctx, GOLD, x, 118, 4, 2);
  disc(ctx, "#3b2a3a", 50, 121, 12, 3);
  for (const [x, y] of [[4, 120], [108, 120], [56, 109], [56, 130]] as const) {
    rect(ctx, O, x - 1, y - 1, 3, 3);
    rect(ctx, "#6fe3e1", x, y, 1, 1);
  }
  // fuel tanks
  for (const [x, h] of [[4, 34], [18, 26]] as const) {
    const top = 116 - h;
    disc(ctx, O, x + 6, top, 6.5, 4);
    rect(ctx, O, x - 0.5, top, 13, h);
    disc(ctx, "#e9e9f2", x + 6, top, 5.5, 3);
    rect(ctx, "#e9e9f2", x + 0.5, top, 11, h - 1);
    rect(ctx, "#c9cbd6", x + 8, top, 3, h - 1);
    for (const y of [top + 6, top + h - 10]) rect(ctx, "#d97757", x + 0.5, y, 11, 2);
  }
  rect(ctx, O, 30, 104, 8, 1);
  // gantry tower
  rect(ctx, O, 78, 6, 20, 106);
  rect(ctx, "#8f93a3", 79, 7, 18, 104);
  for (let y = 7; y < 111; y += 12) {
    rect(ctx, O, 79, y + 11, 18, 1);
    for (let i = 0; i < 11; i++) {
      rect(ctx, "#5b5470", 80 + Math.round(i * 1.5), y + i, 1, 1);
      rect(ctx, "#5b5470", 95 - Math.round(i * 1.5), y + i, 1, 1);
    }
  }
  for (const y of [36, 70]) {
    rect(ctx, O, 57, y, 22, 4);
    rect(ctx, "#c9cbd6", 58, y + 1, 20, 1);
  }
  rect(ctx, O, 83, 0, 10, 7);
  rect(ctx, "#8a2a22", 85, 2, 6, 3);
  // the rocket
  const cx = 46;
  const half = (y: number) => (y < 30 ? Math.max(1, Math.round(((y - 4) / 26) ** 0.6 * 11)) : 11);
  for (let y = 4; y < 106; y++) {
    const h = half(y);
    rect(ctx, O, cx - h - 1, y, h * 2 + 2, 1);
    const band = y < 26 ? "#d97757" : (y > 60 && y < 66) || (y > 88 && y < 92) ? "#d97757" : "#fff6ee";
    rect(ctx, band, cx - h, y, h * 2, 1);
    rect(ctx, y < 26 ? "#b85c3e" : "#d9dbe6", cx + Math.max(0, h - 4), y, Math.min(4, h), 1);
    rect(ctx, y < 26 ? "#eb9a7c" : "#ffffff", cx - h + 1, y, 1, 1);
  }
  for (const wy of [38, 50]) {
    disc(ctx, O, cx, wy, 4.5);
    disc(ctx, "#c9cbd6", cx, wy, 3.5);
    disc(ctx, "#4f7fcf", cx, wy, 2.5);
    rect(ctx, "#a9ccff", cx - 1, wy - 1, 1, 1);
  }
  rect(ctx, "#4f6fb0", cx - 11, 72, 22, 6);
  for (let x = cx - 9; x < cx + 9; x += 3) rect(ctx, "#fff6ee", x, 74, 2, 2);
  // fins and engine bell
  for (const side of [-1, 1]) {
    for (let i = 0; i < 16; i++) {
      const w = Math.round(i * 0.6);
      const x = side < 0 ? cx - 11 - w - 1 : cx + 11 + 1;
      rect(ctx, O, x - (side < 0 ? 1 : 0), 92 + i, w + 2, 1);
      rect(ctx, "#d97757", side < 0 ? x : x, 92 + i, w, 1);
    }
  }
  rect(ctx, O, cx - 7, 106, 14, 6);
  rect(ctx, "#5b5470", cx - 6, 106, 12, 5);
  rect(ctx, "#8f93a3", cx - 6, 106, 12, 1);
}
