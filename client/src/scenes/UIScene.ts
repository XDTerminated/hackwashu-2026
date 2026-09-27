import Phaser from "phaser";
import { BUILDINGS, QUESTS, VILLAGER_HOME, VILLAGER_NAMES, type VillagerId, type VillagerStatus } from "../../../shared/game";
import { PHONE } from "../font";
import { SHOP_ITEMS } from "../items";
import { SPOTS, WORLD_H, WORLD_W } from "../layout";
import * as net from "../net";
import { mountPanel, openInfo } from "../panel";
import { mountMoonPad, onUnreadChange, openMoonPad, unreadTotal } from "../tablet";
import { sfx } from "../sfx";
import { onStoreChange, store } from "../store";
import { MINIMAP_H, MINIMAP_W } from "../terrain";
import { Button, C, IconButton, Label, fit, measure, pixBox, ptext, woodFrame } from "../widgets";
import { VERB_ICON } from "../icons";
import { isMusicMuted, onMusicToggle, toggleMusic } from "../music";

type ArrangeState = { edit: boolean; holding: { name: string; isNew: boolean; refund: number | null } | null };
import type { GameScene } from "./GameScene";

// Screen-space UI, laid out in art pixels (this scene renders 1:1 with the
// canvas, which the browser upscales by a whole number).

// Roster in unlock order.
const VILLAGERS: VillagerId[] = ["jade_rabbit", "stargazer", "postmaster", "timekeeper", "scholar"];

const STATUS: Record<VillagerStatus, { dot: number; text: number }> = {
  idle: { dot: 0xa89878, text: C.inkSoft },
  thinking: { dot: 0x3f7fc8, text: C.blue },
  working: { dot: 0x3f9b54, text: C.green },
  waiting: { dot: 0xe8871e, text: 0xb0521f },
  error: { dot: 0xd0402f, text: C.red },
};

const MAP_DOT: Record<VillagerId, number> = {
  jade_rabbit: 0x7fd0ad,
  postmaster: 0x5b78c4,
  timekeeper: 0xd9a441,
  scholar: 0xc8323a,
  stargazer: 0x9a7ff0,
};

const HUD_W = 200;

export class UIScene extends Phaser.Scene {
  private coins!: Phaser.GameObjects.BitmapText;
  private clodCount!: Phaser.GameObjects.BitmapText;
  private link!: Label;
  private quest!: Phaser.GameObjects.BitmapText;
  private accounts: Label[] = [];
  private roster = new Map<VillagerId, { dot: Phaser.GameObjects.Image; name: Phaser.GameObjects.BitmapText; act: Phaser.GameObjects.BitmapText }>();
  private shop!: Phaser.GameObjects.Container;
  private shopOpen = false;
  private mm!: Phaser.GameObjects.Graphics;
  private mmX = 0;
  private mmY = 0;
  private toasts: Phaser.GameObjects.Container[] = [];
  private unsubs: Array<() => void> = [];

