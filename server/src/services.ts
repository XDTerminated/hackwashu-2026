// The line between the game and the player's real accounts. Every read or
// write goes through here: live account if connected, labeled sample data if
// the player chose "use sandbox for now". Also owns who has moved in and the
// quest chain that unlocks them.

import {
  BUILDINGS,
  QUESTS,
  VILLAGER_HOME,
  VILLAGER_SERVICE,
  type Connections,
  type Service,
  type VillagerId,
} from "../../shared/game.js";
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

export function isResident(v: VillagerId): boolean {
  if (v === "jade_rabbit") return true; // the guide is always home
  const service = VILLAGER_SERVICE[v];
  return owns(VILLAGER_HOME[v]) && (!service || service === "web" || ready(service));
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
  checkArrivals();
}

// ---------------------------------------------------------------- quests

function reveal(b: keyof typeof BUILDINGS) {
  if (world.progress.revealed.includes(b)) return;
  world.progress.revealed.push(b);
  savePersist();
  emit({ type: "plot_revealed", building: b });
}

function advance(amount: number) {
  const q = QUESTS[world.progress.quest];
  if (!q) return;
  world.progress.count += amount;
  if (world.progress.count < q.goal) {
    emit({ type: "quest", progress: world.progress, coins: world.coins });
    return;
  }
  world.progress.quest += 1;
  world.progress.count = 0;
  world.coins += q.bonus;
  for (const b of q.reveals) reveal(b);
  savePersist();
  emit({ type: "quest", progress: world.progress, completed: q.id, story: q.story, bonus: q.bonus, coins: world.coins });
}

/** Dev/demo prep: finish the current quest outright. */
export function devCompleteQuest() {
  const q = QUESTS[world.progress.quest];
  if (q) advance(q.goal - world.progress.count);
}

/** A villager finished a task the player gave them. */
export function onTaskDone(v: VillagerId, delegatedTo: Set<VillagerId>) {
  const q = QUESTS[world.progress.quest];
  if (!q || q.villager !== v) return;
  if (q.counts.teamTask ? delegatedTo.size >= 2 : !q.counts.tool) advance(1);
}

/** A tool succeeded. */
export function onToolOk(v: VillagerId, tool: string) {
  const q = QUESTS[world.progress.quest];
  if (q && q.villager === v && q.counts.tool === tool) advance(1);
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
