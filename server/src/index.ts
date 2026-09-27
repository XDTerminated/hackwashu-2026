import { inStock, LANDMARKS } from "../../shared/town.js";
import { pathDef, pathKey, pathTileOk, type PathDef, type PathStyle } from "../../shared/paths.js";

/** Not stocked at the Market's current stage? */
const notStocked = (def: PathDef) => world.progress.town.stages.market < def.market;
import { ACCOUNT, HOSTED, hostAllowed, PUBLIC_URL, USER_ID } from "./env.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { BuildingId, ClientMessage, ServerMessage, Service, VillagerId } from "../../shared/game.js";
import { BUILDINGS, EXTENSIONS, moveInAt } from "../../shared/game.js";
import { BRAIN, startTask, lastApprovalVia } from "./agents.js";
import { chatText } from "./chat.js";
import { agentsState, bridgeBye, bridgeUpdate, newLinkCode, onAgentsChange, pairBridge, reportEvent, startAgentWatch, startReplay, stopReplay, unlink as unlinkBridge, useLinking } from "./agentwatch.js";
import { existsSync, readFileSync } from "node:fs";
import { askWorker, clearProject, initTeam, onTeamChange, providersChanged, reportPath, startProject, teamState } from "./team.js";
import { chooseModel, connectKey, disconnectKey, finishOpenRouter, openRouterAuthUrl, openRouterModels } from "./aikeys.js";
import { TEAM_PROVIDERS } from "../../shared/team.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { announceHappiness, happinessAll } from "./memory.js";
import { denyAllPending, resolveApproval } from "./approvals.js";
import { DEFAULT_CANVAS, canvasBase, connectCanvas, disconnectCanvas, initCanvas, searchSchools } from "./connectors/canvas.js";
import { canvasSignIn } from "./connectors/canvasLogin.js";
import { testConnections } from "./selftest.js";
import { checkGoogleClient, disconnectGoogle, finishGoogleAuth, finishGoogleSignin, forgetSignin, GOOGLE_REDIRECT, googleAuthUrl, googleConfigured, googleSigninUrl, initGoogle, setGoogleClient, takeGoogleFlow } from "./connectors/google.js";
import { connectGithub, connectGithubCli, disconnectGithub, initGithub } from "./connectors/github.js";
import { accessToken as spotifyToken, disconnectSpotify, finishSpotifyAuth, initSpotify, setDevice as setSpotifyDevice, setSpotifyClient, SPOTIFY_REDIRECT, spotifyAuthUrl, spotifyConfigured } from "./connectors/spotify.js";
import { onPhoneLinked, phoneLinked, photonReady, startLink, startPhoton, unlink } from "./photon.js";
import { clearChore, devSpawn, setChoreOptIn, setPresence, startChores } from "./chores.js";
import { handleVoice, voiceStatus, voiceSummary } from "./voice.js";
import * as services from "./services.js";
import { decorById, decorFootprint, sellPrice } from "../../shared/decor.js";
import { SHARD_COUNT, buildingTiles, canOccupy, snapToTiles } from "../../shared/layout.js";
import { currentRequests, startRequests } from "./requests.js";
import { arrive, chat as peerChat, depart, gift, greet, identify, internalRoute, isVisitor, moved, seesOffice, sendHome, thankGatherer, visitorSees, visitorSnapshot, visitorTalk, whenPermsChange, whoOf } from "./visits.js";
import { build, clearRock, isGuest, regrowRocks, resetWorld, setGuest, collectShard, shardsFound, emit, moveBuilding, moveDeco, moveLantern, newId, occupied, onEvent, placeDeco, popClod, removeDeco, savePersist, snapshot, switchWorld, world } from "./world.js";

const PORT = Number(process.env.PORT ?? 8787);
const VILLAGERS: VillagerId[] = ["jade_rabbit", "postmaster", "timekeeper", "scholar", "stargazer", "manager", "dj", "mechanic"];
const SERVICES: Service[] = ["google", "canvas", "spotify", "github"];

/** Anything from outside (a query string, an error, an account name) goes into a page through this. */
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const errText = (err: unknown) => esc(err instanceof Error ? err.message : err);

