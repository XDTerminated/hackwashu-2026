// The MoonPad: text any villager from anywhere on the island. Texts are for
// getting to know them (they remember what you tell them, and friendship
// grows); real work only happens when you visit their house in person.

import Phaser from "phaser";
import QRCode from "qrcode";
import { BUILDINGS, MAX_HEARTS, VILLAGER_HOME, VILLAGER_NAMES, heartsFor, type TaskSource, type VillagerId } from "../../shared/game";
import { sanitize } from "./font";
import * as net from "./net";
import type { PhoneLinkMsg } from "./net";
import { closePanel, setUiOpen } from "./panel";
import { sfx } from "./sfx";
import { store } from "./store";
import { claimInput, input, releaseInput, type InputOwner } from "./textinput";
import { Button, C, Label, fit, measure, ptext } from "./widgets";

type Msg = { from: "you" | "them" | "sys"; text: string; tag?: string };

const ORDER: VillagerId[] = ["jade_rabbit", "stargazer", "postmaster", "timekeeper", "scholar"];
const AVATAR: Record<VillagerId, string> = {
  jade_rabbit: "rabbit_0",
  stargazer: "stargazer_0",
  postmaster: "postmaster_0",
  timekeeper: "timekeeper_0",
  scholar: "scholar_0",
};
const TAGS: Partial<Record<TaskSource, string>> = { game: "in person", phone: "from your phone" };
const SAVE_KEY = "moonpad-v1";

// ---------------------------------------------------------------- threads

const threads = new Map<VillagerId, Msg[]>();
const unread = new Map<VillagerId, number>();
const lastSource = new Map<VillagerId, TaskSource>();
const waiting = new Set<VillagerId>();
const unreadListeners = new Set<() => void>();

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as { threads: [VillagerId, Msg[]][]; unread: [VillagerId, number][] };
    data.threads.forEach(([v, m]) => threads.set(v, m));
    data.unread.forEach(([v, n]) => unread.set(v, n));
  } catch {
    /* private window or corrupt save — start empty */
  }
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ threads: [...threads], unread: [...unread] }));
  } catch {
    /* storage unavailable — history just won't persist */
  }
}

function push(v: VillagerId, m: Msg) {
  const list = threads.get(v) ?? [];
  list.push(m);
  threads.set(v, list.slice(-60));
  save();
  view?.refresh();
}

function bump(v: VillagerId) {
  if (view?.showing === v) return;
  unread.set(v, (unread.get(v) ?? 0) + 1);
  save();
  unreadListeners.forEach((fn) => fn());
}

export function unreadTotal() {
  return [...unread.values()].reduce((a, b) => a + b, 0);
}

export function onUnreadChange(fn: () => void) {
  unreadListeners.add(fn);
  return () => unreadListeners.delete(fn);
}

export function initMoonPad() {
  load();
  net.onPhoneLink((msg) => view?.onPhoneLink(msg));
  net.onEvent((e) => {
    if (e.type === "connections" || e.type === "friendship") view?.refresh();
    if (e.type === "text") {
      if (e.direction === "in") {
        push(e.villager, { from: "you", text: e.text, tag: e.via === "phone" ? "from your phone" : undefined });
        waiting.add(e.villager);
        view?.refresh();
      } else {
        waiting.delete(e.villager);
        push(e.villager, { from: "them", text: e.text });
        bump(e.villager);
        if (!view?.visible) sfx.message();
      }
      return;
    }
    if (e.type === "task_start") {
      lastSource.set(e.villager, e.from);
      if (e.from === "chore") push(e.villager, { from: "sys", text: "did a chore round on their own" });
      else if (e.from !== "moonpad") push(e.villager, { from: "you", text: e.text, tag: TAGS[e.from] });
    } else if (e.type === "say") {
      waiting.delete(e.villager);
      push(e.villager, { from: "them", text: e.text });
      // Replies to texts (and chore reports) are texts back; in-person replies you already saw.
      if (lastSource.get(e.villager) !== "game") {
        bump(e.villager);
        if (!view?.visible) sfx.message();
      }
    } else if (e.type === "handoff" && e.from === "jade_rabbit") {
      push("jade_rabbit", { from: "sys", text: `asked ${VILLAGER_NAMES[e.to]} to help` });
    } else if (e.type === "approval_needed") {
      push(e.villager, { from: "sys", text: `needs your OK: ${e.approval.title} (letter at your door)` });
      bump(e.villager);
    }
  });
}

