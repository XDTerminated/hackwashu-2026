// Talking to a neighbor where you stand. Walk up to someone and press E or
// Enter to text-chat (a chat bar opens above the toolbar, with the conversation
// so far), or tap / hold TAB to speak, or turn on the OPEN MIC and just talk.
// They stop, turn to you, and answer in bubbles over their own head, out loud.
// Letters, account connections and the Office still open their windows.

import Phaser from "phaser";
import { VILLAGER_SHORT, type VillagerId } from "../../shared/game";
import type { VillagerActor } from "./actors";
import { listen, listenOpen, micSupported, type Listening } from "./mic";
import * as net from "./net";
import { isSfxMuted, onSfxToggle, sfx } from "./sfx";
import { claimInput, input, releaseInput, type InputOwner } from "./textinput";
import * as voice from "./voice";
import { C, Label, TOOLBAR_H, measure, ptext, woodFrame } from "./widgets";

export interface NearHost {
  scene: Phaser.Scene;
  player(): Phaser.GameObjects.Sprite;
  actor(v: VillagerId): VillagerActor | undefined;
  /** The neighbor you're close enough to talk to (moved in and ready to work), if any. */
  nearest(): VillagerId | null;
  hold(v: VillagerId): void;
  release(): void;
  /** Something else has the keyboard (a window, the MoonPad, the shop, edit mode). */
  blocked(): boolean;
  greeting(v: VillagerId): string;
}

/** A conversation stays open this long after the last thing either of you said. */
const STAY_MS = 30_000;
/** Walk further than this from them and the conversation's over. */
const LEAVE_PX = 96;
/** While the chat is up, the camera keeps you this far down the screen (so the log never covers you). */
const LIFT_TO = 0.3;
/** Come back within this long and they don't introduce themselves again. */
const GREET_AGAIN_MS = 5 * 60_000;

const EXAMPLES: Partial<Record<VillagerId, string>> = {
  jade_rabbit: "reply to my professor and put it on my calendar",
  postmaster: "what's in my inbox?",
  timekeeper: "am I free Tuesday afternoon?",
  scholar: "what's due this week?",
  stargazer: "when is the next full moon?",
};

// ---------------------------------------------------------------- the open mic (a toolbar toggle)

const OPEN_KEY = "moon-open-mic";
let openOn = (() => {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
})();
const openListeners = new Set<(on: boolean) => void>();

export const isOpenMic = () => openOn;

export function toggleOpenMic() {
  openOn = !openOn;
  try {
    localStorage.setItem(OPEN_KEY, openOn ? "1" : "0");
  } catch {
    /* just for this visit */
  }
  openListeners.forEach((fn) => fn(openOn));
}

export function onOpenMic(fn: (on: boolean) => void) {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}

/** The pixel font has no emoji. */
const plainText = (text: string) => text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();

/** Split a reply into bubble-sized pieces (a sentence or two each). */
function pieces(text: string): string[] {
  const out: string[] = [];
  for (const s of plainText(text).split(/(?<=[.!?…])\s+/)) {
    const last = out[out.length - 1];
    if (last && last.length + s.length < 100) out[out.length - 1] = `${last} ${s}`;
    else out.push(s);
  }
  // (a sentence too long for one bubble carries on in the next: "...")
  const split = (p: string) => p.match(/.{1,106}(\s|$)/g)!.map((x, i, all) => x.trim() + (i < all.length - 1 ? "..." : ""));
  return out.flatMap((p) => (p.length <= 118 ? [p] : split(p))).filter(Boolean);
}

