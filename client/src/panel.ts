// The dialogue box — talking to villagers (giving them tasks), reading
// approval letters, peeking at thoughts, building. Drawn in-game on the
// pixel grid; a hidden <input> handles typing, paste and IME.
//
// Talking is Stardew-style: the villager's portrait sits on the left, replies
// arrive a bubble at a time and type out while the villager says them out loud,
// and you can answer by voice (hold TAB or the mic) instead of typing.

import Phaser from "phaser";
import type { Approval, VillagerId } from "../../shared/game";
import { CHORE_EVERY_MIN, MAX_HEARTS, VILLAGER_NAMES, VILLAGER_SERVICE, heartsFor } from "../../shared/game";
import { FONT_METRICS, sanitize } from "./font";
import { listen, micSupported, type Listening } from "./mic";
import * as net from "./net";
import { PORTRAIT } from "./portraits";
import { sfx } from "./sfx";
import { store } from "./store";
import { closeMoonPad } from "./tablet";
import { claimInput, input, releaseInput, type InputOwner } from "./textinput";
import * as voice from "./voice";
import { Button, C, IconButton, Label, fit, measure, pixBox, woodFrame, type Font } from "./widgets";

type Kind = "you" | "them" | "sys" | "title" | "letter";
interface ButtonSpec {
  label: string;
  kind?: string;
  onClick: () => void;
}

/** Whose portrait is showing: talking, reading their letter, or calling them down from Earth. */
interface Face {
  villager: VillagerId;
  mode: "talk" | "letter" | "call";
}

/** A dialog line waiting its turn. `line` is set when it'll be spoken. */
interface Queued {
  kind: Kind;
  text: string;
  line?: voice.Line;
  /** First bubble of a reply: chime if it isn't spoken, so you notice it. */
  chime?: boolean;
}

/** Portrait window: a 56px sky (the bust sits on its bottom edge) in a 4px wood frame. */
const PORT_W = PORTRAIT + 16;
/** Space between the portrait column and the text box. */
const SIDE_GAP = 6;
/**
 * Talking keeps the box compact: room for the line being said (four lines of
 * the small font) and the reply field. Earlier lines are a scroll away.
 */
const TALK_W = 250;
const TALK_H = 72;
/** Each reply's first couple of sentences are spoken; the rest just types out (free-plan credits). */
const VOICED_SENTENCES = 2;
/** Typewriter speed when nobody's speaking. */
const TYPE_MS = 26;

const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|e\.g|i\.e|a\.m|p\.m|No)\.$/i;

