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
import { DECOR_ART_IDS, decorArt } from "./decorart";
import { ICON_SPRITES } from "./icons";
import {
  drawClockTower,
  drawLibrary,
  drawMailbox,
  drawObservatory,
  drawPlayerHouse,
  drawPlot,
  drawPostOffice,
  drawRabbitBurrow,
  drawRocketPad,
} from "./buildings";
import { type Ctx, INK, box, disc, rect } from "./pix";

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
  for (const [name, sprite] of Object.entries(ICON_SPRITES)) registerSprite(scene, `icon_${name}`, sprite);
  for (const id of DECOR_ART_IDS) {
    const a = decorArt(id)!;
    for (let f = 0; f < a.frames; f++) canvasTex(scene, `deco_${id}_${f}`, a.w, a.h, (ctx) => a.draw(ctx, f));
  }

  // Baby clods — the Claude sunburst. Two rotations for a twinkle.
  canvasTex(scene, "clod_0", 15, 15, (c) => drawSpark(c, 15, 0, true));
  canvasTex(scene, "clod_1", 15, 15, (c) => drawSpark(c, 15, Math.PI / 8, true));
  canvasTex(scene, "spark_logo", 24, 24, (c) => drawSpark(c, 24, 0, false));

  canvasTex(scene, "b_player_house", 52, 48, drawPlayerHouse);
  canvasTex(scene, "b_rabbit_burrow", 56, 40, drawRabbitBurrow);
  canvasTex(scene, "b_post_office", 64, 56, drawPostOffice);
  canvasTex(scene, "b_mailbox", 16, 24, drawMailbox);
  canvasTex(scene, "b_clock_tower", 44, 88, drawClockTower);
  canvasTex(scene, "b_rocket_pad", 64, 22, drawRocketPad);
  canvasTex(scene, "b_observatory", 60, 60, drawObservatory);
  canvasTex(scene, "b_library", 64, 56, drawLibrary);
  canvasTex(scene, "b_plot", 48, 34, drawPlot);

  canvasTex(scene, "ship", 28, 57, drawShip);
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
