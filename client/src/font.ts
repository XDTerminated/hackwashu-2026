// A hand-placed bitmap pixel font. Every glyph pixel is exactly one art
// pixel, so text sits on the same grid as the sprites. Glyphs are 7 rows
// tall above the baseline with 2 descender rows; '#' is ink.

import Phaser from "phaser";

const G: Record<string, string> = {
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#",
  B: "####.|#...#|#...#|####.|#...#|#...#|####.",
  C: ".###.|#...#|#....|#....|#....|#...#|.###.",
  D: "####.|#...#|#...#|#...#|#...#|#...#|####.",
  E: "#####|#....|#....|####.|#....|#....|#####",
  F: "#####|#....|#....|####.|#....|#....|#....",
  G: ".###.|#...#|#....|#.###|#...#|#...#|.####",
  H: "#...#|#...#|#...#|#####|#...#|#...#|#...#",
  I: "###|.#.|.#.|.#.|.#.|.#.|###",
  J: "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
  K: "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
  L: "#....|#....|#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
  N: "#...#|##..#|#.#.#|#..##|#...#|#...#|#...#",
  O: ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
  P: "####.|#...#|#...#|####.|#....|#....|#....",
  Q: ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
  R: "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
  S: ".####|#....|#....|.###.|....#|....#|####.",
  T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
  W: "#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.",
  X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
  Z: "#####|....#|...#.|..#..|.#...|#....|#####",

  a: "....|....|.##.|...#|.###|#..#|.###",
  b: "#...|#...|###.|#..#|#..#|#..#|###.",
  c: "....|....|.###|#...|#...|#...|.###",
  d: "...#|...#|.###|#..#|#..#|#..#|.###",
  e: "....|....|.##.|#..#|####|#...|.###",
  f: ".##|#..|###|#..|#..|#..|#..",
  g: "....|....|.###|#..#|#..#|#..#|.###|...#|.##.",
  h: "#...|#...|###.|#..#|#..#|#..#|#..#",
  i: "#|.|#|#|#|#|#",
  j: ".#|..|.#|.#|.#|.#|.#|.#|#.",
  k: "#...|#...|#..#|#.#.|##..|#.#.|#..#",
  l: "#.|#.|#.|#.|#.|#.|.#",
  m: ".....|.....|####.|#.#.#|#.#.#|#.#.#|#.#.#",
  n: "....|....|###.|#..#|#..#|#..#|#..#",
  o: "....|....|.##.|#..#|#..#|#..#|.##.",
  p: "....|....|###.|#..#|#..#|#..#|###.|#...|#...",
  q: "....|....|.###|#..#|#..#|#..#|.###|...#|...#",
  r: "...|...|#.#|##.|#..|#..|#..",
  s: "....|....|.###|#...|.##.|...#|###.",
  t: ".#.|.#.|###|.#.|.#.|.#.|..#",
  u: "....|....|#..#|#..#|#..#|#..#|.###",
  v: ".....|.....|#...#|#...#|.#.#.|.#.#.|..#..",
  w: ".....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.",
  x: "....|....|#..#|#..#|.##.|#..#|#..#",
  y: "....|....|#..#|#..#|#..#|#..#|.###|...#|.##.",
  z: "....|....|####|...#|.##.|#...|####",

  "0": ".##.|#..#|#.##|##.#|#..#|#..#|.##.",
  "1": ".#.|##.|.#.|.#.|.#.|.#.|###",
  "2": ".##.|#..#|...#|..#.|.#..|#...|####",
  "3": "###.|...#|...#|.##.|...#|...#|###.",
  "4": "#..#|#..#|#..#|####|...#|...#|...#",
  "5": "####|#...|#...|###.|...#|...#|###.",
  "6": ".##.|#...|#...|###.|#..#|#..#|.##.",
  "7": "####|...#|...#|..#.|.#..|.#..|.#..",
  "8": ".##.|#..#|#..#|.##.|#..#|#..#|.##.",
  "9": ".##.|#..#|#..#|.###|...#|...#|.##.",

  "!": "#|#|#|#|#|.|#",
  '"': "#.#|#.#|...|...|...|...|...",
  "#": ".....|.#.#.|#####|.#.#.|#####|.#.#.|.....",
  $: "..#..|.####|#.#..|.###.|..#.#|####.|..#..",
  "%": "##...|##..#|...#.|..#..|.#...|#..##|...##",
  "&": ".##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#",
  "'": "#|#|.|.|.|.|.",
  "(": ".#|#.|#.|#.|#.|#.|.#",
  ")": "#.|.#|.#|.#|.#|.#|#.",
  "*": ".....|..#..|#.#.#|.###.|#.#.#|..#..|.....",
  "+": ".....|..#..|..#..|#####|..#..|..#..|.....",
  ",": "..|..|..|..|..|.#|.#|#.",
  "-": "....|....|....|####|....|....|....",
  ".": ".|.|.|.|.|.|#",
  "/": "..#|..#|.#.|.#.|.#.|#..|#..",
  ":": ".|.|#|.|.|#|.",
  ";": "..|..|.#|..|..|.#|.#|#.",
  "<": "...#|..#.|.#..|#...|.#..|..#.|...#",
  "=": "....|....|####|....|####|....|....",
  ">": "#...|.#..|..#.|...#|..#.|.#..|#...",
  "?": ".##.|#..#|...#|..#.|.#..|....|.#..",
  "@": ".###.|#...#|#.###|#.#.#|#.###|#....|.####",
  "[": "##|#.|#.|#.|#.|#.|##",
  "\\": "#..|#..|.#.|.#.|.#.|..#|..#",
  "]": "##|.#|.#|.#|.#|.#|##",
  "^": ".#.|#.#|...|...|...|...|...",
  _: "....|....|....|....|....|....|....|####",
  "`": "#.|.#|..|..|..|..|..",
  "{": "..#|.#.|.#.|#..|.#.|.#.|..#",
  "|": "#|#|#|#|#|#|#|#",
  "}": "#..|.#.|.#.|..#|.#.|.#.|#..",
  "~": "....|....|.#.#|#.#.|....|....|....",

  "¢": "....|..#.|.###|#.#.|#.#.|.###|..#.",
  "…": ".....|.....|.....|.....|.....|.....|#.#.#",
  "•": "...|...|.#.|###|.#.|...|...",
  "·": ".|.|.|#|.|.|.",
  "★": "..#..|..#..|#####|.###.|.#.#.|#...#|.....",
  "●": ".....|.###.|#####|#####|#####|.###.|.....",
  "○": ".....|.###.|#...#|#...#|#...#|.###.|.....",
  "✉": ".......|#######|##...##|#.#.#.#|#..#..#|#.....#|#######",
  "→": ".....|..#..|...#.|#####|...#.|..#..|.....",
  "←": ".....|..#..|.#...|#####|.#...|..#..|.....",
  "✕": ".....|#...#|.#.#.|..#..|.#.#.|#...#|.....",
  "✓": ".....|....#|...#.|#.#..|.#...|.....|.....",
  "♥": ".....|##.##|#####|#####|.###.|..#..|.....",
  "☾": "..##.|.#...|#....|#....|#....|.#...|..##.",
  "\u{E001}": "####|#..#|#..#|#..#|####|#.##|####", // phone
  "\u{E002}": "..#..|.###.|.#.#.|.###.|##.##|#.#.#|.....", // rocket
};

