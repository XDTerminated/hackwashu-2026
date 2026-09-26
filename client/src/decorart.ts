// Supply Pod decorations, drawn at native size in the same Stardew style as
// the buildings (warm ink outlines, 3-tone shading). Never scaled in-game.

import { type Ctx, INK as O, WOOD_INK, disc, hash, rect } from "./pix";

const ROCK = { base: "#a79fb4", dark: "#8a8298", light: "#c9c1d4" };
const METAL = { base: "#c9cbd6", dark: "#8f93a3", light: "#eef0f6" };
const WOOD = { base: "#a86f43", dark: "#8a5a3b", light: "#c98f5a" };
const JADE = { base: "#5fb58a", dark: "#3f8a66", light: "#8fdcb0" };
const CORAL = "#d97757";

export interface DecorArt {
  w: number;
  h: number;
  frames: number;
  /** `lit` is false for a light that's been switched off. */
  draw: (ctx: Ctx, frame: number, lit: boolean) => void;
}

function line(ctx: Ctx, color: string, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) rect(ctx, color, Math.round(x0 + ((x1 - x0) * i) / (n || 1)), Math.round(y0 + ((y1 - y0) * i) / (n || 1)), 1, 1);
}

/** A little outlined rock mound for things to stand on. */
function mound(ctx: Ctx, x: number, y: number, w: number) {
  rect(ctx, O, x + 1, y, w - 2, 1);
  rect(ctx, O, x, y + 1, w, 2);
  rect(ctx, ROCK.base, x + 1, y + 1, w - 2, 1);
  rect(ctx, ROCK.light, x + 2, y + 1, Math.max(1, Math.round(w / 3)), 1);
}

/** Pointy crystal prism, lit from the left. */
function prism(ctx: Ctx, cx: number, by: number, hw: number, h: number, c: { light: string; base: string; dark: string }) {
  for (let dx = -hw - 1; dx <= hw + 1; dx++) rect(ctx, O, cx + dx, by - h - 1 + Math.round(Math.abs(dx) * 1.4), 1, h + 1 - Math.round(Math.abs(dx) * 1.4));
  for (let dx = -hw; dx <= hw; dx++) {
    const top = by - h + Math.round(Math.abs(dx) * 1.4);
    rect(ctx, dx < 0 ? c.light : dx === 0 ? c.base : c.dark, cx + dx, top, 1, by - top);
  }
}

