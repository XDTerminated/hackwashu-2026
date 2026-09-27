// The hosted site's one iMessage line (Photon Spectrum), shared by every
// signed-in player. Each account links one phone, and each phone belongs to
// one account, so a text is routed by who sent it: to that player's village,
// which is woken up if it's asleep. Villages never touch Photon themselves;
// they ask the gateway to link, unlink and send, and only ever to their own phone.
//
// Linking works like the single-player game: the village asks for a code, the
// player texts it from that phone (on Photon's shared pool the line can't text
// anyone who hasn't texted it first). Texting the right code is what proves
// the phone is theirs, so a number that texts in another account's code moves
// to that account.

import { randomInt } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Spectrum } from "spectrum-ts";
import { registerSharedUser, textUsLink } from "./connectors/photonUsers.js";
import { mask, normalizePhone, type LinkResult } from "./phones.js";

type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;
type Space = Parameters<SpectrumApp["send"]>[0];
type Inbound = SpectrumApp["messages"] extends AsyncIterable<infer T> ? T : never;

/** What a village is handed: a text from its player's phone (`linked`: that text just linked it). */
export interface Delivery {
  phone: string;
  text: string;
  linked?: { line?: string };
}

const MAX_TEXT = 2000;
const MAX_LINK_TRIES = 5;
const LINK_MS = 30 * 60_000;
/** A code with less than this left is swapped for a fresh one (so a re-press isn't about to lapse). */
const LINK_MIN_LEFT = 5 * 60_000;
/** New numbers one account may start linking per hour (each takes a slot in Photon's shared pool). */
const MAX_LINK_STARTS = 5;
/** Texts one account's village may send in ten minutes (every text costs the site). */
const MAX_SENDS = 30;
const SEND_WINDOW_MS = 10 * 60_000;
/**
 * A text that links is the code and nothing else ("4821", "Moon code 4821"):
 * a linked phone's everyday texts ("YES 4821", "Nova: what happened in 1969")
 * must never move it to whoever else has a code waiting on that number.
 */
