import Phaser from "phaser";
import type { PixelSprite } from "./art";
import {
  astronaut,
  jadeRabbit,
  postmaster,
  timekeeper,
  stargazer,
  scholar,
  rocket,
} from "./art";
import { DECOR_ART_IDS, decorArt, drawStoneLantern } from "./decorart";
import { ICON_SPRITES, MATERIAL_ICONS, VILLAGER_ICONS } from "./icons";
import { decorById } from "../../shared/decor";
import { drawMailbox, drawPlot, drawRuins, drawFoundation, drawRubble } from "./buildings";
import { drawGrandClock, drawGrandLibrary, drawGrandObservatory, drawGrandPost, drawHollow, drawMailRocket, drawManor } from "./estate";
import { SPOTS, TILE, buildingTiles, isAnnex } from "./layout";
import type { BuildingId, VillagerId } from "../../shared/game";
import { type Ctx, INK, box, disc, hash, rect } from "./pix";
import { PORTRAIT, drawPortrait, drawPortraitSky, type PortraitFrame } from "./portraits";
import { ROOM_H, ROOM_W, WORKER_LOOKS, drawCoffee, drawCouch, drawDesk, drawOfficeTower, drawPlant, drawRoom, drawWorkerBack, drawWorkerFront } from "./officeart";

const CORAL = "#d97757";
const CORAL_DARK = "#b85c3e";
const CORAL_LIGHT = "#eb9a7c";

function drawRows(ctx: Ctx, rows: string[], palette: Record<string, string>) {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** Registers each frame of a PixelSprite as `${key}_${index}`. */
function registerSprite(scene: Phaser.Scene, key: string, sprite: PixelSprite) {
  sprite.frames.forEach((rows, i) => {
    const w = Math.max(...rows.map((r) => r.length));
    const tex = scene.textures.createCanvas(`${key}_${i}`, w, rows.length)!;
    drawRows(tex.getContext(), rows, sprite.palette);
    tex.refresh();
  });
}

function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void) {
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  tex.refresh();
}

/**
 * The Claude sunburst, rasterized per-pixel from polar coordinates so every
 * ray is radially true at tiny sizes. `rot` spins it; `eyes` makes it a critter.
 */
function drawSpark(ctx: Ctx, size: number, rot: number, eyes: boolean) {
  const c = (size - 1) / 2;
  const RAYS = 8;
  const rCore = size * 0.17;
  const rTip = size * 0.49;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      const theta = Math.atan2(dy, dx) + rot;
      const t = Math.abs(Math.cos((RAYS * theta) / 2));
      const reach = rCore + (rTip - rCore) * Math.pow(t, 1.35);
      if (r > reach) continue;
      const f = r / rTip;
      ctx.fillStyle = f < 0.3 ? CORAL_LIGHT : f < 0.78 ? CORAL : CORAL_DARK;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  if (eyes) {
    const ex = Math.round(c - size * 0.1);
    const ex2 = Math.round(c + size * 0.1);
    const ey = Math.round(c - 1);
    rect(ctx, "#2a1712", ex, ey, 1, 2);
    rect(ctx, "#2a1712", ex2, ey, 1, 2);
  }
}

// ---------------------------------------------------------------- the plaza

const P_STONE = { base: "#b8b0c4", dark: "#8a8298", light: "#dcd6e4" };
const P_WATER = { base: "#7fc6e6", dark: "#5aa7cf", light: "#dff4fb" };

const MARBLE = { base: "#e2dce8", dark: "#b8b0c4", light: "#f6f2fa" };
const GOLDC = { base: "#f5c542", dark: "#c99a3e", light: "#fff1b0" };

/** A marble bowl: front wall, gold-lipped rim, water. */
function bowl(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, wall: number) {
  disc(ctx, INK, cx, cy + wall + 0.5, rx + 1, ry + 1.5);
  disc(ctx, MARBLE.dark, cx, cy + wall, rx, ry);
  disc(ctx, MARBLE.base, cx, cy + wall - 1, rx, ry - 1, cy + wall);
  disc(ctx, INK, cx, cy, rx + 1, ry + 1);
  disc(ctx, GOLDC.base, cx, cy, rx, ry);
  disc(ctx, MARBLE.light, cx, cy, rx - 1, ry - 1);
  disc(ctx, INK, cx, cy + 0.5, rx - 3.5, ry - 2.6);
  disc(ctx, P_WATER.base, cx, cy + 0.5, rx - 4.5, ry - 3.4);
  disc(ctx, P_WATER.dark, cx + 2, cy + 1.5, (rx - 4.5) * 0.55, (ry - 3.4) * 0.45);
}

/** The Earthrise Fountain: three tiers of marble and gold under a turning spark (120 x 100). */
function drawPlazaFountain(ctx: Ctx, f: number) {
  bowl(ctx, 60, 82, 57, 13, 5);
  // lily pads in the great basin
  for (const [x, y] of [[20, 84], [98, 80], [34, 90], [84, 90]] as const) {
    disc(ctx, "#3f8a4a", x, y, 3.5, 2);
    disc(ctx, "#5fb86a", x - 0.5, y - 0.5, 2.5, 1.2);
    rect(ctx, "#f07a9a", x + 1, y - 1, 1, 1);
  }
  // gold spouts on the rim, arcing water toward the middle
  for (const [x, dir] of [[8, 1], [112, -1]] as const) {
    rect(ctx, INK, x - 3, 72, 7, 8);
    rect(ctx, GOLDC.base, x - 2, 73, 5, 6);
    rect(ctx, GOLDC.light, x - 2, 73, 2, 1);
    for (let i = 0; i < 9; i++) {
      if ((i + f) % 3 === 0) continue;
      const t = i / 8;
      rect(ctx, P_WATER.light, Math.round(x + dir * (4 + t * 22)), Math.round(72 - Math.sin(t * Math.PI) * 10 + t * 6), 2, 1);
    }
  }
  // middle tier
  rect(ctx, INK, 51, 52, 18, 30);
  rect(ctx, MARBLE.base, 52, 52, 16, 30);
  rect(ctx, MARBLE.light, 52, 52, 3, 30);
  rect(ctx, MARBLE.dark, 65, 52, 3, 30);
  for (const y of [58, 70]) rect(ctx, GOLDC.base, 52, y, 16, 2);
  bowl(ctx, 60, 50, 30, 7, 3);
  // upper tier
  rect(ctx, INK, 55, 28, 10, 22);
  rect(ctx, MARBLE.base, 56, 28, 8, 22);
  rect(ctx, MARBLE.light, 56, 28, 2, 22);
  rect(ctx, GOLDC.base, 56, 38, 8, 1);
  bowl(ctx, 60, 28, 16, 4.5, 2);
  // water falling from the tiers
  for (let y = 0; y < 30; y++) {
    if ((y + f * 2) % 5 === 4) continue;
    const yy = 54 + y;
    rect(ctx, P_WATER.light, 31, yy, 1, 1);
    rect(ctx, P_WATER.base, 32, yy, 1, 1);
    rect(ctx, P_WATER.light, 88, yy, 1, 1);
    rect(ctx, P_WATER.base, 87, yy, 1, 1);
  }
  for (let y = 0; y < 18; y++) {
    if ((y + f) % 4 === 3) continue;
    rect(ctx, P_WATER.light, 45, 31 + y, 1, 1);
    rect(ctx, P_WATER.light, 75, 31 + y, 1, 1);
  }
  // gold orb pedestal and the turning spark
  disc(ctx, INK, 60, 25, 4.5, 3);
  disc(ctx, GOLDC.base, 60, 25, 3.5, 2);
  ctx.save();
  ctx.translate(48, 0);
  drawSpark(ctx, 25, (f * Math.PI) / 16, false);
  ctx.restore();
  // sparkles on the water
  const glints = [[[22, 80], [70, 86], [96, 84], [50, 49]], [[40, 84], [88, 80], [26, 88], [68, 50]], [[58, 88], [30, 82], [104, 86], [56, 27]]][f];
  for (const [x, y] of glints) rect(ctx, "#ffffff", x, y, 2, 1);
}

