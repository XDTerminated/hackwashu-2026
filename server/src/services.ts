// The line between the game and the player's real accounts. Every read or
// write goes through here: live account if connected, labeled sample data if
// the player chose "use sandbox for now". Also owns the town and who has moved
// in: each neighbor's lot is a ruin to clear and repair (as many as the Town
// Hall has room for), and the town's landmarks go up stage by stage.

import {
  BUILDINGS,
  MATERIALS,
  MATERIAL_NAME,
  MATERIAL_SOURCE,

  VILLAGER_SERVICE,
  MOVE_INS,
  currentMoveIn,
  moveInAt,
  type BuildingId,
  type Connections,
  type Material,
  type Materials,
  type MoveInDef,
  type Service,
  type VillagerId,
} from "../../shared/game.js";
import { happinessFor } from "../../shared/decor.js";
import { SPOTS } from "../../shared/layout.js";
import { ARRIVAL_GIFTS, ITEMS, LANDMARKS, NODES, NODE_MATERIAL, STAGE_NAME, TASKS, digSpots, neighborCap, openAt, upgradeBlocker, type LandmarkId, type TownTask } from "../../shared/town.js";
import { nextStep as sharedNextStep } from "../../shared/movein.js";
import * as canvas from "./connectors/canvas.js";
import * as google from "./connectors/google.js";
import * as sandbox from "./sandbox.js";
import { emit, owns, savePersist, world } from "./world.js";

export type Source = "live" | "sandbox";

let photonState: Connections["photon"] = { connected: false, phoneLinked: false, phones: [] };
let webAvailable = false;

export function setPhotonState(s: Connections["photon"]) {
  photonState = s;
  announceConnections();
}

export function setWebAvailable(v: boolean) {
  webAvailable = v;
}

export function connections(): Connections {
  return { google: google.googleStatus(), canvas: canvas.canvasStatus(), photon: photonState, web: { connected: webAvailable } };
}

function live(service: Service): boolean {
  if (service === "google") return google.googleStatus().connected;
  if (service === "canvas") return canvas.canvasStatus().connected;
  return webAvailable;
}

/** Can this service be used right now — for real, or on sample data the player opted into? */
export function ready(service: Service): boolean {
  return live(service) || !!world.progress.sandbox[service];
}

export function sourceOf(service: Service): Source {
  return live(service) ? "live" : "sandbox";
}

// ---------------------------------------------------------------- residents

const AGENTS: VillagerId[] = ["stargazer", "postmaster", "timekeeper", "scholar"];

/** Yutu and Nova were here first; everyone else moves in once their lot's checklist is done. */
export function isResident(v: VillagerId): boolean {
  if (v === "jade_rabbit" || v === "stargazer") return true;
  // Ada runs the Office: she's there as soon as it is
  if (v === "manager") return !!world.buildings.office;
  return world.progress.movedIn.includes(v);
}

/** Moved in, but their account isn't connected (and no sample data chosen): they can't work yet. */
export function needsConnect(v: VillagerId): Service | null {
  const service = VILLAGER_SERVICE[v];
  return service && service !== "web" && isResident(v) && !ready(service) ? service : null;
}

export function residents(): VillagerId[] {
  return (["jade_rabbit", ...AGENTS, "manager"] as VillagerId[]).filter(isResident);
}

/** The Rabbit starts as a guide and gains her coordinating powers with two agent neighbors. */
export function rabbitTeamwork(): boolean {
  return AGENTS.filter(isResident).length >= 2;
}

let lastResidents = new Set<VillagerId>();

export function initResidents() {
  lastResidents = new Set(residents());
}

/** Call after anything that could move someone in: building, connecting, choosing sandbox. */
export function checkArrivals() {
  const now = residents();
  for (const v of now) {
    if (lastResidents.has(v)) continue;
    emit({ type: "villager_arrived", villager: v, residents: now, rabbitTeamwork: rabbitTeamwork() });
    if (v === "postmaster" && !world.progress.revealed.includes("rocket_pad")) reveal("rocket_pad");
  }
  lastResidents = new Set(now);
}

export function announceConnections() {
  emit({ type: "connections", connections: connections() });
  checkArrivals();
}

