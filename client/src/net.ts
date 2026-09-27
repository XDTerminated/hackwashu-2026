// WebSocket link to the agent server. The game still runs (walk, decorate)
// when the server is down; villagers just can't take tasks.

import type { ClientMessage, SeqEvent, ServerMessage } from "../../shared/game";

export type PhoneLinkMsg = Extract<ServerMessage, { type: "phone_link" }>;
import { applyEvent, applySnapshot, setAgents, setConnected } from "./store";

// ?server=8797 points a test copy of the game at a test server.
const TEST_PORT = new URLSearchParams(location.search).get("server");
/**
 * The hosted game (built, and served by the gateway once you've signed in):
 * everything goes to the site itself, which passes it to your own copy of
 * the colony server. On your computer (npm run dev) it's the server on :8787.
 */
export const HOSTED = !import.meta.env.DEV && !TEST_PORT;
const PORT = TEST_PORT ?? "8787";
const URL = HOSTED ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws` : `ws://${location.hostname || "localhost"}:${PORT}`;
/** The colony server's http address (connect pages, voices). */
export const SERVER_HTTP = HOSTED ? location.origin : `http://${location.hostname || "localhost"}:${PORT}`;
const eventListeners = new Set<(e: SeqEvent) => void>();
const noticeListeners = new Set<(text: string, tone?: "ok") => void>();
const snapshotListeners = new Set<() => void>();
const phoneLinkListeners = new Set<(msg: PhoneLinkMsg) => void>();
let ws: WebSocket | null = null;

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
};

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
export const signOut = () => void (location.href = "/auth/logout");

export function connect() {
  try {
    ws = new WebSocket(URL);
  } catch {
    setTimeout(connect, 3000);
    return;
  }
  ws.onopen = () => {
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
      applySnapshot(msg.snapshot);
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
    }
  };
  ws.onclose = () => {
    setConnected(false);
    // Online, a dropped connection might mean you were signed out (it expired, or you signed
    // out in another tab): then it's back to the title's sign-in, not retrying forever.
    if (HOSTED)
      void fetch("/auth/me", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ signedIn?: boolean }>)
        .then((me) => {
          if (me.signedIn === false) location.href = "/?signin=ended";
          else setTimeout(connect, 3000);
        })
        .catch(() => setTimeout(connect, 3000));
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
