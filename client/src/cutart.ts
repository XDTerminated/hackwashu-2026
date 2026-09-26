// Art for the story cutscenes (the intro and the finale), all drawn at native
// size like everything else: the family at dinner, the city at night, the
// launch site, the trip, the landing. Screen-sized backdrops are drawn at the
// canvas size, so they fill any window without scaling.

import Phaser from "phaser";
import { INK, disc, hash, rect, type Ctx } from "./pix";

function tex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): string {
  if (scene.textures.exists(key)) return key;
  const t = scene.textures.createCanvas(key, w, h)!;
  const ctx = t.getContext();
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  t.refresh();
  return key;
}

type Fill = (c: string, x: number, y: number, w: number, h: number) => void;
type Set = (x: number, y: number, c: string) => void;

type Grid = (string | null)[][];

/**
 * Scale2x (EPX): redraws a grid at twice the resolution, rounding off
 * diagonals instead of just doubling pixels. The result is new art at native
 * size, not a stretched sprite.
 */
function epx(g: Grid, w: number, h: number): Grid {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? null : g[y][x]);
  const out: Grid = Array.from({ length: h * 2 }, () => new Array<string | null>(w * 2).fill(null));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = at(x, y), a = at(x, y - 1), b = at(x + 1, y), c = at(x - 1, y), d = at(x, y + 1);
      out[y * 2][x * 2] = c === a && c !== d && a !== b ? a : p;
      out[y * 2][x * 2 + 1] = a === b && a !== c && b !== d ? b : p;
      out[y * 2 + 1][x * 2] = d === c && d !== b && c !== a ? c : p;
      out[y * 2 + 1][x * 2 + 1] = b === d && b !== a && d !== c ? d : p;
    }
  return out;
}

/** Lighten a #rrggbb colour toward white. */
function light(hex: string, k = 0.3) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/**
 * Paint into a grid, then outline the silhouette in ink (Stardew style).
 * With `x2`, the painted grid is redrawn at double resolution first (the
 * canvas must be 2w x 2h), `detail` adds fine touches at the new size, and
 * the outline stays one pixel thin.
 */
function outlined(ctx: Ctx, w: number, h: number, paint: (set: Set, fill: Fill) => void, ink = INK, x2 = false, detail?: (set: Set) => void) {
  let g: Grid = Array.from({ length: h }, () => new Array<string | null>(w).fill(null));
  const set: Set = (x, y, c) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c;
  };
  const fill: Fill = (c, x, y, ww, hh) => {
    for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + ww; xx++) set(xx, yy, c);
  };
  paint(set, fill);
  if (x2) {
    g = epx(g, w, h);
    w *= 2;
    h *= 2;
    detail?.((x, y, c) => {
      if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c;
    });
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (g[y][x]) continue;
      if (g[y - 1]?.[x] || g[y + 1]?.[x] || g[y][x - 1] || g[y][x + 1]) rect(ctx, ink, x, y, 1, 1);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = g[y][x];
      if (c) rect(ctx, c, x, y, 1, 1);
    }
}

// ---------------------------------------------------------------- the family

export type FamilyId = "you" | "mom" | "dad" | "grandma" | "sibling";
export type Pose = "rest" | "gesture" | "shrug" | "raise" | "wave" | "point" | "cheer" | "facepalm" | "sip";
export type Eyes = "open" | "closed" | "left" | "right" | "up";
export type Mouth = "closed" | "open" | "smile" | "frown";

interface Look {
  skin: string;
  skinShade: string;
  hair: string;
  hairShade: string;
  style: "spiky" | "long" | "short" | "bun" | "pigtails";
  shirt: string;
  shirtShade: string;
  glasses?: boolean;
  blush?: boolean;
  mustache?: boolean;
}

export const LOOKS: Record<FamilyId, Look> = {
  you: { skin: "#f2c49b", skinShade: "#d9a27a", hair: "#5a3a2a", hairShade: "#402a1f", style: "spiky", shirt: "#d97757", shirtShade: "#b85c3e" },
  mom: { skin: "#e8b48a", skinShade: "#cc956c", hair: "#7a3a28", hairShade: "#5a2a1e", style: "long", shirt: "#5aa878", shirtShade: "#3f8a5c" },
  dad: { skin: "#d9a07a", skinShade: "#bd845e", hair: "#3a2a24", hairShade: "#2a1e1a", style: "short", shirt: "#4a78c8", shirtShade: "#355ea8", glasses: true, mustache: true },
  grandma: { skin: "#f0c8a8", skinShade: "#d8aa88", hair: "#e4e0ec", hairShade: "#b8b2c8", style: "bun", shirt: "#8a5aa8", shirtShade: "#6e4690", glasses: true, blush: true },
  sibling: { skin: "#f2c49b", skinShade: "#d9a27a", hair: "#4a3040", hairShade: "#352230", style: "pigtails", shirt: "#f5c542", shirtShade: "#d9a520", blush: true },
};

const BUST_W = 26;
const BUST_H = 29;
const EYE = "#2a1e2e";

