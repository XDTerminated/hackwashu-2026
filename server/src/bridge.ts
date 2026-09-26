// The LINK script. Runs on the player's own computer (the hosted game can't
// see their files): it reads their Claude Code logs with the Office's own
// reader (agentwatch.ts) and sends what it sees to their copy of the game,
// and only theirs. The game serves this file already pointed at the right
// place, so the whole setup is one line:
//
//   curl -fsSL https://<site>/bridge/<you>/script | node - ABCD-EFGH
//
// Add --summary to send only what each agent is doing (no thinking, file
// contents or command output). Ctrl+C unlinks.

import { hostname } from "node:os";
import { agentsState, onAgentsChange, startAgentWatch } from "./agentwatch.js";
import type { AgentInfo, AgentsState } from "../../shared/game.js";

const BASE: string = (globalThis as { MOON_BASE?: string }).MOON_BASE ?? process.env.MOON_BASE ?? "";
const args = process.argv.slice(2).filter((a) => a !== "-");
const code = args.find((a) => !a.startsWith("--"));
const summary = args.includes("--summary");

const say = (s: string) => process.stdout.write(`${s}\n`);

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; token?: string; name?: string };
  return { status: res.status, data };
}

/** --summary: what they're doing, not what they're reading or thinking. */
function slim(state: AgentsState): AgentsState {
  if (!summary) return state;
  const agent = (a: AgentInfo): AgentInfo => ({ ...a, task: "", result: "", feed: a.feed.filter((f) => f.kind === "tool").map((f) => ({ ...f, text: f.text.split("\n")[0] })) });
  return { ...state, sessions: state.sessions.map((s) => ({ ...s, lead: agent(s.lead), workers: s.workers.map(agent) })) };
}

async function main() {
  if (!BASE || !code) {
    say("Fl-AI Me to the Moon: link your Claude Code to your Office.");
    say("Get the command from the game (Office > LINK) and paste it into a terminal.");
    process.exit(1);
  }
  say("");
  say("  ☾  Fl-AI Me to the Moon · linking your Claude Code");
  say("");
  let token: string;
  try {
    const { status, data } = await post("pair", { code, host: hostname().replace(/\.local$/, "") });
    if (status !== 200 || !data.token) {
      say(`  ✕ ${data.error ?? `The game said no (${status}).`}`);
      process.exit(1);
    }
    token = data.token;
    say(`  ✓ Linked${data.name ? ` to ${data.name}'s` : " to your"} game.`);
  } catch (err) {
    say(`  ✕ Couldn't reach the game: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  say(`  Watching Claude Code on this computer. Ask it to use subagents and they'll`);
  say(`  walk into your Office. ${summary ? "Sending a summary only (--summary)." : "Sending the full feed (add --summary for less)."}`);
  say("  Nothing is stored. Leave this open; Ctrl+C to unlink.");
  say("");

  startAgentWatch();
  let last = "";
  let lastSent = 0;
  let timer: NodeJS.Timeout | null = null;
  let offline = false;
  let told = "";
  const send = async () => {
    timer = null;
    const state = slim(agentsState());
    const json = JSON.stringify(state);
    // Unchanged: just a heartbeat every 10s, so the game knows we're still here.
    if (json === last && Date.now() - lastSent < 10_000) return;
    last = json;
    lastSent = Date.now();
    try {
      const { status, data } = await post("state", state, token);
      if (status === 401) {
        say(`  ✕ ${data.error ?? "The link was closed from the game."}`);
        process.exit(1);
      }
      if (offline) say("  ✓ Back in touch with the game.");
      offline = false;
    } catch {
      if (!offline) say("  … Can't reach the game right now; still trying.");
      offline = true;
    }
    // A line whenever the picture changes.
    const working = state.sessions.reduce((n, s) => n + s.workers.filter((w) => w.status !== "done" && w.status !== "failed").length, 0);
    const line = state.sessions.length ? `  ● ${state.sessions.length} session${state.sessions.length === 1 ? "" : "s"} live · ${working} subagent${working === 1 ? "" : "s"} working` : "  ○ No Claude Code session running yet.";
    if (line !== told) say((told = line));
  };
  const soon = () => {
    if (!timer) timer = setTimeout(() => void send(), Math.max(0, 1000 - (Date.now() - lastSent)));
  };
  onAgentsChange(soon);
  setInterval(soon, 10_000);
  soon();

  const bye = async () => {
    say("\n  Unlinking...");
    await post("bye", {}, token).catch(() => null);
    process.exit(0);
  };
  process.on("SIGINT", () => void bye());
  process.on("SIGTERM", () => void bye());
}

void main();
