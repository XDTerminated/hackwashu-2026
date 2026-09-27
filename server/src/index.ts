import "./env.js";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage, Service, VillagerId } from "../../shared/game.js";
import { BUILDINGS } from "../../shared/game.js";
import { BRAIN, startTask, lastApprovalVia } from "./agents.js";
import { chatText } from "./chat.js";
<<<<<<< Updated upstream
=======
import { askWorker, clearProject, officeState, onOfficeChange, providersChanged, reportPath, startProject } from "./office.js";
import { chooseModel, connectKey, disconnectKey, finishOpenRouter, openRouterAuthUrl, openRouterModels } from "./aikeys.js";
import type { OfficeProvider } from "../../shared/game.js";

const OFFICE_PROVIDERS: OfficeProvider[] = ["claude", "openai", "groq", "gemini", "openrouter"];
import { announceHappiness, happinessAll } from "./memory.js";
>>>>>>> Stashed changes
import { resolveApproval } from "./approvals.js";
import { connectCanvas, disconnectCanvas, initCanvas } from "./connectors/canvas.js";
import { disconnectGoogle, finishGoogleAuth, GOOGLE_REDIRECT, googleAuthUrl, googleConfigured, initGoogle } from "./connectors/google.js";
import { onPhoneLinked, phoneLinked, photonReady, sendOpeningText, startLink, startPhoton, unlink } from "./photon.js";
import { clearChore, devSpawn, setChoreOptIn, startChores } from "./chores.js";
import * as services from "./services.js";
import { decorById, decorFootprint, sellPrice } from "../../shared/decor.js";
<<<<<<< Updated upstream
import { buildingTiles, canOccupy, snapToTiles } from "../../shared/layout.js";
import { build, emit, moveBuilding, moveDeco, newId, occupied, onEvent, placeDeco, popClod, removeDeco, snapshot, world } from "./world.js";
=======
import { SHARD_COUNT, buildingTiles, canOccupy, snapToTiles } from "../../shared/layout.js";
import { currentRequests, startRequests } from "./requests.js";
import { build, clearRock, collectShard, emit, moveBuilding, moveDeco, moveLantern, newId, occupied, onEvent, placeDeco, popClod, removeDeco, savePersist, snapshot, switchWorld, world } from "./world.js";
>>>>>>> Stashed changes

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

<<<<<<< Updated upstream
=======
  // A villager line to speak aloud in the talk dialog.
  if (url.pathname === "/voice") return handleVoice(req, res);

  // "Connect your AI": one-click OpenRouter sign-in for the Office.
  if (url.pathname === "/connect/openrouter") {
    // Come back to whichever address the player's browser used to reach this server.
    const host = /^[\w.\-]+(:\d+)?$/.test(req.headers.host ?? "") ? req.headers.host : `localhost:${PORT}`;
    res.writeHead(302, { location: openRouterAuthUrl(`http://${host}/oauth/openrouter/callback`) });
    return res.end();
  }
  if (url.pathname === "/oauth/openrouter/callback") {
    const code = url.searchParams.get("code");
    if (!code) return page(res, 400, "Sign-in cancelled", "<p>No code from OpenRouter. You can close this tab.</p>");
    try {
      await finishOpenRouter(code);
      await providersChanged();
      return page(res, 200, "Your AI is connected! 🚀", "<p>The Office can now use your OpenRouter account. Close this tab, pick a model on the project board, and brief your team.</p>");
    } catch (err) {
      console.error("[openrouter] sign-in failed:", err);
      return page(res, 500, "Sign-in failed", `<p>${err instanceof Error ? err.message : "Unknown error"}</p>`);
    }
  }

  // An office project's deliverable, to read in a browser tab.
  if (url.pathname.startsWith("/office/")) {
    const file = reportPath(url.pathname.slice("/office/".length));
    if (!file || !existsSync(file)) return page(res, 404, "No such report", "<p>That project's report isn't here.</p>");
    const esc = readFileSync(file, "utf8").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return page(res, 200, "Office report", `<pre style="white-space:pre-wrap;font:14px/1.5 ui-monospace,Menlo,monospace;color:#f2e6cc">${esc}</pre>`);
  }

>>>>>>> Stashed changes
  // Google sign-in: the game opens this in a new tab.
  if (url.pathname === "/connect/google") {
    if (!googleConfigured()) {
      return page(res, 200, "Google isn't set up yet", `<p>Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to <code>.env</code>, restart the server, and try again.</p>
<p>Google Cloud console → enable Gmail API + Google Calendar API → OAuth client (Web application) with redirect URI:<br><code>${GOOGLE_REDIRECT}</code></p>`);
    }
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
  res.end(JSON.stringify({ ok: true, service: "moon-village", brain: BRAIN, photon: photonReady(), connections: services.connections(), seq: world.seq }));
});