// ---------------------------------------------------------------- view

class MoonPadView {
  private root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Container;
  private maskG: Phaser.GameObjects.Graphics;
  private box = { x: 0, y: 0, w: 0, h: 0 };
  private screen = { x: 0, y: 0, w: 0, h: 0 };
  private scroll = 0;
  private contentH = 0;
  private inputT: Phaser.GameObjects.BitmapText | null = null;
  private cursor: Phaser.GameObjects.Rectangle | null = null;
  /** A villager's thread, the phone-linking screen, or null for the contact list. */
  showing: VillagerId | "phones" | null = null;
  visible = false;
  private owner: InputOwner = {
    render: () => this.renderInput(),
    submit: () => (this.showing === "phones" ? this.submitPhone() : this.send()),
    active: () => this.visible && this.showing !== null,
  };

  constructor(private scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(4500).setVisible(false);
    this.body = scene.make.container({}, false);
    this.maskG = scene.make.graphics({}, false);
    scene.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!this.visible || !this.showing || this.showing === "phones") return;
      this.scroll += dy > 0 ? 11 : -11;
      this.applyScroll();
    });
    scene.time.addEvent({ delay: 480, loop: true, callback: () => this.cursor?.setVisible(!this.cursor.visible) });
  }

  open(v: VillagerId | "phones" | null = null) {
    this.visible = true;
    this.root.setVisible(true);
    this.showThread(v);
  }

  close() {
    this.visible = false;
    this.showing = null;
    this.root.setVisible(false);
    releaseInput(this.owner);
  }

  refresh() {
    if (this.visible) this.render();
  }

  showThread(v: VillagerId | "phones" | null) {
    this.showing = v;
    this.scroll = 1e9;
    if (v === "phones") {
      if (this.phoneStep === "number") claimInput(this.owner);
      else releaseInput(this.owner);
    }
    else if (v) {
      unread.delete(v);
      save();
      unreadListeners.forEach((fn) => fn());
      claimInput(this.owner);
    } else releaseInput(this.owner);
    this.render();
  }

  // --- frame

  private render() {
    const W = this.scene.scale.width;
    const H = this.scene.scale.height;
    const w = Math.min(240, W - 16);
    const h = Math.min(206, H - 38);
    const x = Math.round((W - w) / 2);
    const y = Math.max(4, Math.round((H - 30 - h) / 2));
    this.box = { x, y, w, h };
    this.screen = { x: x + 6, y: y + 8, w: w - 12, h: h - 14 };
    this.root.removeAll(true);
    this.body = this.scene.make.container({}, false);
    this.inputT = null;
    this.cursor = null;

    const g = this.scene.make.graphics({}, false);
    // Device bezel with a camera dot, then the screen.
    g.fillStyle(0x1a1224, 1).fillRect(x + 2, y, w - 4, h).fillRect(x, y + 2, w, h - 4).fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle(0x3b2a3a, 1).fillRect(x + 2, y + 2, w - 4, h - 4);
    g.fillStyle(0x5a4260, 1).fillRect(x + 3, y + 2, w - 6, 1);
    g.fillStyle(0x6fe3e1, 1).fillRect(x + Math.round(w / 2) - 1, y + 4, 2, 2);
    const s = this.screen;
    g.fillStyle(0xfdf3dc, 1).fillRect(s.x, s.y, s.w, s.h);
    g.fillStyle(0x7e5fb8, 1).fillRect(s.x, s.y, s.w, 13);
    g.fillStyle(0x9d80d6, 1).fillRect(s.x, s.y, s.w, 1);
    this.root.add(g);

    const title = this.showing === "phones" ? "LINK A PHONE" : this.showing ? VILLAGER_NAMES[this.showing].toUpperCase() : "MOONPAD";
    const t = ptext(this.scene, s.x + (this.showing ? 30 : 5), s.y + 3, title, 0xfff6e6, "pxb");
    const close = ptext(this.scene, 0, s.y + 3, "x", 0xfff6e6, "pxb");
    close.setX(s.x + s.w - 5 - measure(close).w).setInteractive({ useHandCursor: true }).on("pointerdown", () => closeMoonPad());
    // signal bars
    for (let i = 0; i < 3; i++) g.fillStyle(0xfff6e6, 1).fillRect(close.x - 14 + i * 3, s.y + 9 - i * 2, 2, 2 + i * 2);
    this.root.add([t, close]);
    if (this.showing && this.showing !== "phones") this.root.add(this.hearts(this.showing, t.x + measure(t).w + 6, s.y + 3, 0xffa3c0, 0x5e4591));
    if (this.showing) {
      const back = ptext(this.scene, s.x + 5, s.y + 3, "<", 0xfff6e6, "pxb").setInteractive({ useHandCursor: true });
      back.on("pointerdown", () => this.showThread(null));
      const backHit = this.scene.add.zone(s.x, s.y, 26, 13).setOrigin(0).setInteractive({ useHandCursor: true });
      backHit.on("pointerdown", () => this.showThread(null));
      this.root.add([back, backHit]);
    }

    this.maskG.clear().fillStyle(0xffffff, 1);
    if (this.showing === "phones") this.renderPhones();
    else if (this.showing) this.renderThread(this.showing);
    else this.renderContacts();
  }

  /** Friendship, Stardew-style: a row of hearts, filled as you get closer. */
  private hearts(v: VillagerId, x: number, y: number, full: number, empty: number) {
    const n = heartsFor(store.friendship[v] ?? 0);
    return Array.from({ length: MAX_HEARTS }, (_, i) => ptext(this.scene, x + i * 6, y, "♥", i < n ? full : empty));
  }

  // --- home: contacts

  private renderContacts() {
    const s = this.screen;
    let y = s.y + 16;
    const rows = ORDER.filter((v) => store.residents.includes(v) || store.buildings[VILLAGER_HOME[v]] || store.progress.revealed.includes(VILLAGER_HOME[v]));
    for (const v of rows) {
      const here = store.residents.includes(v);
      const rowH = 27;
      const hit = this.scene.add.zone(s.x + 2, y, s.w - 4, rowH - 1).setOrigin(0);
      const bg = this.scene.make.graphics({}, false);
      const drawBg = (hover: boolean) => bg.clear().fillStyle(hover ? 0xf4d9a6 : 0xfdf3dc, 1).fillRect(s.x + 2, y, s.w - 4, rowH - 1).fillStyle(0xe6d3ad, 1).fillRect(s.x + 4, y + rowH - 1, s.w - 8, 1);
      drawBg(false);
      const avatar = this.scene.make.image({ x: s.x + 14, y: y + 24, key: AVATAR[v] }, false).setOrigin(0.5, 1);
      if (!here) avatar.setTint(0x9a93a8).setAlpha(0.6);
      const name = ptext(this.scene, s.x + 28, y + 4, VILLAGER_NAMES[v], here ? C.ink : 0xb09a78, "pxb");
      const last = (threads.get(v) ?? []).at(-1);
      const previewText = !here ? "no signal - they haven't moved in" : waiting.has(v) ? "typing..." : last ? `${last.from === "you" ? "You: " : ""}${last.text}` : "Say hi!";
      const preview = ptext(this.scene, s.x + 28, y + 15, fit(this.scene, previewText, s.w - 28 - 22), here ? C.inkSoft : 0xb09a78);
      this.root.add([bg, avatar, name, preview]);
      if (here) this.root.add(this.hearts(v, name.x + measure(name).w + 5, y + 4, 0xd9607e, 0xdcc9a3));
      this.root.add(hit);
      const n = unread.get(v) ?? 0;
      if (n) {
        const badge = this.scene.make.graphics({}, false);
        const bt = ptext(this.scene, 0, y + 9, String(Math.min(n, 9)), 0xffffff, "pxb");
        const bx = s.x + s.w - 16;
        badge.fillStyle(0x3b2a3a, 1).fillRect(bx, y + 7, 11, 11).fillStyle(0xd0402f, 1).fillRect(bx + 1, y + 8, 9, 9);
        bt.setX(bx + Math.round((11 - measure(bt).w) / 2));
        this.root.add([badge, bt]);
      }
      if (here) {
        hit.setInteractive({ useHandCursor: true });
        hit.on("pointerover", () => drawBg(true));
        hit.on("pointerout", () => drawBg(false));
        hit.on("pointerdown", () => {
          sfx.blip();
          this.showThread(v);
        });
      }
      y += rowH;
    }
    if (rows.length <= 2) {
      const tip = ptext(this.scene, s.x + 6, y + 6, "More neighbors will show up here as they move in.", C.inkSoft).setMaxWidth(s.w - 12);
      this.root.add(tip);
    }

    // Your real phone(s): text the colony over iMessage.
    const fy = s.y + s.h - 19;
    const strip = this.scene.make.graphics({}, false);
    strip.fillStyle(0xe6d3ad, 1).fillRect(s.x, fy - 2, s.w, 21);
    const phones = store.connections.photon.phones;
    const label = phones.length ? `Real phone: ${phones.map((p) => p.masked).join(", ")}` : "Text the colony from your real phone";
    const info = ptext(this.scene, s.x + 5, fy + 4, fit(this.scene, label, s.w - 10 - 50), C.inkSoft);
    const btn = new Button(this.scene, s.x + s.w - 4 - 46, fy, phones.length ? "PHONES" : "LINK", 0x7e5fb8, () => this.showThread("phones"), 46);
    this.root.add([strip, info, btn]);
  }

  // --- link a real phone (Photon iMessage)
  // On Photon's shared pool the colony can't text you until you've texted it,
  // so linking = type your number, then send a code FROM that phone (scan the QR).

  phoneStep: "number" | "waiting" = "number";
  phoneStatus = "";
  private pendingLink: { line?: string; code?: string; link?: string } = {};

  private renderPhones() {
    const s = this.screen;
    let y = s.y + 18;
    const line = (text: string, color: number = C.inkSoft, font: "px" | "pxb" = "px") => {
      const t = ptext(this.scene, s.x + 6, y, text, color, font).setMaxWidth(s.w - 12);
      this.root.add(t);
      y += measure(t).h + 5;
    };
    const photon = store.connections.photon;
    if (!photon.connected) {
      line("Photon isn't set up on the colony server yet (SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET in .env).", C.red);
      return;
    }

    if (this.phoneStep === "waiting") {
      const p = this.pendingLink;
      line("Now text the colony from that phone:", C.ink);
      line(`${p.code}  to  ${p.line}`, 0x7e5fb8, "pxb");
      line("Or scan with your phone's camera - it opens Messages with it filled in. Just hit send.");
      if (p.link) {
        const qr = QRCode.create(p.link, { errorCorrectionLevel: "M" });
        const n = qr.modules.size;
        const cell = n * 2 + 8 <= s.h - (y - s.y) - 24 ? 2 : 1;
        const size = n * cell + 8;
        const qx = s.x + Math.round((s.w - size) / 2);
        const g = this.scene.make.graphics({}, false);
        g.fillStyle(0xffffff, 1).fillRect(qx, y, size, size);
        g.fillStyle(0x1a1224, 1);
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) g.fillRect(qx + 4 + c * cell, y + 4 + r * cell, cell, cell);
        this.root.add(g);
        y += size + 4;
      }
      if (this.phoneStatus) line(this.phoneStatus, C.coral);
      const redo = ptext(this.scene, s.x + 6, s.y + s.h - 14, "< use a different number", 0x7e5fb8).setInteractive({ useHandCursor: true });
      redo.on("pointerdown", () => {
        this.phoneStep = "number";
        this.phoneStatus = "";
        claimInput(this.owner);
        this.render();
      });
      this.root.add(redo);
      return;
    }

    line("Link your real phone and text any villager over iMessage. Everyone on the team can link theirs.");
    for (const p of photon.phones) {
      const row = ptext(this.scene, s.x + 10, y + 3, fit(this.scene, p.line ? `${p.masked} - colony texts from ${p.line}` : `iMessage ${p.masked}`, s.w - 72), C.ink);
      const un = new Button(this.scene, s.x + s.w - 6 - 50, y, "UNLINK", C.woodMid, () => {
        net.send({ type: "phone_unlink", id: p.id });
        this.phoneStatus = `Unlinked ${p.masked}.`;
      }, 50);
      this.root.add([row, un]);
      y += 18;
    }
    y += 4;
    line("Type your number below. Then you'll text a code to the colony from that phone to confirm it's yours.", C.ink);
    if (this.phoneStatus) line(this.phoneStatus, this.phoneStatus.startsWith("Linked") ? C.green : C.coral);

    const fy = s.y + s.h - 19;
    const bar = this.scene.make.graphics({}, false);
    bar.fillStyle(0xe6d3ad, 1).fillRect(s.x, fy - 2, s.w, 21);
    bar.fillStyle(C.paperDark, 1).fillRect(s.x + 4, fy, s.w - 8 - 64, 15);
    bar.fillStyle(0xfffaf0, 1).fillRect(s.x + 5, fy + 1, s.w - 10 - 64, 13);
    this.inputT = ptext(this.scene, s.x + 8, fy + 4, "", C.ink);
    this.cursor = new Phaser.GameObjects.Rectangle(this.scene, 0, 0, 1, 9, C.ink).setOrigin(0);
    const go = new Button(this.scene, s.x + s.w - 4 - 60, fy, "NEXT", 0x7e5fb8, () => this.submitPhone(), 60);
    this.root.add([bar, this.inputT, this.cursor, go]);
    this.renderInput();
  }

  private submitPhone() {
    if (this.phoneStep !== "number") return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    net.send({ type: "phone_link_start", phone: text });
    this.phoneStatus = "Registering with Photon...";
    sfx.blip();
    this.render();
  }

  onPhoneLink(msg: PhoneLinkMsg) {
    if (msg.state === "awaiting_text") {
      this.phoneStep = "waiting";
      this.pendingLink = { line: msg.line, code: msg.code, link: msg.link };
      this.phoneStatus = "";
      releaseInput(this.owner);
    } else if (msg.state === "linked") {
      this.phoneStep = "number";
      this.pendingLink = {};
      this.phoneStatus = msg.text;
      sfx.buy();
    } else {
      this.phoneStatus = msg.text;
    }
    if (this.showing === "phones") {
      if (this.phoneStep === "number") claimInput(this.owner);
      this.render();
    }
  }

  // --- thread

  private renderThread(v: VillagerId) {
    const s = this.screen;
    const area = { x: s.x + 5, y: s.y + 16, w: s.w - 10, h: s.h - 16 - 21 };
    this.maskG.fillRect(area.x, area.y, area.w, area.h);
    this.body.setMask(this.maskG.createGeometryMask());
    const msgs = [...(threads.get(v) ?? [])];
    if (waiting.has(v)) msgs.push({ from: "them", text: ". . ." });
    if (!msgs.length) msgs.push({ from: "sys", text: `Text ${VILLAGER_NAMES[v]} to get to know them - they'll remember. For real work, visit them at the ${BUILDINGS[VILLAGER_HOME[v]].name}.` });
    let y = 0;
    for (const m of msgs) {
      const text = m.tag ? `${m.text}\n(${m.tag})` : m.text;
      const l =
        m.from === "you"
          ? new Label(this.scene, area.w, y, text, { bg: 0x9d80d6, border: 0x7e5fb8, color: 0xfff6e6, maxWidth: area.w - 44, originX: 1, originY: 0, align: "left" })
          : m.from === "them"
            ? new Label(this.scene, 0, y, text, { bg: 0xfff2d6, border: C.paperDark, maxWidth: area.w - 44, originX: 0, originY: 0, align: "left" })
            : new Label(this.scene, Math.round(area.w / 2), y, text, { bg: null, border: null, color: C.inkSoft, maxWidth: area.w - 10, originX: 0.5, originY: 0, align: "center" });
      this.body.add(l);
      y += l.boxH + 4;
    }
    this.contentH = y;
    this.body.setPosition(area.x, area.y);
    this.root.add(this.body);
    this.applyScroll();

    // Typing bar + SEND.
    const fy = s.y + s.h - 19;
    const bar = this.scene.make.graphics({}, false);
    bar.fillStyle(0xe6d3ad, 1).fillRect(s.x, fy - 2, s.w, 21);
    bar.fillStyle(C.paperDark, 1).fillRect(s.x + 4, fy, s.w - 8 - 40, 15);
    bar.fillStyle(0xfffaf0, 1).fillRect(s.x + 5, fy + 1, s.w - 10 - 40, 13);
    this.inputT = ptext(this.scene, s.x + 8, fy + 4, "", C.ink);
    this.cursor = new Phaser.GameObjects.Rectangle(this.scene, 0, 0, 1, 9, C.ink).setOrigin(0);
    const sendBtn = new Button(this.scene, s.x + s.w - 4 - 36, fy, "SEND", 0x7e5fb8, () => this.send(), 36);
    this.root.add([bar, this.inputT, this.cursor, sendBtn]);
    this.renderInput();
  }

  private applyScroll() {
    const areaH = this.screen.h - 16 - 21;
    this.scroll = Phaser.Math.Clamp(this.scroll, 0, Math.max(0, this.contentH - areaH));
    this.body.setY(this.screen.y + 16 - Math.round(this.scroll));
  }

  private renderInput() {
    if (!this.inputT || !this.cursor) return;
    const phones = this.showing === "phones";
    const maxW = this.screen.w - 10 - (phones ? 64 : 40) - 8;
    const raw = input.value;
    if (!raw) {
      const hint = !phones ? "Text them something..." : "+1 314 555 0123";
      this.inputT.setText(fit(this.scene, hint, maxW)).setTint(0xb09a78);
      this.cursor.setPosition(this.inputT.x, this.inputT.y - 1);
      return;
    }
    let s = sanitize(raw);
    this.inputT.setTint(C.ink).setText(s);
    while (s.length > 1 && measure(this.inputT).w > maxW) this.inputT.setText((s = s.slice(1)));
    this.cursor.setPosition(this.inputT.x + measure(this.inputT).w + 1, this.inputT.y - 1);
  }

  private send() {
    const v = this.showing;
    const text = input.value.trim();
    if (!v || v === "phones" || !text) return;
    input.value = "";
    if (!net.send({ type: "task", villager: v, text, via: "moonpad" })) {
      push(v, { from: "sys", text: "No connection to the colony server." });
      return;
    }
    sfx.blip();
    this.scroll = 1e9;
    this.render();
  }
}

let view: MoonPadView | null = null;

/** Called by the UI scene (again after a resize). */
export function mountMoonPad(scene: Phaser.Scene) {
  const wasOpen = view?.visible ? view.showing : undefined;
  view = new MoonPadView(scene);
  if (wasOpen !== undefined) view.open(wasOpen);
}

export function openMoonPad(v: VillagerId | "phones" | null = null) {
  if (!view) return;
  closePanel();
  view.open(v);
  setUiOpen(true);
}

export function closeMoonPad() {
  if (!view?.visible) return;
  view.close();
  setUiOpen(false);
}

export function isMoonPadOpen() {
  return !!view?.visible;
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMoonPad();
});
