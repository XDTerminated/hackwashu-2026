// WebSocket link to the agent server. The game still runs (walk, decorate)
// when the server is down; villagers just can't take tasks.

import type { ClientMessage, SeqEvent, ServerMessage } from "../../shared/game";

export type PhoneLinkMsg = Extract<ServerMessage, { type: "phone_link" }>;
import { applyEvent, applySnapshot, setAgents, setConnected, store } from "./store";
import { backHome, gotKicked, gotPeer, gotPeers, gotSession, peerChat, peerLeft, socialChanged } from "./multiplayer";
import { VISIT_ID } from "./visitparam";

// ?server=8797 points a test copy of the game at a test server (npm run dev only).
const TEST_PORT = import.meta.env.DEV ? new URLSearchParams(location.search).get("server") : null;
/**
 * The hosted game (built, and served by the gateway once you've signed in):
 * everything goes to the site itself, which passes it to your own copy of
 * the colony server. On your computer (npm run dev) it's the server on :8787.
 */
export const HOSTED = !import.meta.env.DEV;
const PORT = TEST_PORT ?? "8787";
const SECURE = location.protocol === "https:";
// (online, ?visit=<id> connects to a friend's island instead of your own)
const URL = HOSTED ? `${SECURE ? "wss" : "ws"}://${location.host}/ws${VISIT_ID ? `?visit=${encodeURIComponent(VISIT_ID)}` : ""}` : `${SECURE ? "wss" : "ws"}://${location.hostname || "localhost"}:${PORT}`;
/** The colony server's http address (connect pages, voices). */
export const SERVER_HTTP = HOSTED ? location.origin : `${SECURE ? "https" : "http"}://${location.hostname || "localhost"}:${PORT}`;
const eventListeners = new Set<(e: SeqEvent) => void>();
const noticeListeners = new Set<(text: string, tone?: "ok") => void>();
const snapshotListeners = new Set<() => void>();
const phoneLinkListeners = new Set<(msg: PhoneLinkMsg) => void>();
let ws: WebSocket | null = null;
/** Visiting: connections that never got in (not friends any more, the island's closed). */
let refused = 0;
let kicked = false;

// ---------------------------------------------------------------- signing in (online)

/** Online, everyone signs in first (on the title screen). On your computer there are no accounts: "local". */
export const auth = { state: (HOSTED ? "checking" : "local") as "local" | "checking" | "in" | "out", name: "", email: "", note: "", devLogin: false, guest: false };
const authListeners = new Set<() => void>();

export function onAuth(fn: () => void) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

/** Why the last sign-in didn't finish (the site sends you back with ?signin=...). */
const SIGNIN_NOTES: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long. Try again?",
  failed: "Sign-in didn't work. Try again?",
  unconfigured: "Sign-in isn't set up on this server yet.",
  signedout: "Signed out. See you soon!",
  ended: "You were signed out. Sign in to get back to your village.",
  deleted: "Your village and account are deleted.",
  busy: "Lots of guests right now. Try again in a few minutes, or sign in.",
  switched: "You signed in as someone else in another tab, so this tab switched too.",
};

/**
 * Online, who you are is kept by the browser, not the tab: signing in as someone
 * else in another tab switches every tab. Catch that (coming back to this tab, or
 * reconnecting) and start over as whoever it is now, instead of carrying on as the
 * old player on the new account.
 */
