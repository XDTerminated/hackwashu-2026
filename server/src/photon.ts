// Photon Spectrum bridge — the colony's line home, over iMessage.
//
// - Text any villager by name ("Stargazer: when's the next full moon?");
//   anything else goes to the Jade Rabbit. "help" lists who's around.
// - A "!" in the village (an approval) also arrives as a text with a code; reply
//   YES/NO (plus the code when more than one is waiting). Unanswered ones lapse.
// - The Rabbit texts first when you land: "Made it to the Moon?"
//
// - Phones are linked from the in-game MoonPad (enter number → texted code),
//   any number of them (co-op). Texts from any other number are ignored. News
//   and approvals go to every linked phone; replies go back to whoever texted.
//
// Env (Photon dashboard → Settings): SPECTRUM_PROJECT_ID + SPECTRUM_PROJECT_SECRET
// (PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET also work). Optional PLAYER_PHONE
// (E.164) is linked once it first texts the colony (no code needed). PHOTON_TERMINAL=1 adds Photon's
// terminal chat for local testing — it works without any credentials.

import { createHmac, randomBytes, randomInt } from "node:crypto";
import type { Spectrum } from "spectrum-ts";
import { VILLAGER_NAMES, VILLAGER_ROLE, VILLAGER_SHORT, type VillagerId } from "../../shared/game.js";
import { lastApprovalVia } from "./agents.js";
import { chatText } from "./chat.js";
import { registerSharedUser, textUsLink } from "./connectors/photonUsers.js";
import { anyPending, approvalCode, markGameOnly, phoneTarget, resolveApproval } from "./approvals.js";
import { isResident, residents, setPhotonState } from "./services.js";
import { emit, onEvent, savePersist, world } from "./world.js";

type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;
type Space = Parameters<SpectrumApp["send"]>[0];

/**
 * spectrum-ts is loaded on first use, not at startup: hosted copies never start
 * Photon, and the SDK alone costs tens of MB per process.
 */
let sdk: Promise<[typeof import("spectrum-ts"), typeof import("spectrum-ts/providers")]> | null = null;
const loadSdk = () => (sdk ??= Promise.all([import("spectrum-ts"), import("spectrum-ts/providers")]));

let app: SpectrumApp | null = null;
let cloud = false;
/** Open iMessage chats, keyed by phone number (or sender id for other channels). */
const spaces = new Map<string, Space>();
/** Photon user ids + assigned colony numbers for numbers we've registered. */
const registered = new Map<string, { photonUserId: string; line: string }>();
/** Link codes waiting to be texted in from that phone. */
const pendingLinks = new Map<string, { code: string; expires: number; tries: number }>();
/** A wrong code this many times and that phone needs a fresh one. */
const MAX_LINK_TRIES = 5;
/** PLAYER_PHONE from .env: the server's owner vouched for it, so its first text links it (until it's unlinked). */
let envPhone: string | null = null;
/** Same limit as a MoonPad text. */
const MAX_TEXT = 2000;
let linkListener: (phone: string) => void = () => {};

/** Tell the game (all clients) when a phone finishes linking by texting in. */
export function onPhoneLinked(fn: (masked: string) => void) {
  linkListener = (phone) => fn(mask(phone));
}

export function photonReady() {
  return app !== null;
}

export function phoneLinked() {
  return Object.keys(world.phones).length > 0 || spaces.size > 0;
}

const mask = (phone: string) => `•••${phone.replace(/\D/g, "").slice(-4)}`;

/** What clients get instead of the number itself (a keyed hash, so it can't be reversed). */
const ID_KEY = randomBytes(16);
const phoneId = (phone: string) => createHmac("sha256", ID_KEY).update(phone).digest("hex").slice(0, 16);

/**
 * Accepts "(314) 555-0123", "314-555-0123", "+44 20 ..." → E.164, US by default.
 * Anything with stray characters (like "+!314...") is rejected rather than
 * guessed at — silently dropping a character can turn +1 314 into +31 (Netherlands).
 */
export function normalizePhone(input: string): string | null {
  if (!/^[\d\s+().-]+$/.test(input.trim()) || (input.match(/\+/g) ?? []).length > 1 || /.\+/.test(input.trim())) return null;
  const digits = input.replace(/[^\d+]/g, "");
  let e164 = digits.startsWith("+") ? "+" + digits.slice(1).replace(/\+/g, "") : digits;
  if (!e164.startsWith("+")) e164 = e164.length === 10 ? `+1${e164}` : e164.length === 11 && e164.startsWith("1") ? `+${e164}` : `+${e164}`;
  return /^\+\d{8,15}$/.test(e164) ? e164 : null;
}

