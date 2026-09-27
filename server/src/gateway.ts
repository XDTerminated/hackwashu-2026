// The hosted game's front door. Everyone signs in (with Google) before the
// game starts, and each account gets its own private copy of the game server:
// its own village, save and connections (their Gmail, Calendar, Canvas, and
// their Claude Code in the Office), in its own folder and its own process.
// The gateway checks who you are and passes everything you send (pages, the
// game's live connection) to your copy and nobody else's. Copies start when
// their player shows up and stop after a while idle; saves stay on disk.
//
// Run with `npm start` (see README, "Deploying"). Your own computer doesn't
// need this: `npm run dev` is the single-player game, exactly as before.

import "./env.js";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { connect as tcp, isIP } from "node:net";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";
import { suitTint, type SocialState, type VisitPerms } from "../../shared/visit.js";
import { Social } from "./social.js";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(here, "..");
const PORT = Number(process.env.PORT ?? 8080);
const ROOT = resolve(process.env.MOON_DATA_ROOT || join(SERVER_DIR, "data-hosted"));
const CLIENT = resolve(process.env.MOON_CLIENT_DIST || join(SERVER_DIR, "..", "client", "dist"));
const MAX_RUNNING = Number(process.env.MOON_MAX_RUNNING ?? 30);
/** Guests can fill at most half the Moon, so signed-in players always find room. */
const MAX_GUESTS = Math.max(1, Math.floor(MAX_RUNNING / 2));
const IDLE_MS = 15 * 60_000;
const SESSION_DAYS = 30;
/** Local testing only: /auth/dev?email=... signs in without Google. Never set this on the real site. */
const DEV_LOGIN = process.env.MOON_DEV_LOGIN === "1";

mkdirSync(join(ROOT, "players"), { recursive: true });

// Google sign-in: from .env, or else the Google app already set up for the single-player
// game (server/data/google-client.json, from /setup/google). Each island gets it too.
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  try {
    const saved = JSON.parse(readFileSync(join(SERVER_DIR, "data", "google-client.json"), "utf8")) as { id?: string; secret?: string };
    if (saved.id && saved.secret) {
      process.env.GOOGLE_CLIENT_ID = saved.id;
      process.env.GOOGLE_CLIENT_SECRET = saved.secret;
    }
  } catch {
    /* not set up: nobody can sign in with Google (the gateway says so when it starts) */
  }
}

/** Friends: who may visit whom, and what they may do there (see social.ts). */
const social = new Social(join(ROOT, "social.json"));

/**
 * Islands talk to each other (a visitor's coins, gifts, a friend's question for
 * a neighbor) only through the gateway, with this key; so do the gateway's own
 * notes to an island ("send Sam home"). New every start, never sent to a browser.
 */
const INTERNAL_KEY = randomBytes(24).toString("hex");

// ---------------------------------------------------------------- the site's address

let publicUrl = (process.env.MOON_PUBLIC_URL ?? "").replace(/\/$/, "");
/** The address the site was last reached at (for islands started by another island, not a browser). */
let lastSite = `http://localhost:${PORT}`;
// The site's address goes into sign-in links and the LINK command people paste into a terminal:
// it can't come from whatever a request claims its Host is (only when testing on your own computer).
if (!publicUrl && !DEV_LOGIN) {
  console.error("[gateway] ✗ MOON_PUBLIC_URL isn't set: set it to the site's address (https://...). See README, Deploying.");
  process.exit(1);
}
function siteUrl(req: IncomingMessage) {
  if (publicUrl) return publicUrl;
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0];
  return (lastSite = `${proto}://${req.headers.host}`);
}

// ---------------------------------------------------------------- accounts

interface Player {
  id: string;
  /** Google's id for the account (or "dev:<email>" when testing). */
  sub: string;
  email: string;
  name: string;
  createdAt: number;
  lastSeen: number;
  /** Bumped on sign-out: every session made before it stops working (all tabs, copied cookies). */
  epoch?: number;
  /** A guest: never saved, and their whole copy is thrown away when it stops. */
  guest?: boolean;
}

const USERS = join(ROOT, "players.json");
const players: Record<string, Player> = existsSync(USERS) ? JSON.parse(readFileSync(USERS, "utf8")) : {};