async function stillMe(): Promise<boolean> {
  try {
    const me = (await (await fetch("/auth/me", { cache: "no-store" })).json()) as { signedIn?: boolean; email?: string; guest?: boolean };
    if (me.signedIn === false) {
      location.href = "/?signin=ended";
      return false;
    }
    if (auth.state === "in" && ((me.email ?? "") !== auth.email || !!me.guest !== auth.guest)) {
      location.href = "/?signin=switched";
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

/** Connect to the colony: right away on your computer; online, once we know you're signed in. */
export function start() {
  if (!HOSTED) return connect();
  const q = new URLSearchParams(location.search);
  const why = q.get("signin");
  if (why) {
    auth.note = SIGNIN_NOTES[why] ?? SIGNIN_NOTES.failed;
    q.delete("signin");
    history.replaceState(null, "", `${location.pathname}${q.size ? `?${q}` : ""}`);
  }
  fetch("/auth/me", { cache: "no-store" })
    .then((r) => r.json() as Promise<{ signedIn?: boolean; name?: string; email?: string; devLogin?: boolean; guest?: boolean }>)
    .then((me) => {
      auth.devLogin = !!me.devLogin;
      if (me.signedIn) {
        auth.state = "in";
        auth.guest = !!me.guest;
        auth.name = me.name ?? "";
        auth.email = me.email ?? "";
        connect();
        // (back to this tab: still the same player?)
        addEventListener("focus", () => void stillMe());
        document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void stillMe());
      } else auth.state = "out";
    })
    .catch(() => {
      auth.state = "out";
      auth.note ||= "Can't reach the Moon right now. Refresh to try again.";
    })
    .finally(() => authListeners.forEach((fn) => fn()));
}

export const signIn = () => void (location.href = "/auth/google");
/** Online: a village of your own that's never saved. */
export const playAsGuest = () => void (location.href = "/auth/guest");

// On your own computer, playing as a guest puts your real save aside (the server keeps a
// fresh colony in memory only). If the server restarts mid-game, ask for that again.
let wantGuest = false;
export function localGuest(on: boolean) {
  wantGuest = on;
  send({ type: "guest_mode", on });
}
/** Sign out (a POST, so another site can't sign you out), then back to the title. */
export function signOut() {
  forgetThisBrowser();
  void fetch("/auth/logout", { method: "POST", credentials: "same-origin" })
    .catch(() => {})
    .finally(() => void (location.href = "/?signin=signedout"));
}

/** Forget this browser's "seen it" flags and MoonPad history (sound settings stay): signing out, deleting. */
export function forgetThisBrowser() {
  try {
    const keep = new Set(["moon-music-off-v2", "moon-mic-v2"]);
    for (const k of Object.keys(localStorage)) if ((k.startsWith("moon-") || k.startsWith("moonpad")) && !k.endsWith("-muted") && !keep.has(k)) localStorage.removeItem(k);
  } catch {
    /* nothing stored */
  }
}

/**
 * Whose game this is, for keeping this browser's flags and MoonPad history apart per
 * account: a short hash of the signed-in email online, "guest" for a guest, "local" on your computer.
 */
export function accountTag(): string {
  const guest = HOSTED ? auth.guest || store.guest : store.guest;
  if (guest) return "guest";
  if (!HOSTED) return "local";
  const email = auth.email || store.account?.email || "";
  if (!email) return "out";
  let h = 0x811c9dc5;
  for (let i = 0; i < email.length; i++) h = Math.imul(h ^ email.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** A localStorage key of this account's own. */
export const accountKey = (key: string) => `${key}:${accountTag()}`;

// ---------------------------------------------------------------- the server's clock

/** Server time minus this computer's (from the last snapshot), so meteor landings line up. */
let clockOffset = 0;
/** Now, on the server's clock. */
export const serverNow = () => Date.now() + clockOffset;

// ---------------------------------------------------------------- switching worlds

/** What world the snapshots are from (account, guest, dev mode): a change means a different colony. */
let worldSig: string | null = null;
const worldListeners = new Set<() => void>();
/** A snapshot from a different world (guest, dev mode or another account): old conversations don't belong. */
export function onWorldChange(fn: () => void) {
  worldListeners.add(fn);
  return () => worldListeners.delete(fn);
}

export function connect() {
  try {
    ws = new WebSocket(URL);
  } catch {
    setTimeout(connect, 3000);
    return;
  }
  ws.onopen = () => {
    refused = 0;
    setConnected(true);
    send({ type: "hello" });
    if (wantGuest && !HOSTED) send({ type: "guest_mode", on: true });
  };
  ws.onmessage = (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === "snapshot") {
      // (the server's clock, for anything timed on it: meteors landing)
      clockOffset = (msg.snapshot.serverNow ?? Date.now()) - Date.now();
      applySnapshot(msg.snapshot);
      const sig = `${accountTag()}|${store.guest}|${store.devMode}`;
      const switched = worldSig !== null && worldSig !== sig;
      worldSig = sig;
      if (switched) worldListeners.forEach((fn) => fn());
      snapshotListeners.forEach((fn) => fn());
    } else if (msg.type === "event") {
      applyEvent(msg.event);
      eventListeners.forEach((fn) => fn(msg.event));
    } else if (msg.type === "connection_test") {
      testListeners.forEach((fn) => fn(msg.results));
    } else if (msg.type === "canvas_schools") {
      schoolListeners.forEach((fn) => fn(msg.query, msg.schools, msg.error));
    } else if (msg.type === "notice") {
      noticeListeners.forEach((fn) => fn(msg.text, msg.tone));
    } else if (msg.type === "agents") {
      setAgents(msg.state);
      agentListeners.forEach((fn) => fn());
    } else if (msg.type === "phone_link") {
      phoneLinkListeners.forEach((fn) => fn(msg));
    } else if (msg.type === "session") gotSession(msg.session);
    else if (msg.type === "peers") gotPeers(msg.peers);
    else if (msg.type === "peer") gotPeer(msg.peer);
    else if (msg.type === "peer_left") peerLeft(msg.id);
    else if (msg.type === "peer_chat") peerChat(msg.id, msg.name, msg.text);
    else if (msg.type === "social") socialChanged(msg.text);
    else if (msg.type === "kicked") {
      kicked = true;
      gotKicked(msg.text);
    }
  };
  ws.onclose = (ev) => {
    setConnected(false);
    if (kicked) return;
    // A friend's island that won't have you (or never answers): back home.
    if (VISIT_ID && (ev.code !== 1000 || !ev.wasClean) && ++refused >= 3) return backHome("Couldn't land on that island: it's closed to visitors, or you're not friends any more.");
    // Online, a dropped connection might mean you were signed out (it expired, or you signed
    // out in another tab): then it's back to the title's sign-in, not retrying forever.
    if (HOSTED) void stillMe().then((ok) => ok && setTimeout(connect, 3000));
    else setTimeout(connect, 3000);
  };
  ws.onerror = () => ws?.close();
}

export function isConnected() {
  return ws?.readyState === WebSocket.OPEN;
}

export function send(msg: ClientMessage): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

export function onEvent(fn: (e: SeqEvent) => void) {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

type TestResults = (results: { name: string; ok: boolean | null; detail: string }[]) => void;
const testListeners = new Set<TestResults>();
/** Results of TEST CONNECTIONS. */
export function onConnectionTest(fn: TestResults) {
  testListeners.add(fn);
  return () => testListeners.delete(fn);
}

type Schools = (query: string, schools: { name: string; domain: string }[], error?: string) => void;
const schoolListeners = new Set<Schools>();
/** Canvas school search results ("Find your school"). */
export function onCanvasSchools(fn: Schools) {
  schoolListeners.add(fn);
  return () => schoolListeners.delete(fn);
}

export function onNotice(fn: (text: string, tone?: "ok") => void) {
  noticeListeners.add(fn);
  return () => noticeListeners.delete(fn);
}

export function onSnapshot(fn: () => void) {
  snapshotListeners.add(fn);
  return () => snapshotListeners.delete(fn);
}

const agentListeners = new Set<() => void>();

/** Your coding agents changed (a new sub-agent, a step, one finishing). */
export function onAgents(fn: () => void) {
  agentListeners.add(fn);
  return () => agentListeners.delete(fn);
}

export function onPhoneLink(fn: (msg: PhoneLinkMsg) => void) {
  phoneLinkListeners.add(fn);
  return () => phoneLinkListeners.delete(fn);
}