/** A marble obelisk with a gold tip and a glowing coral gem (18 x 58). */
function drawObelisk(ctx: Ctx) {
  rect(ctx, INK, 0, 48, 18, 10);
  rect(ctx, MARBLE.base, 1, 49, 16, 8);
  rect(ctx, MARBLE.light, 1, 49, 16, 1);
  rect(ctx, GOLDC.base, 1, 52, 16, 1);
  rect(ctx, MARBLE.dark, 1, 56, 16, 1);
  for (let y = 10; y < 48; y++) {
    const half = Math.round(3 + ((y - 10) / 38) * 2.5);
    rect(ctx, INK, 9 - half - 1, y, half * 2 + 2, 1);
    rect(ctx, MARBLE.base, 9 - half, y, half * 2, 1);
    rect(ctx, MARBLE.light, 9 - half, y, 1, 1);
    rect(ctx, MARBLE.dark, 9 + half - 1, y, 1, 1);
  }
  for (let y = 2; y < 10; y++) {
    const half = Math.round(((y - 2) / 8) * 3);
    rect(ctx, INK, 9 - half - 1, y, half * 2 + 2, 1);
    rect(ctx, GOLDC.base, 9 - half, y, Math.max(1, half * 2), 1);
  }
  rect(ctx, INK, 8, 0, 2, 2);
  rect(ctx, GOLDC.base, 7, 30, 4, 1);
  disc(ctx, INK, 9, 22, 2.8);
  disc(ctx, CORAL, 9, 22, 1.8);
  rect(ctx, CORAL_LIGHT, 8, 21, 1, 1);
  rect(ctx, GOLDC.base, 7, 36, 4, 1);
}

/** A topiary ball in a terracotta pot with a gold ribbon (16 x 24). */
function drawTopiary(ctx: Ctx) {
  rect(ctx, INK, 3, 17, 10, 7);
  rect(ctx, "#c9744a", 4, 18, 8, 5);
  rect(ctx, "#e0935f", 4, 18, 8, 1);
  rect(ctx, INK, 2, 16, 12, 2);
  rect(ctx, "#e0935f", 3, 16, 10, 1);
  rect(ctx, INK, 7, 12, 2, 5);
  disc(ctx, INK, 8, 8, 7.5);
  disc(ctx, "#3f8a4a", 8, 8, 6.5);
  disc(ctx, "#5fae5a", 7, 7, 5);
  disc(ctx, "#8fd07a", 5, 5, 2);
  rect(ctx, GOLDC.base, 1, 9, 14, 1);
  rect(ctx, GOLDC.dark, 7, 10, 2, 2);
}

/** A marble garden planter overflowing with flowers (44 x 24). */
function drawPlazaGarden(ctx: Ctx) {
  for (let i = 0; i < 44; i++) {
    const x = 3 + Math.floor(hash(i, 1, 31) * 38);
    const y = 1 + Math.floor(hash(i, 2, 31) * 10);
    rect(ctx, hash(i, 3, 31) > 0.5 ? "#4f9e54" : "#6fbf6a", x, y + 1, 1, 13 - y);
    rect(ctx, ["#f07a9a", "#f5c542", "#cfe7ff", "#b7a4f0", CORAL, "#ffffff"][i % 6], x, y, i % 3 ? 1 : 2, 1);
  }
  rect(ctx, INK, 0, 13, 44, 11);
  rect(ctx, MARBLE.base, 1, 15, 42, 8);
  rect(ctx, MARBLE.light, 1, 15, 42, 1);
  rect(ctx, GOLDC.base, 1, 18, 42, 1);
  rect(ctx, MARBLE.dark, 1, 22, 42, 1);
  rect(ctx, "#6b4a3a", 1, 14, 42, 1);
}

/**
 * Formal grounds in front of an estate (flat, under everything): a marble
 * forecourt with a gold border, clipped hedges down both sides and flowers.
 */
/**
 * Each home's forecourt, in front of its door (w x h, the building's width
 * plus two tiles each side). No two alike: they say who lives there.
 */
