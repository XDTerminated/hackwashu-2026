// Texting a villager (MoonPad or a real phone over iMessage). A text goes to
// the villager themselves, tools and all: ask Hoot to check your mail by text
// and he checks it; small talk is just small talk. Replies come back as texts,
// and every chat is remembered.

import Anthropic from "@anthropic-ai/sdk";
import { BUILDINGS, VILLAGER_HOME, type VillagerId } from "../../shared/game.js";
import { BRAIN, friendlyError, startTask } from "./agents.js";
import { chatGroq, clean } from "./groq.js";
import * as services from "./services.js";
import { nameOf, personaFor } from "./villagers.js";
import { emit, owns } from "./world.js";

const MODEL = "claude-opus-5";
let client: Anthropic | null = null;

async function askClaude(system: string, messages: { role: "user" | "assistant"; content: string }[]) {
  client ??= new Anthropic();
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system,
    messages,
  });
  if (res.stop_reason === "refusal") return "Hmm, moondust in my ears - let's talk about something else?";
  return res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export function splitNotes(raw: string): { reply: string; facts: string[] } {
  const facts: string[] = [];
  const kept = raw.split("\n").filter((line) => {
    const m = /^\s*REMEMBER:\s*(.+)$/i.exec(line);
    if (m) facts.push(m[1]);
    return !m;
  });
  return { reply: clean(kept.join("\n")), facts };
}

/** Longer than this and an in-person answer sounds like a report read aloud. */
const TALK_MAX = 260;

export function tooLongToSay(text: string) {
  return text.length > TALK_MAX;
}

/**
 * Retell a long in-person answer (a web search, an inbox rundown) as something
 * you'd actually say: the highlight, then an offer of more. Small models don't
 * always keep it short on their own, so this is the safety net.
 */
export async function retell(v: VillagerId, asked: string, answer: string): Promise<string> {
  // Nova is the colony's search engine: her spoken answer keeps the answer, its specifics and the source.
  const how =
    v === "stargazer"
      ? `Now SAY the answer out loud: 1-3 short sentences, under 60 words. Your first sentence IS the answer
to their question, with the specifics that matter (numbers, dates, names, places); then say where it's
from ("NASA says..."). No warm-up, no small talk, no feelings about it, nothing tacked on at the end.`
      : `Now SAY it to them out loud, the way you'd tell a friend: 1-3 short sentences, under 45 words. Lead
with what they most want to know. Only if there's clearly more they'd want, offer it in a few words
("Want the rest?"). Nothing else tacked on at the end.`;
  const system = `${personaFor(v)}

The player is standing in front of you and just asked you something. You've already done the work;
below is everything you found. ${how} No lists, links, markdown or citation marks.
Keep every fact exactly as you found it: leave details out, but never change or add one (times,
dates, names and numbers stay word for word). Reply with only the words you say.`;
  const messages = [{ role: "user" as const, content: `They asked: "${asked}"\n\nWhat you found:\n${answer}` }];
  const raw = BRAIN === "claude" ? await askClaude(system, messages) : await chatGroq(v, system, messages);
  return clean(raw);
}

const queues = new Map<VillagerId, Promise<unknown>>();

/** A text to a villager. Resolves with their reply (also emitted as a "text" event). */
export function chatText(v: VillagerId, text: string, via: "moonpad" | "phone"): Promise<string> {
  const run = async () => {
    emit({ type: "text", villager: v, direction: "in", text, via });
    const reply = (r: string) => (emit({ type: "text", villager: v, direction: "out", text: r, via }), r);

    if (!services.isResident(v)) {
      const home = BUILDINGS[VILLAGER_HOME[v]].name;
      return reply(owns(VILLAGER_HOME[v]) ? `(no signal - ${nameOf(v)} hasn't moved in yet. Put something they love in the ${home}'s yard.)` : `(no signal - ${nameOf(v)} hasn't moved in. Fix up the ${home} lot first.)`);
    }

    try {
      // The real villager answers: tools, memory and all (see startTask's "text" audience).
      const out = await startTask(v, text, via);
      return reply(out || "🌙");
    } catch (error) {
      console.error(`[chat] ${v} failed:`, error);
      return reply(friendlyError(error));
    }
  };
  // One conversation at a time per villager, so replies stay in order.
  const next = (queues.get(v) ?? Promise.resolve()).then(run, run);
  queues.set(v, next);
  return next;
}
