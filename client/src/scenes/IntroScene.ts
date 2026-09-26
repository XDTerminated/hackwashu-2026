import Phaser from "phaser";
import * as net from "../net";
import { puff } from "../actors";
import { sfx } from "../sfx";
import { C, Label, measure, ptext } from "../widgets";
import {
  SEATS,
  TABLE_H,
  TABLE_W,
  drawBigMoon,
  drawCeilingLamp,
  drawChair,
  drawCity,
  drawFlames,
  drawLaunchSite,
  drawMoonLanding,
  drawPhone,
  drawRoom,
  drawSign,
  drawStamp,
  drawTable,
  drawTicket,
  drawYouPortrait,
  seatX,
  tiny,
  type FamilyId,
} from "../cutart";
import { Cutscene, Fam, VOICE } from "./Cutscene";

export const INTRO_SEEN = "moon-intro-seen";

export function introSeen() {
  try {
    return localStorage.getItem(INTRO_SEEN) === "1";
  } catch {
    return true;
  }
}

/**
 * How you got here: a family dinner on Earth, one AI rant too many, a
 * family vote, a launch, three days of no signal, and a rabbit waiting on the
 * Moon. About a minute; SPACE hurries it along, ESC skips.
 */
export class IntroScene extends Cutscene {
  /** Where to go afterwards: into the game, or back to wherever it was replayed from. */
  private then: "game" | "back" = "game";

  constructor() {
    super("Intro");
  }

  /** Start partway through (for testing a single shot). */
  private from = 0;

  init(data: { then?: "game" | "back"; from?: number }) {
    this.then = data?.then ?? "game";
    this.from = data?.from ?? 0;
  }

  protected onEnd() {
    try {
      localStorage.setItem(INTRO_SEEN, "1");
    } catch {
      /* private mode: it'll just play again next time */
    }
    if (this.then === "back") {
      this.scene.stop();
      this.scene.wake("Game");
      this.scene.wake("UI");
      return;
    }
    this.scene.start("Game");
    this.scene.launch("UI");
  }

  protected async play() {
    if (!this.anims.exists("intro-flame")) {
      drawFlames(this);
      this.anims.create({ key: "intro-flame", frames: [0, 1, 2].map((f) => ({ key: `intro_flame_${f}` })), frameRate: 14, repeat: -1 });
    }
    await this.shots([this.shotCity, this.shotDinner, this.shotLaunch, this.shotSpace, this.shotLanding, this.shotTitle], this.from);
  }

  // ------------------------------------------------------------ 1. Earth, at night

  private async shotCity() {
    const { W, H } = this;
    const CH = H * 2;
    const city = drawCity(this, W, CH, H);
    this.keep(this.add.image(0, 0, city.key).setOrigin(0));
    const earth = this.keep(this.add.image(Math.round(W / 2), this.BAR + 34, this.bigText("EARTH")).setScrollFactor(0).setAlpha(0).setDepth(50));
    await this.wait(200);
    await this.tween({ targets: earth, alpha: 1, duration: 500 });
    await this.caption("A perfectly normal night on Earth.", 1100);
    this.tweens.add({ targets: earth, alpha: 0, duration: 500 });
    const pan = this.tween({ targets: this.cameras.main, scrollY: CH - H, duration: 2800, ease: "sine.inout" });
    await this.caption("And at one dinner table, somebody will not stop talking...", 0);
    await pan;
    await this.wait(300);
  }

  // ------------------------------------------------------------ 2. Dinner (and a vote)

