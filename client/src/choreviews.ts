// How island chores look: moondust drifts, and meteors (warning shadow →
// streak → impact → cooling moon-rock). Pixel rule holds: nothing is scaled;
// the growing shadow swaps between natively drawn sizes.

import Phaser from "phaser";
import type { Chore } from "../../shared/game";
import { puff } from "./actors";
import { sfxAt } from "./sfx";
import { shadowKey } from "./textures";

const HOT = Phaser.Display.Color.ValueToColor(0xffffff);
const COLD = Phaser.Display.Color.ValueToColor(0x8a8199);

export class ChoreView {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private shadow?: Phaser.GameObjects.Image;
  private meteor?: Phaser.GameObjects.Image;
  private trail: Phaser.GameObjects.Image[] = [];
  private rock?: Phaser.GameObjects.Image;
  private glow?: Phaser.GameObjects.Image;
  private landed = false;
  private gone = false;

  constructor(
    private scene: Phaser.Scene,
    readonly chore: Chore,
    private near: (x: number, y: number, r: number) => boolean,
  ) {
    if (chore.kind === "dust") {
      const variant = Math.abs([...chore.id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7)) % 3;
      this.objs.push(scene.add.image(chore.x, chore.y, `dust_${variant}`).setDepth(-7.5));
      return;
    }
    if (Date.now() >= (chore.landsAt ?? 0)) {
      this.land(false);
    } else {
      this.shadow = scene.add.image(chore.x, chore.y, shadowKey(scene, 6)).setDepth(-7.4);
      this.meteor = scene.add.image(chore.x, chore.y, "meteor").setDepth(99990).setVisible(false);
      for (let i = 0; i < 4; i++) this.trail.push(scene.add.image(chore.x, chore.y, "meteor").setDepth(99989).setAlpha(0.5 - i * 0.1).setVisible(false));
      this.objs.push(this.shadow, this.meteor, ...this.trail);
      if (near(chore.x, chore.y, 420)) sfxAt(chore.x, chore.y).whistle();
    }
  }

  get x() {
    return this.chore.x;
  }
  get y() {
    return this.chore.y;
  }

  /** A meteor still on its way down (its shadow is growing). */
  get falling() {
    return this.chore.kind === "meteor" && !this.landed && !this.gone;
  }

  /** A meteor you can grab: landed and not yet crumbled. */
  get grabbable() {
    return this.chore.kind === "meteor" && this.landed && !this.gone;
  }

  private land(fresh: boolean) {
    this.landed = true;
    this.shadow?.destroy();
    this.meteor?.destroy();
    this.trail.forEach((t) => t.destroy());
    this.trail = [];
    const { x, y } = this.chore;
    this.objs.push(this.scene.add.image(x, y, "crater_s").setDepth(-8.5));
    this.glow = this.scene.add.image(x, y - 4, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0xffa060).setAlpha(0.6).setDepth(y - 1);
    this.rock = this.scene.add.image(x, y + 2, "moonrock").setOrigin(0.5, 1).setDepth(y);
    this.objs.push(this.glow, this.rock);
    if (fresh) {
      for (let i = 0; i < 8; i++) this.scene.time.delayedCall(i * 30, () => puff(this.scene, x + Phaser.Math.Between(-10, 10), y - 2));
      if (this.near(x, y, 260)) {
        sfxAt(x, y).thunk();
        this.scene.cameras.main.shake(160, 0.006);
      }
    }
  }

  update(now: number) {
    if (this.gone || this.chore.kind !== "meteor") return;
    const landsAt = this.chore.landsAt ?? 0;
    if (!this.landed) {
      const left = landsAt - now;
      if (left <= 0) return this.land(true);
      // The warning shadow grows as it falls: 6px → 22px, in whole-pixel steps.
      const t = 1 - Math.min(1, left / 3000);
      this.shadow?.setTexture(shadowKey(this.scene, 6 + Math.round(t * 8) * 2));
      if (left < 600 && this.meteor) {
        const f = 1 - left / 600;
        const mx = Math.round(this.chore.x - 70 * (1 - f));
        const my = Math.round(this.chore.y - 4 - 160 * (1 - f));
        this.meteor.setVisible(true).setPosition(mx, my);
        this.trail.forEach((tr, i) => tr.setVisible(true).setPosition(mx - (i + 1) * 5, my - (i + 1) * 11));
      }
      return;
    }
    // Cooling: glow fades and the rock goes from hot to grey.
    const expires = this.chore.expires ?? landsAt + 60_000;
    const c = Math.min(1, (now - landsAt) / (expires - landsAt));
    const mix = Phaser.Display.Color.Interpolate.ColorWithColor(HOT, COLD, 100, Math.round(c * 100));
    this.rock?.setTint(Phaser.Display.Color.GetColor(mix.r, mix.g, mix.b));
    this.glow?.setAlpha((0.6 + 0.15 * Math.sin(now / 180)) * (1 - c));
  }

  destroy(how: "collect" | "sweep" | "fade") {
    if (this.gone) return;
    this.gone = true;
    const { x, y } = this.chore;
    if (how === "fade") {
      this.scene.tweens.add({ targets: this.objs, alpha: 0, duration: 600, onComplete: () => this.objs.forEach((o) => o.destroy()) });
      return;
    }
    for (let i = 0; i < (how === "sweep" ? 6 : 4); i++) puff(this.scene, x + Phaser.Math.Between(-8, 8), y - 2);
    if (how === "collect") {
      const burst = this.scene.add.particles(x, y - 4, "spark", { speed: { min: 30, max: 80 }, lifespan: 400, quantity: 10, alpha: { start: 1, end: 0 }, emitting: false }).setDepth(99985);
      burst.explode(10);
      this.scene.time.delayedCall(500, () => burst.destroy());
    }
    this.objs.forEach((o) => o.destroy());
  }
}
