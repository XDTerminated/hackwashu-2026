// The colony's theme, played live as 8-bit swing with WebAudio (no audio
// files): a pulse-wave lead, a walking triangle bass, off-beat chord stabs,
// and swung brushes. The tune itself lives in tune.ts as plain text, so it's
// easy to change; the head alternates with an improvised chorus over the same
// changes, so it never loops stale. Music is on unless you turn it off; starts
// on your first key press (browsers only allow sound after the player acts).

import { TUNE } from "./tune";

/** Swung eighths: the off-beat lands two thirds of the way through the beat. */
const SWING = 2 / 3;
// (a new key: an older "music off" setting shouldn't keep the new tune silent)
const MUTE_KEY = "moon-music-off-v2";

const QUALITY: Record<string, number[]> = {
  "": [0, 4, 7, 12],
  m: [0, 3, 7, 12],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  dim: [0, 3, 6, 9],
};
const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const accidental = (a: string) => (a === "#" ? 1 : a === "b" ? -1 : 0);

/** "F#m7" -> its bass root (G2..F#3) and chord tones. */
function chord(sym: string): { root: number; tones: number[] } {
  const m = sym.match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return { root: 48, tones: QUALITY[""] };
  let root = 48 + PITCH[m[1]] + accidental(m[2]);
  if (root > 54) root -= 12;
  return { root, tones: QUALITY[m[3]] ?? QUALITY[""] };
}