export class NearTalk {
  typing = false;
  /** Who you're talking with (their replies come as bubbles over their head). */
  private with: VillagerId | null = null;
  private lastAt = 0;
  private mine: Label | null = null;
  private mineTimer: Phaser.Time.TimerEvent | null = null;
  private listening: Listening | null = null;
  private listenDownAt = 0;
  private open: { stop(): void } | null = null;
  /** The open mic pauses while a neighbor is talking (it would hear them). */
  private quietUntil = 0;
  private sentAt = 0;
  private greeted = new Map<VillagerId, number>();
  /** Bumped to cut off whatever they're still saying (you walked away). */
  private replySeq = 0;
  private speaking: Promise<void> = Promise.resolve();
  /** What's been said, per neighbor (come back within a few minutes and it's still there). */
  private history = new Map<VillagerId, { at: number; lines: { you: boolean; text: string }[] }>();
  private logUntil = 0;
  private chat: {
    W: number;
    H: number;
    box: Phaser.GameObjects.Graphics;
    line: Phaser.GameObjects.BitmapText;
    hint: Phaser.GameObjects.BitmapText;
    logBg: Phaser.GameObjects.Graphics;
    log: Phaser.GameObjects.BitmapText[];
  } | null = null;
  private owner: InputOwner = {
    render: () => this.renderChat(),
    submit: () => this.submitTyped(),
    active: () => this.typing,
  };
  private offs: Array<() => void> = [];