const wss = new WebSocketServer({ server: httpServer });
onOfficeChange((state) => {
  for (const c of wss.clients) send(c, { type: "office", state });
});

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function fullSnapshot() {
  return {
    ...snapshot(),
    requests: currentRequests(),
    office: officeState(),
    phoneLinked: phoneLinked(),
    connections: services.connections(),
    residents: services.residents(),
    rabbitTeamwork: services.rabbitTeamwork(),
  };
}

onEvent((event) => {
  for (const c of wss.clients) send(c, { type: "event", event });
});

wss.on("connection", (ws) => {
  console.log("[ws] game connected");

  ws.on("message", async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    switch (msg.type) {
      case "hello":
        send(ws, { type: "snapshot", snapshot: fullSnapshot() });
        break;

      case "landed":
        void sendOpeningText();
        break;

      case "task":
        if (VILLAGERS.includes(msg.villager) && msg.text?.trim()) {
          const text = msg.text.trim().slice(0, 2000);
          // MoonPad texts are chats; real work happens when you visit in person.
          if (msg.via === "moonpad") void chatText(msg.villager, text, "moonpad");
          else void startTask(msg.villager, text, "game");
        }
        break;

      case "approve": {
        lastApprovalVia.set(msg.approvalId, "game");
        if (!resolveApproval(msg.approvalId, msg.approved)) {
          send(ws, { type: "notice", text: "That letter was already answered." });
        }
        break;
      }

      case "pop": {
        const r = popClod(msg.clodId);
        if (r.ok) emit({ type: "clod_popped", clodId: msg.clodId, reward: r.reward, coins: world.coins });
        break;
      }

      case "build": {
        const r = build(msg.building);
        if (r.ok) {
          emit({ type: "building_built", building: msg.building, coins: world.coins });
          services.checkArrivals();
        } else send(ws, { type: "notice", text: r.reason });
        break;
      }

      case "place_deco": {
        const def = decorById(String(msg.item));
        if (!def || !Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) break;
        const { x, y } = snapToTiles(Number(msg.x), Number(msg.y), def.tiles[0]);
        if (!canOccupy(decorFootprint(def, x, y), occupied())) {
          send(ws, { type: "notice", text: "Something's already on those tiles." });
          break;
        }
        const deco = { id: newId("deco"), item: def.id, x, y };
        const r = placeDeco(deco, def.price);
        if (r.ok) emit({ type: "deco_placed", deco, coins: world.coins });
        else send(ws, { type: "notice", text: r.reason });
        break;
      }

      case "move_deco": {
        const placed = world.decos.find((d) => d.id === msg.id);
        const def = placed && decorById(placed.item);
        if (!placed || !def || !Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) break;
        const { x, y } = snapToTiles(Number(msg.x), Number(msg.y), def.tiles[0]);
<<<<<<< Updated upstream
        if (canOccupy(decorFootprint(def, x, y), occupied({ deco: placed.id })) && moveDeco(placed.id, x, y)) emit({ type: "deco_moved", id: placed.id, x, y });
=======
        if (canOccupy(decorFootprint(def, x, y), occupied({ deco: placed.id })) && moveDeco(placed.id, x, y)) {
          emit({ type: "deco_moved", id: placed.id, x, y });
          announceHappiness(before, def.name);
        } else send(ws, { type: "notice", text: "That spot's taken." });
        break;
      }

      case "clear_rock": {
        const r = clearRock(Math.round(Number(msg.x)), Math.round(Number(msg.y)));
        if (r.ok) emit({ type: "rock_cleared", x: msg.x, y: msg.y, cost: r.cost, coins: world.coins, ...(r.loot ? { loot: r.loot } : {}) });
        else send(ws, { type: "notice", text: r.reason });
        break;
      }

      case "collect_shard": {
        const r = collectShard(Math.round(Number(msg.x)), Math.round(Number(msg.y)));
        if (r.ok) emit({ type: "shard_found", x: msg.x, y: msg.y, found: world.shards.length, total: SHARD_COUNT, reward: r.reward, coins: world.coins, ...(r.bonus ? { bonus: r.bonus } : {}) });
        break;
      }

      case "move_lantern": {
        if (!Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) break;
        const { x, y } = snapToTiles(Number(msg.x), Number(msg.y), 1);
        if (moveLantern(String(msg.id), x, y)) emit({ type: "lantern_moved", id: msg.id, x, y });
>>>>>>> Stashed changes
        else send(ws, { type: "notice", text: "That spot's taken." });
        break;
      }

      case "move_building": {
        const b = msg.building;
        if (!BUILDINGS[b] || !Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) break;
        const { x, y } = snapToTiles(Number(msg.x), Number(msg.y), buildingTiles(b).w);
        if (moveBuilding(b, x, y)) emit({ type: "building_moved", building: b, x, y });
        else send(ws, { type: "notice", text: "The building doesn't fit there." });
        break;
      }

<<<<<<< Updated upstream
=======
      case "office_start": {
        const problem = startProject(String(msg.brief ?? ""), msg.provider);
        if (problem) send(ws, { type: "notice", text: problem });
        break;
      }

      case "office_ask": {
        const text = await askWorker(String(msg.workerId), String(msg.question ?? ""));
        send(ws, { type: "office_answer", workerId: msg.workerId, text });
        break;
      }

      case "office_key": {
        const provider = msg.provider;
        if (!OFFICE_PROVIDERS.includes(provider)) break;
        try {
          const masked = await connectKey(provider, String(msg.key ?? ""));
          await providersChanged();
          send(ws, { type: "notice", text: `Connected (${masked}). Your team can use it now.` });
        } catch (err) {
          send(ws, { type: "notice", text: `Couldn't connect: ${err instanceof Error ? err.message : err}.` });
        }
        break;
      }

      case "office_disconnect": {
        if (!OFFICE_PROVIDERS.includes(msg.provider)) break;
        disconnectKey(msg.provider);
        await providersChanged();
        break;
      }

      case "office_model": {
        if (msg.provider !== "openrouter" || typeof msg.model !== "string") break;
        if (!(await openRouterModels()).includes(msg.model)) break;
        chooseModel("openrouter", msg.model);
        await providersChanged();
        break;
      }

      case "office_clear": {
        const problem = clearProject();
        if (problem) send(ws, { type: "notice", text: problem });
        break;
      }

      case "dev_mode": {
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

>>>>>>> Stashed changes
      case "sell_deco": {
        const placed = world.decos.find((d) => d.id === msg.id);
        const def = placed && decorById(placed.item);
        const refund = def ? sellPrice(def) : 0;
        if (placed && removeDeco(placed.id, refund)) emit({ type: "deco_sold", id: placed.id, refund, coins: world.coins });
        break;
      }

      case "connect_canvas": {
        try {
          const who = await connectCanvas(String(msg.token ?? ""), msg.baseUrl || undefined);
          services.announceConnections();
          send(ws, { type: "notice", text: `Canvas connected as ${who}.` });
        } catch (err) {
          send(ws, { type: "notice", text: `Canvas didn't accept that: ${err instanceof Error ? err.message : err}` });
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
        if (r.ok) emit({ type: "chore_cleared", id: msg.id, kind: r.kind, reward: r.reward, coins: world.coins });
        break;
      }

      case "set_chore_optin":
        if (VILLAGERS.includes(msg.villager)) setChoreOptIn(msg.villager, !!msg.enabled);
        break;

      case "dev":
        if (process.env.DEV_TOOLS !== "1") break;
        if (msg.action === "complete_quest") services.devCompleteQuest();
        if (msg.action === "meteor" || msg.action === "dust") devSpawn(msg.action);
        break;

      case "disconnect":
        if (msg.service === "google") disconnectGoogle();
        if (msg.service === "canvas") disconnectCanvas();
        services.announceConnections();
        break;
    }
  });

  ws.on("close", () => console.log("[ws] game disconnected"));
});

await Promise.all([initGoogle(), initCanvas()]);
services.setWebAvailable(BRAIN !== "mock");
services.initResidents();
startChores();
startRequests();
void providersChanged();

httpServer.listen(PORT, () => {
  console.log(`[server] Moon Village agents on http://localhost:${PORT}`);
  const brains = { claude: "Claude (claude-opus-5)", groq: `Groq (${process.env.GROQ_MODEL ?? "openai/gpt-oss-120b"})`, mock: "⚠ MOCK — scripted villagers, real tools & approvals, no model" };
  console.log(`[server] villager brains: ${brains[BRAIN]}`);
  const c = services.connections();
  console.log(`[server] accounts: google=${c.google.connected ? c.google.account : c.google.configured ? "not signed in" : "not configured"} · canvas=${c.canvas.connected ? c.canvas.account : "not connected"}`);
  console.log(`[server] built: ${Object.keys(world.buildings).map((b) => BUILDINGS[b as keyof typeof BUILDINGS].name).join(", ")} · coins ${world.coins} · residents ${services.residents().join(", ")}`);
});

void startPhoton().catch((err) => console.error("[photon] failed to start:", err));
onPhoneLinked((masked) => {
  for (const c of wss.clients) send(c, { type: "phone_link", state: "linked", text: `Linked ${masked}! Your phone is now a line home.` });
});
