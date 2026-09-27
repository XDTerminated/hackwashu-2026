import Phaser from "phaser";
import * as net from "../net";
import { startMusic } from "../music";
import { Button, C, measure, ptext } from "../widgets";
import { introSeen } from "./IntroScene";
import { onStoreChange, store } from "../store";
import { LANDING_HOME, VISIT_ID } from "../visitparam";
import { fitLogo } from "../logoart";
import { flyTo, loadSocial } from "../multiplayer";

/**
 * The front door. Sign in with Google for a village that's kept (online, your
 * own private one), or play as a guest: a fresh colony that's never saved.
 * The intro plays the first time a player plays, and never again.
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super("Title");
  }

  /** Where the words end (the rockets fly below it, or above the logo). */
  private bottom = 0;

  create() {
    this.bottom = 0;
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = Math.round(W / 2);

    const g = this.add.graphics().setDepth(-3);
    g.fillStyle(0x0b0a1a, 1).fillRect(0, 0, W, H);
    const rnd = new Phaser.Math.RandomDataGenerator(["moon-village"]);
    for (let i = 0; i < Math.round((W * H) / 700); i++) {
      g.fillStyle(rnd.pick([0xffffff, 0xc8d2f0, 0x9aa8cc, 0xf5d7a8]), rnd.pick([0.35, 0.6, 1]));
      g.fillRect(rnd.between(0, W), rnd.between(0, H), 1, 1);
    }

    const earth = this.add.image(Math.round(W * 0.86), Math.round(H * 0.24), "earth_l");
    this.tweens.add({ targets: earth, y: earth.y - 3, duration: 3200, yoyo: true, repeat: -1, ease: "sine.inout" });

    // Now and then a rocket flies across (behind everything), nose first, with a flame trail:
    // sometimes close and quick, sometimes small and far off.
    const ship = this.add.image(-99, -99, "ship").setVisible(false).setDepth(-1);
    const flame = this.add.particles(0, 0, "spark", {
      lifespan: { min: 300, max: 600 },
      speed: { min: 4, max: 18 },
      alpha: { start: 1, end: 0 },
      tint: [0xffd27a, 0xff9a3d, 0xff6a4d, 0xfff2d6],
      frequency: 25,
      emitting: false,
    }).setDepth(-2);
    const flyBy = () => {
      const ltr = Math.random() < 0.5;
      const far = Math.random() < 0.4;
      const scale = far ? 0.5 : 1;
      const pad = 40;
      // (above the logo or below the buttons: never through the words)
      const half = 16 * scale;
      const zones = [
        [half + 4, Math.round(logo.y - logo.displayHeight / 2) - half - 4],
        [Math.max(y, this.bottom) + 24 + half, H - half - 4],
      ].filter(([a, b]) => b >= a);
      if (!zones.length) return void this.time.delayedCall(5000, flyBy);
      const [lo, hi] = Phaser.Utils.Array.GetRandom(zones);
      const y0 = Phaser.Math.Between(lo, hi);
      const y1 = Phaser.Math.Clamp(y0 + Phaser.Math.Between(-24, 12), lo, hi);
      // (drawn nose up: a quarter turn points it the way it's going)
      ship.setScale(scale).setAlpha(far ? 0.7 : 1).setAngle(ltr ? 90 : -90).setPosition(ltr ? -pad : W + pad, y0).setVisible(true);
      flame.setAlpha(far ? 0.7 : 1).setParticleScale(scale).start();
      const tail = () => flame.setPosition(ship.x + (ltr ? -1 : 1) * (ship.height / 2) * scale, ship.y);
      tail();
      this.tweens.add({
        targets: ship,
        x: ltr ? W + pad : -pad,
        y: y1,
        duration: Math.round(((W + pad * 2) / (far ? 45 : 110)) * 1000),
        ease: "linear",
        onUpdate: tail,
        onComplete: () => {
          ship.setVisible(false);
          flame.stop();
          this.time.delayedCall(Phaser.Math.Between(3000, 9000), flyBy);
        },
      });
    };
    this.time.delayedCall(Phaser.Math.Between(800, 2500), flyBy);

    // (the logo has its own star, in MOON; on a narrow screen it drops to 1x)
    const logo = this.add.image(cx, 0, "logo");
    fitLogo(logo, W);
    logo.setY(Math.max(Math.round(H * 0.3), Math.round(logo.displayHeight / 2) + 16));

    const fine = ptext(this, 0, H - 12, "*terms and conditions apply", 0x555c78);
    fine.setX(W - 6 - measure(fine).w);
    /** A little text link (privacy). */
    const link = (x: number, y: number, text: string, act: () => void) => {
      const t = ptext(this, x, y, text, 0x8a8fa8).setInteractive({ useHandCursor: true });
      t.on("pointerover", () => t.setTint(0xf5c542)).on("pointerout", () => t.setTint(0x8a8fa8)).on("pointerdown", (_p: unknown, _x: number, _y: number, e: Phaser.Types.Input.EventData) => (e.stopPropagation(), act()));
      return t;
    };

    // ---------------------------------------------------------------- under the logo
    // Just a welcome, a line about it, and the buttons, stacked down the middle.
    const auth = net.auth;
    // (on a narrow screen the Earth would sit on top of the logo)
    const narrow = W < logo.displayWidth + 120;
    earth.setVisible(!narrow);
    let y = Math.round(logo.y + logo.displayHeight / 2) + 20;
    // (the welcome and the big button at the logo's own pixel size, where there's room)
    const big = logo.scale === 1 ? 2 : 1;
    const line = (text: string, color: number, font: "px" | "pxb" | "sm", gap: number, scale = 1, wide = 260) => {
      const t = ptext(this, 0, y, text, color, font).setMaxWidth(Math.min(W - 24, wide)).setCenterAlign().setScale(scale);
      t.setX(cx - Math.round((measure(t).w * scale) / 2));
      y += measure(t).h * scale + gap;
      return t;
    };
    const heading = (text: string) => line(text, 0xf4ecd8, "pxb", 6, big, logo.displayWidth);
    const detail = (text: string) => line(text, 0x8a8fa8, "sm", 4);
    /** The buttons, top down; the first is the big one. */
    const buttons = (specs: { label: string; act: () => void; main?: boolean }[]) => {
      y += 10;
      for (const s of specs) {
        const scale = s.main ? big : 1;
        const b = new Button(this, 0, y, s.label, s.main ? C.greenBtn : C.woodMid, s.act, Math.min(s.main ? 180 : 110, W - 24) / scale).setScale(scale);
        // (like the logo: white with a lavender underside, gold under the pointer; the others quieter)
        b.setLook(s.main ? { fill: 0xf4f1ff, edge: 0xc9cfee, text: 0x1a1830, hoverFill: 0xf5d77a, hoverEdge: 0xc99a3a } : { fill: 0x2a2748, edge: 0x1a1830, text: 0xc9cfee, hoverFill: 0x3a3660, hoverEdge: 0x24203e });
        b.setX(cx - Math.round((b.width_ * scale) / 2));
        this.add.existing(b);
        y += 15 * scale + 5;
      }
    };
    const below = (text: string, color = 0x8a8fa8) => {
      const t = ptext(this, 0, y + 6, text, color).setMaxWidth(W - 24).setCenterAlign();
      t.setX(cx - Math.round(measure(t).w / 2));
      y += 6 + measure(t).h;
    };

    if (auth.state === "checking") {
      heading("Checking who you are...");
      const off = net.onAuth(() => this.scene.restart());
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => off());
      return;
    }

    // Online, signed out: sign in first (your own private village).
    if (auth.state === "out") {
      heading("Welcome, traveler");
      detail("Sign in for your own private village, kept safe. Or look around as a guest (nothing is saved).");
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
      heading(VISIT_ID ? "Flying to your friend's island..." : "Reaching the Moon...");
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
    // Off to a friend's island (the rocket), or back home: straight there, no title.
    if ((VISIT_ID || LANDING_HOME) && auth.state === "in") {
      heading("Landing...");
      this.time.delayedCall(200, play);
      return;
    }
    if (auth.state === "in" && auth.guest) {
      // Online, as a guest: a village of your own until you leave, never saved.
      heading("Playing as a guest");
      detail("Nothing you do is saved. Sign in with Google to keep a village of your own.");
      buttons([{ label: "PLAY", act: play, main: true }, { label: "SIGN IN WITH GOOGLE", act: () => net.signIn() }]);
      link(6, H - 12, "privacy", () => window.open("/privacy", "_blank", "noopener"));
    } else if (auth.state === "in") {
      heading(`Welcome back, ${(auth.name || auth.email.split("@")[0]).split(" ")[0]}!`);
      detail(auth.email);
      buttons([{ label: "PLAY", act: play, main: true }]);
      const out = link(6, H - 12, "sign out", () => net.signOut());
      link(out.x + measure(out).w + 10, H - 12, "privacy", () => window.open("/privacy", "_blank", "noopener"));
    } else {
      // On your own computer: sign in with Google (just your name and email) and play your
      // saved colony, or sign in as a guest: a fresh colony, and nothing gets saved.
      const me = store.connections.me;
      if (me) {
        heading(`Welcome back, ${me.name.split(" ")[0]}!`);
        detail(me.email);
        buttons([{ label: "PLAY", act: () => enter(false), main: true }]);
        link(6, H - 12, "sign out", () => net.send({ type: "forget_me" }));
      } else {
        heading("Welcome, traveler");
        detail("Sign in with Google to keep your colony (just your name and email). As a guest, nothing is saved.");
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
    below(auth.note || (auth.state === "local" && !store.connections.me ? "SPACE or ENTER to play as a guest" : "SPACE or ENTER to play"), auth.note ? 0xf2a3b8 : 0x8a8fa8);
    for (const key of ["keydown-SPACE", "keydown-ENTER"]) this.input.keyboard!.once(key, go);
    // Your friends (online, signed in): who's around, and a click flies you to their island.
    if (auth.state === "in" && !auth.guest) this.friends(y + 16, cx, H, () => landing);
  }

  private async friends(top: number, cx: number, H: number, leaving: () => boolean) {
    const s = await loadSocial().catch(() => null);
    if (!s || !this.sys.isActive() || leaving()) return;
    let y = top;
    const centered = (text: string, color: number, font: "px" | "pxb" | "sm", gap: number) => {
      const t = ptext(this, 0, y, text, color, font);
      t.setX(cx - Math.round(measure(t).w / 2));
      y += measure(t).h + gap;
      return t;
    };
    centered("FRIENDS", 0x8a8fa8, "pxb", 5);
    if (!s.friends.length) {
      centered("No friends yet", 0x6a7090, "px", 3);
      centered(`Your friend code: ${s.code} (add friends from FRIENDS in the game)`, 0x555c78, "sm", 0);
    }
    // (who's on first; as many as fit above the corner links)
    const list = [...s.friends].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    const room = Math.max(1, Math.floor((H - 16 - y) / 11) - (s.incoming.length ? 1 : 0));
    const shown = list.length > room ? list.slice(0, room - 1) : list;
    for (const f of shown) {
      const t = ptext(this, 0, y, f.name.split(" ")[0], f.online ? 0xf4ecd8 : 0x8a8fa8).setInteractive({ useHandCursor: true });
      const tag = ptext(this, 0, y, f.online ? "on the Moon" : "away", f.online ? 0x7fd08a : 0x555c78, "sm");
      // (a dot, the name, and where they are, centered as one)
      const w = 6 + measure(t).w + 6 + measure(tag).w;
      const x = cx - Math.round(w / 2);
      this.add.rectangle(x, y + 2, 3, 3, f.online ? 0x5fd06a : 0x555c78).setOrigin(0);
      t.setX(x + 6);
      tag.setPosition(x + 6 + measure(t).w + 6, y + 1);
      t.on("pointerover", () => (t.setTint(0xf5c542), tag.setText("fly over?").setTint(0xf5c542)));
      t.on("pointerout", () => (t.setTint(f.online ? 0xf4ecd8 : 0x8a8fa8), tag.setText(f.online ? "on the Moon" : "away").setTint(f.online ? 0x7fd08a : 0x555c78)));
      t.on("pointerdown", () => flyTo(f.id));
      y += 11;
    }
    if (shown.length < list.length) centered(`+${list.length - shown.length} more (FRIENDS in the game)`, 0x555c78, "sm", 3);
    if (s.incoming.length) centered(`${s.incoming.length} friend request${s.incoming.length === 1 ? "" : "s"} waiting`, 0xf5c542, "sm", 0);
    this.bottom = y;
  }
}