function drawGrounds(ctx: Ctx, w: number, h: number, b: BuildingId) {
  const x0 = 14;
  const x1 = w - 14;
  const pw = x1 - x0;
  const ph = h - 6;
  /** A paved area, one pixel at a time: `px(x, y)` gives the colour. */
  const pave = (px: (x: number, y: number) => string) => {
    for (let y = 0; y < ph; y++) for (let x = x0; x < x1; x++) rect(ctx, px(x - x0, y), x, y, 1, 1);
    rect(ctx, INK, x0, ph, pw, 1);
  };
  /** Side strips (hedge, lavender...) with something at the front corner. */
  const sides = (base: string, light: string, dots: string[], corner: (cx: number, cy: number) => void) => {
    for (const hx of [2, w - 14]) {
      rect(ctx, INK, hx, 0, 12, h - 6);
      rect(ctx, base, hx + 1, 0, 10, h - 7);
      for (let y = 1; y < h - 8; y += 4) rect(ctx, light, hx + 2, y, 8, 2);
      for (let y = 2; y < h - 8; y += 5) rect(ctx, dots[y % dots.length], hx + 3 + ((y * 3) % 6), y, 1, 1);
      corner(hx + 6, h - 6);
    }
  };
  const planter = (cx: number, cy: number, box: string, flowers: string[]) => {
    rect(ctx, INK, cx - 6, cy - 5, 13, 7);
    rect(ctx, box, cx - 5, cy - 4, 11, 5);
    for (let i = 0; i < 5; i++) rect(ctx, flowers[i % flowers.length], cx - 4 + i * 2, cy - 7 + (i % 2), 1, 2);
    rect(ctx, "#3f8a4a", cx - 5, cy - 5, 11, 1);
  };

  switch (b) {
    case "player_house": {
      // warm brick in a herringbone, tulip boxes, a welcome mat
      pave((x, y) => {
        const k = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
        const seam = k ? x % 4 === 0 : y % 4 === 0;
        return seam ? "#9a4f2e" : hash(Math.floor(x / 4), Math.floor(y / 4), 11) > 0.5 ? "#c9744a" : "#d7875a";
      });
      sides("#3f8a4a", "#5fae5a", ["#f07a9a", "#f5c542", "#ff9ac0"], (cx, cy) => planter(cx, cy, "#c98f5a", ["#f07a9a", "#f5c542", "#e84a6a"]));
      const mx = Math.round(w / 2);
      rect(ctx, INK, mx - 12, 1, 24, 8);
      rect(ctx, "#8a5a3b", mx - 11, 2, 22, 6);
      rect(ctx, "#c98f5a", mx - 9, 3, 18, 4);
      for (let x = mx - 7; x < mx + 8; x += 3) rect(ctx, "#8a5a3b", x, 4, 1, 2);
      break;
    }
    case "rabbit_burrow": {
      // a lawn with stepping stones to the door, and a carrot patch
      pave((x, y) => (hash(x >> 1, y >> 1, 12) > 0.8 ? "#6fbf6a" : hash(x, y, 13) > 0.5 ? "#4f9e54" : "#57a65a"));
      const mx = Math.round(w / 2);
      for (const [dx, y] of [[-3, 5], [4, 14], [-2, 24], [5, 33]]) {
        disc(ctx, INK, mx + dx, y, 5, 3.5);
        disc(ctx, "#c8c1d6", mx + dx, y, 4, 2.5);
        rect(ctx, "#e0dbe8", mx + dx - 2, y - 2, 3, 1);
      }
      // carrot rows on the left, flowers and a mushroom on the right
      for (let r = 0; r < 3; r++) {
        const ry = 8 + r * 10;
        rect(ctx, "#6b4a3a", x0 + 4, ry, 30, 5);
        for (let cx = x0 + 6; cx < x0 + 32; cx += 6) {
          rect(ctx, "#e0802e", cx, ry + 1, 2, 3);
          rect(ctx, "#5fae5a", cx - 1, ry - 2, 1, 3);
          rect(ctx, "#5fae5a", cx + 2, ry - 2, 1, 3);
        }
      }
      disc(ctx, INK, x1 - 12, 30, 5, 4);
      disc(ctx, "#d9503f", x1 - 12, 29, 4, 3);
      rect(ctx, "#fff6ee", x1 - 13, 28, 1, 1);
      rect(ctx, "#fff6ee", x1 - 10, 29, 1, 1);
      rect(ctx, "#f2e6cc", x1 - 13, 32, 3, 3);
      for (const [fx, fy, c] of [[x1 - 22, 12, "#f07a9a"], [x1 - 30, 20, "#f5c542"], [x1 - 18, 20, "#cfe7ff"], [x1 - 26, 8, "#f5c542"]] as const) {
        rect(ctx, "#3f8a4a", fx, fy + 1, 1, 3);
        rect(ctx, c, fx - 1, fy, 3, 1);
      }
      break;
    }
    case "observatory": {
      // night-sky slate with gold stars inlaid, and glowing crystals for hedges
      pave((x, y) => {
        const seam = y % 8 === 7 || (x + (Math.floor(y / 8) % 2 ? 6 : 0)) % 12 === 0;
        return seam ? "#1f2440" : hash(Math.floor(x / 12), Math.floor(y / 8), 14) > 0.5 ? "#2e3552" : "#353d5e";
      });
      const stars = [[20, 6], [34, 14], [52, 8], [70, 18], [88, 6], [106, 14], [124, 24], [44, 28], [96, 30]];
      for (const [sx, sy] of stars) {
        if (x0 + sx >= x1 - 2) continue;
        rect(ctx, "#f5c542", x0 + sx, sy, 1, 1);
        rect(ctx, "#fff1b0", x0 + sx - 1, sy, 3, 1);
        rect(ctx, "#fff1b0", x0 + sx, sy - 1, 1, 3);
      }
      // one constellation, joined up
      for (let i = 0; i < 12; i++) rect(ctx, "#6f76a8", x0 + 20 + i, 6 + Math.round(i * (8 / 12)), 1, 1);
      for (let i = 0; i < 18; i++) rect(ctx, "#6f76a8", x0 + 34 + i, 14 - Math.round(i * (6 / 18)), 1, 1);
      for (const hx of [2, w - 14]) {
        for (const [cx, cy, ht] of [[hx + 3, h - 8, 10], [hx + 7, h - 8, 14], [hx + 10, h - 8, 8], [hx + 5, 14, 9], [hx + 8, 16, 6]]) {
          rect(ctx, INK, cx - 2, cy - ht, 4, ht);
          rect(ctx, "#8ff0f0", cx - 1, cy - ht + 1, 2, ht - 1);
          rect(ctx, "#d7fbff", cx - 1, cy - ht + 1, 1, ht - 3);
        }
      }
      break;
    }
    case "post_office": {
      // blue-and-cream civic checkerboard, trim planters, a stack of parcels
      pave((x, y) => {
        const k = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
        if (x % 8 === 7 || y % 8 === 7) return "#a49cb3";
        return k ? "#fbf3dd" : "#7390cc";
      });
      sides("#3f8a4a", "#5fae5a", ["#ffffff", "#cfe7ff"], (cx, cy) => planter(cx, cy, "#4f6fb0", ["#ffffff", "#cfe7ff", "#ffffff"]));
      for (const [px, py, pw2, ph2] of [[x1 - 22, 22, 10, 8], [x1 - 20, 15, 7, 7], [x1 - 34, 26, 9, 7]] as const) {
        rect(ctx, INK, px - 1, py - 1, pw2 + 2, ph2 + 2);
        rect(ctx, "#c98f5a", px, py, pw2, ph2);
        rect(ctx, "#fff6ee", px + Math.floor(pw2 / 2), py, 1, ph2);
        rect(ctx, "#d97757", px + 1, py + 1, 2, 1);
      }
      break;
    }
    case "clock_tower": {
      // cobbles around a brass compass rose; gear-shaped planters
      pave((x, y) => {
        const cx = Math.floor(x / 5);
        const cy = Math.floor(y / 4);
        const edge = x % 5 === 4 || y % 4 === 3;
        return edge ? "#6f6880" : hash(cx, cy, 15) > 0.5 ? "#9a93a8" : "#a8a1b6";
      });
      const mx = Math.round(w / 2);
      const my = 20;
      disc(ctx, INK, mx, my, 16, 12);
      disc(ctx, "#c99a3e", mx, my, 15, 11);
      disc(ctx, "#b8b0c4", mx, my, 13, 9.5);
      for (const [dx, dy] of [[0, -8], [0, 8], [-11, 0], [11, 0]]) {
        for (let i = 0; i < 4; i++) {
          const t = i / 4;
          rect(ctx, "#f5c542", Math.round(mx + dx * (1 - t)), Math.round(my + dy * (1 - t)), 1, 1);
        }
      }
      rect(ctx, "#fff1b0", mx - 1, my - 1, 3, 3);
      for (const hx of [8, w - 8]) {
        disc(ctx, INK, hx, h - 12, 7, 6);
        disc(ctx, "#c99a3e", hx, h - 12, 6, 5);
        for (const [tx, ty] of [[0, -6], [0, 5], [-6, 0], [6, 0], [-4, -4], [4, -4], [-4, 4], [4, 4]]) rect(ctx, "#c99a3e", hx + tx, h - 12 + ty, 2, 2);
        disc(ctx, "#3f8a4a", hx, h - 13, 4, 3.5);
        disc(ctx, "#5fae5a", hx - 1, h - 14, 2, 1.5);
      }
      break;
    }
    case "library": {
      // a reading deck of warm boards with a rug; lavender, and stacks of books
      pave((x, y) => {
        if (y % 5 === 4) return "#8a5a3b";
        if ((x + (Math.floor(y / 5) % 3) * 9) % 26 === 0) return "#9c6639";
        return hash(Math.floor(x / 26), Math.floor(y / 5), 16) > 0.5 ? "#c98f5a" : "#d49c64";
      });
      const mx = Math.round(w / 2);
      rect(ctx, INK, mx - 20, 6, 40, 20);
      rect(ctx, "#7e5fb8", mx - 19, 7, 38, 18);
      rect(ctx, "#f5c542", mx - 17, 9, 34, 1);
      rect(ctx, "#f5c542", mx - 17, 22, 34, 1);
      for (let x = mx - 15; x < mx + 16; x += 6) rect(ctx, "#b7a4f0", x, 13, 3, 5);
      sides("#5f4596", "#7e5fb8", ["#b7a4f0", "#d9c8ff"], (cx, cy) => {
        for (const [i, c] of [[0, "#d9503f"], [1, "#4f6fb0"], [2, "#5fa84e"]] as const) {
          rect(ctx, INK, cx - 5, cy - 3 - i * 3, 10, 4);
          rect(ctx, c, cx - 4, cy - 2 - i * 3, 8, 2);
          rect(ctx, "#fff6ee", cx + 2, cy - 2 - i * 3, 1, 2);
        }
      });
      break;
    }
    case "office": {
      // smooth concrete slabs, glowing strip lights, glass bollards
      pave((x, y) => {
        if (y % 12 === 11 || x % 24 === 0) return "#9aa0b4";
        return hash(Math.floor(x / 24), Math.floor(y / 12), 17) > 0.5 ? "#d4d8e4" : "#cbd0de";
      });
      for (const y of [4, ph - 3]) rect(ctx, "#6fe3e1", x0 + 6, y, pw - 12, 1);
      const mx = Math.round(w / 2);
      for (const [dx, glyph] of [[-8, "<"], [0, "/"], [8, ">"]] as const) {
        const gx = mx + dx;
        if (glyph === "/") for (let i = 0; i < 7; i++) rect(ctx, "#4fb8c8", gx + 2 - Math.floor(i / 2), 16 + i, 1, 1);
        else for (let i = 0; i < 4; i++) {
          // "<" points left: both arms start at the right and meet at the middle
          rect(ctx, "#4fb8c8", gx + (glyph === "<" ? 3 - i : i), 16 + i, 1, 1);
          rect(ctx, "#4fb8c8", gx + (glyph === "<" ? 3 - i : i), 22 - i, 1, 1);
        }
      }
      for (const hx of [5, 12, w - 12, w - 5]) {
        rect(ctx, INK, hx - 2, h - 20, 5, 14);
        rect(ctx, "#2a2838", hx - 1, h - 19, 3, 12);
        rect(ctx, "#6fe3e1", hx - 1, h - 19, 3, 2);
      }
      break;
    }
    default: {
      // (a plain stone forecourt, just in case)
      pave((x, y) => (y % 6 === 5 || (x + (Math.floor(y / 6) % 2 ? 5 : 0)) % 10 === 0 ? "#a49cb3" : "#d8d2e0"));
    }
  }
  // every forecourt ends in a gold-trimmed step
  rect(ctx, "#c99a3e", x0 + 1, h - 8, pw - 2, 1);
  rect(ctx, "#6f6880", x0, h - 7, pw, 1);
}