function drawBust(ctx: Ctx, id: FamilyId, pose: Pose, eyes: Eyes, mouth: Mouth) {
  const L = LOOKS[id];
  const dx = eyes === "left" ? -1 : eyes === "right" ? 1 : 0;
  const ey = eyes === "up" ? 10 : 11;
  // Fine touches at double resolution: shine in the eyes, brows, hair highlights.
  const detail = (set: Set) => {
    const hl = light(L.hair, 0.28);
    for (let x = 20; x <= 27; x++) set(x, 15 + (x > 23 ? 1 : 0), hl);
    set(19, 17, hl);
    if (pose === "facepalm") return;
    if (L.glasses) {
      const G = "#5a4a6a";
      for (const ex of [20, 30]) {
        for (let k = -3; k <= 4; k++) {
          set(ex + k, 2 * 11 - 3, G);
          set(ex + k, 2 * 11 + 4, G);
        }
        for (let k = -2; k <= 3; k++) {
          set(ex - 3, 2 * 11 + k, G);
          set(ex + 4, 2 * 11 + k, G);
        }
      }
      set(25, 21, G);
      set(26, 21, G);
    }
    if (eyes !== "closed") {
      set(2 * (10 + dx), 2 * ey, "#ffffff");
      set(2 * (15 + dx), 2 * ey, "#ffffff");
      const brow = L.style === "bun" ? "#a09ab0" : L.hairShade;
      const by = 2 * ey - 3 - (mouth === "open" ? 1 : 0);
      for (const bx of [2 * (10 + dx) - 1, 2 * (15 + dx) - 1]) for (let k = 0; k < 4; k++) set(bx + k, by + (mouth === "frown" && (bx < 26 ? k > 2 : k < 1) ? 1 : 0), brow);
    }
  };
  outlined(ctx, BUST_W, BUST_H, (set, fill) => {
    /** A shape with its own ink edge, so it reads on top of the face. */
    const inked = (c: string, x: number, y: number, w: number, h: number) => {
      fill(INK, x - 1, y, w + 2, h);
      fill(INK, x, y - 1, w, h + 2);
      fill(c, x, y, w, h);
    };
    // behind: long hair, the hood
    if (L.style === "long") {
      fill(L.hair, 6, 9, 3, 13);
      fill(L.hair, 17, 9, 3, 13);
      fill(L.hairShade, 19, 10, 1, 12);
    }
    if (id === "you") fill(L.shirtShade, 7, 15, 12, 3);

    // body
    fill(L.shirt, 9, 17, 8, 1);
    fill(L.shirt, 7, 18, 12, 1);
    fill(L.shirt, 6, 19, 14, 10);
    fill(L.shirtShade, 18, 19, 2, 10);
    const armsDown = pose === "rest" || pose === "raise" || pose === "wave" || pose === "point" || pose === "sip" || pose === "facepalm";
    if (armsDown) {
      fill(L.shirtShade, 8, 21, 1, 8);
      if (pose === "rest") fill(L.shirtShade, 17, 21, 1, 8);
    }
    // outfit details
    if (id === "you") {
      set(11, 18, "#fff6e6");
      set(11, 19, "#fff6e6");
      set(14, 18, "#fff6e6");
      set(14, 19, "#fff6e6");
      fill(L.shirtShade, 9, 24, 8, 1);
    } else if (id === "mom") {
      fill("#fff6e6", 10, 17, 2, 1);
      fill("#fff6e6", 14, 17, 2, 1);
      set(11, 18, "#fff6e6");
      set(14, 18, "#fff6e6");
      set(12, 21, "#f5c542");
    } else if (id === "dad") {
      fill("#e8eef8", 6, 22, 14, 1);
      fill("#e8eef8", 6, 24, 14, 1);
    } else if (id === "grandma") {
      fill(L.shirtShade, 12, 18, 2, 11);
      set(12, 21, "#fff6e6");
      set(13, 24, "#fff6e6");
      set(12, 27, "#fff6e6");
      fill("#f6efe2", 10, 17, 6, 1);
    } else if (id === "sibling") {
      set(12, 21, "#fff6e6");
      fill("#fff6e6", 11, 22, 3, 1);
      set(12, 23, "#fff6e6");
      set(11, 24, "#fff6e6");
      set(13, 24, "#fff6e6");
    }
    // neck
    fill(L.skinShade, 11, 17, 4, 1);

    // head
    fill(L.skin, 8, 9, 10, 7);
    fill(L.skin, 9, 8, 8, 1);
    fill(L.skin, 9, 16, 8, 1);
    fill(L.skinShade, 16, 11, 2, 5);
    set(8, 12, L.skinShade);
    set(17, 12, L.skinShade);

    // hair
    const hair = (x: number, y: number, w: number, h: number) => fill(L.hair, x, y, w, h);
    hair(9, 7, 8, 1);
    hair(8, 8, 10, 2);
    hair(8, 10, 1, 2);
    hair(17, 10, 1, 2);
    fill(L.hairShade, 14, 8, 4, 1);
    if (L.style === "spiky") {
      for (const [x, y] of [[9, 6], [10, 5], [10, 6], [12, 6], [13, 5], [13, 6], [15, 6], [16, 5], [16, 6]]) set(x, y, L.hair);
      set(10, 10, L.hair);
      set(13, 10, L.hair);
      set(16, 10, L.hair);
    } else if (L.style === "long") {
      hair(8, 10, 1, 5);
      hair(17, 10, 1, 5);
      set(12, 8, L.hairShade);
      set(9, 10, L.hair);
      set(16, 10, L.hair);
    } else if (L.style === "short") {
      set(9, 10, L.hair);
      fill(L.hairShade, 9, 7, 3, 1);
    } else if (L.style === "bun") {
      fill(L.hair, 11, 3, 4, 4);
      fill(L.hair, 10, 4, 6, 2);
      fill(L.hairShade, 14, 4, 1, 2);
      set(16, 2, "#d97757");
      set(15, 3, "#d97757");
      set(9, 6, "#d97757");
    } else if (L.style === "pigtails") {
      fill(L.hair, 4, 10, 4, 4);
      fill(L.hair, 5, 14, 2, 1);
      fill(L.hair, 18, 10, 4, 4);
      fill(L.hair, 19, 14, 2, 1);
      set(7, 10, "#e0405a");
      set(7, 11, "#e0405a");
      set(18, 10, "#e0405a");
      set(18, 11, "#e0405a");
      set(11, 10, L.hair);
    }

    // face
    if (eyes === "closed") {
      set(9, 12, EYE);
      set(10, 12, EYE);
      set(15, 12, EYE);
      set(16, 12, EYE);
    } else {
      fill(EYE, 10 + dx, ey, 1, 2);
      fill(EYE, 15 + dx, ey, 1, 2);
    }
    if (L.blush) {
      set(9, 14, "#f09aa0");
      set(16, 14, "#f09aa0");
    }
    set(12, 13, L.skinShade);
    set(13, 13, L.skinShade);
    if (L.mustache) fill("#3a2a24", 11, 14, 4, 1);
    const M = "#7a3a3a";
    if (mouth === "closed") fill(M, 12, 15, 2, 1);
    else if (mouth === "open") {
      fill("#5a2030", 12, 14, 2, 2);
      set(11, 15, "#5a2030");
      set(14, 15, "#5a2030");
      set(12, 15, "#e07080");
    } else if (mouth === "smile") {
      set(11, 14, M);
      set(12, 15, M);
      set(13, 15, M);
      set(14, 14, M);
    } else {
      set(11, 15, M);
      set(12, 14, M);
      set(13, 14, M);
      set(14, 15, M);
    }

    // arms and hands
    const sleeve = (x: number, y: number, w: number, h: number) => fill(L.shirtShade, x, y, w, h);
    const hand = (x: number, y: number, w: number, h: number) => fill(L.skin, x, y, w, h);
    const raiseRight = () => {
      sleeve(20, 7, 2, 13);
      hand(20, 3, 2, 4);
      set(22, 5, L.skin);
    };
    switch (pose) {
      case "gesture":
        sleeve(4, 17, 2, 6);
        hand(3, 14, 2, 3);
        set(3, 13, L.skin);
        sleeve(20, 17, 2, 6);
        hand(21, 14, 2, 3);
        set(22, 13, L.skin);
        break;
      case "shrug":
        sleeve(4, 20, 2, 4);
        hand(2, 19, 2, 2);
        sleeve(20, 20, 2, 4);
        hand(22, 19, 2, 2);
        break;
      case "raise":
        raiseRight();
        break;
      case "wave":
        sleeve(20, 8, 2, 12);
        hand(21, 3, 2, 5);
        set(23, 5, L.skin);
        break;
      case "point":
        sleeve(20, 8, 2, 12);
        hand(20, 5, 2, 3);
        fill(L.skin, 21, 1, 1, 4);
        break;
      case "cheer":
        raiseRight();
        sleeve(4, 7, 2, 13);
        hand(4, 3, 2, 4);
        set(3, 5, L.skin);
        break;
      case "facepalm":
        sleeve(17, 13, 2, 7);
        inked(L.skin, 9, 10, 8, 3);
        set(11, 10, L.skinShade);
        set(13, 10, L.skinShade);
        set(15, 10, L.skinShade);
        break;
      case "sip":
        // holding a cup of tea at her chest
        sleeve(16, 20, 2, 4);
        inked("#f6f6fa", 10, 19, 5, 4);
        fill("#8ad0b0", 10, 19, 5, 1);
        fill("#4a78c8", 10, 21, 5, 1);
        hand(15, 20, 2, 2);
        break;
      default:
        break;
    }
  }, INK, true, detail);
}

