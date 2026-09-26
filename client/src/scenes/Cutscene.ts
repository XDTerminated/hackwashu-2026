import Phaser from "phaser";
import { buildLogo } from "../font";
import { sfx } from "../sfx";
import { C, Label, measure, pixBox, ptext } from "../widgets";
import { bust, type Eyes, type FamilyId, type Mouth, type Pose } from "../cutart";

/** Voices: each speaker's blip pitch. */
export const VOICE: Record<string, number> = { you: 520, mom: 640, dad: 300, grandma: 760, sibling: 900, yutu: 980, narrator: 420 };

/** A family member at the table: swap pose, eyes and mouth; blinks on their own. */
export class Fam {
  img: Phaser.GameObjects.Image;
  pose: Pose = "rest";
  eyes: Eyes = "open";
  mouth: Mouth = "closed";
  private blinking = false;

  constructor(
    private scene: Phaser.Scene,
    readonly id: FamilyId,
    x: number,
    y: number,
  ) {
    this.img = scene.add.image(Math.round(x), Math.round(y), bust(scene, id, "rest", "open", "closed")).setOrigin(0.5, 1);
  }

  set(p: { pose?: Pose; eyes?: Eyes; mouth?: Mouth }) {
    Object.assign(this, p);
    this.refresh();
    return this;
  }

  refresh(talking = false) {
    if (!this.img.scene) return;
    const mouth = talking ? "open" : this.mouth;
    this.img.setTexture(bust(this.scene, this.id, this.pose, this.blinking ? "closed" : this.eyes, mouth));
  }

  blink() {
    if (this.blinking || this.eyes === "closed") return;
    this.blinking = true;
    this.refresh();
    this.scene.time.delayedCall(130, () => {
      this.blinking = false;
      this.refresh();
    });
  }

  get x() {
    return this.img.x;
  }

  get top() {
    return this.img.y - this.img.height;
  }
}

/**
 * Shared machinery for story cutscenes: letterbox bars, typed captions,
 * speech bubbles, a portrait dialog box, SPACE/click to advance and ESC to
 * skip. Subclasses write play() as a plain async script.
 */
export abstract class Cutscene extends Phaser.Scene {
  protected W = 0;
  protected H = 0;
  protected readonly BAR = 22;
  private finished = false;
  private advanceFns: (() => void)[] = [];
  private shot: Phaser.GameObjects.GameObject[] = [];
  private loops: Phaser.Time.TimerEvent[] = [];
  private captionText!: Phaser.GameObjects.BitmapText;

  /** Which shot is playing (a resize restarts the scene at this shot). */
  current = 0;

  protected abstract play(): Promise<void>;

  /** Play shots in order, starting at `from`. */
  protected async shots(list: (() => Promise<void>)[], from = 0) {
    for (let i = Math.min(from, list.length - 1); i < list.length; i++) {
      this.current = i;
      await list[i].call(this);
    }
  }
  protected abstract onEnd(skipped: boolean): void;

  create() {
    this.W = this.scale.width;
    this.H = this.scale.height;
    this.finished = false;
    this.advanceFns = [];
    this.shot = [];
    this.loops = [];
    this.cameras.main.setBackgroundColor("#0b0a1a");

    const bars = this.add.graphics().setScrollFactor(0).setDepth(1000);
    bars.fillStyle(0x07060f, 1).fillRect(0, 0, this.W, this.BAR).fillRect(0, this.H - this.BAR, this.W, this.BAR);
    const hint = ptext(this, 0, 8, "SPACE next  ·  ESC skip", 0x8a8fa8).setScrollFactor(0).setDepth(1001);
    hint.setX(this.W - 8 - measure(hint).w);
    this.captionText = ptext(this, 0, this.H - this.BAR + 8, "", 0xe8e4d8, "pxb").setScrollFactor(0).setDepth(1001);

    const kb = this.input.keyboard!;
    for (const k of ["SPACE", "ENTER", "E"]) kb.on(`keydown-${k}`, () => this.advance());
    kb.on("keydown-ESC", () => this.finish(true));
    this.input.on("pointerdown", () => this.advance());

    this.cameras.main.fadeIn(500, 7, 6, 15);
    void this.play().then(() => this.finish(false));
  }

  // ------------------------------------------------------------ flow