function page(res: ServerResponse, status: number, title: string, body: string) {
  // (these pages are plain HTML: no scripts, images or frames)
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" });
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:ui-monospace,monospace;background:#0b0a1a;color:#f4d9a6;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="max-width:560px;padding:24px;border:4px solid #8a4b1f;background:#1a1430;line-height:1.6">
<h2 style="color:#f2a3b8;margin-top:0">${title}</h2>${body}</div></body>`);
}

/** Online, a service the site's owner hasn't configured: say so (players can't set it up from a page). */
function notTurnedOn(res: ServerResponse, service: string, vars: string) {
  return page(res, 503, `${service} isn't turned on here yet`, `<p>This site's owner hasn't connected ${service} yet, so it can't be linked right now. Everything else in the game works.</p>
<p style="opacity:.75">Running this site? Add <code>${vars}</code> to the server's environment (README, Deploying) and redeploy.</p>`);
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  // On your computer: only when asked for by a name that means this computer (not a rebound one).
  if (!hostAllowed(req.headers.host)) {
    res.writeHead(421, { "content-type": "text/plain" });
    return res.end("Not here. (Playing over your network? Add this address to ALLOWED_HOSTS.)");
  }

  // A villager line to speak aloud in the talk dialog.
  if (url.pathname === "/voice") return handleVoice(req, res);

  // The Office's AI team, "Connect your AI": one-click OpenRouter sign-in (comes back here with a code).
  // (the AI team is the owner's: on your computer, only from this computer; online, the gateway only sends you to your own copy)
  if ((url.pathname === "/connect/openrouter" || url.pathname === "/oauth/openrouter/callback" || url.pathname.startsWith("/team/report/")) && !HOSTED && !isLocal(req.socket.remoteAddress))
    return page(res, 403, "Not here", "<p>Only the game on the colony's own computer can do that.</p>");
  if (url.pathname === "/connect/openrouter") {
    const base = PUBLIC_URL || `http://${req.headers.host}`;
    res.writeHead(302, { location: openRouterAuthUrl(`${base}/oauth/openrouter/callback`).url, "cache-control": "no-store" });
    return res.end();
  }
  if (url.pathname === "/oauth/openrouter/callback") {
    const code = url.searchParams.get("code");
    if (!code) return page(res, 400, "Sign-in cancelled", "<p>No code from OpenRouter. You can close this tab.</p>");
    try {
      // (only a sign-in this server started, and only once)
      await finishOpenRouter(code, url.searchParams.get("state"));
      await providersChanged();
      return page(res, 200, "Your AI is connected! 🚀", "<p>The Office's team can use your OpenRouter account now. Close this tab, pick a model on the project board, and brief your team.</p>");
    } catch (err) {
      console.error("[openrouter] sign-in failed:", err);
      return page(res, 500, "Sign-in failed", `<p>${err instanceof Error ? err.message.replace(/[<>&"]/g, "") : "Unknown error"}</p>`);
    }
  }
  // A finished project's deliverable, to read in a browser tab.
  if (url.pathname.startsWith("/team/report/")) {
    const file = reportPath(url.pathname.slice("/team/report/".length));
    if (!file || !existsSync(file)) return page(res, 404, "No such report", "<p>That project's report isn't here.</p>");
    const text = readFileSync(file, "utf8").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return page(res, 200, "Project report", `<pre style="white-space:pre-wrap;font:14px/1.5 ui-monospace,Menlo,monospace;color:#f2e6cc">${text}</pre>`);
  }

  // Online: the gateway's notes (a friend's coins, a question for a neighbor, "send Sam home").
  if (url.pathname.startsWith("/internal/")) return internalRoute(req, res, url);

  // Hosted: the LINK script on the player's own computer reports their Claude Code here.
  if (HOSTED && url.pathname.startsWith("/bridge/")) return bridgeRoute(req, res, url);

  // Other coding tools can put their agents in the Office (from this computer only).
  if (url.pathname === "/agents/event") {
    if (HOSTED || !isLocal(req.socket.remoteAddress)) return page(res, 403, "Not here", "<p>Only tools on this computer can report agents.</p>");
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "POST a JSON event" }));
    }
    // Tools, not web pages: a browser always says where a page came from, and can't send JSON cross-site without asking.
    if (req.headers.origin || !/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      res.writeHead(403, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "send content-type: application/json, from a tool (not a web page)" }));
    }
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 64 * 1024) break;
    }
    let problem: string | null;
    try {
      problem = reportEvent(JSON.parse(raw));
    } catch {
      problem = "that isn't JSON";
    }
    res.writeHead(problem ? 400 : 200, { "content-type": "application/json" });
    return res.end(JSON.stringify(problem ? { ok: false, error: problem } : { ok: true }));
  }

  // Echo's Spotify: one-time host setup, then each player signs in (like Google).
  if (url.pathname === "/setup/spotify") {
    if (HOSTED) return notTurnedOn(res, "Spotify", "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET");
    if (!isLocal(req.socket.remoteAddress)) return page(res, 403, "Not here", "<p>Spotify can only be set up from the computer running the colony.</p>");
    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return page(res, 403, "Not here", "<p>That form has to come from this page.</p>");
      const raw = await readBody(req, 4096);
      if (raw === null) return page(res, 413, "Too long", "<p>That's more than a Client ID and secret.</p>");
      const form = new URLSearchParams(raw);
      try {
        setSpotifyClient(form.get("id") ?? "", form.get("secret") ?? "");
      } catch (err) {
        return page(res, 400, "Almost", `<p>${errText(err)}</p><p><a style="color:#f5c542" href="/setup/spotify">Try again</a></p>`);
      }
      services.announceConnections();
      return page(res, 200, "Spotify is ready", `<p>Saved (privately, on this computer). Talk to Echo in the game and press <b>CONNECT SPOTIFY</b>, or:</p>
<p><a style="color:#f5c542;font-size:1.1em" href="/connect/spotify">Sign in with Spotify now →</a></p>`);
    }
    const step = (n: number, html: string) => `<li style="margin:0 0 14px"><b style="color:#f2a3b8">${n}.</b> ${html}</li>`;
    const link = (href: string, text: string) => `<a style="color:#f5c542" target="_blank" rel="noopener" href="${href}">${text}</a>`;
    return page(res, 200, "Set up Spotify for Echo", `<p>Do this once and Echo the DJ can play your Spotify right in the game. About 3 minutes. (Playing inside another app needs <b>Spotify Premium</b>.)</p>
<ol style="list-style:none;padding:0">
${step(1, `Open the ${link("https://developer.spotify.com/dashboard", "Spotify Developer Dashboard")} and log in with your Spotify account.`)}
${step(2, `<b>Create app</b>: name "Fl-AI Me to the Moon", any description, and under Redirect URIs add<br><code style="user-select:all;background:#0b0a1a;padding:2px 6px">${SPOTIFY_REDIRECT}</code><br>Tick <b>Web API</b> and <b>Web Playback SDK</b>, agree, and Save.`)}
${step(3, `On the app's <b>Settings</b> page, copy the Client ID, press <b>View client secret</b>, and paste both below.`)}
${step(4, `While the app is in Development mode, only people you add can sign in: <b>User Management</b> → add the email of each Spotify account that will play (yours included).`)}
</ol>
<form method="post" style="display:grid;gap:8px">
<label>Client ID<br><input name="id" required style="width:100%;padding:6px;font:inherit" placeholder="32 letters and numbers"></label>
<label>Client secret<br><input name="secret" type="password" required style="width:100%;padding:6px;font:inherit" placeholder="32 letters and numbers"></label>
<button style="padding:8px;font:inherit;background:#5aa860;color:#fff;border:0;cursor:pointer">Save and turn on Spotify</button>
</form>
<p style="opacity:.7;font-size:.9em">Stored in <code>server/data/spotify-client.json</code> (only readable by you), never sent to the game.</p>`);
  }
  if (url.pathname === "/connect/spotify") {
    if (!spotifyConfigured() && HOSTED) return notTurnedOn(res, "Spotify", "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET");
    res.writeHead(302, { location: spotifyConfigured() ? spotifyAuthUrl() : "/setup/spotify" });
    return res.end();
  }
  if (url.pathname === "/oauth/spotify/callback") {
    const code = url.searchParams.get("code");
    if (!code) return page(res, 400, "Sign-in cancelled", `<p>${esc(url.searchParams.get("error") ?? "No code from Spotify.")} You can close this tab.</p>`);
    try {
      const account = await finishSpotifyAuth(code, url.searchParams.get("state"));
      services.announceConnections();
      return page(res, 200, "Connected! 🎧", `<p>Echo can play <b>${esc(account ?? "your Spotify")}</b> now. Close this tab, head back to the Moon, and ask Echo for a song.</p>`);
    } catch (err) {
      console.error("[spotify] sign-in failed:", err);
      return page(res, 500, "Sign-in failed", `<p>${err instanceof Error ? esc(err.message) : "Unknown error"}</p><p>If it says the user isn't registered, add your Spotify email under User Management in your app on the Spotify Developer Dashboard.</p>`);
    }
  }
  // The game's own Spotify player asks for a fresh token here (only the game itself may read it).
  if (url.pathname === "/spotify/token") {
    const origin = req.headers.origin;
    const allowed = !origin || originAllowed(origin, req.headers.host);
    if (!allowed || (!HOSTED && !isLocal(req.socket.remoteAddress))) return page(res, 403, "Not here", "<p>Only the game can ask for that.</p>");
    const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
    if (origin) Object.assign(headers, { "access-control-allow-origin": origin, vary: "origin" });
    try {
      const access_token = await spotifyToken();
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ access_token }));
    } catch (err) {
      res.writeHead(409, headers);
      return res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }

  // One-time host setup for "Sign in with Google" (only from this computer).
  if (url.pathname === "/setup/google") {
    // The hosted game's Google app is set by whoever runs the site, not from a page.
    if (HOSTED) return notTurnedOn(res, "Google (Gmail + Calendar)", "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
    if (!isLocal(req.socket.remoteAddress)) return page(res, 403, "Not here", "<p>Google sign-in can only be set up from the computer running the colony.</p>");
    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return page(res, 403, "Not here", "<p>That form has to come from this page.</p>");
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) return page(res, 413, "Too long", "<p>That's more than a Client ID and secret.</p>");
      }
      const form = new URLSearchParams(raw);
      try {
        setGoogleClient(form.get("id") ?? "", form.get("secret") ?? "");
      } catch (err) {
        return page(res, 400, "Almost", `<p>${errText(err)}</p><p><a style="color:#f5c542" href="/setup/google">Try again</a></p>`);
      }
      services.announceConnections();
      return page(res, 200, "Google sign-in is ready", `<p>Saved (privately, on this computer). Players can now press <b>CONNECT GOOGLE</b> in the game and sign in with their own account.</p>
<p><a style="color:#f5c542;font-size:1.1em" href="/connect/google">Sign in with Google now →</a></p>
<p style="opacity:.75">Until Google verifies the app, players see a "Google hasn't verified this app" screen: Advanced → Go to Fl-AI Me to the Moon continues.</p>`);
    }
    const step = (n: number, html: string) => `<li style="margin:0 0 14px"><b style="color:#f2a3b8">${n}.</b> ${html}</li>`;
    const link = (href: string, text: string) => `<a style="color:#f5c542" target="_blank" rel="noopener" href="${href}">${text}</a>`;
    return page(res, 200, "Set up Google sign-in", `<p>Do this once, as the host, and every player can sign in with their own Google account. About 5 minutes.</p>
<ol style="list-style:none;padding:0">
${step(1, `${link("https://console.cloud.google.com/projectcreate", "Create a Google Cloud project")} (name it "Fl-AI Me to the Moon").`)}
${step(2, `In that project, turn on the ${link("https://console.cloud.google.com/apis/library/gmail.googleapis.com", "Gmail API")} and the ${link("https://console.cloud.google.com/apis/library/calendar-json.googleapis.com", "Google Calendar API")} (press Enable on each).`)}
${step(3, `Open ${link("https://console.cloud.google.com/auth/overview", "Google Auth Platform")} → Get started: app name "Fl-AI Me to the Moon", your email, Audience <b>External</b>.`)}
${step(4, `${link("https://console.cloud.google.com/auth/audience", "Audience")} → <b>Publish app</b>, so anyone can sign in with their own Google account.`)}
${step(5, `${link("https://console.cloud.google.com/auth/clients/create", "Clients → Create client")}: type <b>Web application</b>, and under Authorized redirect URIs add<br><code style="user-select:all;background:#0b0a1a;padding:2px 6px">${GOOGLE_REDIRECT}</code><br>Create, then copy the Client ID and Client secret into the boxes below.`)}
</ol>
<form method="post" style="display:grid;gap:8px">
<label>Client ID<br><input name="id" required style="width:100%;padding:6px;font:inherit" placeholder="1234-abc.apps.googleusercontent.com"></label>
<label>Client secret<br><input name="secret" type="password" required style="width:100%;padding:6px;font:inherit" placeholder="GOCSPX-..."></label>
<button style="padding:8px;font:inherit;background:#5aa860;color:#fff;border:0;cursor:pointer">Save and turn on Google sign-in</button>
</form>
<p style="opacity:.7;font-size:.9em">Stored in <code>server/data/google-client.json</code> (only readable by you), never sent to the game.</p>`);
  }

  // The title screen's sign-in: just who you are (no Gmail or Calendar, so no "unverified app" warning).
  if (url.pathname === "/signin/google") {
    res.writeHead(302, { location: googleConfigured() ? await googleSigninUrl() : "/setup/google" });
    return res.end();
  }

  // Google sign-in: the game opens this in a new tab.
  if (url.pathname === "/connect/google") {
    if (!googleConfigured()) {
      if (HOSTED) return notTurnedOn(res, "Google (Gmail + Calendar)", "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
      // Not set up yet: send the host to the setup page instead of a dead end.
      res.writeHead(302, { location: "/setup/google" });
      return res.end();
    }
    // Set up, but wrong somewhere? Say exactly what to fix instead of Google's error page.
    const check = await checkGoogleClient();
    if (!check.ok) return page(res, 200, "One thing to fix", `<p>${check.problem}</p><p>${check.fix}</p><p><a style="color:#f5c542" target="_blank" rel="noopener" href="https://console.cloud.google.com/auth/clients">Open your OAuth clients →</a> &nbsp; <a style="color:#f5c542" href="/connect/google">Try again</a></p>`);
    res.writeHead(302, { location: await googleAuthUrl() });
    return res.end();
  }
  if (url.pathname === "/oauth/google/callback") {
    const code = url.searchParams.get("code");
    if (!code) return page(res, 400, "Sign-in cancelled", `<p>${esc(url.searchParams.get("error") ?? "No code from Google.")} You can close this tab.</p>`);
    // (only a sign-in this server started, in the last 10 minutes, and only once)
    const flow = takeGoogleFlow(url.searchParams.get("state"));
    if (!flow) return page(res, 400, "Sign-in expired", "<p>That sign-in link is stale or wasn't started here. Press the sign-in button in the game again.</p>");
    if (flow.kind === "signin") {
      try {
        const me = await finishGoogleSignin(code, flow.verifier);
        services.announceConnections();
        return page(res, 200, "Signed in! 🌙", `<p>Welcome, <b>${esc(me.name)}</b>. Close this tab and press PLAY.</p>`);
      } catch (err) {
        console.error("[google] sign-in failed:", err);
        return page(res, 500, "Sign-in failed", `<p>${err instanceof Error ? esc(err.message) : "Unknown error"}</p>`);
      }
    }
    try {
      const account = await finishGoogleAuth(code, flow.verifier);
      services.announceConnections();
      return page(res, 200, "Connected! 🚀", `<p>The colony can now reach <b>${esc(account ?? "your Google account")}</b>. Close this tab and head back to the Moon — someone's rocket is landing.</p>`);
    } catch (err) {
      console.error("[google] sign-in failed:", err);
      return page(res, 500, "Sign-in failed", `<p>${err instanceof Error ? esc(err.message) : "Unknown error"}</p>`);
    }
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "moon-village", brain: BRAIN, voice: voiceStatus(), photon: photonReady(), connections: services.connections(), seq: world.seq }));
});

