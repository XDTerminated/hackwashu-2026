// The Claude Code mascot, on one grid so every size matches: a wide orange
// body, a nub on each side, two tall square eyes, four little legs. Drawn at
// `u` art pixels per mascot pixel (1 for the critters around the island, 2 in
// the Office), with an ink outline so it reads on any ground.
//
// Grid (in mascot pixels): 16 wide x 8 tall.
//   body  x 2..13, y 0..5      nubs  x 0..1 and 14..15, y 3
//   eyes  x 4 and 11, y 2..3   legs  x 4, 6, 9, 11, y 6..7

import { type Ctx, INK, rect } from "./pix";

export const MASCOT_ORANGE = ["#d97757", "#de8262", "#d26f51", "#e08b68", "#cc6a4d", "#da7c5c"];
const MASCOT_SHADE = ["#b85c3e", "#bd6547", "#b0553a", "#be6d4e", "#a95237", "#b9603f"];

/** Size in art pixels at `u` pixels per mascot pixel (outline included). */
export const mascotSize = (u: number) => ({ w: 16 * u + 2, h: 8 * u + 2 });

export interface MascotLook {
  /** Which of the close orange shades (so a crowd isn't identical). */
  shade?: number;
  eyes?: boolean;
  legs?: boolean;
  /** Walking: 0 or 1 lifts alternate legs. */
  step?: number;
  /** Nudge each nub up (-) or down (+), in art pixels: tapping away at a keyboard. */
  nubs?: [number, number];
}

/** Draw the mascot with its top-left (outline included) at (x, y). */
export function drawMascot(ctx: Ctx, x: number, y: number, u: number, look: MascotLook = {}) {
  const { shade = 0, eyes = true, legs = true, step = 0, nubs = [0, 0] } = look;
  const body = MASCOT_ORANGE[shade % MASCOT_ORANGE.length];
  const dark = MASCOT_SHADE[shade % MASCOT_SHADE.length];
  const ox = x + 1;
  const oy = y + 1;
  const parts: [number, number, number, number, string][] = [
    [ox + 2 * u, oy, 12 * u, 6 * u, body],
    [ox, oy + 3 * u + nubs[0], 2 * u, u, body],
    [ox + 14 * u, oy + 3 * u + nubs[1], 2 * u, u, body],
  ];
  if (legs)
    [4, 6, 9, 11].forEach((lx, i) => {
      // (a step lifts every other leg one pixel)
      const lift = step && i % 2 === (step === 1 ? 0 : 1) ? 1 : 0;
      parts.push([ox + lx * u, oy + 6 * u, u, 2 * u - lift, dark]);
    });
  for (const [px, py, w, h] of parts) rect(ctx, INK, px - 1, py - 1, w + 2, h + 2);
  for (const [px, py, w, h, c] of parts) rect(ctx, c, px, py, w, h);
  // a little weight along the bottom of the body
  rect(ctx, dark, ox + 2 * u, oy + 6 * u - Math.max(1, u), 12 * u, Math.max(1, u));
  if (eyes) {
    rect(ctx, INK, ox + 4 * u, oy + 2 * u, u, 2 * u);
    rect(ctx, INK, ox + 11 * u, oy + 2 * u, u, 2 * u);
  }
}

/**
 * The mascot as a HUD / button icon: same shape, 11 x 5 mascot pixels (13 x 7
 * with the outline), with its top-left at (x, y).
 */
export function drawMascotIcon(ctx: Ctx, x: number, y: number) {
  const ox = x + 1;
  const oy = y + 1;
  const parts: [number, number, number, number, string][] = [
    [ox + 1, oy, 9, 4, MASCOT_ORANGE[0]],
    [ox, oy + 2, 1, 1, MASCOT_ORANGE[0]],
    [ox + 10, oy + 2, 1, 1, MASCOT_ORANGE[0]],
    ...[2, 4, 6, 8].map((lx) => [ox + lx, oy + 4, 1, 1, MASCOT_SHADE[0]] as [number, number, number, number, string]),
  ];
  for (const [px, py, w, h] of parts) rect(ctx, INK, px - 1, py - 1, w + 2, h + 2);
  for (const [px, py, w, h, c] of parts) rect(ctx, c, px, py, w, h);
  rect(ctx, INK, ox + 3, oy + 1, 1, 2);
  rect(ctx, INK, ox + 7, oy + 1, 1, 2);
}
