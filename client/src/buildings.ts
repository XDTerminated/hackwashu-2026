// Stardew Valley–style building materials (plank siding, shingle roofs,
// windows, doors) shared by the estates, plus the mailbox and building plots.

import { type Ctx, WOOD_INK as O, box, disc, hash, rect } from "./pix";

// ---------------------------------------------------------------- materials

export const WOOD = { base: "#c98f5a", dark: "#9c6639", light: "#e2ad76" };
export const TRIM = "#f0d2a0";
export const STONE = { base: "#9a93a8", dark: "#6f6880", light: "#bdb6cb" };

/** Horizontal plank siding with staggered seams. */
export function planks(ctx: Ctx, x: number, y: number, w: number, h: number, c = WOOD) {
  rect(ctx, c.base, x, y, w, h);
  for (let py = y, row = 0; py < y + h; py += 4, row++) {
    rect(ctx, c.light, x, py, w, 1);
    if (py + 3 < y + h) rect(ctx, c.dark, x, py + 3, w, 1);
    for (let sx = x + (row % 2 ? 6 : 14); sx < x + w - 1; sx += 17) rect(ctx, c.dark, sx, py + 1, 1, 2);
  }
}

/** Front-facing shingle roof: a trapezoid of staggered shingle courses. */
export function shingles(
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

export function stoneBase(ctx: Ctx, x: number, y: number, w: number, h: number) {
  rect(ctx, O, x, y, w, h);
  rect(ctx, STONE.base, x + 1, y, w - 2, h - 1);
  for (let sx = x + 2, i = 0; sx < x + w - 3; sx += 5, i++) {
    rect(ctx, STONE.dark, sx + 4, y, 1, h - 1);
    rect(ctx, STONE.light, sx, y, 3, 1);
    if (hash(sx, y, i) > 0.5) rect(ctx, STONE.dark, sx + 1, y + h - 2, 2, 1);
  }
}

/** Framed window with warm light, sill and an optional flower box. */
export function win(ctx: Ctx, x: number, y: number, w: number, h: number, flowers = true) {
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

export function door(ctx: Ctx, x: number, y: number, w: number, h: number, color = "#8a5a3b") {
  box(ctx, TRIM, x - 1, y - 1, w + 2, h + 1, O);
  rect(ctx, color, x + 1, y + 1, w - 2, h - 1);
  for (let px = x + 3; px < x + w - 1; px += 3) rect(ctx, "rgba(0,0,0,0.18)", px, y + 1, 1, h - 1);
  rect(ctx, "#f5c542", x + w - 3, y + Math.floor(h / 2), 1, 2);
}

// ---------------------------------------------------------------- props

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

/** A staked-out plot the size of the building's footprint, with rope and a sign (w x h). */
export function drawPlot(ctx: Ctx, w: number, h: number) {
  const top = 16;
  for (const [x, y] of [[2, top + 4], [w - 3, top + 4], [2, h - 3], [w - 3, h - 3]]) {
    rect(ctx, O, x - 1, y - 3, 3, 6);
    rect(ctx, "#c98f5a", x, y - 2, 1, 4);
  }
  ctx.fillStyle = "#e0c090";
  for (let x = 3; x < w - 3; x += 2) {
    ctx.fillRect(x, top + 3 + (x % 4 === 1 ? 1 : 0), 1, 1);
    ctx.fillRect(x, h - 4 + (x % 4 === 1 ? 1 : 0), 1, 1);
  }
  for (let y = top + 4; y < h - 3; y += 2) {
    ctx.fillRect(2 + (y % 4 === 0 ? 1 : 0), y, 1, 1);
    ctx.fillRect(w - 3 - (y % 4 === 0 ? 1 : 0), y, 1, 1);
  }
  const cx = Math.floor(w / 2);
  rect(ctx, O, cx - 2, 11, 4, h - 14);
  rect(ctx, "#8a5a3b", cx - 1, 11, 2, h - 14);
  box(ctx, "#c98f5a", cx - 14, 0, 28, 14, O);
  rect(ctx, "#e2ad76", cx - 13, 1, 26, 2);
  rect(ctx, "#9c6639", cx - 13, 7, 26, 1);
  rect(ctx, O, cx - 4, 3, 8, 3);
  rect(ctx, O, cx - 1, 6, 2, 6);
}
