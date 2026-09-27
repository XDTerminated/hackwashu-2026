// Visiting friends' islands (online only). Each island is its own server;
// a visitor's game connects to their friend's island instead of their own.
// The gateway says who's who (friends, permissions); the island keeps track
// of who's walking around on it right now.

import type { Materials, VillagerId } from "./game.js";

/** What a friend may do on your island beyond walking, chatting, helping and gifts. */
export interface VisitPerms {
  /** The neighbors they may ask for real help (with their OWN accounts, read-only). */
  agents: VillagerId[];
  /** They may look inside your Office (your Claude Code sessions), never prompt it. */
  office: boolean;
}

export const NO_PERMS: VisitPerms = { agents: [], office: false };

/** Someone on the island right now (the owner, or a visitor). */
export interface Peer {
  id: string;
  name: string;
  owner: boolean;
  x: number;
  y: number;
  facing: "down" | "up" | "side";
  flip: boolean;
  moving: boolean;
  /** Their suit's color. */
  tint: number;
}

/** A visit, for the owner's visitor log. */
export interface VisitEntry {
  id: string;
  name: string;
  at: number;
  /** Neighbors they asked for help. */
  agents: VillagerId[];
  /** Things they gathered for you. */
  gathered: number;
  /** What they left you. */
  gifts: string[];
}

/** Who you are on the island you're connected to. */
export interface Session {
  role: "owner" | "visitor";
  you: { id: string; name: string; tint: number };
  host: { id: string; name: string };
  /** A visitor's permissions here. */
  perms: VisitPerms;
  /** A visitor's own coins and materials (back home). */
  wallet?: { coins: number; materials: Materials };
  /** The owner's visitor log (newest first). */
  log?: VisitEntry[];
}

/** Friend codes: easy to read out loud (no 0/O, 1/I/L). */
export const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Suit colors, picked from the player's id. */
export const SUIT_TINTS = [0xffffff, 0xffd9a8, 0xc8e6ff, 0xd8f5c8, 0xf7c8e0, 0xe0d0ff, 0xfff2a8, 0xffc8c0];
export function suitTint(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SUIT_TINTS[h % SUIT_TINTS.length];
}

/** Longest chat line between players. */
export const CHAT_MAX = 140;

/** What the friends list (the phone's FRIENDS tab) shows. */
export interface SocialState {
  code: string;
  closed: boolean;
  friends: { id: string; name: string; email: string; online: boolean; perms: VisitPerms; theirs: VisitPerms }[];
  incoming: { id: string; name: string; email: string }[];
  outgoing: { id: string; name: string; email: string }[];
  blocked: { id: string; name: string; email: string }[];
}
