import Phaser from "phaser";
import * as net from "../net";
import { startMusic } from "../music";
import { Button, C, measure, ptext, woodFrame } from "../widgets";
import { introSeen } from "./IntroScene";
import { onStoreChange, store } from "../store";

// One line: the intro cutscene tells the story; the title just sets the mood.
const STORY = ["Every home you build brings back a line to Earth."];

/**
 * The front door. Sign in with Google for a village that's kept (online, your
 * own private one), or play as a guest: a fresh colony that's never saved.
 * The intro plays the first time a player plays, and never again.
 */
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

    const logo = this.add.image(cx + 8, 0, "logo");
    logo.setY(Math.max(Math.round(H * 0.16), Math.round(logo.height / 2) + 8));
    // (the spark sits beside the first, bigger line)
    const spark = this.add.image(Math.round(logo.x - logo.width / 2 - 20), Math.round(logo.y - logo.height / 2 + 18), "spark_logo");
    this.time.addEvent({ delay: 400, loop: true, callback: () => spark.setFlipX(!spark.flipX) });

    const sub = ptext(this, 0, Math.round(logo.y + logo.height / 2) + 5, "an AI agent viewer you can live in", 0x8a8fa8);
    sub.setX(cx - Math.round(measure(sub).w / 2));

    const story = ptext(this, 0, 0, STORY.join("\n"), 0xe8e4d8).setCenterAlign();
    const sm = measure(story);
    story.setPosition(cx - Math.round(sm.w / 2), Math.round(sub.y + 20));

    const fine = ptext(this, 0, H - 12, "*terms and conditions apply", 0x555c78);
    fine.setX(W - 6 - measure(fine).w);
    /** A little text link (privacy). */
    const link = (x: number, y: number, text: string, act: () => void) => {
      const t = ptext(this, x, y, text, 0x8a8fa8).setInteractive({ useHandCursor: true });
      t.on("pointerover", () => t.setTint(0xf5c542)).on("pointerout", () => t.setTint(0x8a8fa8)).on("pointerdown", (_p: unknown, _x: number, _y: number, e: Phaser.Types.Input.EventData) => (e.stopPropagation(), act()));
      return t;
    };

    // ---------------------------------------------------------------- the panel
    const auth = net.auth;
    const panelW = Math.min(W - 24, 250);
    const px = cx - Math.round(panelW / 2);
    const py = Math.round(story.y + sm.h + 12);
    const panelH = Math.min(H - py - 22, 104);
    woodFrame(this.add.graphics(), px, py, panelW, panelH, C.paper);
    const inside = (y: number, text: string, color: number, font: "px" | "pxb" | "sm" = "px") => {
      const t = ptext(this, 0, py + y, text, color, font).setMaxWidth(panelW - 24).setCenterAlign();
      t.setX(cx - Math.round(measure(t).w / 2));
      return t;
    };
    /** The panel's buttons, from the bottom up; the first is the big one. */
    const buttons = (specs: { label: string; act: () => void; main?: boolean }[]) => {
      let y = py + panelH - 8 - specs.length * 19;
      for (const s of specs) {
        const b = new Button(this, 0, y, s.label, s.main ? C.greenBtn : C.woodMid, s.act, s.main ? 150 : 110);
        b.setX(cx - Math.round(b.width_ / 2));
        this.add.existing(b);
        y += 19;
      }
    };
    const below = (text: string, color = 0x8a8fa8) => {
      const t = ptext(this, 0, py + panelH + 7, text, color);
      t.setX(cx - Math.round(measure(t).w / 2));
    };

    if (auth.state === "checking") {
      inside(Math.round(panelH / 2) - 5, "Checking who you are...", C.inkSoft, "pxb");
      const off = net.onAuth(() => this.scene.restart());
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => off());
      return;
    }

    // Online, signed out: sign in first (your own private village).
    if (auth.state === "out") {
      inside(9, "WELCOME, TRAVELER", C.coral, "pxb");
      inside(22, "Sign in for your own private village, kept safe. Or look around as a guest (nothing is saved).", C.inkSoft, "sm");
      buttons([
        { label: "SIGN IN WITH GOOGLE", act: () => net.signIn(), main: true },
        { label: "SIGN IN AS GUEST", act: () => net.playAsGuest() },
        // (a test server lets you sign in as anyone, to try out several accounts)
        ...(auth.devLogin
          ? [
              {
                label: "TEST PLAYER",
                act: () => {
                  const email = window.prompt("Sign in as (any email, for testing):", "tester@example.com");
                  if (email?.trim()) location.href = `/auth/dev?email=${encodeURIComponent(email.trim())}`;
                },
              },
            ]
          : []),
      ]);
      below(auth.note || "SPACE or ENTER to sign in", auth.note ? 0xf2a3b8 : 0x8a8fa8);
      link(6, H - 12, "privacy", () => window.open("/privacy", "_blank", "noopener"));
      for (const key of ["keydown-SPACE", "keydown-ENTER"]) this.input.keyboard!.once(key, () => net.signIn());
      return;
    }

    // Signed in (online), or on your own computer: play. (Wait for the colony first: it knows
    // whether this player has seen the intro, which only plays their first time.)
    if (!store.connected) {
      inside(Math.round(panelH / 2) - 5, "Reaching the Moon...", C.inkSoft, "pxb");
      const off = onStoreChange(() => store.connected && this.scene.restart());
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => off());
      return;
    }
    let landing = false;
    const play = () => {
      if (landing) return;
      landing = true;
      startMusic();
      // First time on this account: the story of how you got here, then the game.
      const first = !introSeen();
      this.cameras.main.fadeOut(400, first ? 7 : 11, first ? 6 : 10, first ? 15 : 26);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        if (first) return void this.scene.start("Intro");
        this.scene.start("Game");
        this.scene.launch("UI");
      });
    };
    /** On your own computer: into the guest colony (in memory only) or your saved one, then play. */
    const enter = (guest: boolean) => {
      if (landing) return;
      if (store.guest === guest) return play();
      net.localGuest(guest);
      const off = onStoreChange(() => {
        if (store.guest !== guest) return;
        off();
        play();
      });
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => off());
    };
    if (auth.state === "in" && auth.guest) {
      // Online, as a guest: a village of your own until you leave, never saved.
      inside(9, "PLAYING AS A GUEST", C.coral, "pxb");
      inside(22, "Nothing you do is saved. Sign in with Google to keep a village of your own.", C.inkSoft, "sm");
      buttons([{ label: "PLAY", act: play, main: true }, { label: "SIGN IN WITH GOOGLE", act: () => net.signIn() }]);
      link(6, H - 12, "privacy", () => window.open("/privacy", "_blank", "noopener"));
    } else if (auth.state === "in") {
      inside(9, `WELCOME BACK, ${(auth.name || auth.email.split("@")[0]).toUpperCase()}`, C.coral, "pxb");
      inside(22, auth.email, C.inkSoft, "sm");
      buttons([{ label: "PLAY", act: play, main: true }, { label: "SIGN OUT", act: () => net.signOut() }]);
      link(6, H - 12, "privacy", () => window.open("/privacy", "_blank", "noopener"));
    } else {
      // On your own computer: sign in with Google (just your name and email) and play your
      // saved colony, or sign in as a guest: a fresh colony, and nothing gets saved.
      const me = store.connections.me;
      if (me) {
        inside(9, `WELCOME BACK, ${me.name.split(" ")[0].toUpperCase()}`, C.coral, "pxb");
        inside(22, me.email, C.inkSoft, "sm");
        buttons([{ label: "PLAY", act: () => enter(false), main: true }]);
        link(6, H - 12, "sign out", () => net.send({ type: "forget_me" }));
      } else {
        inside(9, "WELCOME, TRAVELER", C.coral, "pxb");
        inside(22, "Sign in with Google to keep your colony (just your name and email). As a guest, nothing is saved.", C.inkSoft, "sm");
        buttons([
          {
            label: "SIGN IN WITH GOOGLE",
            main: true,
            // (the title updates by itself once you're signed in)
            act: () => window.open(`${net.SERVER_HTTP}/signin/google`, "_blank"),
          },
          { label: "SIGN IN AS GUEST", act: () => enter(true) },
        ]);
      }
      let was = me?.email ?? "";
      const off = onStoreChange(() => {
        if ((store.connections.me?.email ?? "") !== was) {
          was = store.connections.me?.email ?? "";
          if (!landing) this.scene.restart();
        }
      });
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => off());
    }
    // (on your own computer, signed out: SPACE plays as a guest)
    const go = auth.state === "local" ? () => enter(!store.connections.me) : play;
    below(auth.state === "local" && !store.connections.me ? "SPACE or ENTER to play as a guest" : "SPACE or ENTER to play");
    for (const key of ["keydown-SPACE", "keydown-ENTER"]) this.input.keyboard!.once(key, go);
  }
}
