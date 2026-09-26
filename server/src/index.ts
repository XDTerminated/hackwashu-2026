import { ACCOUNT, HOSTED, PUBLIC_URL, USER_ID } from "./env.js";
import { createServer, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage, Service, VillagerId } from "../../shared/game.js";
import { BUILDINGS } from "../../shared/game.js";
import { BRAIN, startTask, lastApprovalVia } from "./agents.js";
import { chatText } from "./chat.js";
import { agentsState, bridgeBye, bridgeUpdate, newLinkCode, onAgentsChange, pairBridge, reportEvent, startAgentWatch, startReplay, stopReplay, unlink as unlinkBridge, useLinking } from "./agentwatch.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { announceHappiness, happinessAll } from "./memory.js";
import { denyAllPending, resolveApproval } from "./approvals.js";
import { DEFAULT_CANVAS, canvasBase, connectCanvas, disconnectCanvas, initCanvas, searchSchools } from "./connectors/canvas.js";
import { canvasSignIn } from "./connectors/canvasLogin.js";
import { testConnections } from "./selftest.js";
import { checkGoogleClient, disconnectGoogle, finishGoogleAuth, GOOGLE_REDIRECT, googleAuthUrl, googleConfigured, initGoogle, setGoogleClient } from "./connectors/google.js";
import { onPhoneLinked, phoneLinked, photonReady, startLink, startPhoton, unlink } from "./photon.js";
import { clearChore, devSpawn, setChoreOptIn, startChores } from "./chores.js";
import { handleVoice, voiceStatus, voiceSummary } from "./voice.js";
import * as services from "./services.js";
import { decorById, decorFootprint, sellPrice } from "../../shared/decor.js";
import { SHARD_COUNT, buildingTiles, canOccupy, snapToTiles } from "../../shared/layout.js";
import { currentRequests, startRequests } from "./requests.js";
import { build, clearRock, collectShard, shardsFound, emit, moveBuilding, moveDeco, moveLantern, newId, occupied, onEvent, placeDeco, popClod, removeDeco, savePersist, snapshot, switchWorld, world } from "./world.js";

const PORT = Number(process.env.PORT ?? 8787);
const VILLAGERS: VillagerId[] = ["jade_rabbit", "postmaster", "timekeeper", "scholar", "stargazer"];
const SERVICES: Service[] = ["google", "canvas"];

function page(res: ServerResponse, status: number, title: string, body: string) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:ui-monospace,monospace;background:#0b0a1a;color:#f4d9a6;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="max-width:560px;padding:24px;border:4px solid #8a4b1f;background:#1a1430;line-height:1.6">
<h2 style="color:#e08a6b;margin-top:0">${title}</h2>${body}</div></body>`);
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // A villager line to speak aloud in the talk dialog.
  if (url.pathname === "/voice") return handleVoice(req, res);

  // Hosted: the LINK script on the player's own computer reports their Claude Code here.
  if (HOSTED && url.pathname.startsWith("/bridge/")) return bridgeRoute(req, res, url);

  // Other coding tools can put their agents in the Office (from this computer only).
  if (url.pathname === "/agents/event") {
    if (HOSTED || !isLocal(req.socket.remoteAddress)) return page(res, 403, "Not here", "<p>Only tools on this computer can report agents.</p>");
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "POST a JSON event" }));
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

  // One-time host setup for "Sign in with Google" (only from this computer).
  if (url.pathname === "/setup/google") {
    // The hosted game's Google app is set by whoever runs the site, not from a page.
    if (HOSTED) return page(res, 404, "Not here", "<p>Nothing to set up here.</p>");
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
        return page(res, 400, "Almost", `<p>${err instanceof Error ? err.message : err}</p><p><a style="color:#f5c542" href="/setup/google">Try again</a></p>`);
      }
      services.announceConnections();
      return page(res, 200, "Google sign-in is ready", `<p>Saved (privately, on this computer). Players can now press <b>CONNECT GOOGLE</b> in the game and sign in with their own account.</p>