/** Split a reply into sentences, without breaking on "Prof." or initials. */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    let buf = "";
    for (const part of para.split(/(?<=[.!?…])\s+/)) {
      buf = buf ? `${buf} ${part}` : part;
      if (ABBREVIATION.test(buf) || /\b[A-Z]\.$/.test(buf)) continue;
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

/** Conversation-sized bubbles: a sentence each, with short ones paired up. */
function bubbles(text: string): { text: string; sentences: number }[] {
  const out: { text: string; sentences: number }[] = [];
  for (const s of sentences(text)) {
    const last = out[out.length - 1];
    if (last && (last.text.length < 48 || s.length < 24) && last.text.length + s.length < 120) {
      last.text += ` ${s}`;
      last.sentences++;
    } else out.push({ text: s, sentences: 1 });
  }
  return out;
}

const EXAMPLES: Partial<Record<VillagerId, string>> = {
  jade_rabbit: 'try: "Tell Prof. Vega I\'ll come to office hours Tuesday and put it on my calendar"',
  postmaster: 'try: "What\'s in my inbox?"',
  timekeeper: 'try: "Am I free Tuesday afternoon?"',
  stargazer: 'try: "When is the next full moon?"',
};


const CHORE_WHAT: Partial<Record<VillagerId, string>> = {
  postmaster: "peek at your unread mail",
  timekeeper: "check your next 24 hours",
  scholar: "check what's due in the next 3 days",
  stargazer: "find a bit of today's space news",
};

class Dialog {
  private root: Phaser.GameObjects.Container;
  private g: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.BitmapText;
  private closeHint: Phaser.GameObjects.BitmapText;
  private closeZone: Phaser.GameObjects.Zone;
  private soundBtn: IconButton;
  private content: Phaser.GameObjects.Container;
  private maskG: Phaser.GameObjects.Graphics;
  private skipZone: Phaser.GameObjects.Zone;
  private inputG: Phaser.GameObjects.Graphics;
  private inputT: Phaser.GameObjects.BitmapText;
  private cursor: Phaser.GameObjects.Rectangle;
  private send: Button;
  private micBtn: IconButton;
  private buttons: Button[] = [];
  private items: Label[] = [];
  private typing: Label | null = null;
  private scrollY = 0;
  private contentH = 0;
  private area = { x: 0, y: 0, w: 0, h: 0 };
  private baseAreaH = 0;
  private inputW = 0;
  /** Villager dialogs use the compact font; info screens (quests, help) the regular one. */
  private font: Font = "px";
  /** Talking shows just the newest line at the top of the box; earlier ones are above it. */
  private paged = false;
  private arrows: Phaser.GameObjects.Graphics;
  private onSubmit: ((text: string) => void) | null = null;
  private secret = false;
  private placeholder = "Ask them to do something on Earth...";
  private box = { x: 0, y: 0, w: 0, h: 0 };
  talkMode = false;
  private owner: InputOwner = {
    render: () => this.renderInput(),
    submit: () => this.submit(),
    active: () => this.talkMode && this.visible,
  };

  // --- portrait
  private face: Face | null = null;
  private pg: Phaser.GameObjects.Graphics;
  private pSky: Phaser.GameObjects.Image;
  private pFace: Phaser.GameObjects.Image;
  private pName: Phaser.GameObjects.BitmapText;
  private pHearts: Phaser.GameObjects.BitmapText[] = [];
  private blinkAt = 0;
  /** A toggle under the portrait (the chores checkbox), with its explanation on hover. */
  private side: { button: Button; tip: string } | null = null;
  private sideTip: Label | null = null;

  // --- speaking: lines play one at a time, typing out while they're said
  private queue: Queued[] = [];
  private run: { cancelled: boolean; waiting: Queued | null } | null = null;
  private revealing: { label: Label; start: number; ms: number; done: () => void } | null = null;
  private speech: voice.Speech | null = null;
  /** The villager is working on an answer: show ". . ." whenever nothing else is playing. */
  private awaiting = false;

  // --- push-to-talk
  private micOn = false;
  private listening: Listening | null = null;

  constructor(private scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(5000).setVisible(false);
    this.g = scene.make.graphics({}, false);
    this.title = scene.make.bitmapText({ font: "pxb", text: "" }, false).setTint(C.cream);
    this.closeHint = scene.make.bitmapText({ font: "px", text: "x esc" }, false).setTint(C.paper);
    this.closeZone = new Phaser.GameObjects.Zone(scene, 0, 0, 1, 1).setOrigin(0);
    this.soundBtn = new IconButton(scene, 0, 0, "icon_sound_on_0", C.woodMid, "Voices on/off", () => this.toggleSound(), 16, 15);
    this.content = scene.make.container({}, false);
    this.maskG = scene.make.graphics({}, false);
    this.content.setMask(this.maskG.createGeometryMask());
    this.skipZone = new Phaser.GameObjects.Zone(scene, 0, 0, 1, 1).setOrigin(0);
    this.arrows = scene.make.graphics({}, false);
    this.inputG = scene.make.graphics({}, false);
    this.inputT = scene.make.bitmapText({ font: "px", text: "" }, false);
    this.cursor = new Phaser.GameObjects.Rectangle(scene, 0, 0, 1, 9, C.ink).setOrigin(0);
    this.send = new Button(scene, 0, 0, "SEND", C.woodMid, () => this.submit(), 34);
    this.micBtn = new IconButton(scene, 0, 0, "icon_mic_0", C.woodMid, micSupported ? "Hold to talk (TAB)" : "Voice input needs Chrome, Edge or Safari", () => this.startMic(), 16, 15);
    this.pg = scene.make.graphics({}, false);
    this.pSky = scene.make.image({ key: "portrait_sky" }, false).setOrigin(0);
    this.pFace = scene.make.image({ key: "portrait_jade_rabbit_0" }, false).setOrigin(0);
    this.pName = scene.make.bitmapText({ font: "pxb", text: "" }, false).setTint(C.cream);
    this.pHearts = Array.from({ length: MAX_HEARTS }, () => scene.make.bitmapText({ font: "px", text: "♥" }, false));
    this.root.add([this.g, this.title, this.closeHint, this.content, this.arrows, this.skipZone, this.closeZone, this.pg, this.pSky, this.pFace, this.pName, ...this.pHearts]);
    this.root.add([this.inputG, this.inputT, this.cursor, this.micBtn, this.soundBtn, this.send]);

    this.closeZone.setInteractive({ useHandCursor: true }).on("pointerdown", () => closePanel());
    // Clicking the conversation finishes the current line (Stardew's click-to-continue).
    this.skipZone.setInteractive().on("pointerdown", () => this.skipLine());
    // Push-to-talk ends wherever the pointer is let go.
    scene.input.on("pointerup", () => this.stopMic());
    scene.input.on("pointerupoutside", () => this.stopMic());
    scene.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!this.root.visible) return;
      const step = FONT_METRICS[this.font].line;
      this.scrollY += dy > 0 ? step : -step;
      this.clampScroll();
    });
    scene.time.addEvent({ delay: 480, loop: true, callback: () => this.cursor.setVisible(this.talkMode && !this.cursor.visible) });
    scene.time.addEvent({ delay: 40, loop: true, callback: () => this.tick() });
    this.layout();
  }

  get visible() {
    return this.root.visible;
  }

  layout() {
    const W = this.scene.scale.width;
    const H = this.scene.scale.height;
    const f = this.face;
    const talk = f?.mode === "talk";
    // Villager dialogs stand their portrait beside the box and keep the box to the
    // conversation; only info screens (quests, help) get a title bar.
    const side = f ? PORT_W + SIDE_GAP : 0;
    const titled = !f;
    const w = Math.min(talk ? TALK_W : 330, W - 16 - side);
    const h = Math.min(talk ? TALK_H : 156, H - 30);
    const x = Math.round((W - w - side) / 2) + side;
    const y = H - h - 6;
    const top = titled ? 22 : 9;
    this.box = { x, y, w, h };
    this.area = { x: x + 9, y: y + top, w: w - 18, h: h - top - 26 };
    this.baseAreaH = this.area.h;
    this.g.clear();
    woodFrame(this.g, x, y, w, h);
    this.title.setVisible(titled);
    if (titled) {
      this.g.fillStyle(C.woodMid, 1).fillRect(x + 4, y + 4, w - 8, 14);
      this.g.fillStyle(C.woodLight, 1).fillRect(x + 4, y + 4, w - 8, 1);
      this.title.setPosition(x + 9, y + 7);
      this.closeHint.setText("x esc").setPosition(x + w - 9 - measure(this.closeHint).w, y + 7);
      this.closeZone.setPosition(this.closeHint.x - 2, y + 4).setSize(measure(this.closeHint).w + 4, 14);
    } else {
      // No title bar: a little tab on the top-right corner closes it (so does ESC).
      const [tw, th] = [15, 12];
      const tx = x + w - 6 - tw;
      const ty = y - th + 2;
      pixBox(this.g, tx, ty, tw, th, C.woodMid, C.woodDark);
      this.g.fillStyle(C.woodLight, 1).fillRect(tx + 1, ty + 1, tw - 2, 1);
      this.closeHint.setText("x").setPosition(tx + Math.round((tw - measure(this.closeHint).w) / 2), ty + 2);
      this.closeZone.setPosition(tx, ty).setSize(tw, th);
    }
    this.maskG.clear().fillStyle(0xffffff, 1).fillRect(this.area.x, this.area.y, this.area.w, this.area.h);
    this.skipZone.setPosition(this.area.x, this.area.y).setSize(this.area.w, this.area.h);

    // Footer: [text field][mic][voices][SEND]
    const fy = y + h - 22;
    let bx = x + w - 9 - 34;
    this.send.setPosition(bx, fy);
    if (talk) this.soundBtn.setPosition((bx -= 19), fy);
    if (this.micOn) this.micBtn.setPosition((bx -= 19), fy);
    this.inputW = bx - 4 - (x + 9);
    this.inputG.clear();
    this.inputG.fillStyle(C.paperDark, 1).fillRect(x + 9, fy, this.inputW, 15);
    this.inputG.fillStyle(C.paperLight, 1).fillRect(x + 10, fy + 1, this.inputW - 2, 13);
    this.inputT.setPosition(x + 13, fy + (this.font === "sm" ? 5 : 4));
    this.layoutFace(x - side, y + h);
    this.relayoutItems();
    this.placeButtons();
  }

  /**
   * The portrait column beside the box, bottom-aligned with it: a framed portrait
   * on a night sky, the name plate with friendship hearts, then any side toggle.
   */
  private layoutFace(px: number, bottom: number) {
    const f = this.face;
    this.pg.clear();
    for (const o of [this.pSky, this.pFace, this.pName]) o.setVisible(!!f);
    this.pHearts.forEach((t) => t.setVisible(f?.mode === "talk"));
    if (!f) return;
    const plateH = f.mode === "talk" ? 23 : 14;
    const py = bottom - (PORT_W + 3 + plateH + (this.side ? 18 : 0));
    pixBox(this.pg, px, py, PORT_W, PORT_W, C.wood, C.woodDark);
    this.pg.fillStyle(C.woodLight, 1).fillRect(px + 2, py + 1, PORT_W - 4, 1);
    this.pg.fillStyle(C.woodDark, 1).fillRect(px + 3, py + 3, PORT_W - 6, PORT_W - 6);
    this.pSky.setPosition(px + 4, py + 4);
    this.pFace.setPosition(px + 8, py + PORT_W - 4 - PORTRAIT).setTexture(`portrait_${f.villager}_0`);
    // Still on Earth: only a silhouette until they're connected.
    if (f.mode === "call") this.pFace.setTint(0x3a3355);
    else this.pFace.clearTint();

    const ny = py + PORT_W + 3;
    pixBox(this.pg, px, ny, PORT_W, plateH, C.woodMid, C.woodDark);
    this.pg.fillStyle(0xffffff, 0.16).fillRect(px + 1, ny + 1, PORT_W - 2, 1);
    // Bold when it fits; longer names ("Jade Rabbit") drop to the regular weight.
    const name = VILLAGER_NAMES[f.villager];
    this.pName.setFont("pxb").setText(name);
    if (measure(this.pName).w > PORT_W - 6) this.pName.setFont("px").setText(fit(this.scene, name, PORT_W - 6));
    this.pName.setPosition(px + Math.round((PORT_W - measure(this.pName).w) / 2), ny + 4);
    const hx = px + Math.round((PORT_W - (MAX_HEARTS * 6 - 1)) / 2);
    this.pHearts.forEach((t, i) => t.setPosition(hx + i * 6, ny + 13));
    this.refreshHearts();
    const b = this.side?.button;
    b?.setPosition(px + Math.round((PORT_W - b.width_) / 2), ny + plateH + 3);
  }

  /** A toggle under the portrait (the chores checkbox); its explanation shows on hover. */
  setSide(spec: (ButtonSpec & { tip: string }) | null) {
    this.clearSide();
    if (spec) {
      const button = new Button(this.scene, 0, 0, spec.label, spec.kind === "ok" ? C.greenBtn : C.woodMid, spec.onClick, PORT_W);
      button.on("pointerover", () => this.showSideTip());
      button.on("pointerout", () => this.hideSideTip());
      this.root.add(button);
      this.side = { button, tip: spec.tip };
    }
    this.layout();
  }

  private clearSide() {
    this.hideSideTip();
    this.side?.button.destroy();
    this.side = null;
  }

  private showSideTip() {
    this.hideSideTip();
    const s = this.side;
    if (!s) return;
    this.sideTip = new Label(this.scene, s.button.x, s.button.y - 3, s.tip, {
      bg: C.outline,
      border: null,
      color: C.cream,
      maxWidth: 150,
      originX: 0,
      originY: 1,
      align: "left",
    }).setDepth(6000);
  }

  private hideSideTip() {
    this.sideTip?.destroy();
    this.sideTip = null;
  }

  private toggleSound() {
    voice.setMuted(!voice.isMuted());
    this.soundBtn.setIcon(voice.isMuted() ? "icon_sound_off_0" : "icon_sound_on_0");
    sfx.blip();
  }

  refreshHearts() {
    if (!this.face) return;
    const n = heartsFor(store.friendship[this.face.villager] ?? 0);
    this.pHearts.forEach((t, i) => t.setTint(i < n ? 0xffa3c0 : C.wood));
  }

  open(
    title: string,
    talk: boolean,
    opts: { placeholder?: string; secret?: boolean; onSubmit?: (text: string) => void; face?: Face; mic?: boolean } = {},
  ) {
    this.clear();
    this.onSubmit = opts.onSubmit ?? null;
    this.secret = !!opts.secret;
    this.face = opts.face ?? null;
    this.font = this.face ? "sm" : "px";
    this.paged = this.face?.mode === "talk";
    this.inputT.setFont(this.font);
    this.cursor.setSize(1, this.font === "sm" ? 7 : 9);
    this.micOn = talk && !!opts.mic;
    this.placeholder = opts.placeholder ?? (this.micOn && micSupported ? "Type, or hold TAB to talk..." : "Ask them to do something on Earth...");
    this.layout();
    this.setAreaHeight(this.baseAreaH);
    this.title.setText(sanitize(title));
    this.soundBtn.setVisible(this.face?.mode === "talk").setIcon(voice.isMuted() ? "icon_sound_off_0" : "icon_sound_on_0");
    this.blinkAt = performance.now() + 1800;
    this.talkMode = talk;
    this.inputG.setVisible(talk);
    this.inputT.setVisible(talk);
    this.cursor.setVisible(talk);
    this.send.setVisible(talk);
    this.micBtn.setVisible(this.micOn).setIcon("icon_mic_0").setPressed(false);
    this.root.setVisible(true);
    if (talk) claimInput(this.owner);
    else releaseInput(this.owner);
    this.renderInput();
  }

  close() {
    this.root.setVisible(false);
    this.talkMode = false;
    releaseInput(this.owner);
    this.clear();
  }

  private clear() {
    this.cancelRun();
    this.queue = [];
    this.awaiting = false;
    this.endMic(true);
    this.items.forEach((i) => i.destroy());
    this.items = [];
    this.typing = null;
    this.buttons.forEach((b) => b.destroy());
    this.buttons = [];
    this.clearSide();
    this.scrollY = 0;
    this.contentH = 0;
  }

  add(kind: Kind, text: string) {
    const w = this.area.w;
    const font = this.font;
    let l: Label;
    if (kind === "you") l = new Label(this.scene, 0, 0, text, { bg: 0xe6c189, border: 0xc9975a, font, maxWidth: w - 40, originX: 1, originY: 0, align: "left" });
    else if (kind === "them") l = new Label(this.scene, 0, 0, text, { bg: C.paperLight, border: C.paperDark, font, maxWidth: w - 40, originX: 0, originY: 0, align: "left" });
    else if (kind === "title") l = new Label(this.scene, 0, 0, text, { bg: null, border: null, font: font === "sm" ? "sm" : "pxb", color: C.coral, maxWidth: w, originX: 0, originY: 0, align: "left", padX: 0 });
    else if (kind === "letter") l = new Label(this.scene, 0, 0, text, { bg: 0xfffaf0, border: C.paperDark, font, maxWidth: w - 10, originX: 0, originY: 0, align: "left", padX: 4 });
    else l = new Label(this.scene, 0, 0, text, { bg: null, border: null, color: C.inkSoft, font, maxWidth: w - 8, originX: 0.5, originY: 0, align: "center" });
    (l as Label & { kind?: Kind }).kind = kind;
    this.content.add(l);
    this.items.push(l);
    this.relayoutItems();
    if (this.paged) this.scrollTo(l.y);
    else if (this.talkMode) this.scrollToEnd();
    return l;
  }

  showTyping() {
    this.hideTyping();
    this.typing = this.add("them", ". . .");
  }

  hideTyping() {
    if (!this.typing) return;
    this.items = this.items.filter((i) => i !== this.typing);
    this.typing.destroy();
    this.typing = null;
    this.relayoutItems();
  }

  // ------------------------------------------------------------ speaking

  /** A villager's reply: split into bubbles that type out in turn, the first couple of sentences spoken. */
  say(text: string) {
    this.awaiting = false;
    const f = this.face;
    const v = f?.mode === "talk" ? f.villager : null;
    let spoken = 0;
    bubbles(text).forEach((b, i) => {
      const line = v && spoken < VOICED_SENTENCES ? voice.prepare(v, b.text) : undefined;
      if (line) spoken += b.sentences;
      this.queue.push({ kind: "them", text: b.text, line, chime: i === 0 });
    });
    this.pump();
  }

  /** A line that waits its turn behind anything still being said. */
  note(kind: Kind, text: string) {
    this.queue.push({ kind, text });
    this.pump();
  }

  /** The villager is off working on it: ". . ." until they say something. */
  expectReply() {
    this.awaiting = true;
    if (!this.run) this.showTyping();
  }

  private pump() {
    if (this.run || !this.queue.length) return;
    const run: { cancelled: boolean; waiting: Queued | null } = { cancelled: false, waiting: null };
    this.run = run;
    void (async () => {
      while (this.queue.length && !run.cancelled) {
        const q = this.queue.shift()!;
        if (q.kind !== "them") {
          this.hideTyping();
          this.add(q.kind, q.text);
          continue;
        }
        let buf: AudioBuffer | null = null;
        if (q.line) {
          // A breath while their voice loads (instant once a line is cached).
          run.waiting = q;
          if (!this.typing) this.showTyping();
          buf = await voice.ready(q.line);
          if (run.cancelled) return;
          run.waiting = null;
        }
        this.hideTyping();
        const speech = q.line ? voice.play(q.line, buf) : null;
        this.speech = speech;
        const label = this.add("them", q.text).reveal(0);
        if (!speech && q.chime) sfx.message();
        const ms = speech ? Math.max(300, speech.duration * 0.9) : Math.min(4000, label.textLength * TYPE_MS);
        await new Promise<void>((done) => (this.revealing = { label, start: performance.now(), ms, done }));
        if (speech) await speech.done;
        if (run.cancelled) return;
        this.speech = null;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (this.run !== run) return;
      this.run = null;
      if (this.awaiting) this.showTyping();
    })();
  }

  private finishReveal() {
    const r = this.revealing;
    if (!r) return;
    this.revealing = null;
    r.label.reveal(Infinity);
    r.done();
  }

  private cancelRun() {
    const run = this.run;
    this.run = null;
    if (run) run.cancelled = true;
    voice.stopSpeaking();
    this.speech = null;
    this.finishReveal();
    return run;
  }

  /** Cut them off: stop talking and show everything they were about to say. */
  private flush() {
    const run = this.cancelRun();
    const rest = [...(run?.waiting ? [run.waiting] : []), ...this.queue.splice(0)];
    this.hideTyping();
    for (const q of rest) this.add(q.kind, q.text);
    if (this.awaiting) this.showTyping();
  }

  /** Click-to-continue: finish the current line now and move on to the next. */
  private skipLine() {
    if (!this.revealing && !this.speech) return;
    this.speech?.stop();
    this.finishReveal();
  }

  private tick() {
    const r = this.revealing;
    if (r) {
      const t = (performance.now() - r.start) / r.ms;
      const n = Math.floor(t * r.label.textLength);
      r.label.reveal(n);
      if (this.paged) {
        // A line taller than the box scrolls along as it types out.
        const m = FONT_METRICS[this.font];
        const bottom = r.label.y + 3 + (r.label.linesUpTo(n) - 1) * m.line + m.height + 2;
        if (bottom - this.scrollY > this.area.h) this.scrollTo(bottom - this.area.h);
      }
      if (t >= 1) this.finishReveal();
    }
    this.animateFace();
  }

  /** Lip-flap while they're audible (or while unspoken text types out), and the odd blink. */
  private animateFace() {
    const f = this.face;
    if (!f || !this.root.visible) return;
    const now = performance.now();
    const flap = Math.floor(now / 90) % 2 === 0;
    const talking = f.mode === "talk" && (this.speech ? this.speech.level() > 0.03 : !!this.revealing);
    let frame = 0;
    if (talking && flap) frame = 1;
    else if (!talking && now >= this.blinkAt) {
      frame = 2;
      if (now >= this.blinkAt + 140) this.blinkAt = now + 2200 + Math.random() * 2600;
    }
    const key = `portrait_${f.villager}_${frame}`;
    if (this.pFace.texture.key !== key) this.pFace.setTexture(key);
  }

  // ------------------------------------------------------------ push-to-talk

  canListen() {
    return this.visible && this.talkMode && this.micOn;
  }

  startMic() {
    if (!this.canListen() || this.listening) return;
    if (!micSupported) {
      sfx.deny();
      this.note("sys", "Voice input needs Chrome, Edge or Safari - you can still type.");
      return;
    }
    this.flush();
    const l = listen(
      (text) => {
        input.value = text;
        this.renderInput();
      },
      (problem) => this.note("sys", problem),
    );
    if (!l) return;
    this.listening = l;
    input.value = "";
    this.micBtn.setIcon("icon_mic_on_0").setPressed(true);
    this.renderInput();
    sfx.blip();
    void l.heard.then((text) => {
      if (this.listening !== l) return;
      this.endMic(false);
      input.value = text;
      if (text) this.submit();
      else this.renderInput();
    });
  }

  stopMic() {
    this.listening?.stop();
  }

  private endMic(cancel: boolean) {
    if (cancel) this.listening?.cancel();
    this.listening = null;
    this.micBtn.setIcon("icon_mic_0").setPressed(false);
  }

  // ------------------------------------------------------------ layout

  /** Buttons sit on the footer; with a text field too, they get their own row above it. */
  private setAreaHeight(h: number) {
    this.area.h = h;
    this.maskG.clear().fillStyle(0xffffff, 1).fillRect(this.area.x, this.area.y, this.area.w, this.area.h);
    this.skipZone.setSize(this.area.w, this.area.h);
    this.clampScroll();
  }

  setButtons(specs: ButtonSpec[]) {
    this.setAreaHeight(this.talkMode && specs.length ? this.baseAreaH - 19 : this.baseAreaH);
    this.buttons.forEach((b) => b.destroy());
    this.buttons = specs.map((s) => {
      const b = new Button(this.scene, 0, 0, s.label, s.kind === "ok" ? C.greenBtn : C.woodMid, s.onClick, 40);
      this.root.add(b);
      return b;
    });
    this.placeButtons();
  }

  private placeButtons() {
    let x = this.box.x + this.box.w - 9;
    const y = this.box.y + this.box.h - 22 - (this.talkMode ? 19 : 0);
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      x -= b.width_;
      b.setPosition(x, y);
      x -= 5;
    }
  }

  private relayoutItems() {
    let y = 0;
    for (const l of this.items) {
      const kind = (l as Label & { kind?: Kind }).kind;
      const x = kind === "you" ? this.area.w : kind === "sys" ? Math.round(this.area.w / 2) : 0;
      l.setPosition(x, y);
      y += l.boxH + 4;
    }
    this.contentH = y;
    this.clampScroll();
  }

  private scrollToEnd() {
    this.scrollTo(this.contentH);
  }

  private scrollTo(y: number) {
    this.scrollY = y;
    this.clampScroll();
  }

  private clampScroll() {
    // Paged, you can scroll down until the newest line sits alone at the top.
    const lastTop = this.paged ? (this.items[this.items.length - 1]?.y ?? 0) : 0;
    const max = Math.max(0, this.contentH - this.area.h, lastTop);
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, max);
    this.content.setPosition(this.area.x, this.area.y - Math.round(this.scrollY));
    this.drawArrows(this.scrollY > 0, this.scrollY < max);
  }

  /** Little arrows in the margin when there's more to scroll to. */
  private drawArrows(up: boolean, down: boolean) {
    const g = this.arrows.clear();
    const x = this.area.x + this.area.w + 1;
    g.fillStyle(C.inkSoft, 1);
    if (up) g.fillRect(x + 1, this.area.y, 1, 1).fillRect(x, this.area.y + 1, 3, 1);
    if (down) g.fillRect(x, this.area.y + this.area.h - 2, 3, 1).fillRect(x + 1, this.area.y + this.area.h - 1, 1, 1);
  }

  renderInput() {
    const maxW = this.inputW - 10;
    const raw = this.secret ? "*".repeat(input.value.length) : input.value;
    if (!raw) {
      const hint = this.listening ? "Listening... let go to send" : this.placeholder;
      this.inputT.setText(fit(this.scene, hint, maxW, this.font)).setTint(this.listening ? C.red : 0xb09a78);
      this.cursor.setPosition(this.inputT.x, this.inputT.y - 1);
      return;
    }
    let s = sanitize(raw);
    this.inputT.setTint(C.ink).setText(s);
    while (s.length > 1 && measure(this.inputT).w > maxW) this.inputT.setText((s = s.slice(1)));
    this.cursor.setPosition(this.inputT.x + measure(this.inputT).w + 1, this.inputT.y - 1);
  }

  submit() {
    if (this.listening) this.endMic(true);
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    this.renderInput();
    if (this.onSubmit) return this.onSubmit(text);
    if (!talkingTo) return;
    // Talking over a villager cuts them off; what they were saying stays on screen.
    this.flush();
    this.add("you", text);
    sfx.blip();
    if (net.send({ type: "task", villager: talkingTo, text })) this.expectReply();
    else this.add("sys", "The line to the colony server is down - start it with npm run dev:server.");
  }
}