const art: Record<string, DecorArt> = {
  flag: {
    w: 22,
    h: 32,
    frames: 2,
    draw(ctx, f) {
      mound(ctx, 2, 29, 12);
      rect(ctx, O, 6, 3, 3, 27);
      rect(ctx, METAL.base, 7, 4, 1, 25);
      disc(ctx, O, 7.5, 2.5, 2.5);
      disc(ctx, "#f5c542", 7.5, 2.5, 1.5);
      rect(ctx, "#fff1b0", 7, 2, 1, 1);
      // Cloth, rippling away from the pole.
      const W = 13;
      const H = 9;
      for (let u = 0; u < W; u++) {
        const dy = Math.round(Math.sin(u * 0.7 + (f ? Math.PI : 0)) * 1.2 * (u / (W - 1)));
        for (let v = 0; v < H; v++) {
          const edge = v === 0 || v === H - 1 || u === W - 1;
          const moon = (u - 6) ** 2 + (v - 4) ** 2 <= 7 && !((u - 7.3) ** 2 + (v - 3.3) ** 2 <= 5);
          const c = edge ? O : moon ? "#fff6e6" : v === H - 2 ? "#b85c3e" : v === 1 ? "#eb9a7c" : CORAL;
          rect(ctx, c, 9 + u, 5 + v + dy, 1, 1);
        }
      }
    },
  },

  lantern: {
    w: 18,
    h: 30,
    frames: 2,
    draw(ctx, f, lit) {
      rect(ctx, O, 1, 27, 9, 3);
      rect(ctx, WOOD.dark, 2, 28, 7, 1);
      rect(ctx, O, 3, 3, 4, 25);
      rect(ctx, WOOD.base, 4, 4, 2, 24);
      rect(ctx, WOOD.light, 4, 4, 1, 24);
      rect(ctx, O, 3, 3, 12, 3);
      rect(ctx, WOOD.base, 4, 4, 10, 1);
      rect(ctx, O, 12, 6, 1, 3);
      // The lantern: red paper over a warm candle.
      disc(ctx, O, 12.5, 15, 5, 6);
      disc(ctx, lit ? "#d9503f" : "#a33a2e", 12.5, 15, 4, 5);
      disc(ctx, !lit ? "#7a2e28" : f ? "#ffd98a" : "#f7b267", 12.5, 15.5, 2, 3);
      rect(ctx, "#b23a2e", 12, 10, 1, 3);
      rect(ctx, "#b23a2e", 12, 18, 1, 3);
      rect(ctx, lit ? "#ef7a5e" : "#c24a3a", 10, 12, 1, 5);
      rect(ctx, O, 10, 8, 6, 2);
      rect(ctx, "#f5c542", 11, 8, 4, 1);
      rect(ctx, O, 10, 21, 6, 2);
      rect(ctx, "#f5c542", 11, 22, 4, 1);
      rect(ctx, "#f5c542", 12, 23, 1, 4);
      rect(ctx, "#c99a3e", 12, 26, 1, 1);
    },
  },

  crystal: {
    w: 22,
    h: 22,
    frames: 2,
    draw(ctx, f) {
      mound(ctx, 2, 19, 18);
      const C = { light: "#bff6f2", base: "#6fe3e1", dark: "#3aa6b8" };
      prism(ctx, 11, 19, 3, 16, C);
      prism(ctx, 5, 20, 2, 9, { light: "#d7c9ff", base: "#a98ff0", dark: "#7a62c9" });
      prism(ctx, 16, 20, 2, 11, C);
      if (f) {
        rect(ctx, "#ffffff", 9, 7, 1, 3);
        rect(ctx, "#ffffff", 8, 8, 3, 1);
      } else rect(ctx, "#ffffff", 15, 12, 1, 1);
    },
  },

  tree: {
    w: 34,
    h: 44,
    frames: 1,
    draw(ctx) {
      rect(ctx, O, 13, 28, 8, 16);
      rect(ctx, O, 10, 41, 14, 3);
      rect(ctx, WOOD.dark, 14, 29, 6, 14);
      rect(ctx, WOOD.base, 14, 29, 3, 14);
      rect(ctx, WOOD.dark, 11, 42, 12, 1);
      const lobes: [number, number, number, number][] = [
        [17, 16, 14, 12],
        [8, 22, 7, 6],
        [26, 22, 7, 6],
        [11, 10, 7, 6],
        [23, 10, 7, 6],
      ];
      for (const [x, y, rx, ry] of lobes) disc(ctx, O, x, y, rx + 1, ry + 1);
      for (const [x, y, rx, ry] of lobes) disc(ctx, "#3f7a36", x, y, rx, ry);
      for (const [x, y, rx, ry] of lobes) disc(ctx, "#5a9a44", x - 1, y - 1, rx - 1.5, ry - 1.5);
      for (const [x, y, rx, ry] of lobes) disc(ctx, "#7cbf55", x - 2, y - 2.5, rx * 0.45, ry * 0.4);
      // Osmanthus: tiny gold blossoms.
      for (let i = 0; i < 40; i++) {
        const x = 3 + Math.floor(hash(i, 1, 7) * 28);
        const y = 3 + Math.floor(hash(i, 2, 7) * 26);
        if (lobes.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 0.75)) {
          rect(ctx, hash(i, 3, 7) < 0.5 ? "#f5c542" : "#ffe08a", x, y, 1, 1);
        }
      }
    },
  },

  dish: {
    w: 26,
    h: 32,
    frames: 2,
    draw(ctx, f) {
      rect(ctx, O, 3, 30, 20, 2);
      line(ctx, O, 13, 19, 5, 29);
      line(ctx, O, 13, 19, 21, 29);
      line(ctx, METAL.dark, 13, 20, 6, 29);
      line(ctx, METAL.dark, 13, 20, 20, 29);
      rect(ctx, O, 12, 19, 3, 11);
      rect(ctx, METAL.base, 13, 20, 1, 10);
      rect(ctx, O, 9, 16, 9, 5);
      rect(ctx, METAL.dark, 10, 17, 7, 3);
      rect(ctx, METAL.base, 10, 17, 7, 1);
      // The dish, tipped up toward Earth.
      disc(ctx, O, 14, 11, 11, 7);
      disc(ctx, METAL.light, 14, 11, 10, 6);
      disc(ctx, METAL.base, 15, 12, 7, 4);
      disc(ctx, METAL.dark, 16, 13, 3, 2);
      rect(ctx, "#ffffff", 7, 8, 4, 1);
      line(ctx, O, 14, 11, 8, 3);
      rect(ctx, O, 5, 0, 5, 5);
      rect(ctx, "#f5c542", 6, 1, 3, 3);
      rect(ctx, f ? "#ff5a4a" : "#8a2a22", 7, 2, 1, 1);
    },
  },

  dome: {
    w: 46,
    h: 34,
    frames: 1,
    draw(ctx, _f, lit) {
      // Glass shell with struts, sitting in a metal ring.
      disc(ctx, O, 23, 28, 21, 26, 28);
      disc(ctx, "#8fcde3", 23, 28, 20, 25, 28);
      disc(ctx, "#a9dcec", 20, 22, 14, 17, 28);
      disc(ctx, "#c9ecf6", 17, 14, 7, 7);
      for (let y = 4; y <= 28; y++) {
        const t = (28 - y) / 25;
        const half = Math.round(11 * Math.sqrt(Math.max(0, 1 - t * t)));
        rect(ctx, "#5f8fae", 23 - half, y, 1, 1);
        rect(ctx, "#5f8fae", 23 + half, y, 1, 1);
      }
      rect(ctx, "#5f8fae", 23, 3, 1, 26);
      for (let x = 4; x <= 42; x++) {
        const dx = (x - 23) / 20;
        if (Math.abs(dx) < 0.93) rect(ctx, "#5f8fae", x, 18, 1, 1);
      }
      // Inside: a little garden and a warm lamp.
      disc(ctx, "#4f8a3c", 12, 26, 4, 3);
      disc(ctx, "#7cbf55", 11, 25, 2, 1.5);
      rect(ctx, lit ? "#ffd98a" : "#6f6a80", 33, 23, 3, 3);
      rect(ctx, lit ? "#fff1b0" : "#8a8298", 34, 24, 1, 1);
      rect(ctx, "#ffffff", 14, 9, 3, 1);
      rect(ctx, "#ffffff", 12, 11, 1, 2);
      // Airlock.
      rect(ctx, O, 18, 17, 11, 12);
      rect(ctx, METAL.base, 19, 18, 9, 11);
      rect(ctx, METAL.light, 19, 18, 9, 1);
      disc(ctx, O, 23.5, 22, 2.5);
      disc(ctx, "#4f7fcf", 23.5, 22, 1.5);
      rect(ctx, O, 1, 28, 44, 6);
      rect(ctx, METAL.base, 2, 29, 42, 4);
      rect(ctx, METAL.light, 2, 29, 42, 1);
      rect(ctx, METAL.dark, 2, 32, 42, 1);
      for (let x = 6; x < 42; x += 8) rect(ctx, "#f5c542", x, 30, 2, 1);
    },
  },

  bench: {
    w: 30,
    h: 18,
    frames: 1,
    draw(ctx) {
      for (const x of [3, 24]) {
        rect(ctx, O, x, 10, 3, 8);
        rect(ctx, METAL.dark, x + 1, 11, 1, 7);
      }
      for (const [y, h] of [
        [1, 3],
        [5, 3],
        [9, 4],
      ] as const) {
        rect(ctx, WOOD_INK, 1, y, 28, h);
        rect(ctx, WOOD.base, 2, y + 1, 26, h - 2);
        rect(ctx, WOOD.light, 2, y + 1, 26, 1);
      }
      for (const x of [5, 23]) rect(ctx, WOOD_INK, x, 1, 2, 9);
    },
  },

  planter: {
    w: 26,
    h: 20,
    frames: 1,
    draw(ctx) {
      const stems: [number, number, string][] = [
        [5, 4, "#cfe7ff"],
        [9, 1, "#b7a4f0"],
        [13, 3, "#cfe7ff"],
        [17, 0, "#cfe7ff"],
        [21, 4, "#b7a4f0"],
      ];
      for (const [x, top] of stems) rect(ctx, "#4f8a3c", x, top + 3, 1, 10 - top);
      for (const [x, top, c] of stems) {
        disc(ctx, O, x + 0.5, top + 2.5, 2.5);
        disc(ctx, c, x + 0.5, top + 2.5, 1.6);
        rect(ctx, "#fff6c2", x, top + 2, 1, 1);
      }
      rect(ctx, "#6fae4a", 7, 10, 2, 1);
      rect(ctx, "#6fae4a", 18, 9, 2, 1);
      rect(ctx, WOOD_INK, 0, 10, 26, 3);
      rect(ctx, WOOD.light, 1, 11, 24, 1);
      rect(ctx, WOOD_INK, 1, 12, 24, 8);
      rect(ctx, WOOD.base, 2, 13, 22, 6);
      rect(ctx, WOOD.dark, 2, 16, 22, 1);
      rect(ctx, WOOD.dark, 12, 13, 1, 6);
    },
  },

  solar: {
    w: 28,
    h: 24,
    frames: 2,
    draw(ctx, f) {
      rect(ctx, O, 8, 21, 12, 3);
      rect(ctx, METAL.dark, 9, 22, 10, 1);
      rect(ctx, O, 12, 11, 4, 11);
      rect(ctx, METAL.base, 13, 12, 2, 10);
      // Tilted panel.
      for (let y = 1; y <= 13; y++) {
        const xl = Math.round(6 - (y - 1) * 0.42);
        const edge = y === 1 || y === 13;
        rect(ctx, O, xl, y, 22, 1);
        if (!edge) {
          for (let x = xl + 1; x < xl + 21; x++) {
            const gridX = (x - xl) % 5 === 0;
            const gridY = y === 7;
            const glint = f && Math.abs(x - xl - (y + 6)) < 1;
            rect(ctx, glint ? "#dff0ff" : gridX || gridY ? "#6f9fe8" : y < 4 ? "#3f68b8" : "#2f4f8f", x, y, 1, 1);
          }
        }
      }
      rect(ctx, "#a9ccff", 7, 2, 4, 1);
    },
  },

  statue: {
    w: 22,
    h: 34,
    frames: 1,
    draw(ctx) {
      rect(ctx, O, 2, 23, 18, 11);
      rect(ctx, ROCK.base, 3, 24, 16, 9);
      rect(ctx, ROCK.dark, 3, 31, 16, 2);
      rect(ctx, O, 1, 22, 20, 3);
      rect(ctx, ROCK.light, 2, 23, 18, 1);
      rect(ctx, "#f5c542", 8, 27, 6, 2);
      // The rabbit, in moon-jade, with her pestle.
      disc(ctx, O, 11, 16, 6.5, 6.5, 21);
      rect(ctx, O, 5, 16, 13, 6);
      disc(ctx, JADE.base, 11, 16, 5.5, 5.5, 21);
      rect(ctx, JADE.base, 6, 16, 11, 5);
      disc(ctx, JADE.light, 9, 14, 2.5, 2.5);
      rect(ctx, JADE.dark, 13, 17, 4, 4);
      disc(ctx, O, 11, 8, 5, 4.5);
      disc(ctx, JADE.base, 11, 8, 4, 3.5);
      rect(ctx, JADE.light, 9, 6, 2, 1);
      for (const x of [7, 12]) {
        rect(ctx, O, x, 0, 4, 6);
        rect(ctx, JADE.base, x + 1, 1, 2, 5);
        rect(ctx, JADE.light, x + 1, 1, 1, 3);
      }
      rect(ctx, O, 9, 8, 1, 1);
      rect(ctx, O, 13, 8, 1, 1);
      rect(ctx, "#e89aa8", 11, 10, 1, 1);
      rect(ctx, O, 16, 9, 3, 12);
      rect(ctx, JADE.light, 17, 10, 1, 10);
    },
  },

  pond: {
    w: 40,
    h: 18,
    frames: 2,
    draw(ctx, f) {
      disc(ctx, O, 20, 9, 19.5, 8.5);
      disc(ctx, ROCK.base, 20, 9, 18.5, 7.5);
      disc(ctx, ROCK.light, 18, 7, 15, 5);
      disc(ctx, O, 20, 9.5, 15, 5.5);
      disc(ctx, "#7fc6e6", 20, 9.5, 14, 4.5);
      disc(ctx, "#5aa7cf", 22, 10.5, 9, 2.5);
      for (let i = 0; i < 10; i++) {
        const a = hash(i, 5, 3) * Math.PI * 2;
        rect(ctx, ROCK.dark, Math.round(20 + Math.cos(a) * 17.5), Math.round(9 + Math.sin(a) * 7), 2, 1);
      }
      const s = f ? 3 : 0;
      rect(ctx, "#dff4fb", 11 + s, 7, 5, 1);
      rect(ctx, "#dff4fb", 24 - s, 11, 4, 1);
      rect(ctx, "#ffffff", 13 + s, 7, 1, 1);
    },
  },

  rover: {
    w: 32,
    h: 24,
    frames: 2,
    draw(ctx, f) {
      rect(ctx, O, 7, 1, 1, 9);
      rect(ctx, O, 5, 0, 5, 3);
      rect(ctx, f ? "#ff5a4a" : "#8a2a22", 6, 1, 3, 1);
      rect(ctx, O, 3, 10, 26, 9);
      rect(ctx, METAL.light, 4, 11, 24, 7);
      rect(ctx, METAL.base, 4, 16, 24, 2);
      rect(ctx, CORAL, 4, 14, 24, 1);
      rect(ctx, O, 3, 8, 12, 3);
      rect(ctx, "#2f4f8f", 4, 9, 10, 1);
      rect(ctx, O, 17, 4, 11, 7);
      rect(ctx, METAL.light, 18, 5, 9, 6);
      rect(ctx, O, 19, 6, 7, 4);
      rect(ctx, "#4f7fcf", 20, 7, 5, 2);
      rect(ctx, "#a9ccff", 20, 7, 2, 1);
      for (const x of [7, 16, 25]) {
        disc(ctx, O, x, 20, 4, 4);
        disc(ctx, "#5b5470", x, 20, 3, 3);
        rect(ctx, METAL.base, x - 1, 19, 2, 2);
      }
    },
  },
};

