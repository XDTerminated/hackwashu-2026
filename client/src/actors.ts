import { floatEmote } from "./idle";
import Phaser from "phaser";
import type { Clod, ClodStatus, VillagerId } from "../../shared/game";
import { VILLAGER_NAMES } from "../../shared/game";
import { shadowKey } from "./textures";
import { C, Label } from "./widgets";

// Pixel-art rule for everything here: never scale or rotate a sprite. Motion
// is whole-pixel movement, frame swaps and fades only.

const TEX: Record<VillagerId, string> = {
  jade_rabbit: "rabbit_0",
  postmaster: "postmaster_0",
  timekeeper: "timekeeper_0",
  scholar: "scholar_0",
  stargazer: "stargazer_0",
  manager: "office_lead",
  dj: "dj_0",
  mechanic: "mechanic_0",
};

type Alert = "none" | "bang" | "smoke";

/**
 * A villager on the island. Server events become queued actions that play
 * one after another at a watchable pace. When the queue backs up (e.g. you
 * reopen the game after a while), actions speed up to catch up.
 */
export class VillagerActor {
  readonly sprite: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Image;
  private nameTag: Label;
  private nameWanted = 0;

  /** Show the name tag (when the player is near, or talking to them). */
  showName(on: boolean) {
    this.nameWanted = on ? 1 : 0;
  }
  private alertIcon: Phaser.GameObjects.Image;
  private thoughtIcon: Phaser.GameObjects.Image;
  private letter: Phaser.GameObjects.Image;
  private bubble: Label | null = null;
  private bubbleTimer: Phaser.Time.TimerEvent | null = null;
  private smokeTimer: Phaser.Time.TimerEvent | null = null;
  private queue: Array<{ fn: () => Promise<void>; at: number }> = [];
  private running = false;
  /** When the action now playing was received — how far behind the backend we are. */
  private playingSince = 0;
  /** Something needs the player — hurry through whatever is queued ahead of it. */
  private rushing = false;
  private walkTween: Phaser.Tweens.Tween | null = null;
  private alert: Alert = "none";
  lastThought = "";

  constructor(
    private scene: Phaser.Scene,
    readonly id: VillagerId,
    x: number,
    y: number,
    onThoughtClick: (v: VillagerActor) => void,
  ) {
    this.shadow = scene.add.image(x, y, shadowKey(scene, 14)).setDepth(-8);
    this.sprite = scene.add.sprite(x, y, TEX[id]).setOrigin(0.5, 1).play(`${id}-idle`);
    this.nameTag = new Label(scene, x, y + 2, VILLAGER_NAMES[id], { bg: C.paper, border: C.paperDark, originY: 0, padX: 2 }).setAlpha(0);
    this.alertIcon = scene.add.image(x, y, "bang").setOrigin(0.5, 1).setVisible(false);
    this.thoughtIcon = scene.add.image(x, y, "thought").setOrigin(0, 1).setVisible(false).setInteractive({ useHandCursor: true });
    this.thoughtIcon.on("pointerdown", (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onThoughtClick(this);
    });
    this.letter = scene.add.image(x, y, "letter").setOrigin(0.5, 1).setVisible(false);
  }

  get x() {
    return this.sprite.x;
  }
  get y() {
    return this.sprite.y;
  }

  /** Animation speed multiplier — the further behind the backend, the faster we replay. */
  get speed() {
    if (!this.running) return 1;
    if (this.rushing) return 6;
    const lag = (Date.now() - this.playingSince) / 1000;
    return lag > 6 ? 6 : lag > 3 ? 3 : lag > 1.5 ? 2 : 1;
  }

  /** Free for idle life: no queued work, not strolling, not flagging the player down, not mid-conversation. */
  get isFree() {
    return !this.running && this.queue.length === 0 && !this.strolling && this.alert === "none" && !this.held && !this.fidgeting;
  }

  // ---------------------------------------------------------------- fidgets
  // Little things each neighbor does now and then while standing around.

  private fidgeting = false;
  /** How far the sprite is lifted off the ground right now (a hop; the shadow stays put). */
  private lift = 0;

