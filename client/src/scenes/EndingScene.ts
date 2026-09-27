import Phaser from "phaser";
import { VILLAGER_NAMES, type VillagerId } from "../../../shared/game";
import { sfx } from "../sfx";
import { C, measure, ptext } from "../widgets";
import {
  SEATS,
  TABLE_H,
  TABLE_W,
  drawCeilingLamp,
  drawChair,
  drawMoonLanding,
  drawPhone,
  drawRoom,
  drawTable,
  drawYouPortrait,
  seatX,
  type FamilyId,
} from "../cutart";
import { Cutscene, Fam, VOICE } from "./Cutscene";

const SPRITE: Record<VillagerId, string> = { jade_rabbit: "rabbit", postmaster: "postmaster", timekeeper: "timekeeper", stargazer: "stargazer", scholar: "scholar", manager: "office_lead", dj: "dj" };
const PITCH: Record<VillagerId, number> = { jade_rabbit: 980, postmaster: 360, timekeeper: 620, stargazer: 820, scholar: 700, manager: 760, dj: 540 };

/**
 * The finale: a night on the Moon with every neighbor home, and
 * then the call that finally goes through.
 */
export class EndingScene extends Cutscene {
  constructor() {
    super("Ending");
  }

  protected onEnd() {
    this.scene.stop();
    this.scene.wake("Game");
    this.scene.wake("UI");
  }

  private from = 0;

  init(data: { from?: number }) {
    this.from = data?.from ?? 0;
  }

  protected async play() {
    await this.shots([this.shotParty, this.shotCall, this.shotFireworks], this.from);
  }

  /** Fireworks bursting over the colony, until the cut. */
  private fireworks(skyBottom: number) {
    const { W } = this;
    const colors = [0xf5c542, 0xf2a3b8, 0x8ff0f0, 0xb7a4f0, 0x9ae0a8];
    this.every(700, () => {
      const x = Phaser.Math.Between(24, W - 24);
      const y = Phaser.Math.Between(this.BAR + 20, Math.max(this.BAR + 30, skyBottom - 40));
      const tint = colors[Phaser.Math.Between(0, colors.length - 1)];
      const flash = this.keep(this.add.image(x, y, "glow_l").setBlendMode(Phaser.BlendModes.ADD).setTint(tint).setAlpha(0.7).setDepth(1));
      this.tweens.add({ targets: flash, alpha: 0, duration: 900, onComplete: () => flash.destroy() });
      const burst = this.keep(this.add.particles(x, y, "spark", { speed: { min: 30, max: 90 }, lifespan: 900, gravityY: 40, alpha: { start: 1, end: 0 }, tint, emitting: false }).setDepth(2));
      burst.explode(22);
      this.time.delayedCall(1100, () => burst.destroy());
      sfx.hop();
    });
  }

  // ------------------------------------------------------------ everyone home

