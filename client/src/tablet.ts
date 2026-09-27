// The MoonPad: text any villager from anywhere on the island. Texts are for
// getting to know them (they remember what you tell them, and friendship
// grows); real work only happens when you visit their house in person.

import Phaser from "phaser";
import { BUILDINGS, MAX_HEARTS, VILLAGER_HOME, VILLAGER_NAMES, VILLAGER_SHORT, heartsFor, type TaskSource, type VillagerId } from "../../shared/game";
import { happinessFor } from "../../shared/decor";
import { sanitize } from "./font";
import * as net from "./net";
import type { PhoneLinkMsg } from "./net";
import { closePanel, openConnect, openLinkClaude, setUiOpen } from "./panel";
import { sfx } from "./sfx";
import { agents, onStoreChange, store } from "./store";
import { claimInput, input, releaseInput, type InputOwner } from "./textinput";
import { Button, C, Label, TOOLBAR_H, fit, measure, ptext } from "./widgets";

// qrcode is only needed for the phone-link screen, so it loads on first use
// instead of shipping in the startup bundle.
type QRLib = typeof import("qrcode");
let qrLib: QRLib | null = null;
let qrLoading = false;
let qrOnReady: (() => void) | null = null;
function loadQR(onReady: () => void) {
  qrOnReady = onReady;
  if (qrLib || qrLoading) return;
  qrLoading = true;
  import("qrcode").then(
    (m: QRLib & { default?: QRLib }) => { qrLib = m.default ?? m; qrOnReady?.(); qrOnReady = null; },
    () => { qrLoading = false; },
  );
}

type Msg = { from: "you" | "them" | "sys"; text: string; tag?: string };
type View = VillagerId | "phones" | "connect" | null;
type TestResult = { name: string; ok: boolean | null; detail: string };

const ORDER: VillagerId[] = ["jade_rabbit", "stargazer", "postmaster", "dj", "timekeeper", "scholar", "manager", "mechanic"];
const AVATAR: Record<VillagerId, string> = {
  jade_rabbit: "rabbit_0",
  stargazer: "stargazer_0",
  postmaster: "postmaster_0",
  timekeeper: "timekeeper_0",
  scholar: "scholar_0",
  manager: "office_lead",
  dj: "dj_0",
  mechanic: "mechanic_0",
};
const TAGS: Partial<Record<TaskSource, string>> = { game: "in person", phone: "from your phone" };
const SAVE_KEY = "moonpad-v1";

// ---------------------------------------------------------------- threads

const threads = new Map<VillagerId, Msg[]>();
const unread = new Map<VillagerId, number>();
const lastSource = new Map<VillagerId, TaskSource>();
/** Who's "typing..." back, and when they started (it gives up after a while: see WAIT_MS). */
const waiting = new Map<VillagerId, number>();
const WAIT_MS = 2 * 60_000;
const unreadListeners = new Set<() => void>();
/** Whose history is showing (see net.accountTag): a guest's stays in memory only. */
let loadedFor: string | null = null;

function startWaiting(v: VillagerId) {
  const at = Date.now();
  waiting.set(v, at);
  window.setTimeout(() => {
    if (waiting.get(v) !== at) return;
    waiting.delete(v);
    view?.refresh();
  }, WAIT_MS);
}

/** Nobody's still typing back (a fresh snapshot, or the line went down). */
function stopWaiting() {
  if (!waiting.size) return;
  waiting.clear();
  view?.refresh();
}

/** Signed in as someone else, as a guest, or in dev mode: that world's own threads, not the last one's. */
function switchAccount() {
  const who = net.accountTag();
  const tag = who === "guest" ? who : `${who}${store.devMode ? "-dev" : ""}`;
  if (tag === loadedFor) return;
  loadedFor = tag;
  threads.clear();
  unread.clear();
  lastSource.clear();
  waiting.clear();
  if (tag !== "guest") load();
  unreadListeners.forEach((fn) => fn());
  view?.refresh();
}