  private tweenTo(props: Record<string, number>, duration: number): Promise<void> {
    return new Promise((done) => this.scene.tweens.add({ targets: this, ...props, duration, ease: "sine.out", onComplete: () => done() }));
  }

  /** `n` little hops, `h` pixels high. */
  private async hops(n: number, h: number, ms = 110) {
    for (let i = 0; i < n; i++) {
      await this.tweenTo({ lift: h }, ms);
      await this.tweenTo({ lift: 0 }, ms);
    }
  }

  /** A glance one way, then the other, then back as they were. */
  private async lookAround() {
    const was = this.sprite.flipX;
    this.sprite.setFlipX(!was);
    await this.wait(700);
    this.sprite.setFlipX(was);
    await this.wait(500);
  }

  private emote(kind: Parameters<typeof floatEmote>[3], dx = 0, dy = 0) {
    floatEmote(this.scene, this.sprite.x + dx, this.sprite.y - this.sprite.height - 2 + dy, kind);
  }

  /** Do their own little thing (only when they're free: never mid-task, mid-walk or mid-conversation). */
  async fidget() {
    if (!this.isFree) return;
    this.fidgeting = true;
    try {
      switch (this.id) {
        case "jade_rabbit": // a couple of bunny hops, and sometimes a little heart
          await this.hops(2, 4);
          if (Math.random() < 0.4) this.emote("heart");
          break;
        case "postmaster": // an owl's look around, then a thought
          await this.lookAround();
          if (Math.random() < 0.5) this.emote("dots");
          break;
        case "timekeeper": // tick: checks the time, a little sparkle, a glance
          this.emote("sparkle");
          await this.hops(1, 2);
          await this.lookAround();
          break;
        case "scholar": // thinking... then an idea
          this.emote("dots");
          await this.wait(1100);
          this.emote("sparkle", 4);
          break;
        case "stargazer": // looks up at the stars
          await this.hops(1, 3, 160);
          this.emote("sparkle", -6);
          await this.wait(350);
          this.emote("sparkle", 6, -4);
          break;
        case "dj": // bobs to the beat
          this.emote("note", 5);
          for (let beat = 0; beat < 6; beat++) {
            if (beat === 3) this.emote("note", -5, -2);
            await this.hops(1, 1, 90);
            await this.wait(90);
          }
          break;
        case "mechanic": // a turn of the wrench, sparks flying
          for (let i = 0; i < 3; i++) {
            floatEmote(this.scene, this.sprite.x + (this.sprite.flipX ? -8 : 8), this.sprite.y - 8, "spark", -6);
            await this.wait(260);
          }
          await this.hops(1, 2);
          break;
        default:
          await this.lookAround();
      }
    } finally {
      this.lift = 0;
      this.fidgeting = false;
    }
  }

  private held = false;
  private heldSince = 0;
  private waiters: (() => void)[] = [];

  /** Resolves once the villager isn't talking with the player. */
  private released(): Promise<void> {
    return this.held ? new Promise((r) => this.waiters.push(r)) : Promise.resolve();
  }

  /**
   * Stand still to talk with the player: idle walks stop, a walk in progress
   * pauses, and queued work waits until the conversation ends.
   */
  hold(on: boolean) {
    if (on === this.held) return;
    this.held = on;
    if (on) {
      this.heldSince = Date.now();
      this.cancelStroll();
      this.walkTween?.pause();
      return;
    }
    // Time spent talking isn't lag: don't sprint to catch up afterwards.
    const paused = Date.now() - this.heldSince;
    this.playingSince += paused;
    for (const q of this.queue) q.at += paused;
    this.walkTween?.resume();
    this.waiters.splice(0).forEach((r) => r());
  }

  get isHeld() {
    return this.held;
  }

  /** Busy with real agent work (not just idling or strolling). */
  get working() {
    return this.running || this.queue.length > 0;
  }

  private strolling = false;
  private strollDone: (() => void) | null = null;

  /**
   * Finds a way around buildings, rocks and the rest (set by the island):
   * the points to walk through to get there, or null if there's no way.
   */
  router: ((fx: number, fy: number, tx: number, ty: number) => { x: number; y: number }[] | null) | null = null;