/** A building id from the game (not "__proto__", an array, ...). */
const isBuilding = (b: unknown): b is BuildingId => typeof b === "string" && Object.hasOwn(BUILDINGS, b);

const isLocal = (addr: string | undefined) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(addr ?? "");

// Only the game itself may connect: without this, any web page open in the
// player's browser could talk to ws://localhost and answer their letters.
function originAllowed(origin: string | undefined, host: string | undefined) {
  if (!origin) return true; // not a browser (tests, CLI)
  try {
    const from = new URL(origin).hostname;
    const self = new URL(`http://${host ?? "localhost"}`).hostname;
    return from === self || ["localhost", "127.0.0.1", "[::1]"].includes(from);
  } catch {
    return false;
  }
}

// (online, only the gateway can say who's connecting: anyone else is turned away)
// (no message from the game comes near 256 KB: a bigger one is someone trying to fill up memory)
const wss = new WebSocketServer({ server: httpServer, maxPayload: 256 * 1024, verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) => hostAllowed(req.headers.host) && originAllowed(origin, req.headers.host) && !!identify(req) });

process.on("unhandledRejection", (err) => console.error("[server] unhandled:", err));
// Your coding agents' work (code, commands, output) only goes to a game
// running on this same computer, never to another device on the network.
const localClients = new WeakSet<WebSocket>();
onAgentsChange((state) => {
  // (a visiting friend sees the Office only if the owner said so)
  for (const c of wss.clients) if (localClients.has(c) || (isVisitor(c) && seesOffice(c))) send(c, { type: "agents", state });
});
// The AI team is the owner's (their keys, their projects): never sent to visitors.
onTeamChange((state) => {
  for (const c of wss.clients) if (localClients.has(c)) send(c, { type: "team", state });
});
whenPermsChange((ws) => send(ws, { type: "agents", state: seesOffice(ws) ? agentsState() : { watching: null, link: null, sessions: [] } }));
// On your computer the Office watches your Claude Code directly; hosted, you link it (bridgeRoute).
if (HOSTED) useLinking(() => wss.clients.size > 0);
else startAgentWatch();

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** The island, as this connection may see it (a visitor never sees the owner's letters, agents' work or accounts). */
function snapshotFor(ws: WebSocket) {
  return isVisitor(ws) ? visitorSnapshot(fullSnapshot()) : fullSnapshot();
}
function snapshotAll() {
  for (const c of wss.clients) send(c, { type: "snapshot", snapshot: snapshotFor(c) });
}