  constructor(private host: NearHost) {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.typing) return this.cancelTyping();
      if (e.key !== "Tab") return;
      const v = this.host.nearest();
      if (this.host.blocked() && !this.typing) return;
      if (!v && !this.listening) return;
      e.preventDefault();
      if (e.repeat) return;
      if (this.listening) return void this.listening.stop(); // a second tap sends
      if (this.typing) this.cancelTyping(); // switch from typing to talking
      if (v) this.startListening(v);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !this.listening) return;
      e.preventDefault();
      // a hold sends on release; a quick tap keeps listening until the next tap
      if (performance.now() - this.listenDownAt > 400) this.listening.stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    this.offs.push(() => window.removeEventListener("keydown", down), () => window.removeEventListener("keyup", up));
    this.offs.push(onOpenMic(() => this.syncOpenMic()));
    this.offs.push(onSfxToggle((m) => m && voice.stopSpeaking()));
  }

  destroy() {
    this.offs.forEach((f) => f());
    this.stopOpenMic();
    this.listening?.cancel();
    this.cancelTyping();
    this.mine?.destroy();
    this.destroyChat();
  }

  /** Who you're talking with right now, if anyone. */
  get partner() {
    return this.with;
  }

  /** Are they the one you're talking with (so their replies belong to this conversation)? */
  isWith(v: VillagerId) {
    return this.with === v && Date.now() - this.lastAt < STAY_MS;
  }

  /** Just sent something (Enter shouldn't immediately start a new line). */
  get justSent() {
    return performance.now() - this.sentAt < 250;
  }

  private placeholder() {
    const ex = this.with ? EXAMPLES[this.with] : undefined;
    return ex ? `try: "${ex}"` : "say something...";
  }

  /** Start talking with them: they stop, turn to you, and say hello (unless you only just spoke). */
  private begin(v: VillagerId) {
    if (this.with !== v) this.host.release();
    this.with = v;
    this.lastAt = Date.now();
    this.host.hold(v);
    const last = this.greeted.get(v) ?? 0;
    if (Date.now() - last > GREET_AGAIN_MS) {
      this.greeted.set(v, Date.now());
      const hello = this.host.greeting(v);
      this.host.actor(v)?.say(hello, 5000, this.theirSide());
      this.log(v, false, hello);
    }
  }

  // ---------------------------------------------------------------- typing

  /** E next to someone: with the open mic on, just start talking; otherwise the chat bar opens. */
  talk(v: VillagerId) {
    if (!openOn || !micSupported) return this.startTyping(v);
    this.begin(v);
    this.flashMine("(listening: just talk)", 2500);
    sfx.blip();
    this.syncOpenMic();
  }

  /** Enter (or E without the open mic) next to someone: the chat bar opens (and "..." over your head while you type). */
  startTyping(v: VillagerId) {
    if (this.typing) return;
    this.begin(v);
    this.typing = true;
    this.stopOpenMic();
    claimInput(this.owner);
    input.value = "";
    this.showMine(". . .", true);
    this.renderChat();
    sfx.blip();
  }

  cancelTyping() {
    if (!this.typing) return;
    this.typing = false;
    releaseInput(this.owner);
    this.hideMine();
    this.renderChat();
    this.syncOpenMic();
  }

  /** Enter sends and the bar stays open for the next line; Enter on an empty line (or ESC) closes it. */
  private submitTyped() {
    const text = input.value.trim();
    this.sentAt = performance.now();
    if (!text || !this.with) return this.cancelTyping();
    input.value = "";
    this.say(text);
    this.renderChat();
  }

  // ---------------------------------------------------------------- speaking (TAB, or the open mic)

  private startListening(v: VillagerId) {
    if (!micSupported) {
      this.flashMine("Voice needs Chrome, Edge or Safari. Press E to type instead.");
      return;
    }
    this.begin(v);
    this.stopOpenMic();
    this.listenDownAt = performance.now();
    const l = listen(
      (text) => this.showMine(text || "listening...", !text),
      (problem) => this.flashMine(problem),
    );
    if (!l) return;
    this.listening = l;
    this.showMine("listening... (tap TAB to send)", true);
    sfx.blip();
    void l.heard.then((text) => {
      if (this.listening !== l) return;
      this.listening = null;
      if (text) this.say(text);
      else this.hideMine();
      this.syncOpenMic();
    });
  }

  /**
   * The open mic only listens in a conversation you started (E next to someone),
   * while you're still beside them: never just because you walked past. It goes
   * quiet when you walk off, or after half a minute of nobody saying anything.
   */
  private syncOpenMic() {
    const v = this.with;
    const talking = !!v && this.isWith(v) && this.host.nearest() === v;
    const want = openOn && micSupported && talking && !this.typing && !this.listening && !this.host.blocked() && Date.now() >= this.quietUntil;
    if (want && !this.open) {
      this.open = listenOpen(
        (phrase) => {
          if (!this.with || Date.now() < this.quietUntil) return;
          this.say(phrase);
        },
        (partial) => {
          if (!partial || !this.with) return;
          this.lastAt = Date.now(); // (still talking: don't let the conversation lapse mid-sentence)
          this.showMine(partial, true);
        },
        (problem) => {
          this.flashMine(problem);
          if (openOn) toggleOpenMic();
        },
      );
    } else if (!want && this.open) this.stopOpenMic();
  }

  private stopOpenMic() {
    this.open?.stop();
    this.open = null;
  }

  // ---------------------------------------------------------------- the conversation

  /** You say it: a bubble over your head, and off it goes to them. */
  private say(text: string) {
    const v = this.with;
    if (!v) return;
    this.lastAt = Date.now();
    this.flashMine(text, Math.max(2200, text.length * 55));
    this.log(v, true, text);
    sfx.blip();
    if (net.send({ type: "task", villager: v, text })) this.host.actor(v)?.say(". . .", 30_000, this.theirSide());
    else this.host.actor(v)?.say("(the line to the colony is down)", 3000, this.theirSide());
  }

  /** Their answer: a sentence or two at a time over their head, said out loud. */
  reply(v: VillagerId, text: string) {
    const a = this.host.actor(v);
    if (!a) return;
    this.lastAt = Date.now();
    const seq = this.replySeq;
    const parts = pieces(text);
    this.log(v, false, plainText(text));
    // (the mic mustn't hear them talking)
    this.stopOpenMic();
    this.quietUntil = Date.now() + 60_000;
    // (the toolbar's sound button quiets voices too)
    const line = voice.isMuted() || isSfxMuted() ? null : voice.prepare(v, text);
    // "On it..." and then the answer: one after the other, never over each other.
    this.speaking = this.speaking.then(async () => {
      const buf = line ? await voice.ready(line) : null;
      if (seq !== this.replySeq || !a.sprite.scene) return;
      const speech = line ? voice.play(line, buf, a) : null;
      const total = parts.reduce((n, p) => n + p.length, 0);
      const spoken = speech?.duration ?? 0;
      for (const p of parts) {
        if (seq !== this.replySeq || !a.sprite.scene) return;
        // each bubble stays for its share of the spoken line, or long enough to read
        const ms = Math.max(1800, p.length * 55, spoken * (p.length / total));
        a.say(p, ms + 400, this.theirSide());
        await new Promise((r) => this.host.scene.time.delayedCall(ms, r));
        this.lastAt = Date.now();
      }
      this.quietUntil = Date.now() + 700;
      this.host.scene.time.delayedCall(800, () => this.syncOpenMic());
    });
  }

  // ---------------------------------------------------------------- the chat bar

  private log(v: VillagerId, you: boolean, text: string) {
    let h = this.history.get(v);
    if (!h || Date.now() - h.at > GREET_AGAIN_MS) this.history.set(v, (h = { at: 0, lines: [] }));
    h.at = Date.now();
    h.lines.push({ you, text });
    if (h.lines.length > 20) h.lines.shift();
    this.logUntil = Date.now() + 9000;
    this.renderChat();
  }

  private destroyChat() {
    if (!this.chat) return;
    for (const o of [this.chat.box, this.chat.line, this.chat.hint, this.chat.logBg, ...this.chat.log]) o.destroy();
    this.chat = null;
  }

  /** The bar (while typing) and the conversation so far just above it (while typing, and for a bit after each line). */
  private renderChat(barOnly = false) {
    const scene = this.host.scene;
    const W = scene.scale.width;
    const H = scene.scale.height;
    if (this.chat && (this.chat.W !== W || this.chat.H !== H)) this.destroyChat();
    const pin = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T, d = 0) => (o.setScrollFactor(0), o.setDepth(1_000_000 + d), o);
    if (!this.chat)
      this.chat = {
        W,
        H,
        box: pin(scene.add.graphics()),
        line: pin(ptext(scene, 0, 0, "", C.ink), 1),
        hint: pin(ptext(scene, 0, 0, "ENTER send  /  ESC close  /  TAB speak", 0xb9aed0, "sm"), 1),
        logBg: pin(scene.add.graphics()),
        log: [],
      };
    const c = this.chat;
    const PAD = 8;
    const barW = Math.min(W - 32, 460);
    const x0 = Math.round((W - barW) / 2);
    const barH = 22;
    const barY = H - TOOLBAR_H - barH - 6;
    const hintH = 14;
    const who = this.with ? VILLAGER_SHORT[this.with] : "";
    const panel = 0x1b1530;

    // the bar
    c.box.clear();
    c.box.setVisible(this.typing);
    c.line.setVisible(this.typing);
    c.hint.setVisible(this.typing);
    if (this.typing) {
      // (the key hints sit on a dark strip that joins the log above)
      c.box.fillStyle(panel, 0.8).fillRect(x0, barY - hintH, barW, hintH);
      woodFrame(c.box, x0, barY, barW, barH, C.paperLight);
      const cursor = Math.floor(performance.now() / 500) % 2 ? "_" : " ";
      const prefix = `to ${who}:  `;
      const typed = input.value;
      c.line.setTint(typed ? C.ink : C.inkSoft);
      // keep the end of a long line in view
      let shown = typed || this.placeholder();
      c.line.setText(prefix + shown + (typed ? cursor : ""));
      while (typed && measure(c.line).w > barW - PAD * 2 && shown.length > 1) {
        shown = shown.slice(1);
        c.line.setText(`${prefix}...${shown}${cursor}`);
      }
      c.line.setPosition(x0 + PAD, barY + Math.round((barH - measure(c.line).h) / 2));
      c.hint.setPosition(x0 + barW - measure(c.hint).w - PAD, barY - hintH + 4);
    }

    if (barOnly) return;
    // the conversation so far: names in their own column, messages wrapped beside them
    for (const t of c.log) t.destroy();
    c.log = [];
    c.logBg.clear();
    const lines = this.with ? (this.history.get(this.with)?.lines ?? []) : [];
    const showLog = lines.length > 0 && (this.typing || Date.now() < this.logUntil);
    if (!showLog) return;
    const bottom = this.typing ? barY - hintH : barY + barH;
    // (it stops short of your feet: the camera lifts you into the top third while the chat is up)
    const maxH = Math.min(170, bottom - Math.round(H * LIFT_TO) - 20);
    const names = [...new Set(lines.map((l) => (l.you ? "You" : VILLAGER_SHORT[this.with!])))];
    const probe = ptext(scene, 0, 0, "", C.ink, "pxb");
    const nameW = Math.max(...names.map((n) => (probe.setText(n), measure(probe).w))) + 8;
    probe.destroy();
    const textW = barW - PAD * 2 - nameW;
    let y = bottom - PAD + 2;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      const color = l.you ? 0xffd98a : 0xffffff;
      const msg = pin(ptext(scene, x0 + PAD + nameW, 0, l.text, l.you ? 0xfff0cf : 0xf0ecf8), 1);
      msg.setMaxWidth(textW).setLineSpacing(2);
      const h = measure(msg).h;
      if (bottom - (y - h) > maxH && c.log.length) {
        msg.destroy();
        break;
      }
      y -= h;
      msg.setY(y);
      const name = pin(ptext(scene, x0 + PAD, y, l.you ? "You" : VILLAGER_SHORT[this.with!], color, "pxb"), 1);
      c.log.push(msg, name);
      y -= 7; // breathing room between messages
    }
    const top = y - PAD + 9;
    c.logBg.fillStyle(panel, 0.8).fillRect(x0, top, barW, bottom - top);
    c.logBg.fillStyle(0x3a2f5c, 1).fillRect(x0, top, barW, 1);
  }

  // ---------------------------------------------------------------- your bubble

  private showMine(text: string, hint = false) {
    this.mineTimer?.remove();
    this.mineTimer = null;
    const t = text.length > 140 ? `...${text.slice(-137)}` : text;
    const side = this.mySide();
    if (this.mine && this.mine.opts.originX !== side) this.hideMine();
    if (!this.mine || !this.mine.scene) this.mine = new Label(this.host.scene, 0, 0, t, { bg: 0xe6c189, border: 0xc9975a, maxWidth: 150, tail: true, originX: side }).setDepth(99995);
    else this.mine.setText(t);
    this.mine.setAlpha(hint ? 0.75 : 1);
    this.place();
  }

  private flashMine(text: string, ms = 3200) {
    this.showMine(text);
    this.mineTimer = this.host.scene.time.delayedCall(ms, () => this.hideMine());
  }

  private hideMine() {
    this.mineTimer?.remove();
    this.mineTimer = null;
    this.mine?.destroy();
    this.mine = null;
  }

  /** Side by side, the two bubbles lean away from each other: yours out your side, theirs out theirs. */
  private mySide() {
    const a = this.with ? this.host.actor(this.with) : undefined;
    if (!a) return 0.5;
    return a.x >= this.host.player().x ? 0.95 : 0.05;
  }

  private theirSide() {
    const s = this.mySide();
    return s === 0.5 ? 0.5 : 1 - s;
  }

  private place() {
    const p = this.host.player();
    this.mine?.place(Math.round(p.x), Math.round(p.y) - 30);
  }

  /** Every frame: keep your bubble over you, end the conversation when you walk off, run the open mic. */
  update() {
    this.place();
    // Lift the view while the chat is up (the camera eases there on its own).
    const cam = this.host.scene.cameras.main;
    const chatUp = this.typing || !!this.chat?.log.length;
    cam.followOffset.y = chatUp ? -Math.round(cam.height * (0.5 - LIFT_TO)) : 0;
    if (this.typing) this.renderChat(true); // (the cursor blinks)
    else if (this.chat?.log.length && Date.now() > this.logUntil) this.renderChat(); // (the log tucks away)
    if (this.with) {
      const a = this.host.actor(this.with);
      const p = this.host.player();
      const away = !a || Math.hypot(a.x - p.x, a.y - p.y) > LEAVE_PX;
      if (away || (!this.typing && !this.listening && Date.now() - this.lastAt > STAY_MS)) {
        if (this.typing) this.cancelTyping();
        this.listening?.cancel();
        this.listening = null;
        this.with = null;
        this.replySeq++;
        voice.stopSpeaking();
        this.quietUntil = 0;
        this.host.release();
      }
    }
    this.syncOpenMic();
  }

  /** Name for the prompt ("[E] talk to Hoot"). */
  static label(v: VillagerId) {
    return `[E] talk to ${VILLAGER_SHORT[v]}`;
  }
}