function savePlayers() {
  const tmp = `${USERS}.tmp`;
  // (guests aren't kept: they're gone when their copy is)
  const kept = Object.fromEntries(Object.entries(players).filter(([, p]) => !p.guest));
  writeFileSync(tmp, JSON.stringify(kept, null, 1), { mode: 0o600 });
  renameSync(tmp, USERS);
}

function playerFor(sub: string, email: string, name: string): Player {
  let p = Object.values(players).find((x) => x.sub === sub);
  if (!p) {
    p = { id: randomBytes(9).toString("base64url").replace(/[-_]/g, "x"), sub, email, name, createdAt: Date.now(), lastSeen: Date.now() };
    players[p.id] = p;
    console.log(`[gateway] new player ${p.id}`);
  }
  p.email = email;
  p.name = name;
  p.lastSeen = Date.now();
  savePlayers();
  return p;
}

// ---------------------------------------------------------------- sessions (signed cookies)

const SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = join(ROOT, ".session-secret");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  return readFileSync(file, "utf8");
})();

const sign = (s: string) => createHmac("sha256", SECRET).update(s).digest("base64url");

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    // A mangled cookie is just ignored (decodeURIComponent throws on a bad % sequence).
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* skip it */
    }
  }
  return out;
}

function sessionCookie(req: IncomingMessage, value: string, maxAge: number) {
  const secure = siteUrl(req).startsWith("https:") ? "; Secure" : "";
  return `moon_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function newSession(req: IncomingMessage, p: Player) {
  // (a guest's session lasts the day at most)
  const secs = p.guest ? 12 * 3600 : SESSION_DAYS * 86_400;
  const body = `${p.id}.${Date.now() + secs * 1000}.${p.epoch ?? 0}`;
  return sessionCookie(req, `${body}.${sign(body)}`, secs);
}

/** Who's asking, from their session cookie (or nobody). */
function whoIs(req: IncomingMessage): Player | null {
  const raw = cookies(req).moon_session;
  if (!raw) return null;
  const [id, exp, epoch, mac] = raw.split(".");
  if (!id || !exp || !epoch || !mac) return null;
  const want = Buffer.from(sign(`${id}.${exp}.${epoch}`));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (Number(exp) < Date.now()) return null;
  const p = Object.hasOwn(players, id) ? players[id] : null;
  // Signed out since this session began (in any tab)?
  return p && String(p.epoch ?? 0) === epoch ? p : null;
}

// ---------------------------------------------------------------- each player's own game server

interface Copy {
  port: number;
  proc: ChildProcess;
  ready: Promise<void>;
  lastUsed: number;
  sockets: number;
  /** The owner's own connections (they're "online" while this is above 0). */
  ownerSockets: number;
}

const copies = new Map<string, Copy>();
let nextPort = 9100;

function freePort() {
  const used = new Set([...copies.values()].map((c) => c.port));
  for (let i = 0; i < 2000; i++) {
    const p = 9100 + ((nextPort - 9100 + i) % 2000);
    if (!used.has(p)) {
      nextPort = p + 1;
      return p;
    }
  }
  throw new Error("no free ports");
}

/**
 * What a player's copy gets from the site's settings: its brains, voices and sign-in apps, and
 * what Node needs to run. Never the host's own Canvas, phone line, name, dev tools or session secret.
 */
const COPY_ENV = /^(ANTHROPIC_API_KEY|GROQ_\w+|MOCK_AGENTS|GOOGLE_CLIENT_(ID|SECRET)|SPOTIFY_CLIENT_(ID|SECRET)|ELEVENLABS_\w+|BROWSER_VOICES|VOICE_\w+|UNLOCK_ALL|ROCK_REGROW_MS|PATH|PATHEXT|NODE_\w+|TSX_\w+|HOME|USERPROFILE|TMPDIR|TMP|TEMP|LANG|LC_\w+|TZ|SystemRoot|SYSTEMROOT|windir|COMSPEC|ComSpec|APPDATA|LOCALAPPDATA|(HTTPS?|NO)_PROXY|(https?|no)_proxy|SSL_CERT_\w+)$/;
const COPY_NEVER = /^(CANVAS_|DEV_TOOLS$|PLAYER_|PHOTON_|SPECTRUM_|SESSION_SECRET$|MOON_)/;

function copyEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && COPY_ENV.test(k) && !COPY_NEVER.test(k)) out[k] = v;
  return out;
}

/** This player's game server, started if it isn't running. */
async function copyFor(p: Player, site: string): Promise<Copy> {
  if (deleting.has(p.id)) throw new Error("That village is being deleted.");
  let c = copies.get(p.id);
  if (!c) {
    if (p.guest && [...copies.keys()].filter((id) => players[id]?.guest).length >= MAX_GUESTS) throw new Error("Lots of guests on the Moon right now. Sign in with Google, or try again in a few minutes!");
    if (copies.size >= MAX_RUNNING) {
      // Make room: stop whoever's been idle longest.
      const idle = [...copies.entries()].filter(([, x]) => x.sockets === 0).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!idle) throw new Error("The Moon is full right now. Try again in a few minutes!");
      void stopCopy(idle[0]);
    }
    const port = freePort();
    // (a guest's copy lives in a scratch folder, deleted when it stops)
    const dir = p.guest ? join(tmpdir(), "moon-guests", p.id) : join(ROOT, "players", p.id);
    mkdirSync(dir, { recursive: true });
    const proc = spawn(process.execPath, ["--import", "tsx", join(SERVER_DIR, "src", "index.ts")], {
      cwd: SERVER_DIR,
      env: {
        ...copyEnv(),
        PORT: String(port),
        MOON_HOSTED: "1",
        MOON_DATA_DIR: dir,
        MOON_PUBLIC_URL: site,
        MOON_USER_ID: p.id,
        MOON_USER_EMAIL: p.email,
        MOON_USER_NAME: p.name,
        MOON_GUEST: p.guest ? "1" : "",
        GOOGLE_REDIRECT: `${site}/oauth/google/callback`,
        MOON_INTERNAL_KEY: INTERNAL_KEY,
        MOON_GATEWAY: `http://127.0.0.1:${PORT}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tag = `[${p.id.slice(0, 6)}]`;
    const log = (chunk: Buffer) => {
      for (const line of String(chunk).split("\n")) if (line.trim()) console.log(`${tag} ${line}`);
    };
    proc.stdout?.on("data", log);
    proc.stderr?.on("data", log);
    const ready = (async () => {
      const deadline = Date.now() + 40_000;
      while (Date.now() < deadline) {
        if (proc.exitCode !== null) throw new Error("your village didn't start");
        const ok = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false);
        if (ok) return;
        await new Promise((r) => setTimeout(r, 300));
      }
      throw new Error("your village took too long to start");
    })();
    c = { port, proc, ready, lastUsed: Date.now(), sockets: 0, ownerSockets: 0 };
    copies.set(p.id, c);
    proc.on("exit", () => {
      if (copies.get(p.id)?.proc === proc) copies.delete(p.id);
      // A guest's village is gone for good once it stops.
      if (p.guest) {
        rmSync(dir, { recursive: true, force: true });
        delete players[p.id];
      }
      console.log(`[gateway] ${tag} stopped`);
    });
    console.log(`[gateway] ${tag} starting on :${port}`);
  }
  c.lastUsed = Date.now();
  try {
    await c.ready;
  } catch (err) {
    void stopCopy(p.id);
    throw err;
  }
  return c;
}

