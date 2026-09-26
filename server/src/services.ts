// The line between the game and the player's real accounts. Every read or
// write goes through here: live account if connected, labeled sample data if
// the player chose "use sandbox for now". Also owns who has moved in: each
// neighbor's lot is a ruin to clear, repair, build on and decorate.

import {
  BUILDINGS,
  MATERIALS,
  MATERIAL_NAME,
  MATERIAL_SOURCE,

  VILLAGER_SERVICE,
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
  return world.progress.movedIn.includes(v);
}

/** Moved in, but their account isn't connected (and no sample data chosen): they can't work yet. */
export function needsConnect(v: VillagerId): Service | null {
  const service = VILLAGER_SERVICE[v];
  return service && service !== "web" && isResident(v) && !ready(service) ? service : null;
}

export function residents(): VillagerId[] {
  return (["jade_rabbit", ...AGENTS] as VillagerId[]).filter(isResident);
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
  announceProgress({ moonstone: 1 });
  return null;
}

/** What's still missing for a repair ("2 more stardust (sweep moondust drifts)"), or null. */
export function missingFor(needs: Partial<Materials>): string | null {
  const short = MATERIALS.filter((m) => (needs[m] ?? 0) > world.materials[m]);
  if (!short.length) return null;
  return short.map((m) => `${(needs[m] ?? 0) - world.materials[m]} more ${MATERIAL_NAME[m]} (${MATERIAL_SOURCE[m]})`).join(", ");
}

export function repairLot(b: BuildingId): string | null {
  const d = workable(b);
  if (!d) return "There's nothing to repair there.";
  const lot = lotOf(d);
  if (lot.repaired) return null;
  if (lot.cleared.length < d.rubble) return "Clear the rubble off the lot first.";
  const missing = missingFor(d.repair);
  if (missing) return `The foundation needs ${missing}.`;
  for (const m of MATERIALS) world.materials[m as Material] -= d.repair[m] ?? 0;
  lot.repaired = true;
  savePersist();
  announceProgress();
  return null;
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

/** Different things this neighbor loves, in their yard. */
export function lovedInYard(v: VillagerId) {
  return happinessFor(v, world.decos).items.filter((i) => i.loved).length;
}

/** After building or decorating: is the next neighbor's home ready? Then they move in. */
export function checkMoveIn() {
  const d = currentMoveIn(world.progress);
  if (!d || !owns(d.home) || lovedInYard(d.villager) < d.loves) return;
  world.progress.movedIn.push(d.villager);
  world.coins += d.gift;
  const next = currentMoveIn(world.progress);
  if (d.villager === "postmaster") reveal("rocket_pad");
  if (next) reveal(next.home);
  savePersist();
  const now = residents();
  lastResidents = new Set(now);
  emit({ type: "villager_arrived", villager: d.villager, residents: now, rabbitTeamwork: rabbitTeamwork(), hello: d.hello, gift: d.gift, next: next?.villager ?? null });
  announceProgress();
}

/** Dev/demo prep: finish the current lot outright (materials, house, a loved decoration's worth). */
export function devMoveIn() {
  const d = currentMoveIn(world.progress);
  if (!d) return;
  world.progress.lots[d.home] = { cleared: [...Array(d.rubble).keys()], repaired: true };
  world.buildings[d.home] = true;
  if (d.home === "post_office") world.buildings.mailbox = true;
  world.progress.movedIn.push(d.villager);
  const next = currentMoveIn(world.progress);
  if (d.villager === "postmaster") reveal("rocket_pad");
  if (next) reveal(next.home);
  savePersist();
  lastResidents = new Set(residents());
  emit({ type: "building_built", building: d.home, coins: world.coins });
  emit({ type: "villager_arrived", villager: d.villager, residents: residents(), rabbitTeamwork: rabbitTeamwork(), hello: d.hello, gift: 0, next: next?.villager ?? null });
  announceProgress();
}

export function devMaterials() {
  gain({ moonstone: 10, stardust: 10, shard: 3 });
}

/** The next step for the lot being worked on, in words (for Yutu's prompt). */
export function nextStep(): string {
  const n = sharedNextStep({ progress: world.progress, materials: world.materials, buildings: world.buildings, coins: world.coins, decos: world.decos });
  return n ? `${n.step.text} (for ${BUILDINGS[n.def.home].name}).` : "Everyone is home.";
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
