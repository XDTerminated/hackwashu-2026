// Dialogue portraits: a 48x48 bust of each villager, Stardew-style, shown on
// the left of the talk box. Built from shapes on a pixel grid and then
// outlined, in the same palettes as the 18x22 island sprites. Three frames
// each: 0 resting, 1 mouth open (lip-flap while they speak), 2 blinking.

import type { VillagerId } from "../../shared/game";
import { INK, hash, type Ctx } from "./pix";

export const PORTRAIT = 48;
export type PortraitFrame = 0 | 1 | 2;
const REST = 0;
const TALK = 1;
const BLINK = 2;

const K = "#241a16";
const SHINE = "#ffffff";

class Grid {
  private px: (string | null)[] = new Array(PORTRAIT * PORTRAIT).fill(null);

  set(x: number, y: number, c: string | null) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < PORTRAIT && y < PORTRAIT) this.px[y * PORTRAIT + x] = c;
  }

  private get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < PORTRAIT && y < PORTRAIT ? this.px[y * PORTRAIT + x] : null;
  }

  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** Pixel list: [x, y] pairs. A null color carves holes. */
  dots(c: string | null, ...pts: [number, number][]) {
    for (const [x, y] of pts) this.set(x, y, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }

  /**
   * Filled ellipse, tested at pixel centers. `shade` darkens the lower-right
   * rim and `light` brightens the upper-left, so shapes read as round.
   * Rows past `clipBelow` are skipped.
   */
  oval(cx: number, cy: number, rx: number, ry: number, c: string, shade?: string, light?: string, clipBelow = Infinity) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      if (y > clipBelow) continue;
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        const t = dx * 0.55 + dy * 0.75;
        this.set(x, y, shade && t > 0.5 ? shade : light && t < -0.62 ? light : c);
      }
    }
  }

  /** Warm dark outline around the whole silhouette (never inside it). */
  outline() {
    const edge: number[] = [];
    for (let y = 0; y < PORTRAIT; y++)
      for (let x = 0; x < PORTRAIT; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) edge.push(y * PORTRAIT + x);
      }
    for (const i of edge) this.px[i] = INK;
  }

  paint(ctx: Ctx) {
    for (let i = 0; i < this.px.length; i++) {
      const c = this.px[i];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(i % PORTRAIT, Math.floor(i / PORTRAIT), 1, 1);
    }
  }
}

// ---------------------------------------------------------------- villagers

function jadeRabbit(g: Grid, f: PortraitFrame) {
  const W = "#f6f6fa", S = "#c9c9dc", P = "#f0a8bc", G = "#3f9b7c", Gd = "#2f7a60", Gl = "#62bf98";
  g.oval(17.5, 11, 4.5, 11, W, S);
  g.oval(30.5, 11, 4.5, 11, W, S);
  g.oval(17.5, 12, 2, 8, P);
  g.oval(30.5, 12, 2, 8, P);
  g.oval(24, 51, 17, 12, W, S);
  g.oval(24, 28, 14, 11.5, W, S);
  // jade scarf, knot trailing over the shoulder
  g.oval(24, 40.5, 11, 2.6, G, Gd, Gl);
  g.rect(29, 41, 4, 6, G);
  g.rect(32, 42, 1, 5, Gd);
  g.rect(29, 46, 4, 1, Gd);
  // blush
  g.oval(14.5, 31.5, 2.5, 1.5, "#f7c4d2");
  g.oval(33.5, 31.5, 2.5, 1.5, "#f7c4d2");
  if (f === BLINK) {
    g.rect(16, 27, 3, 1, K);
    g.rect(29, 27, 3, 1, K);
  } else {
    g.rect(16, 25, 3, 4, K);
    g.rect(29, 25, 3, 4, K);
    g.dots(SHINE, [16, 25], [29, 25]);
  }
  g.rect(22, 30, 4, 1, P);
  g.rect(23, 31, 2, 1, P);
  if (f === TALK) {
    g.rect(22, 33, 4, 3, K);
    g.rect(23, 35, 2, 1, P);
  } else g.dots(K, [22, 33], [23, 34], [24, 34], [25, 33]);
}

