import { EMOTES } from "./idle";
import { drawDigSpot, drawHeliumNode, drawIceNode, drawMarket, drawOreNode, drawScrapNode, drawTownHall } from "./townart";
import Phaser from "phaser";
import { drawStar } from "./star";
import type { PixelSprite } from "./art";
import {
  astronaut,
  jadeRabbit,
  postmaster,
  timekeeper,
  stargazer,
  scholar,
  dj,
  mechanic,
  rocket,
} from "./art";
import { DECOR_ART_IDS, decorArt, drawStoneLantern } from "./decorart";
import { ICON_SPRITES, ITEM_ICONS, MATERIAL_ICONS, VILLAGER_ICONS } from "./icons";
import { decorById } from "../../shared/decor";
import { drawMailbox, drawPlot, drawRuins, drawFoundation, drawRubble } from "./buildings";
import { drawGrandClock, drawGrandLibrary, drawGrandObservatory, drawGrandPost, drawHollow, drawMailRocket, drawManor, drawRadioTower, drawWorkshop } from "./estate";
import { SPOTS, TILE, buildingTiles, isAnnex } from "./layout";
import type { BuildingId, VillagerId } from "../../shared/game";
import { type Ctx, INK, box, disc, hash, rect } from "./pix";
import { PORTRAIT, drawPortrait, drawPortraitSky, type PortraitFrame } from "./portraits";
import { ROOM_H, ROOM_W, WORKER_LOOKS, drawCoffee, drawCouch, drawDesk, drawOfficeTower, drawPlant, drawRoom, drawWorkerBack, drawWorkerFront } from "./officeart";

const ROSE = "#e0708a";
const ROSE_DARK = "#b44f6c";
const ROSE_LIGHT = "#f2a3b8";

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

// ---------------------------------------------------------------- the plaza

const P_STONE = { base: "#b8b0c4", dark: "#8a8298", light: "#dcd6e4" };
const P_WATER = { base: "#7fc6e6", dark: "#5aa7cf", light: "#dff4fb" };

const MARBLE = { base: "#e2dce8", dark: "#b8b0c4", light: "#f6f2fa" };
const GOLDC = { base: "#f5c542", dark: "#c99a3e", light: "#fff1b0" };

/** A marble bowl: front wall, gold-lipped rim, water. */
function bowl(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, wall: number, dry = false) {
  disc(ctx, INK, cx, cy + wall + 0.5, rx + 1, ry + 1.5);
  disc(ctx, MARBLE.dark, cx, cy + wall, rx, ry);
  disc(ctx, MARBLE.base, cx, cy + wall - 1, rx, ry - 1, cy + wall);
  disc(ctx, INK, cx, cy, rx + 1, ry + 1);
  disc(ctx, GOLDC.base, cx, cy, rx, ry);
  disc(ctx, MARBLE.light, cx, cy, rx - 1, ry - 1);
  disc(ctx, INK, cx, cy + 0.5, rx - 3.5, ry - 2.6);
  // (dry: a cracked, dusty basin instead of water)
  disc(ctx, dry ? "#9a93a8" : P_WATER.base, cx, cy + 0.5, rx - 4.5, ry - 3.4);
  disc(ctx, dry ? "#8a8199" : P_WATER.dark, cx + 2, cy + 1.5, (rx - 4.5) * 0.55, (ry - 3.4) * 0.45);
  if (dry) for (let i = 0; i < 3; i++) rect(ctx, INK, Math.round(cx - rx / 3 + i * (rx / 3)), Math.round(cy + (i % 2)), Math.max(2, Math.round(rx / 6)), 1);
}

/**
 * The Earthrise Fountain (120 x 100) in its three stages: dry and cracked,
 * flowing again, then flowing under a turning star.
 */
