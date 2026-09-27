// Inside the Office: your coding agents at work. The main Claude Code session
// is the team lead by the board; every subagent it sends out walks in from the
// elevator, takes a desk and works there, with what it's doing right now over
// its monitor (code scrolling while it uses tools, "..." while it thinks). When
// it finishes it heads home. Walk up to anyone to read their live feed.
// Everything here mirrors the server's view of your sessions (store.agents).

import Phaser from "phaser";
import type { AgentInfo, AgentSession } from "../../../shared/game";
import { BOARD, DESKS, ELEVATOR, ROOM_H, ROOM_W, WORKER_LOOKS } from "../officeart";
import * as net from "../net";
import { NearTalk, type Talker } from "../neartalk";
import { isMoonPadOpen } from "../tablet";
import { AGENT_STATUS, isPanelOpen, openAgent, openAgentBoard } from "../panel";
import { visiting } from "../multiplayer";
import { sfx } from "../sfx";
import { agents, focusedSession } from "../store";
import { shadowKey } from "../textures";
import { C, Label, ptext } from "../widgets";

interface Spot {
  verb: string;
  label: string;
  x: number;
  y: number;
  d: number;
  act: () => void;
}

interface WorkerView {
  a: AgentInfo;
  desk: number;
  look: number;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  bubble: Label;
  seated: boolean;
  leaving: boolean;
  /** When we first saw it finished (it heads home a little later). */
  doneSeen: number;
}

const SEAT_DY = 16;
/** Finished agents stay at their desk this long before heading home. */
const LINGER_MS = 40_000;
/** Close enough to a worker to see their name as well as what they're doing. */
const NEAR = 64;