function fullSnapshot() {
  return {
    ...snapshot(),
    requests: currentRequests(),
    account: ACCOUNT,
    phoneLinked: phoneLinked(),
    connections: services.connections(),
    residents: services.residents(),
    rabbitTeamwork: services.rabbitTeamwork(),
  };
}

// What villagers do with your accounts (their thinking, tool results, letters, texts) only goes to
// the game on this computer too; everyone sees the village itself change.
const PRIVATE_EVENTS = new Set<string>(["task_start", "think", "say", "handoff", "tool_start", "tool_end", "approval_needed", "approval_resolved", "building_error", "task_done", "phone", "text", "connections", "music"]);
onEvent((event) => {
  const secret = PRIVATE_EVENTS.has(event.type);
  // (private events only reach the owner at home; visitors see only what visitorSees allows)
  for (const c of wss.clients) if ((!secret || localClients.has(c)) && (!isVisitor(c) || visitorSees(event))) send(c, { type: "event", event });
});

/** Messages that use (or change) your connected accounts: only from the game on this computer, or your own copy online. */
const ACCOUNT_MESSAGES = new Set<string>(["team_start", "team_ask", "team_clear", "team_key", "team_disconnect", "team_model", "task", "approve", "connect_github", "github_cli", "connect_canvas", "canvas_login", "disconnect", "dev_mode", "phone_link_start", "phone_unlink", "test_connections", "use_sandbox", "spotify_device", "set_chore_optin"]);

