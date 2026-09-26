// The Office, inside and out: the room, desks with live monitors (code while
// an agent works, "..." while it thinks), and the agents themselves, drawn as
// the Claude Code mascot (seen from behind at their desks, tapping away with
// their side nubs, and from the front when they walk; the lead wears a crown).
// Native size, like everything else.

import { type Ctx, INK as O, disc, hash, rect } from "./pix";

export const ROOM_W = 448;
export const ROOM_H = 322;
/**
 * Desk positions in the room (bottom-center of the desk sprite): four
 * across, three rows deep, with the aisle up the middle kept clear.
 */
export const DESKS: { x: number; y: number }[] = [140, 204, 268].flatMap((y) => [72, 160, 288, 376].map((x) => ({ x, y })));
export const BOARD = { x: 224, y: 60, w: 176, h: 50 };
export const ELEVATOR = { x: 224, y: ROOM_H - 2 };
export const WORKER_LOOKS = 6;

// The mascot's orange, in a few close shades so a room of them isn't identical.
const BODY = ["#d97757", "#de8262", "#d26f51", "#e08b68", "#cc6a4d", "#da7c5c"];
const SHADE = ["#b85c3e", "#bd6547", "#b0553a", "#be6d4e", "#a95237", "#b9603f"];

// ---------------------------------------------------------------- the room

export function drawRoom(ctx: Ctx) {
  // carpet: soft blue tiles with a darker aisle rug
  for (let y = 64; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      const tile = ((x >> 4) + (y >> 4)) % 2;
      const n = hash(x >> 1, y >> 1, 3) > 0.9;
      rect(ctx, n ? "#6a7394" : tile ? "#5f6889" : "#646d8f", x, y, 1, 1);
    }
  }
  rect(ctx, "#4a5170", 200, 64, 48, ROOM_H - 64);
  for (let y = 66; y < ROOM_H; y += 4) rect(ctx, "#565e80", 202, y, 44, 1);
  rect(ctx, "#c99a3e", 199, 64, 1, ROOM_H - 64);
  rect(ctx, "#c99a3e", 248, 64, 1, ROOM_H - 64);
  // back wall with baseboard
  rect(ctx, "#e8e3ee", 0, 0, ROOM_W, 64);
  for (let x = 0; x < ROOM_W; x += 32) rect(ctx, "#ddd6e6", x, 0, 1, 60);
  rect(ctx, "#8a8298", 0, 58, ROOM_W, 6);
  rect(ctx, "#b8b0c4", 0, 58, ROOM_W, 1);
  // windows onto space (Earth in the right one)
  for (const wx of [12, 348]) {
    rect(ctx, O, wx, 8, 88, 44);
    rect(ctx, "#8f93a3", wx + 1, 9, 86, 42);
    rect(ctx, "#0f0d22", wx + 3, 11, 82, 38);
    for (let i = 0; i < 26; i++) rect(ctx, hash(i, wx, 5) > 0.7 ? "#ffffff" : "#9aa8cc", wx + 4 + Math.floor(hash(i, wx, 1) * 80), 12 + Math.floor(hash(i, wx, 2) * 36), 1, 1);
    rect(ctx, "#8f93a3", wx + 43, 9, 2, 42);
    rect(ctx, "#8f93a3", wx + 1, 29, 86, 2);
  }
  disc(ctx, "#2f6fb8", 374, 36, 9);
  disc(ctx, "#4f9e54", 371, 33, 4, 3);
  disc(ctx, "#6fbf6a", 378, 39, 3, 2);
  disc(ctx, "#dff4fb", 369, 30, 2, 1);
  // clock
  disc(ctx, O, 322, 22, 7);
  disc(ctx, "#fff8e6", 322, 22, 6);
  rect(ctx, O, 322, 17, 1, 5);
  rect(ctx, O, 322, 22, 4, 1);
  // the board (who's working, drawn live over it)
  const b = BOARD;
  const bx = b.x - b.w / 2;
  rect(ctx, O, bx - 2, 4, b.w + 4, b.h + 6);
  rect(ctx, "#8f93a3", bx - 1, 5, b.w + 2, b.h + 4);
  rect(ctx, "#fbfaf6", bx + 1, 7, b.w - 2, b.h);
  for (const c of [0, 1, 2]) {
    const cx = bx + 4 + c * ((b.w - 8) / 3);
    rect(ctx, ["#f07a9a", "#f5c542", "#7cd08a"][c], cx, 9, (b.w - 8) / 3 - 4, 2);
  }
  rect(ctx, "#b8b0c4", bx + 4, b.h + 3, b.w - 8, 2);
  // bottom wall with the elevator
  rect(ctx, "#8a8298", 0, ROOM_H - 10, ROOM_W, 10);
  rect(ctx, "#b8b0c4", 0, ROOM_H - 10, ROOM_W, 1);
  rect(ctx, O, 200, ROOM_H - 30, 48, 30);
  rect(ctx, "#c9cbd6", 201, ROOM_H - 29, 46, 29);
  rect(ctx, "#a9adbc", 202, ROOM_H - 27, 21, 27);
  rect(ctx, "#a9adbc", 225, ROOM_H - 27, 21, 27);
  rect(ctx, O, 223, ROOM_H - 27, 2, 27);
  rect(ctx, "#f5c542", 221, ROOM_H - 34, 6, 3);
  // side walls
  rect(ctx, "#8a8298", 0, 64, 6, ROOM_H - 64);
  rect(ctx, "#8a8298", ROOM_W - 6, 64, 6, ROOM_H - 64);
}