/** The texture key for a family member in a pose (drawn on first use). */
export function bust(scene: Phaser.Scene, id: FamilyId, pose: Pose, eyes: Eyes, mouth: Mouth): string {
  return tex(scene, `fam_${id}_${pose}_${eyes}_${mouth}`, BUST_W * 2, BUST_H * 2, (ctx) => drawBust(ctx, id, pose, eyes, mouth));
}

/** Tiny standing family members for wide shots (frame 1 waves). */
export function tiny(scene: Phaser.Scene, id: FamilyId, f: 0 | 1): string {
  const L = LOOKS[id];
  return tex(scene, `tiny_${id}_${f}`, 13, 19, (ctx) =>
    outlined(ctx, 13, 19, (set, fill) => {
      const kid = id === "sibling";
      const top = kid ? 4 : 2;
      fill(L.skin, 4, top + 1, 5, 4);
      fill(L.hair, 4, top, 5, 2);
      if (L.style === "bun") fill(L.hair, 5, top - 2, 3, 2);
      if (L.style === "pigtails") {
        set(3, top + 1, L.hair);
        set(9, top + 1, L.hair);
      }
      if (L.style === "long") {
        fill(L.hair, 3, top + 1, 1, 4);
        fill(L.hair, 9, top + 1, 1, 4);
      }
      set(5, top + 3, EYE);
      set(7, top + 3, EYE);
      fill(L.shirt, 4, top + 5, 5, kid ? 5 : 6);
      fill(L.shirtShade, 8, top + 5, 1, kid ? 5 : 6);
      const legY = top + (kid ? 10 : 11);
      fill("#3a3048", 4, legY, 2, 17 - legY);
      fill("#3a3048", 7, legY, 2, 17 - legY);
      // arms
      fill(L.shirtShade, 3, top + 6, 1, 3);
      set(3, top + 9, L.skin);
      if (f === 0) {
        fill(L.shirtShade, 9, top + 6, 1, 3);
        set(9, top + 9, L.skin);
      } else {
        set(9, top + 5, L.shirtShade);
        set(10, top + 4, L.shirtShade);
        set(10, top + 3, L.shirtShade);
        fill(L.skin, 10, top + 1, 2, 2);
      }
    }),
  );
}

// ---------------------------------------------------------------- dinner

// The table is painted at 204 x 46 and drawn at double resolution.
const TW = 204;
const TH = 46;
export const TABLE_W = TW * 2;
export const TABLE_H = TH * 2;
/** Seat centers along the (double-size) table, left to right. */
export const SEATS: FamilyId[] = ["grandma", "dad", "you", "mom", "sibling"];
export const seatX = (i: number) => (TW / 2 + (i - 2) * 36) * 2;
const smallSeat = (i: number) => TW / 2 + (i - 2) * 36;