  constructor() {
    super("UI");
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.roster.clear();
    this.toasts = [];

    // --- wallet + roster
    const hud = this.add.graphics();
    woodFrame(hud, 4, 4, HUD_W, 96);
    this.add.image(11, 11, "coin").setOrigin(0);
    this.coins = ptext(this, 22, 11, "0", C.gold, "pxb");
    this.add.image(66, 10, "clod_icon").setOrigin(0);
    this.clodCount = ptext(this, 78, 11, "", C.coral);
    VILLAGERS.forEach((v, i) => {
      const y = 25 + i * 11;
      const dot = this.add.image(11, y + 1, "dot").setOrigin(0);
      const name = ptext(this, 19, y, VILLAGER_NAMES[v], C.ink, "pxb");
      const act = ptext(this, 0, y, "", C.inkSoft);
      this.roster.set(v, { dot, name, act });
    });
    hud.fillStyle(C.paperDark, 1).fillRect(10, 81, HUD_W - 12, 1);
    this.quest = ptext(this, 11, 84, "", C.coral);

    // --- minimap
    const frameW = MINIMAP_W + 8;
    const frameH = MINIMAP_H + 8;
    const mg = this.add.graphics();
    woodFrame(mg, W - 4 - frameW, 4, frameW, frameH, 0x14122a);
    this.mmX = W - 4 - frameW + 4;
    this.mmY = 8;
    if (this.textures.exists("minimap")) this.add.image(this.mmX, this.mmY, "minimap").setOrigin(0);
    this.mm = this.add.graphics();
    this.link = new Label(this, W - 4, 4 + frameH + 2, "", { bg: C.outline, border: null, originX: 1, originY: 0, padX: 3 });
    this.accounts = [0, 1, 2].map((i) => new Label(this, W - 4, 4 + frameH + 16 + i * 13, "", { bg: C.outline, border: null, originX: 1, originY: 0, padX: 3 }));

    this.buildToolbar();

    this.buildShop();
    mountPanel(this);
    mountMoonPad(this);
    this.refresh();

    this.unsubs.push(onStoreChange(() => this.refresh()));
    this.unsubs.push(
      net.onEvent((e) => {
        if (e.type === "phone") this.toast(e.direction === "in" ? `${PHONE} You (from Earth)` : `${PHONE} -> your phone`, e.text, e.direction === "in" ? C.green : C.coral);
        if (e.type === "friendship" && e.levelUp) {
          const bond = ["", "acquaintances", "getting friendly", "friends", "close friends", "best friends"][e.hearts];
          this.toast(`♥ ${VILLAGER_NAMES[e.villager]}`, `${"♥".repeat(e.hearts)} You're ${bond} now!`, C.coral);
        }
      }),
    );
    this.unsubs.push(net.onNotice((t) => this.toast("Moon Village", t, C.red)));
    this.game.events.on("toggle-shop", this.toggleShop, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      this.game.events.off("toggle-shop", this.toggleShop, this);
    });
  }

  private refresh() {
    this.coins.setText(String(store.coins));
    const ready = store.clods.filter((c) => c.status === "ready").length;
    const working = store.clods.filter((c) => c.status === "working" || c.status === "stuck").length;
    this.clodCount.setText(`${ready} ready - ${working} working`);

    for (const v of VILLAGERS) {
      const row = this.roster.get(v)!;
      const home = VILLAGER_HOME[v];
      const resident = store.residents.includes(v);
      const discovered = resident || store.buildings[home] || store.progress.revealed.includes(home);
      row.name.setText(discovered ? VILLAGER_NAMES[v] : "???");
      row.act.setX(row.name.x + measure(row.name).w + 4);
      const room = HUD_W - 6 - row.act.x;
      let text: string;
      let color: number;
      let dot: number;
      if (resident) {
        const st = store.villagers[v];
        const style = STATUS[st?.status ?? "idle"];
        dot = style.dot;
        color = style.text;
        text = st?.status === "waiting" ? "! needs your OK" : st?.activity ?? "relaxing";
        if (v === "jade_rabbit" && !store.rabbitTeamwork && (st?.status ?? "idle") === "idle") text = "your guide - talk to me";
      } else if (store.buildings[home]) {
        [dot, color, text] = [0xe8871e, 0xb0521f, `waiting on Earth - CALL at ${BUILDINGS[home].name}`];
      } else if (discovered) {
        [dot, color, text] = [0xc9b089, C.inkSoft, `build the ${BUILDINGS[home].name}`];
      } else {
        [dot, color, text] = [0xc9b089, 0xb09a78, "not discovered yet"];
      }
      row.dot.setTint(dot);
      row.name.setTint(discovered ? C.ink : 0xb09a78);
      row.act.setText(fit(this, text, room)).setTint(color);
    }

    const q = QUESTS[store.progress.quest];
    this.quest.setText(fit(this, q ? `★ ${q.title}${q.goal > 1 ? ` (${store.progress.count}/${q.goal})` : ""}` : "★ Every neighbor has moved in!", HUD_W - 14));

    const c = store.connections;
    const account = (label: string, live: boolean, who: string | undefined, sandbox: boolean | undefined) =>
      live ? { t: `${label}: ${who ?? "connected"}`, col: 0x9ae0a8 } : sandbox ? { t: `${label}: sample data`, col: 0xf5c542 } : { t: `${label}: not connected`, col: 0x8a8fa8 };
    const rows = [
      account("Google", c.google.connected, c.google.account, store.progress.sandbox.google),
      account("Canvas", c.canvas.connected, c.canvas.account, store.progress.sandbox.canvas),
      c.photon.connected
        ? c.photon.phones.length
          ? { t: `iMessage: ${c.photon.phones.map((p) => p.masked).join(", ")}`, col: 0x9ae0a8 }
          : { t: "iMessage: link on MoonPad", col: 0xf5c542 }
        : { t: "iMessage: not set up", col: 0x8a8fa8 },
    ];
    rows.forEach((r, i) => this.accounts[i]?.setText(fit(this, r.t, 150)).setColor(r.col));
    this.link.setText(store.connected ? "● colony online" : "○ colony offline").setColor(store.connected ? 0x9ae0a8 : 0xff9a8a);
  }

  update(time: number) {
    // Blink the "needs you" dots so they're impossible to miss.
    for (const v of VILLAGERS) this.roster.get(v)!.dot.setVisible(store.villagers[v]?.status !== "waiting" || Math.floor(time / 300) % 2 === 0);

    const game = this.scene.get("Game") as GameScene | undefined;
    const g = this.mm.clear();
    if (!game?.player) return;
    const X = (x: number) => this.mmX + Math.floor((x / WORLD_W) * MINIMAP_W);
    const Y = (y: number) => this.mmY + Math.floor((y / WORLD_H) * MINIMAP_H);
    for (const [b, spot] of Object.entries(SPOTS) as [keyof typeof SPOTS, (typeof SPOTS)[keyof typeof SPOTS]][]) {
      if (!store.buildings[b] && !store.progress.revealed.includes(b)) continue;
      g.fillStyle(store.buildings[b] ? 0xfff6e6 : 0xc9a26b, 1).fillRect(X(spot.x) - 1, Y(spot.y) - 2, 3, 2);
    }
    const dots = game.minimapDots();
    for (const c of dots.clods) g.fillStyle(c.status === "ready" ? 0xffb07a : 0xd97757, 1).fillRect(X(c.x), Y(c.y), 1, 1);
    for (const v of dots.villagers) g.fillStyle(MAP_DOT[v.id], 1).fillRect(X(v.x) - 1, Y(v.y) - 1, 2, 2);
    const blink = Math.floor(time / 400) % 2 === 0;
<<<<<<< Updated upstream
    g.fillStyle(0x3b2a3a, 1).fillRect(X(dots.player.x) - 2, Y(dots.player.y) - 2, 4, 4);
    g.fillStyle(blink ? 0xffffff : 0xf5c542, 1).fillRect(X(dots.player.x) - 1, Y(dots.player.y) - 1, 2, 2);
=======
    top.fillStyle(0x3b2a3a, 1).fillRect(X(dots.player.x) - 2, Y(dots.player.y) - 2, 4, 4);
    top.fillStyle(blink ? 0xffffff : 0xf5c542, 1).fillRect(X(dots.player.x) - 1, Y(dots.player.y) - 1, 2, 2);
    // Indoors (the Office), the island's edge markers would point through walls.
    if (!this.scene.isActive("Office")) this.drawMeteorMarkers(game, dots.meteors, time);
  }

  /**
   * Meteors you can't see: a badge on the screen edge with an arrow pointing to
   * where it's falling (red, blinking) or where the moon-rock landed (gold).
   * One that's on screen but still falling gets a blinking "!" over its spot.
   */
  private drawMeteorMarkers(game: GameScene, meteors: { x: number; y: number; incoming: boolean }[], time: number) {
    const W = this.scale.width;
    const H = this.scale.height - 26;
    const view = game.cameras.main.worldView;
    const g = this.meteorG;
    const blink = Math.floor(time / 200) % 2 === 0;
    let used = 0;
    const icon = (key: string, x: number, y: number) => {
      const img = this.meteorIcons[used] ?? (this.meteorIcons[used] = this.add.image(0, 0, key).setDepth(1501));
      used++;
      return img.setTexture(key).setOrigin(0.5).setPosition(Math.round(x), Math.round(y)).setVisible(true);
    };
    for (const m of meteors) {
      const sx = m.x - view.x;
      const sy = m.y - view.y;
      if (sx > 6 && sx < W - 6 && sy > 6 && sy < H - 6) {
        if (m.incoming && blink) icon("bang", sx, sy - 18);
        continue;
      }
      const cx = W / 2;
      const cy = H / 2;
      const dx = sx - cx;
      const dy = sy - cy;
      const t = Math.min((cx - 16) / Math.abs(dx || 1e-6), (cy - 16) / Math.abs(dy || 1e-6));
      let ex = Math.round(cx + dx * t);
      let ey = Math.round(cy + dy * t);
      // Stay clear of the corner panels (roster top-left, minimap and accounts top-right).
      if (ey < this.cornerBottom && (ex < HUD_W + 14 || ex > W - this.cornerWidth)) {
        ex = ex < W / 2 ? 16 : W - 16;
        ey = this.cornerBottom + 10;
      }
      // The arrow points from the badge to the meteor.
      const len = Math.hypot(sx - ex, sy - ey) || 1;
      const ux = (sx - ex) / len;
      const uy = (sy - ey) / len;
      const ring = m.incoming ? (blink ? 0xff4a3a : 0xb0302a) : 0xf5c542;
      const tri = (tip: number, back: number, half: number) => {
        const bx = ex + ux * back;
        const by = ey + uy * back;
        g.fillTriangle(Math.round(ex + ux * tip), Math.round(ey + uy * tip), Math.round(bx - uy * half), Math.round(by + ux * half), Math.round(bx + uy * half), Math.round(by - ux * half));
      };
      g.fillStyle(0x3b2a3a, 1);
      tri(15, 6, 6);
      g.fillCircle(ex, ey, 9);
      g.fillStyle(ring, 1);
      tri(13, 7, 4);
      g.fillCircle(ex, ey, 8);
      g.fillStyle(0x1a1224, 1).fillCircle(ex, ey, 6);
      icon(m.incoming ? "meteor" : "moonrock", ex, ey);
    }
>>>>>>> Stashed changes
  }

  // ------------------------------------------------------------ phone toasts

  private toast(who: string, text: string, color: number) {
    const W = this.scale.width;
    const H = this.scale.height;
    const c = this.add.container(0, 0).setDepth(4000);
    const g = this.add.graphics();
    const head = ptext(this, 6, 5, who, color, "pxb");
    const body = ptext(this, 6, 17, text.length > 200 ? text.slice(0, 197) + "..." : text, C.ink).setMaxWidth(130);
    const w = Math.max(measure(head).w, measure(body).w) + 12;
    const h = 17 + measure(body).h + 5;
    woodFrame(g, 0, 0, w, h, C.paperLight);
    // inner inset hides the frame's paper for a lighter "phone" look
    c.add([g, head, body]);
    c.setSize(w, h);
    this.toasts.push(c);
    while (this.toasts.length > 3) this.toasts.shift()!.destroy();
    let y = H - 30;
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      y -= t.height + 3;
      t.setPosition(W - 6 - t.width, y);
    }
    if (color === C.green) sfx.message();
    this.time.delayedCall(12000, () => {
      this.tweens.add({
        targets: c,
        alpha: 0,
        duration: 400,
        onComplete: () => {
          this.toasts = this.toasts.filter((t) => t !== c);
          c.destroy();
        },
      });
    });
  }

  // ------------------------------------------------------------ toolbar
  // Icon buttons (hover for names); keys (E / SPACE / B / ESC) are optional shortcuts.

  private action!: IconButton;
  private actionHold = false;
  private callBtn!: IconButton;
  private editBtn!: IconButton;
  private canCall = false;
  private badge!: Phaser.GameObjects.Container;
  private banner: Phaser.GameObjects.Container | null = null;

  private buildToolbar() {
    const W = this.scale.width;
    const H = this.scale.height;
    const [bw, gap, sep, actionW] = [20, 3, 8, 28];
    const click = (fn: () => void) => () => {
      sfx.blip();
      fn();
    };
    const groups: [string, string, () => void][][] = [
      [
        ["icon_moonpad_0", "MoonPad - text villagers", click(() => openMoonPad())],
        ["icon_shop_0", "Supply Pod - decorations", click(() => this.toggleShop())],
        ["icon_quests_0", "Quests", click(() => this.showQuests())],
        ["icon_help_0", "How to play", click(() => this.showHelp())],
      ],
      [
<<<<<<< Updated upstream
        ["icon_call_0", "Call villager home", () => (this.canCall ? this.game.events.emit("call-press") : sfx.deny())],
        ["icon_edit_0", "Edit layout", () => this.game.events.emit("edit-toggle")],
=======
        ["icon_edit_0", "Edit layout", () => this.game.events.emit("edit-toggle")],
        [isMusicMuted() ? "icon_music_off_0" : "icon_music_0", isMusicMuted() ? "Music: off" : "Music: on", () => toggleMusic()],
>>>>>>> Stashed changes
      ],
    ];
    const count = groups.reduce((n, g) => n + g.length, 0);
    const inner = count * bw + (count - groups.length) * gap + groups.length * sep + actionW;
    const frameW = inner + 12;
    const x0 = Math.round((W - frameW) / 2);
    const y0 = H - 25;
    const g = this.add.graphics().setDepth(2000);
    woodFrame(g, x0, y0, frameW, 24);
    let x = x0 + 6;
    const made: IconButton[] = [];
    for (const group of groups) {
      for (const [icon, tip, fn] of group) {
        made.push(new IconButton(this, x, y0 + 3, icon, C.woodMid, tip, fn).setDepth(2001));
        x += bw + gap;
      }
      x += sep - gap;
      g.fillStyle(C.woodDark, 1).fillRect(x - Math.ceil(sep / 2) - 1, y0 + 5, 1, 14);
    }
<<<<<<< Updated upstream
    const [moonpad, , , , call, edit] = made;
    this.callBtn = call.setFill(0x8a8199).setTooltip("Call villager home (stand at their door)");
=======
    const [moonpad, , , , edit, music] = made;
>>>>>>> Stashed changes
    this.editBtn = edit;
    this.unsubs.push(onMusicToggle((m) => music.setIcon(m ? "icon_music_off_0" : "icon_music_0").setTooltip(m ? "Music: off" : "Music: on")));

    this.action = new IconButton(this, x, y0 + 3, "icon_idle_0", 0x8a8199, "Nothing to do here", () => {}, actionW).setDepth(2001);
    this.action.on("pointerdown", () => {
      if (this.actionHold) this.game.events.emit("action-hold", true);
      else this.game.events.emit("action-press");
    });
    const release = () => this.game.events.emit("action-hold", false);
    this.action.on("pointerup", release);
    this.action.on("pointerout", release);

    // Unread badge on the MoonPad button.
    this.badge = this.add.container(moonpad.x + bw - 5, moonpad.y - 4).setDepth(2002);
    this.renderBadge();
    this.unsubs.push(onUnreadChange(() => this.renderBadge()));

    const onAction = (a: { verb: string; hold: boolean } | null) => {
      this.actionHold = !!a?.hold;
      const name = a ? a.verb.charAt(0) + a.verb.slice(1).toLowerCase() : "";
      this.action
        .setIcon(a ? (VERB_ICON[a.verb] ?? "icon_idle_0") : "icon_idle_0")
        .setFill(a ? C.greenBtn : 0x8a8199)
        .setTooltip(a ? (a.hold ? `Hold to ${name.toLowerCase()} (SPACE)` : `${name} (E)`) : "Nothing to do here");
    };
    const onCall = (on: boolean) => {
      this.canCall = on;
      this.callBtn.setFill(on ? C.greenBtn : 0x8a8199).setTooltip(on ? "Call villager home" : "Call villager home (stand at their door)");
    };
    const onArrange = (a: ArrangeState) => {
      this.editBtn.setPressed(a.edit).setTooltip(a.edit ? "Done editing" : "Edit layout");
      this.renderBanner(a);
    };
    this.game.events.on("action", onAction);
    this.game.events.on("call", onCall);
    this.game.events.on("arrange", onArrange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off("action", onAction);
      this.game.events.off("call", onCall);
      this.game.events.off("arrange", onArrange);
    });
  }

  /** What you're doing in edit mode / while placing, just above the toolbar. */
  private renderBanner(a: ArrangeState) {
    this.banner?.destroy();
    this.banner = null;
    if (!a.edit && !a.holding) return;
    const W = this.scale.width;
    const H = this.scale.height;
    const text = a.holding
      ? `${a.holding.isNew ? "Place" : "Move"} the ${a.holding.name}: click a spot where the tiles turn green.`
      : "EDIT MODE: click any building or decoration to pick it up.";
    const buttons: [string, number, () => void][] = [];
    if (a.holding?.refund != null) buttons.push([`SELL +${a.holding.refund}¢`, C.woodMid, () => this.game.events.emit("arrange-sell")]);
    if (a.holding) buttons.push(["CANCEL", C.woodMid, () => this.game.events.emit("arrange-cancel")]);
    if (a.edit) buttons.push(["DONE", C.greenBtn, () => this.game.events.emit("edit-toggle")]);

    const c = this.add.container(0, 0).setDepth(2500);
    const t = ptext(this, 0, 0, text, C.paperLight, "pxb");
    const btns = buttons.map(([label, fill, fn]) => new Button(this, 0, 0, label, fill, () => (sfx.blip(), fn())));
    const bw = btns.reduce((n, b) => n + b.width_ + 4, 0);
    const w = Math.min(W - 16, measure(t).w + 14 + bw);
    const h = 22;
    const x = Math.round((W - w) / 2);
    const y = H - 25 - h - 3;
    const g = this.add.graphics();
    pixBox(g, x, y, w, h, C.wood, C.woodDark);
    g.fillStyle(0xffffff, 0.12).fillRect(x + 1, y + 1, w - 2, 1);
    t.setPosition(x + 7, y + 7);
    c.add([g, t]);
    let bx = x + w - 4 - bw;
    for (const b of btns) {
      b.setPosition(bx + 4, y + 4);
      bx += b.width_ + 4;
      c.add(b);
    }
    this.banner = c;
  }

  private renderBadge() {
    this.badge.removeAll(true);
    const n = unreadTotal();
    if (!n) return;
    const g = this.add.graphics();
    const t = ptext(this, 0, 0, String(Math.min(n, 9)), 0xffffff, "pxb");
    const w = Math.max(9, measure(t).w + 5);
    g.fillStyle(0x3b2a3a, 1).fillRect(0, 0, w, 11);
    g.fillStyle(0xd0402f, 1).fillRect(1, 1, w - 2, 9);
    t.setPosition(Math.round((w - measure(t).w) / 2), 2);
    this.badge.add([g, t]);
  }

  private showQuests() {
    const lines = QUESTS.map((q, i) => {
      if (i < store.progress.quest) return `✓ ${q.title}`;
      if (i === store.progress.quest) return `★ ${q.title}${q.goal > 1 ? ` (${store.progress.count}/${q.goal})` : ""}\n${q.hint}`;
      return "??? - keep going to find out";
    });
    openInfo("QUESTS", store.progress.quest >= QUESTS.length ? [...lines, "Every line home is open. Happy Mid-Autumn!"] : lines);
  }

  private showHelp() {
    openInfo("HOW TO PLAY", [
      "Walk with WASD or the arrow keys. The toolbar icons (hover for names): MoonPad, Supply Pod, Quests, Help, Call and the pencil. The green button on the right does whatever you're standing next to: talk, build, pop a clod, grab a moon-rock, hold to sweep dust. (E and SPACE work too.)",
      "The pencil is edit mode: click any building, plot or decoration to pick it up, then click where the tiles turn green to set it down. Paths, lamps and doorbells follow the building.",
      "Villagers are real AI agents. Visit their house and ask in person to get real work done. Anything that leaves your real accounts (sending email, booking events) waits for your OK - they'll bring a letter to your door.",
      "Finished work leaves glowing clods - pop them for coins. Sweep moondust and grab fallen moon-rocks for more.",
      "Villager not home? Walk up to their door and press CALL (on the toolbar, at the door, or E) - they'll walk back.",
      "Text villagers on the MoonPad (or your real phone via iMessage) to get to know them. They remember what you tell them, and every chat and visit fills their hearts.",
    ]);
  }

  // ------------------------------------------------------------ shop

  private shopSel = 0;
  private shopCoins = -1;

  private buildShop() {
    this.shop = this.add.container(0, 0).setDepth(3000).setVisible(false);
    // Re-draw when coins change so prices you can now afford light up.
    this.unsubs.push(
      onStoreChange(() => {
        if (this.shopOpen && store.coins !== this.shopCoins) this.renderShop();
      }),
    );
  }

  /** A Stardew-style catalog: a grid of items, and the selected one's details with a BUY button. */
  private renderShop() {
    this.shopCoins = store.coins;
    this.shop.removeAll(true);
    const W = this.scale.width;
    const H = this.scale.height;
    const cols = W >= 360 ? 6 : 4;
    const rows = Math.ceil(SHOP_ITEMS.length / cols);
    const [tw, th, gap, pad] = [50, 56, 4, 10];
    const pw = pad * 2 + cols * tw + (cols - 1) * gap;
    const gridH = rows * th + (rows - 1) * gap;
    const ph = 30 + gridH + 8 + 38 + 8;
    const x0 = Math.round((W - pw) / 2);
    const y0 = Math.max(4, Math.round((H - 25 - ph) / 2));
    const g = this.add.graphics();
    woodFrame(g, x0, y0, pw, ph);
    const title = ptext(this, 0, y0 + 8, "★ SUPPLY POD ★", C.coral, "pxb");
    title.setX(x0 + Math.round((pw - measure(title).w) / 2));
    const sub = ptext(this, 0, y0 + 19, `decorations for your colony - you have ${store.coins}¢`, C.inkSoft);
    sub.setX(x0 + Math.round((pw - measure(sub).w) / 2));
    const close = ptext(this, x0 + pw - 14, y0 + 8, "x", C.ink, "pxb").setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.closeShop());
    this.shop.add([g, title, sub, close]);

    SHOP_ITEMS.forEach((item, i) => {
      const tx = x0 + pad + (i % cols) * (tw + gap);
      const ty = y0 + 30 + Math.floor(i / cols) * (th + gap);
      const sel = i === this.shopSel;
      const afford = store.coins >= item.price;
      const tile = this.add.graphics();
      const draw = (hover: boolean) => {
        tile.clear();
        pixBox(tile, tx, ty, tw, th, sel ? 0xfff8e8 : hover ? 0xfdeccc : C.paperLight, sel ? C.coral : C.paperDark);
      };
      draw(false);
      const icon = this.add.image(tx + tw / 2, ty + 45, item.texture).setOrigin(0.5, 1);
      if (!afford) icon.setAlpha(0.55);
      const price = ptext(this, 0, ty + 46, `${item.price}¢`, afford ? C.ink : C.red, "pxb");
      price.setX(tx + Math.round((tw - measure(price).w) / 2));
      const hit = this.add.zone(tx, ty, tw, th).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on("pointerover", () => draw(true));
      hit.on("pointerout", () => draw(false));
      hit.on("pointerdown", () => {
        sfx.blip();
        this.shopSel = i;
        this.renderShop();
      });
      this.shop.add([tile, icon, price, hit]);
    });

    // Details of the selected item.
    const item = SHOP_ITEMS[this.shopSel];
    const dy = y0 + 30 + gridH + 8;
    const panel = this.add.graphics();
    pixBox(panel, x0 + pad, dy, pw - pad * 2, 38, C.paperLight, C.paperDark);
    const afford = store.coins >= item.price;
    const btnW = 64;
    const name = ptext(this, x0 + pad + 6, dy + 5, item.name, C.ink, "pxb");
    const blurb = ptext(this, x0 + pad + 6, dy + 16, item.blurb, C.inkSoft).setMaxWidth(pw - pad * 2 - btnW - 18);
    const buy = new Button(this, x0 + pw - pad - btnW - 6, dy + 12, afford ? `BUY ${item.price}¢` : `NEED ${item.price}¢`, afford ? C.greenBtn : 0x8a8199, () => {
      if (store.coins < item.price) {
        sfx.deny();
        this.cameras.main.shake(120, 0.004);
        return;
      }
      sfx.blip();
      this.closeShop();
      this.game.events.emit("begin-place", item.id);
    }, btnW);
    this.shop.add([panel, name, blurb, buy]);
  }

  private toggleShop() {
    this.shopOpen ? this.closeShop() : this.openShop();
  }

  private openShop() {
    this.shopOpen = true;
    this.renderShop();
    this.shop.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.shop, alpha: 1, duration: 120 });
    sfx.blip();
  }

  private closeShop() {
    this.shopOpen = false;
    this.shop.setVisible(false);
  }
}
