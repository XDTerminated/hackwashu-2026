// "Connect your AI" for the Office's AI team: players bring their own model.
// Either one-click OpenRouter sign-in (OAuth PKCE: they log in, we get a key
// for them, and it reaches Claude, GPT, Gemini and many free models), or they
// paste a Groq / Gemini / OpenAI / Anthropic key. Keys are checked with a tiny
// request, stored owner-only in this island's data folder (online, each
// player's own), and never sent back to the game (only a masked hint).

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TEAM_PROVIDERS, type TeamProvider } from "../../shared/team.js";
import { DATA_DIR, HOSTED } from "./env.js";

const KEY_FILE = join(DATA_DIR, "ai-keys.json");

interface Stored {
  keys: Partial<Record<TeamProvider, string>>;
  models: Partial<Record<TeamProvider, string>>;
}

let stored: Stored = load();

function load(): Stored {
  try {
    if (existsSync(KEY_FILE)) {
      const s = JSON.parse(readFileSync(KEY_FILE, "utf8")) as Partial<Stored>;
      // (known providers and plain strings only)
      const pick = (o: unknown) => {
        const out: Partial<Record<TeamProvider, string>> = {};
        for (const p of TEAM_PROVIDERS) {
          const v = o && typeof o === "object" && Object.hasOwn(o, p) ? (o as Record<string, unknown>)[p] : undefined;
          if (typeof v === "string" && v) out[p] = v;
        }
        return out;
      };
      return { keys: pick(s.keys), models: pick(s.models) };
    }
  } catch (err) {
    console.error("[ai-keys] couldn't read saved keys:", err);
  }
  return { keys: {}, models: {} };
}

function save() {
  mkdirSync(dirname(KEY_FILE), { recursive: true });
  writeFileSync(KEY_FILE, JSON.stringify(stored), { mode: 0o600 });
  // (`mode` only applies to a new file: keep an older one owner-only too)
  try {
    chmodSync(KEY_FILE, 0o600);
  } catch {
    /* (Windows) */
  }
}

/** One of the team's providers (not "constructor" or anything else off a prototype). */
export const isTeamProvider = (p: unknown): p is TeamProvider => typeof p === "string" && (TEAM_PROVIDERS as string[]).includes(p);

/**
 * The server's own keys (.env), used when a player hasn't connected one: on your own
 * computer only. Online, every player brings their own (a team is up to five
 * workers on one brief; that shouldn't run on whoever hosts the site).
 */
const ENV: Record<TeamProvider, () => string | undefined> = HOSTED
  ? { claude: () => undefined, openai: () => undefined, groq: () => undefined, gemini: () => undefined, openrouter: () => undefined }
  : {
      claude: () => process.env.ANTHROPIC_API_KEY,
      openai: () => process.env.OPENAI_API_KEY,
      groq: () => process.env.GROQ_API ?? process.env.GROQ_API_KEY,
      gemini: () => process.env.GEMINI_API_KEY,
      openrouter: () => process.env.OPENROUTER_API_KEY,
    };

/** The key to use: one a player connected in-game, else the server's .env. */
export function keyFor(p: TeamProvider): string | undefined {
  if (!isTeamProvider(p)) return undefined;
  return stored.keys[p] ?? ENV[p]();
}

/** Where a provider's key came from, for the board ("you" connected it, or the server has one). */
export function keySource(p: TeamProvider): "you" | "server" | null {
  if (!isTeamProvider(p)) return null;
  return stored.keys[p] ? "you" : ENV[p]() ? "server" : null;
}

export function maskedKey(p: TeamProvider): string | null {
  const k = keyFor(p);
  return k ? `••••${k.slice(-4)}` : null;
}

export function chosenModel(p: TeamProvider): string | undefined {
  return isTeamProvider(p) ? stored.models[p] : undefined;
}

export function chooseModel(p: TeamProvider, model: string) {
  if (!isTeamProvider(p) || typeof model !== "string" || !model || model.length > 200) return;
  stored.models[p] = model;
  save();
}

/** Check a key with the cheapest request each provider offers (listing models). */
async function check(p: TeamProvider, key: string): Promise<void> {
  const get = async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    // Gemini answers a bad key with 400, the others with 401/403.
    if (!res.ok) throw new Error([400, 401, 403].includes(res.status) ? "that key was rejected" : `the check failed (HTTP ${res.status})`);
  };
  if (p === "claude") {
    try {
      // (the SDK loads only when someone connects a Claude key)
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
    } catch (err) {
      const status = err && typeof err === "object" ? (err as { status?: unknown }).status : undefined;
      throw new Error(status === 401 || status === 403 ? "that key was rejected" : "the check failed");
    }
  } else if (p === "openai") await get("https://api.openai.com/v1/models", { authorization: `Bearer ${key}` });
  else if (p === "groq") await get("https://api.groq.com/openai/v1/models", { authorization: `Bearer ${key}` });
  else if (p === "gemini") await get(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {});
  else await get("https://openrouter.ai/api/v1/key", { authorization: `Bearer ${key}` });
}