export function drawTable(scene: Phaser.Scene): string {
  return tex(scene, "intro_table", TABLE_W, TABLE_H, (ctx) =>
    outlined(ctx, TW, TH, (set, fill) => {
      // cloth top, then the front drape
      fill("#c8504a", 3, 14, TW - 6, 8);
      fill("#d86a5a", 3, 14, TW - 6, 1);
      fill("#a83a36", 1, 22, TW - 2, 22);
      fill("#f5c542", 1, 22, TW - 2, 2);
      fill("#d9a520", 1, 24, TW - 2, 1);
      fill("#f5c542", 1, 40, TW - 2, 1);
      fill("#8a2a2a", 1, 41, TW - 2, 1);
      for (let x = 6; x < TW - 4; x += 12) {
        fill("#f5c542", x, 42, 1, 3);
        set(x, 45, "#d9a520");
      }
      // auspicious clouds on the drape
      for (let x = 22; x < TW - 20; x += 40) {
        const c = "#d9a520";
        for (const [dx, dy] of [[0, 2], [1, 1], [2, 1], [3, 2], [3, 3], [2, 3], [4, 1], [5, 0], [6, 0], [7, 1], [7, 2], [6, 3], [-1, 3], [8, 3]]) set(x + dx, 30 + dy, c);
      }


      // place settings
      SEATS.forEach((who, i) => {
        const sx = Math.round(smallSeat(i));
        if (who === "you") {
          // a laptop at the dinner table, of course
          fill("#9aa0b8", sx - 7, 9, 14, 6);
          fill("#b8bed4", sx - 7, 9, 14, 1);
          fill("#6f7590", sx - 8, 15, 16, 2);
          set(sx, 11, "#e8f4ff");
          set(sx - 1, 12, "#e8f4ff");
          set(sx, 13, "#e8f4ff");
          fill("#d97757", sx - 5, 11, 2, 2);
          set(sx + 4, 13, "#f5c542");
          return;
        }
        fill("#f6f6fa", sx - 5, 16, 10, 3);
        fill("#c8cce0", sx - 4, 19, 8, 1);
        fill("#4a78c8", sx - 5, 17, 10, 1);
        fill("#ffffff", sx - 4, 15, 8, 1);
        fill("#ffffff", sx - 3, 14, 6, 1);
        for (let k = 0; k < 5; k++) {
          set(sx + 6 + k, 19 - k, "#8a5a3a");
          set(sx + 8 + k, 19 - k, "#8a5a3a");
        }
      });

      // two plates of warm dinner rolls
      for (const px of [48, 156]) {
        fill("#f6f6fa", px - 10, 18, 20, 2);
        fill("#c8cce0", px - 9, 20, 18, 1);
        const cake = (x: number, y: number) => {
          fill("#d99a52", x, y + 1, 6, 3);
          fill("#d99a52", x + 1, y, 4, 1);
          fill("#f2c98a", x + 1, y + 1, 3, 1);
          fill("#b0763a", x, y + 3, 6, 1);
          set(x + 3, y + 1, "#c07e40");
        };
        cake(px - 9, 14);
        cake(px - 3, 14);
        cake(px + 3, 14);
        cake(px - 6, 10);
        cake(px, 10);
        cake(px - 3, 6);
      }
      // teapot
      const tx = 84;
      fill("#e8eef8", tx - 5, 9, 11, 9);
      fill("#e8eef8", tx - 4, 8, 9, 1);
      fill("#c8d2e8", tx + 4, 10, 2, 8);
      fill("#4a78c8", tx - 5, 12, 11, 1);
      set(tx - 2, 14, "#4a78c8");
      set(tx + 2, 15, "#4a78c8");
      fill("#e8eef8", tx - 1, 6, 3, 2);
      for (const [x, y] of [[6, 11], [7, 10], [8, 9], [9, 8]]) set(tx + x, y, "#e8eef8");
      fill("#e8eef8", tx - 7, 10, 1, 5);
      set(tx - 6, 10, "#e8eef8");
      set(tx - 6, 14, "#e8eef8");
      // a pomelo
      const ox = 121;
      for (let y = 10; y <= 19; y++)
        for (let x = ox - 5; x <= ox + 5; x++) {
          const d = Math.hypot(x + 0.5 - ox, y + 0.5 - 15);
          if (d <= 5) set(x, y, x > ox + 1 || y > 17 ? "#b8c050" : "#d8e070");
        }
      set(ox - 2, 12, "#f0f4a0");
      set(ox, 9, "#5a3a2a");
      fill("#5aa860", ox + 1, 8, 3, 1);
      set(ox + 2, 7, "#5aa860");
    }, INK, true, (set) => {
      // a sheen along the cloth and a glint on each plate
      for (let x = 8; x < TABLE_W - 8; x += 3) set(x, 29, "#e07a6a");
      for (const px of [96, 312]) for (let k = 0; k < 6; k++) set(px - 16 + k, 37, "#ffffff");
    }),
  );
}

export function drawChair(scene: Phaser.Scene): string {
  return tex(scene, "intro_chair", 52, 68, (ctx) =>
    outlined(ctx, 26, 34, (set, fill) => {
      fill("#7a4a2a", 1, 2, 3, 32);
      fill("#7a4a2a", 22, 2, 3, 32);
      fill("#8a5a34", 1, 2, 24, 5);
      fill("#a0683e", 2, 2, 22, 1);
      fill("#5e3820", 1, 6, 24, 1);
      fill("#5e3820", 3, 7, 1, 27);
      fill("#5e3820", 24, 7, 1, 27);
      set(13, 4, "#f5c542");
      set(12, 4, "#f5c542");
    }, INK, true),
  );
}

export function drawHangingLantern(scene: Phaser.Scene): string {
  return tex(scene, "intro_lantern", 14, 24, (ctx) =>
    outlined(ctx, 14, 24, (set, fill) => {
      fill("#f5c542", 4, 2, 6, 2);
      for (let y = 4; y <= 15; y++) {
        const hw = Math.round(5.5 * Math.sqrt(1 - ((y - 9.5) / 6.5) ** 2));
        fill("#d8403a", 7 - hw, y, hw * 2, 1);
        set(7 - hw, y, "#f07060");
        set(6 + hw, y, "#a0302c");
      }
      for (let y = 5; y <= 14; y++) {
        set(5, y, "#b8342e");
        set(8, y, "#b8342e");
      }
      fill("#ff9a70", 3, 7, 1, 4);
      fill("#f5c542", 4, 16, 6, 2);
      fill("#f5c542", 6, 18, 2, 5);
      set(5, 22, "#d9a520");
      set(8, 22, "#d9a520");
    }),
  );
}

export function drawCeilingLamp(scene: Phaser.Scene): string {
  return tex(scene, "intro_lamp", 32, 14, (ctx) =>
    outlined(ctx, 32, 14, (set, fill) => {
      for (let y = 1; y <= 9; y++) {
        const hw = 5 + Math.round(y * 1.1);
        fill(y < 3 ? "#e8b040" : "#f5c542", 16 - hw, y, hw * 2, 1);
        set(16 - hw, y, "#d9a520");
      }
      fill("#fff2b0", 5, 10, 22, 2);
      fill("#fff9e0", 8, 11, 16, 1);
      fill("#8a5a10", 14, 0, 4, 1);
    }),
  );
}