function postmaster(g: Grid, f: PortraitFrame) {
  const n = "#8a6a4a", nd = "#6f5238", m = "#a88257", W = "#f4ead8", Wd = "#dccbb0";
  const Y = "#f5c542", Yd = "#d9a441", b = "#e08a3c", bd = "#b8672a";
  const B = "#3f5aa0", Bd = "#2f4580", Bl = "#5a78c4", O = "#e0708a";
  g.oval(24, 51, 18, 13, n, nd);
  g.oval(24, 50, 9, 10, m);
  g.dots(n, [21, 43], [22, 44], [26, 44], [27, 43], [23, 47], [24, 48], [25, 47], [20, 46], [28, 46]);
  // brass postal badge
  g.rect(30, 42, 4, 3, O);
  g.rect(31, 43, 2, 1, Y);
  // ear tufts peek out from under the cap
  g.oval(9.5, 16, 3, 5, n, nd);
  g.oval(38.5, 16, 3, 5, n, nd);
  g.oval(24, 26, 17, 13.5, n, nd, m);
  g.oval(17, 26, 7.5, 7, W, Wd);
  g.oval(31, 26, 7.5, 7, W, Wd);
  if (f === BLINK) {
    g.oval(17, 26, 4.5, 4.5, m);
    g.oval(31, 26, 4.5, 4.5, m);
    g.rect(13, 26, 9, 1, K);
    g.rect(27, 26, 9, 1, K);
  } else {
    g.oval(17, 26, 4.5, 4.5, Y, Yd);
    g.oval(31, 26, 4.5, 4.5, Y, Yd);
    g.rect(16, 25, 3, 3, K);
    g.rect(29, 25, 3, 3, K);
    g.dots(SHINE, [16, 25], [29, 25]);
  }
  if (f === TALK) {
    g.rect(22, 30, 4, 1, b);
    g.rect(23, 31, 2, 1, b);
    g.rect(22, 32, 4, 1, K);
    g.rect(23, 33, 2, 1, b);
    g.rect(23, 34, 2, 1, bd);
  } else {
    g.rect(22, 30, 4, 2, b);
    g.rect(23, 32, 2, 1, b);
    g.rect(23, 33, 2, 1, bd);
  }
  // postal cap
  g.oval(24, 11, 13, 7, B, Bd, Bl, 12);
  g.rect(9, 13, 30, 2, Bd);
  g.rect(22, 7, 4, 3, O);
  g.dots(Y, [23, 8], [24, 8]);
}

function timekeeper(g: Grid, f: PortraitFrame) {
  const gd = "#d9a441", G = "#a87a2a", gl = "#f0c870", W = "#fff8e6", Wd = "#e8dcc0", r = "#d05050", rd = "#a83a3a";
  g.oval(24, 52, 17, 13, gd, G, gl);
  g.rect(21, 36, 6, 4, G);
  g.rect(19, 42, 10, 4, r);
  g.rect(19, 45, 10, 1, rd);
  g.dots(G, [14, 43], [33, 43], [13, 47], [34, 47]);
  // pocket-watch crown and ring
  g.oval(24, 3.5, 3, 2.5, gd, G);
  g.dots(null, [23, 3], [24, 3]);
  g.rect(22, 5, 4, 3, G);
  g.rect(22, 5, 1, 3, gl);
  g.oval(24, 22, 15, 15, gd, G, gl);
  g.oval(24, 22, 12, 12, W, Wd);
  g.rect(23, 11, 2, 2, r);
  g.rect(34, 21, 2, 2, G);
  g.rect(13, 21, 2, 2, G);
  g.rect(23, 32, 2, 2, G);
  if (f === BLINK) {
    g.rect(17, 18, 3, 1, K);
    g.rect(28, 18, 3, 1, K);
  } else {
    g.rect(18, 16, 2, 4, K);
    g.rect(28, 16, 2, 4, K);
  }
  // the hands are the mouth: 10:10 is a grin, 9:15 is mid-word
  if (f === TALK) {
    g.line(22, 27, 18, 27, K);
    g.line(25, 27, 30, 27, K);
  } else {
    g.line(22, 26, 19, 23, K);
    g.line(25, 26, 29, 23, K);
  }
  g.rect(23, 26, 2, 2, r);
}

