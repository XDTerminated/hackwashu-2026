// Pixel-grid UI primitives. Everything is drawn in whole art pixels with
// integer coordinates — no scaling, no rounded vector shapes, no hi-res text.

import Phaser from "phaser";
import { LINE_HEIGHT, sanitize } from "./font";

export const C = {
  ink: 0x4a2e19,
  inkSoft: 0x7a5a3a,
  outline: 0x3b2a3a,
  woodDark: 0x5b3218,
  wood: 0x8a4b1f,
  woodMid: 0xb8733a,
  woodLight: 0xc98f5a,
  paper: 0xf4d9a6,
  paperLight: 0xfff2d6,
  paperDark: 0xd9b77f,
  cream: 0xfff6e6,
  gold: 0x8a5a10,
  coral: 0x9a4a2a,
  green: 0x2f7a40,
  greenBtn: 0x5fa84e,
  red: 0xb0302a,
  blue: 0x2f5f9a,
};

export type Font = "px" | "pxb";

export function ptext(scene: Phaser.Scene, x: number, y: number, text: string, color: number = C.ink, font: Font = "px") {
  return scene.add.bitmapText(Math.round(x), Math.round(y), font, sanitize(text)).setTint(color);
}

/** Pixel size of a BitmapText's content (line count aware). */
export function measure(t: Phaser.GameObjects.BitmapText) {
  const b = t.getTextBounds(false);
  const lines = Math.max(1, b.lines.lengths.length);
  return { w: Math.ceil(b.local.width), h: (lines - 1) * LINE_HEIGHT + 8 };
}

/** Clip a string (with "..") so it fits a pixel width in the given font. */
export function fit(scene: Phaser.Scene, text: string, width: number, font: Font = "px"): string {
  const probe = scene.make.bitmapText({ font, text: sanitize(text) }, false);
  let s = sanitize(text);
  while (s.length > 1 && measure(probe.setText(s)).w > width) s = s.slice(0, -1);
  const out = s === sanitize(text) ? s : s.slice(0, -2).trimEnd() + "..";
  probe.destroy();
  return out;
}

/** Stardew-style wooden frame with a parchment inset; corners chamfered by one pixel. */
export function woodFrame(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, fill: number = C.paper) {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  g.fillStyle(C.woodDark, 1);
  g.fillRect(x + 1, y, w - 2, h);
  g.fillRect(x, y + 1, w, h - 2);
  g.fillStyle(C.wood, 1).fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle(C.woodLight, 1).fillRect(x + 2, y + 1, w - 4, 1);
  g.fillStyle(C.woodDark, 1).fillRect(x + 3, y + 3, w - 6, h - 6);
  g.fillStyle(fill, 1).fillRect(x + 4, y + 4, w - 8, h - 8);
  g.fillStyle(C.paperDark, 1).fillRect(x + 4, y + h - 5, w - 8, 1);
}

/** A 1px-bordered box with chamfered corners. */
export function pixBox(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, fill: number, border: number) {
  g.fillStyle(border, 1);
  g.fillRect(x + 1, y, w - 2, h);
  g.fillRect(x, y + 1, w, h - 2);
  g.fillStyle(fill, 1).fillRect(x + 1, y + 1, w - 2, h - 2);
}

export interface LabelOpts {
  color?: number;
  bg?: number | null;
  border?: number | null;
  font?: Font;
  maxWidth?: number;
  originX?: number;
  originY?: number;
  align?: "left" | "center";
  tail?: boolean;
  padX?: number;
}

/** Text on an optional pixel box — name tags, speech bubbles, prompts. */
export class Label extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private t: Phaser.GameObjects.BitmapText;
  readonly opts: Required<LabelOpts>;
  boxW = 0;
  boxH = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, text: string, opts: LabelOpts = {}) {
    super(scene, Math.round(x), Math.round(y));
    this.opts = {
      color: C.ink,
      bg: C.paperLight,
      border: C.outline,
      font: "px",
      maxWidth: 0,
      originX: 0.5,
      originY: 1,
      align: "center",
      tail: false,
      padX: 3,
      ...opts,
    };
    this.g = scene.make.graphics({}, false);
    this.t = scene.make.bitmapText({ font: this.opts.font, text: "" }, false).setTint(this.opts.color);
    this.add([this.g, this.t]);
    scene.add.existing(this);
    this.setText(text);
  }

  setText(text: string) {
    const o = this.opts;
    this.t.setText(sanitize(text));
    if (o.maxWidth) this.t.setMaxWidth(o.maxWidth);
    if (o.align === "center") this.t.setCenterAlign();
    else this.t.setLeftAlign();
    const { w, h } = measure(this.t);
    const b = o.border !== null ? 1 : 0;
    const W = w + o.padX * 2 + b * 2;
    const H = h + 3 + b * 2;
    const tail = o.tail ? 3 : 0;
    const ox = -Math.round(o.originX * W);
    const oy = -Math.round(o.originY * (H + tail));
    this.g.clear();
    if (o.bg !== null) {
      if (o.border !== null) pixBox(this.g, ox, oy, W, H, o.bg, o.border);
      else this.g.fillStyle(o.bg, 1).fillRect(ox, oy, W, H);
      if (o.tail) {
        const cx = ox + Math.round(W / 2);
        const border = o.border ?? o.bg;
        this.g.fillStyle(border, 1).fillRect(cx - 3, oy + H - 1, 6, 1).fillRect(cx - 2, oy + H, 4, 1).fillRect(cx - 1, oy + H + 1, 2, 1);
        this.g.fillStyle(o.bg, 1).fillRect(cx - 2, oy + H - 1, 4, 1).fillRect(cx - 1, oy + H, 2, 1);
      }
    }
    this.t.setPosition(ox + b + o.padX, oy + b + 2);
    this.boxW = W;
    this.boxH = H;
    this.setSize(W, H);
    return this;
  }

  setColor(color: number) {
    this.t.setTint(color);
    return this;
  }

  place(x: number, y: number) {
    return this.setPosition(Math.round(x), Math.round(y));
  }
}

