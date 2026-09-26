// Talking to a neighbor where you stand, no chat box. Walk up to someone and
// press E or Enter to say something (your words appear in a bubble over your
// head), or tap / hold TAB to speak it, or turn on the OPEN MIC and just talk.
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
import { Label } from "./widgets";

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

/** Split a reply into bubble-sized pieces (a sentence or two each). */
function pieces(text: string): string[] {
  const out: string[] = [];
  // (the pixel font has no emoji)
  const plain = text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
  for (const s of plain.split(/(?<=[.!?…])\s+/)) {
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
  private owner: InputOwner = {
    render: () => this.showMine(input.value || this.placeholder(), !input.value),
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
      this.host.actor(v)?.say(this.host.greeting(v), 5000, this.theirSide());
    }
  }

  // ---------------------------------------------------------------- typing

  /** E or Enter next to someone: type to them, in a bubble over your head. */
  startTyping(v: VillagerId) {
    if (this.typing) return;
    this.begin(v);
    this.typing = true;
    this.stopOpenMic();
    claimInput(this.owner);
    input.value = "";
    this.owner.render();
    sfx.blip();
  }

  cancelTyping() {
    if (!this.typing) return;
    this.typing = false;
    releaseInput(this.owner);
    this.hideMine();
    this.syncOpenMic();
  }

  private submitTyped() {
    const text = input.value.trim();
    this.typing = false;
    releaseInput(this.owner);
    this.sentAt = performance.now();
    if (!text || !this.with) {
      this.hideMine();
      this.syncOpenMic();
      return;
    }
    this.say(text);
    this.syncOpenMic();
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

  /** The open mic runs while it's on and you're next to someone (and nothing else needs you). */
  private syncOpenMic() {
    const v = this.host.nearest();
    const want = openOn && !!v && !this.typing && !this.listening && !this.host.blocked() && Date.now() >= this.quietUntil;
    if (want && !this.open) {
      this.open = listenOpen(
        (phrase) => {
          const who = this.host.nearest();
          if (!who || Date.now() < this.quietUntil) return;
          this.begin(who);
          this.say(phrase);
        },
        (partial) => partial && this.host.nearest() && this.showMine(partial, true),
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
    // (the mic mustn't hear them talking)
    this.stopOpenMic();
    this.quietUntil = Date.now() + 60_000;
    // (the toolbar's sound button quiets voices too)
    const line = voice.isMuted() || isSfxMuted() ? null : voice.prepare(v, text);
    // "On it..." and then the answer: one after the other, never over each other.
    this.speaking = this.speaking.then(async () => {
      const buf = line ? await voice.ready(line) : null;
      if (seq !== this.replySeq || !a.sprite.scene) return;
      const speech = line ? voice.play(line, buf) : null;
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