/** A Moon Shard: a glowing crystal splinter with a twinkle that moves (12 x 16). */
function drawShard(ctx: Ctx, f: number) {
  const pts: [number, number, string][] = [];
  for (let y = 1; y < 15; y++) {
    const half = y < 8 ? Math.round((y / 7) * 4) : Math.round(((15 - y) / 7) * 4);
    for (let x = 6 - half; x <= 6 + half; x++) pts.push([x, y, x < 6 ? "#d7fbff" : x === 6 ? "#8ff0f0" : "#4fc4d8"]);
  }
  for (const [x, y] of pts) rect(ctx, INK, x - 1, y, 3, 1);
  for (const [x, y] of pts) rect(ctx, INK, x, y - 1, 1, 3);
  for (const [x, y, c] of pts) rect(ctx, c, x, y, 1, 1);
  rect(ctx, "#b7a4f0", 7, 9, 2, 3);
  const tw = [[4, 4], [8, 6], [5, 10]][f];
  rect(ctx, "#ffffff", tw[0], tw[1], 1, 1);
  if (f === 1) {
    rect(ctx, "#ffffff", 10, 1, 1, 3);
    rect(ctx, "#ffffff", 9, 2, 3, 1);
  }
}

// ---------------------------------------------------------------- moon rocks

const MOONROCK = { deep: "#4f4862", dark: "#6f6880", base: "#9a93a8", light: "#bdb6cb", hi: "#d8d2e2" };

/**
 * Fill a mask with moon-rock shading (lit from the upper left) and outline it.
 * `inside(x, y)` says which pixels are rock.
 */
function rockShape(ctx: Ctx, w: number, h: number, inside: (x: number, y: number) => boolean, seed: number) {
  const m: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    m.push([]);
    for (let x = 0; x < w; x++) m[y].push(inside(x, y));
  }
  const at = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && m[y][x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (m[y][x]) {
        const edgeTL = !at(x - 1, y) || !at(x, y - 1);
        const edgeBR = !at(x + 1, y) || !at(x, y + 1);
        const n = hash(x >> 1, y >> 1, seed);
        let c = n > 0.55 ? MOONROCK.base : MOONROCK.light;
        if (x > w * 0.55 || y > h * 0.7) c = n > 0.5 ? MOONROCK.dark : MOONROCK.base;
        if (edgeTL) c = MOONROCK.hi;
        if (edgeBR) c = MOONROCK.deep;
        rect(ctx, c, x, y, 1, 1);
      } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        rect(ctx, INK, x, y, 1, 1);
      }
    }
  }
}