export type DeskScreen = "off" | "code0" | "code1" | "code2" | "think0" | "think1" | "think2" | "wait" | "done" | "failed";

/** A desk seen from behind the worker: wooden top, monitor facing us, keyboard. 48 x 32. */
export function drawDesk(ctx: Ctx, screen: DeskScreen) {
  // monitor
  rect(ctx, O, 12, 0, 24, 17);
  rect(ctx, "#3b3a4a", 13, 1, 22, 15);
  const bg = screen === "off" ? "#1a1a24" : screen === "done" ? "#1f3a2a" : screen === "failed" ? "#3a1f24" : screen === "wait" ? "#3a3218" : "#15182a";
  rect(ctx, bg, 14, 2, 20, 13);
  if (screen.startsWith("code")) {
    const shift = Number(screen.slice(4));
    for (let i = 0; i < 5; i++) {
      const row = (i + shift) % 7;
      const w = 4 + Math.floor(hash(row, 3, 9) * 13);
      const indent = Math.floor(hash(row, 4, 9) * 3) * 2;
      rect(ctx, ["#6fe3e1", "#f5c542", "#b7a4f0", "#9ae0a8", "#eb9a7c"][row % 5], 15 + indent, 3 + i * 2 + 1, Math.min(w, 18 - indent), 1);
    }
  } else if (screen.startsWith("think")) {
    // "..." filling in: the agent is thinking
    const n = Number(screen.slice(5)) + 1;
    for (let i = 0; i < 3; i++) rect(ctx, i < n ? "#b7a4f0" : "#34305a", 19 + i * 4, 8, 2, 2);
  } else if (screen === "wait") {
    // "?": it's waiting on you
    rect(ctx, "#f5c542", 22, 4, 4, 1);
    rect(ctx, "#f5c542", 25, 5, 1, 2);
    rect(ctx, "#f5c542", 23, 7, 2, 1);
    rect(ctx, "#f5c542", 23, 8, 1, 2);
    rect(ctx, "#f5c542", 23, 11, 1, 1);
  } else if (screen === "done") {
    rect(ctx, "#7cd08a", 20, 9, 2, 2);
    rect(ctx, "#7cd08a", 22, 10, 2, 2);
    rect(ctx, "#7cd08a", 24, 8, 2, 2);
    rect(ctx, "#7cd08a", 26, 6, 2, 2);
  } else if (screen === "failed") {
    rect(ctx, "#ff6a5a", 23, 4, 2, 6);
    rect(ctx, "#ff6a5a", 23, 11, 2, 2);
  }
  rect(ctx, O, 22, 17, 4, 3);
  // desk top and front
  rect(ctx, O, 0, 19, 48, 13);
  rect(ctx, "#c98f5a", 1, 20, 46, 5);
  rect(ctx, "#e2ad76", 1, 20, 46, 1);
  rect(ctx, "#9c6639", 1, 25, 46, 6);
  rect(ctx, "#8a5a3b", 1, 30, 46, 1);
  // keyboard, mug, papers
  rect(ctx, O, 16, 21, 16, 3);
  rect(ctx, "#d9dbe6", 17, 22, 14, 1);
  rect(ctx, O, 38, 19, 5, 5);
  rect(ctx, "#fff6ee", 39, 20, 3, 3);
  rect(ctx, "#6b4a3a", 39, 20, 3, 1);
  rect(ctx, "#fbfaf6", 4, 21, 8, 3);
  rect(ctx, "#b8b0c4", 5, 22, 6, 1);
}