function publishPhones() {
  setPhotonState({
    connected: app !== null,
    phoneLinked: phoneLinked(),
    phones: Object.values(world.phones).map((p) => ({ id: phoneId(p.phone), masked: mask(p.phone), line: p.line })),
  });
}

async function spaceFor(phone: string): Promise<Space | null> {
  const known = spaces.get(phone);
  if (known) return known;
  if (!app || !cloud) return null;
  // Open (or resume) a 1:1 iMessage chat. On shared-pool plans this is how every conversation starts.
  const [, { imessage }] = await loadSdk();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const space = (await (imessage as any)(app).space.create(phone)) as Space;
  spaces.set(phone, space);
  return space;
}

type LinkResult = { ok: boolean; text: string; line?: string; code?: string; link?: string };

/**
 * Start linking a phone. On Photon's shared pool the colony can't text someone
 * until they've texted it (iMessage anti-spam), so we register the number,
 * then hand back its colony number, a code, and a link that opens Messages
 * with both filled in. Their text arriving completes the link.
 */
export async function startLink(input: string): Promise<LinkResult> {
  if (!app || !cloud) return { ok: false, text: "Photon isn't set up on the colony server (no SPECTRUM_PROJECT_ID/SECRET)." };
  const phone = normalizePhone(input);
  if (!phone) return { ok: false, text: "That doesn't look like a phone number. Try +1 314 555 0123." };
  if (world.phones[phone]) return { ok: false, text: `${mask(phone)} is already linked.` };
  try {
    const user = await registerSharedUser(phone);
    registered.set(phone, { photonUserId: user.id, line: user.assignedPhoneNumber });
    const was = pendingLinks.get(phone);
    const code = was && Date.now() < was.expires ? was.code : String(randomInt(1000, 10000));
    pendingLinks.set(phone, { code, expires: Date.now() + 30 * 60_000, tries: was?.code === code ? was.tries : 0 });
    console.log(`[photon] waiting for ${mask(phone)} to text code to colony line ${mask(user.assignedPhoneNumber)}`);
    return {
      ok: true,
      text: `From ${mask(phone)}, text ${code} to ${user.assignedPhoneNumber} - or scan the code with that phone.`,
      line: user.assignedPhoneNumber,
      code,
      link: `${textUsLink(user.id)}?msg=${encodeURIComponent(`Moon code ${code}`)}`,
    };
  } catch (err) {
    console.error("[photon] couldn't start linking:", err instanceof Error ? err.message : err);
    return { ok: false, text: err instanceof Error ? err.message : "Photon couldn't register that number." };
  }
}

function link(phone: string) {
  if (world.phones[phone]) return;
  world.phones[phone] = { phone, linkedAt: Date.now(), ...registered.get(phone) };
  savePersist();
  console.log(`[photon] linked ${mask(phone)} (${Object.keys(world.phones).length} phone(s))`);
  publishPhones();
  linkListener(phone);
}

/** Unlink by the id clients were given. Their next text won't re-link them: that takes a fresh code. */
export function unlink(id: string) {
  const phone = Object.keys(world.phones).find((p) => phoneId(p) === id);
  if (!phone) return;
  delete world.phones[phone];
  spaces.delete(phone);
  pendingLinks.delete(phone);
  if (envPhone === phone) envPhone = null;
  savePersist();
  publishPhones();
}

