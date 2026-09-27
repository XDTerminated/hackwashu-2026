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

export class PhoneLine {
  private app: SpectrumApp | null = null;
  /** Testing on your own computer without texting anyone: sends are only logged. */
  private dryRun = false;
  private spaces = new Map<string, Space>();
  /** phone → the account it belongs to (saved). */
  private owners: Record<string, string>;
  /** The colony number Photon assigned each phone (saved alongside, for the MoonPad). */
  private lines: Record<string, string>;
  /** Codes waiting to be texted in, by phone. */
  private pending = new Map<string, { player: string; code: string; expires: number; tries: number; line?: string }>();

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

  /** The colony number that phone texts. */
  lineOf(phone: string): string | undefined {
    return this.lines[phone];
  }

  /** A village wants its player's phone linked: register it with Photon and hand back a code to text in. */
  async startLink(player: string, input: string): Promise<LinkResult> {
    if (!this.ready) return { ok: false, text: "Texting isn't set up on this site." };
    const phone = normalizePhone(input);
    if (!phone) return { ok: false, text: "That doesn't look like a phone number. Try +1 314 555 0123." };
    if (this.owners[phone] === player) return { ok: false, text: `${mask(phone)} is already linked.` };
    try {
      const user = this.dryRun ? { id: "dry-run", assignedPhoneNumber: "+15550100000" } : await registerSharedUser(phone);
      const was = this.pending.get(phone);
      const keep = was && was.player === player && Date.now() < was.expires;
      const code = keep ? was.code : String(randomInt(1000, 10000));
      this.pending.set(phone, { player, code, expires: Date.now() + LINK_MS, tries: keep ? was.tries : 0, line: user.assignedPhoneNumber });
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
    if (!phone || this.owners[phone] !== player) return;
    delete this.owners[phone];
    delete this.lines[phone];
    this.spaces.delete(phone);
    this.save();
    console.log(`[phone] ${mask(phone)} unlinked`);
  }

  /** A village texting its own player. Anything else (a phone that isn't theirs) is refused. */
  async send(player: string, input: string, text: string): Promise<boolean> {
    const phone = normalizePhone(input);
    if (!phone || this.owners[phone] !== player) return false;
    return this.say(phone, text.slice(0, MAX_TEXT));
  }

  /** Accounts that are gone take their phone with them. */
  forget(player: string) {
    for (const [phone, owner] of Object.entries(this.owners)) if (owner === player) this.unlink(player, phone);
    for (const [phone, p] of this.pending) if (p.player === player) this.pending.delete(phone);
  }

  /** A text arriving on the line from `sender` (also the dry run's way in, for testing). */
  async receive(sender: string, raw: string): Promise<void> {
    const text = raw.slice(0, MAX_TEXT);
    if (!text.trim()) return;
    const p = this.pending.get(sender);
    if (p && Date.now() > p.expires) this.pending.delete(sender);
    else if (p && new RegExp(`(^|\\D)${p.code}(\\D|$)`).test(text)) {
      // The right code from this phone: it's theirs now (one phone per account, one account per phone).
      this.pending.delete(sender);
      const before = this.owners[sender];
      if (before && before !== p.player) this.moved(before, sender);
      const old = this.phoneOf(p.player);
      if (old && old !== sender) this.unlink(p.player, old);
      this.owners[sender] = p.player;
      if (p.line) this.lines[sender] = p.line;
      this.save();
      console.log(`[phone] ${mask(sender)} linked`);
      return this.hand(p.player, { phone: sender, text, linked: { line: p.line } });
    }
    const owner = this.owners[sender];
    if (owner) return this.hand(owner, { phone: sender, text });
    if (p && Date.now() <= p.expires) {
      const out = ++p.tries >= MAX_LINK_TRIES;
      if (out) this.pending.delete(sender);
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
      const sender = message.sender?.id ?? space.id;
      this.spaces.set(sender, space);
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
