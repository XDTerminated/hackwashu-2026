// Tiny WebAudio bleeps — no audio assets needed.

let ctx: AudioContext | null = null;

const MUTE_KEY = "moon-sfx-muted";
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();
const listeners = new Set<(muted: boolean) => void>();

export const isSfxMuted = () => muted;

/** Sound effects have their own mute, separate from the music. */
export function toggleSfx() {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* not remembered, that's all */
  }
  listeners.forEach((fn) => fn(muted));
}

export function onSfxToggle(fn: (muted: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function beep(
  freq: number,
  dur = 0.08,
  type: OscillatorType = "square",
  vol = 0.08,
  slideTo?: number,
  delay = 0,
) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Filtered noise: engines, rumbles, dust. */
function noise(dur: number, vol: number, freq: number, delay = 0, slideTo?: number) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(freq, t0);
  if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.3, dur / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(gain).connect(a.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

export const sfx = {
  /** One syllable of cutscene chatter; each character has their own pitch. */
  voice(pitch: number) {
    // A soft syllable: a warm tone that dips a little, like a spoken vowel.
    const f = pitch * (0.85 + Math.random() * 0.3);
    beep(f, 0.05, "triangle", 0.05, f * 0.88);
  },
  tick() {
    beep(880, 0.1, "square", 0.05);
  },
  go() {
    beep(1320, 0.4, "square", 0.05);
    beep(660, 0.4, "square", 0.04);
  },
  rumble(dur = 3) {
    noise(dur, 0.22, 380, 0, 120);
    beep(55, dur, "sawtooth", 0.05, 30);
  },
  land() {
    noise(0.8, 0.2, 500, 0, 100);
    beep(90, 0.3, "triangle", 0.14, 40);
  },
  stamp() {
    beep(110, 0.2, "square", 0.12, 45);
    noise(0.12, 0.12, 2400);
  },
  whoosh() {
    noise(0.6, 0.08, 400, 0, 3000);
  },
  hop() {
    beep(500, 0.08, "square", 0.03, 900);
  },
  catch() {
    beep(660, 0.06, "square", 0.08);
    beep(990, 0.09, "square", 0.08, 1320, 0.06);
  },
  coin() {
    beep(1180, 0.05, "triangle", 0.1, 1560);
  },
  buy() {
    beep(440, 0.07, "square", 0.07, 660);
    beep(880, 0.09, "square", 0.06, undefined, 0.08);
  },
  place() {
    beep(300, 0.06, "triangle", 0.1, 220);
  },
  deny() {
    beep(180, 0.12, "sawtooth", 0.06, 140);
  },
  hammer() {
    beep(1400, 0.025, "square", 0.05, 900);
  },
  bell() {
    beep(1568, 0.35, "sine", 0.07);
    beep(1319, 0.45, "sine", 0.06, undefined, 0.18);
  },
  whistle() {
    beep(1800, 2.6, "sine", 0.035, 300);
  },
  thunk() {
    beep(120, 0.25, "triangle", 0.14, 50);
    beep(70, 0.3, "sawtooth", 0.05, 40, 0.02);
  },
  sweep() {
    beep(2400, 0.04, "sawtooth", 0.015, 1600);
  },
  blip() {
    beep(520, 0.03, "square", 0.04);
  },
  message() {
    beep(880, 0.06, "sine", 0.08);
    beep(1175, 0.1, "sine", 0.08, undefined, 0.07);
  },
};
