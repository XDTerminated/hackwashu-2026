// Tiny WebAudio bleeps — no audio assets needed.

let ctx: AudioContext | null = null;

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

export const sfx = {
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
