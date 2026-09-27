// Friends, for the hosted game (the gateway keeps this; each island is its
// own server and can't see anyone else's). Who's friends with whom, pending
// requests, blocks, whether an island is closed to visitors, and what each
// owner lets each friend do there.

import { randomInt } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { VillagerId } from "../../shared/game.js";
import { CODE_CHARS, NO_PERMS, type VisitPerms } from "../../shared/visit.js";

const VILLAGERS: VillagerId[] = ["jade_rabbit", "postmaster", "timekeeper", "scholar", "stargazer", "manager", "dj", "mechanic"];

interface Ties {
  /** Their friend code, like MOON-7F3K. */
  code: string;
  friends: string[];
  /** Requests waiting on them (who asked). */
  incoming: string[];
  blocked: string[];
  /** No visitors right now, friends included. */
  closed: boolean;
  /** What each friend may do on their island. */
  perms: Record<string, VisitPerms>;
}

export class Social {
  private data: Record<string, Ties>;
  /** Friend code → whose it is. */
  private codes = new Map<string, string>();

  constructor(private file: string) {
    try {
      this.data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    } catch (err) {
      // (a damaged file doesn't keep the site down: it's set aside, and friends start over)
      const aside = `${file}.corrupt-${Date.now()}`;
      console.error(`[social] couldn't read ${file} (moved it to ${aside}):`, err);
      renameSync(file, aside);
      this.data = {};
    }
    for (const [id, t] of Object.entries(this.data)) this.codes.set(t.code, id);
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** A player's ties (made, with a fresh friend code, the first time they're asked about). */
  of(id: string): Ties {
    let t = Object.hasOwn(this.data, id) ? this.data[id] : undefined;
    if (!t) {
      t = { code: this.newCode(), friends: [], incoming: [], blocked: [], closed: false, perms: {} };
      this.data[id] = t;
      this.codes.set(t.code, id);
      this.save();
    }
    return t;
  }

  private newCode(): string {
    for (;;) {
      let s = "";
      for (let i = 0; i < 4; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
      const code = `MOON-${s}`;
      if (!this.codes.has(code)) return code;
    }
  }

  /** Whose code this is ("moon-7f3k", "7F3K" and "MOON 7F3K" all work). */
  byCode(raw: string): string | null {
    const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^MOON/, "");
    if (s.length !== 4) return null;
    return this.codes.get(`MOON-${s}`) ?? null;
  }

  areFriends(a: string, b: string) {
    return this.of(a).friends.includes(b);
  }

  /** Requests this player has sent that are still waiting. */
  outgoing(id: string): string[] {
    return Object.entries(this.data)
      .filter(([, t]) => t.incoming.includes(id))
      .map(([other]) => other);
  }

  /**
   * Ask to be friends. If they'd already asked you, that's a yes. (If they've
   * blocked you it quietly goes nowhere: it still looks sent.)
   */
  request(from: string, to: string): "sent" | "friends" | "already" {
    const me = this.of(from);
    const them = this.of(to);
    if (me.friends.includes(to)) return "already";
    if (me.incoming.includes(to)) {
      this.befriend(from, to);
      return "friends";
    }
    if (them.blocked.includes(from) || them.incoming.includes(from)) return "sent";
    // (asking someone you'd blocked unblocks them)
    me.blocked = me.blocked.filter((x) => x !== to);
    them.incoming.push(from);
    this.save();
    return "sent";
  }

  private befriend(a: string, b: string) {
    const ta = this.of(a);
    const tb = this.of(b);
    ta.incoming = ta.incoming.filter((x) => x !== b);
    tb.incoming = tb.incoming.filter((x) => x !== a);
    if (!ta.friends.includes(b)) ta.friends.push(b);
    if (!tb.friends.includes(a)) tb.friends.push(a);
    ta.perms[b] ??= { ...NO_PERMS, agents: [] };
    tb.perms[a] ??= { ...NO_PERMS, agents: [] };
    this.save();
  }

  /** Accept or decline a request. True if it became a friendship. */
  answer(me: string, from: string, accept: boolean): boolean {
    const t = this.of(me);
    if (!t.incoming.includes(from)) return false;
    if (accept) {
      this.befriend(me, from);
      return true;
    }
    t.incoming = t.incoming.filter((x) => x !== from);
    this.save();
    return false;
  }

  /** Unfriend (both ways), and every permission either gave the other goes with it. */
  remove(a: string, b: string) {
    const ta = this.of(a);
    const tb = this.of(b);
    ta.friends = ta.friends.filter((x) => x !== b);
    tb.friends = tb.friends.filter((x) => x !== a);
    delete ta.perms[b];
    delete tb.perms[a];
    // (and any request either way)
    ta.incoming = ta.incoming.filter((x) => x !== b);
    tb.incoming = tb.incoming.filter((x) => x !== a);
    this.save();
  }

  /** Block: no longer friends, and they can't visit or ask again. */
  block(me: string, them: string) {
    this.remove(me, them);
    const t = this.of(me);
    if (!t.blocked.includes(them)) t.blocked.push(them);
    this.save();
  }

  unblock(me: string, them: string) {
    const t = this.of(me);
    t.blocked = t.blocked.filter((x) => x !== them);
    this.save();
  }

  setPerms(owner: string, friend: string, perms: { agents?: unknown; office?: unknown }): VisitPerms | null {
    const t = this.of(owner);
    if (!t.friends.includes(friend)) return null;
    const agents = Array.isArray(perms.agents) ? VILLAGERS.filter((v) => (perms.agents as unknown[]).includes(v)) : [];
    t.perms[friend] = { agents, office: perms.office === true };
    this.save();
    return t.perms[friend];
  }

  permsFor(owner: string, visitor: string): VisitPerms {
    return this.of(owner).perms[visitor] ?? NO_PERMS;
  }

  setClosed(id: string, closed: boolean) {
    this.of(id).closed = closed;
    this.save();
  }

  /** Why this visitor can't come over right now (or null: come on in). */
  visitProblem(visitor: string, host: string): string | null {
    if (visitor === host) return null;
    const h = this.of(host);
    if (!h.friends.includes(visitor) || h.blocked.includes(visitor)) return "You can only visit friends' islands.";
    if (h.closed) return "That island is closed to visitors right now.";
    return null;
  }

  /** An account is deleted: it disappears from everyone's lists. */
  forget(id: string) {
    if (Object.hasOwn(this.data, id)) this.codes.delete(this.data[id].code);
    delete this.data[id];
    for (const t of Object.values(this.data)) {
      t.friends = t.friends.filter((x) => x !== id);
      t.incoming = t.incoming.filter((x) => x !== id);
      t.blocked = t.blocked.filter((x) => x !== id);
      delete t.perms[id];
    }
    this.save();
  }
}
