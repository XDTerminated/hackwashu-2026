import Phaser from "phaser";
import { BUILDINGS, MATERIALS, MATERIAL_NAME, MOVE_INS, VILLAGER_HOME, VILLAGER_NAMES, VILLAGER_SHORT, type VillagerId, type VillagerStatus } from "../../../shared/game";
import { PHONE } from "../font";
import { DECOR_CATEGORIES, type DecorCategory } from "../../../shared/decor";
import { SHOP_ITEMS } from "../items";
import { SHARD_BONUS, SHARD_COUNT, SHARD_REWARD, SPOTS, WORLD_H, WORLD_W } from "../layout";
import * as net from "../net";
import { AGENT_STATUS, closePanel, isPanelOpen, mountPanel, openAccounts, openInfo } from "../panel";
import { mountMoonPad, onUnreadChange, openMoonPad, unreadTotal } from "../tablet";
import { isSfxMuted, onSfxToggle, sfx, toggleSfx } from "../sfx";
import { agents, focusedSession, onStoreChange, store } from "../store";
import { MINIMAP_H, MINIMAP_W } from "../terrain";
import { Button, C, IconButton, Label, TOOLBAR_H, fit, measure, pixBox, ptext, woodFrame } from "../widgets";
import { VERB_ICON } from "../icons";
import { isMusicMuted, onMusicToggle, toggleMusic } from "../music";
import { isOpenMic, onOpenMic, toggleOpenMic } from "../neartalk";
import { micSupported } from "../mic";
import { CHAPTER_AFTER, FINALE_VILLAGER, pending, setFinalePending, type Chapter } from "../story";
import { checklist, nextStep } from "../../../shared/movein";
import { closeMoonPad, isMoonPadOpen } from "../tablet";

type ArrangeState = { edit: boolean; holding: { name: string; isNew: boolean; refund: number | null } | null };
import type { GameScene } from "./GameScene";

// Screen-space UI, laid out in art pixels (this scene renders 1:1 with the
// canvas, which the browser upscales by a whole number).

// Roster in unlock order.
const VILLAGERS: VillagerId[] = ["jade_rabbit", "stargazer", "postmaster", "timekeeper", "scholar"];

const STATUS: Record<VillagerStatus, number> = {
  idle: C.inkSoft,
  thinking: C.blue,
  working: C.green,
  waiting: 0xb0521f,
  error: C.red,
};


const HUD_W = 176;
/** At most this many "who's busy" lines in the HUD. */
const BUSY_LINES = 3;

/** The action button's word for each verb (short enough to fit under its icon). */
const ACTION_WORD: Record<string, string> = {
  "READ LETTER": "read",
  "TURN ON": "light",
  "TURN OFF": "light",
  "CHECK IN": "check",
  POP: "pop",
};

export class UIScene extends Phaser.Scene {
  private coins!: Phaser.GameObjects.BitmapText;
  private matIcons: Phaser.GameObjects.Image[] = [];
  private matCounts: Phaser.GameObjects.BitmapText[] = [];
  private coinIcon!: Phaser.GameObjects.Image;
  private coinPing = 0;
  private clodCount!: Phaser.GameObjects.BitmapText;
  private clodIcon!: Phaser.GameObjects.Image;
  private link!: Label;
  private quest!: Phaser.GameObjects.BitmapText;
  private hud!: Phaser.GameObjects.Graphics;
  private colony!: Phaser.GameObjects.Container;
  private officePanel!: Label;
  private officeText = "";
  private busy: Phaser.GameObjects.BitmapText[] = [];
  private headTip: Label | null = null;
  /** The neighbours as a row of little heads; a dot means they're working. */
  private roster = new Map<VillagerId, { icon: Phaser.GameObjects.Image; dot: Phaser.GameObjects.Rectangle; shown: boolean }>();
  private shop!: Phaser.GameObjects.Container;
  private shopOpen = false;
  private mm!: Phaser.GameObjects.Graphics;
  private mmTop!: Phaser.GameObjects.Graphics;
  private mmIcons = new Map<VillagerId, Phaser.GameObjects.Image>();
  private meteorG!: Phaser.GameObjects.Graphics;
  private meteorIcons: Phaser.GameObjects.Image[] = [];
  /** How far down (and in) the top corner panels reach, for keeping edge markers clear of them. */
  private cornerBottom = 0;
  private cornerWidth = 0;
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
    // Phaser reuses this object on restart (resize): forget the old screen's state.
    this.reqOpen = -1;
    this.devBadge = null;
    this.banner = null;
    this.shopOpen = false;
    this.registry.set("shopOpen", false);
    this.actionHold = false;
    this.hint = null;
    this.shopTip = null;
    this.goalG = undefined as unknown as Phaser.GameObjects.Graphics;
    this.roster.clear();
    this.toasts = [];

    // --- wallet, neighbours, goal: only what matters right now
    this.hud = this.add.graphics();
    this.coinIcon = this.add.image(11, 11, "coin").setOrigin(0);
    this.coins = ptext(this, 22, 11, "0", C.gold, "pxb");
    // Materials for repairs, beside the coins.
    this.matIcons = MATERIALS.map((m) => this.add.image(0, 11, `mat_${m}_0`).setOrigin(0));
    this.matCounts = MATERIALS.map(() => ptext(this, 0, 11, "0", C.inkSoft));
    this.clodIcon = this.add.image(0, 10, "clod_icon").setOrigin(0);
    this.clodCount = ptext(this, 0, 11, "", C.coral);
    this.headTip = null;
    for (const v of VILLAGERS) {
      const icon = this.add.image(0, 25, `vicon_${v}_0`).setOrigin(0).setInteractive();
      icon.on("pointerover", () => {
        this.headTip?.destroy();
        const st = store.villagers[v];
        const doing = store.residents.includes(v) ? (st?.status === "waiting" ? "needs your OK" : st?.activity ?? "relaxing") : "not moved in yet";
        this.headTip = new Label(this, icon.x - 2, icon.y + 10, `${VILLAGER_NAMES[v]} - ${doing}`, { originX: 0, originY: 0, maxWidth: 170 }).setDepth(3000);
      });
      icon.on("pointerout", () => {
        this.headTip?.destroy();
        this.headTip = null;
      });
      const dot = this.add.rectangle(0, 0, 3, 3, 0x5aa860).setOrigin(0).setVisible(false);
      this.roster.set(v, { icon, dot, shown: false });
    }
    this.busy = Array.from({ length: BUSY_LINES }, () => ptext(this, 11, 0, "", C.inkSoft).setVisible(false));
    this.quest = ptext(this, 11, 0, "", C.coral).setMaxWidth(HUD_W - 14);

