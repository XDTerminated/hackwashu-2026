// Photon Spectrum bridge — the colony's line home, over iMessage.
//
// - Text any villager by name ("Stargazer: when's the next full moon?");
//   anything else goes to the Jade Rabbit. "help" lists who's around.
// - A "!" in the village (an approval) also arrives as a text; reply YES/NO.
// - The Rabbit texts first when you land: "Made it to the Moon?"
//
// - Phones are linked from the in-game MoonPad (enter number → texted code),
//   any number of them (co-op). News and approvals go to every linked phone;
//   replies go back to whoever texted.
//
// Env (Photon dashboard → Settings): SPECTRUM_PROJECT_ID + SPECTRUM_PROJECT_SECRET
// (PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET also work). Optional PLAYER_PHONE
// (E.164) is linked automatically at startup. PHOTON_TERMINAL=1 adds Photon's
// terminal chat for local testing — it works without any credentials.

import { Spectrum } from "spectrum-ts";
import { imessage, terminal } from "spectrum-ts/providers";
import { VILLAGER_NAMES, VILLAGER_ROLE, VILLAGER_SHORT, type VillagerId } from "../../shared/game.js";
import { lastApprovalVia } from "./agents.js";
import { chatText } from "./chat.js";
import { registerSharedUser, textUsLink } from "./connectors/photonUsers.js";
import { oldestPending, resolveApproval } from "./approvals.js";
import { isResident, residents, setPhotonState } from "./services.js";
import { emit, onEvent, savePersist, world } from "./world.js";

type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;
type Space = Parameters<SpectrumApp["send"]>[0];

let app: SpectrumApp | null = null;
let cloud = false;
/** Open iMessage chats, keyed by phone number (or sender id for other channels). */
const spaces = new Map<string, Space>();
/** Photon user ids + assigned colony numbers for numbers we've registered. */
const registered = new Map<string, { photonUserId: string; line: string }>();
/** Link codes waiting to be texted in from that phone. */
const pendingLinks = new Map<string, { code: string; expires: number }>();
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
    phones: Object.values(world.phones).map((p) => ({ id: p.phone, masked: mask(p.phone), line: p.line })),
  });
}

async function spaceFor(phone: string): Promise<Space | null> {
  const known = spaces.get(phone);
  if (known) return known;
  if (!app || !cloud) return null;
  // Open (or resume) a 1:1 iMessage chat. On shared-pool plans this is how every conversation starts.
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
    const code = pendingLinks.get(phone)?.code ?? String(Math.floor(1000 + Math.random() * 9000));
    pendingLinks.set(phone, { code, expires: Date.now() + 30 * 60_000 });
    console.log(`[photon] waiting for ${mask(phone)} to text code to colony line ${mask(user.assignedPhoneNumber)}`);
    return {
      ok: true,
      text: `From ${mask(phone)}, text ${code} to ${user.assignedPhoneNumber} - or scan the code with that phone.`,
      line: user.assignedPhoneNumber,
      code,
      link: `${textUsLink(user.id)}?msg=${encodeURIComponent(`Moon Village code ${code}`)}`,
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

export function unlink(phone: string) {
  if (!world.phones[phone]) return;
  delete world.phones[phone];
  spaces.delete(phone);
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

  const providers = [...(cloud ? [imessage.config()] : []), ...(useTerminal ? [terminal.config()] : [])];
  app = cloud
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await Spectrum({ projectId: projectId!, projectSecret: projectSecret!, providers: providers as any })
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await Spectrum({ providers: providers as any });
  console.log(`[photon] connected via ${[cloud && "iMessage", useTerminal && "terminal"].filter(Boolean).join(" + ")}`);
  if (process.env.PLAYER_PHONE && cloud) {
    const envPhone = normalizePhone(process.env.PLAYER_PHONE);
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
      const body = e.approval.body.length > 280 ? e.approval.body.slice(0, 277) + "…" : e.approval.body;
      void textPlayer(`❗ ${SIGNATURE[e.villager]} needs your OK\n${e.approval.title}\n\n"${body}"\n\nReply YES to go ahead or NO to hold it.`);
    }
  });

  void (async () => {
    for await (const [space, message] of app!.messages) {
      try {
        const content = message.content as { type: string; text?: string; markdown?: string };
        const text = content.type === "text" ? content.text : content.type === "markdown" ? content.markdown : undefined;
        if (!text?.trim()) continue;

        // Texting the colony proves they have that phone. On the shared pool this
        // first text is also what allows the colony to text them back.
        const sender = message.sender?.id ?? space.id;
        spaces.set(sender, space);
        const wasPending = pendingLinks.has(sender);
        if (/^\+\d{8,15}$/.test(sender)) {
          pendingLinks.delete(sender);
          link(sender);
        } else publishPhones();
        emit({ type: "phone", direction: "in", text });
        if (wasPending && /moon village code|^\s*\d{4}\s*$/i.test(text)) {
          await say(space, `${SIGNATURE.jade_rabbit}: Linked! This phone is now a line home to Moon Village. Text "help" to see who's around, or text any villager by name.`);
          continue;
        }

        const pending = oldestPending();
        if (pending && (YES.test(text) || NO.test(text))) {
          const approved = YES.test(text);
          lastApprovalVia.set(pending.id, "phone");
          resolveApproval(pending.id, approved);
          await say(space, approved ? "🚀 On its way! Watch the sky." : "Got it — holding that one back.");
          continue;
        }

        if (/^\s*(help|\?|who)\s*[?!.]*\s*$/i.test(text)) {
          const here = residents().map((v) => VILLAGER_NAMES[v]).join(", ");
          await say(space, `🌙 Moon Village. Neighbors here: ${here}.\nText one by name to catch up, e.g. "Nova: how was stargazing?" — anything else goes to Yutu the Jade Rabbit. For real work (mail, calendar, Canvas, searches), visit them at their house in the colony.`);
          continue;
        }

        const { villager, text: task } = route(text);
        if (!isResident(villager)) {
          await say(space, `🌙 ${VILLAGER_NAMES[villager]} hasn't moved in yet — build their home in the colony first. Text "help" to see who's here.`);
          continue;
        }
        const reply = await app!.responding(space, () => chatText(villager, task, "phone"));
        await say(space, `${SIGNATURE[villager]}: ${reply}`);
      } catch (err) {
        console.error("[photon] inbound error:", err);
      }
    }
  })();

  return true;
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