function load() {
  try {
    const raw = localStorage.getItem(`${SAVE_KEY}:${loadedFor}`);
    if (!raw) return;
    const data = JSON.parse(raw) as { threads: [VillagerId, Msg[]][]; unread: [VillagerId, number][] };
    data.threads.forEach(([v, m]) => threads.set(v, m));
    data.unread.forEach(([v, n]) => unread.set(v, n));
  } catch {
    /* private window or corrupt save — start empty */
  }
}

function save() {
  if (loadedFor === null || loadedFor === "guest") return;
  try {
    localStorage.setItem(`${SAVE_KEY}:${loadedFor}`, JSON.stringify({ threads: [...threads], unread: [...unread] }));
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
  try {
    // (the old history, from before it was kept per account: nobody's in particular, so it goes)
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing stored */
  }
  // (whose history to show is known once the colony's snapshot arrives)
  net.onSnapshot(() => {
    switchAccount();
    stopWaiting();
  });
  onStoreChange(() => !store.connected && stopWaiting());
  net.onPhoneLink((msg) => view?.onPhoneLink(msg));
  // The Claude Code row follows the link (hosted): redraw when it changes, not on every agent step.
  let linkSeen = "";
  net.onAgents(() => {
    const l = agents.state.link;
    const sig = l ? `${l.status}|${l.host ?? ""}` : "";
    if (sig !== linkSeen) {
      linkSeen = sig;
      view?.refresh();
    }
  });
  net.onEvent((e) => {
    if (e.type === "connections" || e.type === "friendship" || e.type === "sandbox") view?.refresh();
    if (e.type === "text") {
      if (e.direction === "in") {
        push(e.villager, { from: "you", text: e.text, tag: e.via === "phone" ? "from your phone" : undefined });
        startWaiting(e.villager);
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
  /** A villager's thread, the phone-linking screen, the connections screen, or null for the contact list. */
  showing: View = null;
  visible = false;
  /** The first-run version of the connections screen ("WELCOME", with START PLAYING). */
  private welcome = false;
  private testing = false;
  private test: TestResult[] | null = null;
  private owner: InputOwner = {
    render: () => this.renderInput(),
    submit: () => (this.showing === "phones" ? this.submitPhone() : this.send()),
    active: () => this.visible && this.showing !== null && this.showing !== "connect",
  };

  constructor(private scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(4500).setVisible(false);
    this.body = scene.make.container({}, false);
    this.maskG = scene.make.graphics({}, false);
    scene.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!this.visible || !this.showing || this.showing === "phones" || this.showing === "connect") return;
      this.scroll += dy > 0 ? 11 : -11;
      this.applyScroll();
    });
    scene.time.addEvent({ delay: 480, loop: true, callback: () => this.cursor?.setVisible(!this.cursor.visible) });
  }

  open(v: View = null, welcome = false) {
    this.visible = true;
    this.welcome = welcome;
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

  showThread(v: View) {
    this.showing = v;
    this.scroll = 1e9;
    if (v !== "connect") this.welcome = false;
    if (v === "connect") releaseInput(this.owner);
    else if (v === "phones") {
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
    // A phone: portrait, rounded, with a camera notch, a status bar and a home bar.
    const w = Math.min(176, W - 16);
    const h = Math.min(296, H - TOOLBAR_H - 12);
    const x = Math.round((W - w) / 2);
    const y = Math.max(4, Math.round((H - TOOLBAR_H - 4 - h) / 2));
    this.box = { x, y, w, h };
    // "screen" is the app area, below the status bar and above the home bar.
    this.screen = { x: x + 6, y: y + 20, w: w - 12, h: h - 31 };
    this.root.removeAll(true);
    this.body = this.scene.make.container({}, false);
    this.inputT = null;
    this.cursor = null;

    const g = this.scene.make.graphics({}, false);
    const rounded = (c: number, rx: number, ry: number, rw: number, rh: number) =>
      g.fillStyle(c, 1).fillRect(rx + 3, ry, rw - 6, rh).fillRect(rx + 1, ry + 1, rw - 2, rh - 2).fillRect(rx, ry + 3, rw, rh - 6);
    rounded(0x1a1224, x, y, w, h);
    rounded(0x3b2a3a, x + 1, y + 1, w - 2, h - 2);
    g.fillStyle(0x5a4260, 1).fillRect(x + 4, y + 2, w - 8, 1);
    // side buttons
    g.fillStyle(0x1a1224, 1).fillRect(x - 1, y + 46, 1, 14).fillRect(x - 1, y + 64, 1, 14).fillRect(x + w, y + 54, 1, 22);
    // camera notch and home bar
    const cx = x + Math.round(w / 2);
    g.fillStyle(0x1a1224, 1).fillRect(cx - 14, y + 4, 28, 5);
    g.fillStyle(0x6fe3e1, 1).fillRect(cx + 8, y + 5, 2, 2);
    g.fillStyle(0x8a7fa0, 1).fillRect(cx - 18, y + h - 7, 36, 2);
    // status bar
    const sb = { x: x + 6, y: y + 11, w: w - 12 };
    g.fillStyle(0x2e2440, 1).fillRect(sb.x, sb.y, sb.w, 9);
    const now = new Date();
    const clock = ptext(this.scene, sb.x + 3, sb.y + 1, `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")}`, 0xd8d0e8);
    for (let i = 0; i < 3; i++) g.fillStyle(0xd8d0e8, 1).fillRect(sb.x + sb.w - 22 + i * 3, sb.y + 6 - i * 2, 2, 2 + i * 2);
    g.fillStyle(0xd8d0e8, 1).fillRect(sb.x + sb.w - 11, sb.y + 2, 8, 5).fillRect(sb.x + sb.w - 3, sb.y + 3, 1, 3);
    g.fillStyle(0x7fd88a, 1).fillRect(sb.x + sb.w - 10, sb.y + 3, 6, 3);
    const s = this.screen;
    g.fillStyle(0xfdf3dc, 1).fillRect(s.x, s.y, s.w, s.h);
    g.fillStyle(0x7e5fb8, 1).fillRect(s.x, s.y, s.w, 13);
    g.fillStyle(0x9d80d6, 1).fillRect(s.x, s.y, s.w, 1);
    this.root.add([g, clock]);

    const title = this.showing === "phones" ? "LINK A PHONE" : this.showing === "connect" ? (this.welcome ? "WELCOME!" : "CONNECT") : this.showing ? VILLAGER_SHORT[this.showing].toUpperCase() : "MOONPAD";
    const t = ptext(this.scene, s.x + (this.showing ? 30 : 5), s.y + 3, title, 0xfff6e6, "pxb");
    const close = ptext(this.scene, 0, s.y + 3, "x esc", 0xfff6e6);
    close.setX(s.x + s.w - 5 - measure(close).w).setInteractive({ useHandCursor: true }).on("pointerdown", () => closeMoonPad());
    this.root.add([t, close]);
    if (this.showing && this.showing !== "phones" && this.showing !== "connect") this.root.add(this.hearts(this.showing, t.x + measure(t).w + 6, s.y + 3, 0xffa3c0, 0x5e4591));
    if (this.showing && !(this.showing === "connect" && this.welcome)) {
      const back = ptext(this.scene, s.x + 5, s.y + 3, "<", 0xfff6e6, "pxb").setInteractive({ useHandCursor: true });
      back.on("pointerdown", () => this.showThread(null));
      const backHit = this.scene.add.zone(s.x, s.y, 26, 13).setOrigin(0).setInteractive({ useHandCursor: true });
      backHit.on("pointerdown", () => this.showThread(null));
      this.root.add([back, backHit]);
    }

    this.maskG.clear().fillStyle(0xffffff, 1);
    if (this.showing === "phones") this.renderPhones();
    else if (this.showing === "connect") this.renderConnect();
    else if (this.showing) this.renderThread(this.showing);
    else this.renderContacts();
  }

  /** Friendship, Stardew-style: a row of hearts, filled as you get closer. */
  private hearts(v: VillagerId, x: number, y: number, full: number, empty: number) {
    const n = heartsFor((store.friendship[v] ?? 0) + happinessFor(v, store.decos).score);
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
      // (this row's own top: `y` keeps moving down the list after this)
      const top = y;
      const drawBg = (hover: boolean) => bg.clear().fillStyle(hover ? 0xf0d49c : 0xfdf3dc, 1).fillRect(s.x + 2, top, s.w - 4, rowH - 1).fillStyle(0xe6d3ad, 1).fillRect(s.x + 4, top + rowH - 1, s.w - 8, 1);
      drawBg(false);
      const avatar = this.scene.make.image({ x: s.x + 14, y: y + 24, key: AVATAR[v] }, false).setOrigin(0.5, 1);
      if (!here) avatar.setTint(0x9a93a8).setAlpha(0.6);
      const name = ptext(this.scene, s.x + 28, y + 4, VILLAGER_SHORT[v], here ? C.ink : 0xb09a78, "pxb");
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
      const tip = ptext(this.scene, s.x + 6, y + 6, "More moonfolk will show up here as they move in.", C.inkSoft).setMaxWidth(s.w - 12);
      this.root.add(tip);
    }

    this.tabBar("chats");
  }

  /** The bottom tabs: chats and connections. */
  private tabBar(active: "chats" | "connect") {
    const s = this.screen;
    const fy = s.y + s.h - 18;
    const bar = this.scene.make.graphics({}, false);
    bar.fillStyle(0xe6d3ad, 1).fillRect(s.x, fy - 3, s.w, 21);
    bar.fillStyle(0xd9c49a, 1).fillRect(s.x, fy - 3, s.w, 1);
    const half = Math.floor((s.w - 12) / 2);
    const tab = (i: number, label: string, id: "chats" | "connect") =>
      new Button(this.scene, s.x + 4 + i * (half + 4), fy, label, id === active ? 0x7e5fb8 : 0xa998c4, () => (sfx.blip(), this.showThread(id === "chats" ? null : "connect")), half);
    this.root.add([bar, tab(0, "CHATS", "chats"), tab(1, "CONNECT", "connect")]);
  }

  // --- connections: Google, Canvas, your phone, Claude Code (for the Office)

  private renderConnect() {
    const s = this.screen;
    let y = s.y + 17;
    const c = store.connections;
    const sandbox = store.progress.sandbox;
    if (this.welcome) {
      const hi = ptext(this.scene, s.x + 6, y, "Link your accounts so your moonfolk can help with your real life. Skip anything you like; it's all here in the MoonPad later.", C.ink).setMaxWidth(s.w - 12);
      this.root.add(hi);
      y += measure(hi).h + 6;
    }
    const result = (...names: string[]) => (this.test ?? []).filter((r) => names.includes(r.name));
    const watching = agents.state.watching;
    const live = agents.state.sessions.filter((x) => x.source === "claude-code").length;
    const link = agents.state.link;
    const phones = c.photon.phones;
    const rows: { title: string; state: "ok" | "sample" | "off"; line: string; tests: TestResult[]; btn: { label: string; act: () => void } | null }[] = [
      {
        title: "Google",
        state: c.google.connected ? "ok" : sandbox.google ? "sample" : "off",
        line: c.google.connected ? "Gmail + Calendar connected" : sandbox.google ? "on sample data" : !c.google.configured && net.HOSTED ? "not turned on for this site yet" : "Gmail + Calendar (Hoot, Cog)",
        tests: result("Google permissions", "Gmail", "Calendar"),
        btn: c.google.connected ? null : c.google.configured ? { label: "SIGN IN", act: () => window.open(`${net.SERVER_HTTP}/connect/google`, "_blank") } : net.HOSTED ? null : { label: "SET UP", act: () => window.open(`${net.SERVER_HTTP}/setup/google`, "_blank") },
      },
      {
        title: "Canvas",
        state: c.canvas.connected ? "ok" : sandbox.canvas ? "sample" : "off",
        line: c.canvas.connected ? `connected${c.canvas.account ? `: ${c.canvas.account}` : ""}` : sandbox.canvas ? "on sample data" : "courses, due dates (Mabel)",
        tests: result("Canvas"),
        btn: c.canvas.connected ? null : { label: "SIGN IN", act: () => openConnect("scholar", { fromAccounts: true }) },
      },
      {
        title: "GitHub",
        state: c.github.connected ? "ok" : "off",
        line: c.github.connected ? `connected: ${c.github.account}` : "your repos (Tinker)",
        tests: [],
        btn: c.github.connected ? null : { label: "SIGN IN", act: () => openConnect("mechanic", { fromAccounts: true }) },
      },
      {
        title: "Spotify",
        state: c.spotify.connected ? "ok" : "off",
        line: c.spotify.connected ? `connected${c.spotify.account ? `: ${c.spotify.account}` : ""}${c.spotify.premium === false ? " (needs Premium to play)" : ""}` : !c.spotify.configured && net.HOSTED ? "not turned on for this site yet" : "music in the game (Echo)",
        tests: [],
        btn: c.spotify.connected ? null : c.spotify.configured ? { label: "SIGN IN", act: () => window.open(`${net.SERVER_HTTP}/connect/spotify`, "_blank") } : net.HOSTED ? null : { label: "SET UP", act: () => window.open(`${net.SERVER_HTTP}/setup/spotify`, "_blank") },
      },
      {
        title: "Your phone",
        state: phones.length ? "ok" : "off",
        line: phones.length ? `linked: ${phones.map((p) => p.masked).join(", ")}` : c.photon.connected ? "text the colony (iMessage)" : "texting isn't set up here",
        tests: result("Phone"),
        btn: c.photon.connected && !phones.length ? { label: "LINK", act: () => this.showThread("phones") } : null,
      },
      link
        ? {
            // Hosted: your Claude Code runs on your computer; link it with one command.
            title: "Claude Code",
            state: link.status === "linked" ? "ok" : "off",
            line: link.status === "linked" ? `linked: ${link.host}${live ? ` · ${live} live` : ""}` : link.status === "lost" ? `link lost (${link.host})` : "watch your agents in the Office",
            tests: [],
            btn: link.status === "linked" ? null : { label: "LINK", act: () => openLinkClaude() },
          }
        : {
            title: "Claude Code",
            state: watching ? "ok" : "off",
            line: watching ? (live ? `${live} session${live === 1 ? "" : "s"} live in the Office` : "the Office shows it when it runs") : "not on this computer (Office can replay)",
            tests: result("Claude Code"),
            btn: null,
          },
    ];
    // Texting runs through the host's own line, so it isn't offered online.
    for (const r of net.HOSTED ? rows.filter((x) => x.title !== "Your phone") : rows) {
      const failed = r.tests.find((t) => t.ok === false);
      const passed = r.tests.length && r.tests.every((t) => t.ok !== false) && r.state === "ok";
      const mark = failed ? "✗" : r.state === "ok" ? "✓" : r.state === "sample" ? "●" : "○";
      const color = failed ? C.red : r.state === "ok" ? C.green : r.state === "sample" ? 0xb0521f : C.inkSoft;
      const b = r.btn;
      const btn = b ? this.rightButton(b.label, y + 4, 0x7e5fb8, () => (sfx.blip(), b.act())) : null;
      const btnW = btn ? btn.width_ + 4 : 0;
      const title = ptext(this.scene, s.x + 6, y + 1, `${mark} ${r.title}`, failed ? C.red : C.ink, "pxb");
      const detail = failed ? failed.detail : passed ? `${r.line} · tested ✓` : r.line;
      const line = ptext(this.scene, s.x + 14, y + 12, detail, color).setMaxWidth(s.w - 20 - btnW);
      this.root.add([title, line]);
      if (btn) this.root.add(btn);
      const rowH = Math.max(25, 12 + measure(line).h + 5);
      const sep = this.scene.make.graphics({}, false).fillStyle(0xe6d3ad, 1).fillRect(s.x + 4, y + rowH - 2, s.w - 8, 1);
      this.root.add(sep);
      y += rowH;
    }
    // test everything for real (read-only)
    const testBtn = new Button(this.scene, s.x + 4, y + 3, this.testing ? "TESTING..." : "TEST CONNECTIONS", 0xa998c4, () => this.runTest(), s.w - 8);
    this.root.add(testBtn);
    if (this.welcome) {
      const fy = s.y + s.h - 18;
      const bar = this.scene.make.graphics({}, false).fillStyle(0xe6d3ad, 1).fillRect(s.x, fy - 3, s.w, 21);
      const go = new Button(this.scene, s.x + 4, fy, "START PLAYING", C.greenBtn, () => (sfx.buy(), closeMoonPad()), s.w - 8);
      this.root.add([bar, go]);
    } else this.tabBar("connect");
  }

  /** A button flush with the screen's right edge (4px in), sized by its label. */
  private rightButton(label: string, y: number, fill: number, onClick: () => void, minW = 0) {
    const b = new Button(this.scene, 0, y, label, fill, onClick, minW);
    b.setX(this.screen.x + this.screen.w - 4 - b.width_);
    return b;
  }

  private runTest() {
    if (this.testing) return;
    this.testing = true;
    this.render();
    const off = net.onConnectionTest((results) => {
      off();
      this.testing = false;
      this.test = results;
      this.refresh();
    });
    net.send({ type: "test_connections" });
  }

  // --- link a real phone (Photon iMessage)
  // On Photon's shared pool the colony can't text you until you've texted it,
  // so linking = type your number, then send a code FROM that phone (scan the QR).

  phoneStep: "number" | "waiting" = "number";
  phoneStatus = "";
  private pendingLink: { line?: string; code?: string; link?: string } = {};

  private renderPhones() {
    // Fetch qrcode as soon as the phone screen opens; redraw once it lands if the QR is showing.
    if (!qrLib) loadQR(() => { if (this.visible && this.showing === "phones" && this.phoneStep === "waiting") this.refresh(); });
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
      if (p.link && qrLib) {
        const qr = qrLib.create(p.link, { errorCorrectionLevel: "M" });
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
      const redo = ptext(this.scene, s.x + 6, s.y + s.h - 13, "< use a different number", 0x7e5fb8).setInteractive({ useHandCursor: true });
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
      const un = this.rightButton("UNLINK", y, C.woodMid, () => {
        net.send({ type: "phone_unlink", id: p.id });
        this.phoneStatus = `Unlinked ${p.masked}.`;
      });
      this.root.add([row, un]);
      y += 18;
    }
    y += 4;
    line("Type your number below. Then you'll text a code to the colony from that phone to confirm it's yours.", C.ink);
    if (this.phoneStatus) line(this.phoneStatus, this.phoneStatus.startsWith("Linked") ? C.green : C.coral);

    const fy = s.y + s.h - 18;
    const bar = this.scene.make.graphics({}, false);
    bar.fillStyle(0xe6d3ad, 1).fillRect(s.x, fy - 3, s.w, 21);
    const go = this.rightButton("NEXT", fy, 0x7e5fb8, () => this.submitPhone(), 44);
    const fieldW = s.w - 8 - go.width_ - 4;
    bar.fillStyle(C.paperDark, 1).fillRect(s.x + 4, fy, fieldW, 15);
    bar.fillStyle(0xfffaf0, 1).fillRect(s.x + 5, fy + 1, fieldW - 2, 13);
    this.inputT = ptext(this.scene, s.x + 8, fy + 4, "", C.ink);
    this.cursor = new Phaser.GameObjects.Rectangle(this.scene, 0, 0, 1, 9, C.ink).setOrigin(0);
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
    const fy = s.y + s.h - 18;
    const bar = this.scene.make.graphics({}, false);
    bar.fillStyle(0xe6d3ad, 1).fillRect(s.x, fy - 3, s.w, 21);
    const sendBtn = this.rightButton("SEND", fy, 0x7e5fb8, () => this.send());
    const fieldW = s.w - 8 - sendBtn.width_ - 4;
    bar.fillStyle(C.paperDark, 1).fillRect(s.x + 4, fy, fieldW, 15);
    bar.fillStyle(0xfffaf0, 1).fillRect(s.x + 5, fy + 1, fieldW - 2, 13);
    this.inputT = ptext(this.scene, s.x + 8, fy + 4, "", C.ink);
    this.cursor = new Phaser.GameObjects.Rectangle(this.scene, 0, 0, 1, 9, C.ink).setOrigin(0);
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
    const maxW = this.screen.w - 10 - (phones ? 52 : 44) - 8;
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
    if (!v || v === "phones" || v === "connect" || !text) return;
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

export function openMoonPad(v: View = null, opts: { welcome?: boolean } = {}) {
  if (!view) return;
  closePanel();
  view.open(v, !!opts.welcome);
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
