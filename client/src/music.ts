// A cozy lunar lullaby, played live with WebAudio (no audio files): a slow
// chord progression on a soft pad, a walking bass, an arpeggio, and a gentle
// pentatonic melody that varies each loop. Starts after the first key press
// (browsers only allow sound after the player does something); mutable, and
// the choice is remembered per browser.

const BPM = 84;
const BEAT = 60 / BPM;
const MUTE_KEY = "moon-music-muted";

// I - vi - IV - V in C, then a turn through Am and F with a lift at the end.
const PROGRESSION = [
  { root: 48, chord: [0, 4, 7, 11] },
  { root: 45, chord: [0, 3, 7, 10] },
  { root: 41, chord: [0, 4, 7, 11] },
  { root: 43, chord: [0, 4, 7, 10] },
  { root: 48, chord: [0, 4, 7, 11] },
  { root: 45, chord: [0, 3, 7, 10] },
  { root: 41, chord: [0, 4, 7, 9] },
  { root: 43, chord: [0, 5, 7, 10] },
];
const PENTATONIC = [0, 2, 4, 7, 9];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let started = false;
let muted = readMuted();
let nextBar = 0;
let bar = 0;
let timer: number | null = null;
const listeners = new Set<(muted: boolean) => void>();

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function note(midi: number, at: number, dur: number, type: OscillatorType, vol: number, attack = 0.02) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(hz(midi), at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(vol, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** A seeded roll, so each loop's melody differs but the song stays calm. */
function roll(n: number) {
  const s = Math.sin(n * 91.7 + 13.3) * 43758.5453;
  return s - Math.floor(s);
}

function scheduleBar(at: number, i: number) {
  const { root, chord } = PROGRESSION[i % PROGRESSION.length];
  const len = BEAT * 4;
  // pad: the chord, soft and long
  for (const c of chord.slice(0, 3)) note(root + 12 + c, at, len * 0.98, "sine", 0.025, 0.4);
  // bass: root on 1, fifth on 3
  note(root - 12, at, BEAT * 1.6, "triangle", 0.07);
  note(root - 12 + 7, at + BEAT * 2, BEAT * 1.6, "triangle", 0.055);
  // arpeggio: eighth notes up the chord, very quiet
  for (let k = 0; k < 8; k++) note(root + 24 + chord[k % chord.length], at + (k * BEAT) / 2, BEAT * 0.45, "triangle", 0.012);
  // melody: a few notes from the pentatonic scale, sometimes resting
  const loop = Math.floor(i / PROGRESSION.length);
  for (let k = 0; k < 4; k++) {
    const r = roll(i * 7 + k + loop * 31);
    if (r < 0.3) continue;
    const step = PENTATONIC[Math.floor(roll(i * 13 + k * 3 + loop) * PENTATONIC.length)];
    const long = k === 3 || r > 0.85;
    note(60 + 12 + step + (i % 4 === 3 && k === 3 ? 2 : 0), at + k * BEAT, BEAT * (long ? 1.8 : 0.9), "square", 0.014, 0.01);
  }
  // a tiny chime at the top of each 8-bar phrase
  if (i % PROGRESSION.length === 0) note(96, at, 1.2, "sine", 0.018);
}

function tick() {
  if (!ctx) return;
  // Keep about two bars scheduled ahead.
  while (nextBar < ctx.currentTime + BEAT * 8) {
    scheduleBar(nextBar, bar++);
    nextBar += BEAT * 4;
  }
}

/** Call on the first user gesture. */
export function startMusic() {
  if (started) return;
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  started = true;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);
  nextBar = ctx.currentTime + 0.3;
  tick();
  timer = window.setInterval(tick, 500);
}

export function isMusicMuted() {
  return muted;
}

export function toggleMusic() {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable: the choice just won't be remembered */
  }
  if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.3);
  listeners.forEach((fn) => fn(muted));
}

export function onMusicToggle(fn: (muted: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function stopMusicTimer() {
  if (timer !== null) window.clearInterval(timer);
}
