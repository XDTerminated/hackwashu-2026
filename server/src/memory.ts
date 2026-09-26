// Villager relationships. Each villager keeps their own memory of the player
// (recent texts and visits, plus facts worth keeping) and a friendship score,
// saved with the colony so it survives restarts and new browsers.

import { heartsFor, type VillagerId } from "../../shared/game.js";
import { emit, savePersist, world, type VillagerMemory } from "./world.js";

const LOG_MAX = 60;
const FACTS_MAX = 24;
/** Friendship earned per day per villager is capped so spamming texts doesn't max it out. */
const POINTS_PER_DAY = 8;

export function memoryOf(v: VillagerId): VillagerMemory {
  return (world.memory[v] ??= { log: [], facts: [], points: 0 });
}

export function remember(v: VillagerId, player: string, reply: string, via: "text" | "visit") {
  const m = memoryOf(v);
  const at = Date.now();
  m.log.push({ who: "player", text: player.slice(0, 600), via, at }, { who: "me", text: reply.slice(0, 600), via, at });
  if (m.log.length > LOG_MAX) m.log.splice(0, m.log.length - LOG_MAX);
  savePersist();
}

export function addFacts(v: VillagerId, facts: string[]) {
  const m = memoryOf(v);
  for (const raw of facts) {
    const f = raw.trim().replace(/\s+/g, " ").slice(0, 160);
    if (!f || m.facts.some((x) => x.toLowerCase() === f.toLowerCase())) continue;
    m.facts.push(f);
  }
  if (m.facts.length > FACTS_MAX) m.facts.splice(0, m.facts.length - FACTS_MAX);
  savePersist();
}

/** Visits count double: texting keeps in touch, but showing up matters more. */
export function befriend(v: VillagerId, via: "text" | "visit") {
  const m = memoryOf(v);
  const today = new Date().toDateString();
  if (m.day !== today) {
    m.day = today;
    m.dayPoints = 0;
  }
  const gain = Math.min(via === "visit" ? 2 : 1, POINTS_PER_DAY - (m.dayPoints ?? 0));
  if (gain <= 0) return;
  const before = heartsFor(m.points);
  m.points += gain;
  m.dayPoints = (m.dayPoints ?? 0) + gain;
  savePersist();
  const hearts = heartsFor(m.points);
  emit({ type: "friendship", villager: v, points: m.points, hearts, ...(hearts > before ? { levelUp: true } : {}) });
}

const BONDS = [
  "you've only just met - be friendly, a little curious about them",
  "acquaintances - you're warming up to each other",
  "getting friendly - you enjoy their company",
  "friends - relaxed, you tease a little and share things about your own day",
  "close friends - you look out for them and it shows",
  "best friends - you'd do anything for them, and they know it",
];

function ago(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

/**
 * What goes into a villager's system prompt so they act like they know the
 * player. `transcript` adds the recent exchanges (for in-person tasks, which
 * don't otherwise see the text history).
 */
export function memoryNote(v: VillagerId, transcript: boolean): string {
  const m = memoryOf(v);
  const parts = [`\n\nYOUR FRIENDSHIP WITH THE PLAYER: ${heartsFor(m.points)}/5 hearts - ${BONDS[heartsFor(m.points)]}.`];
  if (m.facts.length) {
    parts.push(`Things you remember about them:\n${m.facts.map((f) => `- ${f}`).join("\n")}`);
    parts.push("Bring these up when they fit naturally, the way a friend would - never recite the list.");
  }
  const last = m.log[m.log.length - 1];
  if (last) parts.push(`You last talked ${ago(Date.now() - last.at)} (${last.via === "text" ? "by text" : "in person"}).`);
  else parts.push("This is the first time you've talked.");
  if (transcript && m.log.length) {
    const lines = m.log.slice(-8).map((l) => `${l.who === "player" ? "Player" : "You"} (${l.via === "text" ? "text" : "in person"}): ${l.text}`);
    parts.push(`Your most recent conversation:\n${lines.join("\n")}`);
  }
  return parts.join("\n");
}