// Every 20 seconds, everyone gets a ping; a connection that didn't answer the last one
// is gone (a closed laptop, a page the browser never properly left): drop it, so it
// doesn't stay on the island as a frozen player.
const answered = new WeakMap<WebSocket, boolean>();
setInterval(() => {
  for (const c of wss.clients) {
    if (answered.get(c) === false) {
      c.terminate();
      continue;
    }
    answered.set(c, false);
    c.ping();
  }
}, 20_000);

wss.on("connection", (ws, req) => {
  answered.set(ws, true);
  ws.on("pong", () => answered.set(ws, true));
  // (a bad frame, e.g. one over maxPayload, errors this socket only: ws closes it; unhandled, it would take the island down)
  ws.on("error", (err) => console.log(`[ws] dropped a connection: ${err.message}`));
  const who = identify(req)!;
  console.log(who.role === "visitor" ? `[ws] ${who.name} is visiting` : "[ws] game connected");
  bases.set(ws, `${String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0]}://${req.headers.host}`);
  arrive(ws, who);
  // Hosted, the gateway says who's the owner (friends visiting aren't); on your computer, it's whoever's on it.
  if (who.role === "owner" && (HOSTED || isLocal(req.socket.remoteAddress))) localClients.add(ws);
  setPresence(wss.clients.size);

  ws.on("message", async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") return;
    try {
      await handle(ws, msg);
    } catch (err) {
      console.error(`[ws] ${msg.type} failed:`, err);
      send(ws, { type: "notice", text: "Something went wrong there. Try again?" });
    }
  });

  ws.on("close", () => {
    depart(ws);
    console.log(who.role === "visitor" ? `[ws] ${who.name} left` : "[ws] game disconnected");
    setPresence(wss.clients.size);
  });
});

/** What a friend visiting may do here: walk, chat, talk to the neighbors, help gather, leave gifts. Nothing else. */
async function visitorHandle(ws: WebSocket, msg: ClientMessage) {
  switch (msg.type) {
    case "hello":
      send(ws, { type: "snapshot", snapshot: snapshotFor(ws) });
      if (seesOffice(ws)) send(ws, { type: "agents", state: agentsState() });
      greet(ws);
      break;
    case "pos":
      moved(ws, msg);
      break;
    case "peer_chat":
      peerChat(ws, msg.text);
      break;
    case "task":
      if (VILLAGERS.includes(msg.villager) && typeof msg.text === "string" && msg.text.trim()) void visitorTalk(ws, msg.villager, msg.text);
      break;
    case "gift": {
      const problem = await gift(ws, msg);
      if (problem) send(ws, { type: "notice", text: problem });
      break;
    }
    case "clear_rock": {
      // Moonstone stays on this island; what they found (and a thank-you coin) goes home with them.
      const [x, y] = [Math.round(Number(msg.x)), Math.round(Number(msg.y))];
      const r = clearRock(x, y);
      if (!r.ok) return send(ws, { type: "notice", text: r.reason });
      const found = r.loot?.coins ?? 0;
      world.coins -= found;
      savePersist();
      emit({ type: "rock_cleared", x, y, stone: r.stone, coins: world.coins, ...(r.loot ? { loot: r.loot } : {}) });
      services.announceProgress();
      void thankGatherer(ws, 1 + found);
      break;
    }
    case "clear_chore": {
      const r = clearChore(String(msg.id));
      if (!r.ok) break;
      world.coins -= r.reward;
      savePersist();
      emit({ type: "chore_cleared", id: msg.id, kind: r.kind, reward: r.reward, coins: world.coins });
      services.gain(r.kind === "dust" ? { stardust: 2 } : { moonstone: 1, ore: 1 }, { x: r.x, y: r.y });
      void thankGatherer(ws, r.reward);
      break;
    }
    default:
      // (the owner's to do: building, letters, connections, ...)
      break;
  }
}