const isActive = (a: AgentInfo) => a.status !== "done" && a.status !== "failed";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 2)}..` : s);
/** Everyone keeps the same look for the whole job. */
const lookFor = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % WORKER_LOOKS;
};

export class OfficeScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private facing: "down" | "up" | "side" = "up";
  private solids: Phaser.Geom.Rectangle[] = [];
  private desks: Phaser.GameObjects.Sprite[] = [];
  private workers = new Map<string, WorkerView>();
  private lead!: Phaser.GameObjects.Image;
  private leadBubble!: Label;
  private leadStar!: Phaser.GameObjects.Image;
  private idle = false;
  private boardTexts: Phaser.GameObjects.BitmapText[] = [];
  private boardSig = "";
  private prompt!: Label;
  private promptText = "";
  private target: Spot | null = null;
  private lastAction = "";
  private sessionId: string | null = null;
  /** The first look after walking in: agents already at work are sitting down, not arriving. */
  private settled = false;
  private unsubs: Array<() => void> = [];
  /** Talking with Ada: the same as with any neighbor outside (speak or type; her answers over her head). */
  private near!: NearTalk;
  private ada!: Talker;
  private talkBubble: Label | null = null;
  private talkTimer: Phaser.Time.TimerEvent | null = null;
  private typingCapture = false;

  constructor() {
    super("Office");
  }

  create() {
    this.solids = [];
    this.desks = [];
    this.workers.clear();
    this.boardTexts = [];
    this.boardSig = "";
    this.sessionId = null;
    this.settled = false;
    this.lastAction = "";

    this.add.image(0, 0, "office_room").setOrigin(0).setDepth(-10);
    // Walls and furniture you can't walk through.
    this.solids.push(new Phaser.Geom.Rectangle(0, 0, ROOM_W, 72), new Phaser.Geom.Rectangle(0, 0, 8, ROOM_H), new Phaser.Geom.Rectangle(ROOM_W - 8, 0, 8, ROOM_H), new Phaser.Geom.Rectangle(0, ROOM_H - 12, ROOM_W, 12));
    DESKS.forEach((d) => {
      this.desks.push(this.add.sprite(d.x, d.y, "desk_off").setOrigin(0.5, 1).setDepth(d.y));
      this.solids.push(new Phaser.Geom.Rectangle(d.x - 24, d.y - 12, 48, 12 + SEAT_DY));
    });
    const prop = (key: string, x: number, y: number, solidW: number) => {
      this.add.image(x, y - 1, shadowKey(this, solidW)).setDepth(-8);
      this.add.image(x, y, key).setOrigin(0.5, 1).setDepth(y);
      this.solids.push(new Phaser.Geom.Rectangle(x - solidW / 2, y - 8, solidW, 8));
    };
    prop("office_couch", 62, 96, 52);
    prop("office_coffee", 424, 100, 18);
    prop("office_plant", 20, ROOM_H - 18, 16);
    prop("office_plant", 428, ROOM_H - 18, 16);
    prop("office_plant", 150, 96, 16);

    // The team lead (your main session) stands by the board.
    const lx = BOARD.x + BOARD.w / 2 + 16;
    this.add.image(lx, 94, shadowKey(this, 12)).setDepth(-8);
    this.lead = this.add.image(lx, 95, "office_lead").setOrigin(0.5, 1).setDepth(95);
    this.solids.push(new Phaser.Geom.Rectangle(lx - 6, 88, 12, 8));
    this.leadBubble = new Label(this, lx, 64, "", { maxWidth: 110, tail: true, font: "px" }).setDepth(99990).setVisible(false);
    // A gold ★ over the lead when nobody's working (press E for a replay).
    this.leadStar = this.add.image(lx, 60, "icon_quests_0").setDepth(99991).setVisible(false);
    // (its name plate sits beside it, clear of the first row's bubbles)
    new Label(this, lx + 9, 84, "Ada", { bg: C.paper, border: C.paperDark, originX: 0, originY: 0, padX: 2 }).setDepth(96);

    this.player = this.add.sprite(ELEVATOR.x, ELEVATOR.y - 18, "astro_3").setOrigin(0.5, 1);
    // Ada, as someone to talk to: where she stands, and her words in a bubble over her head.
    const lead = this.lead;
    const scene = this;
    this.ada = {
      get x() {
        return lead.x;
      },
      get y() {
        return lead.y;
      },
      sprite: lead,
      say: (text: string, ms = 3200, originX = 0.5) => {
        scene.talkBubble?.destroy();
        scene.talkTimer?.remove();
        const clipped = text.length > 120 ? text.slice(0, 117) + "..." : text;
        scene.talkBubble = new Label(scene, lead.x, lead.y - 30, clipped, { maxWidth: 130, tail: true, originX }).setDepth(99996);
        scene.talkTimer = scene.time.delayedCall(Math.max(ms, clipped.length * 45), () => {
          scene.talkBubble?.destroy();
          scene.talkBubble = null;
        });
      },
    };
    const nearAda = (r: number) => Math.hypot(this.player.x - lead.x, this.player.y - 8 - lead.y) < r;
    this.near = new NearTalk({
      scene: this,
      player: () => this.player,
      actor: (v) => (v === "manager" ? this.ada : undefined),
      nearest: () => (nearAda(40) ? "manager" : null),
      around: (r) => (nearAda(r) ? ["manager"] : []),
      hold: () => {},
      release: () => {},
      blocked: () => this.frozen(false),
      greeting: () => "Ada, Team Lead. I keep an eye on your coding agents. Want the status report?",
    });
    // Her answers come back as she thinks them up.
    this.unsubs.push(
      net.onEvent((e) => {
        if (e.type !== "say" || e.villager !== "manager") return;
        if (this.near.isWith("manager")) this.near.reply("manager", e.text);
        else this.ada.say(e.text, 4000);
      }),
    );
    this.prompt = new Label(this, 0, 0, "", { bg: C.wood, border: C.woodDark, color: C.paperLight, font: "pxb" }).setDepth(99999).setVisible(false);

    const cam = this.cameras.main;
    cam.setRoundPixels(true);
    cam.setBackgroundColor("#0b0a1a");
    this.fitCamera();
    this.scale.on("resize", this.fitCamera, this);

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys("W,A,S,D,E") as Record<string, Phaser.Input.Keyboard.Key>;
    // E or SPACE, same as outside.
    for (const key of ["keydown-E", "keydown-SPACE"])
      kb.on(key, () => {
        if (!this.frozen()) this.target?.act();
      });
    const press = () => {
      if (this.sys.isActive() && !this.frozen()) this.target?.act();
    };
    this.game.events.on("action-press", press);
    this.unsubs.push(net.onAgents(() => this.sync()));
    // Elapsed times and "heading home" move on even when no update comes in.
    const tick = this.time.addEvent({ delay: 1000, loop: true, callback: () => this.sync() });
    const onWake = () => {
      this.player.setPosition(ELEVATOR.x, ELEVATOR.y - 18);
      this.lastAction = "";
      this.cameras.main.fadeIn(250, 11, 10, 26);
      this.sync();
    };
    this.events.on(Phaser.Scenes.Events.WAKE, onWake);
    // Heading back outside: the chat with Ada closes and the mic stops listening in here.
    const onSleep = () => this.near.hush();
    this.events.on(Phaser.Scenes.Events.SLEEP, onSleep);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.SLEEP, onSleep);
      this.near.destroy();
      this.events.off(Phaser.Scenes.Events.WAKE, onWake);
      tick.remove();
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      this.game.events.off("action-press", press);
      this.scale.off("resize", this.fitCamera, this);
    });
    cam.fadeIn(250, 11, 10, 26);
    this.sync();
    this.settled = true;
    this.firstVisit();
  }

  /** Small screens scroll with you; big ones show the whole room, centered. */
  private fitCamera() {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    cam.setBounds(Math.min(0, (ROOM_W - width) / 2), Math.min(0, (ROOM_H - height) / 2 - 12), Math.max(ROOM_W, width), Math.max(ROOM_H, height) + 24);
    cam.startFollow(this.player, true, 1, 1);
  }

  // ---------------------------------------------------------------- mirroring your agents

  private sync() {
    if (!this.sys.isActive() && this.settled) return;
    const s = focusedSession();
    // A different session (or none): everyone from the last one heads home.
    if ((s?.id ?? null) !== this.sessionId) {
      for (const v of this.workers.values()) this.leave(v);
      this.sessionId = s?.id ?? null;
    }
    const now = Date.now();
    for (const a of s?.workers ?? []) {
      const v = this.workers.get(a.id);
      if (v) {
        v.a = a;
        if (!isActive(a) && !v.doneSeen) v.doneSeen = now;
        if (v.doneSeen && now - v.doneSeen > LINGER_MS) this.leave(v);
        else this.renderWorker(v);
        continue;
      }
      // Newly seen: working agents come in (finished ones are just on the board).
      if (!isActive(a)) continue;
      const desk = this.freeDesk();
      if (desk < 0) continue;
      this.arrive(a, desk, !this.settled);
    }
    // Agents that dropped off the list head home too.
    for (const v of this.workers.values()) if (!s?.workers.some((a) => a.id === v.a.id)) this.leave(v);
    // Desks nobody sits at go dark.
    DESKS.forEach((_, i) => {
      const sitting = [...this.workers.values()].some((v) => !v.leaving && v.seated && v.desk === i);
      if (!sitting && this.desks[i].texture.key !== "desk_off") this.desks[i].stop().setTexture("desk_off");
    });
    this.renderLead(s);
    this.renderBoard(s);
  }

  private freeDesk() {
    const taken = new Set([...this.workers.values()].filter((v) => !v.leaving).map((v) => v.desk));
    for (let i = 0; i < DESKS.length; i++) if (!taken.has(i)) return i;
    return -1;
  }

  private seat(desk: number) {
    const d = DESKS[desk];
    return { x: d.x, y: d.y + SEAT_DY };
  }

  /** A new subagent walks in from the elevator and sits at its desk (or is already there, if you just walked in). */
  private arrive(a: AgentInfo, desk: number, instantly: boolean) {
    const s = this.seat(desk);
    const look = lookFor(a.id);
    const sprite = this.add.sprite(instantly ? s.x : ELEVATOR.x, instantly ? s.y : ELEVATOR.y - 4, instantly ? `worker_back_${look}_0` : `worker_front_${look}`).setOrigin(0.5, 1);
    const shadow = this.add.image(sprite.x, sprite.y - 1, shadowKey(this, 12)).setDepth(-8);
    const bubble = new Label(this, s.x, s.y - 46, "", { maxWidth: 100, tail: true, font: "px" }).setDepth(99990).setVisible(false);
    const v: WorkerView = { a, desk, look, sprite, shadow, bubble, seated: instantly, leaving: false, doneSeen: 0 };
    this.workers.set(a.id, v);
    if (instantly) return this.renderWorker(v);
    sfx.blip();
    // Up the aisle, across to the desk, and sit.
    this.tweens.chain({
      targets: sprite,
      tweens: [
        { x: ELEVATOR.x, y: s.y + 20, duration: Math.abs(ELEVATOR.y - s.y) * 11, ease: "linear" },
        { x: s.x, y: s.y + 20, duration: Math.abs(ELEVATOR.x - s.x) * 11 + 1, ease: "linear" },
        { x: s.x, y: s.y, duration: 240, ease: "linear" },
      ],
      onComplete: () => {
        v.seated = true;
        this.renderWorker(v);
      },
    });
  }

  private leave(v: WorkerView) {
    if (v.leaving) return;
    v.leaving = true;
    v.seated = false;
    v.bubble.destroy();
    this.tweens.killTweensOf(v.sprite);
    v.sprite.stop().setTexture(`worker_front_${v.look}`);
    this.tweens.chain({
      targets: v.sprite,
      tweens: [
        { y: v.sprite.y + 20, duration: 240, ease: "linear" },
        { x: ELEVATOR.x, duration: Math.abs(v.sprite.x - ELEVATOR.x) * 11 + 1, ease: "linear" },
        { y: ELEVATOR.y, duration: Math.max(200, (ELEVATOR.y - v.sprite.y - 20) * 11), ease: "linear" },
      ],
      onComplete: () => {
        v.sprite.destroy();
        v.shadow.destroy();
        if (this.workers.get(v.a.id) === v) this.workers.delete(v.a.id);
      },
    });
  }

  private renderWorker(v: WorkerView) {
    if (v.leaving || !v.seated) return;
    const a = v.a;
    const desk = this.desks[v.desk];
    const play = (key: string) => {
      if (desk.anims.currentAnim?.key !== key || !desk.anims.isPlaying) desk.play(key);
    };
    if (a.status === "working") {
      v.sprite.play(`worker-typing-${v.look}`, true);
      play("desk-coding");
    } else {
      v.sprite.stop().setTexture(`worker_back_${v.look}_0`);
      if (a.status === "thinking") play("desk-thinking");
      else desk.stop().setTexture(a.status === "done" ? "desk_done" : a.status === "failed" ? "desk_failed" : "desk_wait");
    }
    v.bubble.setVisible(true);
  }

  /** The bubble over each desk: what they're doing (and their name, up close). */
  private bubbleText(v: WorkerView, near: boolean) {
    const a = v.a;
    const doing = a.status === "done" ? "done ✓" : a.status === "failed" ? "stopped" : a.status === "waiting" ? `needs you: ${a.now}` : a.status === "thinking" ? `... ${a.now}` : a.now;
    return near ? `${clip(a.name, 40)}\n${clip(doing, 40)}` : clip(doing, 21);
  }

  private renderLead(s: AgentSession | null) {
    this.idle = !s;
    if (!s) {
      this.leadBubble.setText(agents.state.link && agents.state.link.status !== "linked" ? "Link your Claude Code at the board!" : "Nobody's working. Want a replay?");
    } else {
      const l = s.lead;
      const text = l.status === "waiting" ? "Waiting for you" : `${l.status === "thinking" ? "... " : ""}${l.now}`;
      this.leadBubble.setText(clip(text, 50));
    }
    this.leadBubble.setVisible(true);
  }

  /** The board on the wall: the session, the lead, who's working and who's done. */
  private renderBoard(s: AgentSession | null) {
    const working = s?.workers.filter(isActive) ?? [];
    const done = s ? s.workers.length - working.length : 0;
    const seated = [...this.workers.values()].filter((v) => !v.leaving).length;
    const sig = s ? `${s.id}|${s.title}|${s.lead.status}|${working.map((w) => w.name).join(",")}|${done}|${seated}|${Math.round((s.replay?.progress ?? 0) * 20)}` : `none|${agents.state.link?.status ?? ""}`;
    if (sig === this.boardSig) return;
    this.boardSig = sig;
    this.boardTexts.forEach((t) => t.destroy());
    this.boardTexts = [];
    const bx = BOARD.x - BOARD.w / 2;
    const text = (x: number, y: number, str: string, color: number) => this.boardTexts.push(ptext(this, x, y, str, color).setDepth(-5));
    const colW = (BOARD.w - 8) / 3;
    const cols = [bx + 4, bx + 4 + colW, bx + 4 + colW * 2];
    text(cols[0], 13, "LEAD", C.inkSoft);
    text(cols[1], 13, working.length ? `WORKING ${working.length}` : "WORKING", C.inkSoft);
    text(cols[2], 13, done ? `DONE ${done}` : "DONE", C.inkSoft);
    if (!s) {
      text(bx + 6, 30, "No agents running.", C.coral);
      const l = agents.state.link;
      if (!visiting()) text(bx + 6, 46, l && l.status !== "linked" ? "Press E here to LINK yours" : "Press E here for a replay", C.ink);
      return;
    }
    text(cols[0], 23, AGENT_STATUS[s.lead.status], C.ink);
    working.slice(0, 2).forEach((w, i) => text(cols[1], 23 + i * 10, clip(w.name, 11), C.ink));
    s.workers.filter((w) => !isActive(w)).slice(-2).forEach((w, i) => text(cols[2], 23 + i * 10, clip(w.name, 11), w.status === "failed" ? C.red : C.green));
    // Past twelve at once, the rest work from the hallway (still on the board and in INSPECT).
    const standing = working.length - [...this.workers.values()].filter((v) => !v.leaving && isActive(v.a)).length;
    if (standing > 0) text(cols[0], 33, `+${standing} no desk`, C.inkSoft);
    const tag = s.source === "replay" ? `REPLAY ${Math.round((s.replay?.progress ?? 0) * 100)}% · ` : "";
    text(bx + 6, 46, clip(`${tag}${s.title}`, 34), C.ink);
  }

  // ---------------------------------------------------------------- you

  private findTarget(): Spot | null {
    const px = this.player.x;
    const py = this.player.y;
    const s = focusedSession();
    const options: Spot[] = [];
    const add = (sp: Spot, r: number) => sp.d < r && options.push(sp);
    add({ verb: "BOARD", label: s ? "[E] the board" : visiting() ? "[E] the board" : agents.state.link ? "[E] link your Claude Code" : "[E] replay a session", x: BOARD.x, y: 80, d: Math.hypot(px - BOARD.x, py - 84), act: () => openAgentBoard() }, 70);
    const lx = this.lead.x;
    // Ada the Team Lead: talk to her like any neighbor (speak, or type; her answers over her head).
    add({ verb: "TALK", label: "[E] talk to Ada", x: lx, y: 64, d: Math.hypot(px - lx, py - 96), act: () => this.near.start("manager") }, 26);
    for (const v of this.workers.values()) {
      if (v.leaving || !s) continue;
      add({ verb: "WATCH", label: `[E] watch ${clip(v.a.name, 24)}`, x: v.sprite.x, y: v.sprite.y + 4, d: Math.hypot(px - v.sprite.x, py - v.sprite.y - 6), act: () => openAgent(s.id, v.a.id) }, 30);
    }
    add({ verb: "LEAVE", label: "[E] back outside", x: ELEVATOR.x, y: ELEVATOR.y - 40, d: Math.hypot(px - ELEVATOR.x, py - ELEVATOR.y), act: () => this.exit() }, 34);
    options.sort((a, b) => a.d - b.d);
    return options[0] ?? null;
  }

  private exit() {
    sfx.blip();
    this.cameras.main.fadeOut(220, 11, 10, 26);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.sleep();
      this.scene.wake("Game");
    });
  }

  /** A window is up (dialog, MoonPad or shop), or you're typing to Ada: keys belong to it, not to walking. */
  private frozen(typing = true) {
    return isPanelOpen() || isMoonPadOpen() || !!this.registry.get("shopOpen") || (typing && !!this.near?.typing);
  }

  /** The first time in: one sentence on what this place is. */
  private firstVisit() {
    const KEY = net.accountKey("moon-office-agents-seen");
    try {
      if (localStorage.getItem(KEY) === "1") return;
      localStorage.setItem(KEY, "1");
    } catch {
      /* show it anyway */
    }
    const live = agents.state.sessions.some((s) => s.source === "claude-code");
    const text = live
      ? "Your Office: every subagent your Claude Code session sends out takes a desk. Walk up to anyone to watch their work live, or ask Ada the Team Lead how it's going."
      : agents.state.link
        ? "Your Office shows your Claude Code agents live. Press E at the board and LINK the Claude Code on your computer (one command), or REPLAY a recorded session."
        : "Your Office shows your coding agents live: run Claude Code and each subagent takes a desk here. Nothing running? Press E at the board for a replay.";
    this.time.delayedCall(700, () => this.game.events.emit("hint", text, 9000));
  }

  private blocked(x: number, y: number) {
    return this.solids.some((r) => r.contains(x, y));
  }

  update(time: number, delta: number) {
    const dt = delta / 1000;
    // the ★ bobs over the lead when nobody's working (and the bubble moves up to make room)
    const near = Math.hypot(this.player.x - this.lead.x, this.player.y - this.lead.y) < 40;
    this.leadStar.setVisible(this.idle && !near).setY(Math.round(this.lead.y - 30 + Math.sin(time / 180) * 2));
    this.leadBubble.place(this.lead.x, this.idle && !near ? this.lead.y - 38 : this.lead.y - 31);
    const frozen = this.frozen();
    if (!frozen) this.move(dt);
    else this.player.anims.stop();
    this.player.setDepth(this.player.y);
    for (const v of this.workers.values()) {
      v.sprite.setDepth(v.sprite.y);
      v.shadow.setPosition(Math.round(v.sprite.x), Math.round(v.sprite.y) - 1);
      if (v.leaving || !v.seated) continue;
      const close = Math.hypot(this.player.x - v.sprite.x, this.player.y - v.sprite.y) < NEAR;
      const text = this.bubbleText(v, close);
      if (text !== v.bubble.getData("text")) v.bubble.setData("text", text).setText(text);
      v.bubble.setDepth(close ? 99995 : 99990).place(Math.round(v.sprite.x), Math.round(v.sprite.y) - 46);
    }
    this.target = frozen ? null : this.findTarget();
    this.near.update();
    this.talkBubble?.place(this.lead.x, this.lead.y - 30);
    // (while she's answering you, her status bubble steps aside)
    this.leadBubble.setAlpha(this.talkBubble ? 0 : 1);
    // While you type, keys go to your words (not to walking).
    if (this.near.typing !== this.typingCapture) {
      this.typingCapture = this.near.typing;
      if (this.typingCapture) this.input.keyboard!.disableGlobalCapture();
      else this.input.keyboard!.enableGlobalCapture();
    }
    const action = this.target ? this.target.verb : "";
    if (action !== this.lastAction) {
      this.lastAction = action;
      this.game.events.emit("action", this.target ? { verb: this.target.verb, hold: false } : null);
    }
    this.prompt.setVisible(!!this.target);
    if (this.target) {
      if (this.target.label !== this.promptText) this.prompt.setText((this.promptText = this.target.label));
      this.prompt.place(this.target.x, this.target.y);
    }
  }

  private move(dt: number) {
    const left = this.cursors.left.isDown || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    const up = this.cursors.up.isDown || this.keys.W.isDown;
    const down = this.cursors.down.isDown || this.keys.S.isDown;
    let dx = (right ? 1 : 0) - (left ? 1 : 0);
    let dy = (down ? 1 : 0) - (up ? 1 : 0);
    if (dx === 0 && dy === 0) {
      this.player.anims.stop();
      this.player.setTexture({ down: "astro_0", up: "astro_3", side: "astro_6" }[this.facing]);
      return;
    }
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    const nx = this.player.x + dx * 110 * dt;
    const ny = this.player.y + dy * 110 * dt;
    if (!this.blocked(nx, this.player.y)) this.player.x = nx;
    if (!this.blocked(this.player.x, ny)) this.player.y = ny;
    if (Math.abs(dx) > Math.abs(dy)) {
      this.facing = "side";
      this.player.setFlipX(dx < 0);
    } else {
      this.facing = dy < 0 ? "up" : "down";
      this.player.setFlipX(false);
    }
    this.player.anims.play(`walk-${this.facing}`, true);
  }
}
