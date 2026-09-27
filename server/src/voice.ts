// Villager voices (ElevenLabs text-to-speech). The game posts a line, the
// server speaks it once and keeps the mp3 in server/data/voice/, so repeated
// lines (greetings, stock replies) never cost credits twice. The API key never
// leaves the server. When ElevenLabs can't help (no key, out of credits, the
// account flagged), the game falls back to the browser's own voices.

import { DATA_DIR } from "./env.js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { VillagerId } from "../../shared/game.js";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(DATA_DIR, "voice");
const KEY = process.env.ELEVENLABS_API_KEY ?? "";
/** Flash costs half a credit per character; the free plan has 10,000 credits a month. */
const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5";
/** A spoken line never runs longer than this (the dialog only voices a reply's first sentences). */
const MAX_CHARS = 320;
/** BROWSER_VOICES=1 keeps ElevenLabs off (save credits while developing). */
const FORCED_OFF = process.env.BROWSER_VOICES === "1";

interface VoiceDef {
  id: string;
  stability: number;
  similarity: number;
  style: number;
  speed: number;
}

// ElevenLabs default voices: the only ones a free-plan API key can use (Voice
// Library voices are paid-only over the API). Swap any with VOICE_<VILLAGER>=<id>.
// The Rabbit and Stargazer are pitched up in the browser, so they're slowed here.
const VOICES: Record<VillagerId, VoiceDef> = {
  // Jessica: bright and playful
  jade_rabbit: { id: "cgSgspJ2msm6clMCkdW9", stability: 0.35, similarity: 0.75, style: 0.45, speed: 0.93 },
  // George: warm, a touch fussy, British
  postmaster: { id: "JBFqnCBsd6RMkjVDRZzb", stability: 0.4, similarity: 0.8, style: 0.5, speed: 1 },
  // Daniel: crisp and precise
  timekeeper: { id: "onwK4e9ZLuTAKqWW03F9", stability: 0.6, similarity: 0.8, style: 0.2, speed: 1.05 },
  // Alice: clear and teacherly
  scholar: { id: "Xb7hH8MSUJpSbSDYk0k2", stability: 0.5, similarity: 0.8, style: 0.3, speed: 1 },
  // Sarah: soft and dreamy
  stargazer: { id: "EXAVITQu4vr4xnSDxMaL", stability: 0.35, similarity: 0.75, style: 0.4, speed: 0.9 },
  // Laura: upbeat and quick
  manager: { id: "FGY2WhTYpPnrIDTdsKH5", stability: 0.5, similarity: 0.8, style: 0.35, speed: 1.05 },
  // Charlie: laid-back and cheerful
  dj: { id: "IKne3meq5aSn9XLyUdCD", stability: 0.45, similarity: 0.75, style: 0.4, speed: 1.05 },
};

function voiceFor(v: VillagerId): VoiceDef {
  const override = process.env[`VOICE_${v.toUpperCase()}`];
  return override ? { ...VOICES[v], id: override } : VOICES[v];
}

/** When ElevenLabs refuses (bad key, no credits, flagged), stop asking for a while. */
let pausedUntil = 0;
let pauseReason = "";
let spokenChars = 0;
const inFlight = new Map<string, Promise<Buffer>>();

export function voiceStatus(): "elevenlabs" | "browser" {
  return KEY && !FORCED_OFF && Date.now() >= pausedUntil ? "elevenlabs" : "browser";
}

export function voiceSummary(): string {
  if (!KEY) return "browser voices (no ELEVENLABS_API_KEY)";
  if (FORCED_OFF) return "browser voices (BROWSER_VOICES=1)";
  return `ElevenLabs (${MODEL}), cached in server/data/voice`;
}

/** What's worth saying out loud: no links, emoji, markdown or citation marks. */
export function speakable(text: string): string {
  let s = text
    .replace(/https?:\/\/\S+|www\.\S+/g, "")
    .replace(/【[^】]*】|\[\d+\]/g, "")
    .replace(/[*_#`>]/g, "")
    .replace(/\p{Extended_Pictographic}|️/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > MAX_CHARS) s = s.slice(0, s.lastIndexOf(" ", MAX_CHARS) > 0 ? s.lastIndexOf(" ", MAX_CHARS) : MAX_CHARS);
  return s;
}

class VoiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function synthesize(v: VillagerId, text: string): Promise<Buffer> {
  const voice = voiceFor(v);
  const settings = { stability: voice.stability, similarity_boost: voice.similarity, style: voice.style, speed: voice.speed };
  const key = createHash("sha256").update(JSON.stringify([MODEL, voice.id, settings, text])).digest("hex").slice(0, 32);
  const file = join(CACHE_DIR, `${key}.mp3`);
  if (existsSync(file)) return readFileSync(file);

  const pending = inFlight.get(key);
  if (pending) return pending;
  const job = (async () => {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": KEY, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: settings }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let status = "";
      try {
        status = JSON.parse(body)?.detail?.status ?? "";
      } catch {
        /* not JSON */
      }
      // Account-level refusals: pause instead of burning a request on every line.
      if (res.status === 401 || res.status === 402 || /quota|unusual|payment|free_users/i.test(status + body)) {
        pausedUntil = Date.now() + 10 * 60_000;
        pauseReason = status || `HTTP ${res.status}`;
        console.warn(`[voice] ElevenLabs refused (${pauseReason}); browser voices for the next 10 minutes. ${body.slice(0, 200)}`);
      }
      throw new VoiceError(res.status, status || body.slice(0, 200) || `HTTP ${res.status}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, audio, { mode: 0o600 });
    spokenChars += text.length;
    console.log(`[voice] ${v}: ${text.length} chars spoken (${spokenChars} this run, ~${Math.round(spokenChars / 2)} credits)`);
    return audio;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

const VILLAGERS = new Set<string>(Object.keys(VOICES));

/** Only the game (served from this machine or the same host) may spend the voice credits. */
function allowOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const from = new URL(origin).hostname;
    const self = new URL(`http://${req.headers.host ?? "localhost"}`).hostname;
    if (from !== self && !["localhost", "127.0.0.1", "[::1]"].includes(from)) return false;
  } catch {
    return false;
  }
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "origin");
  return true;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** POST /voice {villager, text} → audio/mpeg, or 503 when the game should use browser voices. */
export async function handleVoice(req: IncomingMessage, res: ServerResponse) {
  if (!allowOrigin(req, res)) return json(res, 403, { error: "origin not allowed" });
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600" });
    return res.end();
  }
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) return json(res, 413, { error: "too long" });
  }
  let body: { villager?: string; text?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: "bad json" });
  }
  const v = String(body.villager ?? "");
  const text = speakable(String(body.text ?? ""));
  if (!VILLAGERS.has(v) || !text) return json(res, 400, { error: "need a villager and some text" });
  if (voiceStatus() !== "elevenlabs") return json(res, 503, { error: "browser voices", reason: pauseReason || voiceSummary() });

  try {
    const audio = await synthesize(v as VillagerId, text);
    res.writeHead(200, { "content-type": "audio/mpeg", "content-length": audio.length, "cache-control": "no-store" });
    res.end(audio);
  } catch (err) {
    const status = err instanceof VoiceError ? err.status : 0;
    if (!(err instanceof VoiceError)) console.error("[voice] request failed:", err);
    json(res, 503, { error: "voice unavailable", status, reason: err instanceof Error ? err.message : String(err) });
  }
}
