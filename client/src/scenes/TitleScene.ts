import Phaser from "phaser";
import * as net from "../net";
import { startMusic } from "../music";
import { Button, C, measure, ptext } from "../widgets";
import { introSeen } from "./IntroScene";

// One line: the intro cutscene tells the story; the title just sets the mood.
const STORY = ["Every home you build brings back a line to Earth."];

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
    story.setPosition(cx - Math.round(sm.w / 2), Math.round(H * 0.34 - sm.h / 2));

    const fine = ptext(this, 0, H - 12, "*terms and conditions apply", 0x555c78);
    fine.setX(W - 6 - measure(fine).w);
    const centered = (y: number, text: string, color: number, font: "px" | "pxb" = "px") => {
      const t = ptext(this, 0, y, text, color, font);
      const m = measure(t);
      t.setX(cx - Math.round(m.w / 2));
      // clear the stars behind it, so none reads as punctuation
      this.add.rectangle(t.x - 2, y - 1, m.w + 4, m.h + 2, 0x0b0a1a).setOrigin(0).setDepth(1);
      return t.setDepth(2);
    };
    /** A little text link (privacy, sign out). */
    const link = (x: number, y: number, text: string, act: () => void) => {
      const t = ptext(this, x, y, text, 0x8a8fa8).setInteractive({ useHandCursor: true });
      t.on("pointerover", () => t.setTint(0xf5c542)).on("pointerout", () => t.setTint(0x8a8fa8)).on("pointerdown", (_p: unknown, _x: number, _y: number, e: Phaser.Types.Input.EventData) => (e.stopPropagation(), act()));
      return t;
    };

    // Online, everyone signs in first: their own village, their own accounts.
    const auth = net.auth;
    if (auth.state === "checking") {
      centered(Math.round(H * 0.88), "...", 0x8a8fa8, "pxb");
      const off = net.onAuth(() => this.scene.restart());
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => off());
      return;
    }
    if (auth.state === "out") {
      if (auth.note) centered(Math.round(H * 0.72), auth.note, 0xe08a6b);
      const btn = new Button(this, 0, Math.round(H * 0.78), "SIGN IN WITH GOOGLE", C.greenBtn, () => net.signIn(), 120);
      btn.setX(cx - Math.round(btn.width_ / 2));
      this.add.existing(btn);
      centered(Math.round(H * 0.78) + 24, "Sign in for your own private village.", 0xe8e4d8);
      centered(Math.round(H * 0.78) + 36, "Your Gmail, Calendar, Canvas and Claude Code stay yours alone.", 0x8a8fa8);
      link(6, H - 12, "privacy", () => window.open("/privacy", "_blank", "noopener"));
      this.input.keyboard!.once("keydown-SPACE", () => net.signIn());
      this.input.keyboard!.once("keydown-E", () => net.signIn());
      return;
    }

    const press = ptext(this, 0, Math.round(H * 0.88), "- PRESS SPACE OR CLICK TO LAND -", 0xf5c542, "pxb");
    press.setX(cx - Math.round(measure(press).w / 2));
    this.time.addEvent({ delay: 550, loop: true, callback: () => press.setVisible(!press.visible) });
    if (auth.state === "in") {
      // Who's playing, and a way out (bottom left).
      const who = ptext(this, 6, H - 12, `signed in as ${auth.name || auth.email} ·`, 0x555c78);
      link(6 + measure(who).w + 4, H - 12, "sign out", () => net.signOut());
      if (introSeen()) ptext(this, 6, H - 24, "press I to watch the intro again", 0x555c78);
    } else if (introSeen()) ptext(this, 6, H - 12, "press I to watch the intro again", 0x555c78);

    let landing = false;
    const intro = () => {
      if (landing) return;
      landing = true;
      startMusic();
      this.cameras.main.fadeOut(400, 7, 6, 15);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start("Intro"));
    };
    this.input.keyboard!.once("keydown-I", intro);
    const land = () => {
      if (landing) return;
      // First time: the story of how you got here.
      if (!introSeen()) return intro();
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
    this.input.keyboard!.once("keydown-E", land);
    this.input.once("pointerdown", land);
  }
}