function scholar(g: Grid, f: PortraitFrame) {
  const b = "#8a6a5a", bd = "#6f5448", l = "#b08a78", c = "#2e2a3a", cd = "#1e1a28", cl = "#4a4560";
  const t = "#f5c542", td = "#c99a3e", gF = "#d9a441", e = "#c8f4ff", ed = "#9fd8e8";
  const n = "#f0a8bc", nd = "#d98aa0", r = "#a51417", rd = "#7e0f12", R = "#c8323a", w = "#fff6ee";
  g.oval(24, 52, 17, 13, r, rd, R);
  g.dots(R, [14, 44], [18, 46], [30, 46], [34, 44], [16, 42], [32, 42]);
  // white collar
  g.rect(18, 38, 5, 1, w); g.rect(25, 38, 5, 1, w);
  g.rect(19, 39, 4, 1, w); g.rect(25, 39, 4, 1, w);
  g.rect(20, 40, 3, 1, w); g.rect(25, 40, 3, 1, w);
  g.rect(21, 41, 2, 1, w); g.rect(25, 41, 2, 1, w);
  g.oval(24, 25, 14, 12, b, bd, l);
  g.oval(24, 30, 7, 4.5, l);
  g.oval(24, 27.5, 2.5, 1.8, n, nd);
  // round spectacles
  g.oval(18, 22, 4.5, 4, gF);
  g.oval(30, 22, 4.5, 4, gF);
  g.oval(18, 22, 3.2, 2.8, e, ed);
  g.oval(30, 22, 3.2, 2.8, e, ed);
  g.rect(22, 21, 4, 1, gF);
  if (f === BLINK) {
    g.rect(16, 22, 3, 1, K);
    g.rect(28, 22, 3, 1, K);
  } else {
    g.rect(17, 21, 2, 2, K);
    g.rect(29, 21, 2, 2, K);
  }
  if (f === TALK) {
    g.rect(22, 32, 4, 3, K);
    g.rect(23, 34, 2, 1, n);
  } else g.dots(K, [22, 32], [23, 33], [24, 33], [25, 32]);
  // mortarboard: skull cap, flat board, tassel
  g.oval(24, 11, 10.5, 4.5, c, cd, cl);
  g.rect(16, 4, 16, 1, c);
  g.rect(12, 5, 24, 1, cl);
  g.rect(9, 6, 30, 1, cl);
  g.rect(8, 7, 32, 1, c);
  g.rect(23, 5, 2, 1, t);
  g.line(25, 5, 37, 6, t);
  g.line(38, 7, 38, 13, t);
  g.rect(37, 14, 3, 2, t);
  g.rect(37, 16, 3, 1, td);
}

function stargazer(g: Grid, f: PortraitFrame) {
  const c = "#7a5fd0", cd = "#5e45b0", C = "#9a7ff0", W = "#f6f6fa", p = "#f0a8bc", O = "#e0708a", Od = "#b44f6c", Y = "#f5c542";
  g.line(19, 13, 15, 5, cd);
  g.line(29, 13, 33, 5, cd);
  g.oval(15, 3.5, 2.2, 2.2, Y, "#d9a441");
  g.oval(33, 3.5, 2.2, 2.2, Y, "#d9a441");
  g.oval(24, 52, 17, 13, c, cd, C);
  g.oval(24, 26, 16, 13.5, c, cd, C);
  g.oval(24, 40.5, 12, 2.6, O, Od);
  g.dots(Y, [31, 39], [30, 40], [31, 40], [32, 40], [31, 41]);
  g.oval(12.5, 30.5, 2.5, 1.5, p);
  g.oval(35.5, 30.5, 2.5, 1.5, p);
  if (f === BLINK) {
    // dreamy, happy-closed eyes
    g.dots(K, [14, 26], [15, 25], [16, 24], [17, 24], [18, 24], [19, 25], [20, 26]);
    g.dots(K, [27, 26], [28, 25], [29, 24], [30, 24], [31, 24], [32, 25], [33, 26]);
  } else {
    g.oval(17.5, 25, 4, 4.5, W);
    g.oval(30.5, 25, 4, 4.5, W);
    g.oval(18, 26, 2.3, 2.8, K);
    g.oval(30, 26, 2.3, 2.8, K);
    g.dots(SHINE, [17, 24], [29, 24]);
    g.dots("#b9a8ff", [18, 27], [30, 27]);
  }
  if (f === TALK) {
    g.oval(24, 33, 2.5, 2, K);
    g.rect(23, 34, 2, 1, p);
  } else g.dots(K, [22, 32], [23, 33], [24, 33], [25, 33], [26, 32]);
}

/** Ada the Team Lead: a sharp bob, a navy blazer over a white collar, a gold star pin. */
function manager(g: Grid, f: PortraitFrame) {
  const s = "#f0c09a", sd = "#d9a07a", sl = "#fbd8b8";
  const h = "#3b2a2a", hd = "#2a1d1d", hl = "#5a4040";
  const b = "#3f4f8a", bd = "#2c386a", bl = "#5a6cb0", w = "#fff6ee", wd = "#dcd3cc";
  const p = "#f0a8bc", y = "#f5c542";
  // the back of the bob, then shoulders
  g.oval(24, 24, 15, 15, h, hd, hl);
  g.oval(24, 52, 17, 13, b, bd, bl);
  // white collar in a V, and the lapels
  g.rect(20, 38, 8, 2, w);
  g.rect(21, 40, 6, 2, w);
  g.rect(22, 42, 4, 2, wd);
  g.line(19, 39, 22, 47, bd);
  g.line(29, 39, 26, 47, bd);
  // gold star pin
  g.dots(y, [14, 44], [13, 45], [14, 45], [15, 45], [14, 46]);
  g.rect(21, 34, 6, 5, sd);
  // face
  g.oval(24, 25, 10.5, 12, s, sd, sl);
  // bangs, cut straight, and the bob's sides to the jaw
  g.oval(24, 15, 11.5, 5.5, h, hd, hl, 17);
  g.rect(12, 16, 3, 16, h);
  g.rect(33, 16, 3, 16, h);
  g.rect(13, 32, 3, 2, hd);
  g.rect(32, 32, 3, 2, hd);
  // brows and eyes
  g.rect(18, 21, 4, 1, hd);
  g.rect(26, 21, 4, 1, hd);
  if (f === BLINK) {
    g.rect(18, 25, 3, 1, K);
    g.rect(27, 25, 3, 1, K);
  } else {
    g.rect(19, 24, 2, 3, K);
    g.rect(27, 24, 2, 3, K);
    g.dots(SHINE, [19, 24], [27, 24]);
  }
  g.dots(p, [16, 29], [17, 29], [31, 29], [32, 29]);
  g.dots(sd, [24, 28]);
  if (f === TALK) {
    g.rect(22, 31, 4, 3, K);
    g.rect(23, 33, 2, 1, p);
  } else g.dots(K, [22, 32], [23, 33], [24, 33], [25, 33], [26, 32]);
}

