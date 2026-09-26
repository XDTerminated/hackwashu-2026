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
import { connect as tcp } from "node:net";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(here, "..");
const PORT = Number(process.env.PORT ?? 8080);
const ROOT = resolve(process.env.MOON_DATA_ROOT || join(SERVER_DIR, "data-hosted"));
const CLIENT = resolve(process.env.MOON_CLIENT_DIST || join(SERVER_DIR, "..", "client", "dist"));
const MAX_RUNNING = Number(process.env.MOON_MAX_RUNNING ?? 30);
const IDLE_MS = 15 * 60_000;
const SESSION_DAYS = 30;
/** Local testing only: /auth/dev?email=... signs in without Google. Never set this on the real site. */
const DEV_LOGIN = process.env.MOON_DEV_LOGIN === "1";

mkdirSync(join(ROOT, "players"), { recursive: true });

// ---------------------------------------------------------------- the site's address

let publicUrl = (process.env.MOON_PUBLIC_URL ?? "").replace(/\/$/, "");
function siteUrl(req: IncomingMessage) {
  if (publicUrl) return publicUrl;
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0];
  return `${proto}://${req.headers.host}`;
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
}

const USERS = join(ROOT, "players.json");
const players: Record<string, Player> = existsSync(USERS) ? JSON.parse(readFileSync(USERS, "utf8")) : {};

function savePlayers() {
  const tmp = `${USERS}.tmp`;
  writeFileSync(tmp, JSON.stringify(players, null, 1), { mode: 0o600 });
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
  const body = `${p.id}.${Date.now() + SESSION_DAYS * 86_400_000}.${p.epoch ?? 0}`;
  return sessionCookie(req, `${body}.${sign(body)}`, SESSION_DAYS * 86_400);
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

/** This player's game server, started if it isn't running. */
async function copyFor(p: Player, req: IncomingMessage): Promise<Copy> {
  if (deleting.has(p.id)) throw new Error("That village is being deleted.");
  let c = copies.get(p.id);
  if (!c) {
    if (copies.size >= MAX_RUNNING) {
      // Make room: stop whoever's been idle longest.
      const idle = [...copies.entries()].filter(([, x]) => x.sockets === 0).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!idle) throw new Error("The Moon is full right now. Try again in a few minutes!");
      void stopCopy(idle[0]);
    }
    const port = freePort();
    const site = siteUrl(req);
    const dir = join(ROOT, "players", p.id);
    mkdirSync(dir, { recursive: true });
    const proc = spawn(process.execPath, ["--import", "tsx", join(SERVER_DIR, "src", "index.ts")], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        MOON_HOSTED: "1",
        MOON_DATA_DIR: dir,
        MOON_PUBLIC_URL: site,
        MOON_USER_ID: p.id,
        MOON_USER_EMAIL: p.email,
        MOON_USER_NAME: p.name,
        GOOGLE_REDIRECT: `${site}/oauth/google/callback`,
        // Texting runs through the host's own line: never in a player's copy.
        PHOTON_PROJECT_ID: "",
        PHOTON_PROJECT_SECRET: "",
        SPECTRUM_PROJECT_ID: "",
        SPECTRUM_PROJECT_SECRET: "",
        PLAYER_PHONE: "",
        SESSION_SECRET: "",
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
    c = { port, proc, ready, lastUsed: Date.now(), sockets: 0 };
    copies.set(p.id, c);
    proc.on("exit", () => {
      if (copies.get(p.id)?.proc === proc) copies.delete(p.id);
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
}, 60_000);

// ---------------------------------------------------------------- passing things through

function proxy(req: IncomingMessage, res: ServerResponse, c: Copy, site: string) {
  c.lastUsed = Date.now();
  const headers = { ...req.headers, "x-forwarded-proto": site.startsWith("https") ? "https" : "http", "x-forwarded-host": String(req.headers.host ?? "") };
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

/** The game's live connection (WebSocket): straight through to the player's copy. */
function proxyUpgrade(req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer, c: Copy) {
  const up = tcp(c.port, "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  c.sockets++;
  let closed = false;
  const done = () => {
    if (closed) return;
    closed = true;
    c.sockets = Math.max(0, c.sockets - 1);
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
  if (!file.startsWith(CLIENT) || !existsSync(file) || !extname(file)) return false;
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
  <li><b>Delete everything</b> any time: in the game, Help → DELETE MY DATA. That removes your village, your connections and your account.</li>
</ul>
<p><a href="/">Back to the game</a></p>`,
  );
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
  if (url.pathname === "/auth/dev" && DEV_LOGIN) {
    const email = (url.searchParams.get("email") ?? "tester@example.com").slice(0, 80);
    const p = playerFor(`dev:${email}`, email, email.split("@")[0]);
    return redirect("/", newSession(req, p));
  }
  if (url.pathname === "/auth/logout") {
    // Signing out signs out everywhere: every tab, and any copied cookie.
    const p = whoIs(req);
    if (p) {
      p.epoch = (p.epoch ?? 0) + 1;
      savePlayers();
      void stopCopy(p.id); // open game tabs lose their connection and go back to sign-in
    }
    return redirect("/?signin=signedout", sessionCookie(req, "", 0));
  }
  // The title screen asks this before connecting: signed in, and as whom.
  if (url.pathname === "/auth/me") {
    const p = whoIs(req);
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(p ? { signedIn: true, name: p.name, email: p.email } : { signedIn: false }));
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
    } finally {
      deleting.delete(p.id);
    }
    console.log(`[gateway] deleted player ${p.id}`);
    return page(res, 200, "Deleted", `<h2>All gone</h2><p>Your village, its connections and your account are deleted from Fl-AI Me to the Moon.</p><p class="small">To also remove the game's access from your Google account: myaccount.google.com → Security → Third-party connections.</p><p><a href="/?signin=deleted">Back to the start</a></p>`, { "set-cookie": sessionCookie(req, "", 0) });
  }
  res.writeHead(404);
  res.end();
}

// ---------------------------------------------------------------- the server

/** The game server's own pages and endpoints (everything else is the built game). */
const GAME_PATHS = /^\/(voice|connect\/|oauth\/|setup\/|agents\/)/;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (url.pathname.startsWith("/auth/")) return await auth(req, res, url);
    if (url.pathname === "/privacy") return privacyPage(res);
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, players: Object.keys(players).length, running: copies.size }));
    }
    // The LINK script talks to a player's copy with its own code/token (no cookie on the command line).
    const bridge = url.pathname.match(/^\/bridge\/([\w]+)\//);
    if (bridge) {
      const p = Object.hasOwn(players, bridge[1]) ? players[bridge[1]] : null;
      if (!p) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "No village with that link. Press LINK in the game for a fresh command." }));
      }
      return proxy(req, res, await copyFor(p, req), siteUrl(req));
    }
    const p = whoIs(req);
    // Your village's own pages (connect Google, voices, ...) need you signed in; the title screen signs you in.
    if (GAME_PATHS.test(url.pathname)) {
      if (!p) {
        res.writeHead(302, { location: "/", "cache-control": "no-store" });
        return res.end();
      }
      return proxy(req, res, await copyFor(p, req), siteUrl(req));
    }
    // The game itself, for everyone (signed out, its title screen shows SIGN IN WITH GOOGLE).
    if (serveStatic(res, url.pathname)) {
      // Signed in: warm up their village while the game loads.
      if (p && url.pathname === "/") void copyFor(p, req).catch(() => null);
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
    proxyUpgrade(req, socket, head, await copyFor(p, req));
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