  private async shotParty() {
    const { W, H } = this;
    const horizon = Math.round(H * 0.5);
    const ground = Math.round(H * 0.64);
    const cx = Math.round(W / 2);
    const cast: VillagerId[] = ["jade_rabbit", "postmaster", "timekeeper", "stargazer", "scholar"];

    await this.cut(() => {
      this.keep(this.add.image(0, 0, drawMoonLanding(this, W, H, horizon)).setOrigin(0));
      this.keep(this.add.image(Math.round(W * 0.78), Math.max(this.BAR + 34, horizon - 70), "glow_l").setBlendMode(Phaser.BlendModes.ADD).setTint(0x6a9cf0).setAlpha(0.5));
      this.keep(this.add.image(Math.round(W * 0.78), Math.max(this.BAR + 34, horizon - 70), "earth_l"));
      this.fireworks(horizon);
      const row = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
      this.keep(this.add.sprite(cx + row[0] * 34, ground, "astro_0").setOrigin(0.5, 1).setDepth(ground));
      cast.forEach((v, i) => {
        this.keep(this.add.sprite(cx + row[i + 1] * 34, ground, `${SPRITE[v]}_0`).setOrigin(0.5, 1).setDepth(ground).play(`${v}-idle`));
      });
    });

    await this.caption("A few weeks later.", 1400);
    await this.caption("Every neighbor is home. The colony throws a party.", 1500);
    this.clearCaption();
    const talk = (v: VillagerId, s: string) => this.dialog([`portrait_${v}_0`, `portrait_${v}_1`, `portrait_${v}_2`], VILLAGER_NAMES[v], s, PITCH[v]);
    await talk("jade_rabbit", "Look at them all! Every line home is open. I told you they'd come.");
    await talk("postmaster", "Hoo! The mail's never been faster. And Earth is writing back.");
    await talk("timekeeper", "Tick. Right on schedule. Well. Nearly.");
    await talk("scholar", "I've catalogued four thousand moon rocks. Also, your essay is due Tuesday.");
    await talk("stargazer", "Look up! That little light on Earth? Somebody's porch, waiting for you.");

    // the phone buzzes
    const phone = this.keep(this.add.container(cx, H + 80).setDepth(700));
    phone.add(this.add.image(0, 0, drawPhone(this)));
    const name = ptext(this, -35, -52, "Family ♥", C.cream, "pxb");
    const bars = this.add.graphics();
    for (let i = 0; i < 4; i++) bars.fillStyle(0xfff6e6, 1).fillRect(20 + i * 3, -46 - i * 2, 2, 3 + i * 2);
    const incoming = ptext(this, 0, -20, "Incoming\nvideo call...", C.ink, "pxb").setCenterAlign();
    incoming.setX(-Math.round(measure(incoming).w / 2));
    const answer = this.add.graphics();
    answer.fillStyle(C.outline, 1).fillRect(-24, 22, 48, 16);
    answer.fillStyle(0x5aa860, 1).fillRect(-23, 23, 46, 14);
    const ans = ptext(this, 0, 27, "ANSWER", C.cream, "pxb");
    ans.setX(-Math.round(measure(ans).w / 2));
    phone.add([name, bars, incoming, answer, ans]);
    await this.tween({ targets: phone, y: Math.round(H / 2), duration: 500, ease: "back.out" });
    const ring = this.every(900, () => {
      sfx.bell();
      this.tweens.add({ targets: phone, x: cx + 2, duration: 40, yoyo: true, repeat: 3 });
    });
    sfx.bell();
    await this.caption("Four bars of signal. For the first time since you left.", 1400);
    ring.remove();
    sfx.message();
  }

  // ------------------------------------------------------------ The call

  private async shotCall() {
    const { W, H, BAR } = this;
    const floorY = Math.round(H * 0.8);
    const cx = Math.round(W / 2);
    const fam = {} as Record<FamilyId, Fam>;
    const tableTop = floorY + 12 - TABLE_H;
    const tx = cx - TABLE_W / 2;
    let pip!: Phaser.GameObjects.Image;

    await this.cut(() => {
      this.keep(this.add.image(0, 0, drawRoom(this, W, H, floorY, BAR, Math.max(60, cx - 160))).setOrigin(0));
      const lampY = Math.max(BAR + 24, tableTop - 64);
      const cord = this.keep(this.add.graphics());
      cord.fillStyle(0x3b2a3a, 1).fillRect(cx, BAR + 5, 1, lampY - BAR - 5);
      this.keep(this.add.image(cx, lampY + 30, "glow_l").setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd070).setAlpha(0.55));
      this.keep(this.add.image(cx, lampY, drawCeilingLamp(this)).setOrigin(0.5, 0));
      SEATS.forEach((id, i) => {
        const x = tx + seatX(i);
        this.keep(this.add.image(x, tableTop + 6, drawChair(this)).setOrigin(0.5, 0).setDepth(1));
        const f = new Fam(this, id, x, tableTop + 38);
        f.img.setDepth(2);
        this.keep(f.img);
        fam[id] = f;
      });
      // your seat is empty, but the laptop is on: that's you, on the call
      fam.you.img.setVisible(false);
      this.keep(this.add.image(tx, tableTop, drawTable(this)).setOrigin(0).setDepth(3));

      // the video-call frame around it all
      const ui = this.keep(this.add.graphics().setDepth(600));
      ui.fillStyle(0x07060f, 1).fillRect(0, BAR, W, 3).fillRect(0, H - BAR - 3, W, 3).fillRect(0, BAR, 3, H - BAR * 2).fillRect(W - 3, BAR, 3, H - BAR * 2);
      const live = this.keep(ptext(this, 15, BAR + 9, "LIVE  ·  Family ♥  ·  384,400 km away", C.cream, "pxb").setDepth(601));
      ui.fillStyle(0x07060f, 0.75).fillRect(5, BAR + 5, measure(live).w + 16, 15);
      ui.fillStyle(0xd8403a, 1).fillRect(9, BAR + 10, 4, 4);
      for (let i = 0; i < 4; i++) ui.fillStyle(0x5aa860, 1).fillRect(W - 24 + i * 4, BAR + 14 - i * 2, 3, 3 + i * 2);
      ui.fillStyle(C.outline, 1).fillRect(cx - 17, H - BAR - 22, 34, 16);
      ui.fillStyle(0xd8403a, 1).fillRect(cx - 16, H - BAR - 21, 32, 14);
      ui.fillStyle(0xfff6e6, 1).fillRect(cx - 7, H - BAR - 15, 14, 2);
      // you, picture-in-picture
      ui.fillStyle(C.outline, 1).fillRect(W - 62, H - BAR - 62, 54, 54);
      pip = this.keep(this.add.image(W - 59, H - BAR - 59, drawYouPortrait(this, 0)).setOrigin(0).setDepth(601));
      this.every(200, () => {
        const f = Object.values(fam)[Math.floor(Math.random() * 5)];
        if (Math.random() < 0.18) f.blink();
      });
    });

