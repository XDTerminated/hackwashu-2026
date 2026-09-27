// What villagers say to each other when they're not working. Scripted lines
// are free; "real day" lines reuse facts the villagers already fetched (tool
// results, finished-task summaries) — no new API calls.

import type { VillagerId } from "../../shared/game";
import * as net from "./net";
import { store } from "./store";

type Line = [VillagerId | "A" | "B", string];

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

// ---------------------------------------------------------------- facts

const sessionFacts = new Map<VillagerId, string[]>();

export function initChatter() {
  net.onEvent((e) => {
    if (e.type === "tool_end" && e.ok && !e.result.startsWith("held back")) {
      const list = sessionFacts.get(e.villager) ?? [];
      list.unshift(e.result);
      sessionFacts.set(e.villager, list.slice(0, 6));
    }
  });
}

const firstSentence = (s: string) => {
  const m = /^(.{12,90}?[.!?])(\s|$)/.exec(s.replace(/\s+/g, " ").trim());
  return (m ? m[1] : s.slice(0, 80)).trim();
};

function factsFor(v: VillagerId): string[] {
  const out = [...(sessionFacts.get(v) ?? [])];
  for (const c of store.clods) if (c.villager === v && c.result && c.status === "ready") out.push(c.result);
  for (const l of store.lanterns.slice(-8)) if (l.villager === v) out.push(firstSentence(l.summary));
  return [...new Set(out)].filter((f) => f.length > 3);
}

const REAL: Record<VillagerId, ((f: string) => string)[]> = {
  postmaster: [(f) => `Mail report: ${f}.`, (f) => `Hoo! ${f} - the traveler should know.`, (f) => `Between us: ${f}.`],
  timekeeper: [(f) => `Tick... ${f}.`, (f) => `The calendar says: ${f}.`],
  scholar: [(f) => `Ahem. ${f}.`, (f) => `Heads up for the traveler: ${f}.`],
  stargazer: [(f) => `Guess what I found: ${f}`, (f) => `The telescope says: ${f}`],
  jade_rabbit: [(f) => `I heard: ${f}`],
  manager: [(f) => `Status update: ${f}.`],
  dj: [(f) => `Bzzt! ${f}.`, (f) => `Word on the airwaves: ${f}.`],
  mechanic: [(f) => `Popped the hood: ${f}.`, (f) => `From the Workshop: ${f}.`],
};

const REACT: Record<VillagerId, string[]> = {
  jade_rabbit: ["Good to know!", "I'll keep an ear out.", "The traveler's lucky to have you."],
  postmaster: ["Hoo! Noted.", "I'll file that away.", "Most irregular. Noted."],
  timekeeper: ["Tick-tock, noted.", "I'll make room for it.", "Timing is everything."],
  scholar: ["Fascinating. Citation?", "I'll add it to the archive.", "Hm! Very studious."],
  stargazer: ["Ooh, stellar.", "The stars agree.", "I'll look into it tonight."],
  manager: ["Noted. Adding it to the board.", "Love that. Ship it.", "Let's circle back on that."],
  dj: ["That's a banger of a fact.", "Bzzt! Noted.", "I'll write a song about it."],
  mechanic: ["Huh! Good to know.", "I'll bolt that down.", "Sounds like it needs a tune-up."],
};

// ---------------------------------------------------------------- scripted

const EXCHANGES: { pair?: [VillagerId, VillagerId]; lines: Line[] }[] = [
  { pair: ["postmaster", "timekeeper"], lines: [["postmaster", "Letters arrive, deadlines follow."], ["timekeeper", "Tick-tock. I've made room for both."]] },
  { pair: ["stargazer", "scholar"], lines: [["stargazer", "I found a new star last night!"], ["scholar", "Cite your sources, please."], ["stargazer", "...the sky?"]] },
  { pair: ["jade_rabbit", "stargazer"], lines: [["jade_rabbit", "Anything interesting up there?"], ["stargazer", "Earth. It's always Earth. It's very bright."]] },
  { pair: ["postmaster", "scholar"], lines: [["scholar", "Any letters from the registrar?"], ["postmaster", "Hoo! Nothing I'd call urgent. Yet."]] },
  { pair: ["timekeeper", "jade_rabbit"], lines: [["timekeeper", "The traveler has a busy week."], ["jade_rabbit", "Then let's keep it cozy up here."]] },
  { pair: ["dj", "timekeeper"], lines: [["dj", "What's the tempo today, Cog?"], ["timekeeper", "Sixty beats a minute. Exactly."], ["dj", "Bzzt! Let's speed that up."]] },
  { pair: ["dj", "stargazer"], lines: [["stargazer", "Do you ever pick up signals from space?"], ["dj", "Mostly static. And one very persistent jingle."]] },
  { lines: [["A", "Beautiful Earthrise today."], ["B", "Makes you miss the ocean, doesn't it?"]] },
  { lines: [["A", "Have you tried the moon pies?"], ["B", "Only every single day."]] },
  { lines: [["A", "Do you think the traveler misses Earth?"], ["B", "Every building is another line home."]] },
  { lines: [["A", "Moondust on the paths again..."], ["B", "The traveler will sweep it up. They're good like that."]] },
  { lines: [["A", "Heard any meteors lately?"], ["B", "One nearly landed on my porch!"]] },
  { lines: [["A", "Earth's AIs have podcasts now, apparently."], ["B", "We just have each other. Much better."]] },
  { lines: [["A", "Low gravity is great for my knees."], ["B", "I don't have knees, but I agree."]] },
];

const SOLO: Record<VillagerId, string[]> = {
  jade_rabbit: ["*pounds herbs*", "What a lovely colony.", "Hop hop."],
  postmaster: ["Stamps... envelopes... hoo.", "Everything in its pigeonhole."],
  timekeeper: ["Tick. Tock. Tick.", "Right on schedule."],
  scholar: ["Footnotes are the best part.", "*adjusts spectacles*"],
  stargazer: ["So many stars.", "Is that a comet? No. A smudge."],
  manager: ["Standup in five!", "Who touched the build?"],
  dj: ["*boots up a beat*", "Testing, testing... one two.", "Bzzt! Levels look good."],
  mechanic: ["*clank* ...there we go.", "Where did I put that wrench?", "Tests are green. Probably."],
};

/** A short exchange between two villagers: [speaker, line][]. */
export function conversation(a: VillagerId, b: VillagerId): [VillagerId, string][] {
  const facts = factsFor(a);
  if (facts.length && Math.random() < 0.55) {
    return [
      [a, pick(REAL[a])(pick(facts))],
      [b, pick(REACT[b])],
    ];
  }
  const specific = EXCHANGES.filter((x) => x.pair && ((x.pair[0] === a && x.pair[1] === b) || (x.pair[0] === b && x.pair[1] === a)));
  const pool = specific.length && Math.random() < 0.6 ? specific : EXCHANGES.filter((x) => !x.pair);
  const ex = pick(pool);
  return ex.lines.map(([who, text]) => [who === "A" ? a : who === "B" ? b : who, text]);
}

export function mutter(v: VillagerId): string {
  const facts = factsFor(v);
  return facts.length && Math.random() < 0.4 ? pick(REAL[v])(pick(facts)) : pick(SOLO[v]);
}