// ---------------------------------------------------------------- more decorations

const RED = { base: "#d9503f", dark: "#a33a2e", light: "#ef7a5e" };
const GOLD = { base: "#f5c542", dark: "#c99a3e", light: "#fff1b0" };
const WATER = { base: "#7fc6e6", dark: "#5aa7cf", light: "#dff4fb" };

/** A crescent: the outer disc minus an offset inner disc, outlined on both edges. */
function crescent(ctx: Ctx, cx: number, cy: number, r: number, ox: number, oy: number, ir: number, c: { base: string; light: string }) {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const di = Math.hypot(x + 0.5 - cx - ox, y + 0.5 - cy - oy);
      if (d > r || di <= ir) continue;
      const edge = d > r - 1 || di < ir + 1;
      rect(ctx, edge ? O : x < cx - r * 0.3 ? c.light : c.base, x, y, 1, 1);
    }
  }
}

/** Upturned East Asian roof eave, `w` wide with its top at `y`. */
function eave(ctx: Ctx, x: number, y: number, w: number, tile: { base: string; dark: string; light: string }) {
  rect(ctx, O, x + 2, y, w - 4, 1);
  rect(ctx, O, x, y + 1, w, 3);
  rect(ctx, tile.base, x + 1, y + 1, w - 2, 2);
  for (let tx = x + 2; tx < x + w - 2; tx += 3) rect(ctx, tile.dark, tx, y + 1, 1, 2);
  rect(ctx, tile.light, x + 2, y + 1, w - 4, 1);
  // tips curl up
  rect(ctx, O, x - 1, y - 1, 2, 2);
  rect(ctx, O, x + w - 1, y - 1, 2, 2);
  rect(ctx, GOLD.base, x - 1, y - 1, 1, 1);
  rect(ctx, GOLD.base, x + w, y - 1, 1, 1);
}