function drawPlazaFountain(ctx: Ctx, f: number, stage = 2) {
  const dry = stage === 0;
  bowl(ctx, 60, 82, 57, 13, 5, dry);
  // lily pads in the great basin
  if (!dry) for (const [x, y] of [[20, 84], [98, 80], [34, 90], [84, 90]] as const) {
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
      if (dry || (i + f) % 3 === 0) continue;
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
  bowl(ctx, 60, 50, 30, 7, 3, dry);
  // upper tier
  rect(ctx, INK, 55, 28, 10, 22);
  rect(ctx, MARBLE.base, 56, 28, 8, 22);
  rect(ctx, MARBLE.light, 56, 28, 2, 22);
  rect(ctx, GOLDC.base, 56, 38, 8, 1);
  bowl(ctx, 60, 28, 16, 4.5, 2, dry);
  if (dry) {
    // cracks down the marble, and a chip off the top tier
    for (const [x, y0, n] of [[55, 56, 9], [62, 30, 7], [40, 84, 5], [80, 86, 6]] as const)
      for (let i = 0; i < n; i++) rect(ctx, INK, x + (i % 2), y0 + i, 1, 1);
    rect(ctx, MARBLE.dark, 64, 24, 3, 3);
    return;
  }
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
  // gold orb pedestal and the turning star
  disc(ctx, INK, 60, 25, 4.5, 3);
  disc(ctx, GOLDC.base, 60, 25, 3.5, 2);
  if (stage === 2) drawStar(ctx, 48, 0, 25, { face: false, rot: (f * Math.PI) / 16 });
  // sparkles on the water
  const glints = [[[22, 80], [70, 86], [96, 84], [50, 49]], [[40, 84], [88, 80], [26, 88], [68, 50]], [[58, 88], [30, 82], [104, 86], [56, 27]]][f];
  for (const [x, y] of glints) rect(ctx, "#ffffff", x, y, 2, 1);
}

/** A marble obelisk with a gold tip and a glowing rose gem (18 x 58). */
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
  disc(ctx, ROSE, 9, 22, 1.8);
  rect(ctx, ROSE_LIGHT, 8, 21, 1, 1);
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
    rect(ctx, ["#f07a9a", "#f5c542", "#cfe7ff", "#b7a4f0", ROSE, "#ffffff"][i % 6], x, y, i % 3 ? 1 : 2, 1);
  }
  rect(ctx, INK, 0, 13, 44, 11);
  rect(ctx, MARBLE.base, 1, 15, 42, 8);
  rect(ctx, MARBLE.light, 1, 15, 42, 1);
  rect(ctx, GOLDC.base, 1, 18, 42, 1);
  rect(ctx, MARBLE.dark, 1, 22, 42, 1);
  rect(ctx, "#6b4a3a", 1, 14, 42, 1);
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
      const c = y > 47 ? "#b44f6c" : "#e0708a";
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
      if ((y === 17 || y === 18 || y === 40 || y === 41) && y < 44) c = d > hw * 0.35 ? "#b44f6c" : "#e0708a";
      if (y < 5) c = d > 0 ? "#b44f6c" : "#e0708a";
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
  for (const [k, s] of Object.entries(EMOTES)) registerSprite(scene, `emote_${k}`, s);
  registerSprite(scene, "rabbit", jadeRabbit);
  registerSprite(scene, "postmaster", postmaster);
  registerSprite(scene, "timekeeper", timekeeper);
  registerSprite(scene, "stargazer", stargazer);
  registerSprite(scene, "scholar", scholar);
  registerSprite(scene, "dj", dj);
  registerSprite(scene, "mechanic", mechanic);
  registerSprite(scene, "rocket", rocket);
  // Talk-dialog portraits: portrait_<villager>_<0 rest | 1 talk | 2 blink>.
  const portraitOf: VillagerId[] = ["jade_rabbit", "postmaster", "timekeeper", "scholar", "stargazer", "manager", "dj", "mechanic"];
  for (const v of portraitOf)
    for (const f of [0, 1, 2] as PortraitFrame[]) canvasTex(scene, `portrait_${v}_${f}`, PORTRAIT, PORTRAIT, (ctx) => drawPortrait(ctx, v, f));
  canvasTex(scene, "portrait_sky", PORTRAIT + 8, PORTRAIT + 8, (ctx) => drawPortraitSky(ctx, PORTRAIT + 8));
  for (const [name, sprite] of Object.entries(ICON_SPRITES)) registerSprite(scene, `icon_${name}`, sprite);
  for (const [v, sprite] of Object.entries(VILLAGER_ICONS)) registerSprite(scene, `vicon_${v}`, sprite);
  for (const [k, sprite] of Object.entries(ITEM_ICONS)) registerSprite(scene, `item_${k}`, sprite);
  for (const [m, sprite] of Object.entries(MATERIAL_ICONS)) registerSprite(scene, `mat_${m}`, sprite);
  canvasTex(scene, "task_lantern", 16, 26, drawStoneLantern);
  for (const id of DECOR_ART_IDS) {
    const a = decorArt(id)!;
    for (let f = 0; f < a.frames; f++) canvasTex(scene, `deco_${id}_${f}`, a.w, a.h, (ctx) => a.draw(ctx, f, true));
    if (decorById(id)?.light) canvasTex(scene, `deco_${id}_off`, a.w, a.h, (ctx) => a.draw(ctx, 0, false));
  }

  // The little stars that run errands (and build): a waddle, two frames.
  canvasTex(scene, "clod_0", 17, 17, (c) => drawStar(c, 0, 0, 17, { rot: -0.1 }));
  canvasTex(scene, "clod_1", 17, 17, (c) => drawStar(c, 0, 0, 17, { rot: 0.1 }));
  canvasTex(scene, "spark_logo", 24, 24, (c) => drawStar(c, 0, 0, 24, { face: false }));

  canvasTex(scene, "b_player_house", 112, 108, drawManor);
  canvasTex(scene, "b_rabbit_burrow", 112, 96, drawHollow);
  canvasTex(scene, "b_post_office", 112, 116, drawGrandPost);
  canvasTex(scene, "b_mailbox", 16, 24, drawMailbox);
  canvasTex(scene, "b_clock_tower", 72, 180, drawGrandClock);
  canvasTex(scene, "b_rocket_pad", 48, 112, drawMailRocket);
  canvasTex(scene, "b_observatory", 112, 124, drawGrandObservatory);
  canvasTex(scene, "b_library", 128, 120, drawGrandLibrary);
  canvasTex(scene, "b_office", 128, 156, drawOfficeTower);
  canvasTex(scene, "b_radio_tower", 64, 132, drawRadioTower);
  canvasTex(scene, "b_workshop", 48, 92, drawWorkshop);
  // A grand house's gold pennant, on a little pole.
  canvasTex(scene, "grand_pennant", 9, 14, (ctx) => {
    rect(ctx, INK, 0, 0, 2, 14);
    rect(ctx, "#fff1b0", 0, 0, 1, 1);
    for (let y = 1; y < 7; y++) {
      const w = 7 - Math.abs(y - 4);
      rect(ctx, INK, 2, y, w + 1, 1);
      rect(ctx, y < 4 ? "#f5c542" : "#c99a3e", 2, y, w, 1);
    }
  });
  // The office's team lead is also the manager villager out on the island, so it's drawn at boot
  // (the rest of the office interior waits for buildOfficeTextures).
  canvasTex(scene, "office_lead", 16, 26, (ctx) => drawWorkerFront(ctx, 4, true));
  // A staked plot per building, the size of its footprint.
  for (const b of Object.keys(SPOTS) as BuildingId[]) {
    const t = buildingTiles(b);
    canvasTex(scene, `plot_${b}`, t.w * TILE, t.h * TILE + 16, (ctx) => drawPlot(ctx, t.w * TILE, t.h * TILE + 16));
    // A neighbor's lot: the old ruin, then the repaired foundation.
    canvasTex(scene, `ruins_${b}`, t.w * TILE, t.h * TILE + 16, (ctx) => drawRuins(ctx, t.w * TILE, t.h * TILE + 16));
    canvasTex(scene, `foundation_${b}`, t.w * TILE, t.h * TILE + 16, (ctx) => drawFoundation(ctx, t.w * TILE, t.h * TILE + 16));
  }
  for (const v of [0, 1]) canvasTex(scene, `rubble_${v}`, 24, 18, (ctx) => drawRubble(ctx, v));

  canvasTex(scene, "ship", 28, 57, drawShip);
  // the fountain's stages: dry (one frame), then flowing, then flowing under the star
  canvasTex(scene, "plaza_fountain_dry", 120, 100, (ctx) => drawPlazaFountain(ctx, 0, 0));
  for (const f of [0, 1, 2]) canvasTex(scene, `plaza_fountain_mid_${f}`, 120, 100, (ctx) => drawPlazaFountain(ctx, f, 1));
  for (const f of [0, 1, 2]) canvasTex(scene, `plaza_fountain_${f}`, 120, 100, (ctx) => drawPlazaFountain(ctx, f));
  // the town's landmarks, stage by stage (the plain key is the grand one)
  // (the Town Hall goes up a level at a time: ruined, levels 1 to 5, grand)
  for (let lv = 0; lv <= 6; lv++) canvasTex(scene, `b_town_hall_${lv}`, 124, 136, (ctx) => drawTownHall(ctx, lv));
  for (const st of [0, 1, 2]) canvasTex(scene, `b_market_${st}`, 76, 80, (ctx) => drawMarket(ctx, st));
  canvasTex(scene, "b_town_hall", 124, 136, (ctx) => drawTownHall(ctx, 6));
  canvasTex(scene, "b_market", 76, 80, (ctx) => drawMarket(ctx, 2));
  // things to find around the crater
  canvasTex(scene, "node_ice", 20, 21, drawIceNode);
  canvasTex(scene, "node_scrap", 22, 14, drawScrapNode);
  canvasTex(scene, "node_ore", 20, 13, drawOreNode);
  for (const f of [0, 1]) {
    canvasTex(scene, `node_helium_${f}`, 22, 12, (ctx) => drawHeliumNode(ctx, f));
    canvasTex(scene, `dig_${f}`, 16, 11, (ctx) => drawDigSpot(ctx, f));
  }
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
  canvasTex(scene, "spark_plaza", 33, 33, (c) => drawStar(c, 0, 0, 33, { face: false }));
  canvasTex(scene, "clod_icon", 11, 11, (c) => drawStar(c, 0, 0, 11));
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

  // Moondust drifts: low, wind-rippled mounds of glittering pale-gold stardust
  // in three shapes (warm, so they stand out from the cool lavender ground),
  // with a shadow along the bottom so they read as dust, not snow, and gold
  // glints that twinkle (two frames) so you spot them.
  for (let v = 0; v < 3; v++)
    for (const f of [0, 1])
      canvasTex(scene, `dust_${v}_${f}`, 28, 13, (ctx) => {
        const blobs = [
          [[8, 8, 7.5, 3], [17, 7.5, 6.5, 3.4], [13, 9, 10, 2.4]],
          [[7, 8, 6, 2.8], [14, 7.5, 8.5, 3.6], [21, 9, 4.5, 2]],
          [[11, 8, 9, 3], [20, 8.5, 5, 2.4], [5, 9, 4, 1.8]],
        ][v];
        const inside = (x: number, y: number, pad = 0) => blobs.some(([cx, cy, rx, ry]) => ((x + 0.5 - cx) / (rx - pad)) ** 2 + ((y + 0.5 - cy) / (ry - pad * 0.6)) ** 2 <= 1);
        for (const [x, y, rx, ry] of blobs) disc(ctx, "#7a6f86", x + 0.5, y + 1, rx + 0.4, ry + 0.4);
        for (const [x, y, rx, ry] of blobs) disc(ctx, "#e3d3a8", x, y, rx, ry);
        for (const [x, y, rx, ry] of blobs) disc(ctx, "#f4ead0", x - 1, y - 0.8, rx * 0.7, ry * 0.55);
        // ripples the wind left across it
        for (const row of [6, 8, 10])
          for (let x = 1; x < 27; x++) {
            const y = row + Math.round(Math.sin(x / 2.6 + row + v) * 0.7);
            if ((x + row) % 7 < 4 && inside(x, y, 1.2)) rect(ctx, "#c4ae7a", x, y, 1, 1);
          }
        // stardust: gold glints, a cross on one frame and a dot on the other, never in the same place
        const glints = [[[9, 5], [19, 5], [14, 9]], [[13, 5], [7, 7], [20, 8]], [[16, 5], [22, 8], [8, 8]]][v];
        glints.forEach(([gx, gy], i) => {
          if ((i + f) % 2 === 0) {
            rect(ctx, "#ffc93c", gx - 1, gy, 3, 1);
            rect(ctx, "#ffc93c", gx, gy - 1, 1, 3);
            rect(ctx, "#fffbe8", gx, gy, 1, 1);
          } else rect(ctx, "#ffe9a8", gx, gy, 1, 1);
        });
      });
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
  // One boot print in the moondust (drawn very faint).
  canvasTex(scene, "footprint", 2, 3, (ctx) => rect(ctx, "#2a2540", 0, 0, 2, 3));

  canvasTex(scene, "letter", 12, 9, (ctx) => {
    box(ctx, "#fff6ee", 0, 0, 12, 9);
    for (let i = 0; i < 5; i++) {
      rect(ctx, INK, 1 + i, 1 + i, 1, 1);
      rect(ctx, INK, 10 - i, 1 + i, 1, 1);
    }
    rect(ctx, ROSE, 5, 5, 2, 2);
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

/** The office interior (room, desks, workers, props) and its animations. Only the Office uses
 *  these, so they're drawn the first time you walk in rather than at boot. */
export function buildOfficeTextures(scene: Phaser.Scene) {
  if (scene.textures.exists("office_room")) return;
  canvasTex(scene, "office_room", ROOM_W, ROOM_H, drawRoom);
  for (const screen of ["off", "code0", "code1", "code2", "think0", "think1", "think2", "wait", "done", "failed"] as const) canvasTex(scene, `desk_${screen}`, 48, 32, (ctx) => drawDesk(ctx, screen));
  for (let look = 0; look < WORKER_LOOKS; look++) {
    for (const f of [0, 1]) canvasTex(scene, `worker_back_${look}_${f}`, 20, 26, (ctx) => drawWorkerBack(ctx, look, f));
    canvasTex(scene, `worker_front_${look}`, 16, 26, (ctx) => drawWorkerFront(ctx, look));
  }
  canvasTex(scene, "office_coffee", 18, 32, drawCoffee);
  canvasTex(scene, "office_plant", 18, 26, drawPlant);
  canvasTex(scene, "office_couch", 52, 26, drawCouch);
  const mk = (key: string, frames: string[], frameRate: number) => {
    if (scene.anims.exists(key)) return;
    scene.anims.create({ key, frames: frames.map((t) => ({ key: t })), frameRate, repeat: -1 });
  };
  mk("desk-coding", ["desk_code0", "desk_code1", "desk_code2"], 3);
  mk("desk-thinking", ["desk_think0", "desk_think1", "desk_think2"], 2);
  for (let look = 0; look < WORKER_LOOKS; look++) mk(`worker-typing-${look}`, [`worker_back_${look}_0`, `worker_back_${look}_1`], 5);
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
  for (let v = 0; v < 3; v++) mk(`dust-${v}`, [`dust_${v}_0`, `dust_${v}_1`], 2);
  mk("shard-twinkle", ["shard_0", "shard_1", "shard_2", "shard_1"], 4);
  mk("plaza-fountain", ["plaza_fountain_0", "plaza_fountain_1", "plaza_fountain_2"], 4);
  mk("plaza-fountain-mid", ["plaza_fountain_mid_0", "plaza_fountain_mid_1", "plaza_fountain_mid_2"], 4);
  mk("helium-shimmer", ["node_helium_0", "node_helium_1"], 2);
  mk("dig-sparkle", ["dig_0", "dig_1"], 2);
  mk("jade_rabbit-idle", ["rabbit_0", "rabbit_1"], 1.5);
  mk("postmaster-idle", ["postmaster_0", "postmaster_0", "postmaster_0", "postmaster_1"], 2);
  mk("timekeeper-idle", ["timekeeper_0", "timekeeper_1"], 1);
  mk("stargazer-idle", ["stargazer_0", "stargazer_1"], 2);
  mk("scholar-idle", ["scholar_0", "scholar_0", "scholar_0", "scholar_1"], 2);
  mk("dj-idle", ["dj_0", "dj_0", "dj_1", "dj_0", "dj_1"], 3);
  mk("mechanic-idle", ["mechanic_0", "mechanic_0", "mechanic_0", "mechanic_1"], 2);
  for (const id of DECOR_ART_IDS) {
    const n = decorArt(id)!.frames;
    if (n > 1) mk(`deco_${id}`, Array.from({ length: n }, (_, f) => `deco_${id}_${f}`), id === "flag" ? 3 : 1.5);
  }
}