export const PHONE = "\u{E001}";
export const ROCKET = "\u{E002}";

const ROWS = 9;
export const LINE_HEIGHT = 11;

/** Map anything the font can't draw onto something it can. */
export function sanitize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/\p{Zs}/gu, " ")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/️/g, "")
    .replace(/📱/gu, PHONE)
    .replace(/🚀/gu, ROCKET)
    .replace(/[🌙🌕🌝]/gu, "☾")
    .replace(/[❗❕‼]/gu, "!")
    .replace(/[⭐🌟✨]/gu, "★")
    .replace(/[❤💖🧡]/gu, "♥")
    .replace(/[✔✅]/gu, "✓")
    .replace(/[✗❌]/gu, "✕")
    .replace(/(?![♥✉])\p{Extended_Pictographic}/gu, "")
    .replace(/[^\n\x20-\x7e¢…•·★●○✉→←✕✓♥☾\u{E001}\u{E002}]/gu, "")
    .replace(/ {2,}/g, " ");
}

function parse(rows: string): string[] {
  const r = rows.split("|");
  while (r.length < ROWS) r.push(".".repeat(r[0].length));
  return r;
}

function bolden(rows: string[]): string[] {
  return rows.map((row) => {
    let out = "";
    for (let i = 0; i <= row.length; i++) out += row[i] === "#" || row[i - 1] === "#" ? "#" : ".";
    return out;
  });
}