/** The dining room wall, window and floor, drawn at screen size. */
export function drawRoom(scene: Phaser.Scene, W: number, H: number, floorY: number, top: number, windowX: number): string {
  return tex(scene, `intro_room_${W}x${H}`, W, H, (ctx) => {
    // wallpaper
    rect(ctx, "#e7c79c", 0, 0, W, floorY);
    for (let x = (W / 2) % 12; x < W; x += 12) rect(ctx, "#dcb78a", Math.round(x), 0, 2, floorY);
    for (let x = (W / 2 + 6) % 12, k = 0; x < W; x += 12, k++)
      for (let y = top + 10 + (k % 2) * 9; y < floorY - 50; y += 18) {
        rect(ctx, "#e0bd8f", Math.round(x), y, 1, 1);
        rect(ctx, "#e0bd8f", Math.round(x) - 1, y + 1, 3, 1);
        rect(ctx, "#e0bd8f", Math.round(x), y + 2, 1, 1);
      }
    // crown molding
    rect(ctx, "#8a5a34", 0, top, W, 4);
    rect(ctx, "#a0683e", 0, top, W, 1);
    rect(ctx, "#5e3820", 0, top + 4, W, 1);
    // wainscot
    const wy = floorY - 46;
    rect(ctx, "#5e3820", 0, wy - 1, W, 1);
    rect(ctx, "#8a5a34", 0, wy, W, 3);
    rect(ctx, "#a0643a", 0, wy + 3, W, 43);
    for (let x = (W / 2) % 40; x < W; x += 40) {
      const px = Math.round(x) + 4;
      rect(ctx, "#8a5230", px, wy + 9, 32, 30);
      rect(ctx, "#b8784a", px + 1, wy + 10, 30, 28);
      rect(ctx, "#a86c40", px + 2, wy + 11, 28, 26);
    }
    // floor planks
    rect(ctx, "#6a4028", 0, floorY, W, 2);
    for (let y = floorY + 2, row = 0; y < H; y += 7, row++) {
      rect(ctx, row % 2 ? "#8a5a3a" : "#94623e", 0, y, W, 7);
      rect(ctx, "#6e4630", 0, y + 6, W, 1);
      for (let x = (row * 37) % 64; x < W; x += 64) rect(ctx, "#6e4630", x, y, 1, 6);
    }
    // the window, with the full moon in it
    const wx = Math.round(windowX - 34);
    const wt = top + 14;
    const ww = 68;
    const wh = Math.min(76, wy - wt - 10);
    rect(ctx, INK, wx - 1, wt - 1, ww + 2, wh + 2);
    rect(ctx, "#7a4a2a", wx, wt, ww, wh);
    const ix = wx + 4;
    const iy = wt + 4;
    const iw = ww - 8;
    const ih = wh - 8;
    for (let y = 0; y < ih; y++) rect(ctx, y < ih * 0.45 ? "#141438" : y < ih * 0.8 ? "#1c1c4a" : "#2a2458", ix, iy + y, iw, 1);
    for (let i = 0; i < 18; i++) rect(ctx, "#e8e4ff", ix + Math.floor(hash(i, 3) * iw), iy + Math.floor(hash(i, 7) * ih * 0.8), 1, 1);
    drawFullMoon(ctx, ix + iw - 18, iy + 16, 11);
    // far rooftops
    for (let x = 0; x < iw; x++) {
      const hgt = 5 + Math.round(hash(Math.floor(x / 9), 1) * 8);
      rect(ctx, "#0e0c24", ix + x, iy + ih - hgt, 1, hgt);
      if (hash(x, 5) > 0.86) rect(ctx, "#f5c542", ix + x, iy + ih - hgt + 3, 1, 1);
    }
    rect(ctx, "#7a4a2a", ix + Math.round(iw / 2) - 1, iy, 3, ih);
    rect(ctx, "#7a4a2a", ix, iy + Math.round(ih / 2) - 1, iw, 3);
    rect(ctx, "#a0683e", wx, wh + wt - 3, ww, 3);
    rect(ctx, "#5e3820", wx - 4, wt + wh, ww + 8, 3);
    // curtains
    for (const side of [-1, 1]) {
      const cx0 = side < 0 ? wx - 10 : wx + ww - 4;
      rect(ctx, INK, cx0 - 1, wt - 6, 16, wh + 16);
      rect(ctx, "#b8413a", cx0, wt - 5, 14, wh + 14);
      for (let k = 0; k < 3; k++) rect(ctx, "#9a3430", cx0 + 3 + k * 4, wt - 5, 1, wh + 14);
      rect(ctx, "#f5c542", cx0, wt + Math.round(wh * 0.55), 14, 2);
    }
    rect(ctx, "#5e3820", wx - 14, wt - 8, ww + 28, 3);
    rect(ctx, "#f5c542", wx - 15, wt - 8, 2, 3);
    rect(ctx, "#f5c542", wx + ww + 13, wt - 8, 2, 3);

    // a wall clock and a framed picture of the Moon on the other side
    const clx = Math.round(W - windowX + 30);
    const cly = top + 30;
    disc(ctx, INK, clx, cly, 10);
    disc(ctx, "#8a5a34", clx, cly, 9);
    disc(ctx, "#fff6e6", clx, cly, 7);
    rect(ctx, INK, clx, cly - 5, 1, 5);
    rect(ctx, INK, clx, cly, 4, 1);
    for (let k = 0; k < 12; k++) rect(ctx, "#8a7f9c", Math.round(clx + Math.sin((k * Math.PI) / 6) * 6), Math.round(cly - Math.cos((k * Math.PI) / 6) * 6), 1, 1);
    const fx = Math.round(W - windowX - 40);
    const fy = top + 18;
    rect(ctx, INK, fx - 1, fy - 1, 34, 28);
    rect(ctx, "#c89a4a", fx, fy, 32, 26);
    rect(ctx, "#0e0c28", fx + 3, fy + 3, 26, 20);
    drawFullMoon(ctx, fx + 16, fy + 13, 7);
    rect(ctx, "#f5c542", fx + 5, fy + 5, 1, 1);
    rect(ctx, "#e8e4ff", fx + 25, fy + 18, 1, 1);
  });
}

/** A full moon with its craters and, if you look closely, the rabbit. */
export function drawFullMoon(ctx: Ctx, cx: number, cy: number, r: number) {
  disc(ctx, "#fff6d8", cx, cy, r + 1);
  disc(ctx, "#f8efd0", cx, cy, r);
  const s = r / 30;
  const spot = (x: number, y: number, rr: number, c = "#e6d8b0") => disc(ctx, c, cx + x * s, cy + y * s, Math.max(1, rr * s));
  spot(-12, -12, 7);
  spot(14, 10, 6);
  spot(-16, 12, 4);
  spot(8, -18, 3.5);
  if (r >= 14) {
    // the Jade Rabbit of the old legend, pounding medicine
    const R = "#dccba0";
    disc(ctx, R, cx + 6 * s, cy + 4 * s, 7 * s, 5 * s);
    disc(ctx, R, cx - 2 * s, cy - 1 * s, 4 * s);
    for (let k = 0; k < 9; k++) {
      rect(ctx, R, Math.round(cx - 4 * s - k * 0.3 * s), Math.round(cy - 3 * s - k * s), Math.max(1, Math.round(2 * s)), 1);
      rect(ctx, R, Math.round(cx - 1 * s + k * 0.3 * s), Math.round(cy - 3 * s - k * s), Math.max(1, Math.round(2 * s)), 1);
    }
    rect(ctx, R, Math.round(cx - 13 * s), Math.round(cy + 8 * s), Math.round(7 * s), Math.round(5 * s));
    rect(ctx, R, Math.round(cx - 10 * s), Math.round(cy - 2 * s), Math.max(1, Math.round(1.5 * s)), Math.round(10 * s));
  }
}

// ---------------------------------------------------------------- the city at night