const LINK_TEXT = /^\s*(?:moon\s+(?:village\s+)?code\s*[:#-]?\s*)?#?(\d{4})\s*[.!]*\s*$/i;

interface PendingLink {
  phone: string;
  code: string;
  expires: number;
  tries: number;
  line?: string;
  userId?: string;
}

export class PhoneLine {
  private app: SpectrumApp | null = null;
  /** Testing on your own computer without texting anyone: sends are only logged. */
  private dryRun = false;
  private spaces = new Map<string, Space>();
  /** phone → the account it belongs to (saved). */
  private owners: Record<string, string>;
  /** The colony number Photon assigned each phone (saved alongside, for the MoonPad). */
  private lines: Record<string, string>;
  /**
   * Codes waiting to be texted in, by account (one each: a new LINK replaces it).
   * Keyed by who asked, not by phone, so nobody can knock out another player's
   * code by asking to link the same number.
   */
  private pending = new Map<string, PendingLink>();
  /** When each account last started linking a new number (for MAX_LINK_STARTS). */
  private starts = new Map<string, number[]>();
  /** Each account's texts sent in the current window (for MAX_SENDS). */
  private sends = new Map<string, { since: number; n: number }>();

  constructor(
    private file: string,
    /** Hand a text to that player's village (waking it). Resolves once the village has dealt with it. */
    private deliver: (player: string, d: Delivery) => Promise<void>,
    /** The village of a phone that just moved to another account forgets it. */
    private moved: (player: string, phone: string) => void,
  ) {
    const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { owners?: Record<string, string>; lines?: Record<string, string> }) : {};
    this.owners = saved.owners ?? {};
    this.lines = saved.lines ?? {};
  }

  /** Connect to Photon (or, with `dryRun`, pretend to). False when there are no credentials. */
  async start(dryRun = false): Promise<boolean> {
    const projectId = process.env.SPECTRUM_PROJECT_ID ?? process.env.PHOTON_PROJECT_ID;
    const projectSecret = process.env.SPECTRUM_PROJECT_SECRET ?? process.env.PHOTON_PROJECT_SECRET;
    if (!projectId || !projectSecret) {
      this.dryRun = dryRun;
      if (dryRun) console.log("[phone] dry run: texts are logged here, nothing is sent");
      return dryRun;
    }
    const [{ Spectrum }, { imessage }] = await Promise.all([import("spectrum-ts"), import("spectrum-ts/providers")]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.app = await Spectrum({ projectId, projectSecret, providers: [imessage.config()] as any });
    console.log(`[phone] iMessage line up (${Object.keys(this.owners).length} phone(s) linked)`);
    void this.listen();
    return true;
  }

  get ready() {
    return this.app !== null || this.dryRun;
  }

  /** The phone linked to an account, if any. */
  phoneOf(player: string) {
    return Object.keys(this.owners).find((p) => this.owners[p] === player);
  }

  /** The account a phone belongs to (only real entries: never "constructor" and friends). */
  private ownerOf(phone: string): string | undefined {
    return Object.hasOwn(this.owners, phone) ? this.owners[phone] : undefined;
  }

  /** Codes still waiting on this phone (dropping any that lapsed). */
  private waitingOn(phone: string): [string, PendingLink][] {
    const now = Date.now();
    const out: [string, PendingLink][] = [];
    for (const [player, p] of this.pending) {
      if (now > p.expires) this.pending.delete(player);
      else if (p.phone === phone) out.push([player, p]);
    }
    return out;
  }

  /** The colony number that phone texts. */
  lineOf(phone: string): string | undefined {
    return this.lines[phone];
  }

  /** A village wants its player's phone linked: register it with Photon and hand back a code to text in. */
  async startLink(player: string, input: string): Promise<LinkResult> {
    if (!this.ready) return { ok: false, text: "Texting isn't set up on this site." };
    const phone = normalizePhone(input);
    if (!phone) return { ok: false, text: "That doesn't look like a phone number. Try +1 314 555 0123." };
    if (this.ownerOf(phone) === player) return { ok: false, text: `${mask(phone)} is already linked.` };
    const now = Date.now();
    const was = this.pending.get(player);
    // (the same number pressed again: the same code, unless it's about to lapse)
    const keep = was && was.phone === phone && was.expires - now > LINK_MIN_LEFT ? was : undefined;
    if (!keep) {
      const recent = (this.starts.get(player) ?? []).filter((t) => now - t < 60 * 60_000);
      if (recent.length >= MAX_LINK_STARTS) return { ok: false, text: "That's a lot of numbers for one hour. Try again later." };
      recent.push(now);
      this.starts.set(player, recent);
    }
    try {
      const user = keep?.userId && keep.line ? { id: keep.userId, assignedPhoneNumber: keep.line } : this.dryRun ? { id: "dry-run", assignedPhoneNumber: "+15550100000" } : await registerSharedUser(phone);
      // (never the same code as another account's waiting on this number)
      const taken = new Set(this.waitingOn(phone).map(([, p]) => p.code));
      let code = keep?.code ?? "";
      while (!code || (!keep && taken.has(code))) code = String(randomInt(1000, 10000));
      this.pending.set(player, keep ?? { phone, code, expires: now + LINK_MS, tries: 0, line: user.assignedPhoneNumber, userId: user.id });
      console.log(`[phone] waiting for ${mask(phone)} to text their code`);
      return {
        ok: true,
        text: `From ${mask(phone)}, text ${code} to ${user.assignedPhoneNumber} - or scan the code with that phone.`,
        line: user.assignedPhoneNumber,
        code,
        link: this.dryRun ? undefined : `${textUsLink(user.id)}?msg=${encodeURIComponent(`Moon code ${code}`)}`,
      };
    } catch (err) {
      console.error("[phone] couldn't start linking:", err instanceof Error ? err.message : err);
      return { ok: false, text: err instanceof Error ? err.message : "Photon couldn't register that number." };
    }
  }

  /** A village unlinked its phone (only its own). */
  unlink(player: string, input: string) {
    const phone = normalizePhone(input);
    if (!phone || this.ownerOf(phone) !== player) return;
    delete this.owners[phone];
    delete this.lines[phone];
    this.spaces.delete(phone);
    this.save();
    console.log(`[phone] ${mask(phone)} unlinked`);
  }

  /** A village texting its own player. Anything else (a phone that isn't theirs) is refused. */
  async send(player: string, input: string, text: string): Promise<boolean> {
    const phone = normalizePhone(input);
    if (!phone || this.ownerOf(phone) !== player || !text.trim()) return false;
    // (a village stuck in a loop mustn't run up the site's bill or flood its player)
    const now = Date.now();
    let s = this.sends.get(player);
    if (!s || now - s.since > SEND_WINDOW_MS) this.sends.set(player, (s = { since: now, n: 0 }));
    if (++s.n > MAX_SENDS) {
      if (s.n === MAX_SENDS + 1) console.error(`[phone] ${mask(phone)}'s village is texting too much; holding its texts for a few minutes`);
      return false;
    }
    return this.say(phone, text.slice(0, MAX_TEXT));
  }

  /** Accounts that are gone take their phone with them. */
  forget(player: string) {
    for (const [phone, owner] of Object.entries(this.owners)) if (owner === player) this.unlink(player, phone);
    this.pending.delete(player);
    this.starts.delete(player);
    this.sends.delete(player);
  }

  /** A text arriving on the line from `sender` (also the dry run's way in, for testing). */
  async receive(sender: string, raw: string): Promise<void> {
    const text = raw.slice(0, MAX_TEXT);
    if (!text.trim()) return;
    const waiting = this.waitingOn(sender);
    const typed = LINK_TEXT.exec(text)?.[1];
    const hit = typed ? waiting.find(([, p]) => p.code === typed) : undefined;
    if (hit) {
      // The right code from this phone: it's theirs now (one phone per account, one account per phone).
      const [player, p] = hit;
      this.pending.delete(player);
      const before = this.ownerOf(sender);
      if (before && before !== player) this.moved(before, sender);
      const old = this.phoneOf(player);
      if (old && old !== sender) this.unlink(player, old);
      this.owners[sender] = player;
      if (p.line) this.lines[sender] = p.line;
      else delete this.lines[sender];
      this.save();
      console.log(`[phone] ${mask(sender)} linked`);
      return this.hand(player, { phone: sender, text, linked: { line: p.line } });
    }
    const owner = this.ownerOf(sender);
    if (owner) return this.hand(owner, { phone: sender, text });
    if (waiting.length) {
      let out = false;
      for (const [player, p] of waiting) {
        if (++p.tries < MAX_LINK_TRIES) continue;
        this.pending.delete(player);
        out = true;
      }
      await this.say(sender, out ? "🌙 That code didn't match. Press LINK on the MoonPad again for a new one." : "🌙 That code didn't match. Text the code shown on the MoonPad.");
      return;
    }
    console.log(`[phone] ignoring a text from unlinked ${mask(sender)}`);
  }

  private async hand(player: string, d: Delivery) {
    try {
      await this.deliver(player, d);
    } catch (err) {
      console.error(`[phone] couldn't reach ${mask(d.phone)}'s village:`, err instanceof Error ? err.message : err);
      // (a village that took its time answering still got the text, and its answer comes on its own)
      if (err instanceof Error && err.name === "TimeoutError") return;
      await this.say(d.phone, "🌙 The colony's having trouble waking up. Try again in a minute, or open the game.");
    }
  }

  private async say(phone: string, text: string): Promise<boolean> {
    if (this.dryRun) {
      console.log(`[phone] (dry run) → ${mask(phone)}: ${text.replace(/\n/g, " / ")}`);
      return true;
    }
    if (!this.app) return false;
    try {
      let space = this.spaces.get(phone);
      if (!space) {
        const { imessage } = await import("spectrum-ts/providers");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        space = (await (imessage as any)(this.app).space.create(phone)) as Space;
        this.spaces.set(phone, space);
      }
      await this.app.send(space, text);
      return true;
    } catch (err) {
      console.error(`[phone] send to ${mask(phone)} failed:`, err);
      return false;
    }
  }

  /** The inbound loop. If Photon's stream ever dies, log it and listen again (backing off). */
  private async listen() {
    for (let delay = 1_000; ; delay = Math.min(delay * 2, 5 * 60_000)) {
      const started = Date.now();
      try {
        // (not awaited: one player's slow villager mustn't hold up anyone else's text)
        for await (const [space, message] of this.app!.messages) void this.inbound(space, message);
        console.error("[phone] inbound stream ended");
      } catch (err) {
        console.error("[phone] inbound stream died:", err);
      }
      if (Date.now() - started > 10 * 60_000) delay = 1_000;
      console.log(`[phone] listening again in ${Math.round(delay / 1000)}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  private async inbound(space: Space, message: Inbound[1]) {
    try {
      const content = message.content as { type: string; text?: string; markdown?: string };
      const raw = content.type === "text" ? content.text : content.type === "markdown" ? content.markdown : undefined;
      if (!raw?.trim()) return;
      // 1:1 chats only: in a group, the villagers' answers (inbox and all) would go to everyone in it.
      if ((space as { type?: string }).type === "group") return;
      const sender = normalizePhone(String(message.sender?.id ?? space.id ?? ""));
      if (!sender) return;
      // (only phones we talk to keep a chat open: anyone can text the line)
      if (this.ownerOf(sender) || this.waitingOn(sender).length) this.spaces.set(sender, space);
      await this.receive(sender, raw);
    } catch (err) {
      console.error("[phone] inbound error:", err);
    }
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ owners: this.owners, lines: this.lines }, null, 1), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