let dialog: Dialog | null = null;
let talkingTo: VillagerId | null = null;
/** The villager whose account we're connecting in the open dialog, if any. */
let callingFor: VillagerId | null = null;
let toggleCb: (open: boolean) => void = () => {};

/** Called by the UI scene; re-mounting after a resize keeps callers working. */
export function mountPanel(scene: Phaser.Scene) {
  voice.stopSpeaking();
  dialog = new Dialog(scene);
}

/** Tell the game a screen is open (freezes the player) or closed. Shared with the MoonPad. */
export function setUiOpen(open: boolean) {
  toggleCb(open);
}

export function initPanel() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isPanelOpen()) closePanel();
  });
  // Hold TAB to talk. The hidden text field has focus whenever you can type.
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !dialog?.canListen()) return;
    e.preventDefault();
    if (!e.repeat) dialog.startMic();
  });
  input.addEventListener("keyup", (e) => {
    if (e.key !== "Tab" || !dialog?.canListen()) return;
    e.preventDefault();
    dialog.stopMic();
  });

  net.onNotice((text) => {
    if (dialog?.visible && callingFor) dialog.add("sys", text);
  });

  net.onEvent((e) => {
    if (e.type === "chore_optin" && dialog?.visible && talkingTo) {
      choreToggle(talkingTo);
      dialog.note("sys", store.choreOptIn[talkingTo] ? "Chores ON - first round in about a minute." : "Chores OFF.");
      return;
    }
    if (e.type === "villager_arrived" && dialog?.visible && callingFor === e.villager) {
      dialog.add("sys", `Signal received! The ${VILLAGER_NAMES[e.villager]} is landing.`);
      setTimeout(closePanel, 1600);
      return;
    }
    if (e.type === "friendship" && dialog?.visible) dialog.refreshHearts();
    if (!dialog?.visible || !talkingTo) return;
    if (e.type === "say" && e.villager === talkingTo) {
      dialog.say(e.text);
    } else if (e.type === "handoff" && e.from === talkingTo) {
      dialog.note("sys", `-> handed to ${VILLAGER_NAMES[e.to]}: "${e.text.slice(0, 80)}${e.text.length > 80 ? "..." : ""}"`);
      dialog.expectReply();
    } else if (e.type === "approval_needed") {
      dialog.note("sys", `! ${VILLAGER_NAMES[e.villager]} is walking a letter to your house for your OK.`);
    }
  });
}

