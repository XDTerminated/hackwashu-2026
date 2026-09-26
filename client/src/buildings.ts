// Stardew Valley–style buildings with a light sci-fi touch: plank siding,
// shingle roofs, flower boxes, timber framing — plus dishes, antennae and
// glowing panels, because it's still the Moon.

import { type Ctx, WOOD_INK as O, box, disc, hash, rect } from "./pix";

// ---------------------------------------------------------------- materials

const WOOD = { base: "#c98f5a", dark: "#9c6639", light: "#e2ad76" };
const TRIM = "#f0d2a0";
const STONE = { base: "#9a93a8", dark: "#6f6880", light: "#bdb6cb" };

/** Horizontal plank siding with staggered seams. */
function planks(ctx: Ctx, x: number, y: number, w: number, h: number, c = WOOD) {
  rect(ctx, c.base, x, y, w, h);
  for (let py = y, row = 0; py < y + h; py += 4, row++) {
    rect(ctx, c.light, x, py, w, 1);
    if (py + 3 < y + h) rect(ctx, c.dark, x, py + 3, w, 1);
    for (let sx = x + (row % 2 ? 6 : 14); sx < x + w - 1; sx += 17) rect(ctx, c.dark, sx, py + 1, 1, 2);
  }
}

/** Front-facing shingle roof: a trapezoid of staggered shingle courses. */
function shingles(
  ctx: Ctx,
  cx: number,
  top: number,
  rows: number,
  halfTop: number,
  halfBottom: number,
  c: { base: string; dark: string; light: string },
) {
  for (let i = 0; i < rows; i++) {
    const hw = Math.round(halfTop + ((halfBottom - halfTop) * i) / (rows - 1));
    const y = top + i;
    rect(ctx, O, cx - hw - 1, y, hw * 2 + 2, 1);
    rect(ctx, c.base, cx - hw, y, hw * 2, 1);
    const course = Math.floor(i / 3);
    if (i % 3 === 2) {
      rect(ctx, c.dark, cx - hw, y, hw * 2, 1);
    } else {
      for (let x = cx - hw + (course % 2 ? 2 : 5); x < cx + hw; x += 6) rect(ctx, c.dark, x, y, 1, 1);
      if (i % 3 === 0) rect(ctx, c.light, cx - hw, y, Math.max(2, Math.floor(hw * 0.5)), 1);
    }
  }
  // ridge cap + fascia board
  rect(ctx, O, cx - halfTop - 1, top - 1, halfTop * 2 + 2, 1);
  rect(ctx, c.light, cx - halfTop, top, halfTop * 2, 1);
  rect(ctx, O, cx - halfBottom - 2, top + rows, halfBottom * 2 + 4, 2);
  rect(ctx, TRIM, cx - halfBottom - 1, top + rows, halfBottom * 2 + 2, 1);
}

function stoneBase(ctx: Ctx, x: number, y: number, w: number, h: number) {
  rect(ctx, O, x, y, w, h);
  rect(ctx, STONE.base, x + 1, y, w - 2, h - 1);
  for (let sx = x + 2, i = 0; sx < x + w - 3; sx += 5, i++) {
    rect(ctx, STONE.dark, sx + 4, y, 1, h - 1);
    rect(ctx, STONE.light, sx, y, 3, 1);
    if (hash(sx, y, i) > 0.5) rect(ctx, STONE.dark, sx + 1, y + h - 2, 2, 1);
  }
}

/** Framed window with warm light, sill and an optional flower box. */
function win(ctx: Ctx, x: number, y: number, w: number, h: number, flowers = true) {
  box(ctx, TRIM, x, y, w, h, O);
  rect(ctx, "#ffd98a", x + 2, y + 2, w - 4, h - 4);
  rect(ctx, "#fff3c4", x + 2, y + 2, Math.max(1, Math.floor((w - 4) / 2)), Math.max(1, Math.floor((h - 4) / 2)));
  rect(ctx, TRIM, x + Math.floor(w / 2), y + 1, 1, h - 2);
  rect(ctx, TRIM, x + 1, y + Math.floor(h / 2), w - 2, 1);
  if (flowers) {
    box(ctx, "#8a5a3b", x - 1, y + h, w + 2, 3, O);
    for (let fx = x; fx < x + w; fx += 2) {
      rect(ctx, "#4f9e54", fx, y + h - 1, 1, 1);
      rect(ctx, fx % 4 ? "#f07a9a" : "#f5c542", fx, y + h - 2, 1, 1);
    }
  } else {
    rect(ctx, O, x - 1, y + h, w + 2, 1);
    rect(ctx, TRIM, x, y + h, w, 1);
  }
}