/** Stop a player's copy; resolves once it has really exited (it saves on the way out). */
function stopCopy(id: string): Promise<void> {
  const c = copies.get(id);
  if (!c) return Promise.resolve();
  copies.delete(id);
  if (c.proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const hard = setTimeout(() => c.proc.kill("SIGKILL"), 5000);
    c.proc.once("exit", () => {
      clearTimeout(hard);
      resolve();
    });
    c.proc.kill("SIGTERM");
  });
}

/** Accounts being deleted: nothing may start their village back up meanwhile. */
const deleting = new Set<string>();

// Idle copies go to sleep (their saves stay).
setInterval(() => {
  for (const [id, c] of copies) if (c.sockets === 0 && Date.now() - c.lastUsed > IDLE_MS) void stopCopy(id);
  // (guests who never started a village, or whose session ran out)
  for (const [id, p] of Object.entries(players)) if (p.guest && !copies.has(id) && Date.now() - p.createdAt > IDLE_MS) delete players[id];
}, 60_000);

// ---------------------------------------------------------------- passing things through

/** Headers only the gateway may set (a browser's own copies are dropped). */
const OURS = /^x-moon-/i;

function proxy(req: IncomingMessage, res: ServerResponse, c: Copy, site: string) {
  c.lastUsed = Date.now();
  const mine = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !OURS.test(k)));
  const headers = { ...mine, "x-forwarded-proto": site.startsWith("https") ? "https" : "http", "x-forwarded-host": String(req.headers.host ?? "") };
  const up = request({ host: "127.0.0.1", port: c.port, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("Your village is waking up. Try again in a moment.");
  });
  req.pipe(up);
}