/** A clickable pixel button. */
export class Button extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private t: Phaser.GameObjects.BitmapText;
  private bw: number;
  private bh: number;
  private hover = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
    private fill: number,
    onClick: () => void,
    minW = 0,
  ) {
    super(scene, Math.round(x), Math.round(y));
    this.g = scene.make.graphics({}, false);
    this.t = scene.make.bitmapText({ font: "pxb", text: sanitize(label) }, false).setTint(C.cream);
    const { w } = measure(this.t);
    this.bw = Math.max(minW, w + 12);
    this.bh = 15;
    this.t.setPosition(Math.round((this.bw - w) / 2), 4);
    this.add([this.g, this.t]);
    this.setSize(this.bw, this.bh);
    // Phaser measures a Container's hit area from its center (displayOrigin = half its
    // size), so shift the rectangle by half to line it up with what's drawn.
    this.setInteractive(new Phaser.Geom.Rectangle(this.bw / 2, this.bh / 2, this.bw, this.bh), Phaser.Geom.Rectangle.Contains);
    this.on("pointerover", () => ((this.hover = true), this.draw()));
    this.on("pointerout", () => ((this.hover = false), this.draw()));
    this.on("pointerdown", onClick);
    scene.add.existing(this);
    this.draw();
  }

  get width_() {
    return this.bw;
  }

  setLabel(label: string, fill?: number) {
    if (fill !== undefined) this.fill = fill;
    this.t.setText(sanitize(label));
    const { w } = measure(this.t);
    this.t.setPosition(Math.round((this.bw - w) / 2), 4);
    this.draw();
  }

  private draw() {
    const g = this.g.clear();
    pixBox(g, 0, 0, this.bw, this.bh, this.fill, C.woodDark);
    g.fillStyle(0xffffff, this.hover ? 0.28 : 0.16).fillRect(1, 1, this.bw - 2, 1);
    g.fillStyle(0x000000, 0.18).fillRect(1, this.bh - 2, this.bw - 2, 1);
    if (this.hover) g.fillStyle(0xffffff, 0.1).fillRect(1, 2, this.bw - 2, this.bh - 4);
  }
}

/** A square pixel button with an icon; its name shows as a tooltip on hover. */
export class IconButton extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private icon: Phaser.GameObjects.Image;
  private tip: Label | null = null;
  private hover = false;
  private pressed = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    iconKey: string,
    private fill: number,
    private tooltip: string,
    onClick: () => void,
    readonly bw = 20,
    readonly bh = 18,
  ) {
    super(scene, Math.round(x), Math.round(y));
    this.g = scene.make.graphics({}, false);
    this.icon = scene.make.image({ key: iconKey }, false).setOrigin(0);
    this.add([this.g, this.icon]);
    this.placeIcon();
    this.setSize(bw, bh);
    this.setInteractive(new Phaser.Geom.Rectangle(bw / 2, bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains);
    this.on("pointerover", () => {
      this.hover = true;
      this.draw();
      this.showTip(true);
    });
    this.on("pointerout", () => {
      this.hover = false;
      this.draw();
      this.showTip(false);
    });
    this.on("pointerdown", onClick);
    scene.add.existing(this);
    this.draw();
  }

  setIcon(key: string) {
    this.icon.setTexture(key);
    this.placeIcon();
    return this;
  }

  setFill(fill: number) {
    this.fill = fill;
    this.draw();
    return this;
  }

  setTooltip(text: string) {
    this.tooltip = text;
    if (this.tip) this.tip.setText(text);
    return this;
  }

  /** Pressed-in look for toggles (e.g. edit mode on). */
  setPressed(on: boolean) {
    this.pressed = on;
    this.draw();
    this.placeIcon();
    return this;
  }

  private placeIcon() {
    const push = this.pressed ? 1 : 0;
    this.icon.setPosition(Math.floor((this.bw - this.icon.width) / 2), Math.floor((this.bh - this.icon.height) / 2) + push);
  }

  private showTip(on: boolean) {
    this.tip?.destroy();
    this.tip = null;
    if (!on || !this.tooltip) return;
    const m = this.getWorldTransformMatrix();
    this.tip = new Label(this.scene, Math.round(m.tx + this.bw / 2), Math.round(m.ty - 3), this.tooltip, { bg: C.outline, border: null, color: C.cream, padX: 3 }).setDepth(6000);
  }

  destroy(fromScene?: boolean) {
    this.tip?.destroy();
    super.destroy(fromScene);
  }

  private draw() {
    const g = this.g.clear();
    pixBox(g, 0, 0, this.bw, this.bh, this.fill, C.woodDark);
    if (this.pressed) {
      g.fillStyle(0x000000, 0.22).fillRect(1, 1, this.bw - 2, 2);
      g.fillStyle(0xf5c542, 1).fillRect(1, this.bh - 2, this.bw - 2, 1);
      return;
    }
    g.fillStyle(0xffffff, this.hover ? 0.28 : 0.16).fillRect(1, 1, this.bw - 2, 1);
    g.fillStyle(0x000000, 0.18).fillRect(1, this.bh - 2, this.bw - 2, 1);
    if (this.hover) g.fillStyle(0xffffff, 0.1).fillRect(1, 2, this.bw - 2, this.bh - 4);
  }
}