function door(ctx: Ctx, x: number, y: number, w: number, h: number, color = "#8a5a3b") {
  box(ctx, TRIM, x - 1, y - 1, w + 2, h + 1, O);
  rect(ctx, color, x + 1, y + 1, w - 2, h - 1);
  for (let px = x + 3; px < x + w - 1; px += 3) rect(ctx, "rgba(0,0,0,0.18)", px, y + 1, 1, h - 1);
  rect(ctx, "#f5c542", x + w - 3, y + Math.floor(h / 2), 1, 2);
}

/** A tiny satellite dish — the sci-fi garnish. */
function dishOnRoof(ctx: Ctx, x: number, y: number) {
  rect(ctx, O, x + 2, y + 4, 1, 4);
  disc(ctx, O, x + 2.5, y + 2.5, 3.5, 2.8);
  disc(ctx, "#e9e9f2", x + 2.5, y + 2.5, 2.6, 1.9);
  rect(ctx, "#7fd6e0", x + 2, y + 1, 1, 1);
}

// ---------------------------------------------------------------- buildings

export function drawPlayerHouse(ctx: Ctx) {
  // 52 x 48 — cozy farmhouse with a red shingle roof
  rect(ctx, O, 35, 0, 7, 14);
  rect(ctx, STONE.base, 36, 1, 5, 13);
  rect(ctx, STONE.light, 36, 1, 5, 1);
  rect(ctx, STONE.dark, 36, 6, 5, 1);
  shingles(ctx, 26, 6, 15, 15, 24, { base: "#c4553f", dark: "#8e3a2d", light: "#e07a5a" });
  dishOnRoof(ctx, 12, 3);
  rect(ctx, O, 5, 22, 42, 23);
  planks(ctx, 6, 23, 40, 21);
  rect(ctx, WOOD.dark, 6, 23, 2, 21);
  rect(ctx, WOOD.dark, 44, 23, 2, 21);
  win(ctx, 9, 27, 10, 8);
  win(ctx, 33, 27, 10, 8);
  door(ctx, 21, 30, 10, 14);
  stoneBase(ctx, 4, 44, 44, 4);
  rect(ctx, STONE.light, 20, 44, 12, 1);
}

export function drawRabbitBurrow(ctx: Ctx) {
  // 56 x 40 — a moss-covered hill with a round door
  disc(ctx, O, 28, 40, 27, 30, 39);
  disc(ctx, "#4f9e54", 28, 40, 26, 29, 38);
  disc(ctx, "#6fbf6a", 25, 38, 22, 25, 36);
  disc(ctx, "#94d886", 19, 30, 9, 9, 28);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(hash(i, 1) * 50) + 3;
    const y = Math.floor(hash(i, 2) * 34) + 6;
    const inside = ((x - 28) / 25) ** 2 + ((y - 40) / 28) ** 2 < 1;
    if (inside) rect(ctx, hash(i, 3) > 0.5 ? "#3f8a4a" : "#a8e89a", x, y, 1, 2);
  }
  // stone arch + round door
  disc(ctx, O, 28, 32, 10.5, 10.5, 38);
  disc(ctx, STONE.base, 28, 32, 9.5, 9.5, 38);
  disc(ctx, O, 28, 32, 7.5, 7.5, 38);
  disc(ctx, "#8a5a3b", 28, 32, 6.5, 6.5, 38);
  for (let x = 24; x < 33; x += 3) rect(ctx, "#6b4a3a", x, 26, 1, 12);
  rect(ctx, "#f5c542", 32, 33, 1, 2);
  // round window
  disc(ctx, O, 45, 22, 5);
  disc(ctx, TRIM, 45, 22, 4);
  disc(ctx, "#ffd98a", 45, 22, 2.8);
  rect(ctx, TRIM, 45, 19, 1, 6);
  // mushrooms + lantern
  disc(ctx, O, 9, 34, 3.5, 2.5, 34);
  disc(ctx, "#d9503f", 9, 34, 2.8, 1.9, 34);
  rect(ctx, "#fff6ee", 8, 33, 1, 1);
  rect(ctx, TRIM, 9, 35, 1, 3);
  rect(ctx, O, 40, 30, 1, 4);
  box(ctx, "#f5a05a", 38, 33, 5, 5, O);
  rect(ctx, "#fff0b0", 40, 35, 1, 2);
  rect(ctx, "#8f8a99", 0, 38, 56, 2);
}