<p><a style="color:#f5c542;font-size:1.1em" href="/connect/google">Sign in with Google now →</a></p>
<p style="opacity:.75">Until Google verifies the app, players see a "Google hasn't verified this app" screen: Advanced → Go to Moon Village continues.</p>`);
    }
    const step = (n: number, html: string) => `<li style="margin:0 0 14px"><b style="color:#e08a6b">${n}.</b> ${html}</li>`;
    const link = (href: string, text: string) => `<a style="color:#f5c542" target="_blank" rel="noopener" href="${href}">${text}</a>`;
    return page(res, 200, "Set up Google sign-in", `<p>Do this once, as the host, and every player can sign in with their own Google account. About 5 minutes.</p>
<ol style="list-style:none;padding:0">
${step(1, `${link("https://console.cloud.google.com/projectcreate", "Create a Google Cloud project")} (name it "Moon Village").`)}
${step(2, `In that project, turn on the ${link("https://console.cloud.google.com/apis/library/gmail.googleapis.com", "Gmail API")} and the ${link("https://console.cloud.google.com/apis/library/calendar-json.googleapis.com", "Google Calendar API")} (press Enable on each).`)}
${step(3, `Open ${link("https://console.cloud.google.com/auth/overview", "Google Auth Platform")} → Get started: app name "Moon Village", your email, Audience <b>External</b>.`)}
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

  // Google sign-in: the game opens this in a new tab.
  if (url.pathname === "/connect/google") {
    if (!googleConfigured()) {
      // Not set up yet: send the host to the setup page instead of a dead end.
      res.writeHead(302, { location: "/setup/google" });
      return res.end();
    }
    // Set up, but wrong somewhere? Say exactly what to fix instead of Google's error page.
    const check = await checkGoogleClient();
    if (!check.ok) return page(res, 200, "One thing to fix", `<p>${check.problem}</p><p>${check.fix}</p><p><a style="color:#f5c542" target="_blank" rel="noopener" href="https://console.cloud.google.com/auth/clients">Open your OAuth clients →</a> &nbsp; <a style="color:#f5c542" href="/connect/google">Try again</a></p>`);
    res.writeHead(302, { location: googleAuthUrl() });
    return res.end();
  }
  if (url.pathname === "/oauth/google/callback") {
    const code = url.searchParams.get("code");
    if (!code) return page(res, 400, "Sign-in cancelled", `<p>${url.searchParams.get("error") ?? "No code from Google."} You can close this tab.</p>`);
    try {
      const account = await finishGoogleAuth(code);
      services.announceConnections();
      return page(res, 200, "Connected! 🚀", `<p>The colony can now reach <b>${account ?? "your Google account"}</b>. Close this tab and head back to the Moon — someone's rocket is landing.</p>`);
    } catch (err) {
      console.error("[google] sign-in failed:", err);
      return page(res, 500, "Sign-in failed", `<p>${err instanceof Error ? err.message : "Unknown error"}</p>`);
    }
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "moon-village", brain: BRAIN, voice: voiceStatus(), photon: photonReady(), connections: services.connections(), seq: world.seq }));
});

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

const wss = new WebSocketServer({ server: httpServer, verifyClient: ({ origin, req }: { origin: string; req: { headers: { host?: string } } }) => originAllowed(origin, req.headers.host) });

process.on("unhandledRejection", (err) => console.error("[server] unhandled:", err));
// Your coding agents' work (code, commands, output) only goes to a game
// running on this same computer, never to another device on the network.
const localClients = new WeakSet<WebSocket>();
onAgentsChange((state) => {
  for (const c of wss.clients) if (localClients.has(c)) send(c, { type: "agents", state });
});
// On your computer the Office watches your Claude Code directly; hosted, you link it (bridgeRoute).
if (HOSTED) useLinking();
else startAgentWatch();

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
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

onEvent((event) => {
  for (const c of wss.clients) send(c, { type: "event", event });
});

wss.on("connection", (ws, req) => {
  console.log("[ws] game connected");
  bases.set(ws, `${String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0]}://${req.headers.host}`);
  // Hosted, the gateway only lets this copy's own player through, so they're all "at home".
  if (HOSTED || isLocal(req.socket.remoteAddress)) localClients.add(ws);

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

  ws.on("close", () => console.log("[ws] game disconnected"));
});