/** Who's connecting, as the island hears it from the gateway (it trusts only the gateway's key). */
interface Who {
  id: string;
  name: string;
  role: "owner" | "visitor";
  tint: number;
  host: { id: string; name: string };
  perms?: VisitPerms;
}

/** The game's live connection (WebSocket): through to the island being played (your own, or a friend's). */
function proxyUpgrade(req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer, c: Copy, who: Who) {
  const up = tcp(c.port, "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (!OURS.test(req.rawHeaders[i])) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    lines.push(`x-moon-key: ${INTERNAL_KEY}`, `x-moon-who: ${Buffer.from(JSON.stringify(who)).toString("base64url")}`);
    up.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  c.sockets++;
  if (who.role === "owner") c.ownerSockets++;
  let closed = false;
  const done = () => {
    if (closed) return;
    closed = true;
    c.sockets = Math.max(0, c.sockets - 1);
    if (who.role === "owner") c.ownerSockets = Math.max(0, c.ownerSockets - 1);
    c.lastUsed = Date.now();
    up.destroy();
    socket.destroy();
  };
  up.on("error", done);
  up.on("close", done);
  socket.on("error", done);
  socket.on("close", done);
}

// ---------------------------------------------------------------- pages

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
};

/** A file from the built game (client/dist), or false if there isn't one. */
function serveStatic(res: ServerResponse, pathname: string): boolean {
  const file = normalize(join(CLIENT, pathname === "/" ? "index.html" : decodeURIComponent(pathname)));
  if (!file.startsWith(CLIENT + sep) || !existsSync(file) || !extname(file)) return false;
  const immutable = pathname.startsWith("/assets/");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
  res.end(readFileSync(file));
  return true;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function page(res: ServerResponse, status: number, title: string, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg">
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a1a radial-gradient(#ffffff22 1px,transparent 1px) 0 0/22px 22px;color:#f4d9a6;font:16px/1.6 ui-monospace,Menlo,monospace}
  .card{max-width:480px;margin:24px;padding:28px 30px;background:#1a1430;border:4px solid #8a4b1f;box-shadow:0 6px 0 #3b2a3a}
  h1{margin:0 0 4px;color:#f5c542;font-size:28px;letter-spacing:.06em}h2{color:#f2a3b8;margin-top:0}
  .tag{color:#b8b0c4;margin:0 0 20px}
  a.btn{display:inline-block;margin:6px 0;padding:10px 16px;background:#fbfaf6;color:#1a1430;text-decoration:none;font-weight:700;border:3px solid #3b2a3a;box-shadow:0 3px 0 #3b2a3a}
  a.btn:hover{background:#f5c542}
  ul{padding-left:1.2em;margin:14px 0}li{margin:4px 0}
  small,.small{color:#8a8fa8;font-size:13px}a{color:#f5c542}
</style>
<div class="card">${body}</div>`);
}

function privacyPage(res: ServerResponse) {
  page(
    res,
    200,
    "Fl-AI Me to the Moon · Privacy",
    `<h2>Privacy</h2>
<p>Fl-AI Me to the Moon is a hackathon project (HackWashU 2026).</p>
<ul>
  <li><b>Signing in</b> with Google shares your name and email address, used only to find your village.</li>
  <li><b>If you connect Gmail, Calendar or Canvas</b> in the game, the access Google or Canvas grants is stored on the game's server, only for your village, and used only when you ask a villager to do something. Sending an email or creating an event always waits for your OK.</li>
  <li><b>If you link Claude Code</b>, a script on your computer sends what your agents are doing to your village while it runs. It isn't saved.</li>
  <li>Villagers think using an AI service (Groq), which receives the text of what you ask them.</li>
  <li><b>Friends</b>: your friends see your first name, and can visit your island while it's open (even when you're away) and chat with whoever's there. They never see your letters, texts, connected accounts or what your neighbors do for you. A neighbor you let a friend ask uses <i>their</i> accounts, never yours. Your Office is only shown to friends you allow.</li>
  <li><b>Delete everything</b> any time: in the game, Help → DELETE MY DATA. That removes your village, your connections and your account.</li>
</ul>
<p><a href="/">Back to the game</a></p>`,
  );
}

// ---------------------------------------------------------------- guests

/** Who's asking: behind the site's proxy (a private address), the address it saw; otherwise the connection's. */
function clientIp(req: IncomingMessage) {
  const addr = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  const behindProxy = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd])/i.test(addr);
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").pop()?.trim() ?? "";
  return behindProxy && isIP(forwarded) ? forwarded : addr;
}

const GUESTS_PER_IP = 5;
const GUEST_WINDOW_MS = 10 * 60_000;
const guestStarts = new Map<string, number[]>();

function guestAllowed(ip: string) {
  const now = Date.now();
  for (const [k, times] of guestStarts) if (times.every((t) => now - t > GUEST_WINDOW_MS)) guestStarts.delete(k);
  const recent = (guestStarts.get(ip) ?? []).filter((t) => now - t < GUEST_WINDOW_MS);
  if (recent.length >= GUESTS_PER_IP) return false;
  guestStarts.set(ip, [...recent, now]);
  return true;
}

// ---------------------------------------------------------------- sign in with Google

function googleClient(req: IncomingMessage) {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${siteUrl(req)}/auth/google/callback`);
}

async function auth(req: IncomingMessage, res: ServerResponse, url: URL) {
  const redirect = (to: string, cookie?: string | string[]) => {
    res.writeHead(302, { location: to, "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) });
    res.end();
  };
  const secure = siteUrl(req).startsWith("https:") ? "; Secure" : "";
  if (url.pathname === "/auth/google") {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return redirect("/?signin=unconfigured");
    // One cookie per sign-in attempt, named by its state, so two tabs signing in don't trip over each other.
    const state = randomBytes(12).toString("hex");
    const to = googleClient(req).generateAuthUrl({ scope: ["openid", "email", "profile"], state, prompt: "select_account" });
    return redirect(to, `moon_oauth_${state}=1; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
  }
  if (url.pathname === "/auth/google/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || !/^[0-9a-f]{24}$/.test(state) || cookies(req)[`moon_oauth_${state}`] !== "1") return redirect(url.searchParams.get("error") ? "/?signin=cancelled" : "/?signin=expired");
    try {
      const g = googleClient(req);
      const { tokens } = await g.getToken(code);
      const ticket = await g.verifyIdToken({ idToken: tokens.id_token ?? "", audience: process.env.GOOGLE_CLIENT_ID });
      const info = ticket.getPayload();
      if (!info?.sub || !info.email) throw new Error("Google didn't say who you are");
      const p = playerFor(info.sub, info.email, info.name ?? info.email.split("@")[0]);
      return redirect("/", [newSession(req, p), `moon_oauth_${state}=; Path=/auth; Max-Age=0${secure}`]);
    } catch (err) {
      console.error("[gateway] sign-in failed:", err);
      return redirect("/?signin=failed");
    }
  }
  if (url.pathname === "/auth/guest") {
    // Play as a guest: a village of your own that's never saved (a few per visitor, now and then).
    if (!guestAllowed(clientIp(req))) return redirect("/?signin=busy");
    const id = randomBytes(9).toString("base64url").replace(/[-_]/g, "x");
    const p: Player = { id, sub: `guest:${id}`, email: "", name: "Guest", createdAt: Date.now(), lastSeen: Date.now(), guest: true };
    players[id] = p;
    console.log(`[gateway] new guest ${id}`);
    return redirect("/", newSession(req, p));
  }
  if (url.pathname === "/auth/dev" && DEV_LOGIN) {
    const email = (url.searchParams.get("email") ?? "tester@example.com").slice(0, 80);
    const p = playerFor(`dev:${email}`, email, email.split("@")[0]);
    return redirect("/", newSession(req, p));
  }
  if (url.pathname === "/auth/logout") {
    // Signing out signs out everywhere: every tab, and any copied cookie. (POST from the game only: a link can't sign you out.)
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST", "cache-control": "no-store" });
      return res.end();
    }
    const origin = req.headers.origin;
    if (origin && origin !== siteUrl(req)) return page(res, 403, "Not here", "<p>That has to come from the game.</p>");
    const p = whoIs(req);
    if (p) {
      p.epoch = (p.epoch ?? 0) + 1;
      savePlayers();
      void stopCopy(p.id); // open game tabs lose their connection and go back to sign-in
      tellAll("/internal/kick", { id: p.id, text: "You signed out." });
      // (a guest's village is thrown away: the copy's exit deletes it)
      if (p.guest && !copies.has(p.id)) delete players[p.id];
    }
    res.writeHead(204, { "cache-control": "no-store", "set-cookie": sessionCookie(req, "", 0) });
    return res.end();
  }
  // The title screen asks this before connecting: signed in, and as whom.
  if (url.pathname === "/auth/me") {
    const p = whoIs(req);
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(p ? { signedIn: true, name: p.name, email: p.email, guest: !!p.guest } : { signedIn: false, devLogin: DEV_LOGIN }));
  }
  if (url.pathname === "/auth/delete" && req.method === "POST") {
    // Same-site form posts only (the game's DELETE MY DATA button).
    const origin = req.headers.origin;
    if (origin && origin !== siteUrl(req)) return page(res, 403, "Not here", "<p>That has to come from the game.</p>");
    const p = whoIs(req);
    if (!p) return redirect("/");
    deleting.add(p.id);
    try {
      await stopCopy(p.id); // (it may save once on its way out: wait for that, then delete)
      rmSync(join(ROOT, "players", p.id), { recursive: true, force: true });
      delete players[p.id];
      savePlayers();
      social.forget(p.id);
      tellAll("/internal/kick", { id: p.id, text: "That player's account is gone." });
    } finally {
      deleting.delete(p.id);
    }
    console.log(`[gateway] deleted player ${p.id}`);
    return page(res, 200, "Deleted", `<h2>All gone</h2><p>Your village, its connections and your account are deleted from Fl-AI Me to the Moon.</p><p class="small">To also remove the game's access from your Google account: myaccount.google.com → Security → Third-party connections.</p><p><a href="/?signin=deleted">Back to the start</a></p>`, { "set-cookie": sessionCookie(req, "", 0) });
  }
  res.writeHead(404);
  res.end();
}

// ---------------------------------------------------------------- friends (the phone's FRIENDS tab)

const firstName = (p: Player) => (p.name || p.email.split("@")[0] || "Friend").split(" ")[0].slice(0, 24);
const card = (id: string) => ({ id, name: firstName(players[id]), email: players[id].email });
/** Real, signed-up players only (never a guest, never a made-up id). */
const real = (id: unknown): id is string => typeof id === "string" && Object.hasOwn(players, id) && !players[id].guest;

function socialState(me: Player): SocialState {
  const t = social.of(me.id);
  return {
    code: t.code,
    closed: t.closed,
    friends: t.friends.filter(real).map((id) => ({ ...card(id), online: (copies.get(id)?.ownerSockets ?? 0) > 0, perms: social.permsFor(me.id, id), theirs: social.permsFor(id, me.id) })),
    incoming: t.incoming.filter(real).map(card),
    outgoing: social.outgoing(me.id).filter(real).map(card),
    blocked: t.blocked.filter(real).map(card),
  };
}

/** A note to one island, if it's running (nothing to tell a sleeping one: it asks when it wakes). */
function tell(id: string, path: string, body: object) {
  const c = copies.get(id);
  if (!c) return;
  void fetch(`http://127.0.0.1:${c.port}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-moon-key": INTERNAL_KEY }, body: JSON.stringify(body) }).catch(() => null);
}
function tellAll(path: string, body: object) {
  for (const id of copies.keys()) tell(id, path, body);
}

async function readJson(req: IncomingMessage, limit = 16_384): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("too big");
  }
  const v = JSON.parse(raw || "{}");
  return v && typeof v === "object" ? v : {};
}

async function socialRoute(req: IncomingMessage, res: ServerResponse, url: URL) {
  const json = (status: number, body: object) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const me = whoIs(req);
  if (!me || me.guest) return json(401, { error: "Sign in with Google to make friends." });
  if (req.method === "GET" && url.pathname === "/social") return json(200, socialState(me));
  if (req.method !== "POST") return json(405, { error: "POST" });
  // (from the game's own page only: a JSON post, same site)
  const origin = req.headers.origin;
  if ((origin && origin !== siteUrl(req)) || !String(req.headers["content-type"] ?? "").includes("application/json")) return json(403, { error: "That has to come from the game." });
  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch {
    return json(400, { error: "That didn't make sense." });
  }
  const them = body.id;
  const done = (text?: string) => json(200, { ...socialState(me), ...(text ? { text } : {}) });
  switch (url.pathname) {
    case "/social/add": {
      // By friend code, or by the Google email they signed in with.
      const raw = String(body.code ?? body.email ?? "").trim().slice(0, 120);
      const byEmail = raw.includes("@");
      const id = byEmail ? Object.values(players).find((x) => !x.guest && x.email.toLowerCase() === raw.toLowerCase())?.id : social.byCode(raw);
      if (!id) return json(404, { error: byEmail ? "Nobody's signed up with that email yet. Send them your friend code instead!" : "No island has that friend code." });
      if (id === me.id) return json(400, { error: "That's you!" });
      const r = social.request(me.id, id);
      if (r === "already") return done(`You and ${firstName(players[id])} are already friends.`);
      if (r === "friends") {
        tell(id, "/internal/social", { text: `${firstName(me)} accepted your friend request!` });
        return done(`You and ${firstName(players[id])} are friends now!`);
      }
      tell(id, "/internal/social", { text: `${firstName(me)} sent you a friend request (phone → FRIENDS).` });
      return done(`Friend request sent to ${firstName(players[id])}.`);
    }
    case "/social/answer": {
      if (!real(them)) return json(404, { error: "No such player." });
      const yes = social.answer(me.id, them, body.accept === true);
      if (yes) tell(them, "/internal/social", { text: `${firstName(me)} accepted your friend request!` });
      return done(yes ? `You and ${firstName(players[them])} are friends now!` : undefined);
    }
    case "/social/remove":
    case "/social/block": {
      if (!real(them)) return json(404, { error: "No such player." });
      if (url.pathname === "/social/block") social.block(me.id, them);
      else social.remove(me.id, them);
      // Neither of you is on the other's island any more.
      tell(me.id, "/internal/kick", { id: them, text: `You're no longer friends with ${firstName(me)}.` });
      tell(them, "/internal/kick", { id: me.id, text: "You're no longer friends." });
      tell(them, "/internal/social", {});
      return done();
    }
    case "/social/unblock":
      if (!real(them)) return json(404, { error: "No such player." });
      social.unblock(me.id, them);
      return done();
    case "/social/perms": {
      if (!real(them)) return json(404, { error: "No such player." });
      const perms = social.setPerms(me.id, them, body as { agents?: unknown; office?: unknown });
      if (!perms) return json(400, { error: "You can only give friends permissions." });
      // (if they're here right now, it takes effect right away)
      tell(me.id, "/internal/perms", { id: them, perms });
      tell(them, "/internal/social", {});
      return done();
    }
    case "/social/closed":
      social.setClosed(me.id, body.closed === true);
      if (body.closed === true) tell(me.id, "/internal/kick", { all: true, text: `${firstName(me)} closed their island for now.` });
      return done();
  }
  return json(404, { error: "no such thing" });
}

// ---------------------------------------------------------------- islands talking to each other

/** What one island may ask of another (always through here). */
const RELAY_PATHS = new Set(["/internal/wallet", "/internal/credit", "/internal/debit", "/internal/ask"]);

async function internalRoute(req: IncomingMessage, res: ServerResponse, url: URL) {
  const json = (status: number, body: object) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // Only islands (started by this gateway, with its key) ever call these.
  const key = Buffer.from(String(req.headers["x-moon-key"] ?? ""));
  const want = Buffer.from(INTERNAL_KEY);
  if (key.length !== want.length || !timingSafeEqual(key, want)) return json(404, { error: "no such thing" });
  if (url.pathname !== "/internal/relay" || req.method !== "POST") return json(404, { error: "no such thing" });
  let body: Record<string, unknown>;
  try {
    body = await readJson(req, 64_000);
  } catch {
    return json(400, { error: "bad relay" });
  }
  const { to, path } = body;
  if (!real(to) || typeof path !== "string" || !RELAY_PATHS.has(path)) return json(400, { error: "bad relay" });
  try {
    // (the other island wakes up if it's asleep: a visitor's coins go home even while they're away)
    const c = await copyFor(players[to], publicUrl || lastSite);
    c.lastUsed = Date.now();
    const r = await fetch(`http://127.0.0.1:${c.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-moon-key": INTERNAL_KEY },
      body: JSON.stringify(body.body ?? {}),
      signal: AbortSignal.timeout(path === "/internal/ask" ? 120_000 : 15_000),
    });
    return json(r.status, (await r.json().catch(() => ({}))) as object);
  } catch (err) {
    return json(503, { error: err instanceof Error ? err.message : "that island didn't answer" });
  }
}

// ---------------------------------------------------------------- the server

/** The game server's own pages and endpoints (everything else is the built game). */
const GAME_PATHS = /^\/(voice|connect\/|oauth\/|setup\/|agents\/)/;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (url.pathname.startsWith("/auth/")) return await auth(req, res, url);
    if (url.pathname === "/social" || url.pathname.startsWith("/social/")) return await socialRoute(req, res, url);
    if (url.pathname.startsWith("/internal/")) return await internalRoute(req, res, url);
    if (url.pathname === "/privacy") return privacyPage(res);
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, players: Object.keys(players).length, running: copies.size }));
    }
    // The LINK script talks to a player's copy with its own code/token (no cookie on the command line).
    // Its code and token live in the running village, so a village that's asleep is never woken for it.
    const bridge = url.pathname.match(/^\/bridge\/([\w]+)\//);
    if (bridge) {
      const c = Object.hasOwn(players, bridge[1]) ? copies.get(bridge[1]) : undefined;
      if (!c) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "No village with that link is open. Open the game and press LINK for a fresh command." }));
      }
      await c.ready;
      return proxy(req, res, c, siteUrl(req));
    }
    const p = whoIs(req);
    // Your village's own pages (connect Google, voices, ...) need you signed in; the title screen signs you in.
    if (GAME_PATHS.test(url.pathname)) {
      if (!p) {
        res.writeHead(302, { location: "/", "cache-control": "no-store" });
        return res.end();
      }
      return proxy(req, res, await copyFor(p, siteUrl(req)), siteUrl(req));
    }
    // The game itself, for everyone (signed out, its title screen shows SIGN IN WITH GOOGLE).
    if (serveStatic(res, url.pathname)) {
      // Signed in: warm up their village while the game loads.
      if (p && url.pathname === "/") void copyFor(p, siteUrl(req)).catch(() => null);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    console.error("[gateway]", err);
    if (!res.headersSent) page(res, 503, "Fl-AI Me to the Moon", `<h2>One moment</h2><p>${esc(err instanceof Error ? err.message : "Something went wrong.")}</p><p><a href="/">Try again</a></p>`);
    else res.end();
  }
});

server.on("upgrade", async (req, socket, head) => {
  socket.on("error", () => socket.destroy());
  try {
    const p = whoIs(req);
    if (!p) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    // ?visit=<id>: a friend's island (they needn't be online), if they'll have you.
    const visit = new URL(req.url ?? "/", "http://x").searchParams.get("visit");
    if (visit && visit !== p.id) {
      const host = Object.hasOwn(players, visit) ? players[visit] : null;
      const problem = !host || host.guest || p.guest ? "You can only visit friends' islands." : social.visitProblem(p.id, host.id);
      if (problem || !host) {
        socket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\n${problem}`);
        return;
      }
      const who: Who = { id: p.id, name: firstName(p), role: "visitor", tint: suitTint(p.id), host: { id: host.id, name: firstName(host) }, perms: social.permsFor(host.id, p.id) };
      proxyUpgrade(req, socket, head, await copyFor(host, siteUrl(req)), who);
      return;
    }
    proxyUpgrade(req, socket, head, await copyFor(p, siteUrl(req)), { id: p.id, name: firstName(p), role: "owner", tint: suitTint(p.id), host: { id: p.id, name: firstName(p) } });
  } catch {
    socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
  }
});

// Never let one bad request take the whole site down.
process.on("unhandledRejection", (err) => console.error("[gateway] unhandled:", err));

const shutdown = () => {
  // Every village saves on its way out; don't wait forever for them.
  void Promise.all([...copies.keys()].map((id) => stopCopy(id))).then(() => process.exit(0));
  setTimeout(() => process.exit(0), 6000);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(PORT, () => {
  console.log(`[gateway] Fl-AI Me to the Moon (hosted) on :${PORT} · data in ${ROOT}`);
  if (!existsSync(join(CLIENT, "index.html"))) console.log("[gateway] ⚠ the game isn't built: run `npm run build` first");
  if (!process.env.GOOGLE_CLIENT_ID) console.log("[gateway] ⚠ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set: nobody can sign in");
  if (DEV_LOGIN) console.log("[gateway] ⚠ MOON_DEV_LOGIN is on: anyone can sign in as anyone (testing only)");
});