/**
 * The Claude Code mascot, one mascot-pixel = 2 of ours: a wide body, a nub on
 * each side, square eyes, four legs. (bx, by) is the body's top-left corner.
 * Every part gets an ink outline first, then its fill, so it reads on the floor.
 */
function mascot(ctx: Ctx, look: number, bx: number, by: number, opts: { eyes: boolean; legs: boolean; nubs: [number, number] }) {
  const body = BODY[look % BODY.length];
  const shade = SHADE[look % SHADE.length];
  const parts: [number, number, number, number, string][] = [
    [bx, by, 22, 12, body],
    [bx - 4, by + 6 + opts.nubs[0], 4, 3, body],
    [bx + 22, by + 6 + opts.nubs[1], 4, 3, body],
  ];
  if (opts.legs) for (const lx of [4, 8, 14, 18]) parts.push([bx + lx, by + 12, 2, 4, shade]);
  for (const [x, y, w, h] of parts) rect(ctx, O, x - 1, y - 1, w + 2, h + 2);
  for (const [x, y, w, h, c] of parts) rect(ctx, c, x, y, w, h);
  rect(ctx, shade, bx, by + 10, 22, 2); // a little weight at the bottom
  if (opts.eyes) {
    rect(ctx, O, bx + 4, by + 4, 2, 4);
    rect(ctx, O, bx + 16, by + 4, 2, 4);
  }
}

/** An agent at their desk, seen from behind in an office chair; `f` taps their nubs (typing). 32 x 20. */
export function drawWorkerBack(ctx: Ctx, look: number, f: number) {
  // the chair back peeks out below
  rect(ctx, O, 10, 12, 12, 8);
  rect(ctx, "#3b3a4a", 11, 13, 10, 6);
  rect(ctx, "#5b5a6e", 11, 13, 10, 1);
  mascot(ctx, look, 5, 2, { eyes: false, legs: false, nubs: f ? [-1, 1] : [1, -1] });
}

/** An agent standing, facing you (walking in and out). 32 x 20; the lead (with a crown) is 32 x 24. */
export function drawWorkerFront(ctx: Ctx, look: number, crown = false) {
  const by = crown ? 7 : 3;
  mascot(ctx, look, 5, by, { eyes: true, legs: true, nubs: [0, 0] });
  if (crown) {
    rect(ctx, O, 10, by - 6, 12, 6);
    rect(ctx, "#f5c542", 11, by - 3, 10, 2);
    for (const cx of [11, 15, 19]) rect(ctx, "#f5c542", cx, by - 5, 2, 2);
    rect(ctx, "#fff0a8", 11, by - 3, 10, 1);
    rect(ctx, "#e05a5a", 15, by - 2, 2, 1);
  }
}

