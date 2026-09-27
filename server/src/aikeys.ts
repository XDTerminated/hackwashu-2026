// "Connect your AI" for the Office: players bring their own model. Either
// one-click OpenRouter sign-in (OAuth PKCE: they log in, we get a key for
// them, and it reaches Claude, GPT, Gemini and many free models), or they
// paste a Groq / Gemini / OpenAI / Anthropic key. Keys are checked with a tiny
// request, stored owner-only in server/data (gitignored), and never sent back
// to the game (only a masked hint).

import Anthropic from "@anthropic-ai/sdk";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OfficeProvider } from "../../shared/game.js";

const here = dirname(fileURLToPath(import.meta.url));
const KEY_FILE = join(here, "..", "data", "ai-keys.json");

interface Stored {
  keys: Partial<Record<OfficeProvider, string>>;
  models: Partial<Record<OfficeProvider, string>>;
}

let stored: Stored = load();

function load(): Stored {
  try {
    if (existsSync(KEY_FILE)) {
      const s = JSON.parse(readFileSync(KEY_FILE, "utf8")) as Partial<Stored>;
      return { keys: s.keys ?? {}, models: s.models ?? {} };
    }
  } catch (err) {
    console.error("[ai-keys] couldn't read saved keys:", err);
  }
  return { keys: {}, models: {} };
}

function save() {
  mkdirSync(dirname(KEY_FILE), { recursive: true });
  writeFileSync(KEY_FILE, JSON.stringify(stored), { mode: 0o600 });
}

const ENV: Record<OfficeProvider, () => string | undefined> = {
  claude: () => process.env.ANTHROPIC_API_KEY,
  openai: () => process.env.OPENAI_API_KEY,
  groq: () => process.env.GROQ_API ?? process.env.GROQ_API_KEY,
  gemini: () => process.env.GEMINI_API_KEY,
  openrouter: () => process.env.OPENROUTER_API_KEY,
};

/** The key to use: one a player connected in-game, else the server's .env. */
export function keyFor(p: OfficeProvider): string | undefined {
  return stored.keys[p] ?? ENV[p]();
}

/** Where a provider's key came from, for the board ("you" connected it, or the server has one). */
export function keySource(p: OfficeProvider): "you" | "server" | null {
  return stored.keys[p] ? "you" : ENV[p]() ? "server" : null;
}

export function maskedKey(p: OfficeProvider): string | null {
  const k = keyFor(p);
  return k ? `••••${k.slice(-4)}` : null;
}

export function chosenModel(p: OfficeProvider): string | undefined {
  return stored.models[p];
}

export function chooseModel(p: OfficeProvider, model: string) {
  stored.models[p] = model;
  save();
}

/** Check a key with the cheapest request each provider offers (listing models). */
async function check(p: OfficeProvider, key: string): Promise<void> {
  const get = async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, { headers });
    // Gemini answers a bad key with 400, the others with 401/403.
    if (!res.ok) throw new Error([400, 401, 403].includes(res.status) ? "that key was rejected" : `the check failed (HTTP ${res.status})`);
  };
  if (p === "claude") {
    try {
      await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
    } catch (err) {
      throw new Error(err instanceof Anthropic.AuthenticationError ? "that key was rejected" : "the check failed");
    }
  } else if (p === "openai") await get("https://api.openai.com/v1/models", { authorization: `Bearer ${key}` });
  else if (p === "groq") await get("https://api.groq.com/openai/v1/models", { authorization: `Bearer ${key}` });
  else if (p === "gemini") await get(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {});
  else await get("https://openrouter.ai/api/v1/key", { authorization: `Bearer ${key}` });
}

export async function connectKey(p: OfficeProvider, raw: string): Promise<string> {
  const key = raw.trim();
  if (key.length < 12 || /\s/.test(key)) throw new Error("that doesn't look like an API key");
  await check(p, key);
  stored.keys[p] = key;
  save();
  return `••••${key.slice(-4)}`;
}

export function disconnectKey(p: OfficeProvider) {
  delete stored.keys[p];
  save();
}

// ---------------------------------------------------------------- OpenRouter sign-in (OAuth PKCE)

let pending: { verifier: string; expires: number } | null = null;

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Where to send the player's browser to sign in to OpenRouter. */
export function openRouterAuthUrl(callbackUrl: string): string {
  const verifier = b64url(randomBytes(48));
  pending = { verifier, expires: Date.now() + 10 * 60_000 };
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({ callback_url: callbackUrl, code_challenge: challenge, code_challenge_method: "S256", key_label: "Moon Village Office" });
  return `https://openrouter.ai/auth?${q}`;
}

/** OpenRouter sent them back with a code: trade it for their key. */
export async function finishOpenRouter(code: string): Promise<void> {
  if (!pending || pending.expires < Date.now()) throw new Error("the sign-in took too long; try again from the game");
  const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: pending.verifier, code_challenge_method: "S256" }),
  });
  pending = null;
  const body = (await res.json().catch(() => ({}))) as { key?: string };
  if (!res.ok || !body.key) throw new Error(`OpenRouter didn't hand over a key (HTTP ${res.status})`);
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
    const res = await fetch("https://openrouter.ai/api/v1/models");
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