    const { mom, dad, grandma, sibling } = fam;
    for (const f of [mom, dad, grandma, sibling]) f.set({ mouth: "smile" });
    mom.set({ pose: "wave" });
    let k = 0;
    const waving = this.every(260, () => {
      k++;
      if (mom.pose === "wave" || mom.pose === "raise") mom.set({ pose: k % 2 ? "wave" : "raise" });
    });
    await this.famSay(mom, "There you are! We can see your village from the backyard!");
    waving.remove();
    mom.set({ pose: "rest" });
    sibling.set({ pose: "cheer" });
    await this.famSay(sibling, "Did you get me a moon rock??");
    sibling.set({ pose: "rest" });
    await this.say(pip.x + 27, pip.y - 4, "Better! I've got NEIGHBORS. One reads my mail, one plans my week, one-", VOICE.you);
    dad.set({ pose: "facepalm", mouth: "closed" });
    await this.famSay(dad, "...Every. Single. Call.");
    dad.set({ pose: "rest", mouth: "smile" });
    grandma.set({ pose: "sip", eyes: "closed" });
    await this.wait(500);
    grandma.set({ pose: "rest", eyes: "open" });
    await this.famSay(grandma, "I knew you'd find your people up there. I'm proud of you, dear.");
    await this.famSay(mom, "Come home for dinner sometime. You can talk about AI. A little.");
    await this.say(pip.x + 27, pip.y - 4, "Deal. Save me a seat.", VOICE.you, undefined, 1200);
    // everyone waves goodbye
    let w = 0;
    const bye = this.every(240, () => {
      w++;
      for (const [i, f] of [mom, dad, grandma, sibling].entries()) f.set({ pose: (w + i) % 2 ? "wave" : "raise" });
    });
    await this.caption("Signal: perfect.", 1800);
    bye.remove();
  }

  // ------------------------------------------------------------ Fireworks

  private async shotFireworks() {
    const { W, H } = this;
    const horizon = Math.round(H * 0.72);
    await this.cut(() => {
      this.keep(this.add.image(0, 0, drawMoonLanding(this, W, H, horizon)).setOrigin(0));
      this.keep(this.add.image(Math.round(W / 2), Math.round(H * 0.34), "glow_l").setBlendMode(Phaser.BlendModes.ADD).setTint(0x6a9cf0).setAlpha(0.6));
      this.keep(this.add.image(Math.round(W / 2), Math.round(H * 0.34), "earth_l"));
      this.fireworks(horizon);
    });
    await this.caption("Some lines home are made of wire.", 1600);
    await this.caption("The best ones are made of people.", 1800);
    this.clearCaption();
    const title = this.keep(this.add.image(Math.round(this.W / 2), Math.round(H * 0.6), this.bigText("HOME SWEET MOON")).setAlpha(0).setDepth(800));
    sfx.bell();
    await this.tween({ targets: title, alpha: 1, duration: 900 });
    const sub = this.keep(ptext(this, 0, title.y + 22, "The colony keeps going: new requests every day.", 0xe8e4d8).setDepth(800));
    sub.setX(Math.round(W / 2 - measure(sub).w / 2));
    await this.waitOrNext(3200);
  }
}