  private route(x: number, y: number) {
    return this.router ? this.router(this.sprite.x, this.sprite.y, x, y) : [{ x, y }];
  }

  /** A leisurely idle walk (around things, never through them). Any real work (enqueue) cancels it on the spot. */
  stroll(x: number, y: number): Promise<boolean> {
    x = Math.round(x);
    y = Math.round(y);
    if (Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, x, y) < 2) return Promise.resolve(true);
    const legs = this.route(x, y);
    if (!legs) return Promise.resolve(false);
    this.strolling = true;
    this.sprite.anims.timeScale = 2;
    return (async () => {
      let ok = true;
      for (const p of legs) if (!(ok = this.strolling && (await this.strollLeg(p.x, p.y)))) break;
      if (this.strolling) {
        this.strolling = false;
        this.sprite.anims.timeScale = 1;
      }
      this.strollDone = null;
      return ok;
    })();
  }

  /** One straight stretch of a stroll: true when it gets there, false if the stroll was called off. */
  private strollLeg(x: number, y: number): Promise<boolean> {
    const d = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, x, y);
    if (d < 1) return Promise.resolve(true);
    this.sprite.setFlipX(x < this.sprite.x);
    return new Promise((resolve) => {
      this.strollDone = () => resolve(false);
      this.walkTween = this.scene.tweens.add({
        targets: this.sprite,
        x,
        y,
        duration: (d / 55) * 1000,
        ease: "linear",
        onComplete: () => {
          this.walkTween = null;
          this.strollDone = null;
          resolve(true);
        },
      });
    });
  }

  private cancelStroll() {
    if (!this.strolling) return;
    this.strolling = false;
    this.walkTween?.stop();
    this.walkTween = null;
    this.sprite.anims.timeScale = 1;
    const done = this.strollDone;
    this.strollDone = null;
    done?.();
  }

  face(x: number) {
    this.sprite.setFlipX(x < this.sprite.x);
  }

  /** Stop an idle walk (e.g. the player walked up to say hi). */
  stopStrolling() {
    this.cancelStroll();
  }

  enqueue(fn: () => Promise<void>, opts: { urgent?: boolean } = {}) {
    this.cancelStroll();
    if (opts.urgent && this.running) this.rushing = true;
    const wrapped = opts.urgent
      ? async () => {
          this.rushing = false;
          await fn();
        }
      : fn;
    this.queue.push({ fn: wrapped, at: Date.now() });
    void this.pump();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      await this.released();
      const { fn, at } = this.queue.shift()!;
      this.playingSince = at;
      try {
        await fn();
      } catch (err) {
        console.error(`[${this.id}] action failed`, err);
      }
    }
    this.running = false;
  }

  wait(ms: number): Promise<void> {
    return new Promise((r) => this.scene.time.delayedCall(ms / this.speed, () => r()));
  }

  /** Walk somewhere for work: around whatever's in the way (straight there if there's no way round). */
  async walkTo(x: number, y: number): Promise<void> {
    await this.released();
    x = Math.round(x);
    y = Math.round(y);
    if (Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, x, y) < 2) return;
    for (const p of this.route(x, y) ?? [{ x, y }]) {
      await this.released();
      await this.walkLeg(Math.round(p.x), Math.round(p.y));
    }
  }

  private walkLeg(x: number, y: number): Promise<void> {
    const d = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, x, y);
    if (d < 1) return Promise.resolve();
    this.sprite.setFlipX(x < this.sprite.x);
    this.sprite.anims.timeScale = 3;
    return new Promise((resolve) => {
      // Duration at normal pace; update() rescales it live as lag changes.
      this.walkTween = this.scene.tweens.add({
        targets: this.sprite,
        x,
        y,
        duration: (d / 150) * 1000,
        ease: "linear",
        onComplete: () => {
          this.walkTween = null;
          this.sprite.anims.timeScale = 1;
          resolve();
        },
      });
      this.walkTween.timeScale = this.speed;
    });
  }

  /** A speech bubble; `originX` shifts it to one side (so it doesn't cover whoever they're talking to). */
  say(text: string, ms = 3200, originX = 0.5) {
    this.bubble?.destroy();
    this.bubbleTimer?.remove();
    const clipped = text.length > 120 ? text.slice(0, 117) + "..." : text;
    this.bubble = new Label(this.scene, this.sprite.x, this.sprite.y - 30, clipped, { maxWidth: 130, tail: true, originX }).setDepth(99990);
    this.bubbleTimer = this.scene.time.delayedCall(Math.max(ms, clipped.length * 45), () => {
      this.bubble?.destroy();
      this.bubble = null;
    });
  }

  showThought(text: string) {
    this.lastThought = text;
    if (!this.thoughtIcon.visible) {
      this.thoughtIcon.setVisible(true).setAlpha(0);
      this.scene.tweens.add({ targets: this.thoughtIcon, alpha: 1, duration: 160 });
    }
  }

  hideThought() {
    this.thoughtIcon.setVisible(false);
  }

  setAlert(a: Alert) {
    this.alert = a;
    this.alertIcon.setVisible(a === "bang");
    this.smokeTimer?.remove();
    this.smokeTimer = null;
    if (a === "smoke") {
      this.smokeTimer = this.scene.time.addEvent({ delay: 260, loop: true, callback: () => puff(this.scene, this.sprite.x, this.sprite.y - 20) });
      this.scene.time.delayedCall(5000, () => {
        if (this.alert === "smoke") this.setAlert("none");
      });
    }
  }

  carryLetter(on: boolean) {
    this.letter.setVisible(on);
  }

  private prints?: Footprints;
  private lastT = 0;
  private lastX = 0;
  private lastY = 0;
  private dustT = 0;
  /** How long they've stood still (breathing after a moment, dozing off after a long while, like you). */
  private stillT = 0;
  private nextZ = 0;
  /** Each breathes at their own pace, so the town doesn't breathe in step. */
  private readonly breathEvery = 0.8 + Math.random() * 0.35;

  update(time: number) {
    const s = this.sprite;
    // Footprints behind them, and moondust kicked up when they hurry (off to a job, like you running).
    (this.prints ??= new Footprints(this.scene)).track(s.x, s.y);
    const dt = this.lastT ? Math.min(0.1, (time - this.lastT) / 1000) : 0;
    if (dt > 0) {
      const vx = (s.x - this.lastX) / dt;
      const vy = (s.y - this.lastY) / dt;
      const v = Math.hypot(vx, vy);
      this.dustT -= dt;
      if (v > 100 && v < 600 && this.dustT <= 0) {
        this.dustT = 0.16;
        puff(this.scene, s.x - (vx / v) * 6, s.y - 1);
      }
    }
    const moved = s.x !== this.lastX || s.y !== this.lastY;
    this.lastT = time;
    this.lastX = s.x;
    this.lastY = s.y;
    // Standing still: a breath every second or so (a pixel down and back), and after a long
    // quiet spell with nothing to do, a doze (zzz). Anything that moves them starts it over.
    this.stillT = moved || this.lift ? 0 : this.stillT + dt;
    const breath = this.stillT > 1.2 && Math.floor(this.stillT / this.breathEvery) % 2 === 1 ? 1 : 0;
    if (this.stillT > 45 && this.isFree && this.stillT > this.nextZ) {
      this.nextZ = this.stillT + 2.6;
      floatEmote(this.scene, s.x + 6, s.y - s.height + 2, "zzz", -14);
    } else if (this.stillT <= 45) this.nextZ = 0;
    // (a hop lifts the picture, not the villager: the shadow stays on the ground)
    const lift = Math.round(this.lift) - breath;
    if (s.originY !== 1 + lift / s.height) s.setOrigin(0.5, 1 + lift / s.height);
    if (this.walkTween && !this.strolling) this.walkTween.timeScale = this.speed;
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    s.setDepth(y);
    this.shadow.setPosition(x, y - 1);
    this.nameTag.place(x, y + 1).setDepth(y + 1);
    // Name tags fade in when you're close (a street full of labels is noise).
    const a = this.nameTag.alpha;
    if (a !== this.nameWanted) this.nameTag.setAlpha(Phaser.Math.Clamp(a + (this.nameWanted > a ? 0.12 : -0.12), 0, 1));
    const top = y - s.height;
    const bob = Math.floor(time / 240) % 2;
    this.alertIcon.setPosition(x, top - 2 - bob).setDepth(99980);
    this.thoughtIcon.setPosition(x + 5, top - 2).setDepth(99981);
    this.letter.setPosition(x + 8, y - 8).setDepth(y + 2);
    this.bubble?.place(x, top - (this.alert === "bang" ? 17 : 3));
  }
}

