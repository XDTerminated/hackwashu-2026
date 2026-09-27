// The AI team in the Office (the project board): you're the project manager.
// Write a brief; the team lead (a model) hires workers with a spawn_worker tool,
// each works at a desk with their current step live over their head, and the
// lead combines their work into one deliverable. It thinks with whichever AI
// you connect: your own key (Groq, Gemini, OpenAI, Anthropic) or OpenRouter.

export type TeamProvider = "claude" | "openai" | "groq" | "gemini" | "openrouter";
export const TEAM_PROVIDERS: TeamProvider[] = ["claude", "openai", "groq", "gemini", "openrouter"];

export interface TeamWorker {
  id: string;
  name: string;
  role: string;
  task: string;
  status: "working" | "done" | "failed";
  /** What they're doing right now (shown over their head). */
  step: string;
  steps: { at: number; text: string }[];
  result?: string;
  startedAt: number;
  doneAt?: number;
}

export interface TeamProject {
  id: string;
  brief: string;
  provider: TeamProvider;
  model: string;
  status: "planning" | "working" | "wrapping" | "done" | "failed";
  /** The team lead's latest line (planning / wrapping up). */
  lead: string;
  result?: string;
  error?: string;
  workers: TeamWorker[];
  startedAt: number;
  doneAt?: number;
}

export interface TeamState {
  providers: {
    id: TeamProvider;
    name: string;
    model: string;
    available: boolean;
    /** Who connected it: you (in the game), or the server's .env. */
    source: "you" | "server" | null;
    /** A hint of which key ("••••1a2b"); the key itself never leaves the server. */
    masked: string | null;
    /** Models to pick from (OpenRouter). */
    models?: string[];
  }[];
  project: TeamProject | null;
  history: { id: string; brief: string; provider: TeamProvider; doneAt: number }[];
}

export const noTeam = (): TeamState => ({ providers: [], project: null, history: [] });
