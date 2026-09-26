// Push-to-talk. Hold TAB (or the mic button) in the talk dialog and speak: the
// browser's speech recognition types what you say into the box as you talk,
// and letting go sends it. Works in Chrome, Edge and Safari; it needs internet
// (the browser sends the audio to its own speech service) and localhost or https.

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
  onresult: ((e: { results: ArrayLike<Result> }) => void) | null;
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
  network: "Voice input needs internet - the browser sends your voice to its speech service.",
};

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
  rec.onend = settle;
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop() {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
      // Recognition normally ends right after stop(); don't hang if it doesn't.
      setTimeout(settle, 2500);
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