/**
 * Faint footprints in the moondust behind whoever's walking: one every few steps,
 * left and right in turn, fading away. Call each frame with where they are now.
 */
export class Footprints {
  private lastX: number | null = null;
  private lastY = 0;
  private walked = 0;
  private left = false;
  private stride = 0;
  /** `onStep`: every other print (a whole stride), for footstep sounds. */
  constructor(private scene: Phaser.Scene, private step = 9, private onStep?: (x: number, y: number) => void) {}

  track(x: number, y: number) {
    if (this.lastX === null) return void ((this.lastX = x), (this.lastY = y));
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    const d = Math.hypot(dx, dy);
    // (a jump, like flying home or being carried: start over there)
    if (d > 40) return void ((this.lastX = x), (this.lastY = y), (this.walked = 0));
    this.lastX = x;
    this.lastY = y;
    this.walked += d;
    if (this.walked < this.step || d === 0) return;
    this.walked = 0;
    this.left = !this.left;
    if (this.onStep && ++this.stride % 2 === 0) this.onStep(x, y);
    // (feet side by side, across the way you're going)
    const side = this.left ? -1 : 1;
    const px = Math.round(x + (-dy / d) * 2 * side);
    const py = Math.round(y - 1 + (dx / d) * 1 * side);
    const print = this.scene.add.image(px, py, "footprint").setAlpha(0.3).setDepth(-8.6);
    this.scene.tweens.add({ targets: print, alpha: 0, delay: 1800, duration: 2600, onComplete: () => print.destroy() });
  }