async function handle(ws: WebSocket, msg: ClientMessage) {
    switch (msg.type) {
      case "hello":
        send(ws, { type: "snapshot", snapshot: fullSnapshot() });
        if (localClients.has(ws)) send(ws, { type: "agents", state: agentsState() });
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
        // A neighbor's house goes up once their lot is cleared and repaired.
        const blocked = BUILDINGS[msg.building] ? services.lotBlocker(msg.building) : null;
        if (blocked) {
          send(ws, { type: "notice", text: blocked });
          break;
        }
        const r = build(msg.building);
        if (r.ok) {
          emit({ type: "building_built", building: msg.building, coins: world.coins });
          services.checkMoveIn();
        } else send(ws, { type: "notice", text: r.reason });
        break;
      }

      case "clear_rubble": {
        if (!BUILDINGS[msg.building]) break;
        const problem = services.clearRubble(msg.building, Number(msg.index));
        if (problem) send(ws, { type: "notice", text: problem });
        break;
      }

      case "repair_lot": {
        if (!BUILDINGS[msg.building]) break;
        const problem = services.repairLot(msg.building);
        if (problem) send(ws, { type: "notice", text: problem });
        break;
      }

      case "place_deco": {
        const before = happinessAll();
        const def = decorById(String(msg.item));
        if (!def || !Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) break;
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
          services.checkMoveIn();
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
          services.checkMoveIn();
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
        if (!BUILDINGS[b] || !Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) break;
        const { x, y } = snapToTiles(Number(msg.x), Number(msg.y), buildingTiles(b).w);
        const before = happinessAll();
        if (moveBuilding(b, x, y)) {
          emit({ type: "building_moved", building: b, x, y });
          announceHappiness(before);
          services.checkMoveIn();
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
        // Open letters belong to the save being left: answer them "no" so nobody waits forever.
        denyAllPending();
        if (!switchWorld(!!msg.on)) break;
        services.initResidents();
        for (const c of wss.clients) send(c, { type: "snapshot", snapshot: fullSnapshot() });
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
            for (const c of wss.clients) send(c, { type: "notice", text: `Canvas connected as ${who}. Mabel can read your courses now.`, tone: "ok" });
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
          // Sweeping turns up stardust; a fallen meteor is a chunk of moonstone.
          services.gain(r.kind === "dust" ? { stardust: 1 } : { moonstone: 1 }, { x: r.x, y: r.y });
        }
        break;
      }

      case "set_chore_optin":
        if (VILLAGERS.includes(msg.villager)) setChoreOptIn(msg.villager, !!msg.enabled);
        break;

      case "dev":
        if (process.env.DEV_TOOLS !== "1") break;
        if (msg.action === "move_in") services.devMoveIn();
        if (msg.action === "materials") services.devMaterials();
        if (msg.action === "meteor" || msg.action === "dust") devSpawn(msg.action);
        break;

      case "disconnect":
        if (msg.service === "google") disconnectGoogle();
        if (msg.service === "canvas") disconnectCanvas();
        services.announceConnections();
        break;
    }
}

await Promise.all([initGoogle(), initCanvas()]);
services.setWebAvailable(BRAIN !== "mock");
services.initResidents();
startChores();
startRequests();

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

httpServer.listen(PORT, () => {
  console.log(`[server] Moon Village agents on http://localhost:${PORT}`);
  const brains = { claude: "Claude (claude-opus-5)", groq: `Groq (${process.env.GROQ_MODEL ?? "openai/gpt-oss-120b"})`, mock: "⚠ MOCK — scripted villagers, real tools & approvals, no model" };
  console.log(`[server] villager brains: ${brains[BRAIN]}`);
  console.log(`[server] villager voices: ${voiceSummary()}`);
  const c = services.connections();
  console.log(`[server] accounts: google=${c.google.connected ? c.google.account : c.google.configured ? "not signed in" : "not configured"} · canvas=${c.canvas.connected ? c.canvas.account : "not connected"}`);
  console.log(`[server] built: ${Object.keys(world.buildings).map((b) => BUILDINGS[b as keyof typeof BUILDINGS].name).join(", ")} · coins ${world.coins} · residents ${services.residents().join(", ")}`);
});

// Texting runs through the host's own iMessage line: only on your computer, never hosted.
if (!HOSTED) void startPhoton().catch((err) => console.error("[photon] failed to start:", err));
onPhoneLinked((masked) => {
  for (const c of wss.clients) send(c, { type: "phone_link", state: "linked", text: `Linked ${masked}! Your phone is now a line home.` });
});