  protected finish(skipped: boolean) {
    if (this.finished) return;
    this.finished = true;
    const cam = this.cameras.main;
    // Already fading to black (between shots)? Finish that fade rather than
    // restarting it, which would flash the old shot for a frame.
    if (!(cam.fadeEffect.isRunning && cam.fadeEffect.direction)) cam.fadeOut(skipped ? 300 : 700, 7, 6, 15);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.onEnd(skipped));
  }

  private advance() {
    const fns = this.advanceFns;
    this.advanceFns = [];
    fns.forEach((f) => f());
  }

  /** A promise that never settles once the scene is over (the script just stops). */
  private gate<T>(fn: (resolve: (v: T) => void) => void): Promise<T> {
    if (this.finished) return new Promise<T>(() => {});
    return new Promise<T>((resolve) => fn((v) => !this.finished && resolve(v)));
  }

  protected wait(ms: number) {
    return this.gate<void>((res) => this.time.delayedCall(ms, () => res()));
  }

  /** Waits `ms`, or less if the player presses SPACE. */
  protected waitOrNext(ms: number) {
    return this.gate<void>((res) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        t.remove();
        res();
      };
      const t = this.time.delayedCall(ms, fin);
      this.advanceFns.push(fin);
    });
  }

  protected tween(cfg: Phaser.Types.Tweens.TweenBuilderConfig) {
    return this.gate<void>((res) => {
      this.tweens.add({ ...cfg, onComplete: () => res() });
    });
  }

  /** Keep an object for this shot only (cleared on the next cut). */
  protected keep<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.shot.push(o);
    // objects that destroy themselves early (rising lanterns) leave the list too
    o.once(Phaser.GameObjects.Events.DESTROY, () => {
      const i = this.shot.indexOf(o);
      if (i >= 0) this.shot.splice(i, 1);
    });
    return o;
  }

  protected every(ms: number, fn: () => void) {
    const t = this.time.addEvent({ delay: ms, loop: true, callback: fn });
    this.loops.push(t);
    return t;
  }

  /** Fade to black, clear the stage, build the next shot, fade back in. */
  protected async cut(build: () => void, ms = 350) {
    this.cameras.main.fadeOut(ms, 7, 6, 15);
    await this.wait(ms + 40);
    this.clearShot();
    build();
    this.cameras.main.fadeIn(ms, 7, 6, 15);
    await this.wait(ms);
  }

  private clearShot() {
    this.tweens.killAll();
    this.loops.forEach((t) => t.remove());
    this.loops = [];
    const objs = this.shot;
    this.shot = [];
    objs.forEach((o) => o.destroy());
    this.cameras.main.setScroll(0, 0);
    this.captionText.setText("");
  }

  // ------------------------------------------------------------ words

  /** Type text a character at a time (SPACE finishes it), blipping in a voice. */
  private type(n: number, show: (k: number) => void, voice: number, onTalk?: (open: boolean) => void) {
    return this.gate<void>((res) => {
      let k = 0;
      let rush = false;
      const skip = () => {
        rush = true;
      };
      this.advanceFns.push(skip);
      let flap = 0;
      const ev = this.time.addEvent({
        delay: 20,
        loop: true,
        callback: () => {
          k = rush ? n : k + 1;
          show(k);
          if (!rush && k % 3 === 1 && Math.random() > 0.12) sfx.voice(voice);
          if (onTalk && ++flap % 4 === 0) onTalk((flap / 4) % 2 === 1);
          if (k >= n) {
            ev.remove();
            this.advanceFns = this.advanceFns.filter((f) => f !== skip);
            onTalk?.(false);
            res();
          }
        },
      });
    });
  }

  /** Narration in the bottom bar. */
  protected async caption(text: string, hold = 1600) {
    const t = this.captionText;
    t.setText(text);
    const w = measure(t).w;
    t.setX(Math.round((this.W - w) / 2));
    await this.type(text.length, (k) => t.setText(text.slice(0, k)), VOICE.narrator);
    if (hold > 0) await this.waitOrNext(Math.max(hold, text.length * 38));
  }

  protected clearCaption() {
    this.captionText.setText("");
  }

  /** A speech bubble over someone; their mouth moves while it types. */
  protected async say(x: number, y: number, text: string, voice: number, talk?: (open: boolean) => void, hold?: number) {
    const b = new Label(this, x, y, text, { maxWidth: 150, tail: true }).setDepth(500);
    const half = Math.round(b.boxW / 2);
    b.setX(Phaser.Math.Clamp(Math.round(x), half + 4, this.W - half - 4));
    b.reveal(0);
    await this.type(b.textLength, (k) => b.reveal(k), voice, talk);
    await this.waitOrNext(hold ?? Math.max(1300, text.length * 42));
    b.destroy();
  }

  protected famSay(f: Fam, text: string, hold?: number) {
    return this.say(f.x, f.top + 2, text, VOICE[f.id] ?? 500, (open) => f.refresh(open), hold);
  }

  /** The talk box with a portrait, for a proper conversation. */
  protected async dialog(portrait: [string, string, string], name: string, text: string, voice: number) {
    const W = Math.min(this.W - 16, 420);
    const h = 62;
    const x = Math.round((this.W - W) / 2);
    const y = this.H - this.BAR - h - 6;
    const box = this.add.container(0, 0).setScrollFactor(0).setDepth(900);
    const g = this.add.graphics();
    pixBox(g, x, y, W, h, C.paperLight, C.outline);
    g.fillStyle(C.paperDark, 1).fillRect(x + 1, y + h - 2, W - 2, 1);
    pixBox(g, x + 5, y + 5, 52, 52, 0x243060, C.outline);
    const face = this.add.image(x + 7, y + 7, portrait[0]).setOrigin(0);
    const who = ptext(this, x + 64, y + 7, name, C.coral, "pxb");
    const body = new Label(this, x + 64, y + 20, text, { bg: null, border: null, originX: 0, originY: 0, align: "left", maxWidth: W - 72, padX: 0 });
    body.reveal(0);
    box.add([g, face, who, body]);
    const blink = this.time.addEvent({ delay: 2600, loop: true, callback: () => (face.setTexture(portrait[2]), this.time.delayedCall(140, () => face.scene && face.setTexture(portrait[0]))) });
    await this.type(body.textLength, (k) => body.reveal(k), voice, (open) => face.setTexture(open ? portrait[1] : portrait[0]));
    const more = ptext(this, x + W - 12, y + h - 12, "→", C.coral, "pxb");
    box.add(more);
    const bob = this.time.addEvent({ delay: 400, loop: true, callback: () => more.setVisible(!more.visible) });
    await this.waitOrNext(Math.max(1700, text.length * 45));
    blink.remove();
    bob.remove();
    box.destroy();
  }

  /** Big chunky title text (built once per string). */
  protected bigText(text: string, fill = "#f5c542") {
    const key = `cut_${fill}_${text}`;
    buildLogo(this, key, text, fill, "#3b2a3a", "#1a1030");
    return key;
  }
}