export function chooseSandbox(service: Service) {
  world.progress.sandbox[service] = true;
  savePersist();
  emit({ type: "sandbox", sandbox: { ...world.progress.sandbox } });
  announceConnections();
}

// ---------------------------------------------------------------- moving in

function reveal(b: BuildingId) {
  if (world.progress.revealed.includes(b)) return;
  world.progress.revealed.push(b);
  savePersist();
  emit({ type: "plot_revealed", building: b });
}

/** Tell the game: lots, materials and coins (and what was just picked up, and where). */
export function announceProgress(gained?: Partial<Materials>, at?: { x: number; y: number }) {
  emit({ type: "progress", progress: world.progress, materials: { ...world.materials }, coins: world.coins, ...(gained ? { gained } : {}), ...(at ? { at } : {}) });
}

/** Picked something up (sweeping, a meteor rock, ...). */
export function gain(what: Partial<Materials>, at?: { x: number; y: number }) {
  for (const m of MATERIALS) world.materials[m] += what[m] ?? 0;
  savePersist();
  announceProgress(what, at);
}

const lotOf = (d: MoveInDef) => (world.progress.lots[d.home] ??= { cleared: [], repaired: false });

/** The lot you can work on: revealed and not yet anyone's home. */
function workable(b: BuildingId): MoveInDef | null {
  const d = moveInAt(b);
  if (!d || !world.progress.revealed.includes(b) || world.progress.movedIn.includes(d.villager)) return null;
  return d;
}

export function clearRubble(b: BuildingId, index: number): string | null {
  const d = workable(b);
  if (!d) return "There's nothing to clear there.";
  const lot = lotOf(d);
  if (!Number.isInteger(index) || index < 0 || index >= d.rubble || lot.cleared.includes(index)) return null;
  lot.cleared.push(index);
  world.materials.moonstone += 1;
  savePersist();
  emit({ type: "rubble_cleared", building: b, index });
  announceProgress({ moonstone: 1 });
  return null;
}

/** What's still missing for a repair ("2 more stardust (sweep moondust drifts)"), or null. */
export function missingFor(needs: Partial<Materials>): string | null {
  const short = MATERIALS.filter((m) => (needs[m] ?? 0) > world.materials[m]);
  if (!short.length) return null;
  return short.map((m) => `${(needs[m] ?? 0) - world.materials[m]} more ${MATERIAL_NAME[m]} (${MATERIAL_SOURCE[m]})`).join(", ");
}

/** Repairing a lot moves its neighbor right in (if the Town Hall has room). */
export function repairLot(b: BuildingId): string | null {
  const d = workable(b);
  if (!d) return "There's nothing to repair there.";
  const lot = lotOf(d);
  if (lot.repaired) return null;
  if (lot.cleared.length < d.rubble) return "Clear the rubble off the lot first.";
  const cap = neighborCap(world.progress.town);
  if (world.progress.movedIn.length >= cap) return `The Town Hall only has room for ${cap} new neighbor${cap === 1 ? "" : "s"} right now. Upgrade it to make room.`;
  const missing = missingFor(d.repair);
  if (missing) return `The foundation needs ${missing}.`;
  for (const m of MATERIALS) world.materials[m as Material] -= d.repair[m] ?? 0;
  lot.repaired = true;
  moveIn(d);
  return null;
}

/** They're home: the house stands, they arrive (with a gift), and the town may hand you a story item. */
function moveIn(d: MoveInDef, gift = d.gift) {
  world.progress.movedIn.push(d.villager);
  world.buildings[d.home] = true;
  if (d.home === "post_office") world.buildings.mailbox = true;
  world.coins += gift;
  if (d.villager === "postmaster") reveal("rocket_pad");
  savePersist();
  const now = residents();
  lastResidents = new Set(now);
  emit({ type: "building_built", building: d.home, coins: world.coins });
  emit({ type: "villager_arrived", villager: d.villager, residents: now, rabbitTeamwork: rabbitTeamwork(), hello: d.hello, gift, next: null });
  const nth = world.progress.movedIn.length;
  const present = ARRIVAL_GIFTS.find((g) => g.nth === nth);
  const town = world.progress.town;
  if (present && !town.items.includes(present.item) && !town.used.includes(present.item)) {
    town.items.push(present.item);
    savePersist();
    emit({ type: "item_found", item: present.item, by: present.by === "newcomer" ? d.villager : present.by, text: present.text });
  }
  announceProgress();
}

