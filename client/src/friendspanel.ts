// Friends (online): your friend code, adding friends by code or email,
// requests, who's visiting (send them home, block them) and who came by,
// what each friend may do on your island, the rocket (visit a friend, or fly
// home), and leaving a gift when you're the one visiting. Drawn like the Town
// Hall's cards; lives in the UI scene ("friends-panel" event).

import Phaser from "phaser";
import { MATERIALS, MATERIAL_NAME, VILLAGER_NAMES, VILLAGER_SHORT, type Material, type VillagerId } from "../../shared/game";
import type { SocialState, VisitPerms } from "../../shared/visit";
import * as net from "./net";
import { flyTo, hostName, isMe, loadSocial, mp, social, visiting } from "./multiplayer";
import { sfx } from "./sfx";
import { claimInput, input, releaseInput, type InputOwner } from "./textinput";
import { Button, C, TOOLBAR_H, measure, pixBox, ptext, woodFrame } from "./widgets";

export type FriendsSpec = { kind: "board"; tab?: "friends" | "requests" | "visitors" } | { kind: "travel" } | { kind: "perms"; id: string } | { kind: "gift" };

/** Neighbors a friend can be allowed to ask (Yutu just chats; there's nothing of yours to look at). */
const ASKABLE: VillagerId[] = ["postmaster", "timekeeper", "scholar", "stargazer", "dj", "mechanic", "manager"];
const WHAT: Partial<Record<VillagerId, string>> = { postmaster: "their Gmail", timekeeper: "their Calendar", scholar: "their Canvas", stargazer: "the web", dj: "what's playing", mechanic: "their GitHub", manager: "their Office" };
const OK = 0x2f7a40;

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export class FriendsPanel implements InputOwner {
  private root: Phaser.GameObjects.Container;
  private spec: FriendsSpec | null = null;
  private state: SocialState | null = null;
  private note: { text: string; ok: boolean } | null = null;
  private typing = false;
  private field: Phaser.GameObjects.BitmapText | null = null;
  private page = 0;
  /** The permissions being edited (saved with SAVE). */
  private draft: VisitPerms | null = null;
  /** The gift being put together. */
  private gift: { coins: number; materials: Partial<Record<Material, number>> } = { coins: 0, materials: {} };

  constructor(private scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(4150).setVisible(false);
  }

  get isOpen() {
    return !!this.spec;
  }

  open(spec: FriendsSpec) {
    if (spec.kind === "perms") {
      const f = this.state?.friends.find((x) => x.id === spec.id);
      this.draft = f ? { agents: [...f.perms.agents], office: f.perms.office } : null;
    }
    if (spec.kind === "gift") this.gift = { coins: 0, materials: {} };
    if (this.spec?.kind !== spec.kind || (spec.kind === "board" && this.spec.kind === "board" && spec.tab !== this.spec.tab)) this.page = 0;
    this.spec = spec;
    this.scene.registry.set("friendsOpen", true);
    this.render();
    this.root.setVisible(true);
    if (spec.kind !== "gift") void this.reload();
  }

  close() {
    if (!this.spec) return;
    this.spec = null;
    this.stopTyping();
    this.note = null;
    this.scene.registry.set("friendsOpen", false);
    this.root.setVisible(false).removeAll(true);
  }

  /** Something changed (a request came in, someone arrived): redraw, fetching the list again. */
  refresh(fetch = false) {
    if (!this.spec) return;
    if (fetch && this.spec.kind !== "gift") void this.reload();
    else this.render();
  }

  private async reload() {
    try {
      this.state = await loadSocial();
    } catch (err) {
      this.note = { text: err instanceof Error ? err.message : "Couldn't load your friends.", ok: false };
    }
    this.render();
  }

  /** A change on the site; shows its line (or the problem). */
  private async act(path: Parameters<typeof social>[0], body: object, after?: () => void) {
    sfx.blip();
    try {
      const out = await social(path, body);
      this.state = out;
      this.note = out.text ? { text: out.text, ok: true } : null;
      after?.();
    } catch (err) {
      sfx.deny();
      this.note = { text: err instanceof Error ? err.message : "That didn't work.", ok: false };
    }
    this.render();
  }

  // ---------------------------------------------------------------- typing (the ADD FRIEND box)

  private startTyping() {
    this.typing = true;
    this.scene.registry.set("keysFree", true);
    claimInput(this);
    this.render();
  }

  private stopTyping() {
    if (!this.typing) return;
    this.typing = false;
    this.scene.registry.set("keysFree", false);
    releaseInput(this);
  }

  render() {
    if (!this.spec) return;
    if (this.field && this.typing) {
      this.field.setText(`${input.value}_`);
      return this.draw();
    }
    this.draw();
  }

  submit() {
    const raw = input.value.trim();
    if (!raw) return;
    input.value = "";
    void this.act("add", raw.includes("@") ? { email: raw } : { code: raw });
  }

  active() {
    return this.typing && !!this.spec;
  }

  // ---------------------------------------------------------------- drawing

  private draw() {
    const spec = this.spec;
    if (!spec) return;
    const s = this.scene;
    this.root.removeAll(true);
    this.field = null;
    const W = s.scale.width;
    const H = s.scale.height;
    const pw = Math.min(W - 20, 440);
    const ph = Math.min(H - TOOLBAR_H - 16, spec.kind === "gift" ? 170 : 250);
    const x0 = Math.round((W - pw) / 2);
    const y0 = Math.max(6, Math.round((H - TOOLBAR_H - ph) / 2));
    const g = s.add.graphics();
    woodFrame(g, x0, y0, pw, ph, C.paper);
    const title =
      spec.kind === "gift" ? `A GIFT FOR ${hostName().toUpperCase()}` : spec.kind === "travel" ? "THE ROCKET" : spec.kind === "perms" ? `${this.nameOf(spec.id).toUpperCase()} ON YOUR ISLAND` : "FRIENDS";
    const t = ptext(s, x0 + 12, y0 + 9, `★ ${title}`, C.coral, "pxb");
    const x = ptext(s, x0 + pw - 16, y0 + 8, "x", C.ink, "pxb").setInteractive({ useHandCursor: true });
    x.on("pointerdown", () => (sfx.blip(), this.close()));
    this.root.add([g, t, x]);
    const box = { x: x0 + 8, y: y0 + 26, w: pw - 16, h: ph - 34 };
    if (spec.kind === "gift") this.drawGift(box);
    else if (!this.state) this.line(box.x + 4, box.y + 6, this.note?.text ?? "Loading your friends...", this.note ? C.red : C.inkSoft);
    else if (spec.kind === "perms") this.drawPerms(spec.id, box);
    else if (spec.kind === "travel") this.drawTravel(box);
    else this.drawBoard(spec.tab ?? "friends", box);
    // What just happened (or what went wrong), at the bottom.
    if (this.note && this.state) {
      const n = ptext(s, 0, y0 + ph - 16, this.note.text, this.note.ok ? OK : C.red, "sm").setMaxWidth(pw - 24);
      n.setX(x0 + Math.round((pw - measure(n).w) / 2));
      this.root.add(n);
    }
  }

  private nameOf(id: string) {
    return this.state?.friends.find((f) => f.id === id)?.name ?? "Friend";
  }

  private line(x: number, y: number, text: string, color: number = C.ink, font: "px" | "pxb" | "sm" = "px") {
    const t = ptext(this.scene, x, y, text, color, font);
    this.root.add(t);
    return t;
  }

  private button(x: number, y: number, label: string, fill: number, fn: () => void, minW = 0) {
    const b = new Button(this.scene, x, y, label, fill, fn, minW);
    this.root.add(b);
    return b;
  }

  /** Buttons along the right edge of a card, right to left. */
  private rightButtons(right: number, y: number, specs: [string, number, () => void][]) {
    let x = right;
    for (const [label, fill, fn] of specs) {
      const b = new Button(this.scene, 0, y, label, fill, fn);
      x -= b.width_;
      b.setX(x);
      x -= 4;
      this.root.add(b);
    }
    return x;
  }

  private card(x: number, y: number, w: number, h: number) {
    const g = this.scene.add.graphics();
    pixBox(g, x, y, w, h, C.paperLight, C.paperDark);
    this.root.add(g);
  }

  /** Cards in pages: as many as fit, with ◀ ▶ when there are more. */
  private paged<T>(items: T[], box: { x: number; y: number; w: number; h: number }, top: number, cardH: number, draw: (item: T, y: number) => void) {
    const room = Math.max(1, Math.floor((box.y + box.h - 18 - top) / (cardH + 3)));
    const pages = Math.max(1, Math.ceil(items.length / room));
    this.page = Math.min(this.page, pages - 1);
    items.slice(this.page * room, this.page * room + room).forEach((item, i) => draw(item, top + i * (cardH + 3)));
    if (pages > 1) {
      const y = box.y + box.h - 16;
      const at = this.line(box.x + box.w / 2 - 12, y + 3, `${this.page + 1}/${pages}`, C.inkSoft, "sm");
      at.setX(box.x + Math.round((box.w - measure(at).w) / 2));
      if (this.page > 0) this.button(at.x - 26, y, "◀", C.woodMid, () => ((this.page -= 1), sfx.blip(), this.draw()));
      if (this.page < pages - 1) this.button(at.x + measure(at).w + 6, y, "▶", C.woodMid, () => ((this.page += 1), sfx.blip(), this.draw()));
    }
  }

  // ---------------------------------------------------------------- the list

  private drawBoard(tab: "friends" | "requests" | "visitors", box: { x: number; y: number; w: number; h: number }) {
    const st = this.state!;
    // Tabs, then your code and the island's door.
    let tx = box.x;
    const tabs: ["friends" | "requests" | "visitors", string][] = [
      ["friends", `FRIENDS ${st.friends.length || ""}`.trim()],
      ["requests", `REQUESTS${st.incoming.length ? ` (${st.incoming.length})` : ""}`],
      ...(visiting() ? [] : ([["visitors", "VISITORS"]] as ["visitors", string][])),
    ];
    for (const [id, label] of tabs) {
      const b = this.button(tx, box.y, label, id === tab ? C.greenBtn : C.woodMid, () => id !== tab && (sfx.blip(), this.open({ kind: "board", tab: id })));
      tx += b.width_ + 4;
    }
    const code = this.line(0, box.y + 4, `Your code: ${st.code}`, C.ink, "pxb");
    code.setX(box.x + box.w - measure(code).w);
    // Add a friend: their code or email.
    const fy = box.y + 20;
    const fw = box.w - 64;
    const g = this.scene.add.graphics();
    pixBox(g, box.x, fy, fw, 15, this.typing ? 0xffffff : C.paperLight, this.typing ? C.coral : C.paperDark);
    const hit = this.scene.add.zone(box.x, fy, fw, 15).setOrigin(0).setInteractive({ useHandCursor: true });
    hit.on("pointerdown", () => !this.typing && this.startTyping());
    this.field = ptext(this.scene, box.x + 4, fy + 4, this.typing ? `${input.value}_` : "Add a friend: their code (MOON-XXXX) or email", this.typing ? C.ink : C.inkSoft, "sm");
    this.root.add([g, hit, this.field]);
    this.button(box.x + fw + 4, fy, "ADD", C.greenBtn, () => (this.typing && input.value.trim() ? this.submit() : this.startTyping()), 60);
    const top = fy + 20;

    if (tab === "friends") {
      if (!st.friends.length) {
        this.line(box.x + 4, top + 4, "No friends yet. Send someone your code, or add theirs above.", C.inkSoft, "sm");
        this.islandDoor(box, top + 20);
        return;
      }
      this.paged(st.friends, box, top, 26, (f, y) => {
        this.card(box.x, y, box.w, 26);
        const nm = this.line(box.x + 6, y + 4, f.name, C.ink, "pxb");
        this.line(box.x + 10 + measure(nm).w, y + 5, f.online ? "● home" : "○ away", f.online ? OK : C.inkSoft, "sm");
        const theirs = f.theirs.agents.length || f.theirs.office ? `lets you ask ${f.theirs.agents.map((v) => VILLAGER_SHORT[v]).join(", ")}${f.theirs.office ? `${f.theirs.agents.length ? ", " : ""}see their Office` : ""}` : "you can walk around, chat, help and gift";
        this.line(box.x + 6, y + 15, theirs, C.inkSoft, "sm").setMaxWidth(box.w - 170);
        this.rightButtons(box.x + box.w - 4, y + 5, [
          ["VISIT", C.greenBtn, () => this.fly(f.id)],
          ["ALLOW...", C.woodMid, () => (sfx.blip(), this.open({ kind: "perms", id: f.id }))],
        ]);
      });
      return;
    }

    if (tab === "requests") {
      const rows = [
        ...st.incoming.map((p) => ({ kind: "in" as const, ...p })),
        ...st.outgoing.map((p) => ({ kind: "out" as const, ...p })),
        ...st.blocked.map((p) => ({ kind: "blocked" as const, ...p })),
      ];
      if (!rows.length) return void this.line(box.x + 4, top + 4, "No requests right now.", C.inkSoft, "sm");
      this.paged(rows, box, top, 22, (r, y) => {
        this.card(box.x, y, box.w, 22);
        this.line(box.x + 6, y + 6, r.name, C.ink, "pxb");
        this.line(box.x + 90, y + 7, r.kind === "in" ? "wants to be friends" : r.kind === "out" ? "waiting for them to accept" : "blocked", C.inkSoft, "sm");
        if (r.kind === "in")
          this.rightButtons(box.x + box.w - 4, y + 3, [
            ["ACCEPT", C.greenBtn, () => void this.act("answer", { id: r.id, accept: true })],
            ["NO", C.woodMid, () => void this.act("answer", { id: r.id, accept: false })],
          ]);
        if (r.kind === "blocked") this.rightButtons(box.x + box.w - 4, y + 3, [["UNBLOCK", C.woodMid, () => void this.act("unblock", { id: r.id })]]);
      });
      return;
    }

    // Visitors: who's here now, then who came by.
    const here = [...mp.peers.values()].filter((p) => !p.owner && !isMe(p.id));
    const log = mp.session?.log ?? [];
    let y = top;
    this.line(box.x + 2, y, here.length ? "ON YOUR ISLAND NOW" : "Nobody's visiting right now.", C.inkSoft, "sm");
    y += 10;
    for (const p of here.slice(0, 3)) {
      this.card(box.x, y, box.w, 20);
      this.line(box.x + 6, y + 5, p.name, C.ink, "pxb");
      const id = p.id.split("~")[0];
      this.rightButtons(box.x + box.w - 4, y + 2, [
        ["BLOCK", C.red, () => void this.act("block", { id })],
        ["SEND HOME", C.woodMid, () => (sfx.blip(), net.send({ type: "kick", id }))],
      ]);
      y += 23;
    }
    y += 4;
    this.line(box.x + 2, y, log.length ? "WHO CAME BY" : "No visitors yet.", C.inkSoft, "sm");
    y += 10;
    for (const e of log) {
      if (y > box.y + box.h - 30) break;
      const did = [e.agents.length ? `asked ${e.agents.map((v) => VILLAGER_SHORT[v]).join(", ")}` : "", e.gathered ? `gathered ${e.gathered}x` : "", e.gifts.length ? `left ${e.gifts.slice(0, 2).join("; ")}` : ""].filter(Boolean).join(" · ");
      this.line(box.x + 4, y, `${e.name}, ${ago(e.at)}${did ? `: ${did}` : ""}`, C.ink, "sm").setMaxWidth(box.w - 8);
      y += 11;
    }
    this.islandDoor(box, box.y + box.h - 34);
  }

  /** OPEN / CLOSED: whether friends can visit right now. */
  private islandDoor(box: { x: number; y: number; w: number; h: number }, y: number) {
    const st = this.state!;
    this.line(box.x + 2, y + 4, st.closed ? "Your island is closed: nobody can visit." : "Your island is open to friends (even when you're away).", C.inkSoft, "sm");
    this.rightButtons(box.x + box.w, y, [[st.closed ? "OPEN IT" : "CLOSE IT", st.closed ? C.greenBtn : C.woodMid, () => void this.act("closed", { closed: !st.closed })]]);
  }

  private fly(id: string | null) {
    sfx.blip();
    this.close();
    this.scene.game.events.emit("fly", id);
  }

  // ---------------------------------------------------------------- the rocket

  private drawTravel(box: { x: number; y: number; w: number; h: number }) {
    const st = this.state!;
    let top = box.y;
    if (visiting()) {
      this.card(box.x, top, box.w, 22);
      this.line(box.x + 6, top + 6, "Home", C.ink, "pxb");
      this.line(box.x + 46, top + 7, "your own island", C.inkSoft, "sm");
      this.rightButtons(box.x + box.w - 4, top + 3, [["FLY HOME", C.greenBtn, () => this.fly(null)]]);
      top += 28;
    }
    const others = st.friends.filter((f) => f.id !== mp.session?.host.id);
    if (!others.length) {
      this.line(box.x + 4, top + 4, st.friends.length ? "No other friends to visit yet." : "Make friends first (the FRIENDS button, or share your code), then fly over.", C.inkSoft, "sm").setMaxWidth(box.w - 8);
      if (!visiting()) this.button(box.x + 4, top + 22, "FRIENDS", C.woodMid, () => (sfx.blip(), this.open({ kind: "board" })));
      return;
    }
    this.paged(others, box, top, 22, (f, y) => {
      this.card(box.x, y, box.w, 22);
      this.line(box.x + 6, y + 6, f.name, C.ink, "pxb");
      this.line(box.x + 90, y + 7, f.online ? "● home right now" : "○ away (their island's still open)", f.online ? OK : C.inkSoft, "sm");
      this.rightButtons(box.x + box.w - 4, y + 3, [["VISIT", C.greenBtn, () => this.fly(f.id)]]);
    });
  }

  // ---------------------------------------------------------------- what a friend may do here

  private drawPerms(id: string, box: { x: number; y: number; w: number; h: number }) {
    const f = this.state!.friends.find((x) => x.id === id);
    if (!f || !this.draft) return void this.line(box.x + 4, box.y + 4, "They're not on your friends list any more.", C.inkSoft, "sm");
    const d = this.draft;
    this.line(box.x + 2, box.y, `${f.name} can always walk around, chat, help gather and leave gifts. Let them ask these neighbors for real help too? It uses ${f.name}'s OWN accounts, and they can only look things up (never send, book or change anything).`, C.inkSoft, "sm").setMaxWidth(box.w - 4);
    const cols = 2;
    const cw = Math.floor((box.w - 4) / cols);
    let y = box.y + 38;
    ASKABLE.forEach((v, i) => {
      const cx = box.x + (i % cols) * (cw + 4);
      const cy = y + Math.floor(i / cols) * 19;
      const on = d.agents.includes(v);
      const b = this.button(cx, cy, `${on ? "✓" : "·"} ${VILLAGER_NAMES[v]}`, on ? C.greenBtn : 0x9a93a8, () => {
        sfx.blip();
        d.agents = on ? d.agents.filter((x) => x !== v) : [...d.agents, v];
        this.draw();
      }, 96);
      this.line(cx + b.width_ + 4, cy + 4, WHAT[v] ?? "", C.inkSoft, "sm");
    });
    y += Math.ceil(ASKABLE.length / cols) * 19 + 2;
    this.button(box.x, y, `${d.office ? "✓" : "·"} See my Office`, d.office ? C.greenBtn : 0x9a93a8, () => ((d.office = !d.office), sfx.blip(), this.draw()), 96);
    this.line(box.x + 100, y + 4, "watch your Claude Code agents (never prompt them)", C.inkSoft, "sm");
    const by = box.y + box.h - 34;
    this.button(box.x, by, "SAVE", C.greenBtn, () => void this.act("perms", { id, ...d }, () => (this.note = { text: `Saved what ${f.name} can do here.`, ok: true })), 60);
    this.button(box.x + 64, by, "BACK", C.woodMid, () => (sfx.blip(), this.open({ kind: "board" })));
    this.rightButtons(box.x + box.w, by, [
      ["BLOCK", C.red, () => void this.act("block", { id }, () => this.open({ kind: "board" }))],
      ["REMOVE FRIEND", C.woodMid, () => void this.act("remove", { id }, () => this.open({ kind: "board" }))],
    ]);
  }

  // ---------------------------------------------------------------- a gift

  private drawGift(box: { x: number; y: number; w: number; h: number }) {
    const w = mp.session?.wallet;
    if (!w) return void this.line(box.x + 4, box.y + 4, "Checking what you've got back home...", C.inkSoft, "sm");
    this.line(box.x + 2, box.y, `From your own coins and materials (back home). ${hostName()} finds it in their stockpile.`, C.inkSoft, "sm").setMaxWidth(box.w - 4);
    const rows: { label: string; have: number; get: () => number; set: (n: number) => void; step: number }[] = [
      { label: "coins", have: w.coins, get: () => this.gift.coins, set: (n) => (this.gift.coins = n), step: 5 },
      ...MATERIALS.filter((m) => w.materials[m] > 0).map((m) => ({ label: MATERIAL_NAME[m], have: w.materials[m], get: () => this.gift.materials[m] ?? 0, set: (n: number) => (this.gift.materials[m] = n), step: 1 })),
    ];
    const cols = 2;
    const cw = Math.floor((box.w - 4) / cols);
    rows.slice(0, 8).forEach((r, i) => {
      const x = box.x + (i % cols) * (cw + 4);
      const y = box.y + 24 + Math.floor(i / cols) * 19;
      this.button(x, y, "-", C.woodMid, () => (r.set(Math.max(0, r.get() - r.step)), sfx.blip(), this.draw()), 16);
      const n = this.line(x + 22, y + 4, `${r.get()}`, C.ink, "pxb");
      this.button(x + 26 + Math.max(18, measure(n).w), y, "+", C.woodMid, () => (r.set(Math.min(r.have, r.get() + r.step)), sfx.blip(), this.draw()), 16);
      this.line(x + 50 + Math.max(18, measure(n).w), y + 4, `${r.label} (have ${r.have})`, C.inkSoft, "sm");
    });
    const any = this.gift.coins > 0 || Object.values(this.gift.materials).some((n) => (n ?? 0) > 0);
    this.button(box.x + box.w - 90, box.y + box.h - 18, "GIVE", any ? C.greenBtn : 0x9a93a8, () => {
      if (!any) return sfx.deny();
      sfx.blip();
      net.send({ type: "gift", coins: this.gift.coins, materials: this.gift.materials });
      this.close();
    }, 90);
  }
}