export function drawPostOffice(ctx: Ctx) {
  // 64 x 56 — timber-framed shop with a striped awning
  const BLUE = { base: "#4f6fb0", dark: "#34508a", light: "#7390cc" };
  shingles(ctx, 32, 8, 12, 22, 30, BLUE);
  // antenna
  rect(ctx, O, 50, 0, 1, 9);
  rect(ctx, "#ff6a5a", 50, 0, 1, 1);
  rect(ctx, O, 47, 3, 7, 1);
  // plaster walls with timber beams
  rect(ctx, O, 3, 21, 58, 32);
  rect(ctx, "#f2e6cc", 4, 22, 56, 30);
  for (const bx of [4, 20, 43, 58]) rect(ctx, "#8a5a3b", bx, 22, 2, 30);
  rect(ctx, "#8a5a3b", 4, 22, 56, 2);
  rect(ctx, "#8a5a3b", 4, 38, 16, 1);
  rect(ctx, "#8a5a3b", 45, 38, 13, 1);
  win(ctx, 7, 26, 11, 9);
  win(ctx, 47, 26, 10, 9);
  // hanging sign
  box(ctx, "#c98f5a", 23, 23, 18, 8, O);
  box(ctx, "#fff6ee", 28, 24, 8, 6, O);
  rect(ctx, "#d97757", 30, 26, 4, 2);
  // striped awning
  for (let x = 20; x < 44; x++) {
    rect(ctx, Math.floor((x - 20) / 3) % 2 ? "#fff6ee" : "#4f6fb0", x, 33, 1, 4);
    if ((x - 20) % 3 === 1) rect(ctx, Math.floor((x - 20) / 3) % 2 ? "#fff6ee" : "#4f6fb0", x, 37, 1, 1);
  }
  rect(ctx, O, 19, 32, 26, 1);
  door(ctx, 26, 39, 12, 13, "#4f6fb0");
  rect(ctx, O, 32, 40, 1, 12);
  stoneBase(ctx, 2, 52, 60, 4);
}

export function drawMailbox(ctx: Ctx) {
  // 16 x 24
  rect(ctx, O, 6, 11, 4, 13);
  rect(ctx, "#8a5a3b", 7, 11, 2, 13);
  rect(ctx, "#a86f43", 7, 11, 1, 13);
  disc(ctx, O, 8, 5, 7, 5, 9);
  rect(ctx, O, 1, 5, 14, 7);
  disc(ctx, "#4f6fb0", 8, 5, 6, 4, 9);
  rect(ctx, "#4f6fb0", 2, 5, 12, 6);
  rect(ctx, "#7390cc", 3, 3, 5, 1);
  rect(ctx, "#34508a", 2, 10, 12, 1);
  rect(ctx, O, 14, 0, 1, 8);
  rect(ctx, "#d9503f", 15, 0, 1, 4);
}