// ---------------------------------------------------------------- the town

/** Take a landmark up a stage (materials, and for the grand stage a story item and maybe a real job). */
export function upgradeLandmark(id: LandmarkId): string | null {
  const town = world.progress.town;
  if (!LANDMARKS[id]) return null;
  const blocked = upgradeBlocker(town, id, world.materials);
  if (blocked) return blocked;
  const up = LANDMARKS[id].up[town.stages[id] as 0 | 1];
  for (const m of MATERIALS) world.materials[m] -= up.needs[m] ?? 0;
  if (up.item) {
    town.items = town.items.filter((i) => i !== up.item);
    town.used.push(up.item);
  }
  town.stages[id] = (town.stages[id] + 1) as 1 | 2;
  savePersist();
  emit({ type: "landmark_upgraded", landmark: id, stage: town.stages[id] });
  announceProgress();
  return null;
}

const today = () => new Date().toDateString();

/** Pick up ice, scrap, helium-3 or glow ore at one of the spots (they grow back each day). */
export function harvest(id: string): string | null {
  const node = NODES.find((n) => n.id === id);
  if (!node) return null;
  const town = world.progress.town;
  if (!openAt(town, node.x, node.y)) return "A rockfall blocks the way. Fix the roads first.";
  if (town.day !== today()) {
    town.day = today();
    town.harvested = [];
  }
  if (town.harvested.includes(id)) return "Picked clean for today. It'll be back tomorrow.";
  town.harvested.push(id);
  emit({ type: "harvested", id, x: node.x, y: node.y });
  gain({ [NODE_MATERIAL[node.kind]]: 1 }, { x: node.x, y: node.y });
  return null;
}

/** Dig up a story item at a sparkling spot. */
export function dig(id: string): string | null {
  const town = world.progress.town;
  const spot = digSpots(SPOTS.town_hall).find((s) => s.id === id);
  if (!spot || town.dug.includes(id)) return null;
  if (!spot.when(town)) return "Nothing to dig here yet.";
  town.dug.push(id);
  if (!town.items.includes(spot.item) && !town.used.includes(spot.item)) town.items.push(spot.item);
  savePersist();
  emit({ type: "item_found", item: spot.item, x: spot.x, y: spot.y });
  announceProgress();
  return null;
}

/** A real job done for you: some grand stages need one. */
export function taskDone(t: TownTask) {
  const town = world.progress.town;
  if (town.tasks.includes(t)) return;
  town.tasks.push(t);
  savePersist();
  announceProgress();
}

/** Dev/demo: materials, every story item and both tasks, so any stage can be shown. */
export function devTown() {
  const town = world.progress.town;
  for (const i of Object.keys(ITEMS) as (keyof typeof ITEMS)[]) if (!town.items.includes(i) && !town.used.includes(i)) town.items.push(i);
  for (const t of Object.keys(TASKS) as TownTask[]) if (!town.tasks.includes(t)) town.tasks.push(t);
  world.coins += 200;
  gain({ moonstone: 30, stardust: 30, shard: 8, ore: 8, ice: 10, scrap: 8, helium: 8 });
}

/** The town, in words (for Yutu, the mayor). */
export function townNote(): string {
  const town = world.progress.town;
  const stages = (Object.keys(LANDMARKS) as LandmarkId[]).map((id) => `${LANDMARKS[id].name}: ${STAGE_NAME[town.stages[id]]}`).join(", ");
  const cap = neighborCap(town);
  const held = town.items.map((i) => ITEMS[i].name);
  return `The town (you're its mayor): ${stages}. The Town Hall has room for ${cap} new neighbor${cap === 1 ? "" : "s"} (${world.progress.movedIn.length} moved in).${held.length ? ` The player is holding: ${held.join(", ")}.` : ""}`;
}

/** Why a house can't be built yet (its lot isn't ready), or null. */
export function lotBlocker(b: BuildingId): string | null {
  const d = moveInAt(b);
  if (!d || world.progress.movedIn.includes(d.villager)) return null;
  const lot = lotOf(d);
  if (lot.cleared.length < d.rubble) return "Clear the rubble off the lot first.";
  if (!lot.repaired) return "Repair the old foundation first.";
  return null;
}

