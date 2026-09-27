// Client mirror of the server's colony. Updated instantly as events arrive —
// the world scene animates the same events at a watchable pace on its own.

import { applyLayout } from "../../shared/layout";
import { freshTown } from "../../shared/town";
import { VILLAGER_NAMES, noMaterials, type Approval, type AgentSession, type AgentsState, type Clod, type SeqEvent, type Snapshot, type VillagerId, type VillagerState } from "../../shared/game";

export const store: Snapshot & { connected: boolean } = {
  coins: 0,
  materials: noMaterials(),
  buildings: {},
  villagers: {} as Record<VillagerId, VillagerState>,
  clods: [],
  approvals: [],
  lanterns: [],
  decos: [],
  lastSeq: 0,
  phoneLinked: false,
  connections: { google: { connected: false, configured: false }, spotify: { connected: false, configured: false }, github: { connected: false }, canvas: { connected: false }, photon: { connected: false, phoneLinked: false, phones: [] }, web: { connected: false } },
  progress: { town: freshTown(), revealed: [], sandbox: {}, movedIn: [], plots: {} },
  residents: ["jade_rabbit"],
  rabbitTeamwork: false,
  chores: [],
  choreOptIn: {},
  friendship: {},
  layout: {},
  devMode: false,
  clearedRocks: [],
  shards: [],
  requests: [],
  introSeen: false,
  guest: false,
  connected: false,
};

/** Your coding agents, for the Office (their own updates: see net.onAgents). */
export const agents: { state: AgentsState; focus: string | null } = { state: { watching: null, link: null, sessions: [] }, focus: null };

export function setAgents(state: AgentsState) {
  agents.state = state;
}

const busy = (s: AgentSession) => s.workers.some((w) => w.status !== "done" && w.status !== "failed");

/** The session the Office is showing: the one you picked, else one with agents at work, else the latest. */
export function focusedSession(): AgentSession | null {
  const list = agents.state.sessions;
  return list.find((s) => s.id === agents.focus) ?? list.find((s) => s.source === "replay") ?? list.find(busy) ?? list.find((s) => s.workers.length) ?? list[0] ?? null;
}

/** Show the next live session (the Office board's SWITCH). */
export function focusNextSession() {
  const list = agents.state.sessions;
  if (list.length < 2) return;
  const i = list.findIndex((s) => s.id === focusedSession()?.id);
  agents.focus = list[(i + 1) % list.length].id;
}

type Fn = () => void;
const changed = new Set<Fn>();

export function onStoreChange(fn: Fn) {
  changed.add(fn);
  return () => changed.delete(fn);
}

function notify() {
  changed.forEach((fn) => fn());
}

export function applySnapshot(s: Snapshot) {
  Object.assign(store, s);
  applyLayout(store.layout ?? {});
  notify();
}

export function setConnected(v: boolean) {
  store.connected = v;
  notify();
}

function villager(id: VillagerId): VillagerState {
  return (store.villagers[id] ??= { status: "idle", activity: "relaxing" });
}

function clod(id: string): Clod | undefined {
  return store.clods.find((c) => c.id === id);
}