async function handle(ws: WebSocket, msg: ClientMessage) {
    if (isVisitor(ws)) return visitorHandle(ws, msg);
    if (ACCOUNT_MESSAGES.has(msg.type) && !localClients.has(ws)) {
      send(ws, { type: "notice", text: "Only the game on the colony's own computer can do that." });
      return;
    }
    switch (msg.type) {
      case "hello":
        send(ws, { type: "snapshot", snapshot: fullSnapshot() });
        if (localClients.has(ws)) {
          send(ws, { type: "agents", state: agentsState() });
          send(ws, { type: "team", state: teamState() });
        }
        greet(ws);
        break;

      case "team_start": {
        const problem = startProject(String(msg.brief ?? ""), msg.provider);
        if (problem) send(ws, { type: "notice", text: problem });
        break;
      }

      case "team_ask": {
        const text = await askWorker(String(msg.workerId), String(msg.question ?? ""));
        send(ws, { type: "team_answer", workerId: String(msg.workerId), text });
        break;
      }

      case "team_clear": {
        const problem = clearProject();
        if (problem) send(ws, { type: "notice", text: problem });
        break;
      }

      case "team_key": {
        if (!TEAM_PROVIDERS.includes(msg.provider)) break;
        try {
          const masked = await connectKey(msg.provider, String(msg.key ?? ""));
          await providersChanged();
          send(ws, { type: "notice", text: `Connected (${masked}). Your team can use it now.`, tone: "ok" });
        } catch (err) {
          send(ws, { type: "notice", text: `Couldn't connect: ${err instanceof Error ? err.message : err}.` });
        }
        break;
      }

      case "team_disconnect":
        if (!TEAM_PROVIDERS.includes(msg.provider)) break;
        disconnectKey(msg.provider);
        await providersChanged();
        break;

      case "team_model": {
        if (msg.provider !== "openrouter" || typeof msg.model !== "string") break;
        if (!(await openRouterModels()).includes(msg.model)) break;
        chooseModel("openrouter", msg.model);
        await providersChanged();
        break;
      }

      case "pos":
        moved(ws, msg);
        break;

      case "peer_chat":
        peerChat(ws, msg.text);
        break;

      case "kick":
        if (HOSTED && localClients.has(ws)) sendHome(String(msg.id), `${whoOf(ws)?.name ?? "The owner"} sent you home.`);
        break;

      case "landed":
        // (joining the game doesn't text your phone; texts are for news and approvals)
        break;

      case "task":
        if (VILLAGERS.includes(msg.villager) && typeof msg.text === "string" && msg.text.trim()) {
          const text = msg.text.trim().slice(0, 2000);
          // MoonPad texts are chats; real work happens when you visit in person.
          if (msg.via === "moonpad") void chatText(msg.villager, text, "moonpad");
          else void startTask(msg.villager, text, "game");
        }
        break;

      case "approve": {
        const a = resolveApproval(msg.approvalId, !!msg.approved);
        if (a) lastApprovalVia.set(a.id, "game");
        else send(ws, { type: "notice", text: "That letter was already answered." });
        break;
      }

      case "pop": {
        const r = popClod(msg.clodId);
        if (r.ok) emit({ type: "clod_popped", clodId: msg.clodId, reward: r.reward, coins: world.coins });
        break;
      }

      case "build": {
        if (!isBuilding(msg.building)) break;
        // Extensions (the Mail Rocket, the Workshop) take materials, once their neighbor lives here.
        if (EXTENSIONS[msg.building]) {
          const problem = services.buildExtension(msg.building);
          if (problem) send(ws, { type: "notice", text: problem });
          break;
        }
        // Neighbors' houses (Ada's Office too) go up on the plots you buy at the Town Hall.
        if (moveInAt(msg.building)) {
          send(ws, { type: "notice", text: "Buy their plot at the Town Hall, set it down, and build it there." });
          break;
        }
        const r = build(msg.building);
        if (r.ok) {
          emit({ type: "building_built", building: msg.building, coins: world.coins });
        } else send(ws, { type: "notice", text: r.reason });
        break;
      }

      case "upgrade": {
        if (!(typeof msg.landmark === "string" && Object.hasOwn(LANDMARKS, msg.landmark))) break;
        const problem = services.upgradeLandmark(msg.landmark);
        if (problem) send(ws, { type: "notice", text: problem });
        break;
      }

      case "harvest": {
        const problem = services.harvest(String(msg.id));
        if (problem) send(ws, { type: "notice", text: problem });
        break;
      }

      case "dig": {
        const problem = services.dig(String(msg.id));
        if (problem) send(ws, { type: "notice", text: problem });
        break;
      }

      case "buy_plot":
      case "place_plot":
      case "build_plot": {
        if (!isBuilding(msg.building)) break;
        const problem =
          msg.type === "buy_plot" ? services.buyPlot(msg.building) : msg.type === "place_plot" ? services.placePlot(msg.building, Number(msg.x), Number(msg.y)) : services.buildPlot(msg.building);
        if (problem) send(ws, { type: "notice", text: problem });
        break;
      }

      case "connect_github":
      case "github_cli": {
        try {
          const who = msg.type === "github_cli" ? await connectGithubCli() : await connectGithub(String(msg.token ?? ""));
          services.announceConnections();
          send(ws, { type: "notice", text: `GitHub connected as ${who}. Tinker can look at your repos now.`, tone: "ok" });
        } catch (err) {
          send(ws, { type: "notice", text: err instanceof Error ? err.message : String(err) });
        }
        break;
      }

      case "spotify_device":
        if (typeof msg.id === "string" && msg.id) setSpotifyDevice(msg.id);
        break;

      case "place_deco": {
        const before = happinessAll();
        const def = decorById(String(msg.item));
        if (!def || !Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) break;
        if (!inStock(world.progress.town.stages.market, def)) {
          send(ws, { type: "notice", text: "The Market doesn't stock that yet. Upgrade it for more." });
          break;
        }
        const { x, y } = snapToTiles(Number(msg.x), Number(msg.y), def.tiles[0]);
        if (!canOccupy(decorFootprint(def, x, y), occupied())) {
          send(ws, { type: "notice", text: "Something's already on those tiles." });
          break;
        }
        const deco = { id: newId("deco"), item: def.id, x, y };
        const r = placeDeco(deco, def.price);
        if (r.ok) {
          emit({ type: "deco_placed", deco, coins: world.coins });
          announceHappiness(before, def.name);
        }
        else send(ws, { type: "notice", text: r.reason });
        break;
      }

      case "move_deco": {
        const before = happinessAll();
        const placed = world.decos.find((d) => d.id === msg.id);
        const def = placed && decorById(placed.item);
        if (!placed || !def || !Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) break;
        const { x, y } = snapToTiles(Number(msg.x), Number(msg.y), def.tiles[0]);
        if (canOccupy(decorFootprint(def, x, y), occupied({ deco: placed.id })) && moveDeco(placed.id, x, y)) {
          emit({ type: "deco_moved", id: placed.id, x, y });
          // (a move isn't a new decoration, so it doesn't count toward "decorate" requests)
          announceHappiness(before);
        } else send(ws, { type: "notice", text: "That spot's taken." });
        break;
      }

      case "clear_rock": {
        const [x, y] = [Math.round(Number(msg.x)), Math.round(Number(msg.y))];
        const r = clearRock(x, y);
        if (r.ok) {
          emit({ type: "rock_cleared", x, y, stone: r.stone, coins: world.coins, ...(r.loot ? { loot: r.loot } : {}) });
          services.announceProgress();
        } else send(ws, { type: "notice", text: r.reason });
        break;
      }

      case "collect_shard": {
        const [x, y] = [Math.round(Number(msg.x)), Math.round(Number(msg.y))];
        const r = collectShard(x, y);
        if (r.ok) {
          emit({ type: "shard_found", x, y, found: shardsFound(), total: SHARD_COUNT, reward: r.reward, coins: world.coins, ...(r.bonus ? { bonus: r.bonus } : {}) });
          services.announceProgress({ shard: 1 }, { x, y });
        }
        break;
      }

      case "move_lantern": {
        if (!Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) break;
        const { x, y } = snapToTiles(Number(msg.x), Number(msg.y), 1);
        if (moveLantern(String(msg.id), x, y)) emit({ type: "lantern_moved", id: msg.id, x, y });
        else send(ws, { type: "notice", text: "That spot's taken." });
        break;
      }

      case "move_building": {
        const b = msg.building;
        if (!isBuilding(b) || !Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) break;
        const { x, y } = snapToTiles(Number(msg.x), Number(msg.y), buildingTiles(b).w);
        const before = happinessAll();
        if (moveBuilding(b, x, y)) {
          emit({ type: "building_moved", building: b, x, y });
          announceHappiness(before);
        }
        else send(ws, { type: "notice", text: "The building doesn't fit there." });
        break;
      }

      case "office_link": {
        if (!HOSTED || !localClients.has(ws)) break;
        if (!msg.on) unlinkBridge();
        else newLinkCode((code) => `curl -fsSL ${bridgeBase(ws)}/script | node - ${code}`);
        break;
      }

      case "agents_replay": {
        if (!localClients.has(ws)) break;
        if (!msg.on) stopReplay();
        else {
          const problem = startReplay();
          if (problem) send(ws, { type: "notice", text: problem });
        }
        break;
      }

      case "dev_mode": {
        if (isGuest()) {
          send(ws, { type: "notice", text: "Dev mode isn't available while playing as a guest." });
          break;
        }
        // Open letters belong to the save being left: answer them "no" so nobody waits forever.
        denyAllPending();
        if (!switchWorld(!!msg.on)) break;
        services.initResidents();
        snapshotAll();
        break;
      }

      case "guest_mode": {
        // On your own computer only: online, a guest gets a throwaway copy of their own.
        if (HOSTED || !localClients.has(ws)) break;
        denyAllPending();
        if (!setGuest(!!msg.on)) break;
        services.initResidents();
        snapshotAll();
        break;
      }

      case "forget_me":
        if (!localClients.has(ws)) break;
        forgetSignin();
        services.announceConnections();
        break;

      case "intro_seen":
        world.introSeen = true;
        savePersist();
        break;

      case "reset_world": {
        // (only from the game on this computer, or your own copy online)
        if (!localClients.has(ws)) break;
        denyAllPending();
        resetWorld();
        services.initResidents();
        snapshotAll();
        break;
      }

      case "paint_paths": {
        // Pave (or take up) a stroke of tiles: each costs its path's price, given back when it comes up.
        const def = msg.style === null ? null : pathDef(msg.style);
        if ((msg.style !== null && !def) || !Array.isArray(msg.tiles)) break;
        const set: Record<string, PathStyle | null> = {};
        let short = false;
        const stocked = !def || !notStocked(def);
        if (def && !stocked) send(ws, { type: "notice", text: `${def.name}: not in stock yet (${def.market === 1 ? "repair" : "upgrade"} the Market${def.market === 1 ? "" : " to grand"}).` });
        for (const t of stocked ? msg.tiles.slice(0, 400) : []) {
          if (!Array.isArray(t)) continue;
          const [tx, ty] = [Number(t[0]), Number(t[1])];
          const key = pathKey(tx, ty);
          const was = Object.hasOwn(world.paths, key) ? world.paths[key] : undefined;
          if ((was ?? null) === (def?.id ?? null) || !pathTileOk(tx, ty, world.buildings)) continue;
          const refund = was ? (pathDef(was)?.price ?? 0) : 0;
          const cost = (def?.price ?? 0) - refund;
          if (cost > world.coins) {
            short = true;
            continue;
          }
          world.coins -= cost;
          if (def) world.paths[key] = def.id;
          else delete world.paths[key];
          set[key] = def?.id ?? null;
        }
        if (short) send(ws, { type: "notice", text: `Not enough coins for more ${def?.name ?? "path"}.` });
        // (every tile asked about comes back, so the game can undo the ones that didn't go down)
        for (const t of msg.tiles.slice(0, 400)) if (Array.isArray(t)) {
          const key = pathKey(Number(t[0]), Number(t[1]));
          if (!(key in set)) set[key] = Object.hasOwn(world.paths, key) ? world.paths[key] : null;
        }
        savePersist();
        emit({ type: "paths", set, coins: world.coins });
        break;
      }

      case "toggle_deco": {
        const placed = world.decos.find((d) => d.id === msg.id);
        if (!placed || !decorById(placed.item)?.light) break;
        placed.off = !placed.off;
        savePersist();
        emit({ type: "deco_toggled", id: placed.id, off: placed.off });
        break;
      }

      case "sell_deco": {
        const before = happinessAll();
        const placed = world.decos.find((d) => d.id === msg.id);
        const def = placed && decorById(placed.item);
        const refund = def ? sellPrice(def) : 0;
        if (placed && removeDeco(placed.id, refund)) {
          emit({ type: "deco_sold", id: placed.id, refund, coins: world.coins });
          announceHappiness(before);
        }
        break;
      }

      case "connect_canvas": {
        try {
          const who = await connectCanvas(String(msg.token ?? ""), canvasBase(msg.baseUrl) ?? undefined);
          services.announceConnections();
          send(ws, { type: "notice", text: `Canvas connected as ${who}.`, tone: "ok" });
        } catch (err) {
          send(ws, { type: "notice", text: `Canvas didn't accept that: ${err instanceof Error ? err.message : err}` });
        }
        break;
      }

      case "canvas_login": {
        if (HOSTED) {
          send(ws, { type: "notice", text: "Online, Mabel needs an access token: press GET A TOKEN, make one in Canvas, and paste it in." });
          break;
        }
        const base = canvasBase(msg.domain) ?? DEFAULT_CANVAS;
        send(ws, { type: "notice", text: "A Canvas window is opening: sign in with your school account. It closes by itself when you're done." });
        void canvasSignIn(base, { onStatus: (text) => send(ws, { type: "notice", text }) })
          .then(async ({ token, base: signedInAt }) => {
            const who = await connectCanvas(token, signedInAt);
            services.announceConnections();
            for (const c of wss.clients) if (localClients.has(c)) send(c, { type: "notice", text: `Canvas connected as ${who}. Mabel can read your courses now.`, tone: "ok" });
          })
          .catch((err) => send(ws, { type: "notice", text: `Canvas sign-in didn't finish: ${err instanceof Error ? err.message : err}` }));
        break;
      }

      case "test_connections":
        send(ws, { type: "connection_test", results: await testConnections() });
        break;

      case "canvas_schools": {
        try {
          send(ws, { type: "canvas_schools", query: String(msg.query ?? ""), schools: await searchSchools(String(msg.query ?? "")) });
        } catch (err) {
          send(ws, { type: "canvas_schools", query: String(msg.query ?? ""), schools: [], error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }

      case "use_sandbox":
        if (SERVICES.includes(msg.service)) services.chooseSandbox(msg.service);
        break;

      case "phone_link_start": {
        const r = await startLink(String(msg.phone ?? ""));
        send(ws, { type: "phone_link", state: r.ok ? "awaiting_text" : "error", text: r.text, line: r.line, code: r.code, link: r.link });
        break;
      }

      case "phone_unlink":
        unlink(String(msg.id ?? ""));
        break;

      case "clear_chore": {
        const r = clearChore(String(msg.id));
        if (r.ok) {
          emit({ type: "chore_cleared", id: msg.id, kind: r.kind, reward: r.reward, coins: world.coins });
          // Sweeping turns up stardust; a fallen meteor is a chunk of moonstone with a vein of glow ore.
          services.gain(r.kind === "dust" ? { stardust: 2 } : { moonstone: 1, ore: 1 }, { x: r.x, y: r.y });
        } else send(ws, { type: "notice", text: r.reason });
        break;
      }

      case "set_chore_optin":
        if (VILLAGERS.includes(msg.villager)) setChoreOptIn(msg.villager, !!msg.enabled);
        break;

      case "dev":
        if (process.env.DEV_TOOLS !== "1") break;
        if (msg.action === "move_in") services.devMoveIn();
        if (msg.action === "materials") services.devMaterials();
        if (msg.action === "town") services.devTown();
        if (msg.action === "meteor" || msg.action === "dust") devSpawn(msg.action);
        break;

      case "disconnect":
        if (msg.service === "google") disconnectGoogle();
        if (msg.service === "canvas") disconnectCanvas();
        if (msg.service === "spotify") disconnectSpotify();
        if (msg.service === "github") disconnectGithub();
        services.announceConnections();
        break;
    }
}

await Promise.all([initGoogle(), initCanvas(), initGithub()]);
initTeam();
void providersChanged().catch(() => null);
initSpotify();
services.setWebAvailable(BRAIN !== "mock");
services.initResidents();
startChores();
startRequests();
// Cleared rocks grow back, slowly.
setInterval(() => {
  for (const r of regrowRocks()) emit({ type: "rock_grown", x: r.x, y: r.y });
}, 30_000);

// ---------------------------------------------------------------- the LINK script (hosted)

const bases = new WeakMap<WebSocket, string>();

/** Where this player's link script talks to (the gateway sends /bridge/<id>/... to their copy). */
function bridgeBase(ws: WebSocket) {
  return `${PUBLIC_URL || bases.get(ws) || `http://localhost:${PORT}`}/bridge/${USER_ID || "local"}`;
}

const BRIDGE_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "bridge.cjs");

async function readBody(req: import("node:http").IncomingMessage, limit: number): Promise<string | null> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) return null;
  }
  return raw;
}