export function drawCoffee(ctx: Ctx) {
  rect(ctx, O, 1, 10, 16, 22);
  rect(ctx, "#5b5470", 2, 11, 14, 20);
  rect(ctx, "#8f93a3", 2, 11, 14, 2);
  rect(ctx, O, 4, 15, 10, 6);
  rect(ctx, "#1a1a24", 5, 16, 8, 4);
  rect(ctx, "#6fe3e1", 6, 17, 3, 1);
  rect(ctx, O, 6, 24, 6, 5);
  rect(ctx, "#fff6ee", 7, 25, 4, 3);
  rect(ctx, "#6b4a3a", 7, 25, 4, 1);
  rect(ctx, O, 2, 3, 14, 8);
  rect(ctx, "#c9cbd6", 3, 4, 12, 6);
  rect(ctx, "#6b4a3a", 5, 6, 8, 3);
}

export function drawPlant(ctx: Ctx) {
  rect(ctx, O, 4, 18, 10, 8);
  rect(ctx, "#c9744a", 5, 19, 8, 6);
  rect(ctx, "#e0935f", 5, 19, 8, 1);
  for (const [x, y, rx, ry] of [[9, 12, 5, 6], [5, 9, 3.5, 4], [13, 8, 3.5, 4], [9, 4, 3, 4]] as const) disc(ctx, O, x, y, rx + 1, ry + 1);
  for (const [x, y, rx, ry] of [[9, 12, 5, 6], [5, 9, 3.5, 4], [13, 8, 3.5, 4], [9, 4, 3, 4]] as const) disc(ctx, "#3f8a4a", x, y, rx, ry);
  disc(ctx, "#6fbf6a", 7, 7, 2, 2);
  disc(ctx, "#6fbf6a", 11, 10, 2, 2);
}

export function drawCouch(ctx: Ctx) {
  rect(ctx, O, 0, 4, 52, 20);
  rect(ctx, "#7e5fb8", 1, 5, 50, 8);
  rect(ctx, "#9d80d6", 1, 5, 50, 1);
  rect(ctx, O, 0, 12, 52, 1);
  rect(ctx, "#6a4ea3", 1, 13, 50, 7);
  rect(ctx, "#9d80d6", 1, 13, 50, 1);
  rect(ctx, O, 25, 13, 1, 7);
  rect(ctx, O, 0, 4, 5, 20);
  rect(ctx, O, 47, 4, 5, 20);
  rect(ctx, "#5f4596", 1, 5, 3, 18);
  rect(ctx, "#5f4596", 48, 5, 3, 18);
  rect(ctx, O, 3, 23, 2, 3);
  rect(ctx, O, 47, 23, 2, 3);
}