    // --- minimap
    const frameW = MINIMAP_W + 8;
    const frameH = MINIMAP_H + 8;
    const mg = this.add.graphics();
    woodFrame(mg, W - 4 - frameW, 4, frameW, frameH, 0x14122a);
    this.mmX = W - 4 - frameW + 4;
    this.mmY = 8;
    const mmImg = this.textures.exists("minimap") ? this.add.image(this.mmX, this.mmY, "minimap").setOrigin(0) : null;
    this.mm = this.add.graphics();
    this.mmIcons.clear();
    for (const v of VILLAGERS) this.mmIcons.set(v, this.add.image(0, 0, `vicon_${v}_0`).setOrigin(0).setVisible(false));
    this.mmTop = this.add.graphics();
    // Everything about the colony outside, so the Office can put it away.
    this.colony = this.add.container(0, 0, [
      this.hud, this.coinIcon, this.coins, ...this.matIcons, ...this.matCounts, this.clodIcon, this.clodCount,
      ...[...this.roster.values()].flatMap((r) => [r.icon, r.dot]),
      ...this.busy, this.quest, mg, ...(mmImg ? [mmImg] : []), this.mm, ...this.mmIcons.values(), this.mmTop,
    ]);
    this.officePanel = new Label(this, 4, 4, "", { originX: 0, originY: 0, align: "left", maxWidth: 190, padX: 5 }).setVisible(false);
    this.officeText = "";
    this.meteorG = this.add.graphics().setDepth(1500);
    this.meteorIcons = [];
    // Only shown when something's wrong (account status lives in Help).
    this.link = new Label(this, W - 4, 4 + frameH + 2, "", { bg: C.outline, border: null, originX: 1, originY: 0, padX: 3 }).setVisible(false);
    this.cornerBottom = 4 + frameH + 16;
    this.cornerWidth = frameW + 8;

    this.buildToolbar();

    this.buildShop();
    mountPanel(this);
    mountMoonPad(this);
    this.refresh();

