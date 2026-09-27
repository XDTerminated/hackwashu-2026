// Little stars: the critters that run your errands (pop them for coins), the
// builders on a construction site, the agents in the Office, and the plain
// star beside the logo and on top of the fountain. One shape, any size.

import { type Ctx, INK, rect } from "./pix";

/** Starlight colors, so a crowd of them isn't identical. */
export const STAR_COLORS = [
  { body: "#ffd95e", shade: "#e0a92e", light: "#fff4b5" }, // gold
  { body: "#ffe98a", shade: "#dcbc48", light: "#fffbd9" }, // pale yellow
  { body: "#f3f0ff", shade: "#c2bbe0", light: "#ffffff" }, // white
  { body: "#bfe2ff", shade: "#86b3de", light: "#eef8ff" }, // blue-white
  { body: "#ffcbe2", shade: "#df98b8", light: "#fff0f7" }, // pink
  { body: "#dccfff", shade: "#a896e0", light: "#f4f0ff" }, // lilac
];

/** Which pixels of an s x s square a chubby five-point star covers (points up, turned by `rot`). */
function starMask(s: number, rot: number): boolean[][] {
  const c = (s - 1) / 2;
  const R = s / 2 - 0.2;
  const r = R * 0.5;
  const pts = Array.from({ length: 10 }, (_, k) => {
    const a = -Math.PI / 2 + rot + (k * Math.PI) / 5;
    const rad = k % 2 ? r : R;
    return [c + Math.cos(a) * rad, c + Math.sin(a) * rad * 1.02 + s * 0.04];
  });
  const inside = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  return Array.from({ length: s }, (_, y) => Array.from({ length: s }, (_, x) => inside(x, y)));
}

export interface StarLook {
  /** Which starlight color (see STAR_COLORS). */
  color?: number;
  /** Turn it a little (radians): a waddle, or a wiggle while typing. */
  rot?: number;
  /** Eyes and rosy cheeks (off for a star seen from behind, or a plain one). */
  face?: boolean;
}

/**
 * A star `s` pixels across with its top-left at (x, y), outline included
 * (the star itself is s - 2 across). Lit from the top left.
 */
export function drawStar(ctx: Ctx, x: number, y: number, s: number, look: StarLook = {}) {
  const { color = 0, rot = 0, face = true } = look;
  const pal = STAR_COLORS[color % STAR_COLORS.length];
  const n = s - 2;
  const m = starMask(n, rot);
  const on = (px: number, py: number) => py >= 0 && py < n && px >= 0 && px < n && m[py][px];
  // ink outline all round
  for (let py = -1; py <= n; py++)
    for (let px = -1; px <= n; px++)
      if (!on(px, py) && (on(px - 1, py) || on(px + 1, py) || on(px, py - 1) || on(px, py + 1))) rect(ctx, INK, x + 1 + px, y + 1 + py, 1, 1);
  for (let py = 0; py < n; py++)
    for (let px = 0; px < n; px++) {
      if (!on(px, py)) continue;
      const c = !on(px, py - 1) || !on(px - 1, py) ? pal.light : !on(px, py + 1) || !on(px + 1, py) ? pal.shade : pal.body;
      rect(ctx, c, x + 1 + px, y + 1 + py, 1, 1);
    }
  if (face && n >= 7) {
    const c = Math.floor((n - 1) / 2);
    const gap = Math.max(1, Math.round(n * 0.14));
    const ey = y + 1 + Math.round(n * 0.46);
    const eh = n >= 13 ? 2 : 1;
    const ew = n >= 20 ? 2 : 1;
    rect(ctx, INK, x + 1 + c - gap - (ew - 1), ey, ew, eh);
    rect(ctx, INK, x + 1 + c + gap + (n % 2 ? 0 : 1), ey, ew, eh);
    if (n >= 11) {
      rect(ctx, "#f28aa8", x + 1 + c - gap - ew, ey + eh + 1, 1, 1);
      rect(ctx, "#f28aa8", x + 1 + c + gap + ew + (n % 2 ? 0 : 1), ey + eh + 1, 1, 1);
    }
  }
}
