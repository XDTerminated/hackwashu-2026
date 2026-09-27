// Talking to a neighbor where you stand. With the mic on, just talk: near a
// neighbor, say their name ("Hey Hoot, ...") or say hi right beside them, and
// the conversation starts hands-free (you can keep walking; walk off or press
// ESC to leave). Or press E (or Enter) to type. They stop, turn to you, and
// answer out loud in bubbles over their head, and you can talk over them to
// interrupt. The mic button (on the bar and the toolbar) turns voice off, and
// it stays off until you turn it back on. Letters, account connections and
// the Office keep their windows.

import Phaser from "phaser";
import { VILLAGER_SHORT, type VillagerId } from "../../shared/game";
import { listenOpen, micSupported } from "./mic";
import { spokenEmails } from "./spoken";
import * as net from "./net";
import { isSfxMuted, onSfxToggle, sfx } from "./sfx";
import { claimInput, input, releaseInput, type InputOwner } from "./textinput";
import * as voice from "./voice";
import { C, Label, TOOLBAR_H, measure, ptext, woodFrame } from "./widgets";

/** Whoever you're talking with: where they stand, and a bubble over their head (a villager on the island, or Ada in the Office). */
export interface Talker {
  x: number;
  y: number;
  sprite: { scene?: unknown };
  say(text: string, ms?: number, originX?: number): void;
}

export interface NearHost {
  scene: Phaser.Scene;
  player(): Phaser.GameObjects.Sprite;
  actor(v: VillagerId): Talker | undefined;
  /** The neighbor you're close enough to talk to (moved in and ready to work), if any. */
  nearest(): VillagerId | null;
  hold(v: VillagerId): void;
  release(): void;
  /** The neighbors within `r` pixels of you, nearest first. */
  around(r: number): VillagerId[];
  /** Something else needs you (a window, the MoonPad, the shop, edit mode). */
  blocked(): boolean;
  greeting(v: VillagerId): string;
}

/** Walking off: the chat holds this long, then fades out over FADE_MS. */
const FADE_HOLD = 350;
const FADE_MS = 550;
/** After you leave the chat, their answer still arrives over their head for this long. */
const STAY_MS = 30_000;
/** Walk further than this from them and the conversation's over. */
const LEAVE_PX = 96;
/** While the chat is up, the camera keeps you this far down the screen (so the log never covers you). */
const LIFT_TO = 0.3;
/** With the mic on, it listens for you when a neighbor is this close (and only then). */
const HEAR_PX = 110;
/** Speech sends after this much quiet; talk again before then and it keeps adding on. */
const SILENCE_MS = 2200;
/** Come back within this long and they don't introduce themselves again. */
const GREET_AGAIN_MS = 5 * 60_000;

const EXAMPLES: Partial<Record<VillagerId, string>> = {
  jade_rabbit: "reply to my professor and put it on my calendar",
  postmaster: "what's in my inbox?",
  timekeeper: "am I free Tuesday afternoon?",
  scholar: "what's due this week?",
  stargazer: "when is the next full moon?",
  dj: "play Fly Me to the Moon",
  mechanic: "any PRs waiting on me?",
};

// ---------------------------------------------------------------- the mic setting
// On unless you turn it off; once off, it stays off (remembered) until you turn it on.

const MIC_KEY = "moon-mic-v2";
let micOn = (() => {
  try {
    return localStorage.getItem(MIC_KEY) !== "0";
  } catch {
    return true;
  }
})();
const micListeners = new Set<(on: boolean) => void>();

export const isMicOn = () => micOn && micSupported;

export function setMic(on: boolean) {
  micOn = on;
  try {
    localStorage.setItem(MIC_KEY, on ? "1" : "0");
  } catch {
    /* just for this visit */
  }
  micListeners.forEach((fn) => fn(isMicOn()));
}

export const toggleMic = () => setMic(!micOn);

