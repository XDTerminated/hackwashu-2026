// Real Spotify, via the player's own sign-in: Echo the DJ plays it right in
// the game tab (the game becomes a Spotify speaker through Spotify's Web
// Playback SDK, which Spotify only allows for Premium accounts).
//
// Setup (once, as the host): developer.spotify.com/dashboard → Create app →
// Redirect URI  http://127.0.0.1:8787/oauth/spotify/callback  (Spotify doesn't
// accept "localhost"), APIs used: Web API and Web Playback SDK → copy the
// Client ID and secret into the /setup/spotify page (or SPOTIFY_CLIENT_ID /
// SPOTIFY_CLIENT_SECRET in .env). While the app is in Development mode, add
// each player's Spotify email under User Management.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR, HOSTED, PUBLIC_URL } from "../env.js";

const TOKEN_FILE = join(DATA_DIR, "spotify.json");
const CLIENT_FILE = join(DATA_DIR, "spotify-client.json");
const PORT = Number(process.env.PORT ?? 8787);
export const SPOTIFY_REDIRECT = process.env.SPOTIFY_REDIRECT ?? (HOSTED && PUBLIC_URL ? `${PUBLIC_URL}/oauth/spotify/callback` : `http://127.0.0.1:${PORT}/oauth/spotify/callback`);

const SCOPES = ["streaming", "user-read-email", "user-read-private", "user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing"];

interface Saved {
  access_token: string;
  refresh_token: string;
  /** When the access token runs out (ms). */
  expires_at: number;
  account?: string;
  premium?: boolean;
}

let saved: Saved | null = null;

function clientCreds(): { id?: string; secret?: string } {
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) return { id: process.env.SPOTIFY_CLIENT_ID, secret: process.env.SPOTIFY_CLIENT_SECRET };
  try {
    return existsSync(CLIENT_FILE) ? (JSON.parse(readFileSync(CLIENT_FILE, "utf8")) as { id?: string; secret?: string }) : {};
  } catch {
    return {};
  }
}

export function spotifyConfigured() {
  const c = clientCreds();
  return !!(c.id && c.secret);
}

/** Save the Spotify app's ID and secret (from the setup page). Throws with a friendly reason if they look wrong. */
export function setSpotifyClient(rawId: string, rawSecret: string) {
  const id = rawId.trim();
  const secret = rawSecret.trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error("That Client ID doesn't look right: it's 32 letters and numbers, from your app's Settings page.");
  if (!/^[0-9a-f]{32}$/i.test(secret)) throw new Error("That Client secret doesn't look right: press View client secret on your app's Settings page and copy it again.");
  mkdirSync(dirname(CLIENT_FILE), { recursive: true });
  writeFileSync(CLIENT_FILE, JSON.stringify({ id, secret }), { mode: 0o600 });
}

export function spotifyStatus() {
  return { connected: !!saved, account: saved?.account, configured: spotifyConfigured(), premium: saved?.premium };
}

function save(s: Saved) {
  saved = s;
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(s), { mode: 0o600 });
}

/** Restore a previous sign-in, if any. */
export function initSpotify() {
  try {
    const s = existsSync(TOKEN_FILE) ? (JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as Saved) : null;
    if (s?.refresh_token) {
      saved = s;
      console.log(`[spotify] restored sign-in${s.account && !HOSTED ? ` for ${s.account}` : ""}`);
    }
  } catch {
    /* no saved sign-in */
  }
}

export function disconnectSpotify() {
  saved = null;
  device = null;
  rmSync(TOKEN_FILE, { force: true });
}

// A sign-in must come back with the state we sent (so another site can't finish one for you).
const states = new Set<string>();

export function spotifyAuthUrl(): string {
  const state = randomBytes(12).toString("hex");
  states.add(state);
  const q = new URLSearchParams({ response_type: "code", client_id: clientCreds().id ?? "", scope: SCOPES.join(" "), redirect_uri: SPOTIFY_REDIRECT, state, show_dialog: "true" });
  return `https://accounts.spotify.com/authorize?${q}`;
}