function pit(ctx: Ctx, x: number, y: number, r: number) {
  disc(ctx, MOONROCK.deep, x, y, r, r * 0.6);
  disc(ctx, MOONROCK.dark, x + 0.5, y + 0.5, r * 0.7, r * 0.4);
  rect(ctx, MOONROCK.hi, Math.round(x + r * 0.3), Math.round(y + r * 0.5), 2, 1);
}

/** A few chunky pebbles, faceted (three variants). */
function drawRockSmall(ctx: Ctx, v: number) {
  const variants: [number, number, number, number][][] = [
    [[6, 9, 5.5, 4], [14, 10, 4.5, 3.4], [10, 6, 3.5, 3]],
    [[8, 9, 6.5, 4.5], [16, 11, 3.2, 2.6]],
    [[5, 10, 4, 3], [12, 8, 5, 4.5], [17, 11, 2.5, 2.2]],
  ];
  const stones = variants[v];
  rockShape(ctx, 20, 15, (x, y) => stones.some(([cx, cy, rx, ry]) => {
    const jag = (hash(Math.floor(x / 2), Math.floor(y / 2), 20 + v) - 0.5) * 0.35;
    return ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 < 1 + jag;
  }), 3 + v);
  const [cx, cy] = stones[0];
  rect(ctx, MOONROCK.deep, cx, cy - 1, 2, 1);
}

/** A big cratered boulder (three variants). */
function drawRockBig(ctx: Ctx, v: number) {
  const [rx, ry, sx, sy] = [[15, 10.5, 29, 20], [14, 11.5, 5, 21], [16, 9.5, 28, 11]][v];
  rockShape(ctx, 36, 26, (x, y) => {
    const jag = (hash(Math.floor(x / 3), v, 9) - 0.5) * 2.4;
    return ((x - 17) / rx) ** 2 + ((y - 15 + jag) / ry) ** 2 < 1 || ((x - sx) / 5.5) ** 2 + ((y - sy) / 4.5) ** 2 < 1;
  }, 5 + v);
  pit(ctx, 21 - v * 3, 12, 3.5 - v * 0.5);
  pit(ctx, 11 + v * 2, 17, 2.5);
  for (let i = 0; i < 5; i++) rect(ctx, MOONROCK.deep, 14 + v * 3 + (i >> 1), 7 + i, 1, 1);
}

function prismC(ctx: Ctx, cx: number, by: number, hw: number, h: number, c: { light: string; base: string; dark: string }) {
  for (let dx = -hw - 1; dx <= hw + 1; dx++) rect(ctx, INK, cx + dx, by - h - 1 + Math.round(Math.abs(dx) * 1.4), 1, h + 1 - Math.round(Math.abs(dx) * 1.4));
  for (let dx = -hw; dx <= hw; dx++) {
    const top = by - h + Math.round(Math.abs(dx) * 1.4);
    rect(ctx, dx < 0 ? c.light : dx === 0 ? c.base : c.dark, cx + dx, top, 1, by - top);
  }
}

function drawRockCrystal(ctx: Ctx) {
  const CYAN = { light: "#bff6f2", base: "#6fe3e1", dark: "#3aa6b8" };
  const VIOLET = { light: "#d7c9ff", base: "#a98ff0", dark: "#7a62c9" };
  prismC(ctx, 9, 20, 2, 17, CYAN);
  prismC(ctx, 4, 21, 1, 9, VIOLET);
  prismC(ctx, 14, 21, 2, 11, CYAN);
  rect(ctx, "#ffffff", 8, 7, 1, 2);
  rockShape(ctx, 20, 28, (x, y) => y > 18 && ((x - 9.5) / 9) ** 2 + ((y - 23) / 4.5) ** 2 < 1, 7);
}

function drawRockSpire(ctx: Ctx) {
  rockShape(ctx, 18, 36, (x, y) => {
    if (y < 2) return false;
    const half = 1.5 + ((y - 2) / 33) ** 0.8 * 7 + (hash(0, Math.floor(y / 3), 11) - 0.5) * 2;
    const lean = (35 - y) * 0.08;
    return Math.abs(x + 0.5 - 9 - lean) < half && y < 35;
  }, 9);
  for (const y of [12, 20, 27]) rect(ctx, MOONROCK.hi, 6, y, 4, 1);
}

function drawRockArch(ctx: Ctx) {
  rockShape(ctx, 52, 40, (x, y) => {
    const jag = (hash(Math.floor(x / 3), Math.floor(y / 4), 13) - 0.5) * 2.5;
    const outer = ((x + 0.5 - 26) / 25) ** 2 + ((y + 0.5 - 40) / (37 + jag)) ** 2 < 1;
    const inner = ((x + 0.5 - 26) / 13) ** 2 + ((y + 0.5 - 40) / 24) ** 2 < 1;
    return outer && !inner && y < 39;
  }, 13);
  pit(ctx, 16, 12, 2.5);
  pit(ctx, 36, 18, 2);
  for (const [x, y] of [[8, 30], [44, 28], [22, 6]]) rect(ctx, "#6fe3e1", x, y, 1, 1);
}

/** An ornate plaza lamppost (14 x 30). */
function drawGrandLamp(ctx: Ctx) {
  rect(ctx, INK, 4, 26, 7, 4);
  rect(ctx, "#5b5470", 5, 27, 5, 2);
  rect(ctx, INK, 6, 7, 3, 20);
  rect(ctx, "#5b5470", 7, 8, 1, 19);
  for (const y of [12, 20]) rect(ctx, "#f5c542", 6, y, 3, 1);
  // lantern head
  rect(ctx, INK, 3, 0, 9, 2);
  rect(ctx, INK, 3, 2, 9, 6);
  rect(ctx, "#bff6f4", 4, 2, 7, 5);
  rect(ctx, "#6fe3e1", 5, 4, 5, 2);
  rect(ctx, "#f5c542", 5, 0, 5, 1);
}