export function drawClockTower(ctx: Ctx) {
  // 44 x 88 — stone base, timber-framed shaft, shingled spire
  const SPIRE = { base: "#c99a3e", dark: "#8f6a26", light: "#e6c070" };
  stoneBase(ctx, 5, 64, 34, 21);
  for (let y = 67; y < 84; y += 4) rect(ctx, STONE.dark, 6, y, 32, 1);
  door(ctx, 17, 72, 10, 13);
  rect(ctx, O, 9, 24, 26, 41);
  rect(ctx, "#f2e6cc", 10, 25, 24, 39);
  for (const bx of [10, 32]) rect(ctx, "#8a5a3b", bx, 25, 2, 39);
  rect(ctx, "#8a5a3b", 10, 47, 24, 2);
  for (let i = 0; i < 12; i++) {
    rect(ctx, "#8a5a3b", 12 + i, 49 + i, 2, 1);
    rect(ctx, "#8a5a3b", 31 - i, 49 + i, 2, 1);
  }
  // clock
  disc(ctx, O, 22, 36, 9.5);
  disc(ctx, "#c98f5a", 22, 36, 8.5);
  disc(ctx, "#fff8e6", 22, 36, 7);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    rect(ctx, "#8f6a26", 22 + Math.cos(a) * 5.5 - 0.5, 36 + Math.sin(a) * 5.5 - 0.5, 1, 1);
  }
  rect(ctx, O, 21.5, 31, 1, 5);
  rect(ctx, O, 22, 35.5, 4, 1);
  rect(ctx, "#d9503f", 21.5, 35.5, 1, 1);
  shingles(ctx, 22, 5, 19, 2, 15, SPIRE);
  // weathervane with a little comm light
  rect(ctx, O, 21, 0, 2, 5);
  rect(ctx, "#6fe3e1", 21, 0, 2, 1);
  rect(ctx, O, 17, 2, 10, 1);
}

export function drawRocketPad(ctx: Ctx) {
  // 64 x 22 — launch pad; the rocket sprite sits on top in-scene
  disc(ctx, O, 32, 12, 31, 9.5);
  disc(ctx, "#7d7494", 32, 12, 30, 8.5);
  disc(ctx, "#a49cb8", 32, 11, 24, 6);
  for (let x = 12; x < 52; x += 6) rect(ctx, "#f5c542", x, 11, 3, 2);
  for (const [x, y] of [[6, 12], [58, 12], [32, 3], [32, 20]]) {
    rect(ctx, O, x - 1, y - 1, 3, 3);
    rect(ctx, "#6fe3e1", x, y, 1, 1);
  }
  rect(ctx, O, 50, 0, 3, 13);
  rect(ctx, "#d97757", 51, 1, 1, 11);
  rect(ctx, O, 44, 3, 7, 1);
}

export function drawObservatory(ctx: Ctx) {
  // 60 x 60 — stone tower with a riveted purple dome and a brass telescope
  const P = "#7e5fb8";
  stoneBase(ctx, 6, 30, 48, 27);
  for (let y = 34; y < 56; y += 4) rect(ctx, STONE.dark, 7, y, 46, 1);
  for (let y = 32, r = 0; y < 56; y += 4, r++) for (let x = 7 + (r % 2 ? 4 : 0); x < 53; x += 8) rect(ctx, STONE.dark, x, y, 1, 3);
  disc(ctx, O, 30, 31, 23, 23, 30);
  disc(ctx, P, 30, 31, 22, 22, 30);
  disc(ctx, "#9d80d6", 24, 23, 10, 12, 29);
  for (const a of [-1.2, -0.6, 0, 0.6, 1.2]) {
    for (let r = 4; r < 22; r++) rect(ctx, "#5f4596", 30 + Math.sin(a) * r, 31 - Math.cos(a) * r, 1, 1);
  }
  rect(ctx, O, 32, 9, 5, 22);
  rect(ctx, "#1f2a4d", 33, 10, 3, 20);
  for (let i = 0; i < 12; i++) rect(ctx, i < 2 ? O : i % 3 ? "#d9a441" : "#b8862e", 34 + i, 14 - i, 3, 3);
  rect(ctx, "#6fe3e1", 46, 2, 2, 2);
  door(ctx, 25, 43, 10, 14, "#5f4596");
  win(ctx, 10, 38, 8, 7, false);
  win(ctx, 42, 38, 8, 7, false);
}