async function tokenRequest(form: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const c = clientCreds();
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString("base64")}` },
    body: new URLSearchParams(form),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(body.error_description ?? body.error ?? `Spotify said ${res.status}`);
  return { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in ?? 3600 };
}

export async function finishSpotifyAuth(code: string, state: string | null): Promise<string | undefined> {
  if (!state || !states.delete(state)) throw new Error("That sign-in link is stale. Press CONNECT SPOTIFY in the game again.");
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: SPOTIFY_REDIRECT });
  save({ access_token: t.access_token, refresh_token: t.refresh_token ?? "", expires_at: Date.now() + t.expires_in * 1000 });
  const me = await api<{ display_name?: string; email?: string; product?: string }>("GET", "/me");
  save({ ...saved!, account: me?.display_name || me?.email, premium: me?.product === "premium" });
  return saved?.account;
}

/** A fresh access token (refreshed when it's about to run out). */
export async function accessToken(): Promise<string> {
  if (!saved) throw new Error("Spotify isn't connected yet.");
  if (Date.now() < saved.expires_at - 60_000) return saved.access_token;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: saved.refresh_token });
  save({ ...saved, access_token: t.access_token, refresh_token: t.refresh_token ?? saved.refresh_token, expires_at: Date.now() + t.expires_in * 1000 });
  return saved!.access_token;
}

/** Who's signed in, and on which plan (for TEST CONNECTIONS). */
export async function spotifyMe() {
  return api<{ id: string; display_name?: string; product?: string }>("GET", "/me");
}

async function api<T>(method: string, path: string, body?: object): Promise<T | null> {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return null;
  const json = (await res.json().catch(() => null)) as (T & { error?: { status: number; message: string; reason?: string } }) | null;
  if (!res.ok) {
    const reason = json?.error?.reason ?? "";
    if (reason === "PREMIUM_REQUIRED" || res.status === 403) throw new Error("Spotify only lets Premium accounts play music in other apps like this one.");
    if (reason === "NO_ACTIVE_DEVICE" || res.status === 404) throw new Error("The game's Spotify player isn't ready yet: open the game in Chrome, Edge or Firefox and click anywhere once so it's allowed to play sound.");
    throw new Error(json?.error?.message ?? `Spotify said ${res.status}`);
  }
  return json;
}

// ---------------------------------------------------------------- playing, in the game tab

/** The game tab's Spotify player (it tells us its id once it's ready). */
let device: string | null = null;

export function setDevice(id: string) {
  // ("" when the tab's player went away: stop aiming at it)
  device = id ? id.slice(0, 80) : null;
}

const onDevice = () => (device ? `?device_id=${encodeURIComponent(device)}` : "");

/** The player we last handed playback to (a fresh one needs handing over before it'll take commands). */
let handedTo: string | null = null;
const NOT_READY = "The game's Spotify player hasn't started yet: click anywhere in the game once (in Chrome, Edge or Firefox), then ask Echo again.";

async function handOver() {
  if (!device) throw new Error(NOT_READY);
  await api("PUT", "/me/player", { device_ids: [device], play: false }).catch(() => undefined);
  handedTo = device;
  await new Promise((r) => setTimeout(r, 400));
}

/**
 * Send a command to the game's player: hand playback over to it first if it's
 * new, and if Spotify says it can't find it, hand over once more and retry.
 */
async function onGame<T>(command: () => Promise<T>): Promise<T> {
  if (!device) throw new Error(NOT_READY);
  if (handedTo !== device) await handOver();
  try {
    return await command();
  } catch (err) {
    if (!/isn't ready yet/.test(String(err))) throw err;
    await handOver();
    return command();
  }
}

type Kind = "track" | "album" | "playlist" | "artist";
interface Found {
  uri: string;
  name: string;
  by: string;
}

async function find(query: string, kind: Kind): Promise<Found> {
  const q = new URLSearchParams({ q: query, type: kind, limit: "1" });
  const r = await api<Record<string, { items: ({ uri: string; name: string; artists?: { name: string }[]; owner?: { display_name?: string } } | null)[] }>>("GET", `/search?${q}`);
  const item = r?.[`${kind}s`]?.items?.find(Boolean);
  if (!item) throw new Error(`Couldn't find a ${kind} for "${query}" on Spotify.`);
  return { uri: item.uri, name: item.name, by: item.artists?.map((a) => a.name).join(", ") ?? item.owner?.display_name ?? "" };
}

/** Find something and play it in the game. */
export async function play(query: string, kind: Kind = "track"): Promise<Found> {
  const f = await find(query, kind);
  await onGame(() => api("PUT", `/me/player/play${onDevice()}`, kind === "track" ? { uris: [f.uri] } : { context_uri: f.uri }));
  return f;
}

export async function queue(query: string): Promise<Found> {
  const f = await find(query, "track");
  await onGame(() => api("POST", `/me/player/queue?uri=${encodeURIComponent(f.uri)}${device ? `&device_id=${encodeURIComponent(device)}` : ""}`));
  return f;
}

export const pause = () => onGame(() => api("PUT", `/me/player/pause${onDevice()}`));
export const resume = () => onGame(() => api("PUT", `/me/player/play${onDevice()}`));
export const skip = (back: boolean) => onGame(() => api("POST", `/me/player/${back ? "previous" : "next"}${onDevice()}`));
export const volume = (percent: number) => onGame(() => api("PUT", `/me/player/volume?volume_percent=${Math.round(Math.max(0, Math.min(100, percent)))}${device ? `&device_id=${encodeURIComponent(device)}` : ""}`));

export async function nowPlaying(): Promise<{ playing: boolean; track?: string; by?: string; progress?: string } | null> {
  const r = await api<{ is_playing: boolean; progress_ms?: number; item?: { name: string; duration_ms: number; artists?: { name: string }[] } }>("GET", "/me/player/currently-playing");
  if (!r?.item) return { playing: false };
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  return { playing: r.is_playing, track: r.item.name, by: r.item.artists?.map((a) => a.name).join(", "), progress: `${mmss(r.progress_ms ?? 0)} of ${mmss(r.item.duration_ms)}` };
}
