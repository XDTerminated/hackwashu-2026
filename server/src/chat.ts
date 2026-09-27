// Texting a villager (MoonPad or a real phone over iMessage). Texts are for
// the relationship, not for work: the villager chats with no tools and asks
// you to visit their house for anything real. Every chat is remembered.

import Anthropic from "@anthropic-ai/sdk";
import { BUILDINGS, VILLAGER_HOME, type VillagerId } from "../../shared/game.js";
import { BRAIN, friendlyError } from "./agents.js";
import { chatGroq, clean } from "./groq.js";
import { addFacts, befriend, memoryNote, memoryOf, remember } from "./memory.js";
import * as services from "./services.js";
import { nameOf, personaFor } from "./villagers.js";
import { emit, owns, setVillager, world } from "./world.js";

const MODEL = "claude-opus-5";
const HISTORY_LINES = 24;

let client: Anthropic | null = null;

/** What each villager can do if you come to their house (so they can invite you over for it). */
const IN_PERSON: Record<VillagerId, string> = {
  jade_rabbit: "plan bigger jobs and send neighbors off to do the pieces",
  postmaster: "read the player's real inbox, draft replies and send mail",
  timekeeper: "check the player's real calendar and book events",
  scholar: "look up the player's Canvas courses, assignments and announcements",
  stargazer: "search Earth's web for answers",
};

function chatSystem(v: VillagerId): string {
  const home = BUILDINGS[VILLAGER_HOME[v]].name;
  return `${personaFor(v)}${memoryNote(v, false)}

RIGHT NOW YOU ARE TEXTING the player on their MoonPad. Texting is how the two of you keep in touch
and get to know each other - ask about their day, share yours on the Moon, remember what they tell
you, follow up on things from before.

Over text you have NO tools and can't look anything up. At your ${home} you can ${IN_PERSON[v]} -
so if they ask for real work (email, calendar, Canvas, a web search, anything that needs checking
or doing), don't do it, guess, or make up an answer: say you'd love to help and ask them to come by
the ${home} and ask you there. You can still chat about it.

Keep texts short like real texts: 1-3 sentences, no lists.

If they tell you something worth remembering long-term (their name, plans, classes, people in
their life, likes, worries, how something went), add one extra line at the very end:
REMEMBER: <the fact, in a few words>
Use at most one REMEMBER line per text, and only for something not already in what you remember.
REMEMBER lines are private notes the player never sees.`;
}

/** Earlier texts and visits become the chat history, so the villager picks up where you left off. */
function history(v: VillagerId, text: string) {
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (const l of memoryOf(v).log.slice(-HISTORY_LINES)) {
    const role = l.who === "player" ? "user" : "assistant";
    const content = l.via === "visit" && l.who === "player" ? `(in person at your house) ${l.text}` : l.text;
    const prev = msgs[msgs.length - 1];
    if (prev?.role === role) prev.content += `\n${content}`;
    else msgs.push({ role, content });
  }
  if (msgs[0]?.role === "assistant") msgs.shift();
  const prev = msgs[msgs.length - 1];
  if (prev?.role === "user") prev.content += `\n${text}`;
  else msgs.push({ role: "user", content: text });
  return msgs;
}

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

const WORK = /\b(check|send|email|e-mail|mail|inbox|book|schedule|calendar|event|meeting|search|look ?up|find|google|canvas|assignment|due|grade|homework)\b/i;
const SMALL_TALK = [
  "Hi hi! The craters are extra sparkly today. How's your day going?",
  "Aw, thanks for texting! I was just watching Earthrise and thinking about you.",
  "Ha! Tell me more - it's quiet up here, I love hearing about your day.",
];
let mockTurn = 0;

function mockReply(v: VillagerId, text: string): string {
  if (WORK.test(text)) return `Ooh, I'd love to help with that! Come by the ${BUILDINGS[VILLAGER_HOME[v]].name} and ask me in person - I can't do it over text.`;
  return SMALL_TALK[mockTurn++ % SMALL_TALK.length];
}

/** Pull the private REMEMBER notes out of a reply. */
function splitNotes(raw: string): { reply: string; facts: string[] } {
  const facts: string[] = [];
  const kept = raw.split("\n").filter((line) => {
    const m = /^\s*REMEMBER:\s*(.+)$/i.exec(line);
    if (m) facts.push(m[1]);
    return !m;
  });
  return { reply: clean(kept.join("\n")), facts };
}

const queues = new Map<VillagerId, Promise<unknown>>();

/** A text to a villager. Resolves with their reply (also emitted as a "text" event). */
export function chatText(v: VillagerId, text: string, via: "moonpad" | "phone"): Promise<string> {
  const run = async () => {
    emit({ type: "text", villager: v, direction: "in", text, via });
    const reply = (r: string) => (emit({ type: "text", villager: v, direction: "out", text: r, via }), r);

    if (!services.isResident(v)) {
      const home = BUILDINGS[VILLAGER_HOME[v]].name;
      return reply(owns(VILLAGER_HOME[v]) ? `(no signal - ${nameOf(v)} is still on Earth. Connect their account at the ${home}.)` : `(no signal - ${nameOf(v)} hasn't moved in. Build the ${home} first.)`);
    }

    const texting = world.villagers[v].status === "idle";
    if (texting) setVillager(v, { activity: "texting you" });
    try {
      const raw = BRAIN === "mock" ? mockReply(v, text) : BRAIN === "claude" ? await askClaude(chatSystem(v), history(v, text)) : await chatGroq(v, chatSystem(v), history(v, text));
      const { reply: said, facts } = splitNotes(raw);
      const out = said || "🌙";
      remember(v, text, out, "text");
      if (facts.length) addFacts(v, facts);
      befriend(v, "text");
      return reply(out);
    } catch (error) {
      console.error(`[chat] ${v} failed:`, error);
      return reply(friendlyError(error));
    } finally {
      if (texting && world.villagers[v].status === "idle") setVillager(v, { activity: "relaxing" });
    }
  };
  // One conversation at a time per villager, so replies stay in order.
  const next = (queues.get(v) ?? Promise.resolve()).then(run, run);
  queues.set(v, next);
  return next;
}