/** Tall enough to pan from the Moon down to the family's window. */
export function drawCity(scene: Phaser.Scene, W: number, CH: number, H: number): { key: string; moon: { x: number; y: number }; window: { x: number; y: number } } {
  const moon = { x: Math.round(W * 0.6), y: Math.round(H * 0.5) };
  const hx = Math.round(W / 2);
  const ground = CH - 28;
  const win = { x: hx, y: ground - 34 };
  const key = tex(scene, `intro_city_${W}x${CH}`, W, CH, (ctx) => {
    const bands = ["#07061a", "#0b0a22", "#100e2c", "#161336", "#1d1840", "#261d4a", "#302254", "#3c285c"];
    const bh = CH / bands.length;
    bands.forEach((c, i) => rect(ctx, c, 0, Math.round(i * bh), W, Math.ceil(bh) + 1));
    // dithered seams between bands
    for (let i = 1; i < bands.length; i++) {
      const y0 = Math.round(i * bh);
      for (let y = y0 - 2; y < y0; y++) for (let x = (y % 2); x < W; x += 2) rect(ctx, bands[i], x, y, 1, 1);
    }
    for (let i = 0; i < Math.round((W * CH) / 520); i++) {
      const y = Math.floor(hash(i, 11) * CH * 0.85);
      if (hash(i, 13) > 1 - y / CH) continue;
      rect(ctx, hash(i, 17) > 0.8 ? "#f5d7a8" : "#e8e4ff", Math.floor(hash(i, 12) * W), y, 1, 1);
    }
    // the moon and its halo
    for (let r = 58; r > 36; r -= 6) disc(ctx, r > 50 ? "#1a1840" : r > 44 ? "#221e4c" : "#2c2656", moon.x, moon.y, r);
    drawFullMoon(ctx, moon.x, moon.y, 34);
    // cloud wisps
    for (const [cx, cy, len] of [[moon.x - 70, moon.y + 22, 90], [moon.x + 10, moon.y + 38, 70], [Math.round(W * 0.2), Math.round(H * 0.3), 60]]) {
      rect(ctx, "#2e2a5c", cx, cy, len, 2);
      rect(ctx, "#2e2a5c", cx + 10, cy - 1, len - 24, 1);
      rect(ctx, "#252250", cx + 6, cy + 2, len - 10, 1);
    }
    // far skyline
    const far = ground - 96;
    for (let x = 0, k = 0; x < W; k++) {
      const w = 12 + Math.floor(hash(k, 21) * 22);
      const h = 30 + Math.floor(hash(k, 22) * 64);
      rect(ctx, "#1a1634", x, far + 96 - h, w, h);
      for (let wy = far + 96 - h + 4; wy < ground - 4; wy += 5)
        for (let wx = x + 3; wx < x + w - 3; wx += 4) if (hash(wx, wy) > 0.78) rect(ctx, hash(wy, wx) > 0.5 ? "#f5c542" : "#ffd98a", wx, wy, 2, 2);
      if (hash(k, 23) > 0.7) rect(ctx, "#d8403a", x + Math.floor(w / 2), far + 96 - h - 3, 1, 3);
      x += w + 1;
    }
    // near houses
    const house = (cx: number, w: number, h: number, wall: string, lit: boolean) => {
      const x = Math.round(cx - w / 2);
      const y = ground - h;
      rect(ctx, INK, x - 1, y - 1, w + 2, h + 1);
      rect(ctx, wall, x, y, w, h);
      for (let k = 0; k < 12; k++) rect(ctx, "#241c36", x - 4 + k, y - 12 + k, w + 8 - k * 2, 1);
      rect(ctx, "#241c36", x - 6, y - 1, w + 12, 2);
      if (lit)
        for (let wx = x + 5; wx < x + w - 8; wx += 12) {
          rect(ctx, "#1a1430", wx - 1, y + 9, 8, 10);
          rect(ctx, "#ffcf7a", wx, y + 10, 6, 8);
          rect(ctx, "#e8a850", wx, y + 14, 6, 1);
        }
    };
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      house(hx + k * 86 + (k > 0 ? 8 : -8), 54 + Math.floor(hash(k, 31) * 20), 40 + Math.floor(hash(k, 32) * 14), k % 2 ? "#2e2644" : "#342a4c", true);
    }
    // the family's house, bigger and closer
    const fw = 110;
    const fh = 70;
    const fx = hx - fw / 2;
    const fy = ground - fh;
    rect(ctx, INK, fx - 1, fy - 1, fw + 2, fh + 1);
    rect(ctx, "#3e3056", fx, fy, fw, fh);
    for (let y = fy + 4; y < ground; y += 6) rect(ctx, "#382a4e", fx, y, fw, 1);
    for (let k = 0; k < 22; k++) rect(ctx, k < 2 ? INK : "#2a1f3c", fx - 10 + k, fy - 22 + k, fw + 20 - k * 2, 1);
    rect(ctx, "#2a1f3c", fx - 12, fy - 1, fw + 24, 3);
    // the lit dining-room window, with the family inside
    const wx = win.x - 26;
    const wy = win.y - 16;
    rect(ctx, INK, wx - 3, wy - 3, 58, 34);
    rect(ctx, "#6a4a30", wx - 2, wy - 2, 56, 32);
    rect(ctx, "#ffd98a", wx, wy, 52, 28);
    rect(ctx, "#ffe8b0", wx, wy, 52, 8);
    rect(ctx, "#f0b860", wx, wy + 22, 52, 6);
    rect(ctx, "#fff6d0", wx + 24, wy + 2, 4, 3);
    for (let k = 0; k < 5; k++) {
      const px = wx + 6 + k * 10;
      rect(ctx, "#8a5a38", px, wy + 11, 5, 5);
      rect(ctx, "#8a5a38", px - 1, wy + 16, 7, 6);
    }
    rect(ctx, "#b8413a", wx, wy + 21, 52, 7);
    rect(ctx, "#6a4a30", wx + 25, wy, 2, 28);
    // the front door and its porch light
    rect(ctx, INK, fx + 12, ground - 26, 16, 26);
    rect(ctx, "#6a3a2a", fx + 13, ground - 25, 14, 25);
    rect(ctx, "#f5c542", fx + 24, ground - 13, 1, 2);
    rect(ctx, "#ffe8b0", fx + 31, ground - 24, 3, 3);
    rect(ctx, "#141226", 0, ground, W, CH - ground);
    rect(ctx, "#1e1a34", 0, ground, W, 1);
  });
  return { key, moon, window: win };
}

// ---------------------------------------------------------------- the launch