  private async shotDinner() {
    const { W, H, BAR } = this;
    const floorY = Math.round(H * 0.8);
    const cx = Math.round(W / 2);
    const windowX = Math.max(60, cx - 160);
    const fam = {} as Record<FamilyId, Fam>;
    const tableTop = floorY + 12 - TABLE_H;
    const tx = cx - TABLE_W / 2;
    let steam = { x: 0, y: 0 };

    await this.cut(() => {
      this.keep(this.add.image(0, 0, drawRoom(this, W, H, floorY, BAR, windowX)).setOrigin(0));
      // the lamp over the table
      const lampY = Math.max(BAR + 24, tableTop - 64);
      const cord = this.keep(this.add.graphics());
      cord.fillStyle(0x3b2a3a, 1).fillRect(cx, BAR + 5, 1, lampY - BAR - 5);
      this.keep(this.add.image(cx, lampY + 30, "glow_l").setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd070).setAlpha(0.55));
      this.keep(this.add.image(cx, lampY, drawCeilingLamp(this)).setOrigin(0.5, 0));
      // chairs, the family, the table
      SEATS.forEach((id, i) => {
        const x = tx + seatX(i);
        this.keep(this.add.image(x, tableTop + 6, drawChair(this)).setOrigin(0.5, 0).setDepth(1));
        const f = new Fam(this, id, x, tableTop + 38);
        f.img.setDepth(2);
        this.keep(f.img);
        fam[id] = f;
      });
      this.keep(this.add.image(tx, tableTop, drawTable(this)).setOrigin(0).setDepth(3));
      this.keep(this.add.image(tx + seatX(2), tableTop + 6, "glow_l").setBlendMode(Phaser.BlendModes.ADD).setTint(0x6ab0ff).setAlpha(0.4).setDepth(4));
      steam = { x: tx + 186, y: tableTop + 16 };
      this.every(200, () => {
        const f = Object.values(fam)[Math.floor(Math.random() * 5)];
        if (Math.random() < 0.18) f.blink();
      });
      this.every(1300, () => puff(this, steam.x, steam.y));
    });
    const { you, mom, dad, grandma, sibling } = fam;
    const all = [grandma, dad, you, mom, sibling];

    you.set({ pose: "gesture", mouth: "smile" });
    mom.set({ mouth: "smile" });
    grandma.set({ pose: "sip" });
    await this.wait(200);
    you.set({ pose: "cheer" });
    await this.famSay(you, "...and it texts me back! It's basically a NEIGHBOR!");
    dad.set({ pose: "facepalm", mouth: "frown" });
    await this.famSay(dad, "Every. Single. Dinner.");
    you.set({ pose: "point", eyes: "up", mouth: "smile" });
    await this.famSay(you, "Okay but imagine a whole VILLAGE of them. On the MOON!");

    // Grandma, looking out at the moon
    grandma.set({ pose: "rest", eyes: "up", mouth: "closed" });
    you.set({ mouth: "closed" });
    await this.wait(300);
    await this.famSay(grandma, "...You know, there's plenty of room on the Moon.", 1100);
    this.clearCaption();
    // everyone turns to Grandma... then, slowly, to you
    for (const f of [dad, you, mom, sibling]) {
      f.set({ eyes: "left", mouth: "closed", pose: f === dad ? "rest" : f.pose });
      await this.wait(90);
    }
    you.set({ pose: "rest" });
    await this.wait(450);
    grandma.set({ eyes: "right", mouth: "smile" });
    dad.set({ eyes: "right" });
    mom.set({ eyes: "left" });
    sibling.set({ eyes: "left", mouth: "smile" });
    await this.wait(400);
    you.set({ eyes: "left" });
    await this.wait(250);
    you.set({ eyes: "right" });
    await this.wait(250);
    you.set({ eyes: "open", mouth: "open" });
    await this.famSay(you, "...What?", 500);

    // The vote.
    mom.set({ eyes: "open", mouth: "smile" });
    await this.famSay(mom, "All in favor of sending them to the Moon?", 700);
    for (const [f, pose] of [[dad, "raise"], [sibling, "cheer"], [grandma, "raise"], [mom, "raise"]] as const) {
      f.set({ pose, mouth: "smile", eyes: "open" });
      sfx.blip();
      await this.wait(200);
    }
    you.set({ pose: "shrug", mouth: "open" });
    await this.famSay(you, "WAIT-", 400);
    const vote = this.keep(this.add.image(cx, BAR + 26, this.bigText("4 TO 1", "#e08a6b")).setDepth(60));
    sfx.stamp();
    this.cameras.main.shake(160, 0.006);
    await this.wait(600);
    vote.destroy();
    for (const f of all) if (f !== you) f.set({ pose: "rest" });