/** "C#5" -> MIDI 73 (C4 = 60). */
function note(n: string): number | null {
  const m = n.match(/^([A-G])([#b]?)(-?\d)$/);
  return m ? 12 * (Number(m[3]) + 1) + PITCH[m[1]] + accidental(m[2]) : null;
}

/** Read tune.ts: the tempo, and each bar's chord and [beat, midi, length] notes. */
function parseTune(text: string) {
  let bpm = 116;
  const chords: { root: number; tones: number[] }[] = [];
  const head: [number, number, number][][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const tempo = line.match(/^bpm\s+(\d+)/i);
    if (tempo) {
      bpm = Number(tempo[1]);
      continue;
    }
    const [sym, notes = ""] = line.split("|").map((x) => x.trim());
    chords.push(chord(sym));
    const bar: [number, number, number][] = [];
    let beat = 0;
    for (const tok of notes.split(/\s+/).filter(Boolean)) {
      const [name, len] = tok.split(":");
      const beats = Number(len) || 1;
      const midi = name.toLowerCase() === "r" ? null : note(name);
      if (midi !== null && beat < 4) bar.push([beat, midi, Math.min(beats, 4 - beat)]);
      beat += beats;
    }
    head.push(bar);
  }
  if (!chords.length) chords.push(chord("C"));
  return { bpm, chords, head };
}

const { bpm: BPM, chords: CHORDS, head: HEAD } = parseTune(TUNE);
const BEAT = 60 / BPM;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
const waves = new Map<number, PeriodicWave>();
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

/** A pulse wave with the given duty cycle: the classic 8-bit timbre. */
function pulse(duty: number): PeriodicWave | null {
  if (!ctx) return null;
  let w = waves.get(duty);
  if (!w) {
    const n = 48;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    w = ctx.createPeriodicWave(real, imag);
    waves.set(duty, w);
  }
  return w;
}

function tone(midi: number, at: number, dur: number, vol: number, voice: { duty?: number; type?: OscillatorType; attack?: number; vibrato?: boolean }) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const wave = voice.duty ? pulse(voice.duty) : null;
  if (wave) osc.setPeriodicWave(wave);
  else osc.type = voice.type ?? "triangle";
  osc.frequency.setValueAtTime(hz(midi), at);
  // a little crooner vibrato on the long notes
  if (voice.vibrato && dur > BEAT) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.setValueAtTime(0, at);
    depth.gain.linearRampToValueAtTime(hz(midi) * 0.012, at + dur * 0.5);
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(at);
    lfo.stop(at + dur + 0.05);
  }
  const attack = voice.attack ?? 0.01;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(vol, at + attack);
  gain.gain.setValueAtTime(vol, at + Math.max(attack, dur * 0.7));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** A burst of filtered noise: the ride, the hi-hat. */
function hat(at: number, vol: number, len: number, freq: number) {
  if (!ctx || !master) return;
  if (!noise) {
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
  src.connect(hp).connect(gain).connect(master);
  src.start(at);
  src.stop(at + len + 0.02);
}

function kick(at: number, vol: number) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(110, at);
  osc.frequency.exponentialRampToValueAtTime(42, at + 0.12);
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + 0.2);
}

/** Beat position with swing: an off-beat x.5 lands at x + 2/3. */
const swung = (beat: number) => (beat % 1 === 0.5 ? Math.floor(beat) + SWING : beat);

/** A seeded roll, so each chorus's solo differs but plays the same every time. */
function roll(n: number) {
  const s = Math.sin(n * 91.7 + 13.3) * 43758.5453;
  return s - Math.floor(s);
}

/** An improvised chorus: swung phrases up and down the chord, with breaths. */
function solo(i: number, chorus: number): [number, number, number][] {
  const { root, tones } = CHORDS[i % CHORDS.length];
  const notes: [number, number, number][] = [];
  const base = root + 24 + (root < 46 ? 12 : 0);
  let beat = roll(i * 5 + chorus) < 0.5 ? 0 : 0.5;
  let idx = Math.floor(roll(i * 3 + chorus * 7) * tones.length);
  while (beat < 4) {
    if (roll(i * 11 + beat * 7 + chorus) < 0.18) {
      beat += 0.5; // breathe
      continue;
    }
    const len = roll(i + beat * 3 + chorus) > 0.8 ? 1 : 0.5;
    const step = ((idx % tones.length) + tones.length) % tones.length;
    const pitch = base + tones[step] + (idx >= tones.length ? 12 : 0);
    notes.push([beat, Math.min(pitch, 88), Math.min(len, 4 - beat)]);
    idx += roll(i * 17 + beat + chorus) > 0.35 ? 1 : -1;
    if (idx < 0) idx = 1;
    if (idx > tones.length + 1) idx = tones.length - 1;
    beat += len;
  }
  return notes;
}

function scheduleBar(at: number, i: number) {
  const chord = CHORDS[i % CHORDS.length];
  const next = CHORDS[(i + 1) % CHORDS.length];
  const chorus = Math.floor(i / CHORDS.length);
  const t = (beat: number) => at + swung(beat) * BEAT;

  // walking bass: root, a chord tone, the fifth, then a half step into the next chord
  const b = chord.root - 12;
  const into = next.root - 12;
  const walk = [b, b + chord.tones[1], b + 7, into + (into > b + 7 ? -1 : 1)];
  walk.forEach((m, k) => tone(m, t(k), BEAT * 0.85, 0.11, { type: "triangle", attack: 0.005 }));

  // comping: short chord stabs on the "and" of 2 and on 4, like a swing piano
  for (const beat of [1.5, 3]) for (const c of chord.tones) tone(chord.root + 12 + c, t(beat), BEAT * 0.35, 0.012, { duty: 0.25, attack: 0.004 });

  // drums: soft kick on 1 and 3, the swung ride ("ding, ding-da, ding, ding-da"), a closed hat on 2 and 4
  kick(t(0), 0.16);
  kick(t(2), 0.1);
  for (const beat of [0, 1, 1.5, 2, 3, 3.5]) hat(t(beat), beat % 1 ? 0.018 : 0.03, 0.09, 9000);
  for (const beat of [1, 3]) hat(t(beat), 0.05, 0.04, 5500);

  // the lead: the tune on even choruses, a solo over the changes on odd ones
  const lead = chorus % 2 === 0 ? HEAD[i % HEAD.length] : solo(i, chorus);
  for (const [beat, midi, len] of lead) tone(midi, t(beat), len * BEAT * 0.95, chorus % 2 === 0 ? 0.05 : 0.04, { duty: 0.25, vibrato: true });
  // a soft sparkle at the top of each chorus
  if (i % CHORDS.length === 0) tone(96, at, 1.2, 0.015, { type: "sine" });
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
  master.gain.value = muted ? 0 : 0.8;
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
  if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.3);
  listeners.forEach((fn) => fn(muted));
}

export function onMusicToggle(fn: (muted: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function stopMusicTimer() {
  if (timer !== null) window.clearInterval(timer);
}