const TILE_GREEN = { base: "#3f8a66", dark: "#2c6a4c", light: "#5fb58a" };

Object.assign(art, {
  shrub: {
    w: 18,
    h: 16,
    frames: 1,
    draw(ctx) {
      const lobes: [number, number, number, number][] = [[9, 10, 8, 6], [6, 7, 5, 5], [12, 6, 5, 5]];
      for (const [x, y, rx, ry] of lobes) disc(ctx, O, x, y, rx, ry);
      for (const [x, y, rx, ry] of lobes) disc(ctx, "#5f8f7a", x, y, rx - 1, ry - 1);
      disc(ctx, "#8fbfa8", 5, 6, 2.5, 2.5);
      disc(ctx, "#8fbfa8", 11, 5, 2.5, 2);
      rect(ctx, "#c8ecd8", 4, 5, 1, 1);
      for (const [x, y] of [[8, 9], [13, 10], [5, 11], [11, 12], [15, 7]]) {
        rect(ctx, "#cfe7ff", x, y, 1, 1);
        rect(ctx, "#6f9fe8", x, y + 1, 1, 1);
      }
    },
  },

  rockgarden: {
    w: 42,
    h: 18,
    frames: 1,
    draw(ctx) {
      rect(ctx, O, 1, 2, 40, 15);
      rect(ctx, O, 0, 3, 42, 13);
      rect(ctx, WOOD.dark, 1, 3, 40, 13);
      rect(ctx, "#e8dcc0", 2, 4, 38, 11);
      const rocks: [number, number, number, number][] = [[11, 9, 4, 3], [29, 10, 5, 3.5], [21, 6, 2.5, 2]];
      for (let y = 5; y < 15; y += 2) {
        for (let x = 3; x < 39; x++) {
          if (rocks.some(([cx, cy, rx, ry]) => ((x - cx) / (rx + 2)) ** 2 + ((y - cy) / (ry + 1.5)) ** 2 < 1)) continue;
          rect(ctx, "#cfc0a0", x, y, 1, 1);
        }
      }
      for (const [x, y, rx, ry] of rocks) {
        disc(ctx, "#cfc0a0", x, y, rx + 2, ry + 1.5);
        disc(ctx, "#e8dcc0", x, y, rx + 1, ry + 0.8);
        disc(ctx, O, x, y, rx, ry);
        disc(ctx, ROCK.base, x, y, rx - 1, ry - 1);
        rect(ctx, ROCK.light, x - rx + 2, y - ry + 1, 2, 1);
      }
      rect(ctx, "#4f9e54", 30, 6, 2, 1);
    },
  },

  fountain: {
    w: 42,
    h: 34,
    frames: 2,
    draw(ctx, f) {
      // lower basin
      disc(ctx, O, 21, 27, 20, 6.5);
      disc(ctx, ROCK.light, 21, 27, 19, 5.5);
      disc(ctx, ROCK.base, 21, 28.5, 19, 4, undefined);
      disc(ctx, O, 21, 25.5, 16, 3.8);
      disc(ctx, WATER.base, 21, 25.5, 15, 3);
      disc(ctx, WATER.dark, 22, 26.5, 9, 1.5);
      // pillar + upper bowl
      rect(ctx, O, 18, 13, 6, 13);
      rect(ctx, ROCK.base, 19, 13, 4, 13);
      rect(ctx, ROCK.light, 19, 13, 1, 13);
      disc(ctx, O, 21, 13, 10, 3.8);
      disc(ctx, ROCK.light, 21, 13, 9, 2.8);
      disc(ctx, WATER.base, 21, 12.5, 7, 1.6);
      // spout + falling water
      rect(ctx, O, 19, 4, 4, 9);
      rect(ctx, WATER.light, 20, 4, 2, 8);
      disc(ctx, WATER.light, 21, 4, 3, 1.8);
      const drops = f ? [[10, 16], [9, 19], [8, 22]] : [[11, 15], [9, 18], [8, 21]];
      for (const [x, y] of drops) {
        rect(ctx, WATER.light, x, y, 1, 2);
        rect(ctx, WATER.light, 42 - x, y, 1, 2);
      }
      for (const [x, y] of f ? [[13, 25], [29, 26]] : [[17, 26], [26, 25]]) rect(ctx, "#ffffff", x, y, 2, 1);
    },
  },

  picnic: {
    w: 32,
    h: 22,
    frames: 1,
    draw(ctx) {
      for (const x of [5, 25]) {
        rect(ctx, O, x, 13, 3, 9);
        rect(ctx, WOOD.dark, x + 1, 14, 1, 8);
      }
      rect(ctx, O, 1, 9, 30, 6);
      for (let y = 10; y < 14; y++) for (let x = 2; x < 30; x++) rect(ctx, ((x >> 1) + (y >> 1)) % 2 ? "#fff6e6" : RED.base, x, y, 1, 1);
      for (let x = 2; x < 30; x += 2) rect(ctx, O, x, 14, 1, 1);
      // mooncakes, cups, teapot
      for (const cx of [6, 11]) {
        disc(ctx, O, cx, 8, 2.5, 1.8);
        disc(ctx, GOLD.dark, cx, 8, 1.6, 1);
        rect(ctx, GOLD.light, cx - 1, 7, 1, 1);
      }
      rect(ctx, O, 15, 6, 3, 3);
      rect(ctx, "#fff6e6", 16, 7, 1, 1);
      disc(ctx, O, 23, 6, 4, 3.2);
      disc(ctx, JADE.base, 23, 6, 3, 2.2);
      rect(ctx, JADE.light, 21, 5, 2, 1);
      rect(ctx, O, 26, 4, 3, 1);
      rect(ctx, O, 22, 1, 3, 2);
    },
  },

  swing: {
    w: 34,
    h: 38,
    frames: 1,
    draw(ctx) {
      rect(ctx, O, 5, 34, 24, 4);
      rect(ctx, ROCK.base, 6, 35, 22, 2);
      rect(ctx, ROCK.light, 6, 35, 22, 1);
      rect(ctx, O, 15, 29, 4, 6);
      rect(ctx, ROCK.base, 16, 29, 2, 6);
      crescent(ctx, 17, 17, 15.5, 5, -3, 12.5, GOLD);
      // the swing hangs from the crescent's top horn
      rect(ctx, O, 11, 5, 1, 19);
      rect(ctx, O, 18, 5, 1, 19);
      rect(ctx, O, 9, 23, 12, 4);
      rect(ctx, WOOD.base, 10, 24, 10, 2);
      rect(ctx, WOOD.light, 10, 24, 10, 1);
      for (const [x, y] of [[4, 13], [7, 26], [26, 30], [3, 21]]) rect(ctx, "#ffffff", x, y, 1, 1);
    },
  },

  arch: {
    w: 36,
    h: 42,
    frames: 1,
    draw(ctx) {
      for (const x of [3, 29]) {
        rect(ctx, O, x, 15, 5, 27);
        rect(ctx, WOOD.base, x + 1, 16, 3, 26);
        rect(ctx, WOOD.light, x + 1, 16, 1, 26);
      }
      for (let y = 0; y <= 17; y++) {
        for (let x = 1; x < 35; x++) {
          const d = Math.hypot(x + 0.5 - 18, y + 0.5 - 17);
          if (d > 17 || d < 12) continue;
          rect(ctx, d > 16 || d < 13 ? O : d > 14.5 ? WOOD.base : WOOD.light, x, y, 1, 1);
        }
      }
      // vines and blossoms
      for (let i = 0; i < 70; i++) {
        const t = hash(i, 4, 11);
        let x: number;
        let y: number;
        if (t < 0.55) {
          const a = Math.PI + (t / 0.55) * Math.PI;
          x = Math.round(18 + Math.cos(a) * 14.5 + (hash(i, 5, 11) - 0.5) * 3);
          y = Math.round(17 + Math.sin(a) * 14.5 + (hash(i, 6, 11) - 0.5) * 3);
        } else {
          x = hash(i, 7, 11) < 0.5 ? 2 + Math.floor(hash(i, 8, 11) * 7) : 28 + Math.floor(hash(i, 8, 11) * 7);
          y = 16 + Math.floor(hash(i, 9, 11) * 24);
        }
        const c = hash(i, 10, 11);
        rect(ctx, c < 0.55 ? "#4f9e54" : c < 0.7 ? "#6fae4a" : c < 0.82 ? "#f07a9a" : c < 0.92 ? "#cfe7ff" : GOLD.base, x, y, 1, 1);
      }
    },
  },

  telescope: {
    w: 24,
    h: 34,
    frames: 1,
    draw(ctx) {
      for (const [x1, y1] of [[4, 33], [20, 33], [12, 33]]) {
        line(ctx, O, 12, 19, x1, y1);
        line(ctx, O, 12, 19, x1 + (x1 < 12 ? 1 : x1 > 12 ? -1 : 1), y1);
      }
      line(ctx, WOOD.base, 12, 21, 5, 32);
      line(ctx, WOOD.base, 12, 21, 19, 32);
      disc(ctx, O, 12, 19, 3);
      disc(ctx, GOLD.dark, 12, 19, 2);
      // brass tube, eyepiece low, lens high
      for (let i = 0; i <= 16; i++) rect(ctx, O, 3 + i - 1, Math.round(17 - i * 0.75) - 1, 3, 4);
      for (let i = 0; i <= 16; i++) {
        const x = 3 + i;
        const y = Math.round(17 - i * 0.75);
        rect(ctx, i % 6 === 3 ? GOLD.dark : "#d9a441", x, y, 1, 2);
        rect(ctx, GOLD.light, x, y, 1, 1);
      }
      disc(ctx, O, 20.5, 4.5, 2.5);
      rect(ctx, "#6fe3e1", 20, 4, 2, 1);
      rect(ctx, O, 0, 16, 3, 3);
    },
  },

  mooncake: {
    w: 38,
    h: 38,
    frames: 1,
    draw(ctx) {
      for (const x of [3, 32]) {
        rect(ctx, O, x, 10, 3, 28);
        rect(ctx, WOOD.dark, x + 1, 11, 1, 27);
      }
      // striped awning with a scalloped edge
      rect(ctx, O, 0, 6, 38, 9);
      for (let x = 1; x < 37; x++) rect(ctx, Math.floor((x - 1) / 4) % 2 ? "#fff6e6" : RED.base, x, 7, 1, 7);
      rect(ctx, "#ffffff", 1, 7, 36, 1);
      for (let x = 1; x < 37; x += 4) {
        rect(ctx, O, x, 14, 4, 1);
        rect(ctx, Math.floor((x - 1) / 4) % 2 ? "#fff6e6" : RED.base, x + 1, 14, 2, 1);
        rect(ctx, O, x + 1, 15, 2, 1);
      }
      rect(ctx, O, 12, 0, 14, 7);
      rect(ctx, GOLD.base, 13, 1, 12, 5);
      rect(ctx, RED.dark, 15, 3, 2, 1);
      rect(ctx, RED.dark, 19, 2, 1, 3);
      rect(ctx, RED.dark, 22, 3, 2, 1);
      // little lanterns under the awning
      for (const x of [8, 29]) {
        rect(ctx, O, x, 16, 1, 2);
        rect(ctx, O, x - 1, 18, 3, 4);
        rect(ctx, RED.base, x, 19, 1, 2);
      }
      // counter with mooncakes
      rect(ctx, O, 2, 25, 34, 13);
      rect(ctx, WOOD.base, 3, 27, 32, 10);
      for (let y = 29; y < 37; y += 3) rect(ctx, WOOD.dark, 3, y, 32, 1);
      rect(ctx, WOOD.light, 3, 26, 32, 1);
      for (const cx of [9, 15, 21, 27]) {
        disc(ctx, O, cx, 24, 2.6, 2);
        disc(ctx, GOLD.dark, cx, 24, 1.7, 1.2);
        rect(ctx, GOLD.light, cx - 1, 23, 1, 1);
      }
    },
  },

  garland: {
    w: 50,
    h: 32,
    frames: 2,
    draw(ctx, f, lit) {
      for (const x of [2, 45]) {
        rect(ctx, O, x, 4, 3, 28);
        rect(ctx, WOOD.base, x + 1, 5, 1, 27);
        rect(ctx, O, x - 1, 2, 5, 3);
        rect(ctx, GOLD.base, x, 3, 3, 1);
      }
      const sag = (x: number) => Math.round(6 + 8 * (1 - ((x - 25) / 21) ** 2));
      for (let x = 5; x < 45; x++) rect(ctx, O, x, sag(x), 1, 1);
      [11, 18, 25, 32, 39].forEach((x, i) => {
        const y = sag(x) + 1;
        const c = i % 2 ? GOLD : RED;
        rect(ctx, O, x - 2, y, 5, 7);
        rect(ctx, lit ? c.base : c.dark, x - 1, y + 1, 3, 5);
        const bright = lit && (i + f) % 2 === 0;
        rect(ctx, !lit ? "#5b4a4a" : bright ? "#fff1b0" : "#ffd98a", x, y + 2, 1, 3);
        rect(ctx, GOLD.base, x, y + 7, 1, 2);
      });
    },
  },

  drum: {
    w: 24,
    h: 28,
    frames: 1,
    draw(ctx) {
      line(ctx, O, 3, 27, 18, 14);
      line(ctx, O, 20, 27, 5, 14);
      line(ctx, WOOD.base, 4, 27, 18, 15);
      line(ctx, WOOD.base, 19, 27, 5, 15);
      disc(ctx, O, 12, 12, 10, 10);
      disc(ctx, RED.base, 12, 12, 9, 9);
      disc(ctx, "#f2e6cc", 12, 12, 7, 7);
      disc(ctx, "#e2d4b4", 13, 13, 5, 5);
      disc(ctx, GOLD.base, 12, 12, 2.5, 2.5);
      rect(ctx, GOLD.light, 11, 11, 1, 1);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        rect(ctx, GOLD.base, Math.round(12 + Math.cos(a) * 8 - 0.5), Math.round(12 + Math.sin(a) * 8 - 0.5), 1, 1);
      }
      line(ctx, O, 19, 1, 22, 9);
      rect(ctx, RED.base, 18, 0, 2, 2);
    },
  },

  gate: {
    w: 52,
    h: 48,
    frames: 1,
    draw(ctx) {
      const cx = 26;
      const cy = 29;
      for (let y = 9; y < 48; y++) {
        for (let x = 1; x < 51; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d < 14) continue;
          const wallEdge = x === 1 || x === 50 || y === 47;
          const c = wallEdge || d < 15 ? O : d < 17 ? (y < cy ? ROCK.light : ROCK.base) : y > 41 ? ROCK.base : x < 6 ? "#e6ddcc" : "#f2ece0";
          rect(ctx, c, x, y, 1, 1);
        }
      }
      for (let x = 2; x < 50; x += 6) rect(ctx, ROCK.dark, x, 42, 1, 5);
      rect(ctx, ROCK.dark, 2, 41, 48, 1);
      // green tiled roof with curled eaves
      rect(ctx, O, 4, 2, 44, 2);
      rect(ctx, GOLD.base, 5, 2, 42, 1);
      eave(ctx, 0, 4, 52, TILE_GREEN);
      rect(ctx, O, 1, 8, 50, 2);
      for (const x of [6, 45]) {
        rect(ctx, O, x, 0, 2, 3);
        rect(ctx, GOLD.base, x, 0, 1, 2);
      }
    },
  },

  pagoda: {
    w: 36,
    h: 58,
    frames: 1,
    draw(ctx, _f, lit) {
      const glow = lit ? "#ffd98a" : "#6f6a80";
      const WALL = "#b23a2e";
      rect(ctx, O, 2, 52, 32, 6);
      rect(ctx, ROCK.base, 3, 53, 30, 4);
      rect(ctx, ROCK.light, 3, 53, 30, 1);
      const tier = (x: number, y: number, w: number, h: number, eaveY: number) => {
        rect(ctx, O, x, y, w, h);
        rect(ctx, WALL, x + 1, y + 1, w - 2, h - 1);
        rect(ctx, RED.light, x + 1, y + 1, 1, h - 1);
        eave(ctx, x - 5, eaveY, w + 10, TILE_GREEN);
      };
      tier(12, 16, 12, 8, 12);
      tier(9, 28, 18, 10, 24);
      tier(6, 42, 24, 11, 38);
      // lit doorway and windows
      rect(ctx, O, 15, 45, 6, 8);
      rect(ctx, glow, 16, 46, 4, 7);
      rect(ctx, GOLD.base, 17, 44, 2, 1);
      for (const [x, y] of [[9, 45], [25, 45], [16, 31], [16, 19]]) {
        rect(ctx, O, x, y, x === 16 ? 4 : 3, 4);
        rect(ctx, glow, x + 1, y + 1, x === 16 ? 2 : 1, 2);
      }
      // spire
      rect(ctx, O, 16, 0, 4, 13);
      rect(ctx, GOLD.base, 17, 1, 2, 11);
      for (const y of [3, 6, 9]) rect(ctx, GOLD.dark, 16, y, 4, 1);
      rect(ctx, GOLD.light, 17, 1, 1, 1);
    },
  },
} satisfies Record<string, DecorArt>);

