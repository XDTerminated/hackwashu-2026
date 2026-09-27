// The game as a Spotify speaker: once Spotify is connected, Spotify's Web
// Playback SDK turns this tab into a player called "Fl-AI Me to the Moon",
// and Echo the DJ plays to it (the server tells Spotify what to play; the
// music comes out of here). While it plays, the colony's own tune steps
// aside. Spotify only allows this for Premium accounts.

import { duckMusic } from "./music";
import * as net from "./net";
import { onStoreChange, store } from "./store";

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  addListener(event: "ready" | "not_ready", cb: (e: { device_id: string }) => void): void;
  addListener(event: "player_state_changed", cb: (state: { paused: boolean } | null) => void): void;
  addListener(event: "initialization_error" | "authentication_error" | "account_error" | "playback_error", cb: (e: { message: string }) => void): void;
  activateElement(): Promise<void>;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: { Player: new (o: { name: string; volume?: number; getOAuthToken: (cb: (token: string) => void) => void }) => SpotifyPlayer };
  }
}

let player: SpotifyPlayer | null = null;
let device: string | null = null;
let loading = false;
let woken = false;

/** A fresh access token for the player, from the colony server (it holds the sign-in). */
async function token(): Promise<string> {
  const res = await fetch(`${net.SERVER_HTTP}/spotify/token`);
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(body.error ?? "Spotify isn't connected");
  return body.access_token;
}

function load() {
  if (loading) return;
  loading = true;
  window.onSpotifyWebPlaybackSDKReady = () => {
    const p = new window.Spotify!.Player({ name: "Fl-AI Me to the Moon", volume: 0.7, getOAuthToken: (cb) => void token().then(cb).catch((err) => console.warn("[spotify]", err)) });
    p.addListener("ready", ({ device_id }) => {
      device = device_id;
      net.send({ type: "spotify_device", id: device_id });
    });
    p.addListener("not_ready", () => (device = null));
    p.addListener("player_state_changed", (state) => duckMusic(!!state && !state.paused));
    for (const e of ["initialization_error", "authentication_error", "account_error", "playback_error"] as const) p.addListener(e, ({ message }) => console.warn(`[spotify] ${e}: ${message}`));
    void p.connect();
    player = p;
  };
  const script = document.createElement("script");
  script.src = "https://sdk.scdn.co/spotify-player.js";
  script.async = true;
  document.head.appendChild(script);
}

/** Browsers only let a page play sound after you've clicked or pressed a key in it: wake the player then. */
function wake() {
  if (!player || woken) return;
  woken = true;
  void player.activateElement().catch(() => (woken = false));
}

export function startSpotify() {
  const check = () => {
    if (store.connections.spotify?.connected) load();
  };
  check();
  onStoreChange(check);
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);
  // (the server forgets the player when it restarts: remind it)
  net.onSnapshot(() => device && net.send({ type: "spotify_device", id: device }));
}