async function bridgeRoute(req: import("node:http").IncomingMessage, res: ServerResponse, url: URL) {
  const json = (status: number, body: object) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const action = url.pathname.split("/").pop();
  if (action === "script" && req.method === "GET") {
    if (!existsSync(BRIDGE_JS)) return json(503, { error: "the link script isn't built (npm run build)" });
    const base = `${PUBLIC_URL || `http://${req.headers.host}`}/bridge/${USER_ID || "local"}`;
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    return res.end(`globalThis.MOON_BASE = ${JSON.stringify(base)};\n${readFileSync(BRIDGE_JS, "utf8")}`);
  }
  if (req.method !== "POST") return json(405, { error: "POST" });
  const raw = await readBody(req, 2_000_000);
  if (raw === null) return json(413, { error: "too big" });
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return json(400, { error: "not JSON" });
  }
  const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (action === "pair") {
    const out = pairBridge(String(body.code ?? ""), String(body.host ?? ""));
    if ("error" in out) return json(out.status, { error: out.error });
    console.log("[office] Claude Code linked");
    return json(200, { token: out.token, name: ACCOUNT?.name || ACCOUNT?.email || "" });
  }
  if (action === "state") return bridgeUpdate(token, body) ? json(200, { ok: true }) : json(401, { error: "This link isn't active any more. Press LINK in the game for a new code." });
  if (action === "bye") return json(bridgeBye(token) ? 200 : 401, {});
  return json(404, { error: "no such thing" });
}