/** The ship you arrived in, drawn at native size (twice a person's height). */
function drawShip(ctx: Ctx) {
  const W = 28;
  const H = 57;
  const cx = 14;
  const half = (y: number): number => {
    if (y < 16) return 1 + Math.pow(y / 15, 0.6) * 7;
    if (y < 44) return 8;
    if (y < 48) return 8 - (y - 43) * 0.6;
    return 0;
  };
  const grid: (string | null)[][] = Array.from({ length: H }, () => new Array<string | null>(W).fill(null));
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < W && y < H) grid[y][x] = c;
  };
  // fins behind the body
  for (let y = 33; y < 51; y++) {
    const reach = 8 + Math.round((y - 33) * 0.42);
    for (let d = 7; d <= reach; d++) {
      const c = y > 47 ? "#b85c3e" : "#d97757";
      set(cx - 1 - d, y, c);
      set(cx + d, y, c);
    }
  }
  // legs
  for (let y = 50; y < 56; y++) {
    set(cx - 9 - Math.floor((y - 50) / 2), y, "#8a7f9c");
    set(cx + 8 + Math.floor((y - 50) / 2), y, "#8a7f9c");
  }
  // nozzle
  for (let y = 47; y < 52; y++) for (let x = cx - 4; x < cx + 4; x++) set(x, y, x < cx ? "#8a7f9c" : "#6f6588");
  // body
  for (let y = 0; y < 48; y++) {
    const hw = half(y);
    for (let x = 0; x < W; x++) {
      const d = x + 0.5 - cx;
      if (Math.abs(d) > hw) continue;
      let c = d > hw * 0.35 ? "#cbbfd6" : d < -hw + 2 ? "#ffffff" : "#f6efe2";
      if ((y === 17 || y === 18 || y === 40 || y === 41) && y < 44) c = d > hw * 0.35 ? "#b85c3e" : "#d97757";
      if (y < 5) c = d > 0 ? "#b85c3e" : "#d97757";
      set(x, y, c);
    }
  }
  // porthole
  for (let y = 21; y < 32; y++)
    for (let x = cx - 5; x < cx + 5; x++) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - 26);
      if (r <= 4.6) set(x, y, r > 3.6 ? "#3b2a3a" : x + 0.5 - cx < -1 && y < 26 ? "#c8f4ff" : "#1f3a4d");
    }
  // outline pass
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (grid[y][x]) continue;
      const n = [grid[y - 1]?.[x], grid[y + 1]?.[x], grid[y][x - 1], grid[y][x + 1]];
      if (n.some((c) => c)) rect(ctx, INK, x, y, 1, 1);
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = grid[y][x];
      if (c) rect(ctx, c, x, y, 1, 1);
    }
}

/** Earth from the Moon: two continents, polar ice, cloud wisps, night side lower right. */
function drawEarth(ctx: Ctx, size: number) {
  const r = size / 2 - 0.5;
  const c = size / 2;
  const inBlob = (x: number, y: number, bx: number, by: number, rx: number, ry: number) => ((x - bx) / rx) ** 2 + ((y - by) / ry) ** 2 <= 1;
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5 - c) / r;
      const y = (py + 0.5 - c) / r;
      if (x * x + y * y > 1) continue;
      const land =
        inBlob(x, y, -0.38, -0.2, 0.36, 0.3) || inBlob(x, y, -0.2, 0.2, 0.18, 0.28) || inBlob(x, y, 0.35, 0.28, 0.34, 0.24) || inBlob(x, y, 0.42, -0.35, 0.14, 0.12);
      const ice = y < -0.86 || y > 0.9;
      const cloud = inBlob(x, y, 0.1, -0.52, 0.34, 0.06) || inBlob(x, y, -0.45, 0.52, 0.3, 0.06) || inBlob(x, y, 0.55, 0.02, 0.2, 0.05);
      const shade = x * 0.62 + y * 0.62;
      let col = ice || cloud ? "#eef4ff" : land ? "#5aa860" : "#3a6fd8";
      if (shade > 0.3) col = ice || cloud ? "#b8c4e0" : land ? "#3f7d48" : "#2c55b0";
      if (shade > 0.72) col = ice || cloud ? "#6a74a0" : land ? "#24483a" : "#1b2c6e";
      if (x * x + y * y > 0.78 && shade < -0.35) col = ice || cloud ? "#ffffff" : land ? "#7cc47e" : "#6a9cf0";
      rect(ctx, col, px, py, 1, 1);
      // city lights on the night side
      if (land && shade > 0.72 && hashLite(px, py) > 0.78) rect(ctx, "#ffb347", px, py, 1, 1);
    }
}

const hashLite = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** A drop shadow drawn at exactly `w` pixels wide — never scaled. */
export function shadowKey(scene: Phaser.Scene, w: number): string {
  w = Math.max(6, Math.round(w / 2) * 2);
  const key = `shadow_${w}`;
  if (!scene.textures.exists(key)) {
    const h = Math.max(3, Math.round(w / 3.2));
    canvasTex(scene, key, w, h, (ctx) => disc(ctx, "rgba(42,28,58,0.24)", w / 2, h / 2, w / 2, h / 2));
  }
  return key;
}