export function onPanelToggle(cb: (open: boolean) => void) {
  toggleCb = cb;
}

export function isPanelOpen() {
  return !!dialog?.visible;
}

/** The opt-in "chores" checkbox under the portrait: honest (on hover) that it spends real API calls. */
function choreToggle(v: VillagerId) {
  if (!dialog || !CHORE_WHAT[v]) return;
  const on = !!store.choreOptIn[v];
  dialog.setSide({
    label: on ? "[x] CHORES" : "[ ] CHORES",
    kind: on ? "ok" : "",
    tip: `When idle, the ${VILLAGER_NAMES[v]} will ${CHORE_WHAT[v]} on their own about every ${CHORE_EVERY_MIN} min. Each round uses REAL API calls.`,
    onClick: () => net.send({ type: "set_chore_optin", villager: v, enabled: !store.choreOptIn[v] }),
  });
}

export function openTalk(v: VillagerId, greeting: string) {
  if (!dialog) return;
  closeMoonPad();
  talkingTo = v;
  callingFor = null;
  // The example question sits in the empty reply field. The Rabbit's is a team
  // job, so it only shows once she can coordinate.
  const example = v !== "jade_rabbit" || store.rabbitTeamwork ? EXAMPLES[v] : undefined;
  dialog.open(VILLAGER_NAMES[v].toUpperCase(), true, { face: { villager: v, mode: "talk" }, mic: true, placeholder: example });
  dialog.say(greeting);
  choreToggle(v);
  toggleCb(true);
}