  /** Stop tracking (next time starts fresh, no stray print across the gap). */
  reset() {
    this.lastX = null;
  }
}

export function puff(scene: Phaser.Scene, x: number, y: number) {
  const p = scene.add
    .image(Math.round(x + Phaser.Math.Between(-5, 5)), Math.round(y), "smoke")
    .setAlpha(0.8)
    .setDepth(99970);
  scene.tweens.add({
    targets: p,
    y: y - 22,
    x: p.x + Phaser.Math.Between(-6, 6),
    alpha: 0,
    duration: 1100,
    onComplete: () => p.destroy(),
  });
}

/**
 * A little star — one piece of an agent's work (one tool call). It runs off to
 * the building, works, then glows when the result is ready to collect.
 */
export class ClodActor {
  readonly sprite: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Image;
  private glow: Phaser.GameObjects.Image;
  private bang: Phaser.GameObjects.Image;
  private label: Label;
  status: ClodStatus;
  private px: number;
  private py: number;
  private homeX: number;
  private homeY: number;
  private vx = 0;
  private vy = 0;
  private wanderT = 0;
  private arrived = false;
  private popping = false;

  constructor(
    private scene: Phaser.Scene,
    readonly clod: Clod,
    from: { x: number; y: number },
    to: { x: number; y: number },
    instant = false,
  ) {
    this.status = clod.status;
    this.homeX = to.x;
    this.homeY = to.y;
    const start = instant ? to : from;
    this.px = start.x;
    this.py = start.y;
    this.shadow = scene.add.image(start.x, start.y, shadowKey(scene, 10)).setDepth(-8);
    this.glow = scene.add.image(start.x, start.y - 6, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.3);
    this.sprite = scene.add.sprite(start.x, start.y, "clod_0").setOrigin(0.5, 1).play({ key: "clod-twinkle", startFrame: Phaser.Math.Between(0, 1) });
    this.bang = scene.add.image(start.x, start.y, "bang_s").setOrigin(0.5, 1).setVisible(false);
    this.label = new Label(scene, start.x, start.y, clod.label, { originY: 0, padX: 2 }).setVisible(false);

    if (instant) {
      this.arrived = true;
    } else {
      const pos = { x: this.px, y: this.py };
      scene.tweens.add({
        targets: pos,
        x: to.x,
        y: to.y,
        duration: 650,
        ease: "quad.out",
        onUpdate: () => {
          this.px = pos.x;
          this.py = pos.y;
        },
        onComplete: () => (this.arrived = true),
      });
    }
    this.setStatus(clod.status);
  }

