// Inside the Office. You're the project manager: brief the team at the board,
// then watch each worker (one per sub-agent) walk in from the elevator, sit at
// a desk and work, with what they're doing right now over their monitor.
// Everything here mirrors the server's office state (store.office).

import Phaser from "phaser";
import type { OfficeWorker } from "../../../shared/game";
import { BOARD, DESKS, ELEVATOR, ROOM_H, ROOM_W } from "../officeart";
import * as net from "../net";
import { isPanelOpen, openOfficeBoard, openOfficeWorker } from "../panel";
import { sfx } from "../sfx";
import { store } from "../store";
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
  w: OfficeWorker;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  bubble: Label;
  seated: boolean;
  leaving: boolean;
}

const SEAT_DY = 16;

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
  private boardTexts: Phaser.GameObjects.BitmapText[] = [];
  private prompt!: Label;
  private promptText = "";
  private target: Spot | null = null;
  private lastAction = "";
  private projectId: string | null = null;
  private unsubs: Array<() => void> = [];

  constructor() {
    super("Office");
  }

  create() {
    this.solids = [];
    this.desks = [];
    this.workers.clear();
    this.boardTexts = [];
    this.projectId = null;
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
    prop("office_plant", 20, 270, 16);
    prop("office_plant", 428, 270, 16);
    prop("office_plant", 150, 96, 16);

    // The team lead stands by the board.
    const lx = BOARD.x + BOARD.w / 2 + 16;
    this.add.image(lx, 94, shadowKey(this, 12)).setDepth(-8);
    this.lead = this.add.image(lx, 95, "office_lead").setOrigin(0.5, 1).setDepth(95);
    this.solids.push(new Phaser.Geom.Rectangle(lx - 6, 88, 12, 8));
    this.leadBubble = new Label(this, lx, 64, "", { maxWidth: 120, tail: true, font: "px" }).setDepth(99990).setVisible(false);
    new Label(this, lx, 97, "Team Lead", { bg: C.paper, border: C.paperDark, originY: 0, padX: 2 }).setDepth(96);

    this.player = this.add.sprite(ELEVATOR.x, ELEVATOR.y - 18, "astro_3").setOrigin(0.5, 1);
    this.prompt = new Label(this, 0, 0, "", { bg: C.wood, border: C.woodDark, color: C.paperLight, font: "pxb" }).setDepth(99999).setVisible(false);

    const cam = this.cameras.main;
    cam.setRoundPixels(true);
    cam.setBackgroundColor("#0b0a1a");
    this.fitCamera();
    this.scale.on("resize", this.fitCamera, this);

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys("W,A,S,D,E") as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on("keydown-E", () => {
      if (!isPanelOpen()) this.target?.act();
    });
    const press = () => {
      if (this.sys.isActive() && !isPanelOpen()) this.target?.act();
    };
    this.game.events.on("action-press", press);
    this.unsubs.push(net.onOffice(() => this.sync()), net.onSnapshot(() => this.sync()));
    this.events.on(Phaser.Scenes.Events.WAKE, () => {
      this.player.setPosition(ELEVATOR.x, ELEVATOR.y - 18);
      this.lastAction = "";
      this.cameras.main.fadeIn(250, 11, 10, 26);
      this.sync();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      this.game.events.off("action-press", press);
      this.scale.off("resize", this.fitCamera, this);
    });
    cam.fadeIn(250, 11, 10, 26);
    this.sync();
  }

  /** Small screens scroll with you; big ones show the whole room, centered. */
  private fitCamera() {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    cam.setBounds(Math.min(0, (ROOM_W - width) / 2), Math.min(0, (ROOM_H - height) / 2 - 12), Math.max(ROOM_W, width), Math.max(ROOM_H, height) + 24);
    cam.startFollow(this.player, true, 1, 1);
  }

  // ---------------------------------------------------------------- mirroring the server

  private sync() {
    const p = store.office.project;
    // A new project (or none): everyone from the last one heads home.
    if ((p?.id ?? null) !== this.projectId) {
      for (const v of this.workers.values()) this.leave(v);
      this.projectId = p?.id ?? null;
    }
    for (const w of p?.workers ?? []) {
      const v = this.workers.get(w.id);
      if (!v) this.arrive(w);
      else {
        v.w = w;
        this.renderWorker(v);
      }
    }
    // Desks nobody sits at go dark.
    DESKS.forEach((_, i) => {
      const sitting = [...this.workers.values()].some((v) => !v.leaving && v.seated && v.w.desk === i);
      if (!sitting) this.desks[i].stop().setTexture("desk_off");
    });
    this.renderBoard();
  }

  private seat(w: OfficeWorker) {
    const d = DESKS[w.desk % DESKS.length];
    return { x: d.x, y: d.y + SEAT_DY };
  }

  /** A new sub-agent walks in from the elevator and sits at their desk. */
  private arrive(w: OfficeWorker) {
    const s = this.seat(w);
    const sprite = this.add.sprite(ELEVATOR.x, ELEVATOR.y - 4, `worker_front_${w.look}`).setOrigin(0.5, 1);
    const shadow = this.add.image(sprite.x, sprite.y - 1, shadowKey(this, 12)).setDepth(-8);
    const bubble = new Label(this, s.x, s.y - 50, "", { maxWidth: 100, tail: true, font: "px" }).setDepth(99990).setVisible(false);
    const v: WorkerView = { w, sprite, shadow, bubble, seated: false, leaving: false };
    this.workers.set(w.id, v);
    sfx.blip();
    // Walk up the aisle, then across to the desk.
    this.tweens.chain({
      targets: sprite,
      tweens: [
        { x: ELEVATOR.x, y: s.y + 20, duration: Math.abs(ELEVATOR.y - s.y) * 12, ease: "linear" },
        { x: s.x, y: s.y + 20, duration: Math.abs(ELEVATOR.x - s.x) * 12 + 1, ease: "linear" },
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
    v.sprite.stop().setTexture(`worker_front_${v.w.look}`);
    this.tweens.chain({
      targets: v.sprite,
      tweens: [
        { y: v.sprite.y + 20, duration: 240, ease: "linear" },
        { x: ELEVATOR.x, duration: Math.abs(v.sprite.x - ELEVATOR.x) * 12 + 1, ease: "linear" },
        { y: ELEVATOR.y, duration: 700, ease: "linear" },
      ],
      onComplete: () => {
        v.sprite.destroy();
        v.shadow.destroy();
        this.workers.delete(v.w.id);
      },
    });
  }

  private renderWorker(v: WorkerView) {
    if (v.leaving) return;
    const w = v.w;
    const desk = this.desks[w.desk % DESKS.length];
    if (!v.seated) return;
    if (w.status === "working") {
      v.sprite.play(`worker-typing-${w.look}`, true);
      if (desk.anims.currentAnim?.key !== "desk-coding" || !desk.anims.isPlaying) desk.play("desk-coding");
    } else {
      v.sprite.stop().setTexture(`worker_back_${w.look}_0`);
      desk.stop().setTexture(w.status === "done" ? "desk_done" : "desk_failed");
    }
    const text = w.status === "done" ? "done!" : w.status === "failed" ? "stuck" : w.step.length > 44 ? `${w.step.slice(0, 41)}...` : w.step;
    if (text !== v.bubble.getData("text")) {
      v.bubble.setData("text", text).setText(text);
    }
    v.bubble.setVisible(true);
  }

  /** The board on the wall: the project, and who's doing what. */
  private renderBoard() {
    this.boardTexts.forEach((t) => t.destroy());
    this.boardTexts = [];
    const p = store.office.project;
    const bx = BOARD.x - BOARD.w / 2;
    const text = (x: number, y: number, s: string, color: number) => this.boardTexts.push(ptext(this, x, y, s, color).setDepth(-5));
    const cols = [bx + 4, bx + 4 + (BOARD.w - 8) / 3, bx + 4 + ((BOARD.w - 8) * 2) / 3];
    text(cols[0], 13, "TO DO", C.inkSoft);
    text(cols[1], 13, "DOING", C.inkSoft);
    text(cols[2], 13, "DONE", C.inkSoft);
    if (!p) {
      text(bx + 6, 34, "No project yet - brief the team!", C.coral);
      this.leadBubble.setVisible(false);
      return;
    }
    const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 2)}..` : s);
    text(bx + 6, 46, clip(p.brief.split("\n")[0], 36), C.ink);
    if (p.status === "planning") text(cols[0], 23, "planning...", C.ink);
    p.workers.slice(0, 6).forEach((w) => {
      const col = w.status === "working" ? 1 : 2;
      const row = p.workers.filter((x) => (x.status === "working" ? 1 : 2) === col).indexOf(w);
      if (row < 2) text(cols[col], 23 + row * 10, clip(`${w.name}${w.status === "failed" ? " (!)" : ""}`, 11), w.status === "failed" ? C.red : C.ink);
    });
    const talking = ["planning", "wrapping"].includes(p.status) || p.status === "done";
    this.leadBubble.setVisible(talking);
    if (talking) this.leadBubble.setText(p.status === "done" ? "Delivered! It's on the board." : p.lead.length > 60 ? `${p.lead.slice(0, 57)}...` : p.lead);
  }

  // ---------------------------------------------------------------- you

  private findTarget(): Spot | null {
    const px = this.player.x;
    const py = this.player.y;
    const options: Spot[] = [];
    const add = (s: Spot, r: number) => s.d < r && options.push(s);
    add({ verb: "BOARD", label: "[E] project board", x: BOARD.x, y: 80, d: Math.hypot(px - BOARD.x, py - 84), act: () => openOfficeBoard() }, 70);
    const lx = this.lead.x;
    add({ verb: "BOARD", label: "[E] talk to the team lead", x: lx, y: 64, d: Math.hypot(px - lx, py - 96), act: () => openOfficeBoard() }, 26);
    for (const v of this.workers.values()) {
      if (v.leaving) continue;
      add({ verb: "CHECK IN", label: `[E] check on ${v.w.name}`, x: v.sprite.x, y: v.sprite.y + 4, d: Math.hypot(px - v.sprite.x, py - v.sprite.y - 6), act: () => openOfficeWorker(v.w.id) }, 30);
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

  private blocked(x: number, y: number) {
    return this.solids.some((r) => r.contains(x, y));
  }

  update(_time: number, delta: number) {
    const dt = delta / 1000;
    const frozen = isPanelOpen();
    if (!frozen) this.move(dt);
    else this.player.anims.stop();
    this.player.setDepth(this.player.y);
    for (const v of this.workers.values()) {
      v.sprite.setDepth(v.sprite.y);
      v.shadow.setPosition(Math.round(v.sprite.x), Math.round(v.sprite.y) - 1);
      if (!v.leaving) v.bubble.place(Math.round(v.sprite.x), Math.round(v.sprite.y) - 46);
    }
    this.target = frozen ? null : this.findTarget();
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