export function drawLaunchSite(scene: Phaser.Scene, W: number, H: number, groundY: number, padX: number): string {
  return tex(scene, `intro_pad_${W}x${H}`, W, H, (ctx) => {
    const bands = ["#0b0a22", "#12102e", "#1a1638", "#241c46", "#302254", "#3e2a5e"];
    const bh = groundY / bands.length;
    bands.forEach((c, i) => rect(ctx, c, 0, Math.round(i * bh), W, Math.ceil(bh) + 1));
    for (let i = 0; i < Math.round((W * groundY) / 400); i++) rect(ctx, hash(i, 2) > 0.85 ? "#f5d7a8" : "#e8e4ff", Math.floor(hash(i, 3) * W), Math.floor(hash(i, 4) * groundY * 0.8), 1, 1);
    // the destination, watching
    for (let r = 26; r > 16; r -= 5) disc(ctx, r > 21 ? "#221e4c" : "#2c2656", Math.round(W * 0.8), Math.round(groundY * 0.3), r);
    drawFullMoon(ctx, Math.round(W * 0.8), Math.round(groundY * 0.3), 15);
    // the city far off, still celebrating
    for (let x = 0, k = 0; x < W; k++) {
      const w = 8 + Math.floor(hash(k, 41) * 14);
      const h = 6 + Math.floor(hash(k, 42) * 22);
      rect(ctx, "#1c1636", x, groundY - h, w, h);
      for (let wy = groundY - h + 2; wy < groundY - 1; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 3) if (hash(wx, wy, 3) > 0.8) rect(ctx, "#f5c542", wx, wy, 1, 1);
      x += w;
    }
    // grass and the pad
    rect(ctx, "#1e3a2c", 0, groundY, W, H - groundY);
    rect(ctx, "#2a4a3a", 0, groundY, W, 2);
    for (let i = 0; i < W / 3; i++) rect(ctx, "#2a4a3a", Math.floor(hash(i, 51) * W), groundY + 3 + Math.floor(hash(i, 52) * (H - groundY - 4)), 1, 2);
    rect(ctx, INK, padX - 37, groundY - 5, 74, 6);
    rect(ctx, "#6a6a7a", padX - 36, groundY - 4, 72, 4);
    rect(ctx, "#8a8a9c", padX - 36, groundY - 4, 72, 1);
    for (let x = padX - 32; x < padX + 32; x += 8) rect(ctx, "#f5c542", x, groundY - 2, 4, 1);
    // the gantry
    const gx = padX + 22;
    const top = groundY - 92;
    for (const x of [gx, gx + 12]) {
      rect(ctx, INK, x - 1, top, 4, groundY - top);
      rect(ctx, "#8a7f9c", x, top, 2, groundY - top);
    }
    for (let y = top + 4; y < groundY - 6; y += 10)
      for (let k = 0; k < 10; k++) {
        rect(ctx, "#6f6588", gx + 2 + k, y + k, 1, 1);
        rect(ctx, "#6f6588", gx + 11 - k, y + k, 1, 1);
      }
    for (let y = top; y < groundY; y += 10) rect(ctx, "#8a7f9c", gx, y, 14, 1);
    rect(ctx, INK, gx - 12, groundY - 60, 14, 4);
    rect(ctx, "#b85c3e", gx - 11, groundY - 59, 12, 2);
    rect(ctx, "#8a7f9c", gx - 2, top - 6, 18, 6);
    rect(ctx, INK, gx - 2, top - 6, 18, 1);
    // floodlights
    for (const lx of [padX - 70, padX + 70]) {
      rect(ctx, INK, lx - 1, groundY - 44, 3, 44);
      rect(ctx, "#6f6588", lx, groundY - 44, 1, 44);
      rect(ctx, INK, lx - 4, groundY - 48, 9, 5);
      rect(ctx, "#fff6d0", lx - 3, groundY - 47, 7, 3);
    }
  });
}

/** The engine flame, three flickering frames. */
export function drawFlames(scene: Phaser.Scene) {
  for (const f of [0, 1, 2])
    tex(scene, `intro_flame_${f}`, 16, 26, (ctx) => {
      for (let y = 0; y < 26; y++) {
        const t = y / 25;
        const hw = (6.5 - t * 5.5) * (1 + (hash(y, f, 9) - 0.5) * 0.35);
        for (let x = 0; x < 16; x++) {
          const d = Math.abs(x + 0.5 - 8);
          if (d > hw) continue;
          const k = d / Math.max(0.5, hw);
          const c = t < 0.35 && k < 0.45 ? "#fff6d0" : k < 0.6 && t < 0.7 ? "#f5c542" : t > 0.8 ? "#c8403a" : "#e8703a";
          rect(ctx, c, x, y, 1, 1);
        }
      }
    });
}

// ---------------------------------------------------------------- the trip

export function drawBigMoon(scene: Phaser.Scene): string {
  const S = 170;
  return tex(scene, "intro_bigmoon", S, S, (ctx) => {
    const c = S / 2;
    const r = S / 2 - 1;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5 - c) / r;
        const dy = (y + 0.5 - c) / r;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        const shade = dx * 0.5 + dy * 0.6;
        let col = shade < -0.4 ? "#e4e0ec" : shade < 0.15 ? "#c8c4d6" : shade < 0.55 ? "#aaa6bc" : "#8a86a0";
        if (hash(Math.floor(x / 3), Math.floor(y / 3), 4) > 0.9) col = shade < 0.15 ? "#b8b4c8" : "#9a96ae";
        rect(ctx, col, x, y, 1, 1);
      }
    const crater = (x: number, y: number, rr: number) => {
      disc(ctx, "#8a86a0", x, y, rr);
      disc(ctx, "#b8b4c8", x - 1, y - 1, rr - 1.5);
      disc(ctx, "#a09cb4", x, y, rr - 2);
    };
    for (let i = 0; i < 16; i++) {
      const a = hash(i, 61) * Math.PI * 2;
      const rr = Math.sqrt(hash(i, 62)) * (r - 16);
      crater(Math.round(c + Math.cos(a) * rr), Math.round(c + Math.sin(a) * rr), 3 + Math.floor(hash(i, 63) * 9));
    }
  });
}

/** Your phone, for the long trip. The screen is filled in live. */
export function drawPhone(scene: Phaser.Scene): string {
  return tex(scene, "intro_phone", 84, 128, (ctx) => {
    rect(ctx, INK, 1, 0, 82, 128);
    rect(ctx, INK, 0, 1, 84, 126);
    rect(ctx, "#2a2438", 1, 1, 82, 126);
    rect(ctx, "#3a3450", 2, 2, 80, 2);
    rect(ctx, "#e8eef8", 5, 10, 74, 108);
    rect(ctx, "#1a1628", 36, 4, 12, 2);
    rect(ctx, "#4a4460", 34, 121, 16, 3);
    rect(ctx, "#d97757", 5, 10, 74, 13);
  });
}

