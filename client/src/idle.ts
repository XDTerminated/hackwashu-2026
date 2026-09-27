// Idle life: the little things characters do while nothing's happening.
// Villagers fidget now and then in their own way (Yutu hops, Echo bobs to the
// beat, Tinker's wrench throws sparks...), and you, standing still, breathe,
// glance around, catch the light on your visor, and eventually doze off.
// Small floating emotes (a note, a sparkle, a heart, "...", "z") carry most of it.

import Phaser from "phaser";
import type { PixelSprite } from "./art";

const K = "#3b2a3a";
const PALETTE = { K, W: "#fff6e6", Y: "#f5c542", P: "#e89aa8", C: "#8fe0e0" };

/** The emotes (outlined, so they read on the pale ground as well as the dark sky). */
export const EMOTES: Record<string, PixelSprite> = {
  note: { palette: PALETTE, frames: [["..KKKK", "..KYYK", "..KYKK", "..KYK.", "KKKYK.", "KYYYK.", "KYYYK.", "KKKKK."]] },
  sparkle: { palette: PALETTE, frames: [["...K...", "..KYK..", ".KYWYK.", "KYWWWYK", ".KYWYK.", "..KYK..", "...K..."]] },
  heart: { palette: PALETTE, frames: [[".KK.KK.", "KPPKPPK", "KPPPPPK", ".KPPPK.", "..KPK..", "...K..."]] },
  dots: { palette: PALETTE, frames: [["KKK.KKK.KKK", "KWK.KWK.KWK", "KKK.KKK.KKK"]] },
  zzz: { palette: PALETTE, frames: [["KKKKKK", "KWWWWK", "KKKWKK", ".KWKK.", "KKWKKK", "KWWWWK", "KKKKKK"]] },
  spark: { palette: PALETTE, frames: [["..K..", ".KYK.", "KYWYK", ".KYK.", "..K.."]] },
  glint: { palette: PALETTE, frames: [["..K..", ".KCK.", "KCWCK", ".KCK.", "..K.."]] },
};

/** A little emote that pops up at (x, y), drifts up and fades. */
export function floatEmote(scene: Phaser.Scene, x: number, y: number, kind: keyof typeof EMOTES, drift = -10) {
  const img = scene.add.image(Math.round(x), Math.round(y), `emote_${kind}_0`).setOrigin(0.5, 1).setDepth(99985).setAlpha(0);
  scene.tweens.add({ targets: img, alpha: 1, duration: 140 });
  scene.tweens.add({ targets: img, y: img.y + drift, duration: 1300, ease: "sine.out" });
  scene.tweens.add({ targets: img, alpha: 0, delay: 900, duration: 400, onComplete: () => img.destroy() });
}

// ------------------------------------------------------------------ you, standing still

const STILL = { down: "astro_0", up: "astro_3", side: "astro_6" } as const;
type Facing = keyof typeof STILL;

/**
 * The astronaut while you're not moving: a gentle breath (a pixel up and down),
 * a look to either side after a few seconds, a glint off the visor now and then,
 * and after a long while, dozing (a little "z" drifting up).
 */
export class PlayerIdle {
  private t = 0;
  private looked = false;
  private nextGlint = 12;
  private nextZ = 0;
  private lastBreath = -1;
  /** Which way you were turned before glancing around (put back after). */
  private flip = false;

  constructor(
    private scene: Phaser.Scene,
    private sprite: Phaser.GameObjects.Sprite,
  ) {}

  /** Moving, talking, or doing something: back to normal, and the clock starts over. */
  reset() {
    if (this.t === 0) return;
    this.t = 0;
    if (this.looked) this.sprite.setFlipX(this.flip);
    this.looked = false;
    this.nextGlint = 12;
    this.nextZ = 0;
    this.lastBreath = -1;
    this.sprite.setOrigin(0.5, 1);
  }

  /** Call each frame while you stand still (facing: the way you last walked). */
  update(dt: number, facing: Facing) {
    this.t += dt;
    const s = this.sprite;
    // Breathing: a pixel down and back, about once a second (after a moment's stillness).
    if (this.t > 1.2) {
      const breath = Math.floor(this.t / 0.9) % 2;
      if (breath !== this.lastBreath) {
        this.lastBreath = breath;
        s.setOrigin(0.5, breath ? 1 - 1 / s.height : 1);
      }
    }
    // A look around: one way, the other, then back as you were.
    if (this.t > 6 && this.t < 7.6) {
      if (!this.looked) this.flip = s.flipX;
      this.looked = true;
      const step = Math.floor((this.t - 6) / 0.8);
      s.setTexture(STILL.side).setFlipX(step === 1);
    } else if (this.looked) {
      this.looked = false;
      s.setTexture(STILL[facing]).setFlipX(this.flip);
    }
    // The sun off your visor now and then.
    if (this.t > this.nextGlint && this.t < 40) {
      this.nextGlint = this.t + 11 + Math.random() * 6;
      floatEmote(this.scene, s.x + (facing === "side" && s.flipX ? -3 : 3), s.y - s.height + 8, "glint", -4);
    }
    // A long wait: dozing off.
    if (this.t > 40 && this.t > this.nextZ) {
      this.nextZ = this.t + 2.4;
      floatEmote(this.scene, s.x + 6, s.y - s.height + 2, "zzz", -14);
    }
  }
}
