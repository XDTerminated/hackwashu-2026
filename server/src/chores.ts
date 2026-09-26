// Island chores. Moondust drifts pile up by the lamps (even while the game is
// closed); meteors thunk down every so often and leave a moon-rock that cools.
// Also the opt-in villager chores: small real checks every CHORE_EVERY_MIN.

import { CHORE_EVERY_MIN, type Chore, type VillagerId } from "../../shared/game.js";
import { PLAZA, WORLD_H, WORLD_W, inIslandXY, lampSpots, nearBuilding } from "../../shared/layout.js";
import { isBusy, startTask } from "./agents.js";
import { isResident } from "./services.js";
import { emit, newId, owns, savePersist, world } from "./world.js";

const MAX_DUST = 8;
const DUST_REWARD = 3;
const METEOR_REWARD = 8;
const WARNING_MS = 3000;
const COOL_MS = 60_000;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
let nextDust = Date.now() + 20_000;
let nextMeteor = Date.now() + rand(45_000, 90_000);

function add(c: Chore) {
  world.chores[c.id] = c;
  savePersist();
  emit({ type: "chore_spawned", chore: c });
}

function spawnDust() {
  const lamps = lampSpots(owns);
  for (let tries = 0; tries < 20; tries++) {
    const l = lamps[Math.floor(Math.random() * lamps.length)];
    const x = Math.round(l.x + rand(-22, 22));
    const y = Math.round(l.y + rand(4, 20));
    const crowded = Object.values(world.chores).some((c) => Math.hypot(c.x - x, c.y - y) < 18);
    if (inIslandXY(x, y) && !nearBuilding(x, y, 6) && !crowded) return add({ id: newId("dust"), kind: "dust", x, y, reward: DUST_REWARD });
  }
}

function spawnMeteor(delay = 0) {
  for (let tries = 0; tries < 40; tries++) {
    const x = Math.round(rand(80, WORLD_W - 80));
    const y = Math.round(rand(80, WORLD_H - 80));
    if (!inIslandXY(x, y) || !inIslandXY(x, y + 12) || nearBuilding(x, y, 20) || Math.hypot(x - PLAZA.x, y - PLAZA.y) < 170) continue;
    const landsAt = Date.now() + delay + WARNING_MS;
    return add({ id: newId("meteor"), kind: "meteor", x, y, reward: METEOR_REWARD, landsAt, expires: landsAt + COOL_MS });
  }
}

function tick() {
  const now = Date.now();
  const dust = Object.values(world.chores).filter((c) => c.kind === "dust").length;
  if (now >= nextDust) {
    if (dust < MAX_DUST) spawnDust();
    nextDust = now + rand(40_000, 80_000);
  }
  if (now >= nextMeteor) {
    // Now and then a proper shower.
    const count = Math.random() < 0.15 ? 3 + Math.floor(Math.random() * 2) : 1;
    for (let i = 0; i < count; i++) spawnMeteor(i * 2500);
    nextMeteor = now + rand(90_000, 180_000);
  }
  for (const c of Object.values(world.chores)) {
    if (c.expires && now > c.expires) {
      delete world.chores[c.id];
      savePersist();
      emit({ type: "chore_gone", id: c.id });
    }
  }
}

/** Dev/demo: summon a meteor (or a shower) or a dust drift right now. */
export function devSpawn(kind: "meteor" | "dust") {
  if (kind === "dust") return spawnDust();
  for (let i = 0; i < 3; i++) spawnMeteor(i * 2500);
}

export function clearChore(id: string): { ok: true; reward: number; kind: "dust" | "meteor"; x: number; y: number } | { ok: false; reason: string } {
  // Own keys only: "__proto__" or "constructor" must not look like a chore.
  const c = typeof id === "string" && Object.hasOwn(world.chores, id) ? world.chores[id] : undefined;
  if (!c || !Number.isFinite(c.reward)) return { ok: false, reason: "already gone" };
  if (c.landsAt && Date.now() < c.landsAt) return { ok: false, reason: "it hasn't landed yet!" };
  delete world.chores[id];
  world.coins += c.reward;
  savePersist();
  return { ok: true, reward: c.reward, kind: c.kind, x: c.x, y: c.y };
}

// ---------------------------------------------------------------- villager chores

const CHORE_PROMPTS: Partial<Record<VillagerId, string>> = {
  postmaster:
    "Chore round (nobody asked, keep it tiny): check the player's unread inbox once and reply with a one-line heads-up about anything important. Don't open every email, and don't draft or send anything.",
  timekeeper: "Chore round (keep it tiny): look at the player's calendar for the next 24 hours and reply with a one-line heads-up. Don't book anything.",
  scholar: "Chore round (keep it tiny): check what's due in the next 3 days and reply with a one-line heads-up.",
  stargazer: "Chore round (keep it tiny): find one fun piece of space or Moon news from today and share it in one line.",
};

export function setChoreOptIn(v: VillagerId, enabled: boolean) {
  if (!CHORE_PROMPTS[v]) return;
  world.choreOptIn[v] = enabled;
  // First round comes a minute after opting in, not immediately.
  if (enabled) world.lastChoreAt[v] = Date.now() - (CHORE_EVERY_MIN - 1) * 60_000;
  savePersist();
  emit({ type: "chore_optin", optIn: world.choreOptIn });
}

function villagerChores() {
  const now = Date.now();
  for (const [v, on] of Object.entries(world.choreOptIn) as [VillagerId, boolean][]) {
    if (!on || !isResident(v) || isBusy(v)) continue;
    if (now - (world.lastChoreAt[v] ?? 0) < CHORE_EVERY_MIN * 60_000) continue;
    world.lastChoreAt[v] = now;
    savePersist();
    void startTask(v, CHORE_PROMPTS[v]!, "chore");
  }
}

export function startChores() {
  // A few drifts to sweep from the start (stardust for the first repair).
  const dust = Object.values(world.chores).filter((c) => c.kind === "dust").length;
  for (let i = dust; i < 3; i++) spawnDust();
  setInterval(tick, 5_000);
  setInterval(villagerChores, 30_000);
}