/** The Office, outside: a glass-and-steel tower with a server wing and a rooftop sign. 128 x 156. */
export function drawOfficeTower(ctx: Ctx) {
  const STEEL = { base: "#8f93a3", dark: "#5b5470", light: "#c9cbd6" };
  // server wing on the left
  rect(ctx, O, 0, 88, 26, 60);
  rect(ctx, STEEL.dark, 1, 89, 24, 59);
  for (let y = 93; y < 144; y += 8) {
    rect(ctx, "#2a2838", 3, y, 20, 6);
    for (let x = 5; x < 22; x += 3) rect(ctx, hash(x, y, 2) > 0.5 ? "#7cd08a" : "#6fe3e1", x, y + 2, 1, 1);
  }
  rect(ctx, STEEL.light, 1, 89, 24, 1);
  // the tower
  rect(ctx, O, 18, 26, 96, 122);
  rect(ctx, STEEL.base, 19, 27, 94, 121);
  for (let floor = 0; floor < 4; floor++) {
    const fy = 32 + floor * 20;
    for (let wx = 22; wx < 110; wx += 11) {
      rect(ctx, O, wx, fy, 9, 15);
      rect(ctx, "#6f9fe8", wx + 1, fy + 1, 7, 13);
      rect(ctx, "#a9ccff", wx + 1, fy + 1, 7, 2);
      rect(ctx, "#4f7fcf", wx + 1, fy + 10, 7, 4);
      if (hash(wx, floor, 7) > 0.45) {
        // someone at a glowing monitor
        rect(ctx, "#6fe3e1", wx + 3, fy + 8, 4, 2);
        rect(ctx, "#2a2838", wx + 3, fy + 11, 3, 3);
      }
    }
    rect(ctx, STEEL.light, 19, fy + 16, 94, 2);
    rect(ctx, STEEL.dark, 19, fy + 18, 94, 1);
  }
  // lobby: glass wall, a sign, a revolving door
  rect(ctx, O, 18, 112, 96, 36);
  rect(ctx, "#bfe0ff", 19, 113, 94, 34);
  for (let x = 30; x < 112; x += 14) rect(ctx, STEEL.base, x, 113, 2, 34);
  rect(ctx, "#ffd98a", 19, 136, 94, 11);
  rect(ctx, O, 36, 102, 60, 11);
  rect(ctx, "#2a2838", 37, 103, 58, 9);
  for (const [x, glyph] of [[48, "<"], [60, "/"], [72, ">"]] as const) {
    rect(ctx, "#6fe3e1", x, 105, 1, 5);
    if (glyph === "<") {
      rect(ctx, "#6fe3e1", x - 2, 107, 2, 1);
      rect(ctx, "#6fe3e1", x - 1, 106, 1, 1);
      rect(ctx, "#6fe3e1", x - 1, 108, 1, 1);
    } else if (glyph === ">") {
      rect(ctx, "#6fe3e1", x + 1, 107, 2, 1);
      rect(ctx, "#6fe3e1", x + 1, 106, 1, 1);
      rect(ctx, "#6fe3e1", x + 1, 108, 1, 1);
    }
  }
  rect(ctx, "#f5c542", 84, 105, 6, 5);
  disc(ctx, O, 66, 136, 11, 11, 147);
  rect(ctx, O, 55, 136, 22, 12);
  disc(ctx, "#dff4fb", 66, 136, 10, 10, 147);
  rect(ctx, "#dff4fb", 56, 136, 20, 11);
  rect(ctx, STEEL.dark, 65, 126, 2, 21);
  rect(ctx, STEEL.dark, 56, 140, 20, 1);
  // roof: parapet, antenna with a light, a dish, the </> sign
  rect(ctx, O, 16, 22, 100, 5);
  rect(ctx, STEEL.light, 17, 23, 98, 2);
  rect(ctx, O, 96, 2, 3, 21);
  rect(ctx, STEEL.base, 97, 3, 1, 19);
  rect(ctx, O, 95, 0, 5, 3);
  rect(ctx, "#ff5a4a", 96, 1, 3, 1);
  disc(ctx, O, 30, 16, 7, 4);
  disc(ctx, "#e9e9f2", 30, 16, 6, 3);
  rect(ctx, O, 29, 19, 2, 4);
  rect(ctx, O, 46, 8, 40, 15);
  rect(ctx, "#1f2a4d", 47, 9, 38, 13);
  rect(ctx, "#d97757", 50, 12, 2, 7);
  rect(ctx, "#d97757", 48, 15, 2, 1);
  rect(ctx, "#6fe3e1", 56, 12, 3, 1);
  rect(ctx, "#6fe3e1", 55, 14, 5, 1);
  rect(ctx, "#6fe3e1", 57, 16, 6, 1);
  rect(ctx, "#6fe3e1", 55, 18, 4, 1);
  rect(ctx, "#f5c542", 66, 12, 16, 2);
  rect(ctx, "#f5c542", 66, 16, 10, 2);
  // steps and planters
  rect(ctx, O, 10, 148, 108, 8);
  rect(ctx, STEEL.light, 11, 149, 106, 2);
  rect(ctx, STEEL.base, 11, 151, 106, 4);
  for (const x of [22, 106]) {
    rect(ctx, O, x - 7, 140, 14, 9);
    rect(ctx, STEEL.dark, x - 6, 141, 12, 7);
    disc(ctx, O, x, 136, 7, 6);
    disc(ctx, "#3f8a4a", x, 136, 6, 5);
    disc(ctx, "#6fbf6a", x - 2, 134, 2.5, 2);
  }
}
