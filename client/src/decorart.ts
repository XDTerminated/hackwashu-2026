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
  draw: (ctx: Ctx, frame: number) => void;
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
    draw(ctx, f) {
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
      disc(ctx, "#d9503f", 12.5, 15, 4, 5);
      disc(ctx, f ? "#ffd98a" : "#f7b267", 12.5, 15.5, 2, 3);
      rect(ctx, "#b23a2e", 12, 10, 1, 3);
      rect(ctx, "#b23a2e", 12, 18, 1, 3);
      rect(ctx, "#ef7a5e", 10, 12, 1, 5);
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
    draw(ctx) {
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
      rect(ctx, "#ffd98a", 33, 23, 3, 3);
      rect(ctx, "#fff1b0", 34, 24, 1, 1);
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

export function decorArt(id: string): DecorArt | undefined {
  return art[id];
}

export const DECOR_ART_IDS = Object.keys(art);