function register(scene: Phaser.Scene, key: string, glyphs: Record<string, string[]>) {
  const entries = Object.entries(glyphs);
  const texW = entries.reduce((w, [, rows]) => w + rows[0].length + 1, 1);
  const tex = scene.textures.createCanvas(key, texW, ROWS)!;
  const ctx = tex.getContext();
  ctx.fillStyle = "#ffffff";

  const chars: Record<number, object> = {};
  let x = 1;
  for (const [ch, rows] of entries) {
    const w = rows[0].length;
    for (let y = 0; y < ROWS; y++) for (let i = 0; i < w; i++) if (rows[y][i] === "#") ctx.fillRect(x + i, y, 1, 1);
    chars[ch.codePointAt(0)!] = {
      x,
      y: 0,
      width: w,
      height: ROWS,
      centerX: Math.floor(w / 2),
      centerY: Math.floor(ROWS / 2),
      xOffset: 0,
      yOffset: 0,
      xAdvance: w + 1,
      data: {},
      kerning: {},
      u0: x / texW,
      v0: 0,
      u1: (x + w) / texW,
      v1: 1,
    };
    x += w + 1;
  }
  // space
  chars[32] = { x: 0, y: 0, width: 0, height: 0, centerX: 0, centerY: 0, xOffset: 0, yOffset: 0, xAdvance: 3, data: {}, kerning: {}, u0: 0, v0: 0, u1: 0, v1: 0 };
  tex.refresh();

  const frame = tex.get();
  for (const [code, c] of Object.entries(chars) as [string, { x: number; width: number; height: number; u0: number; v0: number; u1: number; v1: number }][]) {
    if (c.width === 0) continue;
    const f = tex.add(String.fromCodePoint(Number(code)), frame.sourceIndex, c.x, 0, c.width, c.height);
    f?.setUVs(c.width, c.height, c.u0, c.v0, c.u1, c.v1);
  }
  scene.cache.bitmapFont.add(key, {
    data: { font: key, size: ROWS, lineHeight: LINE_HEIGHT, chars },
    texture: key,
    frame: null,
  });
}

/** Registers "px" (regular) and "pxb" (bold). */
export function buildFonts(scene: Phaser.Scene) {
  if (scene.cache.bitmapFont.exists("px")) return;
  const regular: Record<string, string[]> = {};
  const bold: Record<string, string[]> = {};
  for (const [ch, rows] of Object.entries(G)) {
    regular[ch] = parse(rows);
    bold[ch] = bolden(regular[ch]);
  }
  register(scene, "px", regular);
  register(scene, "pxb", bold);
}

/**
 * A big display logo: bold glyphs upscaled with Scale2x twice, which rounds
 * the diagonals while keeping every output pixel one art pixel.
 */
export function buildLogo(scene: Phaser.Scene, key: string, text: string, fill: string, outline: string, shadow: string) {
  if (scene.textures.exists(key)) return;
  let mask: boolean[][] = Array.from({ length: 7 }, () => [] as boolean[]);
  for (const ch of text) {
    const rows = ch === " " ? Array(7).fill("...") : bolden(parse(G[ch] ?? G["?"])).slice(0, 7);
    for (let y = 0; y < 7; y++) {
      for (const c of rows[y]) mask[y].push(c === "#");
      mask[y].push(false);
    }
  }
  const scale2x = (m: boolean[][]) => {
    const h = m.length;
    const w = m[0].length;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? false : m[y][x]);
    const out = Array.from({ length: h * 2 }, () => new Array<boolean>(w * 2).fill(false));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = at(x, y), a = at(x, y - 1), b = at(x + 1, y), c = at(x - 1, y), d = at(x, y + 1);
        out[y * 2][x * 2] = c === a && c !== d && a !== b ? a : p;
        out[y * 2][x * 2 + 1] = a === b && a !== c && b !== d ? b : p;
        out[y * 2 + 1][x * 2] = d === c && d !== b && c !== a ? c : p;
        out[y * 2 + 1][x * 2 + 1] = b === d && b !== a && d !== c ? d : p;
      }
    return out;
  };
  mask = scale2x(scale2x(mask));
  const h = mask.length;
  const w = mask[0].length;
  const tex = scene.textures.createCanvas(key, w + 4, h + 5)!;
  const ctx = tex.getContext();
  const on = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && mask[y][x];
  const paint = (color: string, dx: number, dy: number, grow: boolean) => {
    ctx.fillStyle = color;
    for (let y = -1; y <= h; y++)
      for (let x = -1; x <= w; x++) {
        const hit = on(x, y) || (grow && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)));
        if (hit) ctx.fillRect(x + 2 + dx, y + 2 + dy, 1, 1);
      }
  };
  paint(shadow, 0, 3, true);
  paint(outline, 0, 0, true);
  paint(fill, 0, 0, false);
  // light band across the top of each letter
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  for (let y = 0; y < Math.floor(h / 3); y++) for (let x = 0; x < w; x++) if (on(x, y)) ctx.fillRect(x + 2, y + 2, 1, 1);
  tex.refresh();
}