  get x() {
    return Math.round(this.px);
  }
  get y() {
    return Math.round(this.py);
  }

  setStatus(s: ClodStatus) {
    this.status = s;
    this.bang.setVisible(s === "stuck");
    this.sprite.clearTint();
    this.sprite.setAlpha(1);
    if (s === "failed") this.sprite.setTint(0x8a8ea0).setAlpha(0.75);
    else if (s === "working" || s === "stuck") this.sprite.setAlpha(0.9);
  }

  setLabel(text: string) {
    this.label.setText(text);
  }

  showLabel(on: boolean) {
    this.label.setVisible(on && !this.popping);
  }

  pop(onDone?: () => void) {
    this.popping = true;
    const burst = this.scene.add.particles(this.x, this.y - 6, "spark", {
      speed: { min: 40, max: 110 },
      lifespan: 450,
      quantity: 16,
      alpha: { start: 1, end: 0 },
      emitting: false,
    });
    burst.setDepth(99985);
    burst.explode(16);
    this.scene.time.delayedCall(600, () => burst.destroy());
    this.bang.destroy();
    this.label.destroy();
    this.shadow.destroy();
    this.scene.tweens.add({
      targets: [this.sprite, this.glow],
      alpha: 0,
      y: "-=10",
      duration: 220,
      onComplete: () => {
        this.destroy();
        onDone?.();
      },
    });
  }

  destroy() {
    this.shadow.destroy();
    this.sprite.destroy();
    this.glow.destroy();
    this.bang.destroy();
    this.label.destroy();
  }

  update(time: number, dt: number) {
    const s = this.sprite;
    if (!s.active || this.popping) return;
    if (this.arrived) {
      // Working clods bustle around their building; finished ones hop in place.
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = Phaser.Math.FloatBetween(0.5, 1.4);
        const sp = this.status === "working" ? 30 : this.status === "ready" ? 6 : 0;
        const a = Math.random() * Math.PI * 2;
        this.vx = Math.cos(a) * sp;
        this.vy = Math.sin(a) * sp;
      }
      const nx = this.px + this.vx * dt;
      const ny = this.py + this.vy * dt;
      const leash = this.status === "working" ? 22 : 8;
      if (Phaser.Math.Distance.Between(nx, ny, this.homeX, this.homeY) > leash) {
        this.vx = -this.vx;
        this.vy = -this.vy;
      } else {
        this.px = nx;
        this.py = ny;
      }
      if (Math.abs(this.vx) > 1) s.setFlipX(this.vx < 0);
    }

    const x = this.x;
    const y = this.y;
    const hop = this.status === "ready" ? Math.round(Math.abs(Math.sin(time / 180 + this.homeX)) * 3) : 0;
    const shake = this.status === "stuck" ? (Math.floor(time / 70) % 2 ? 1 : -1) : this.status === "working" ? (Math.floor(time / 120 + this.homeY) % 3) - 1 : 0;
    s.setPosition(x + shake, y - hop).setDepth(y);

    const pulse = this.status === "ready" ? 0.55 + 0.25 * Math.sin(time / 200 + this.homeX) : this.status === "failed" ? 0 : 0.22;
    this.glow.setTexture(this.status === "ready" ? "glow" : "glow_s").setPosition(x, y - 7 - hop).setAlpha(pulse).setDepth(y - 1);
    this.bang.setPosition(x, y - 16).setDepth(99979);
    this.shadow.setPosition(x, y - 1);
    this.label.place(x, y + 2).setDepth(99978);
  }
}