export function buildTextures(scene: Phaser.Scene) {
  registerSprite(scene, "astro", astronaut);
  registerSprite(scene, "rabbit", jadeRabbit);
  registerSprite(scene, "postmaster", postmaster);
  registerSprite(scene, "timekeeper", timekeeper);
  registerSprite(scene, "stargazer", stargazer);
  registerSprite(scene, "scholar", scholar);
  registerSprite(scene, "rocket", rocket);
  // Talk-dialog portraits: portrait_<villager>_<0 rest | 1 talk | 2 blink>.
  const portraitOf: VillagerId[] = ["jade_rabbit", "postmaster", "timekeeper", "scholar", "stargazer"];
  for (const v of portraitOf)
    for (const f of [0, 1, 2] as PortraitFrame[]) canvasTex(scene, `portrait_${v}_${f}`, PORTRAIT, PORTRAIT, (ctx) => drawPortrait(ctx, v, f));
  canvasTex(scene, "portrait_sky", PORTRAIT + 8, PORTRAIT + 8, (ctx) => drawPortraitSky(ctx, PORTRAIT + 8));
  for (const [name, sprite] of Object.entries(ICON_SPRITES)) registerSprite(scene, `icon_${name}`, sprite);
  for (const [v, sprite] of Object.entries(VILLAGER_ICONS)) registerSprite(scene, `vicon_${v}`, sprite);
  for (const [m, sprite] of Object.entries(MATERIAL_ICONS)) registerSprite(scene, `mat_${m}`, sprite);
  canvasTex(scene, "task_lantern", 16, 26, drawStoneLantern);
  for (const id of DECOR_ART_IDS) {
    const a = decorArt(id)!;
    for (let f = 0; f < a.frames; f++) canvasTex(scene, `deco_${id}_${f}`, a.w, a.h, (ctx) => a.draw(ctx, f, true));
    if (decorById(id)?.light) canvasTex(scene, `deco_${id}_off`, a.w, a.h, (ctx) => a.draw(ctx, 0, false));
  }

  // Baby clods — the Claude sunburst. Two rotations for a twinkle.
  canvasTex(scene, "clod_0", 15, 15, (c) => drawSpark(c, 15, 0, true));
  canvasTex(scene, "clod_1", 15, 15, (c) => drawSpark(c, 15, Math.PI / 8, true));
  canvasTex(scene, "spark_logo", 24, 24, (c) => drawSpark(c, 24, 0, false));

  canvasTex(scene, "b_player_house", 112, 108, drawManor);
  canvasTex(scene, "b_rabbit_burrow", 112, 96, drawHollow);
  canvasTex(scene, "b_post_office", 112, 116, drawGrandPost);
  canvasTex(scene, "b_mailbox", 16, 24, drawMailbox);
  canvasTex(scene, "b_clock_tower", 72, 180, drawGrandClock);
  canvasTex(scene, "b_rocket_pad", 48, 112, drawMailRocket);
  canvasTex(scene, "b_observatory", 112, 124, drawGrandObservatory);
  canvasTex(scene, "b_library", 128, 120, drawGrandLibrary);
  canvasTex(scene, "b_office", 128, 156, drawOfficeTower);
  // The office interior.
  canvasTex(scene, "office_room", ROOM_W, ROOM_H, drawRoom);
  for (const screen of ["off", "code0", "code1", "code2", "think0", "think1", "think2", "wait", "done", "failed"] as const) canvasTex(scene, `desk_${screen}`, 48, 32, (ctx) => drawDesk(ctx, screen));
  for (let look = 0; look < WORKER_LOOKS; look++) {
    for (const f of [0, 1]) canvasTex(scene, `worker_back_${look}_${f}`, 20, 26, (ctx) => drawWorkerBack(ctx, look, f));
    canvasTex(scene, `worker_front_${look}`, 16, 26, (ctx) => drawWorkerFront(ctx, look));
  }
  canvasTex(scene, "office_lead", 16, 26, (ctx) => drawWorkerFront(ctx, 4, true));
  canvasTex(scene, "office_coffee", 18, 32, drawCoffee);
  canvasTex(scene, "office_plant", 18, 26, drawPlant);
  canvasTex(scene, "office_couch", 52, 26, drawCouch);
  // A staked plot per building, the size of its footprint, and its formal grounds.
  for (const b of Object.keys(SPOTS) as BuildingId[]) {
    const t = buildingTiles(b);
    if (!isAnnex(b)) canvasTex(scene, `grounds_${b}`, (t.w + 4) * TILE, 44, (ctx) => drawGrounds(ctx, (t.w + 4) * TILE, 44, b));
    canvasTex(scene, `plot_${b}`, t.w * TILE, t.h * TILE + 16, (ctx) => drawPlot(ctx, t.w * TILE, t.h * TILE + 16));
    // A neighbor's lot: the old ruin, then the repaired foundation.
    canvasTex(scene, `ruins_${b}`, t.w * TILE, t.h * TILE + 16, (ctx) => drawRuins(ctx, t.w * TILE, t.h * TILE + 16));
    canvasTex(scene, `foundation_${b}`, t.w * TILE, t.h * TILE + 16, (ctx) => drawFoundation(ctx, t.w * TILE, t.h * TILE + 16));
  }
  for (const v of [0, 1]) canvasTex(scene, `rubble_${v}`, 24, 18, (ctx) => drawRubble(ctx, v));

  canvasTex(scene, "ship", 28, 57, drawShip);
  for (const f of [0, 1, 2]) canvasTex(scene, `plaza_fountain_${f}`, 120, 100, (ctx) => drawPlazaFountain(ctx, f));
  canvasTex(scene, "obelisk", 18, 58, drawObelisk);
  canvasTex(scene, "topiary", 16, 24, drawTopiary);
  canvasTex(scene, "plaza_garden", 44, 24, drawPlazaGarden);
  for (const f of [0, 1, 2]) canvasTex(scene, `shard_${f}`, 12, 16, (ctx) => drawShard(ctx, f));
  for (const v of [0, 1, 2]) {
    canvasTex(scene, `rock_small_${v}`, 20, 15, (ctx) => drawRockSmall(ctx, v));
    canvasTex(scene, `rock_big_${v}`, 36, 26, (ctx) => drawRockBig(ctx, v));
  }
  canvasTex(scene, "rock_crystal", 20, 28, drawRockCrystal);
  canvasTex(scene, "rock_spire", 18, 36, drawRockSpire);
  canvasTex(scene, "rock_arch", 52, 40, drawRockArch);
  canvasTex(scene, "lamp_grand", 14, 30, drawGrandLamp);
  canvasTex(scene, "earth_s", 28, 28, (ctx) => drawEarth(ctx, 28));
  canvasTex(scene, "earth_l", 56, 56, (ctx) => drawEarth(ctx, 56));
  canvasTex(scene, "spark_plaza", 33, 33, (c) => drawSpark(c, 33, 0, false));
  canvasTex(scene, "clod_icon", 9, 9, (c) => drawSpark(c, 9, 0, false));
  canvasTex(scene, "dot", 5, 5, (ctx) => disc(ctx, "#ffffff", 2.5, 2.5, 2.5));
  canvasTex(scene, "bang_s", 7, 10, (ctx) => {
    box(ctx, "#f5c542", 0, 0, 7, 10);
    rect(ctx, INK, 3, 2, 1, 4);
    rect(ctx, INK, 3, 7, 1, 1);
  });

  // Solar path lamp — cozy post, sci-fi glow cell.
  canvasTex(scene, "lamp", 7, 18, (ctx) => {
    rect(ctx, INK, 2, 5, 3, 13);
    rect(ctx, "#8a5a3b", 3, 5, 1, 12);
    box(ctx, "#bff6f4", 0, 0, 7, 6);
    rect(ctx, "#6fe3e1", 1, 3, 5, 2);
    rect(ctx, "#2f4f6f", 1, 1, 5, 1);
  });

  // Moondust drifts: soft lavender piles in three shapes.
  for (let v = 0; v < 3; v++) {
    canvasTex(scene, `dust_${v}`, 20, 9, (ctx) => {
      const blobs = [
        [[6, 6, 6, 3], [13, 5, 5, 3.4], [10, 7, 8, 2.2]],
        [[5, 6, 4.5, 2.6], [11, 5, 6.5, 3.6], [16, 7, 3.5, 1.8]],
        [[8, 6, 7, 3], [15, 6, 4, 2.4], [4, 7, 3, 1.6]],
      ][v];
      for (const [x, y, rx, ry] of blobs) disc(ctx, "#9d95b0", x, y + 0.6, rx + 0.6, ry + 0.6);
      for (const [x, y, rx, ry] of blobs) disc(ctx, "#c4bcd6", x, y, rx, ry);
      for (const [x, y, rx, ry] of blobs) disc(ctx, "#ddd6ea", x - 1, y - 1, rx * 0.5, ry * 0.45);
      for (let i = 0; i < 6; i++) rect(ctx, "#8a8199", 3 + ((i * 7 + v * 3) % 14), 5 + (i % 3), 1, 1);
    });
  }
  // Doorbell on a little post; frame 1 is mid-swing.
  for (const swing of [0, 1]) {
    canvasTex(scene, `bell_${swing}`, 9, 16, (ctx) => {
      rect(ctx, INK, 3, 3, 3, 13);
      rect(ctx, "#8a5a3b", 4, 3, 1, 13);
      rect(ctx, INK, 1, 2, 7, 1);
      const bx = swing ? 2 : 1;
      rect(ctx, INK, bx + 2, 3, 1, 1);
      box(ctx, "#d9a441", bx, 4, 5, 5);
      rect(ctx, "#f5d27a", bx + 1, 5, 1, 2);
      rect(ctx, INK, bx + 2, 9, 1, 1);
    });
  }
  canvasTex(scene, "moonrock", 11, 9, (ctx) => {
    disc(ctx, INK, 5.5, 5, 5.5, 4);
    disc(ctx, "#6f6588", 5.5, 5, 4.6, 3.2);
    disc(ctx, "#8a7fa0", 4.5, 4, 2.6, 1.8);
    rect(ctx, "#ffb347", 3, 5, 3, 1);
    rect(ctx, "#ffb347", 6, 4, 1, 3);
    rect(ctx, "#fff0b0", 5, 5, 1, 1);
    rect(ctx, "#ffb347", 8, 6, 1, 1);
  });
  canvasTex(scene, "crater_s", 20, 10, (ctx) => {
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 20; x++) {
        const d = ((x + 0.5 - 10) / 10) ** 2 + ((y + 0.5 - 5) / 5) ** 2;
        if (d > 1) continue;
        const rim = d > 0.6;
        rect(ctx, rim ? (y < 5 ? "#8a8199" : "#d2cbe0") : y < 5 ? "#8a8199" : "#a8a0b8", x, y, 1, 1);
      }
  });
  canvasTex(scene, "meteor", 7, 7, (ctx) => {
    disc(ctx, "#e0503a", 3.5, 3.5, 3.5);
    disc(ctx, "#ffcf6a", 3.5, 3.5, 2.4);
    rect(ctx, "#fff6d0", 3, 3, 1, 1);
  });

  for (const [key, size] of [["glow_s", 22], ["glow", 32], ["glow_l", 44]] as const) {
    canvasTex(scene, key, size, size, (ctx) => {
      // Stepped rings rather than a smooth gradient, so light sits on the pixel grid too.
      const c = size / 2;
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
          if (d >= 1) continue;
          const a = Math.round((1 - d) * 5) / 5;
          if (a > 0) rect(ctx, `rgba(255,210,160,${(a * 0.9).toFixed(2)})`, x, y, 1, 1);
        }
    });
  }

  canvasTex(scene, "spark", 3, 3, (ctx) => {
    rect(ctx, "#fff2c8", 1, 0, 1, 3);
    rect(ctx, "#fff2c8", 0, 1, 3, 1);
  });

  canvasTex(scene, "coin", 8, 8, (ctx) => {
    disc(ctx, "#a8762a", 4, 4, 4);
    disc(ctx, "#f5c542", 4, 4, 3.2);
    rect(ctx, "#fff0b0", 2, 2, 2, 1);
  });

  canvasTex(scene, "smoke", 8, 8, (ctx) => disc(ctx, "#9a93a8", 4, 4, 3.8));

  canvasTex(scene, "letter", 12, 9, (ctx) => {
    box(ctx, "#fff6ee", 0, 0, 12, 9);
    for (let i = 0; i < 5; i++) {
      rect(ctx, INK, 1 + i, 1 + i, 1, 1);
      rect(ctx, INK, 10 - i, 1 + i, 1, 1);
    }
    rect(ctx, CORAL, 5, 5, 2, 2);
  });

  canvasTex(scene, "bang", 9, 13, (ctx) => {
    box(ctx, "#f5c542", 0, 0, 9, 13);
    rect(ctx, INK, 3, 2, 3, 6);
    rect(ctx, INK, 3, 9, 3, 2);
  });

  canvasTex(scene, "thought", 16, 13, (ctx) => {
    disc(ctx, INK, 9, 5, 7, 5);
    disc(ctx, "#fff6e6", 9, 5, 6, 4);
    disc(ctx, INK, 3, 11, 2);
    disc(ctx, "#fff6e6", 3, 11, 1.2);
    rect(ctx, "#7e5fb8", 5, 5, 2, 2);
    rect(ctx, "#7e5fb8", 8, 5, 2, 2);
    rect(ctx, "#7e5fb8", 11, 5, 2, 2);
  });

  canvasTex(scene, "sky_lantern", 8, 11, (ctx) => {
    box(ctx, "#e0503a", 0, 0, 8, 10);
    rect(ctx, "#f5a05a", 1, 1, 6, 3);
    rect(ctx, "#fff0b0", 3, 5, 2, 4);
    rect(ctx, INK, 2, 10, 4, 1);
  });


}

