// Client mirror of the server's colony. Updated instantly as events arrive —
// the world scene animates the same events at a watchable pace on its own.

import { applyLayout } from "../../shared/layout";
import { VILLAGER_NAMES, type Approval, type OfficeState, type Clod, type SeqEvent, type Snapshot, type VillagerId, type VillagerState } from "../../shared/game";

export const store: Snapshot & { connected: boolean } = {
  coins: 0,
  buildings: {},
  villagers: {} as Record<VillagerId, VillagerState>,
  clods: [],
  approvals: [],
  lanterns: [],
  decos: [],
  lastSeq: 0,
  phoneLinked: false,
  connections: { google: { connected: false, configured: false }, canvas: { connected: false }, photon: { connected: false, phoneLinked: false, phones: [] }, web: { connected: false } },
  progress: { quest: 0, count: 0, revealed: [], sandbox: {} },
  residents: ["jade_rabbit"],
  rabbitTeamwork: false,
  chores: [],
  choreOptIn: {},
  friendship: {},
  layout: {},
<<<<<<< Updated upstream
=======
  devMode: false,
  clearedRocks: [],
  shards: [],
  requests: [],
  office: { providers: [], project: null, history: [] },
>>>>>>> Stashed changes
  connected: false,
};

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

export function setOffice(state: OfficeState) {
  store.office = state;
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
<<<<<<< Updated upstream
=======
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
>>>>>>> Stashed changes
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
    case "connections":
      store.connections = e.connections;
      break;
    case "quest":
      store.progress = e.progress;
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
  }
  notify();
}

export function pendingApprovalFor(v: VillagerId): Approval | undefined {
  return store.approvals.find((a) => a.villager === v);
}