function dj(g: Grid, f: PortraitFrame) {
  const M = "#c3cbe0", Md = "#8a93ab", Ml = "#e4e9f4", S = "#1f2a44", E = "#7ff0e8", Ed = "#3fb8b0";
  const H = "#e0708a", Hd = "#b44f6c", Hl = "#f2a3b8", Y = "#f5c542", sp = "#2e2a3a", cone = "#6b6f86";
  // shoulders, with a speaker in the chest
  g.oval(24, 53, 18, 13, M, Md, Ml);
  g.oval(24, 47, 6, 5, sp);
  g.oval(24, 47, 3.5, 3, f === TALK ? "#a3a7c0" : cone);
  g.rect(21, 35, 6, 5, Md);
  // antenna and its light
  g.line(24, 10, 24, 4, Md);
  g.oval(24, 3, 2.2, 2.2, f === BLINK ? "#a8863a" : Y, "#d9a441");
  // the head: a rounded box
  g.rect(12, 11, 25, 25, M);
  g.rect(36, 11, 1, 25, Md);
  g.rect(12, 35, 25, 1, Md);
  g.rect(12, 11, 25, 1, Ml);
  g.rect(12, 11, 1, 25, Ml);
  g.dots(null, [12, 11], [13, 11], [12, 12], [36, 11], [35, 11], [36, 12], [12, 35], [13, 35], [12, 34], [36, 35], [35, 35], [36, 34]);
  // the screen face
  g.rect(15, 15, 19, 17, S);
  if (f === BLINK) {
    // happy ^ ^
    g.dots(E, [17, 22], [18, 21], [19, 20], [20, 21], [21, 22], [27, 22], [28, 21], [29, 20], [30, 21], [31, 22]);
  } else {
    g.oval(19.5, 21, 2.5, 3, E, Ed);
    g.oval(29.5, 21, 2.5, 3, E, Ed);
    g.dots(SHINE, [18, 20], [28, 20]);
  }
  g.dots(H, [17, 26], [32, 26]);
  // the mouth is a little equalizer (jumping while they talk)
  const bars = f === TALK ? [2, 4, 3, 5, 2] : [1, 1, 1, 1, 1];
  bars.forEach((h, i) => g.rect(20 + i * 2, 30 - h, 1, h, E));
  // headphones: the band over the top, the cups on the sides
  for (let a = Math.PI; a <= Math.PI * 2 + 0.001; a += 0.02) {
    for (const r of [15, 16]) g.set(24.5 + Math.cos(a) * r, 22 + Math.sin(a) * 13, a < Math.PI * 1.5 ? H : Hd);
  }
  g.oval(9.5, 23, 3.5, 6, H, Hd, Hl);
  g.oval(39.5, 23, 3.5, 6, H, Hd, Hl);
}

const DRAW: Record<VillagerId, (g: Grid, f: PortraitFrame) => void> = {
  jade_rabbit: jadeRabbit,
  postmaster,
  timekeeper,
  scholar,
  stargazer,
  manager,
  dj,
};

export function drawPortrait(ctx: Ctx, v: VillagerId, f: PortraitFrame) {
  const g = new Grid();
  DRAW[v](g, f);
  g.outline();
  g.paint(ctx);
}

/** The night sky behind every portrait, in stepped bands with a few stars. */
export function drawPortraitSky(ctx: Ctx, size: number) {
  const bands = ["#191330", "#1e1738", "#241c42", "#2b224d"];
  for (let y = 0; y < size; y++) {
    ctx.fillStyle = bands[Math.min(bands.length - 1, Math.floor((y * bands.length) / size))];
    ctx.fillRect(0, y, size, 1);
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const h = hash(x, y, 7);
      if (h > 0.985) {
        ctx.fillStyle = h > 0.995 ? "#bff6f4" : "#fff6e6";
        ctx.fillRect(x, y, 1, 1);
      }
    }
}