/** Rubble still on the neighbors' lots (for the daily "clear a rock" request). */
export function rubbleLeft(): number {
  return MOVE_INS.filter((d) => !world.progress.movedIn.includes(d.villager) && world.progress.revealed.includes(d.home)).reduce((n, d) => n + d.rubble - (world.progress.lots[d.home]?.cleared.length ?? 0), 0);
}

/** Different things this neighbor loves, in their yard. */
export function lovedInYard(v: VillagerId) {
  return happinessFor(v, world.decos).items.filter((i) => i.loved).length;
}

/** Dev/demo prep: the next neighbor not home yet moves in outright (never mind the Town Hall). */
export function devMoveIn() {
  const d = currentMoveIn(world.progress);
  if (!d) return;
  world.progress.lots[d.home] = { cleared: [...Array(d.rubble).keys()], repaired: true };
  moveIn(d, 0);
}

/** Dev/demo prep (DEV_TOOLS=1 only): a pile of materials and coins. */
export function devMaterials() {
  world.coins += 100;
  gain({ moonstone: 10, stardust: 10, shard: 3, ore: 2 });
}

/** What to work on next, in words (for Yutu's prompt). */
export function nextStep(): string {
  const n = sharedNextStep({ progress: world.progress, materials: world.materials, buildings: world.buildings, coins: world.coins, decos: world.decos });
  return n ? n.text : "Everyone is home and the town is grand.";
}

// ---------------------------------------------------------------- data access

function pick<T>(service: Service, liveFn: () => Promise<T>, sandboxFn: () => T | Promise<T>): Promise<{ data: T; source: Source }> {
  if (live(service)) return liveFn().then((data) => ({ data, source: "live" as const }));
  if (world.progress.sandbox[service]) return Promise.resolve(sandboxFn()).then((data) => ({ data, source: "sandbox" as const }));
  return Promise.reject(new Error(`${service === "google" ? "Google" : "Canvas"} isn't connected yet`));
}

export const mail = {
  list: (unreadOnly: boolean) => pick("google", () => google.gmailList(unreadOnly), () => sandbox.listInbox(unreadOnly)),
  read: (id: string) => pick("google", () => google.gmailRead(id), () => sandbox.readEmail(id)),
  draft: (to: string, subject: string, body: string, replyTo?: string) =>
    pick("google", () => google.gmailDraft(to, subject, body, replyTo), () => sandbox.draftEmail(to, subject, body, replyTo)),
  getDraft: (id: string) => pick("google", () => google.gmailGetDraft(id), () => sandbox.getDraft(id)),
  send: (id: string) => pick("google", () => google.gmailSend(id), () => sandbox.sendDraft(id)),
};

export const calendar = {
  list: (from: string, to: string) => pick("google", () => google.calendarList(from, to), () => sandbox.listEvents(from, to)),
  create: (title: string, start: string, end: string, notes?: string) =>
    pick("google", () => google.calendarCreate(title, start, end, notes), () => sandbox.createEvent(title, start, end, notes)),
};

export const school = {
  courses: () => pick("canvas", () => canvas.canvasCourses(), () => sandbox.canvasCourses()),
  upcoming: (days: number) => pick("canvas", () => canvas.canvasUpcoming(days), () => sandbox.canvasUpcoming(days)),
  announcements: (days: number) => pick("canvas", () => canvas.canvasAnnouncements(days), () => sandbox.canvasAnnouncements(days)),
};

/** One line per villager for their system prompt: what's real and what's sample data. */
export function accountNote(v: VillagerId): string {
  const service = VILLAGER_SERVICE[v];
  if (!service || service === "web") return "";
  if (live(service)) {
    const who = service === "google" ? google.googleStatus().account : canvas.canvasStatus().account;
    return `\n\nYou are connected to the player's REAL ${service === "google" ? "Google account" : "Canvas"}${who ? ` (${who})` : ""}. Everything you read is their actual data; be careful and concise.`;
  }
  return `\n\nThe player hasn't connected their real ${service === "google" ? "Google account" : "Canvas"} yet, so you're working on SAMPLE data (every tool result says source: "sandbox"). Say so when you report — never present it as their real mail/calendar/classes.`;
}