export function decorArt(id: string): DecorArt | undefined {
  return art[id];
}

export const DECOR_ART_IDS = Object.keys(art);

/** A task lantern: the little stone lantern planted when a villager finishes real work (16 x 26). */
export function drawStoneLantern(ctx: Ctx) {
  rect(ctx, O, 3, 23, 10, 3);
  rect(ctx, ROCK.dark, 4, 24, 8, 1);
  rect(ctx, O, 6, 15, 4, 9);
  rect(ctx, ROCK.base, 7, 16, 2, 7);
  rect(ctx, ROCK.light, 7, 16, 1, 7);
  rect(ctx, O, 3, 8, 10, 8);
  rect(ctx, ROCK.base, 4, 9, 8, 6);
  rect(ctx, ROCK.dark, 4, 14, 8, 1);
  rect(ctx, "#f7b267", 6, 10, 4, 4);
  rect(ctx, "#fff1b0", 7, 11, 2, 2);
  rect(ctx, O, 1, 5, 14, 4);
  rect(ctx, ROCK.base, 2, 6, 12, 2);
  rect(ctx, ROCK.light, 2, 6, 12, 1);
  rect(ctx, O, 5, 2, 6, 4);
  rect(ctx, ROCK.base, 6, 3, 4, 2);
  rect(ctx, ROCK.light, 6, 3, 2, 1);
  rect(ctx, O, 7, 0, 2, 3);
}
