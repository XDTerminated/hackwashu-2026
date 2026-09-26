// Pixel-crisp canvas drawing helpers (no antialiasing anywhere).

export type Ctx = CanvasRenderingContext2D;

/** Stardew-style outlines: dark, warm and tinted — never pure black. */
export const INK = "#3b2a3a";
export const WOOD_INK = "#4a2f27";

export const rect = (ctx: Ctx, color: string, x: number, y: number, w: number, h: number) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

/** Filled rect with a 1px outline. */
export const box = (ctx: Ctx, fill: string, x: number, y: number, w: number, h: number, ink = INK) => {
  rect(ctx, ink, x, y, w, h);
  rect(ctx, fill, x + 1, y + 1, w - 2, h - 2);
};

/** Pixel disc / ellipse via per-pixel test. `clipBelow` cuts rows past that y. */
export function disc(ctx: Ctx, color: string, cx: number, cy: number, rx: number, ry = rx, clipBelow?: number) {
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    if (clipBelow !== undefined && y > clipBelow) continue;
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** Deterministic hash noise in [0, 1) — same island every load. */
export function hash(x: number, y: number, seed = 0): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
