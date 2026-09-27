import Phaser from "phaser";
import * as net from "../net";
import { startMusic } from "../music";
import { measure, ptext } from "../widgets";

const STORY = [
  "You would not stop talking about AI at family dinners.",
  "So Earth did the reasonable thing: it sent you to the Moon.",
  "",
  "Cut off. Alone. Just you and the regolith...",
  "...and a few neighbors who happen to be AI agents.",
  "",
  "Every building you add restores a line home.",
];

export class TitleScene extends Phaser.Scene {
  constructor() {
    super("Title");
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = Math.round(W / 2);

    const g = this.add.graphics();
    g.fillStyle(0x0b0a1a, 1).fillRect(0, 0, W, H);
    const rnd = new Phaser.Math.RandomDataGenerator(["moon-village"]);
    for (let i = 0; i < Math.round((W * H) / 700); i++) {
      g.fillStyle(rnd.pick([0xffffff, 0xc8d2f0, 0x9aa8cc, 0xf5d7a8]), rnd.pick([0.35, 0.6, 1]));
      g.fillRect(rnd.between(0, W), rnd.between(0, H), 1, 1);
    }

    const earth = this.add.image(Math.round(W * 0.86), Math.round(H * 0.24), "earth_l");
    this.tweens.add({ targets: earth, y: earth.y - 3, duration: 3200, yoyo: true, repeat: -1, ease: "sine.inout" });

    const ship = this.add.image(Math.round(W * 0.1), Math.round(H * 0.72), "ship").setOrigin(0.5, 1);
    this.tweens.add({ targets: ship, y: ship.y - 4, duration: 2200, yoyo: true, repeat: -1, ease: "sine.inout" });

    const logo = this.add.image(cx + 8, Math.round(H * 0.16), "logo");
    const spark = this.add.image(Math.round(logo.x - logo.width / 2 - 20), logo.y + 1, "spark_logo");
    this.time.addEvent({ delay: 400, loop: true, callback: () => spark.setFlipX(!spark.flipX) });

    const sub = ptext(this, 0, logo.y + 22, "an AI agent viewer you can live in", 0x8a8fa8);
    sub.setX(cx - Math.round(measure(sub).w / 2));

    const story = ptext(this, 0, 0, STORY.join("\n"), 0xe8e4d8).setCenterAlign();
    const sm = measure(story);
    story.setPosition(cx - Math.round(sm.w / 2), Math.round(H * 0.56 - sm.h / 2));

    const press = ptext(this, 0, Math.round(H * 0.88), "- PRESS SPACE OR CLICK TO LAND -", 0xf5c542, "pxb");
    press.setX(cx - Math.round(measure(press).w / 2));
    this.time.addEvent({ delay: 550, loop: true, callback: () => press.setVisible(!press.visible) });

    const fine = ptext(this, 0, H - 12, "*terms and conditions apply", 0x555c78);
    fine.setX(W - 6 - measure(fine).w);

    let landing = false;
    const land = () => {
      if (landing) return;
      landing = true;
      startMusic();
      // The opening scene ends with your real phone buzzing.
      net.send({ type: "landed" });
      this.cameras.main.fadeOut(400, 11, 10, 26);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start("Game");
        this.scene.launch("UI");
      });
    };
    this.input.keyboard!.once("keydown-SPACE", land);
    this.input.once("pointerdown", land);
  }
}