    // The ticket.
    const dim = this.keep(this.add.rectangle(0, 0, W, H, 0x07060f, 0).setOrigin(0).setDepth(70));
    this.tweens.add({ targets: dim, fillAlpha: 0.6, duration: 400 });
    const ticket = this.keep(this.add.container(W + 100, Math.round(H / 2 - 51)).setDepth(71));
    ticket.add(this.add.image(0, 0, drawTicket(this)).setOrigin(0));
    const t = (x: number, y: number, s: string, color: number = C.ink, font: "px" | "pxb" = "px") => ticket.add(ptext(this, x, y, s, color, font));
    t(52, 4, "MOON LINES · BOARDING PASS", C.cream, "pxb");
    t(5, 4, "ADMIT 1", C.cream, "pxb");
    t(52, 24, "ONE-WAY TICKET", C.coral, "pxb");
    t(52, 40, "FROM:  Earth (the dinner table)");
    t(52, 51, "TO:  The Moon");
    t(52, 62, "LEAVES:  Tonight");
    t(52, 73, "RETURN:  ???");
    t(8, 56, "SEAT 1", C.inkSoft);
    sfx.whoosh();
    await this.tween({ targets: ticket, x: Math.round(W / 2 - 118), duration: 450, ease: "back.out" });
    await this.wait(500);
    const stamp = this.add.container(0, 0);
    stamp.add(this.add.image(0, 0, drawStamp(this)).setOrigin(0));
    const ok = ptext(this, 0, 8, "APPROVED", 0xc8403a, "pxb");
    ok.setX(Math.round((84 - measure(ok).w) / 2));
    stamp.add(ok);
    stamp.setPosition(144, 62).setAlpha(0);
    ticket.add(stamp);
    await this.wait(100);
    stamp.setAlpha(1).setY(58);
    await this.tween({ targets: stamp, y: 70, duration: 90, ease: "quad.in" });
    sfx.stamp();
    this.cameras.main.shake(200, 0.01);
    await this.caption("Some families argue at dinner. Yours held a vote.", 1200);
  }

  // ------------------------------------------------------------ 3. Launch

  private async shotLaunch() {
    const { W, H, BAR } = this;
    const groundY = Math.round(H * 0.8);
    const padX = Math.round(W * 0.6);
    let rocket!: Phaser.GameObjects.Image;
    let flame!: Phaser.GameObjects.Sprite;
    const folks: { f: Phaser.GameObjects.Image; id: FamilyId }[] = [];

    await this.cut(() => {
      this.keep(this.add.image(0, 0, drawLaunchSite(this, W, H, groundY, padX)).setOrigin(0));
      for (const lx of [padX - 70, padX + 70]) this.keep(this.add.image(lx, groundY - 44, "glow_l").setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff2c0).setAlpha(0.5));
      const beacon = this.keep(this.add.rectangle(padX + 29, groundY - 99, 2, 2, 0xff4040).setOrigin(0));
      this.every(500, () => beacon.setVisible(!beacon.visible));
      flame = this.keep(this.add.sprite(padX, groundY - 9, "intro_flame_0").setOrigin(0.5, 0).setVisible(false).setDepth(4));
      rocket = this.keep(this.add.image(padX, groundY - 4, "ship").setOrigin(0.5, 1).setDepth(5));
      const order: FamilyId[] = ["mom", "dad", "grandma", "sibling"];
      const fx = Math.max(20, padX - 170);
      order.forEach((id, i) => {
        const f = this.keep(this.add.image(fx + i * 16, groundY + 3, tiny(this, id, 0)).setOrigin(0.5, 1).setDepth(6));
        folks.push({ f, id });
      });
      // a banner
      const bx = fx + 8;
      const by = groundY - 36;
      const g = this.keep(this.add.graphics().setDepth(5));
      g.fillStyle(0x6a4a30, 1).fillRect(bx, by, 1, 22).fillRect(bx + 32, by, 1, 22);
      g.fillStyle(0x3b2a3a, 1).fillRect(bx, by - 1, 33, 12);
      g.fillStyle(0xfff2d6, 1).fillRect(bx + 1, by, 31, 10);
      const bye = this.keep(ptext(this, 0, by + 2, "BYE!!", 0xc8403a, "pxb").setDepth(6));
      bye.setX(bx + 17 - Math.round(measure(bye).w / 2));
      let k = 0;
      this.every(260, () => {
        k++;
        folks.forEach(({ f, id }, i) => f.setTexture(tiny(this, id, (k + i) % 2 === 0 ? 1 : 0)));
      });
    });

    await this.caption("That same night.", 900);
    const who = (id: FamilyId) => folks.find((p) => p.id === id)!.f;
    await this.say(who("sibling").x, who("sibling").y - 22, "Bring me a moon rock!!", VOICE.sibling, undefined, 1000);
    await this.say(who("dad").x, who("dad").y - 22, "And be nice to the aliens!", VOICE.dad, undefined, 1000);
    this.clearCaption();

    for (const n of ["3", "2", "1"]) {
      const img = this.keep(this.add.image(Math.round(W / 2), BAR + 30, this.bigText(n)).setDepth(60));
      sfx.tick();
      if (n === "1") flame.setVisible(true).play("intro-flame");
      await this.wait(550);
      img.destroy();
    }
    const lift = this.keep(this.add.image(Math.round(W / 2), BAR + 30, this.bigText("LIFTOFF!", "#e08a6b")).setDepth(60));
    sfx.go();
    sfx.rumble(4);
    this.cameras.main.shake(3200, 0.004);
    const smoke = this.every(40, () => {
      for (let i = 0; i < 2; i++) puff(this, padX + Phaser.Math.Between(-40, 40), groundY - Phaser.Math.Between(0, 6));
    });
    const jiggle = this.every(50, () => (rocket.x = padX + (rocket.x === padX ? 1 : 0)));
    await this.wait(600);
    jiggle.remove();
    rocket.x = padX;
    const up = this.tween({
      targets: rocket,
      y: -40,
      duration: 2000,
      ease: "quad.in",
      onUpdate: () => flame.setPosition(rocket.x, rocket.y - 5),
    });
    await this.wait(1000);
    lift.destroy();
    smoke.remove();
    await up;
    await this.wait(200);
  }

  // ------------------------------------------------------------ 4. Three days of nothing

  private async shotSpace() {
    const { W, H } = this;
    let rocket!: Phaser.GameObjects.Image;
    let flame!: Phaser.GameObjects.Sprite;
    let earth!: Phaser.GameObjects.Image;
    let moon!: Phaser.GameObjects.Image;
    const stars = Array.from({ length: 90 }, (_, i) => ({ x: Math.floor(Math.random() * W), y: Math.random() * H, v: 30 + (i % 6) * 55, c: i % 7 === 0 ? 0xf5d7a8 : 0xe8e4ff }));

    await this.cut(() => {
      const g = this.keep(this.add.graphics());
      const draw = () => {
        g.clear();
        for (const s of stars) {
          const len = Math.max(1, Math.round(s.v / 60));
          g.fillStyle(s.c, s.v > 200 ? 1 : 0.6).fillRect(s.x, Math.round(s.y), 1, len);
        }
      };
      this.every(16, () => {
        for (const s of stars) {
          s.y += (s.v * 16) / 1000;
          if (s.y > H) {
            s.y = -6;
            s.x = Math.floor(Math.random() * W);
          }
        }
        draw();
      });
      earth = this.keep(this.add.image(Math.round(W * 0.28), Math.round(H * 0.62), "earth_l"));
      moon = this.keep(this.add.image(Math.round(W / 2), -100, drawBigMoon(this)));
      flame = this.keep(this.add.sprite(Math.round(W / 2), 0, "intro_flame_0").setOrigin(0.5, 0).play("intro-flame"));
      rocket = this.keep(this.add.image(Math.round(W / 2), Math.round(H * 0.55), "ship").setOrigin(0.5, 1));
      flame.setY(rocket.y - 5);
      this.tweens.add({ targets: [rocket, flame], y: "-=2", duration: 900, yoyo: true, repeat: -1, ease: "sine.inout" });
      this.tweens.add({ targets: earth, y: H + 60, duration: 9000 });
    });

    await this.caption("Day 1.", 700);
    await this.caption("Day 2. The snacks ran out.", 1100);
    await this.caption("Day 3. The Wi-Fi ran out.", 700);

    // the phone
    const px = Math.min(W - 50, Math.round(W / 2 + 110));
    const phone = this.keep(this.add.container(px, H + 80).setDepth(100));
    phone.add(this.add.image(0, 0, drawPhone(this)));
    const name = ptext(this, -35, -52, "Family ♥", C.cream, "pxb");
    const bars = this.add.graphics();
    const setBars = (n: number) => {
      bars.clear();
      for (let i = 0; i < 4; i++) bars.fillStyle(i < n ? 0xfff6e6 : 0xb85c3e, 1).fillRect(20 + i * 3, -46 - i * 2, 2, 3 + i * 2);
    };
    setBars(2);
    phone.add([name, bars]);
    await this.tween({ targets: phone, y: Math.round(H / 2), duration: 400, ease: "back.out" });
    const bubble = (y: number, s: string) => {
      const l = new Label(this, 34, y, s, { bg: 0xd97757, border: C.outline, color: C.cream, maxWidth: 52, originX: 1, originY: 0, align: "left" });
      phone.add(l);
      sfx.message();
      return l;
    };
    const b1 = bubble(-36, "you guys were joking right??");
    await this.wait(500);
    for (const n of [1, 0]) {
      setBars(n);
      sfx.tick();
      await this.wait(300);
    }
    bars.clear();
    phone.add(ptext(this, -34, b1.y + b1.boxH + 2, "! Not Delivered", 0xc8403a));
    sfx.deny();
    await this.wait(600);
    const b2 = bubble(b1.y + b1.boxH + 13, "...guys?");
    await this.wait(400);
    phone.add(ptext(this, -34, b2.y + b2.boxH + 2, "! Not Delivered", 0xc8403a));
    sfx.deny();
    await this.waitOrNext(1100);
    await this.tween({ targets: phone, y: H + 90, duration: 350, ease: "quad.in" });

    await this.caption("Day 4.", 0);
    await this.tween({ targets: moon, y: Math.round(H * 0.28), duration: 1800, ease: "sine.out" });
    await this.wait(300);
  }

  // ------------------------------------------------------------ 5. The Moon, and a rabbit

  private async shotLanding() {
    const { W, H, BAR } = this;
    const horizon = Math.round(H * 0.5);
    const ground = Math.round(H * 0.64);
    const cx = Math.round(W / 2);
    const lx = cx - 50;
    const burrowX = cx + 120;
    let rocket!: Phaser.GameObjects.Image;
    let flame!: Phaser.GameObjects.Sprite;

    await this.cut(() => {
      this.keep(this.add.image(0, 0, drawMoonLanding(this, W, H, horizon)).setOrigin(0));
      this.keep(this.add.image(Math.round(W * 0.2), Math.max(BAR + 30, horizon - 64), "earth_l"));
      const at = (x: number, y: number, key: string) => this.keep(this.add.image(x, y, key).setOrigin(0.5, 1).setDepth(y));
      this.keep(this.add.image(burrowX, ground - 30, "glow_l").setBlendMode(Phaser.BlendModes.ADD).setTint(0xffc070).setAlpha(0.4).setDepth(ground - 1));
      at(burrowX, ground, "b_rabbit_burrow");
      at(cx - 190, ground - 20, "rock_crystal");
      at(cx + 230, horizon + 20, "rock_spire");
      at(cx - 110, ground + 18, "rock_big_1");
      at(cx + 30, ground + 22, "rock_small_2");
      at(cx - 250, horizon + 22, "rock_big_0");
      const sx = cx - 150;
      at(sx, ground + 10, drawSign(this));
      const l1 = this.keep(ptext(this, 0, ground + 10 - 34, "MOON VILLAGE", C.ink, "pxb").setDepth(ground + 11));
      l1.setX(sx - Math.round(measure(l1).w / 2));
      const l2 = this.keep(ptext(this, 0, ground + 10 - 25, "pop. 2 (and you)", C.inkSoft).setDepth(ground + 11));
      l2.setX(sx - Math.round(measure(l2).w / 2));
      flame = this.keep(this.add.sprite(lx, -60, "intro_flame_0").setOrigin(0.5, 0).play("intro-flame").setDepth(ground - 2));
      rocket = this.keep(this.add.image(lx, -60, "ship").setOrigin(0.5, 1).setDepth(ground - 1));
    });

    sfx.rumble(3);
    const down = this.tween({ targets: rocket, y: ground, duration: 2200, ease: "cubic.out", onUpdate: () => flame.setPosition(rocket.x, rocket.y - 5) });
    await this.wait(1600);
    for (let i = 0; i < 18; i++) this.time.delayedCall(i * 30, () => puff(this, lx + Phaser.Math.Between(-34, 34), ground - Phaser.Math.Between(0, 4)));
    await down;
    flame.setVisible(false);
    sfx.land();
    this.cameras.main.shake(260, 0.006);
    await this.caption("The Moon. Population: one rabbit, one stargazer.", 1100);
    this.clearCaption();

    // Someone's home.
    const rabbit = this.keep(this.add.sprite(burrowX, ground - 2, "rabbit_0").setOrigin(0.5, 1).setAlpha(0).setDepth(ground + 5).play("jade_rabbit-idle"));
    await this.tween({ targets: rabbit, alpha: 1, duration: 300 });
    const bang = this.keep(this.add.image(burrowX, ground - 28, "bang").setDepth(ground + 6));
    sfx.catch();
    await this.wait(450);
    bang.destroy();
    const astro = this.keep(this.add.sprite(lx + 4, ground, "astro_6").setOrigin(0.5, 1).setAlpha(0).setDepth(ground + 4));
    await this.tween({ targets: astro, alpha: 1, duration: 300 });
    astro.play("walk-side");
    const walk = this.tween({ targets: astro, x: lx + 34, duration: 900 });
    const target = lx + 74;
    const hops = 4;
    const step = (target - burrowX) / hops;
    for (let i = 0; i < hops; i++) {
      sfx.hop();
      await this.tween({ targets: rabbit, x: rabbit.x + step, duration: 280 });
      this.tweens.add({ targets: rabbit, y: ground - 8, duration: 140, yoyo: true, ease: "quad.out" });
    }
    await walk;
    astro.stop().setTexture("astro_6");
    rabbit.y = ground - 2;

    const YUTU: [string, string, string] = ["portrait_jade_rabbit_0", "portrait_jade_rabbit_1", "portrait_jade_rabbit_2"];
    const YOU: [string, string, string] = [drawYouPortrait(this, 0), drawYouPortrait(this, 0), drawYouPortrait(this, 1)];
    const yutu = (s: string) => this.dialog(YUTU, "Yutu the Jade Rabbit", s, VOICE.yutu);
    const you = (s: string) => this.dialog(YOU, "You", s, VOICE.you);
    await yutu("A visitor! It's been AGES since anybody landed here.");
    await you("Hi! Um... is there Wi-Fi?");
    await yutu("Hee! Not since the old colony left. Fix up the old homes and new neighbors will move in. Fair warning: they're AI agents.");
    this.tweens.add({ targets: astro, y: ground - 8, duration: 160, yoyo: true, repeat: 2, ease: "quad.out" });
    sfx.buy();
    await you("This is the BEST DAY OF MY LIFE.");
    await yutu("Hee! Then welcome to Moon Village. Let's get you a line home!");
  }

  // ------------------------------------------------------------ 6. Title

  private async shotTitle() {
    const { W, H } = this;
    const dim = this.keep(this.add.rectangle(0, 0, W, H, 0x07060f, 0).setOrigin(0).setDepth(800));
    await this.tween({ targets: dim, fillAlpha: 0.7, duration: 500 });
    const logo = this.keep(this.add.image(Math.round(W / 2) + 8, Math.round(H / 2 - 16), "logo").setAlpha(0).setDepth(801));
    const spark = this.keep(this.add.image(Math.round(logo.x - logo.width / 2 - 20), logo.y + 1, "spark_logo").setAlpha(0).setDepth(801));
    this.every(400, () => spark.setFlipX(!spark.flipX));
    sfx.bell();
    await this.tween({ targets: [logo, spark], alpha: 1, duration: 600 });
    const ch = this.keep(ptext(this, 0, logo.y + 26, "CHAPTER 1:  A LINE HOME", 0xf5c542, "pxb").setDepth(801));
    ch.setX(Math.round(W / 2 - measure(ch).w / 2));
    await this.waitOrNext(1500);
  }
}
