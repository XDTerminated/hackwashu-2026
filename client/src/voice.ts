// Villager voices for the talk dialog. The colony server turns a line into
// speech with ElevenLabs (and caches it). If it can't - no key, out of
// credits, offline - the browser's own speech synthesis steps in, so a
// villager never goes silent. Only in-person talk is voiced; texts stay quiet.

import { SERVER_HTTP } from "./net";
import { hearing } from "./sfx";
import type { VillagerId } from "../../shared/game";

const SERVER = SERVER_HTTP;
const MUTE_KEY = "moon-voice-muted";

/** Server (ElevenLabs) clips play a touch quicker so conversations keep moving. */
const PITCH: Record<VillagerId, number> = { jade_rabbit: 1.08, stargazer: 1.05, postmaster: 1.05, timekeeper: 1.06, scholar: 1.05, manager: 1.05, dj: 1.05, mechanic: 1.05 };

/**
 * Browser voices: near-natural pitch, a slightly brisk pace, and a real
 * human-sounding voice for each villager, picked by name (first one installed
 * wins). Novelty voices (Bells, Boing, Zarvox...) are never used.
 */
const BROWSER: Record<VillagerId, { pitch: number; rate: number; prefer: string[] }> = {
  jade_rabbit: { pitch: 1.12, rate: 1.12, prefer: ["Samantha", "Ava", "Zoe", "Allison", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Susan"] },
  postmaster: { pitch: 0.95, rate: 1.08, prefer: ["Daniel", "Google UK English Male", "Arthur", "Oliver", "Microsoft Ryan", "Microsoft George", "Tom"] },
  timekeeper: { pitch: 1.0, rate: 1.15, prefer: ["Rishi", "Tom", "Alex", "Aaron", "Microsoft Guy", "Microsoft Davis", "Evan", "Daniel"] },
  scholar: { pitch: 1.03, rate: 1.1, prefer: ["Moira", "Fiona", "Serena", "Google UK English Female", "Microsoft Sonia", "Kate", "Karen"] },
  stargazer: { pitch: 1.06, rate: 1.08, prefer: ["Karen", "Tessa", "Nicky", "Microsoft Natasha", "Google UK English Female", "Samantha", "Zoe"] },
  manager: { pitch: 1.0, rate: 1.14, prefer: ["Ava", "Allison", "Google US English", "Microsoft Jenny", "Microsoft Aria", "Susan", "Samantha"] },
  dj: { pitch: 1.1, rate: 1.12, prefer: ["Aaron", "Alex", "Google US English", "Microsoft Guy", "Microsoft Davis", "Evan", "Tom"] },
  mechanic: { pitch: 1.02, rate: 1.1, prefer: ["Fred", "Tom", "Alex", "Google US English", "Microsoft Guy", "Evan", "Daniel"] },
};

const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i;
const voiceCache = new Map<VillagerId, SpeechSynthesisVoice | null>();

/** The villager's voice: their first preferred one that's installed, else any natural English voice. */
function pickVoice(v: VillagerId, synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  if (voiceCache.has(v)) return voiceCache.get(v)!;
  const english = synth.getVoices().filter((x) => x.lang.toLowerCase().startsWith("en") && !NOVELTY.test(x.name));
  if (!english.length) return null; // the list hasn't loaded yet: use the default, try again next line
  // Better-quality variants first ("Premium", "Enhanced", "Natural", "Online").
  const quality = (x: SpeechSynthesisVoice) => (/premium|enhanced|natural|neural|online/i.test(x.name) ? 0 : 1);
  let pick: SpeechSynthesisVoice | undefined;
  for (const name of BROWSER[v].prefer) {
    pick = english.filter((x) => x.name.toLowerCase().includes(name.toLowerCase())).sort((a, b) => quality(a) - quality(b))[0];
    if (pick) break;
  }
  pick ??= english.sort((a, b) => quality(a) - quality(b))[0];
  voiceCache.set(v, pick ?? null);
  return pick ?? null;
}

export interface Speech {
  /** How long saying it takes, in ms (an estimate for browser voices). */
  duration: number;
  /** 0..1, how loud they are right now - drives the portrait's mouth. */
  level(): number;
  /** Resolves when they finish or are cut off. */
  done: Promise<void>;
  stop(): void;
}

/** A line to say. Its audio is fetched as soon as it's queued, so the next bubble is ready in time. */
export interface Line {
  v: VillagerId;
  text: string;
  clip: Promise<AudioBuffer | null>;
}

let ctx: AudioContext | null = null;
let current: Speech | null = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  /* storage unavailable - voices on */
}
// Browsers load their voice list lazily; ask early so the fallback has one.
window.speechSynthesis?.getVoices();

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(on: boolean) {
  muted = on;
  if (on) stopSpeaking();
  try {
    localStorage.setItem(MUTE_KEY, on ? "1" : "0");
  } catch {
    /* not remembered - fine */
  }
}

export function prepare(v: VillagerId, text: string): Line {
  return { v, text, clip: muted ? Promise.resolve(null) : fetchClip(v, text) };
}

async function fetchClip(v: VillagerId, text: string): Promise<AudioBuffer | null> {
  const a = audio();
  if (!a) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(`${SERVER}/voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ villager: v, text }),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return await a.decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function stopSpeaking() {
  current?.stop();
  current = null;
  window.speechSynthesis?.cancel();
}

/** The line's audio, if it arrives within `waitMs` (null means "use the browser's voice"). */
export async function ready(line: Line, waitMs = 4000): Promise<AudioBuffer | null> {
  let timer = 0;
  const late = new Promise<null>((r) => (timer = window.setTimeout(() => r(null), waitMs)));
  const buf = await Promise.race([line.clip, late]);
  clearTimeout(timer);
  return buf;
}

/**
 * Say a line in the villager's own voice, or the browser's without one. Null when muted.
 * `at` is where they're standing: quieter from further off, and panned to their side.
 */
export function play(line: Line, buf: AudioBuffer | null, at?: { x: number; y: number }): Speech | null {
  if (muted) return null;
  stopSpeaking();
  const heard = at ? hearing(at.x, at.y, 0.25) : { vol: 1, pan: 0 };
  current = (buf && playClip(line.v, buf, heard)) || sayInBrowser(line.v, line.text, heard.vol);
  return current;
}

function playClip(v: VillagerId, buf: AudioBuffer, heard: { vol: number; pan: number }): Speech | null {
  const a = audio();
  if (!a) return null;
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = PITCH[v];
  const meter = a.createAnalyser();
  meter.fftSize = 256;
  const gain = a.createGain();
  gain.gain.value = heard.vol;
  const pan = a.createStereoPanner();
  pan.pan.value = heard.pan;
  src.connect(meter).connect(gain).connect(pan).connect(a.destination);
  const samples = new Uint8Array(meter.fftSize);
  let playing = true;
  let finish = () => {};
  const done = new Promise<void>((r) => (finish = r));
  src.onended = () => {
    playing = false;
    finish();
  };
  src.start();
  return {
    duration: (buf.duration / PITCH[v]) * 1000,
    level() {
      if (!playing) return 0;
      meter.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += ((s - 128) / 128) ** 2;
      return Math.sqrt(sum / samples.length);
    },
    done,
    stop() {
      if (!playing) return;
      playing = false;
      try {
        src.stop();
      } catch {
        /* already ended */
      }
      finish();
    },
  };
}

function sayInBrowser(v: VillagerId, text: string, volume = 1): Speech | null {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const p = BROWSER[v];
  const u = new SpeechSynthesisUtterance(text);
  u.pitch = p.pitch;
  u.rate = p.rate;
  u.volume = volume;
  const voice = pickVoice(v, synth);
  if (voice) u.voice = voice;
  let speaking = true;
  let finish = () => {};
  const done = new Promise<void>((r) => (finish = r));
  const end = () => {
    speaking = false;
    finish();
  };
  u.onend = end;
  u.onerror = end;
  synth.cancel();
  synth.speak(u);
  const duration = Math.max(800, ((text.length / 14) * 1000) / p.rate);
  // Some browsers never fire onend; don't let the dialog wait forever.
  setTimeout(end, duration + 3000);
  return {
    duration,
    // No audio to measure here, so the mouth just flaps while they talk.
    level: () => (speaking && Math.floor(performance.now() / 110) % 3 !== 0 ? 0.2 : 0),
    done,
    stop() {
      synth.cancel();
      end();
    },
  };
}