export async function connectKey(p: TeamProvider, raw: string): Promise<string> {
  if (!isTeamProvider(p)) throw new Error("that's not one of the team's AIs");
  const key = raw.trim();
  if (key.length < 12 || key.length > 400 || /[^\x21-\x7e]/.test(key)) throw new Error("that doesn't look like an API key");
  await check(p, key);
  stored.keys[p] = key;
  save();
  return `••••${key.slice(-4)}`;
}

export function disconnectKey(p: TeamProvider) {
  if (!isTeamProvider(p)) return;
  delete stored.keys[p];
  save();
}

// ---------------------------------------------------------------- OpenRouter sign-in (OAuth PKCE)

// Each sign-in gets its own random state (in the callback URL: OpenRouter only adds
// the code) and PKCE verifier, good for 10 minutes and used once.
const pending = new Map<string, { verifier: string; expires: number }>();
const SIGNIN_MS = 10 * 60_000;
const MAX_PENDING = 20;

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Where to send the player's browser to sign in to OpenRouter, and the state its callback must bring back. */
export function openRouterAuthUrl(callbackUrl: string): { url: string; state: string } {
  const now = Date.now();
  for (const [s, p] of pending) if (p.expires < now) pending.delete(s);
  // (the oldest go first if someone keeps reloading the link)
  while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
  const state = randomBytes(24).toString("hex");
  const verifier = b64url(randomBytes(48));
  pending.set(state, { verifier, expires: now + SIGNIN_MS });
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const callback = `${callbackUrl}${callbackUrl.includes("?") ? "&" : "?"}state=${state}`;
  const q = new URLSearchParams({ callback_url: callback, code_challenge: challenge, code_challenge_method: "S256", key_label: "Fl-AI Me to the Moon (Office team)" });
  return { url: `https://openrouter.ai/auth?${q}`, state };
}

/** OpenRouter sent them back with a code (and our state): trade it for their key. */
export async function finishOpenRouter(code: string, state: string | null): Promise<void> {
  const p = state ? pending.get(state) : undefined;
  if (state) pending.delete(state);
  if (!p || p.expires < Date.now()) throw new Error("that sign-in link expired or was already used; try again from the game");
  const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: p.verifier, code_challenge_method: "S256" }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { key?: string };
  if (!res.ok || typeof body.key !== "string" || !body.key) throw new Error(`OpenRouter didn't hand over a key (HTTP ${res.status})`);
  stored.keys.openrouter = body.key;
  save();
}

// ---------------------------------------------------------------- OpenRouter models

let modelCache: { at: number; list: string[] } | null = null;

/** The last model menu we fetched (sync, for the office's state). */
export function cachedOpenRouterModels(): string[] {
  return modelCache?.list ?? [];
}

/**
 * A short menu of OpenRouter models that can use tools (the team lead needs
 * them to hire workers): free ones first, then a few well-known ones.
 */
export async function openRouterModels(): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 3_600_000) return modelCache.list;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = ((await res.json()) as { data?: { id: string; context_length?: number; supported_parameters?: string[] }[] }).data ?? [];
    const tools = data.filter((m) => m.supported_parameters?.includes("tools") && !m.id.endsWith(":batch") && !m.id.startsWith("stealth/"));
    // Free models from families that are good at tool use, biggest context first.
    const FAMILIES = ["qwen/", "google/", "deepseek/", "meta-llama/", "mistralai/", "openai/", "nvidia/", "moonshotai/", "z-ai/"];
    const rank = (id: string) => {
      const i = FAMILIES.findIndex((f) => id.startsWith(f));
      return i < 0 ? FAMILIES.length : i;
    };
    const free = tools
      .filter((m) => m.id.endsWith(":free") && (m.context_length ?? 0) >= 32_000 && !/\b[0-3](\.\d)?b\b/i.test(m.id))
      .sort((a, b) => rank(a.id) - rank(b.id) || (b.context_length ?? 0) - (a.context_length ?? 0))
      .slice(0, 4)
      .map((m) => m.id);
    const pick = (prefix: string) => tools.find((m) => m.id.startsWith(prefix) && !m.id.endsWith(":free"))?.id;
    const known = ["anthropic/claude-sonnet", "anthropic/claude-opus", "openai/gpt-5", "google/gemini-2.5-flash", "deepseek/deepseek"].map(pick).filter((x): x is string => !!x);
    modelCache = { at: Date.now(), list: [...new Set([...free, ...known])] };
  } catch (err) {
    console.error("[ai-keys] couldn't list OpenRouter models:", err);
    modelCache = { at: Date.now(), list: modelCache?.list ?? [] };
  }
  return modelCache.list;
}
