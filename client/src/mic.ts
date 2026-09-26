// Voice input in the talk dialog: hold TAB (or the mic button) and speak, or
// tap it once to start and again to send. The browser's speech recognition
// types what you say into the box as you talk. Works in Chrome, Edge and
// Safari; it needs internet (the browser sends the audio to its own speech
// service) and localhost or https.

interface Alternative {
  transcript: string;
}
interface Result {
  readonly isFinal: boolean;
  readonly [i: number]: Alternative;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<Result> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const Recognizer = w.SpeechRecognition ?? w.webkitSpeechRecognition;

export const micSupported = !!Recognizer;

const PROBLEMS: Record<string, string> = {
  "not-allowed": "The mic is blocked. Allow microphone access for this page (it has to be opened on localhost or https).",
  "service-not-allowed": "The mic is blocked. Allow microphone access for this page (it has to be opened on localhost or https).",
  "audio-capture": "No microphone found.",
  // (browsers like Brave and Arc have the API but not the speech service behind it)
  network: "Voice input isn't working in this browser (it needs internet, and works in Google Chrome, Edge and Safari). You can still type.",
  "no-speech": "I didn't hear anything. Tap TAB (or the mic) and try again.",
  "language-not-supported": "Voice input doesn't support your browser's language. You can still type.",
};

/** However it goes, a listen never outlasts this. */
const MAX_LISTEN_MS = 20_000;

export interface Listening {
  /** Let go: finish up and resolve `heard`. */
  stop(): void;
  /** Cancel without sending anything. */
  cancel(): void;
  /** Everything they said, once they've let go. */
  heard: Promise<string>;
}

export function listen(onPartial: (text: string) => void, onProblem: (message: string) => void): Listening | null {
  if (!Recognizer) return null;
  const rec = new Recognizer();
  rec.lang = navigator.language || "en-US";
  rec.continuous = true;
  rec.interimResults = true;

  let text = "";
  let cancelled = false;
  let finish = (_: string) => {};
  const heard = new Promise<string>((r) => (finish = r));
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    finish(cancelled ? "" : text.trim());
  };

  rec.onresult = (e) => {
    text = Array.from(e.results, (r) => r[0]?.transcript ?? "").join("");
    onPartial(text);
  };
  rec.onerror = (e) => {
    if (PROBLEMS[e.error]) onProblem(PROBLEMS[e.error]);
  };
  // A stop asked for before the mic actually started (say, while the browser was
  // still asking for permission) is remembered and done as soon as it starts.
  let started = false;
  let stopWanted = false;
  const doStop = () => {
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
    // Recognition normally ends right after stop(); don't hang if it doesn't.
    setTimeout(settle, 2500);
  };
  (rec as unknown as { onstart: (() => void) | null }).onstart = () => {
    started = true;
    if (stopWanted) doStop();
  };
  rec.onend = settle;
  const cap = setTimeout(doStop, MAX_LISTEN_MS);
  void heard.then(() => clearTimeout(cap));
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop() {
      stopWanted = true;
      if (started) doStop();
      // (never started at all, e.g. permission denied: give up shortly)
      else setTimeout(() => !started && (doStop(), settle()), 4000);
    },
    cancel() {
      cancelled = true;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
      settle();
    },
    heard,
  };
}

/**
 * The open mic: keep listening, and hand over each finished phrase as it's
 * said (recognition restarts itself whenever the browser stops it). Returns
 * null if this browser can't do voice.
 */
export function listenOpen(onPhrase: (text: string) => void, onPartial: (text: string) => void, onProblem: (message: string) => void): { stop(): void } | null {
  if (!Recognizer) return null;
  let stopped = false;
  let rec: Recognition | null = null;
  const start = () => {
    if (stopped) return;
    const r = new Recognizer();
    rec = r;
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const said = e.results[i][0]?.transcript ?? "";
        if (e.results[i].isFinal) {
          if (said.trim()) onPhrase(said.trim());
        } else partial += said;
      }
      onPartial(partial.trim());
    };
    r.onerror = (e) => {
      // blocked or unsupported: stop for good (and say why); anything else just restarts
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture" || e.error === "network") {
        stopped = true;
        if (PROBLEMS[e.error]) onProblem(PROBLEMS[e.error]);
      }
    };
    r.onend = () => {
      if (!stopped) setTimeout(start, 250);
    };
    try {
      r.start();
    } catch {
      setTimeout(start, 1000);
    }
  };
  start();
  return {
    stop() {
      stopped = true;
      try {
        rec?.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}