    this.unsubs.push(onStoreChange(() => this.refresh()));
    this.unsubs.push(
      net.onEvent((e) => {
        if (e.type === "phone") this.toast(e.direction === "in" ? `${PHONE} You (from Earth)` : `${PHONE} -> your phone`, e.text, e.direction === "in" ? C.green : C.coral);
        if (e.type === "villager_arrived" && e.hello) {
          // A neighbor moved in: the next chapter (or, with everyone home, the finale),
          // once they've said hello. (Played from update() when you're outside with nothing open.)
          const ch = CHAPTER_AFTER[e.villager];
          if (e.villager === FINALE_VILLAGER) setFinalePending(true, 9000);
          else if (ch) pending.chapter = { ch, at: Date.now() + 9000 };
        }
        if (e.type === "requests" && e.completed) {
          const r = e.completed;
          this.toast(`★ Request done! +${r.reward}¢`, r.text, C.green);
          this.coinFly(this.scale.width - 60, this.scale.height - 60, r.reward);
        }
        if (e.type === "shard_found" && e.bonus) {
          this.toast("★ The beacon is relit!", `All ${e.total} Moon Shards are home and the old colony's beacon shines again. +${e.bonus}¢!`, C.green);
        }
        if ((e.type === "friendship" || e.type === "happiness") && e.levelUp) {
          const bond = ["", "acquaintances", "getting friendly", "friends", "close friends", "best friends"][e.hearts];
          this.toast(`♥ ${VILLAGER_NAMES[e.villager]}`, `${"♥".repeat(e.hearts)} You're ${bond} now!`, C.coral);
        }
      }),
    );
    this.unsubs.push(net.onNotice((t, tone) => this.toast("Moon Village", t, tone === "ok" ? C.green : C.red)));
    this.unsubs.push(net.onAgents(() => this.noticeAgents()));
    this.game.events.on("toggle-shop", this.toggleShop, this);
    this.input.keyboard!.on("keydown-ESC", () => {
      if (this.shopOpen) this.closeShop();
    });
    // First time only: how to walk, then where to go.
    const MOVED = "moon-hint-moved";
    let seen = false;
    try {
      seen = localStorage.getItem(MOVED) === "1";
    } catch {
      /* show it */
    }
    // The very first time: the MoonPad opens on its setup screen, before anything else.
    const SETUP = "moon-setup-shown";
    let setupShown = true;
    try {
      setupShown = localStorage.getItem(SETUP) === "1";
    } catch {
      /* skip it */
    }
    if (!setupShown)
      this.time.delayedCall(700, () => {
        if (!this.scene.isActive("Game")) return;
        try {
          localStorage.setItem(SETUP, "1");
        } catch {
          /* fine */
        }
        openMoonPad("connect", { welcome: true });
      });
    // ...then how to walk, once the MoonPad is closed.
    const walkHint = () => (isMoonPadOpen() || !setupShownNow() ? this.time.delayedCall(600, walkHint) : this.showHint("Walk with WASD or the arrow keys"));
    const setupShownNow = () => {
      try {
        return localStorage.getItem(SETUP) === "1";
      } catch {
        return true;
      }
    };
    if (!seen) this.time.delayedCall(1500, walkHint);
    const onMoved = () => {
      if (seen) return;
      seen = true;
      try {
        localStorage.setItem(MOVED, "1");
      } catch {
        /* fine */
      }
      this.showHint("Follow the ★ to your goal. Press E to talk to whoever is close.", 7000);
    };
    this.game.events.on("player-moved", onMoved);
    const onNpcToast = (t: { who: string; text: string }) => this.toast(t.who, t.text, C.green);
    this.game.events.on("npc-toast", onNpcToast);
    const onHint = (text: string, ms?: number) => this.showHint(text, ms ?? 7000);
    this.game.events.on("hint", onHint);
    const onCoinFly = (c: { sx: number; sy: number; amount: number }) => this.coinFly(c.sx, c.sy, c.amount);
    this.game.events.on("coin-fly", onCoinFly);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      this.game.events.off("toggle-shop", this.toggleShop, this);
      this.game.events.off("coin-fly", onCoinFly);
      this.game.events.off("player-moved", onMoved);
      this.game.events.off("npc-toast", onNpcToast);
      this.game.events.off("hint", onHint);
    });
    this.game.events.emit("ui-ready");
  }

  private refresh() {
    this.renderDevBadge();
    this.renderRequestBadge();
    this.coins.setText(String(store.coins));
    // moonstone · stardust · shards
    let mx = 22 + measure(this.coins).w + 8;
    MATERIALS.forEach((m, i) => {
      this.matIcons[i].setX(mx);
      this.matCounts[i].setText(String(store.materials[m])).setX(mx + 9);
      mx += 9 + measure(this.matCounts[i]).w + 6;
    });
    // Clods only when there are some.
    const ready = store.clods.filter((c) => c.status === "ready").length;
    const working = store.clods.filter((c) => c.status === "working" || c.status === "stuck").length;
    const clods = ready ? `${ready} ready to pop` : working ? `${working} on the way` : "";
    this.clodIcon.setVisible(!!clods).setX(mx + 2);
    this.clodCount.setText(clods).setX(this.clodIcon.x + 12);

    // The neighbours: a row of heads. Only someone doing something gets a line.
    let x = 11;
    const lines: { text: string; color: number }[] = [];
    for (const v of VILLAGERS) {
      const row = this.roster.get(v)!;
      const home = VILLAGER_HOME[v];
      const resident = store.residents.includes(v);
      row.shown = resident || !!store.buildings[home] || store.progress.revealed.includes(home);
      row.icon.setVisible(row.shown).setPosition(x, 25).setAlpha(resident ? 1 : 0.4);
      const st = store.villagers[v];
      const status = resident ? st?.status ?? "idle" : "idle";
      row.dot.setVisible(row.shown && status !== "idle" && status !== "waiting").setPosition(x + 6, 23).setFillStyle(STATUS[status]);
      if (row.shown) x += 12;
      if (status === "waiting") lines.push({ text: `! ${VILLAGER_SHORT[v]} needs your OK`, color: STATUS.waiting });
      else if (status !== "idle") lines.push({ text: `${VILLAGER_SHORT[v]}: ${st?.activity ?? "working"}`, color: STATUS[status] });
    }
    let y = 38;
    this.busy.forEach((t, i) => {
      const l = lines[i];
      t.setVisible(!!l);
      if (!l) return;
      t.setText(fit(this, l.text, HUD_W - 14)).setTint(l.color).setPosition(11, y);
      y += 10;
    });

    // The next step of the moving-in checklist (wraps onto a second line rather than getting cut off).
    const n = nextStep({ progress: store.progress, materials: store.materials, buildings: store.buildings, coins: store.coins, decos: store.decos });
    this.quest.setText(n ? `★ ${VILLAGER_SHORT[n.def.villager]}'s lot: ${n.step.text}` : "★ Every neighbor has moved in!");
    this.quest.setY(y + 4);
    const bottom = y + 4 + measure(this.quest).h + 6;
    this.hud.clear();
    woodFrame(this.hud, 4, 4, HUD_W, bottom - 4);
    this.hud.fillStyle(C.paperDark, 1).fillRect(10, y + 1, HUD_W - 12, 1);

    // Nothing to say while everything's fine.
    this.link.setText("○ colony offline - reconnecting...").setColor(0xff9a8a).setVisible(!store.connected);
  }

  /** Account status, for the Help page (it used to sit in the corner all the time). */
  private accountSummary() {
    const c = store.connections;
    const one = (label: string, live: boolean, who: string | undefined, sandbox: boolean | undefined) => `${label}: ${live ? who ?? "connected" : sandbox ? "sample data" : "not connected"}`;
    const phone = c.photon.connected ? (c.photon.phones.length ? c.photon.phones.map((p) => p.masked).join(", ") : "link on the MoonPad") : "not set up";
    return `Accounts: ${one("Google", c.google.connected, c.google.account, store.progress.sandbox.google)} · ${one("Canvas", c.canvas.connected, c.canvas.account, store.progress.sandbox.canvas)} · iMessage: ${phone}. Connect them from each villager's house.`;
  }

  /** Play a waiting story beat once you're outside with nothing open. */
  private storyBeats() {
    const now = Date.now();
    const calm = this.scene.isActive("Game") && !isPanelOpen() && !isMoonPadOpen() && !this.shopOpen;
    if (!calm) return;
    if (pending.finaleAt !== null && now >= pending.finaleAt) this.playCutscene("Ending");
    else if (pending.chapter && now >= pending.chapter.at) {
      const ch = pending.chapter.ch;
      pending.chapter = null;
      this.chapterCard(ch);
    }
  }

  /** Inside the Office: which session, and how the agents are doing, in one glance. */
  private officeStatus() {
    const s = focusedSession();
    if (!s) {
      const l = agents.state.link;
      if (l?.status === "linked") return `THE OFFICE · linked (${l.host})\nWaiting for Claude Code to send out subagents.`;
      return l ? "THE OFFICE\nPress E at the board to LINK your Claude Code (or REPLAY)." : "THE OFFICE\nNo coding agents running. Press E at the board for a replay.";
    }
    const title = s.title.length > 40 ? `${s.title.slice(0, 38)}..` : s.title;
    const working = s.workers.filter((w) => w.status !== "done" && w.status !== "failed").length;
    const crew = s.workers.length ? `${working} working · ${s.workers.length - working} done` : `lead ${AGENT_STATUS[s.lead.status]}`;
    const tag = s.source === "replay" ? `REPLAY ${Math.round((s.replay?.progress ?? 0) * 100)}%` : "LIVE";
    return `THE OFFICE · ${tag}\n${crew}\n${title}${s.project ? ` (${s.project})` : ""}`;
  }

  /** New subagents while you're outside: a heads-up (if you have an Office). */
  private seenAgents = new Set<string>();
  private agentsPrimed = false;
  private noticeAgents() {
    const fresh: string[] = [];
    for (const s of agents.state.sessions) {
      if (s.source === "replay") continue;
      for (const w of s.workers) {
        const key = `${s.id}/${w.id}`;
        if (this.seenAgents.has(key)) continue;
        this.seenAgents.add(key);
        if (w.status !== "done" && w.status !== "failed") fresh.push(w.name);
      }
    }
    // The first update is what was already running: no toast for that.
    if (!this.agentsPrimed) return void (this.agentsPrimed = true);
    if (!fresh.length || !store.buildings.office || this.scene.isActive("Office")) return;
    this.toast("The Office", fresh.length === 1 ? `A new agent got to work: ${fresh[0]}` : `${fresh.length} new agents got to work: ${fresh.slice(0, 3).join(", ")}${fresh.length > 3 ? "..." : ""}`, C.green);
  }

  update(time: number) {
    this.storyBeats();
    const inOffice = this.scene.isActive("Office");
    this.colony.setVisible(!inOffice);
    this.devBadge?.setVisible(!inOffice);
    this.officePanel.setVisible(inOffice);
    if (inOffice) {
      const t = this.officeStatus();
      if (t !== this.officeText) this.officePanel.setText((this.officeText = t));
    }
    // Blink the "needs you" icons so they're impossible to miss.
    for (const v of VILLAGERS) {
      const row = this.roster.get(v)!;
      row.icon.setVisible(row.shown && (store.villagers[v]?.status !== "waiting" || Math.floor(time / 300) % 2 === 0));
    }

    const game = this.scene.get("Game") as GameScene | undefined;
    const g = this.mm.clear();
    const top = this.mmTop.clear();
    this.meteorG.clear();
    this.meteorIcons.forEach((i) => i.setVisible(false));
    if (!game?.player) return;
    const X = (x: number) => this.mmX + Math.floor((x / WORLD_W) * MINIMAP_W);
    const Y = (y: number) => this.mmY + Math.floor((y / WORLD_H) * MINIMAP_H);
    for (const [b, spot] of Object.entries(SPOTS) as [keyof typeof SPOTS, (typeof SPOTS)[keyof typeof SPOTS]][]) {
      if (!store.buildings[b] && !store.progress.revealed.includes(b)) continue;
      g.fillStyle(store.buildings[b] ? 0xfff6e6 : 0xc9a26b, 1).fillRect(X(spot.x) - 1, Y(spot.y) - 2, 3, 2);
    }
    const dots = game.minimapDots();
    for (const c of dots.clods) g.fillStyle(c.status === "ready" ? 0xffb07a : 0xd97757, 1).fillRect(X(c.x), Y(c.y), 1, 1);
    // Meteors: blinking red while falling, orange once landed (grab it!).
    const fast = Math.floor(time / 150) % 2 === 0;
    for (const m of dots.meteors) {
      if (m.incoming && !fast) continue;
      g.fillStyle(0x3b2a3a, 1).fillRect(X(m.x) - 2, Y(m.y) - 2, 4, 4);
      g.fillStyle(m.incoming ? 0xff4a3a : 0xffa060, 1).fillRect(X(m.x) - 1, Y(m.y) - 1, 2, 2);
    }
    // Villagers: a little head for each, so you can tell who's where.
    for (const icon of this.mmIcons.values()) icon.setVisible(false);
    for (const v of dots.villagers) this.mmIcons.get(v.id)?.setPosition(X(v.x) - 3, Y(v.y) - 5).setVisible(true);
    const blink = Math.floor(time / 400) % 2 === 0;
    top.fillStyle(0x3b2a3a, 1).fillRect(X(dots.player.x) - 2, Y(dots.player.y) - 2, 4, 4);
    top.fillStyle(blink ? 0xffffff : 0xf5c542, 1).fillRect(X(dots.player.x) - 1, Y(dots.player.y) - 1, 2, 2);
    // Indoors (the Office), the island's edge markers would point through walls.
    if (!this.scene.isActive("Office")) {
      this.drawMeteorMarkers(game, dots.meteors, time);
      this.drawGoal(game, time);
    } else this.goalLabel?.setVisible(false);
  }

  /**
   * Meteors you can't see: a badge on the screen edge with an arrow pointing to
   * where it's falling (red, blinking) or where the moon-rock landed (gold).
   * One that's on screen but still falling gets a blinking "!" over its spot.
   */
  private drawMeteorMarkers(game: GameScene, meteors: { x: number; y: number; incoming: boolean }[], time: number) {
    const W = this.scale.width;
    const H = this.scale.height - TOOLBAR_H;
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
  }

  // ------------------------------------------------------------ the goal marker
  // A gold ★ over whoever (or wherever) the current quest points at, or an
  // arrow at the screen edge when it's off-screen, so you always know where to go.

  private goalG!: Phaser.GameObjects.Graphics;
  private goalIcon!: Phaser.GameObjects.Image;
  private goalLabel!: Label;

  private drawGoal(game: GameScene, time: number) {
    if (!this.goalG) {
      this.goalG = this.add.graphics().setDepth(1400);
      this.goalIcon = this.add.image(0, 0, "icon_quests_0").setDepth(1401);
      this.goalLabel = new Label(this, 0, 0, "", { bg: C.outline, border: null, color: 0xf5c542, font: "pxb", padX: 2 }).setDepth(1401);
    }
    const g = this.goalG.clear();
    const goal = game.questTarget();
    const view = game.cameras.main.worldView;
    const hide = !goal || isPanelOpen() || game.isArranging() || Math.hypot(goal.x - game.player.x, goal.y - game.player.y) < 36;
    this.goalIcon.setVisible(!hide);
    this.goalLabel.setVisible(!hide);
    if (hide || !goal) return;
    const W = this.scale.width;
    // keep the arrow above the toolbar
    const H = this.scale.height - TOOLBAR_H - 18;
    const sx = goal.x - view.x;
    const sy = goal.y - view.y;
    const bob = Math.round(Math.sin(time / 180) * 2);
    if (sx > 10 && sx < W - 10 && sy > 24 && sy < H) {
      // on screen: a bobbing ★ right above them
      this.goalIcon.setPosition(Math.round(sx), Math.round(sy) - 12 + bob);
      this.goalLabel.setVisible(false);
      return;
    }
    const cx = W / 2;
    const cy = H / 2;
    const dx = sx - cx;
    const dy = sy - cy;
    const t = Math.min((cx - 18) / Math.abs(dx || 1e-6), (cy - 18) / Math.abs(dy || 1e-6));
    let ex = Math.round(cx + dx * t);
    let ey = Math.round(cy + dy * t);
    if (ey < this.cornerBottom && (ex < HUD_W + 14 || ex > W - this.cornerWidth)) {
      ex = ex < W / 2 ? 18 : W - 18;
      ey = this.cornerBottom + 12;
    }
    const len = Math.hypot(sx - ex, sy - ey) || 1;
    const ux = (sx - ex) / len;
    const uy = (sy - ey) / len;
    const tri = (tip: number, back: number, half: number) => {
      const bx = ex + ux * back;
      const by = ey + uy * back;
      g.fillTriangle(Math.round(ex + ux * tip), Math.round(ey + uy * tip), Math.round(bx - uy * half), Math.round(by + ux * half), Math.round(bx + uy * half), Math.round(by - ux * half));
    };
    const tip = 15 + (bob > 0 ? 1 : 0);
    g.fillStyle(0x3b2a3a, 1);
    tri(tip, 6, 6);
    g.fillCircle(ex, ey, 10);
    g.fillStyle(0xf5c542, 1);
    tri(tip - 2, 7, 4);
    g.fillCircle(ex, ey, 9);
    g.fillStyle(0x5b3218, 1).fillCircle(ex, ey, 7);
    this.goalIcon.setPosition(ex, ey);
    // name the goal on the side facing the middle of the screen
    this.goalLabel.setText(goal.label);
    const lx = ex < W / 2 ? ex + 14 + this.goalLabel.boxW / 2 : ex - 14 - this.goalLabel.boxW / 2;
    this.goalLabel.place(lx, ey + 6);
  }

  // ------------------------------------------------------------ first-time hints

  private hint: Label | null = null;

  private showHint(text: string, ms = 0) {
    this.hint?.destroy();
    // Top centre: clear of the toolbar, the goal arrow and speech bubbles.
    this.hint = new Label(this, this.scale.width / 2, 6, text, { bg: C.outline, border: null, color: C.cream, font: "pxb", padX: 5, originY: 0, maxWidth: Math.max(120, this.scale.width - HUD_W - MINIMAP_W - 44) }).setDepth(2400);
    this.hint.setX(Math.round(HUD_W + 8 + (this.scale.width - HUD_W - MINIMAP_W - 20) / 2));
    // In the Office the top of the screen is the whiteboard: sit above the toolbar instead.
    if (this.scene.isActive("Office")) {
      this.hint.destroy();
      this.hint = new Label(this, Math.round(this.scale.width / 2), this.scale.height - TOOLBAR_H - 6, text, { bg: C.outline, border: null, color: C.cream, font: "pxb", padX: 5, originY: 1, maxWidth: Math.min(360, this.scale.width - 40) }).setDepth(2400);
    }
    const h = this.hint;
    if (ms) this.time.delayedCall(ms, () => h === this.hint && this.clearHint());
  }

  private clearHint() {
    const h = this.hint;
    this.hint = null;
    if (h) this.tweens.add({ targets: h, alpha: 0, duration: 400, onComplete: () => h.destroy() });
  }

  // ------------------------------------------------------------ story

  /** Hand the screen to a story cutscene; the game picks up where it was afterwards. */
  private playCutscene(key: "Intro" | "Ending") {
    if (this.scene.isActive("Intro") || this.scene.isActive("Ending")) return;
    if (!this.scene.isActive("Game")) {
      this.toast("Moon Village", "Step outside to watch.", C.red);
      return;
    }
    if (key === "Ending") setFinalePending(false);
    closePanel();
    closeMoonPad();
    this.scene.sleep("Game");
    this.scene.launch(key, key === "Intro" ? { then: "back" } : undefined);
    this.scene.sleep();
  }

  /** A new chapter: one small line at the top ("Chapter 2 · A Signal from Earth"), then it fades. */
  private chapterCard(ch: Chapter) {
    const title = ch.title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const c = new Label(this, Math.round(this.scale.width / 2), 6, `Chapter ${ch.n} · ${title}`, { bg: C.outline, border: null, color: 0xf5c542, font: "pxb", padX: 5, originY: 0 }).setDepth(5000).setAlpha(0);
    sfx.bell();
    this.tweens.add({ targets: c, alpha: 1, duration: 400 });
    this.time.delayedCall(4200, () => this.tweens.add({ targets: c, alpha: 0, duration: 600, onComplete: () => c.destroy() }));
  }

  // ------------------------------------------------------------ coins flying home

  /** A little shower of coins that springs out of (sx, sy) and flies into the wallet. */
  private coinFly(sx: number, sy: number, amount: number) {
    const n = Phaser.Math.Clamp(Math.ceil(amount / 5), 1, 10);
    const [tx, ty] = [this.coinIcon.x, this.coinIcon.y];
    for (let i = 0; i < n; i++) {
      const c = this.add.image(Math.round(sx), Math.round(sy), "coin").setOrigin(0).setDepth(4500);
      const a = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 14;
      this.tweens.chain({
        targets: c,
        tweens: [
          { x: Math.round(sx + Math.cos(a) * r), y: Math.round(sy + Math.sin(a) * r - 6), duration: 220, ease: "quad.out" },
          { x: tx, y: ty, duration: 520 + i * 45, ease: "cubic.in", delay: 60 },
        ],
        onComplete: () => {
          c.destroy();
          this.coinArrived();
        },
      });
    }
  }

  private coinArrived() {
    const now = this.time.now;
    if (now - this.coinPing > 70) {
      this.coinPing = now;
      sfx.coin();
    }
    this.tweens.killTweensOf([this.coinIcon, this.coins]);
    this.coinIcon.y = 11;
    this.coins.y = 11;
    this.tweens.add({ targets: [this.coinIcon, this.coins], y: 9, duration: 60, yoyo: true, ease: "quad.out" });
  }

  // ------------------------------------------------------------ phone toasts

  private toast(who: string, text: string, color: number) {
    const W = this.scale.width;
    const H = this.scale.height;
    const sig = `${who}|${text}`;
    if (this.toasts.some((t) => t.getData("sig") === sig)) return;
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
    c.setData("sig", sig);
    while (this.toasts.length > 2) this.toasts.shift()!.destroy();
    // Top right, under the minimap: clear of the toolbar and any open dialog.
    let y = this.mmY + MINIMAP_H + 10 + (this.link.visible ? 14 : 0);
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      t.setPosition(W - 6 - t.width, y);
      y += t.height + 3;
    }
    if (color === C.green) sfx.message();
    this.time.delayedCall(Math.min(9000, 4000 + text.length * 40), () => {
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
  // Icon buttons, each with its name underneath; keys (E / SPACE / B / ESC) are optional shortcuts.

  private action!: IconButton;
  private actionHold = false;
  private editBtn!: IconButton;
  private badge!: Phaser.GameObjects.Container;
  private reqBadge!: Phaser.GameObjects.Container;
  private reqOpen = -1;
  private banner: Phaser.GameObjects.Container | null = null;

  private buildToolbar() {
    const MIC_TIP = (on: boolean) =>
      !micSupported ? "Open mic needs Chrome, Edge or Safari" : on ? "Open mic: ON - press E by a neighbor, then just talk (Enter still types)" : "Open mic: off - turn on to talk hands-free once you press E by a neighbor";
    const W = this.scale.width;
    const H = this.scale.height;
    // Each button: its icon with a word underneath.
    const [bw, bh, gap, sep, actionW] = [30, 26, 2, 8, 38];
    const click = (fn: () => void) => () => {
      sfx.blip();
      fn();
    };
    const groups: [string, string, string, () => void][][] = [
      [
        ["icon_moonpad_0", "phone", "MoonPad - texts and connections", click(() => openMoonPad())],
        ["icon_shop_0", "shop", "Supply Pod - decorations (B)", click(() => this.toggleShop())],
        ["icon_quests_0", "quests", "Quests", click(() => this.showQuests())],
        ["icon_help_0", "help", "How to play", click(() => this.showHelp())],
      ],
      [
        [isOpenMic() ? "icon_mic_on_0" : "icon_mic_0", "mic", MIC_TIP(isOpenMic()), click(() => toggleOpenMic())],
        ["icon_edit_0", "edit", "Edit layout", () => this.game.events.emit("edit-toggle")],
        [isMusicMuted() ? "icon_music_off_0" : "icon_music_0", "music", isMusicMuted() ? "Music: off (M)" : "Music: on (M)", () => toggleMusic()],
        [isSfxMuted() ? "icon_sfx_off_0" : "icon_sfx_0", "sound", isSfxMuted() ? "Sound effects and voices: off" : "Sound effects and voices: on", () => toggleSfx()],
      ],
    ];
    const count = groups.reduce((n, g) => n + g.length, 0);
    const inner = count * bw + (count - groups.length) * gap + groups.length * sep + actionW;
    const frameW = inner + 12;
    const x0 = Math.round((W - frameW) / 2);
    const y0 = H - TOOLBAR_H + 1;
    const g = this.add.graphics().setDepth(2000);
    woodFrame(g, x0, y0, frameW, bh + 6);
    let x = x0 + 6;
    const made: IconButton[] = [];
    for (const group of groups) {
      for (const [icon, word, tip, fn] of group) {
        made.push(new IconButton(this, x, y0 + 3, icon, C.woodMid, tip, fn, bw, bh).setLabel(word).setDepth(2001));
        x += bw + gap;
      }
      x += sep - gap;
      g.fillStyle(C.woodDark, 1).fillRect(x - Math.ceil(sep / 2) - 1, y0 + 5, 1, bh - 4);
    }
    const [moonpad, , quests, , mic, edit, music, sound] = made;
    const showMic = (on: boolean) => mic.setIcon(on ? "icon_mic_on_0" : "icon_mic_0").setTooltip(MIC_TIP(on)).setLabel("mic", on ? 0x9dff8a : undefined);
    showMic(isOpenMic());
    this.unsubs.push(onOpenMic(showMic));
    this.unsubs.push(onSfxToggle((m) => sound.setIcon(m ? "icon_sfx_off_0" : "icon_sfx_0").setTooltip(m ? "Sound effects and voices: off" : "Sound effects and voices: on")));
    this.reqBadge = this.add.container(quests.x + bw - 5, quests.y - 4).setDepth(2002);
    this.editBtn = edit;
    this.unsubs.push(onMusicToggle((m) => music.setIcon(m ? "icon_music_off_0" : "icon_music_0").setTooltip(m ? "Music: off (M)" : "Music: on (M)")));

    this.action = new IconButton(this, x, y0 + 3, "icon_idle_0", 0x8a8199, "Nothing to do here", () => {}, actionW, bh).setLabel("-", 0xd8d2e0).setDepth(2001);
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
      // The big button says what E does right now ("talk", "build", ...).
      const word = a ? (ACTION_WORD[a.verb] ?? a.verb.split(" ")[0]).toLowerCase() : "-";
      this.action
        .setIcon(a ? (VERB_ICON[a.verb] ?? "icon_idle_0") : "icon_idle_0")
        .setLabel(`${word}${a ? " E" : ""}`, a ? 0xffffff : 0xd8d2e0)
        .setFill(a ? C.greenBtn : 0x8a8199)
        .setTooltip(a ? (a.hold ? `Hold to ${name.toLowerCase()} (hold E)` : `${name} (E)`) : "Nothing to do here");
    };
    const onArrange = (a: ArrangeState) => {
      this.editBtn.setPressed(a.edit).setTooltip(a.edit ? "Done editing" : "Edit layout");
      this.renderBanner(a);
    };
    this.game.events.on("action", onAction);
    this.game.events.on("arrange", onArrange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off("action", onAction);
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
      ? `${a.holding.isNew ? "Place" : "Move"} the ${a.holding.name}: click where the tiles turn green.`
      : "EDIT MODE: drag anything to move it, or click a decoration to sell it.";
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
    const y = H - TOOLBAR_H + 1 - h - 3;
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

  /** How many of today's colony requests are still open, on the Quests button. */
  private renderRequestBadge() {
    const n = store.requests.filter((r) => !r.done).length;
    if (n === this.reqOpen) return;
    this.reqOpen = n;
    this.reqBadge.removeAll(true);
    if (!n) return;
    const g = this.add.graphics();
    const t = ptext(this, 0, 0, String(n), 0x3b2a3a, "pxb");
    const w = Math.max(9, measure(t).w + 5);
    g.fillStyle(0x3b2a3a, 1).fillRect(0, 0, w, 11);
    g.fillStyle(0xf5c542, 1).fillRect(1, 1, w - 2, 9);
    t.setPosition(Math.round((w - measure(t).w) / 2), 2);
    this.reqBadge.add([g, t]);
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
    // Moving in: who's home, the checklist for whoever's next, and how many are still on Earth.
    const state = { progress: store.progress, materials: store.materials, buildings: store.buildings, coins: store.coins, decos: store.decos };
    const next = nextStep(state);
    const lines = MOVE_INS.flatMap((m) => {
      const who = VILLAGER_NAMES[m.villager];
      if (store.progress.movedIn.includes(m.villager)) return [`✓ ${who} moved in`];
      if (m !== next?.def) return [];
      return [`★ Bring ${who} home: fix up the ${BUILDINGS[m.home].name} lot\n${checklist(m, state).map((st) => `${st.done ? "✓" : "○"} ${st.text}`).join("\n")}`];
    });
    const later = MOVE_INS.filter((m) => !store.progress.movedIn.includes(m.villager) && m !== next?.def).length;
    if (later > 0) lines.push(`??? - ${later} more neighbor${later === 1 ? "" : "s"} waiting on Earth`);
    lines.push(`Materials: ${MATERIALS.map((m) => `${store.materials[m]} ${MATERIAL_NAME[m]}`).join(" · ")}. Moonstone: clear boulders, rubble, fallen meteor rocks. Stardust: sweep moondust. Shards: the wilds.`);
    const finished = !next;
    const story = finished ? [...lines, "Every line home is open."] : lines;
    // "Yutu: Sweep 3 moondust drifts (1/3) · 30¢" (the server's text carries the full name)
    const ask = (r: (typeof store.requests)[number]) => `${VILLAGER_SHORT[r.villager]}: ${r.text.replace(/^[^:]*:\s*/, "")}`;
    const requests = store.requests.map((r) => (r.done ? `✓ ${ask(r)} · paid` : `○ ${ask(r)}${r.goal > 1 ? ` (${r.count}/${r.goal})` : ""} · ${r.reward}¢`));
    const found = Math.min(store.shards.length, SHARD_COUNT);
    const shards = found < SHARD_COUNT
      ? `★ Moon Shards: ${found}/${SHARD_COUNT}. Pieces of the old colony's beacon, glinting out in the wilds: ${SHARD_REWARD}¢ each, and all ${SHARD_COUNT} relight the beacon for +${SHARD_BONUS}¢.`
      : `★ Moon Shards: all ${SHARD_COUNT} found. The beacon shines again.`;
    const buttons = [{ label: "WATCH INTRO", onClick: () => this.playCutscene("Intro") }];
    if (finished) buttons.push({ label: "WATCH FINALE", onClick: () => this.playCutscene("Ending") });
    openInfo("QUESTS", ["TODAY'S REQUESTS", ...requests, shards, "THE STORY", ...story], buttons);
  }

  private showHelp() {
    openInfo("HOW TO PLAY", [
      "Walk with WASD or the arrow keys (keep holding to run). The gold ★ always points to your current goal: over their head when they're on screen, an arrow at the edge when they're not.",
      "NEW NEIGHBORS: each neighbor still on Earth has a ruined lot here. Clear its rubble, repair the foundation with materials, build the house with coins, and put something they love in the yard: then they move in. Materials: moonstone (clear boulders, rubble and fallen meteor rocks), stardust (sweep moondust), moon shards (glinting in the wilds). Once they're home, connect your account so they can help with your real stuff, or try them on sample data.",
      "The toolbar icons (hover for names): MoonPad, Supply Pod (B), Quests, Help, the pencil for edit mode, music (M) and sound effects. To talk, stand next to a neighbor and press E or Enter to open the chat bar and type (or tap/hold TAB and speak); turn on the mic button to just talk hands-free. Their answers pop up over their heads. Press E (or SPACE) to do whatever you're standing next to: talk, clear rubble or a rock, repair, build, pop a clod, grab a moon-rock, switch a light; hold it to sweep dust. The green button on the right does the same with a click. ESC closes any window.",
      "Villagers love decorations near their home, and one of them makes a WISH each day (see Quests, and the gold ★ in the Supply Pod): put that decoration in their yard for a reward. Hover any decoration to see who loves it. Each villager has favorites (the Supply Pod says who loves what): a favorite in their yard is +3 happiness, anything else +1, each kind counted once. Happiness adds to their friendship hearts.",
      "Meteors! When one is falling off-screen, a red marker on the edge of the screen points to it; once it lands, a gold one points to the moon-rock. They show on the minimap too.",
      "The pencil is edit mode: click any building, plot or decoration to pick it up, then click where the tiles turn green to set it down. Paths, lamps and doorbells follow the building.",
      "Villagers are real AI agents. Visit their house and ask in person to get real work done. Anything that leaves your real accounts (sending email, booking events) waits for your OK - they'll bring a letter to your door.",
      "Finished work leaves glowing clods - pop them for coins. Sweep moondust and grab fallen moon-rocks for more.",
      "Every day the neighbors post three COLONY REQUESTS (the gold badge on Quests) that pay coins. 12 MOON SHARDS (pieces of the old colony's beacon) glint out in the wilds: walk over one to pick it up (15¢), and find all 12 to relight the beacon (+200¢). Clearing a rock sometimes turns up treasure.",
      this.accountSummary(),
      "Villager not home? Walk up to their door and press CALL (the green button, the button at the door, or E) - they'll walk back.",
      "Text villagers on the MoonPad (or your real phone via iMessage) to get to know them. They remember what you tell them, and every chat and visit fills their hearts.",
      store.devMode
        ? "DEV MODE is on: you're on a separate showcase save with everything unlocked. Your real colony is untouched and comes back when you leave."
        : "DEV MODE shows the fully built colony (every estate, every villager, coins to spend) on a separate showcase save. Your real colony is untouched and comes back when you leave.",
    ], [
      ...(store.account ? [{ label: "MY ACCOUNT", onClick: () => this.showAccount() }] : []),
      { label: "ACCOUNTS", onClick: () => openAccounts() },
      store.devMode
        ? { label: "LEAVE DEV MODE", kind: "ok", onClick: () => (closePanel(), net.send({ type: "dev_mode", on: false })) }
        : { label: "DEV MODE", kind: "ok", onClick: () => (closePanel(), net.send({ type: "dev_mode", on: true })) },
    ]);
  }

  /** Hosted: who's signed in, signing out, and deleting everything. */
  private showAccount(confirming = false) {
    const a = store.account;
    if (!a) return;
    const leave = (path: string, post = false) => {
      if (!post) return void (location.href = path);
      // A real form post, so the site can check it came from the game.
      const f = document.createElement("form");
      f.method = "POST";
      f.action = path;
      document.body.appendChild(f);
      f.submit();
    };
    if (confirming)
      return openInfo("DELETE MY DATA?", [
        `This deletes your village, everything connected to it (Google, Canvas, your Claude Code link) and your account (${a.email}). It can't be undone.`,
        "Signing in again later starts a brand new village.",
      ], [
        { label: "YES, DELETE IT ALL", onClick: () => leave("/auth/delete", true) },
        { label: "KEEP MY VILLAGE", kind: "ok", onClick: () => this.showAccount() },
      ]);
    openInfo("MY ACCOUNT", [
      `Signed in as ${a.name ? `${a.name} (${a.email})` : a.email}. This village is yours alone: your connections and your Claude Code only show up here.`,
      "Sign out to switch accounts. Your village waits for you.",
    ], [
      { label: "SIGN OUT", kind: "ok", onClick: () => leave("/auth/logout") },
      { label: "DELETE MY DATA", onClick: () => this.showAccount(true) },
    ]);
  }

  private devBadge: Phaser.GameObjects.Container | null = null;

  /** While on the showcase save: a badge at the top with a way back. */
  private renderDevBadge() {
    if (!!this.devBadge === store.devMode) return;
    this.devBadge?.destroy();
    this.devBadge = null;
    if (!store.devMode) return;
    const c = this.add.container(0, 0).setDepth(2600);
    const t = ptext(this, 0, 0, "DEV MODE - showcase save", C.paperLight, "pxb");
    const exit = new Button(this, 0, 0, "EXIT", C.coral, () => (sfx.blip(), net.send({ type: "dev_mode", on: false })));
    const w = measure(t).w + exit.width_ + 18;
    const x = Math.round((this.scale.width - w) / 2);
    const g = this.add.graphics();
    pixBox(g, x, 4, w, 21, 0x7e3a5a, C.outline);
    t.setPosition(x + 6, 11);
    exit.setPosition(x + w - exit.width_ - 3, 7);
    c.add([g, t, exit]);
    this.devBadge = c;
  }

  // ------------------------------------------------------------ shop

  private shopSel = 0;
  private shopTab: DecorCategory = "garden";
  private shopCoins = -1;

  private buildShop() {
    // above the message toasts (4000), so they never cover it
    this.shop = this.add.container(0, 0).setDepth(4100).setVisible(false);
    // Re-draw when coins change so prices you can now afford light up.
    this.unsubs.push(
      onStoreChange(() => {
        if (this.shopOpen && store.coins !== this.shopCoins) this.renderShop();
      }),
    );
  }

  /** A Stardew-style catalog: a grid of items, and the selected one's details with a BUY button. */
  private renderShop() {
    this.shopTip?.destroy();
    this.shopTip = null;
    this.shopCoins = store.coins;
    this.shop.removeAll(true);
    const W = this.scale.width;
    const H = this.scale.height;
    const items = SHOP_ITEMS.filter((i) => i.cat === this.shopTab);
    const [tw, th, gap, pad] = [50, 70, 4, 10];
    // As many columns as fit (one row on most screens), at least three.
    const cols = Math.max(3, Math.min(items.length, Math.floor((W - 24 - pad * 2 + gap) / (tw + gap))));
    const rows = Math.ceil(items.length / cols);
    const pw = pad * 2 + cols * tw + (cols - 1) * gap;
    const gridH = rows * th + (rows - 1) * gap;
    const top = 46;
    const ph = top + gridH + 8 + 46 + 8;
    const x0 = Math.round((W - pw) / 2);
    // centred in the space above the toolbar, and never overlapping it
    const y0 = Math.max(4, Math.min(Math.round((H - TOOLBAR_H + 1 - ph) / 2), H - TOOLBAR_H - 5 - ph));
    // Catch clicks on the whole panel so they never fall through to the world behind.
    const blocker = this.add.zone(x0, y0, pw, ph).setOrigin(0).setInteractive();
    this.shop.add(blocker);
    const g = this.add.graphics();
    woodFrame(g, x0, y0, pw, ph);
    const title = ptext(this, 0, y0 + 8, "★ SUPPLY POD ★", C.coral, "pxb");
    title.setX(x0 + Math.round((pw - measure(title).w) / 2));
    const sub = ptext(this, 0, y0 + 19, `decorations for your colony - you have ${store.coins}¢`, C.inkSoft);
    sub.setX(x0 + Math.round((pw - measure(sub).w) / 2));
    const close = ptext(this, x0 + pw - 14, y0 + 8, "x", C.ink, "pxb").setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.closeShop());
    this.shop.add([g, title, sub, close]);

    // Category tabs.
    let tabX = x0 + pad;
    for (const c of DECOR_CATEGORIES) {
      const b = new Button(this, tabX, y0 + 29, c.name, c.id === this.shopTab ? C.greenBtn : C.woodMid, () => {
        sfx.blip();
        this.shopTab = c.id;
        this.shopSel = 0;
        this.renderShop();
      });
      this.shop.add(b);
      tabX += b.width_ + 4;
    }

    items.forEach((item, i) => {
      const tx = x0 + pad + (i % cols) * (tw + gap);
      const ty = y0 + top + Math.floor(i / cols) * (th + gap);
      const sel = i === this.shopSel;
      const afford = store.coins >= item.price;
      const tile = this.add.graphics();
      const draw = (hover: boolean) => {
        tile.clear();
        pixBox(tile, tx, ty, tw, th, sel ? 0xfff8e8 : hover ? 0xfdeccc : C.paperLight, sel ? C.coral : C.paperDark);
      };
      draw(false);
      const icon = this.add.image(tx + tw / 2, ty + 59, item.texture).setOrigin(0.5, 1);
      if (!afford) icon.setAlpha(0.55);
      const price = ptext(this, 0, ty + 60, `${item.price}¢`, afford ? C.ink : C.red, "pxb");
      price.setX(tx + Math.round((tw - measure(price).w) / 2));
      // Who loves it: their little heads in the corner. A gold ★ if someone's wishing for it today.
      const heads = item.likes.map((v, k) => this.add.image(tx + 3 + k * 8, ty + 3, `vicon_${v}_0`).setOrigin(0));
      const wished = store.requests.find((r) => r.kind === "wish" && !r.done && r.item === item.id);
      const star = wished ? ptext(this, tx + tw - 9, ty + 3, "★", 0xd99a1e, "pxb") : null;
      const hit = this.add.zone(tx, ty, tw, th).setOrigin(0).setInteractive({ useHandCursor: true });
      const tipText = `${item.name}\n♥ ${item.likes.map((v) => VILLAGER_SHORT[v]).join(" & ")} love${item.likes.length === 1 ? "s" : ""} this${wished ? `\n★ ${VILLAGER_SHORT[wished.villager]} wishes for one!` : ""}`;
      hit.on("pointerover", () => {
        draw(true);
        this.shopTip?.destroy();
        this.shopTip = new Label(this, tx + tw / 2, ty - 2, tipText, { maxWidth: 150, tail: true }).setDepth(4600);
      });
      hit.on("pointerout", () => {
        draw(false);
        this.shopTip?.destroy();
        this.shopTip = null;
      });
      hit.on("pointerdown", () => {
        sfx.blip();
        this.shopSel = i;
        this.renderShop();
      });
      this.shop.add([tile, icon, price, ...heads, ...(star ? [star] : []), hit]);
    });

    // Details of the selected item.
    const item = items[this.shopSel] ?? items[0];
    const dy = y0 + top + gridH + 8;
    const panel = this.add.graphics();
    pixBox(panel, x0 + pad, dy, pw - pad * 2, 46, C.paperLight, C.paperDark);
    const afford = store.coins >= item.price;
    const btnW = 64;
    const name = ptext(this, x0 + pad + 6, dy + 5, item.name, C.ink, "pxb");
    const blurb = ptext(this, x0 + pad + 6, dy + 16, item.blurb, C.inkSoft).setMaxWidth(pw - pad * 2 - btnW - 18);
    const fans = item.likes.map((v) => VILLAGER_SHORT[v]).join(" & ");
    const wish = store.requests.find((r) => r.kind === "wish" && !r.done && r.item === item.id);
    const loves = ptext(this, x0 + pad + 6, dy + 31, wish ? `★ ${VILLAGER_SHORT[wish.villager]} wishes for this! Put it in their yard: +${wish.reward}¢` : `♥ ${fans} love${item.likes.length === 1 ? "s" : ""} this by their home`, wish ? 0xb07a10 : C.coral);
    const buy = new Button(this, x0 + pw - pad - btnW - 6, dy + 16, afford ? `BUY ${item.price}¢` : `NEED ${item.price}¢`, afford ? C.greenBtn : 0x8a8199, () => {
      if (store.coins < item.price) {
        sfx.deny();
        this.cameras.main.shake(120, 0.004);
        return;
      }
      sfx.blip();
      this.closeShop();
      this.game.events.emit("begin-place", item.id);
    }, btnW);
    this.shop.add([panel, name, blurb, loves, buy]);
  }

  private toggleShop() {
    this.shopOpen ? this.closeShop() : this.openShop();
  }

  private openShop() {
    this.shopOpen = true;
    this.registry.set("shopOpen", true);
    this.renderShop();
    this.shop.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.shop, alpha: 1, duration: 120 });
    sfx.blip();
  }

  private shopTip: Label | null = null;

  private closeShop() {
    this.shopTip?.destroy();
    this.shopTip = null;
    this.shopOpen = false;
    this.registry.set("shopOpen", false);
    this.shop.setVisible(false);
  }
}