export function drawTicket(scene: Phaser.Scene): string {
  const W = 236;
  const H = 102;
  return tex(scene, "intro_ticket", W, H, (ctx) => {
    rect(ctx, INK, 1, 0, W - 2, H);
    rect(ctx, INK, 0, 1, W, H - 2);
    rect(ctx, "#fff2d6", 1, 1, W - 2, H - 2);
    rect(ctx, "#d97757", 1, 1, W - 2, 15);
    rect(ctx, "#b85c3e", 1, 15, W - 2, 1);
    // perforation between the stub and the ticket
    for (let y = 18; y < H - 2; y += 4) rect(ctx, "#c8a878", 44, y, 1, 2);
    for (const y of [0, H - 1]) {
      rect(ctx, "#0b0a1a", 42, y, 5, 1);
    }
    drawFullMoon(ctx, 22, 40, 10);
    for (let x = 52; x < W - 8; x += 3) rect(ctx, "#e8d4a8", x, H - 6, 2, 1);
    // barcode on the stub
    for (let x = 8; x < 38; x++) if (hash(x, 71) > 0.45) rect(ctx, "#4a2e19", x, H - 22, 1, 12);
  });
}

export function drawStamp(scene: Phaser.Scene): string {
  const W = 84;
  const H = 24;
  return tex(scene, "intro_stamp", W, H, (ctx) => {
    const R = "#c8403a";
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const edge = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
        const inner = (x === 3 || y === 3 || x === W - 4 || y === H - 4) && x >= 3 && y >= 3 && x <= W - 4 && y <= H - 4;
        if ((edge || inner) && hash(x, y, 81) > 0.12) rect(ctx, R, x, y, 1, 1);
      }
  });
}

// ---------------------------------------------------------------- the landing

export function drawMoonLanding(scene: Phaser.Scene, W: number, H: number, horizon: number): string {
  return tex(scene, `intro_moonland_${W}x${H}_${horizon}`, W, H, (ctx) => {
    rect(ctx, "#07061a", 0, 0, W, horizon);
    for (let i = 0; i < Math.round((W * horizon) / 260); i++) rect(ctx, hash(i, 91) > 0.85 ? "#f5d7a8" : "#e8e4ff", Math.floor(hash(i, 92) * W), Math.floor(hash(i, 93) * horizon), 1, 1);
    // far hills
    for (let x = 0; x < W; x++) {
      const h = 6 + Math.round((Math.sin(x / 37) + 1) * 5 + (Math.sin(x / 13 + 2) + 1) * 2);
      rect(ctx, "#6f6b88", x, horizon - h, 1, h);
      rect(ctx, "#8a86a0", x, horizon - h, 1, 1);
    }
    // ground
    rect(ctx, "#b8b4c8", 0, horizon, W, H - horizon);
    for (let y = horizon; y < H; y++)
      for (let x = (y % 2) * 1; x < W; x += 2) {
        const n = hash(Math.floor(x / 5), Math.floor(y / 4), 7);
        if (n > 0.82) rect(ctx, "#aaa6bc", x, y, 1, 1);
        else if (n < 0.06) rect(ctx, "#c8c4d6", x, y, 1, 1);
      }
    rect(ctx, "#9a96ae", 0, horizon, W, 1);
    const crater = (cx: number, cy: number, rx: number) => {
      const ry = Math.max(2, Math.round(rx * 0.4));
      disc(ctx, "#9a96ae", cx, cy, rx, ry);
      disc(ctx, "#a8a4ba", cx, cy + 1, rx - 2, ry - 1);
      for (let x = -rx + 2; x < rx - 2; x++) rect(ctx, "#d4d0e0", cx + x, cy + ry, 1, 1);
    };
    for (let i = 0; i < 9; i++) crater(Math.floor(hash(i, 95) * W), horizon + 8 + Math.floor(hash(i, 96) * (H - horizon - 20)), 6 + Math.floor(hash(i, 97) * 14));
    for (let i = 0; i < W / 6; i++) {
      const x = Math.floor(hash(i, 98) * W);
      const y = horizon + 3 + Math.floor(hash(i, 99) * (H - horizon - 4));
      rect(ctx, "#8a86a0", x, y, 2, 1);
      rect(ctx, "#d4d0e0", x, y - 1, 1, 1);
    }
  });
}

export function drawSign(scene: Phaser.Scene): string {
  return tex(scene, "intro_sign", 92, 38, (ctx) =>
    outlined(ctx, 92, 38, (_set, fill) => {
      fill("#7a4a2a", 12, 20, 3, 17);
      fill("#7a4a2a", 77, 20, 3, 17);
      fill("#a0643a", 1, 1, 90, 22);
      fill("#b8784a", 1, 1, 90, 1);
      fill("#8a5230", 1, 21, 90, 2);
      fill("#c89a5a", 3, 3, 86, 17);
    }),
  );
}

/** The player's portrait for the landing conversation: a helmet with eyes behind the visor. */
export function drawYouPortrait(scene: Phaser.Scene, f: 0 | 1): string {
  return tex(scene, `intro_portrait_you_${f}`, 48, 48, (ctx) => {
    for (let y = 0; y < 48; y++) rect(ctx, y < 24 ? "#1c2448" : "#243060", 0, y, 48, 1);
    for (let i = 0; i < 14; i++) rect(ctx, "#e8e4ff", Math.floor(hash(i, 5) * 48), Math.floor(hash(i, 6) * 30), 1, 1);
    disc(ctx, INK, 24, 27, 20);
    disc(ctx, "#f6efe2", 24, 27, 19);
    disc(ctx, "#cbbfd6", 27, 30, 16);
    disc(ctx, "#f6efe2", 23, 26, 16);
    disc(ctx, INK, 24, 26, 13, 10);
    disc(ctx, "#1f3a4d", 24, 26, 12, 9);
    if (f === 0) {
      rect(ctx, "#f2c49b", 18, 25, 3, 4);
      rect(ctx, "#f2c49b", 28, 25, 3, 4);
      rect(ctx, "#2a1e2e", 19, 26, 1, 2);
      rect(ctx, "#2a1e2e", 29, 26, 1, 2);
    } else {
      rect(ctx, "#f2c49b", 18, 27, 3, 1);
      rect(ctx, "#f2c49b", 28, 27, 3, 1);
    }
    rect(ctx, "#c8f4ff", 15, 20, 3, 1);
    rect(ctx, "#4fa8b8", 14, 21, 2, 3);
    rect(ctx, "#c8f4ff", 32, 31, 2, 1);
    rect(ctx, "#d97757", 8, 42, 32, 3);
    rect(ctx, "#b85c3e", 8, 44, 32, 1);
    rect(ctx, INK, 36, 4, 1, 9);
    disc(ctx, "#d97757", 36, 4, 2);
  });
}
