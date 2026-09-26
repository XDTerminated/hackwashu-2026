// Villager voices for the talk dialog. The colony server turns a line into
// speech with ElevenLabs (and caches it). If it can't - no key, out of
// credits, offline - the browser's own speech synthesis steps in, so a
// villager never goes silent. Only in-person talk is voiced; texts stay quiet.

import type { VillagerId } from "../../shared/game";

const SERVER = `http://${location.hostname || "localhost"}:8787`;
const MUTE_KEY = "moon-voice-muted";

/** Critters talk a little higher: playback rate lifts pitch (their server voices are slowed to match). */
const PITCH: Record<VillagerId, number> = { jade_rabbit: 1.1, stargazer: 1.07, postmaster: 1, timekeeper: 1, scholar: 1 };

/** Browser fallback: pitch, rate and which installed English voice to use. */
const BROWSER: Record<VillagerId, { pitch: number; rate: number; pick: number }> = {
  jade_rabbit: { pitch: 1.5, rate: 1.05, pick: 0 },
  postmaster: { pitch: 0.8, rate: 0.95, pick: 1 },
  timekeeper: { pitch: 1, rate: 1.1, pick: 2 },
  scholar: { pitch: 1.1, rate: 1, pick: 3 },
  stargazer: { pitch: 1.35, rate: 0.9, pick: 4 },
};

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

/** Say a line in the villager's own voice, or the browser's without one. Null when muted. */
export function play(line: Line, buf: AudioBuffer | null): Speech | null {
  if (muted) return null;
  stopSpeaking();
  current = (buf && playClip(line.v, buf)) || sayInBrowser(line.v, line.text);
  return current;
}

function playClip(v: VillagerId, buf: AudioBuffer): Speech | null {
  const a = audio();
  if (!a) return null;
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = PITCH[v];
  const meter = a.createAnalyser();
  meter.fftSize = 256;
  src.connect(meter).connect(a.destination);
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

function sayInBrowser(v: VillagerId, text: string): Speech | null {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const p = BROWSER[v];
  const u = new SpeechSynthesisUtterance(text);
  u.pitch = p.pitch;
  u.rate = p.rate;
  const english = synth.getVoices().filter((x) => x.lang.toLowerCase().startsWith("en"));
  if (english.length) u.voice = english[p.pick % english.length];
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