export function buildAnims(scene: Phaser.Scene) {
  const mk = (key: string, frames: string[], frameRate: number) => {
    if (scene.anims.exists(key)) return;
    scene.anims.create({ key, frames: frames.map((t) => ({ key: t })), frameRate, repeat: -1 });
  };
  mk("walk-down", ["astro_1", "astro_0", "astro_2", "astro_0"], 8);
  mk("walk-up", ["astro_4", "astro_3", "astro_5", "astro_3"], 8);
  mk("walk-side", ["astro_7", "astro_6", "astro_8", "astro_6"], 8);
  mk("clod-twinkle", ["clod_0", "clod_1"], 4);
  mk("desk-coding", ["desk_code0", "desk_code1", "desk_code2"], 3);
  mk("desk-thinking", ["desk_think0", "desk_think1", "desk_think2"], 2);
  for (let look = 0; look < WORKER_LOOKS; look++) mk(`worker-typing-${look}`, [`worker_back_${look}_0`, `worker_back_${look}_1`], 5);
  mk("shard-twinkle", ["shard_0", "shard_1", "shard_2", "shard_1"], 4);
  mk("plaza-fountain", ["plaza_fountain_0", "plaza_fountain_1", "plaza_fountain_2"], 4);
  mk("jade_rabbit-idle", ["rabbit_0", "rabbit_1"], 1.5);
  mk("postmaster-idle", ["postmaster_0", "postmaster_0", "postmaster_0", "postmaster_1"], 2);
  mk("timekeeper-idle", ["timekeeper_0", "timekeeper_1"], 1);
  mk("stargazer-idle", ["stargazer_0", "stargazer_1"], 2);
  mk("scholar-idle", ["scholar_0", "scholar_0", "scholar_0", "scholar_1"], 2);
  for (const id of DECOR_ART_IDS) {
    const n = decorArt(id)!.frames;
    if (n > 1) mk(`deco_${id}`, Array.from({ length: n }, (_, f) => `deco_${id}_${f}`), id === "flag" ? 3 : 1.5);
  }
}