export function drawPlot(ctx: Ctx) {
  // 48 x 34 — staked-out plot with rope and a wooden sign
  for (const [x, y] of [[2, 22], [45, 22], [2, 31], [45, 31]]) {
    rect(ctx, O, x - 1, y - 3, 3, 6);
    rect(ctx, "#c98f5a", x, y - 2, 1, 4);
  }
  ctx.fillStyle = "#e0c090";
  for (let x = 3; x < 45; x += 2) {
    ctx.fillRect(x, 21 + (x % 4 === 1 ? 1 : 0), 1, 1);
    ctx.fillRect(x, 30 + (x % 4 === 1 ? 1 : 0), 1, 1);
  }
  rect(ctx, O, 22, 11, 4, 21);
  rect(ctx, "#8a5a3b", 23, 11, 2, 21);
  box(ctx, "#c98f5a", 10, 0, 28, 14, O);
  rect(ctx, "#e2ad76", 11, 1, 26, 2);
  rect(ctx, "#9c6639", 11, 7, 26, 1);
  rect(ctx, O, 20, 3, 8, 3);
  rect(ctx, O, 23, 6, 2, 6);
}

export function drawLibrary(ctx: Ctx) {
  // 64 x 56 — brick hall with cream columns, arched windows and a green pediment
  const GREEN = { base: "#4f8a5a", dark: "#35663f", light: "#74b07a" };
  const BRICK = "#a8503a";
  shingles(ctx, 32, 7, 14, 8, 31, GREEN);
  dishOnRoof(ctx, 49, 3);
  // open-book sign on the pediment
  box(ctx, "#fff6ee", 26, 11, 12, 7, O);
  rect(ctx, O, 32, 12, 1, 5);
  for (let y = 13; y < 16; y += 2) {
    rect(ctx, "#b8a88a", 28, y, 3, 1);
    rect(ctx, "#b8a88a", 34, y, 3, 1);
  }
  // brick walls
  rect(ctx, O, 3, 22, 58, 31);
  rect(ctx, BRICK, 4, 23, 56, 29);
  for (let y = 23, row = 0; y < 52; y += 4, row++) {
    rect(ctx, "#7a3426", 4, y + 3, 56, 1);
    rect(ctx, "#c26a4e", 4, y, 56, 1);
    for (let x = 4 + (row % 2 ? 4 : 0); x < 60; x += 8) rect(ctx, "#7a3426", x, y, 1, 3);
  }
  // cream columns
  for (const cx of [5, 23, 38, 56]) {
    rect(ctx, O, cx - 1, 22, 5, 31);
    rect(ctx, "#efe0c0", cx, 23, 3, 29);
    rect(ctx, "#d2c09a", cx + 2, 23, 1, 29);
    rect(ctx, "#fff6e6", cx - 1, 22, 5, 1);
  }
  // arched windows
  for (const wx of [11, 44]) {
    disc(ctx, O, wx + 4, 31, 5, 5, 31);
    rect(ctx, O, wx - 1, 31, 11, 9);
    disc(ctx, "#ffd98a", wx + 4, 31, 4, 4, 31);
    rect(ctx, "#ffd98a", wx, 31, 9, 8);
    rect(ctx, "#fff3c4", wx + 1, 28, 3, 5);
    rect(ctx, "#efe0c0", wx + 4, 27, 1, 12);
    rect(ctx, "#efe0c0", wx, 34, 9, 1);
  }
  // arched double door
  disc(ctx, O, 31.5, 40, 7, 6, 40);
  rect(ctx, O, 24, 40, 15, 13);
  disc(ctx, "#6b4a3a", 31.5, 40, 6, 5, 40);
  rect(ctx, "#6b4a3a", 25, 40, 13, 12);
  rect(ctx, O, 31, 36, 1, 16);
  rect(ctx, "#f5c542", 29, 45, 1, 2);
  rect(ctx, "#f5c542", 33, 45, 1, 2);
  stoneBase(ctx, 2, 52, 60, 4);
}
