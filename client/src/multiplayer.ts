// Friends and visiting (online). Who you are on the island you're connected
// to (its owner, or a friend visiting), who else is walking around on it, the
// friends list (kept by the site, see server/src/social.ts), and flying from
// island to island (a page load: the game connects to the new island).

import type { VillagerId } from "../../shared/game";
import type { Peer, Session, SocialState, VisitPerms } from "../../shared/visit";
import { VISIT_ID } from "./visitparam";

export { VISIT_ID };

export const mp: { session: Session | null; peers: Map<string, Peer> } = { session: null, peers: new Map() };

/** The account behind a player on the island ("<account>~<connection>"). */
export const accountOf = (peerId: string) => peerId.split("~")[0];
/** Another tab of yours (same account): not someone else. */
export const isMe = (peerId: string) => !!mp.session && accountOf(peerId) === accountOf(mp.session.you.id);

/** On a friend's island (not your own). */
export const visiting = () => !!VISIT_ID || mp.session?.role === "visitor";
/** The island's owner's first name (while visiting). */
export const hostName = () => mp.session?.host.name ?? "your friend";
export const perms = (): VisitPerms => mp.session?.perms ?? { agents: [], office: false };
/** Visiting: may you ask this neighbor for real help (with your own accounts)? */
export const mayAsk = (v: VillagerId) => perms().agents.includes(v);

type PeerChange = { kind: "all" } | { kind: "move"; peer: Peer } | { kind: "left"; id: string } | { kind: "chat"; id: string; name: string; text: string };
const peerFns = new Set<(c: PeerChange) => void>();
const sessionFns = new Set<() => void>();
const socialFns = new Set<(text?: string) => void>();

export function onPeers(fn: (c: PeerChange) => void) {
  peerFns.add(fn);
  return () => peerFns.delete(fn);
}
export function onSession(fn: () => void) {
  sessionFns.add(fn);
  return () => sessionFns.delete(fn);
}
/** Your friends list changed (a request, an accept): the FRIENDS panel refreshes. */
export function onSocial(fn: (text?: string) => void) {
  socialFns.add(fn);
  return () => socialFns.delete(fn);
}

// ---------------------------------------------------------------- from the island (net.ts)

export function gotSession(s: Session) {
  mp.session = s;
  sessionFns.forEach((fn) => fn());
}
export function gotPeers(list: Peer[]) {
  mp.peers = new Map(list.map((p) => [p.id, p]));
  peerFns.forEach((fn) => fn({ kind: "all" }));
}
export function gotPeer(p: Peer) {
  mp.peers.set(p.id, p);
  peerFns.forEach((fn) => fn({ kind: "move", peer: p }));
}
export function peerLeft(id: string) {
  mp.peers.delete(id);
  peerFns.forEach((fn) => fn({ kind: "left", id }));
}
export function peerChat(id: string, name: string, text: string) {
  peerFns.forEach((fn) => fn({ kind: "chat", id, name, text }));
}
export function socialChanged(text?: string) {
  socialFns.forEach((fn) => fn(text));
}

// ---------------------------------------------------------------- the friends list (the site)

export async function loadSocial(): Promise<SocialState> {
  const r = await fetch("/social", { cache: "no-store" });
  const out = await r.json();
  if (!r.ok) throw new Error(out.error ?? "Couldn't load your friends.");
  return out as SocialState;
}

/** A change to your friends list; resolves with the new list (and a line to show, if any). */
export async function social(path: "add" | "answer" | "remove" | "block" | "unblock" | "perms" | "closed", body: object): Promise<SocialState & { text?: string }> {
  const r = await fetch(`/social/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({ error: "That didn't work. Try again?" }));
  if (!r.ok) throw new Error(out.error ?? "That didn't work. Try again?");
  return out;
}

// ---------------------------------------------------------------- flying

let flying = false;
/** Fly to a friend's island (or home, with null). The rocket's lift-off plays first (see GameScene). */
export function flyTo(id: string | null) {
  if (flying) return;
  flying = true;
  location.href = id ? `/?visit=${encodeURIComponent(id)}` : "/?land";
}

// ---------------------------------------------------------------- sent home

const kickedFns = new Set<(text: string) => void>();
/** The owner sent you home (or closed their island, or you're no longer friends). */
export function onKicked(fn: (text: string) => void) {
  kickedFns.add(fn);
  return () => kickedFns.delete(fn);
}
export function gotKicked(text: string) {
  kickedFns.forEach((fn) => fn(text));
  // (whatever's showing it, you're home in a moment)
  setTimeout(() => backHome(text), 2600);
}

/** Back to your own island, with a line to show when you land. */
export function backHome(note: string) {
  try {
    sessionStorage.setItem("moon-note", note);
  } catch {
    /* no note, then */
  }
  flyTo(null);
}

/** The line left for you on the way home (shown once). */
export function takeNote(): string | null {
  try {
    const n = sessionStorage.getItem("moon-note");
    sessionStorage.removeItem("moon-note");
    return n;
  } catch {
    return null;
  }
}