export function openLetter(a: Approval) {
  if (!dialog) return;
  closeMoonPad();
  talkingTo = null;
  callingFor = null;
  dialog.open(`✉ LETTER FROM ${VILLAGER_NAMES[a.villager].toUpperCase()}`, false, { face: { villager: a.villager, mode: "letter" } });
  dialog.add("sys", "This needs your OK before it leaves the Moon.");
  dialog.add("title", a.title);
  dialog.add("letter", a.body);
  dialog.setButtons([
    {
      label: "APPROVE",
      kind: "ok",
      onClick: () => {
        net.send({ type: "approve", approvalId: a.id, approved: true });
        sfx.buy();
        closePanel();
      },
    },
    {
      label: "HOLD IT",
      onClick: () => {
        net.send({ type: "approve", approvalId: a.id, approved: false });
        sfx.deny();
        closePanel();
      },
    },
  ]);
  toggleCb(true);
}

export function openInfo(title: string, lines: string[], buttons: ButtonSpec[] = []) {
  if (!dialog) return;
  closeMoonPad();
  talkingTo = null;
  callingFor = null;
  dialog.open(title, false);
  for (const l of lines) dialog.add("them", l);
  dialog.setButtons(buttons);
  toggleCb(true);
}

/**
 * "Call" a villager who's still on Earth: their house is built, and connecting
 * their real account is what brings them to the Moon.
 */