export function applyEvent(e: SeqEvent) {
  store.lastSeq = e.seq;
  switch (e.type) {
    case "task_start":
      Object.assign(villager(e.villager), { status: "thinking", activity: "planning…" });
      break;
    case "think":
      Object.assign(villager(e.villager), { status: "thinking", activity: "thinking…", thought: e.text });
      break;
    case "handoff":
      if (e.to === "jade_rabbit") {
        // A neighbor reporting back is done with their part.
        Object.assign(villager(e.from), { status: "idle", activity: "relaxing" });
        Object.assign(villager(e.to), { status: "thinking", activity: `reading ${VILLAGER_NAMES[e.from]}'s report` });
      } else {
        Object.assign(villager(e.to), { status: "working", activity: `on a job from ${VILLAGER_NAMES[e.from]}` });
      }
      break;
    case "tool_start":
      store.clods.push({ ...e.clod });
      Object.assign(villager(e.villager), { status: "working", activity: e.clod.label });
      break;
    case "tool_end": {
      const c = clod(e.clodId);
      if (c) {
        c.status = e.ok ? "ready" : "failed";
        c.result = e.result;
      }
      if (!e.ok) Object.assign(villager(e.villager), { status: "error", activity: e.result });
      break;
    }
    case "approval_needed": {
      store.approvals.push(e.approval);
      const c = clod(e.approval.clodId);
      if (c) {
        c.status = "stuck";
        c.approvalId = e.approval.id;
      }
      Object.assign(villager(e.villager), { status: "waiting", activity: "needs your OK!" });
      break;
    }
    case "approval_resolved": {
      store.approvals = store.approvals.filter((a: Approval) => a.id !== e.approvalId);
      const c = clod(e.clodId);
      if (c) c.status = "working";
      Object.assign(villager(e.villager), { status: "working", activity: e.approved ? "launching!" : "putting it away" });
      break;
    }
    case "building_error":
      Object.assign(villager(e.villager), { status: "error", activity: e.message });
      break;
    case "say":
      if (villager(e.villager).status === "thinking") Object.assign(villager(e.villager), { status: "idle", activity: "relaxing" });
      break;
    case "task_done":
      store.lanterns.push(e.lantern);
      Object.assign(villager(e.villager), { status: "idle", activity: "relaxing" });
      break;
    case "clod_popped":
      store.clods = store.clods.filter((c) => c.id !== e.clodId);
      store.coins = e.coins;
      break;
    case "building_built":
      store.buildings[e.building] = true;
      if (e.building === "post_office") store.buildings.mailbox = true;
      store.coins = e.coins;
      break;
    case "deco_placed":
      store.decos.push(e.deco);
      store.coins = e.coins;
      break;
    case "rock_grown":
      store.clearedRocks = store.clearedRocks.filter((k) => k !== `${e.x},${e.y}`);
      break;
    case "rock_cleared":
      store.clearedRocks.push(`${e.x},${e.y}`);
      store.coins = e.coins;
      break;
    case "shard_found":
      store.shards.push(`${e.x},${e.y}`);
      store.coins = e.coins;
      break;
    case "requests":
      store.requests = e.requests;
      store.coins = e.coins;
      break;
    case "lantern_moved": {
      const l = store.lanterns.find((l) => l.id === e.id);
      if (l) Object.assign(l, { x: e.x, y: e.y });
      break;
    }
    case "deco_toggled": {
      const d = store.decos.find((d) => d.id === e.id);
      if (d) d.off = e.off;
      break;
    }
    case "deco_moved": {
      const d = store.decos.find((d) => d.id === e.id);
      if (d) Object.assign(d, { x: e.x, y: e.y });
      break;
    }
    case "building_moved":
      store.layout[e.building] = { x: e.x, y: e.y };
      applyLayout(store.layout);
      break;
    case "deco_sold":
      store.decos = store.decos.filter((d) => d.id !== e.id);
      store.coins = e.coins;
      break;
    case "phone":
      store.phoneLinked = true;
      break;
    case "sandbox":
      store.progress.sandbox = e.sandbox;
      break;
    case "connections":
      store.connections = e.connections;
      break;
    case "progress":
      store.progress = e.progress;
      store.materials = e.materials;
      store.coins = e.coins;
      break;
    case "villager_arrived":
      store.residents = e.residents;
      store.rabbitTeamwork = e.rabbitTeamwork;
      break;
    case "chore_spawned":
      store.chores.push(e.chore);
      break;
    case "chore_cleared":
      store.chores = store.chores.filter((c) => c.id !== e.id);
      store.coins = e.coins;
      break;
    case "chore_gone":
      store.chores = store.chores.filter((c) => c.id !== e.id);
      break;
    case "chore_optin":
      store.choreOptIn = e.optIn;
      break;
    case "friendship":
      store.friendship[e.villager] = e.points;
      break;
    case "plot_revealed":
      if (!store.progress.revealed.includes(e.building)) store.progress.revealed.push(e.building);
      break;
    case "plot":
      store.progress.plots[e.building] = e.plot;
      break;
  }
  notify();
}

export function pendingApprovalFor(v: VillagerId): Approval | undefined {
  return store.approvals.find((a) => a.villager === v);
}

/** Still in Yutu's tutorial (nobody's moved in yet)? Everything but the tutorial waits till it's done. */
export const inTutorial = () => store.connected && !store.progress.movedIn.length;