const YES = /^\s*(y|yes|yep|yeah|yup|ok|okay|sure|approve|approved|send it|do it|go|👍)\s*[.!]*\s*$/i;
const NO = /^\s*(n|no|nope|nah|stop|cancel|deny|don'?t|👎)\s*[.!]*\s*$/i;

/** One number for the whole colony, so every text says who it's from. */
const SIGNATURE: Record<VillagerId, string> = {
  jade_rabbit: "🐇 Yutu",
  stargazer: "🔭 Nova",
  postmaster: "🦉 Hoot",
  timekeeper: "⏰ Cog",
  scholar: "🎓 Mabel",
  manager: "💼 Ada",
  dj: "🎧 Echo",
  mechanic: "🔧 Tinker",
};

/** "Nova: ...", "@stargazer ...", "hoot, ..." → that villager + the rest (by name or by role). */
function route(text: string): { villager: VillagerId; text: string } {
  const who = new Map<string, VillagerId>();
  for (const v of Object.keys(VILLAGER_SHORT) as VillagerId[]) {
    who.set(VILLAGER_SHORT[v].toLowerCase(), v);
    who.set(VILLAGER_ROLE[v].toLowerCase(), v);
  }
  who.set("rabbit", "jade_rabbit");
  const names = [...who.keys()].sort((a, b) => b.length - a.length).join("|");
  const m = new RegExp(`^\\s*@?\\s*(${names})\\b[\\s:,\\-—]*(.*)$`, "is").exec(text);
  if (m && m[2].trim()) return { villager: who.get(m[1].toLowerCase())!, text: m[2].trim() };
  return { villager: "jade_rabbit", text };
}


export async function startPhoton(): Promise<boolean> {
  const projectId = process.env.SPECTRUM_PROJECT_ID ?? process.env.PHOTON_PROJECT_ID;
  const projectSecret = process.env.SPECTRUM_PROJECT_SECRET ?? process.env.PHOTON_PROJECT_SECRET;
  const useTerminal = process.env.PHOTON_TERMINAL === "1";
  cloud = !!(projectId && projectSecret);
  if (!cloud && !useTerminal) {
    console.log("[photon] no SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET — phone link disabled (PHOTON_TERMINAL=1 to test locally)");
    return false;
  }

  const [{ Spectrum }, { imessage, terminal }] = await loadSdk();
  const providers = [...(cloud ? [imessage.config()] : []), ...(useTerminal ? [terminal.config()] : [])];
  app = cloud
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await Spectrum({ projectId: projectId!, projectSecret: projectSecret!, providers: providers as any })
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await Spectrum({ providers: providers as any });
  console.log(`[photon] connected via ${[cloud && "iMessage", useTerminal && "terminal"].filter(Boolean).join(" + ")}`);
  if (process.env.PLAYER_PHONE && cloud) {
    envPhone = normalizePhone(process.env.PLAYER_PHONE);
    if (!envPhone) console.error("[photon] PLAYER_PHONE in .env isn't a valid number (use +13145550123, digits only) — skipping it");
    else {
      try {
        // Pre-register only: on the shared pool it links once that phone texts the colony.
        if (!world.phones[envPhone]) {
          const r = await startLink(envPhone);
          if (r.ok) console.log(`[photon] PLAYER_PHONE: from that phone, text ${r.code} to ${r.line} to finish linking (or use LINK on the MoonPad).`);
        }
      } catch (err) {
        console.error("[photon] couldn't register PLAYER_PHONE with Photon:", err instanceof Error ? err.message : err);
      }
    }
  }
  publishPhones();

  onEvent((e) => {
    if (e.type === "villager_arrived" && e.villager !== "jade_rabbit") {
      void textPlayer(`${SIGNATURE[e.villager]} just landed on the Moon! Text "${VILLAGER_SHORT[e.villager]}: hi" to say hello.`);
    } else if (e.type === "approval_needed") {
      // Every "!" in the village also buzzes the player's phone.
      // Each carries a code, so a reply says which one it answers. One too long to show
      // whole can only be approved in the colony, where they can read all of it.
      const code = approvalCode(e.approval.id);
      const cut = e.approval.body.length > 280;
      if (cut) markGameOnly(e.approval.id);
      const body = cut ? e.approval.body.slice(0, 277) + "…" : e.approval.body;
      const ask = cut
        ? `It's too long to show here in full, so read it and approve it in the colony (or reply NO ${code} to hold it).`
        : `Reply YES ${code} to go ahead or NO ${code} to hold it.`;
      void textPlayer(`❗ ${SIGNATURE[e.villager]} needs your OK\n${e.approval.title}\n\n"${body}"\n\n${ask}`);
    }
  });

  void listen();
  return true;
}

/** The inbound loop. If Photon's stream ever dies, log it and listen again (backing off). */
async function listen() {
  for (let delay = 1_000; ; delay = Math.min(delay * 2, 5 * 60_000)) {
    const started = Date.now();
    try {
      // (not awaited: a text waiting on a villager mustn't hold up a YES to their approval)
      for await (const [space, message] of app!.messages) void inbound(space, message);
      console.error("[photon] inbound stream ended");
    } catch (err) {
      console.error("[photon] inbound stream died:", err);
    }
    // (one that ran a good while starts the backoff over)
    if (Date.now() - started > 10 * 60_000) delay = 1_000;
    console.log(`[photon] listening again in ${Math.round(delay / 1000)}s`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

type Inbound = SpectrumApp["messages"] extends AsyncIterable<infer T> ? T : never;

async function inbound(space: Space, message: Inbound[1]) {
  try {
    const content = message.content as { type: string; text?: string; markdown?: string };
    const raw = content.type === "text" ? content.text : content.type === "markdown" ? content.markdown : undefined;
    if (!raw?.trim()) return;
    const text = raw.slice(0, MAX_TEXT);

    // Only linked phones talk to the colony. Texting in the MoonPad's code proves they
    // have that phone; on the shared pool it's also what lets the colony text them back.
    const sender = message.sender?.id ?? space.id;
    // (Photon's local terminal chat is the person at this computer)
    const local = (message as { platform?: string }).platform === "terminal" || (space as { __platform?: string }).__platform === "terminal";
    let justLinked = false;
    if (!local && !world.phones[sender]) {
      const p = pendingLinks.get(sender);
      if (sender === envPhone) {
        pendingLinks.delete(sender);
        spaces.set(sender, space);
        link(sender);
        justLinked = true;
      } else if (!p) {
        console.log(`[photon] ignoring a text from unlinked ${mask(sender)}`);
        return;
      } else if (Date.now() > p.expires) {
        pendingLinks.delete(sender);
        console.log(`[photon] ignoring ${mask(sender)}: their link code expired`);
        return;
      } else if (new RegExp(`(^|\\D)${p.code}(\\D|$)`).test(text)) {
        pendingLinks.delete(sender);
        spaces.set(sender, space);
        link(sender);
        justLinked = true;
      } else {
        const out = ++p.tries >= MAX_LINK_TRIES;
        if (out) pendingLinks.delete(sender);
        console.log(`[photon] wrong link code from ${mask(sender)} (${p.tries}/${MAX_LINK_TRIES})`);
        await say(space, out ? "🌙 That code didn't match. Press LINK on the MoonPad again for a new one." : "🌙 That code didn't match. Text the code shown on the MoonPad.");
        return;
      }
    }
    if (local && !spaces.has(sender)) {
      spaces.set(sender, space);
      publishPhones();
    }
    emit({ type: "phone", direction: "in", text });
    if (justLinked && /moon (village )?code|^\s*\d{4}\s*$/i.test(text)) {
      await say(space, `${SIGNATURE.jade_rabbit}: Linked! This phone is now a line home to the Moon. Text "help" to see who's around, or text any villager by name.`);
      return;
    }

    // "YES", "no 4821", "👍 #4821": the code says which open question it answers.
    const coded = /#?(\d{4})\s*[.!]*\s*$/.exec(text.trim());
    const word = coded ? text.trim().slice(0, coded.index) : text;
    if (anyPending() && (YES.test(word) || NO.test(word))) {
      const approved = YES.test(word);
      const target = phoneTarget(coded?.[1], approved);
      if ("problem" in target) {
        await say(space, `🌙 ${target.problem}`);
        return;
      }
      lastApprovalVia.set(target.approval.id, "phone");
      if (!resolveApproval(target.approval.id, approved)) lastApprovalVia.delete(target.approval.id);
      await say(space, approved ? "🚀 On its way! Watch the sky." : "Got it — holding that one back.");
      return;
    }

    if (/^\s*(help|\?|who)\s*[?!.]*\s*$/i.test(text)) {
      const here = residents().map((v) => VILLAGER_NAMES[v]).join(", ");
      await say(space, `🌙 The Moon colony. Neighbors here: ${here}.\nText one by name to catch up, e.g. "Nova: how was stargazing?" — anything else goes to Yutu the Jade Rabbit. For real work (mail, calendar, Canvas, searches), visit them at their house in the colony.`);
      return;
    }

    const { villager, text: task } = route(text);
    if (!isResident(villager)) {
      await say(space, `🌙 ${VILLAGER_NAMES[villager]} hasn't moved in yet — build their home in the colony first. Text "help" to see who's here.`);
      return;
    }
    const reply = await app!.responding(space, () => chatText(villager, task, "phone"));
    await say(space, `${SIGNATURE[villager]}: ${reply}`);
  } catch (err) {
    console.error("[photon] inbound error:", err);
  }
}

async function say(space: Space, text: string) {
  await app!.send(space, text);
  emit({ type: "phone", direction: "out", text });
}

/** Colony news and approval requests go to every linked phone (co-op). */
export async function textPlayer(text: string): Promise<boolean> {
  if (!app) return false;
  const targets = new Set([...Object.keys(world.phones), ...spaces.keys()]);
  let sent = false;
  for (const id of targets) {
    try {
      const space = await spaceFor(id);
      if (!space) continue;
      await say(space, text);
      sent = true;
    } catch (err) {
      console.error(`[photon] send to ${mask(id)} failed:`, err);
    }
  }
  return sent;
}

