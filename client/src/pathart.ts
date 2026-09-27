// Paths you lay: each tile drawn in its style, joined to the path tiles next
// to it. A side with no path beside it gets a worn edge and pulls in a pixel,
// and a corner with open sides both ways rounds off, so a line of tiles reads
// as one path and a patch reads as one paved square.

import { TILE } from "../../shared/layout";
import { fromKey, pathKey, type PathStyle } from "../../shared/paths";

type Ctx = CanvasRenderingContext2D;

function px(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** A steady pseudo-random number for a pixel (the same every time it's drawn). */
function hash(x: number, y: number, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Look {
  /** The colour of pixel (x, y) (world pixels) on this path. */
  fill: (x: number, y: number) => string;
  /** The worn edge along an open side. */
  edge: string;
}

const STONES = ["#e8dfcc", "#ddd3c0", "#d4cdbf", "#e6d9c2", "#dad6cc"];

const LOOKS: Record<PathStyle, Look> = {
  // packed regolith, a little warmer than the crater floor, with grit
  dirt: {
    fill: (x, y) => {
      const r = hash(x, y, 1);
      return r < 0.08 ? "#7d7266" : r < 0.16 ? "#a89c8c" : r < 0.2 ? "#b3a897" : "#958a7c";
    },
    edge: "#7a6f63",
  },
  // flagstones: an 8px grid of stones with dark joints, each its own tone, lit on top
  stone: {
    fill: (x, y) => {
      const cy = Math.floor(y / 8);
      // (every other row slides half a stone, like laid paving)
      const ox = cy % 2 ? 4 : 0;
      const sx = Math.floor((x + ox) / 8);
      const lx = (x + ox) % 8;
      const ly = y % 8;
      if (lx === 7 || ly === 7) return "#8d8599";
      const tone = STONES[Math.floor(hash(sx, cy, 2) * STONES.length)];
      if (ly === 0) return "#f4ecdc";
      if (lx === 6 || ly === 6) return "#c4bcae";
      return hash(x, y, 3) < 0.05 ? "#cfc6b6" : tone;
    },
    edge: "#8a8296",
  },
  // red brick in running rows (8 x 4), mortar between
  brick: {
    fill: (x, y) => {
      const row = Math.floor(y / 4);
      const ox = row % 2 ? 4 : 0;
      const lx = (x + ox) % 8;
      const ly = y % 4;
      if (ly === 3 || lx === 7) return "#7a3426";
      if (ly === 0) return "#c26a4e";
      return hash(Math.floor((x + ox) / 8), row, 4) < 0.25 ? "#9c4834" : "#a8503a";
    },
    edge: "#6a2e22",
  },
  // pale moon-glass tiles with glowing cyan seams
  glow: {
    fill: (x, y) => {
      const lx = x % 8;
      const ly = y % 8;
      if (lx === 0 || ly === 0) return hash(Math.floor(x / 8), Math.floor(y / 8), 5) < 0.5 ? "#6fe3e1" : "#9ff0ec";
      if (lx === 1 && ly === 1) return "#ffffff";
      return hash(x, y, 6) < 0.06 ? "#e2f4fb" : "#cbe0ec";
    },
    edge: "#5aa9b8",
  },
};

/** One path tile at (tx, ty), knowing which of its four sides have path next to them. */
export function drawPathTile(ctx: Ctx, tx: number, ty: number, style: PathStyle, n: { up: boolean; down: boolean; left: boolean; right: boolean }) {
  const look = LOOKS[style];
  const x0 = tx * TILE;
  const y0 = ty * TILE;
  // Open sides pull in a pixel (so two paths side by side don't merge into one).
  const l = n.left ? 0 : 1;
  const r = n.right ? 0 : 1;
  const u = n.up ? 0 : 1;
  const d = n.down ? 0 : 1;
  for (let y = u; y < TILE - d; y++)
    for (let x = l; x < TILE - r; x++) {
      // Round the corner where both sides are open.
      const cornerX = (x === l && !n.left) || (x === TILE - r - 1 && !n.right);
      const cornerY = (y === u && !n.up) || (y === TILE - d - 1 && !n.down);
      if (cornerX && cornerY) continue;
      const edge = (x === l && !n.left) || (x === TILE - r - 1 && !n.right) || (y === u && !n.up) || (y === TILE - d - 1 && !n.down);
      px(ctx, edge ? look.edge : look.fill(x0 + x, y0 + y), x0 + x, y0 + y);
    }
}

/** Every path tile (on the paths layer, above the ground and Main Street). */
export function drawPaths(ctx: Ctx, paths: Record<string, PathStyle>) {
  for (const [key, style] of Object.entries(paths)) {
    if (!LOOKS[style]) continue;
    const { tx, ty } = fromKey(key);
    const same = (dx: number, dy: number) => !!paths[pathKey(tx + dx, ty + dy)];
    drawPathTile(ctx, tx, ty, style, { up: same(0, -1), down: same(0, 1), left: same(-1, 0), right: same(1, 0) });
  }
}

/** A little patch of a path, for the Shop (3 x 2 tiles, joined). */
export function drawPathSwatch(ctx: Ctx, style: PathStyle) {
  const tiles: Record<string, PathStyle> = {};
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 3; tx++) tiles[pathKey(tx, ty)] = style;
  drawPaths(ctx, tiles);
}

/** Redraw one tile (cleared first; drawn if it's paved), after it or a neighbor changed. */
export function redrawTile(ctx: Ctx, paths: Record<string, PathStyle>, tx: number, ty: number) {
  ctx.clearRect(tx * TILE, ty * TILE, TILE, TILE);
  const style = paths[pathKey(tx, ty)];
  if (!style || !LOOKS[style]) return;
  const same = (dx: number, dy: number) => !!paths[pathKey(tx + dx, ty + dy)];
  drawPathTile(ctx, tx, ty, style, { up: same(0, -1), down: same(0, 1), left: same(-1, 0), right: same(1, 0) });
}