export function openConnect(v: VillagerId) {
  const service = VILLAGER_SERVICE[v];
  if (!dialog || !service || service === "web") return;
  closeMoonPad();
  const name = VILLAGER_NAMES[v];
  talkingTo = null;
  callingFor = v;
  const face: Face = { villager: v, mode: "call" };
  const sampleButton = {
    label: "USE SAMPLE DATA",
    onClick: () => {
      net.send({ type: "use_sandbox", service });
      dialog?.add("sys", "OK - they'll practice on sample data until you connect for real.");
    },
  };

  if (service === "google") {
    dialog.open(`CALL THE ${name.toUpperCase()}`, false, { face });
    dialog.add(
      "them",
      v === "postmaster"
        ? "The Postmaster is still on Earth, waiting for a signal. Connect your Google account and they'll land with your Gmail: reading, summarizing and drafting replies. Nothing gets sent without your OK."
        : "The Timekeeper is waiting for a signal from Earth. Connect your Google account so they can read your calendar and book events (you approve every booking).",
    );
    if (!store.connections.google.configured) dialog.add("sys", "Host setup needed first: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env (see README).");
    dialog.setButtons([
      {
        label: "CONNECT GOOGLE",
        kind: "ok",
        onClick: () => {
          window.open(`http://${location.hostname || "localhost"}:8787/connect/google`, "_blank");
          dialog?.add("sys", "Finish signing in with Google in the new tab, then come back here.");
        },
      },
      sampleButton,
    ]);
  } else {
    dialog.open(`CALL THE ${name.toUpperCase()}`, true, {
      placeholder: "Paste your Canvas access token...",
      secret: true,
      face,
      onSubmit: (token) => {
        net.send({ type: "connect_canvas", token });
        dialog?.add("sys", "Checking that token with Canvas...");
      },
    });
    dialog.add(
      "them",
      "The Scholar needs a line to your Canvas. In Canvas (wustl.instructure.com): Account > Settings > + New Access Token. Paste it below. Read-only - the Scholar never submits anything.",
    );
    dialog.setButtons([sampleButton]);
  }
  toggleCb(true);
}

export function closePanel() {
  if (!dialog?.visible) return;
  dialog.close();
  talkingTo = null;
  callingFor = null;
  toggleCb(false);
}