// Only this computer can reach it (hosted, only the gateway): HOST=0.0.0.0 opens it to your network.
const LISTEN = HOSTED ? "127.0.0.1" : (process.env.HOST ?? "127.0.0.1");
httpServer.listen(PORT, LISTEN, () => {
  console.log(`[server] Fl-AI Me to the Moon agents on http://localhost:${PORT}${LISTEN === "127.0.0.1" ? "" : ` (listening on ${LISTEN})`}`);
  const brains = { claude: "Claude (claude-opus-5)", groq: `Groq (${process.env.GROQ_MODEL ?? "openai/gpt-oss-120b"})`, mock: "⚠ MOCK — scripted villagers, real tools & approvals, no model" };
  console.log(`[server] villager brains: ${brains[BRAIN]}`);
  console.log(`[server] villager voices: ${voiceSummary()}`);
  const c = services.connections();
  console.log(`[server] accounts: google=${c.google.connected ? c.google.account : c.google.configured ? "not signed in" : "not configured"} · canvas=${c.canvas.connected ? c.canvas.account : "not connected"}`);
  console.log(`[server] built: ${Object.keys(world.buildings).map((b) => BUILDINGS[b as keyof typeof BUILDINGS].name).join(", ")} · coins ${world.coins} · residents ${services.residents().join(", ")}`);
});

// Texting: on your computer, through your own iMessage line; online, through the site's line (the gateway's).
void startPhoton().catch((err) => console.error("[photon] failed to start:", err));
onPhoneLinked((masked) => {
  // (the owner's phone: never shown to a friend visiting)
  for (const c of wss.clients) if (localClients.has(c)) send(c, { type: "phone_link", state: "linked", text: `Linked ${masked}! Your phone is now a line home.` });
});