export function onMicToggle(fn: (on: boolean) => void) {
  micListeners.add(fn);
  return () => micListeners.delete(fn);
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

/** How each name tends to come through speech recognition. */
const CALLS: Record<VillagerId, string[]> = {
  jade_rabbit: ["yutu", "you too", "yu tu", "utu", "yoda", "rabbit", "bunny"],
  postmaster: ["hoot", "hoots", "hood", "hoop", "poot", "who't", "owl", "postmaster"],
  timekeeper: ["cog", "cogs", "cod", "timekeeper", "clock"],
  scholar: ["mabel", "maple", "mable", "maybelle", "scholar"],
  stargazer: ["nova", "nover", "noah", "stargazer"],
  manager: ["ada", "ayda", "aida"],
  dj: ["echo", "echoes", "eko", "dj", "deejay"],
  mechanic: ["tinker", "tinkers", "tinka", "mechanic"],
};
const HELLO = /^(hey|hi|hello|hiya|yo|howdy|oh hey|excuse me|good (morning|afternoon|evening))\b/i;
const words = (t: string) => t.toLowerCase().match(/[a-z0-9']+/g) ?? [];

export class NearTalk {
  /** A conversation is open (the bar and the log are up, the mic listens if it's on). */
  chatting = false;
  /** ...and the keyboard is in it (E or Enter): keys type instead of walking. */
  typing = false;
  /** Who you're talking with (their replies come as bubbles over their head). */
  private with: VillagerId | null = null;
  private lastAt = 0;
  private mine: Label | null = null;
  private mineTimer: Phaser.Time.TimerEvent | null = null;
  private open: { stop(): void } | null = null;
  /** What the mic is hearing right now (before you finish the sentence). */
  private heard = "";
  /** Everything you've said so far that hasn't been sent (it waits for you to pause). */
  private spoken = "";
  private sendAt = 0;
  private sendTimer: number | null = null;
  private them: "thinking" | "talking" | null = null;
  /** What they're saying out loud right now (so the mic can tell their voice from yours). */
  private saying = "";
  private note = "";
  private greeted = new Map<VillagerId, number>();
  /** Bumped to cut off whatever they're still saying (you walked away). */
  private replySeq = 0;
  private speaking: Promise<void> = Promise.resolve();
  /** What's been said, per neighbor (come back within a few minutes and it's still there). */
  private history = new Map<VillagerId, { at: number; lines: { you: boolean; text: string }[] }>();
  private logUntil = 0;
  /** When you walked off: the bar and the conversation hold a beat, then fade away together. */
  private fadeAt = 0;
  private chat: {
    W: number;
    H: number;
    box: Phaser.GameObjects.Graphics;
    line: Phaser.GameObjects.BitmapText;
    hint: Phaser.GameObjects.BitmapText;
    mic: Phaser.GameObjects.Image;
    micWord: Phaser.GameObjects.BitmapText;
    logBg: Phaser.GameObjects.Graphics;
    log: (Phaser.GameObjects.BitmapText | Phaser.GameObjects.Image)[];
  } | null = null;
  private owner: InputOwner = {
    render: () => {
      // Started typing mid-sentence? What you'd said moves into the box so you can finish it by hand.
      const said = `${this.spoken} ${this.heard}`.trim();
      if (said && input.value) {
        input.value = `${said} ${input.value}`;
        this.clearSpeech();
      }
      this.renderChat();
    },
    submit: () => this.submitTyped(),
    active: () => this.typing,
  };
  private offs: Array<() => void> = [];

  constructor(private host: NearHost) {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.chatting) this.leave();
      // talking hands-free? Enter switches to typing
      else if (e.key === "Enter" && this.chatting && !this.typing && !this.host.blocked()) {
        e.preventDefault();
        if (this.spoken || this.heard) this.flushSpeech(true);
        else this.startTyping();
      }
    };
    window.addEventListener("keydown", down);
    this.offs.push(() => window.removeEventListener("keydown", down));
    this.offs.push(
      onMicToggle(() => {
        this.note = "";
        this.syncMic();
        this.renderChat();
      }),
    );
    this.offs.push(onSfxToggle((m) => m && voice.stopSpeaking()));
  }

  destroy() {
    this.offs.forEach((f) => f());
    this.stopMic();
    this.leave();
    this.clearSpeech();
    this.mine?.destroy();
    this.destroyChat();
  }

  /** Stepping away somewhere else (into the Office): the chat closes and the mic stops listening here. */
  hush() {
    this.leave();
    this.stopMic();
  }

  /** Who you're talking with right now, if anyone. */
  get partner() {
    return this.with;
  }

  /** Are they the one you're talking with (so their replies belong to this conversation)? */
  isWith(v: VillagerId) {
    return this.with === v && (this.chatting || Date.now() - this.lastAt < STAY_MS);
  }

  private placeholder() {
    const ex = this.with ? EXAMPLES[this.with] : undefined;
    return ex ? `try: "${ex}"` : "say something...";
  }

  /** Start talking with them: they stop, turn to you, and say hello (unless you only just spoke, or opened with a hello yourself). */
  private begin(v: VillagerId, greet = true) {
    if (this.with !== v) this.host.release();
    this.with = v;
    this.lastAt = Date.now();
    this.host.hold(v);
    const last = this.greeted.get(v) ?? 0;
    if (!greet) this.greeted.set(v, Date.now());
    else if (Date.now() - last > GREET_AGAIN_MS) {
      this.greeted.set(v, Date.now());
      const hello = this.host.greeting(v);
      this.host.actor(v)?.say(hello, 5000, this.theirSide());
      this.log(v, false, hello);
    }
  }

  // ---------------------------------------------------------------- the chat

  /** E next to someone: the chat opens for typing (the mic still listens, if it's on). */
  start(v: VillagerId) {
    if (this.chatting && this.with === v) return this.startTyping();
    if (this.chatting) this.leave();
    this.begin(v);
    this.chatting = true;
    this.startTyping();
    sfx.blip();
  }

  /** You spoke to them (by name, or a hello right beside them): the conversation starts hands-free. */
  private startVoice(v: VillagerId, opening: string) {
    this.begin(v, false);
    this.chatting = true;
    this.typing = false;
    sfx.blip();
    this.hear(opening);
  }

  private startTyping() {
    this.typing = true;
    claimInput(this.owner);
    input.value = "";
    this.renderChat();
  }

  /** ESC, or walking off: the conversation closes. (Their answer still arrives over their head.) */
  leave() {
    if (!this.chatting) return;
    this.chatting = false;
    this.typing = false;
    this.clearSpeech();
    releaseInput(this.owner);
    this.hideMine();
    // (the chat stays as it was for a beat, then fades out: see update)
    this.fadeAt = Date.now();
  }

  /** Enter sends what you typed, or what you've said so far (without waiting for the pause). */
  private submitTyped() {
    if (!input.value.trim() && (this.spoken || this.heard)) return this.flushSpeech(true);
    const text = input.value.trim();
    if (!text || !this.with) return;
    input.value = "";
    this.say(text);
  }

  // ---------------------------------------------------------------- speech waits for you to pause

  private armSend() {
    if (this.sendTimer !== null) clearTimeout(this.sendTimer);
    this.sendAt = Date.now() + SILENCE_MS;
    this.sendTimer = window.setTimeout(() => this.flushSpeech(false), SILENCE_MS);
  }

  private clearSpeech() {
    if (this.sendTimer !== null) clearTimeout(this.sendTimer);
    this.sendTimer = null;
    this.sendAt = 0;
    this.spoken = "";
    this.heard = "";
  }

  /** You've paused long enough (or pressed Enter): send everything you said as one message. */
  private flushSpeech(now: boolean) {
    // (still mid-word, or they're still working out their answer? give it a moment longer)
    if (!now && (this.heard || this.them === "thinking")) return this.armSend();
    let text = `${this.spoken} ${now ? this.heard : ""}`.trim();
    this.clearSpeech();
    // addresses said out loud come back together for the mail ("jordan at gmail dot com")
    if (text && (this.with === "postmaster" || this.with === "jade_rabbit" || /\b(e-?mail|mail|address|send)\b/i.test(text))) text = spokenEmails(text);
    if (text && this.with && this.chatting) this.say(text);
    else this.renderChat();
  }

  /** Words you said (a finished phrase): they add up until you pause. */
  private hear(phrase: string) {
    this.spoken = `${this.spoken} ${phrase}`.trim();
    this.heard = "";
    this.armSend();
    this.showMine(this.spoken, true);
    this.renderChat(true);
  }

  /** Is that just their own voice coming back through the speakers? */
  private echo(text: string) {
    const w = words(text);
    if (!w.length) return true;
    const theirs = new Set(words(this.saying));
    return w.filter((x) => theirs.has(x)).length / w.length >= 0.6;
  }

  /** You talked over them: they stop mid-sentence and listen. */
  private interrupt() {
    if (this.them !== "talking" || !this.with) return;
    this.replySeq++;
    voice.stopSpeaking();
    this.host.actor(this.with)?.say("!", 700, this.theirSide());
    this.them = null;
    this.saying = "";
  }

  /** Did you just talk to one of the neighbors around you? By name, or a hello right beside one. */
  private addressed(phrase: string): VillagerId | null {
    const around = this.host.around(HEAR_PX);
    if (!around.length) return null;
    const said = ` ${words(phrase).join(" ")} `;
    const named = around.find((v) => CALLS[v].some((c) => said.includes(` ${c} `)));
    if (named) return named;
    const beside = this.host.nearest();
    return beside && HELLO.test(phrase.trim()) ? beside : null;
  }

  /**
   * The mic (when it's on) listens only with a neighbor close by, or in a
   * conversation: never out on your own. It keeps listening while they talk,
   * so you can cut in, and waits while you type.
   */
  private syncMic() {
    const near = this.chatting ? !!this.with : this.host.around(HEAR_PX).length > 0;
    const want = isMicOn() && near && !(this.typing && input.value) && !this.host.blocked();
    if (want && !this.open) {
      this.open = listenOpen(
        (phrase) => {
          if (!this.chatting) {
            const v = this.addressed(phrase);
            if (v) this.startVoice(v, phrase);
            return;
          }
          if (!this.with || (this.typing && input.value)) return;
          if (this.them === "talking") {
            if (this.echo(phrase) || words(phrase).length < 2) return;
            this.interrupt();
          }
          // A pause in your sentence isn't the end of it: keep adding until you've been quiet a moment.
          this.hear(phrase);
        },
        (partial) => {
          if (!this.chatting || (this.typing && input.value)) return;
          if (this.them === "talking") {
            if (!partial || this.echo(partial) || words(partial).length < 2) return;
            this.interrupt();
          }
          this.heard = partial;
          if (partial) {
            this.armSend(); // (still talking: push the send back)
            this.showMine(`${this.spoken} ${partial}`.trim(), true);
          }
          this.renderChat(true);
        },
        (problem) => {
          // (the browser said no: turn the mic off and say why, rather than retrying forever)
          setMic(false);
          this.note = problem;
          this.renderChat();
        },
      );
    } else if (!want && this.open) this.stopMic();
  }

  private stopMic() {
    this.open?.stop();
    this.open = null;
    this.heard = "";
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
    if (net.send({ type: "task", villager: v, text })) {
      this.host.actor(v)?.say(". . .", 30_000, this.theirSide());
      this.them = "thinking";
    } else this.host.actor(v)?.say("(the line to the colony is down)", 3000, this.theirSide());
    this.renderChat();
  }

  /** Their answer: a sentence or two at a time over their head, said out loud (talk over them to cut in). */
  reply(v: VillagerId, text: string) {
    const a = this.host.actor(v);
    if (!a) return;
    this.lastAt = Date.now();
    const seq = this.replySeq;
    const parts = pieces(text);
    this.log(v, false, plainText(text));
    this.them = "talking";
    this.saying = `${this.saying} ${text}`;
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
      if (seq !== this.replySeq) return;
      this.them = null;
      this.saying = "";
      this.renderChat();
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
    for (const o of [this.chat.box, this.chat.line, this.chat.hint, this.chat.mic, this.chat.micWord, this.chat.logBg, ...this.chat.log]) o.destroy();
    this.chat = null;
  }

  /** The bar (while the chat is open) and the conversation so far above it (while open, and for a bit after each line). */
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
        hint: pin(ptext(scene, 0, 0, "", 0xb9aed0, "sm"), 1),
        mic: pin(scene.add.image(0, 0, "icon_mic_0").setOrigin(0, 0.5), 2),
        micWord: pin(ptext(scene, 0, 0, "", C.ink, "sm"), 2),
        logBg: pin(scene.add.graphics()),
        log: [],
      };
    if (!this.chat.mic.input) {
      // the mic switch lives right on the bar
      this.chat.mic.setInteractive({ useHandCursor: true }).on("pointerdown", (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        if (!micSupported) return;
        toggleMic();
        sfx.blip();
      });
    }
    const c = this.chat;
    const PAD = 8;
    const barW = Math.min(W - 32, 460);
    const x0 = Math.round((W - barW) / 2);
    const barH = 22;
    const barY = H - TOOLBAR_H - barH - 6;
    const hintH = 14;
    const who = this.with ? VILLAGER_SHORT[this.with] : "";
    const panel = 0x1b1530;

    // the bar (while it fades out it keeps its last look)
    const fading = !this.chatting && !!this.fadeAt;
    if (!fading) c.box.clear();
    for (const o of [c.box, c.line, c.hint, c.mic, c.micWord]) o.setVisible(this.chatting || fading);
    if (this.chatting) {
      this.fadeAt = 0;
      for (const o of [c.box, c.line, c.hint, c.mic, c.micWord, c.logBg]) o.setAlpha(1);
      // (the hints sit on a dark strip that joins the log above)
      c.box.fillStyle(panel, 0.8).fillRect(x0, barY - hintH, barW, hintH);
      woodFrame(c.box, x0, barY, barW, barH, C.paperLight);
      // the mic switch, at the right end of the bar
      const on = isMicOn();
      c.mic.setTexture(on ? "icon_mic_on_0" : "icon_mic_0").setAlpha(micSupported ? 1 : 0.4);
      c.micWord.setText(on ? "MIC ON" : "MIC OFF").setTint(on ? 0x2f8a3a : C.inkSoft);
      const micW = c.mic.width + 3 + measure(c.micWord).w;
      const micX = x0 + barW - PAD - micW;
      c.mic.setPosition(micX, barY + barH / 2);
      c.micWord.setPosition(micX + c.mic.width + 3, barY + Math.round((barH - measure(c.micWord).h) / 2));
      c.box.fillStyle(C.paperDark, 1).fillRect(micX - 6, barY + 4, 1, barH - 8);

      // what's in the bar: your words (typed or heard), or what's going on
      const cursor = Math.floor(performance.now() / 500) % 2 ? "_" : " ";
      const prefix = `to ${who}:  `;
      const typed = this.typing ? input.value : "";
      const status =
        this.them === "thinking" ? `${who} is thinking...` :
        this.them === "talking" ? (on ? `${who} is talking... (talk to cut in)` : `${who} is talking...`) :
        this.typing ? `type here  (${this.placeholder()})` :
        on ? "listening... just talk" : "press ENTER to type";
      const words = typed || `${this.spoken} ${this.heard}`.trim();
      c.line.setTint(words ? C.ink : C.inkSoft);
      const room = micX - 10 - x0 - PAD;
      // keep the end of a long line in view
      let shown = words || status;
      const tail = this.typing ? cursor : "";
      c.line.setText(prefix + shown + tail);
      while (measure(c.line).w > room && shown.length > 1) {
        shown = shown.slice(1);
        c.line.setText(`${prefix}...${shown}${tail}`);
      }
      c.line.setPosition(x0 + PAD, barY + Math.round((barH - measure(c.line).h) / 2));
      // (speech waiting to send: a bar along the bottom fills as the pause runs out)
      if (!typed && this.sendAt) {
        const left = Math.max(0, this.sendAt - Date.now()) / SILENCE_MS;
        const w = Math.round((barW - 4) * (1 - left));
        c.box.fillStyle(0x7cd08a, 1).fillRect(x0 + 2, barY + barH - 3, w, 1);
      }
      const pending = !typed && !!this.sendAt;
      c.hint.setText(
        this.note ||
          (pending
            ? "keep talking, or ENTER to send now  /  ESC leave"
            : this.typing
              ? on
                ? "type + ENTER, or just talk  /  ESC leave  /  click the mic to mute"
                : "type + ENTER to send  /  ESC leave  /  click the mic to talk out loud"
              : "just talk  /  ENTER to type  /  walk off or ESC to leave"),
      );
      c.hint.setTint(this.note ? 0xffb38a : 0xb9aed0);
      c.hint.setPosition(x0 + barW - measure(c.hint).w - PAD, barY - hintH + 4);
    }

    if (barOnly) return;
    // the conversation so far: each speaker's little icon and name in their own column, messages (smaller) wrapped beside them
    for (const t of c.log) t.destroy();
    c.log = [];
    c.logBg.clear();
    const lines = this.with ? (this.history.get(this.with)?.lines ?? []) : [];
    const showLog = lines.length > 0 && (this.chatting || fading);
    if (!showLog) return;
    const bottom = this.chatting ? barY - hintH : barY + barH;
    // (it stops short of your feet: the camera lifts you into the top third while the chat is up)
    const maxH = Math.min(170, bottom - Math.round(H * LIFT_TO) - 20);
    const names = [...new Set(lines.map((l) => (l.you ? "You" : VILLAGER_SHORT[this.with!])))];
    const probe = ptext(scene, 0, 0, "", C.ink, "pxb");
    const ICON = 10;
    const nameW = ICON + Math.max(...names.map((n) => (probe.setText(n), measure(probe).w))) + 8;
    probe.destroy();
    const textW = barW - PAD * 2 - nameW;
    let y = bottom - PAD + 2;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      const color = l.you ? 0xffd98a : 0xffffff;
      const msg = pin(ptext(scene, x0 + PAD + nameW, 0, l.text, l.you ? 0xfff0cf : 0xf0ecf8, "sm"), 1);
      msg.setMaxWidth(textW).setLineSpacing(2);
      const h = measure(msg).h;
      if (bottom - (y - h) > maxH && c.log.length) {
        msg.destroy();
        break;
      }
      y -= h;
      msg.setY(y);
      const icon = pin(scene.add.image(x0 + PAD, y, l.you ? "vicon_you_0" : `vicon_${this.with}_0`).setOrigin(0, 0), 1);
      const name = pin(ptext(scene, x0 + PAD + ICON, y, l.you ? "You" : VILLAGER_SHORT[this.with!], color, "pxb"), 1);
      c.log.push(msg, icon, name);
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

  /** Every frame: keep your bubble over you, end the conversation once you've left and walked off, run the mic. */
  update() {
    this.place();
    // Lift the view while the chat is up (the camera eases there on its own).
    // (and it eases back down as soon as you walk off, while the chat fades)
    const cam = this.host.scene.cameras.main;
    cam.followOffset.y = this.chatting ? -Math.round(cam.height * (0.5 - LIFT_TO)) : 0;
    if (this.chatting) this.renderChat(true); // (the cursor blinks, the send bar fills)
    else if (this.fadeAt && this.chat) {
      // walked off: hold a beat, then fade the bar and the conversation out together
      const a = Math.max(0, 1 - Math.max(0, Date.now() - this.fadeAt - FADE_HOLD) / FADE_MS);
      const c = this.chat;
      for (const o of [c.box, c.line, c.hint, c.mic, c.micWord, c.logBg, ...c.log]) o.setAlpha(a);
      if (a <= 0) {
        this.fadeAt = 0;
        this.renderChat();
      }
    }
    if (this.with) {
      const a = this.host.actor(this.with);
      const p = this.host.player();
      const away = !a || Math.hypot(a.x - p.x, a.y - p.y) > LEAVE_PX;
      // talking hands-free and you walk off: that's goodbye
      if (this.chatting && !this.typing && away) this.leave();
      if (!this.chatting && (away || Date.now() - this.lastAt > STAY_MS)) {
        this.with = null;
        this.replySeq++;
        voice.stopSpeaking();
        this.them = null;
        this.saying = "";
        this.host.release();
      }
    }
    this.syncMic();
  }

  /** Name for the prompt ("[E] talk to Hoot"). */
  static label(v: VillagerId) {
    return `[E] talk to ${VILLAGER_SHORT[v]}`;
  }
}

