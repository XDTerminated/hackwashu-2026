// Real Canvas LMS (read-only), via a personal access token.
//
// Setup: in Canvas (WashU: https://wustl.instructure.com) → Account →
// Settings → "+ New Access Token" → paste it into the game at the Library.
// Or set CANVAS_TOKEN (and optionally CANVAS_BASE_URL) in .env.

import { DATA_DIR } from "../env.js";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { htmlToText } from "./google.js";

const here = dirname(fileURLToPath(import.meta.url));
const CRED_FILE = join(DATA_DIR, "canvas.json");
export const DEFAULT_CANVAS = "https://wustl.instructure.com";

let cred: { baseUrl: string; token: string; account?: string } | null = null;

export function canvasStatus() {
  return { connected: !!cred, account: cred?.account, baseUrl: cred?.baseUrl };
}

async function api<T>(path: string, params: Record<string, string | string[]> = {}, c = cred): Promise<T> {
  if (!c) throw new Error("Canvas isn't connected");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const one of Array.isArray(v) ? v : [v]) qs.append(k, one);
  const res = await fetch(`${c.baseUrl}/api/v1${path}${qs.size ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${c.token}` } });
  if (res.status === 401) throw new Error("Canvas rejected the access token (expired or revoked?)");
  if (!res.ok) throw new Error(`Canvas error ${res.status} on ${path}`);
  return (await res.json()) as T;
}

export async function initCanvas() {
  try {
    if (existsSync(CRED_FILE)) cred = JSON.parse(readFileSync(CRED_FILE, "utf8"));
    else if (process.env.CANVAS_TOKEN) cred = { baseUrl: (process.env.CANVAS_BASE_URL ?? DEFAULT_CANVAS).replace(/\/$/, ""), token: process.env.CANVAS_TOKEN };
    if (cred && !cred.account) cred.account = (await api<{ name: string }>("/users/self")).name;
    if (cred) console.log(`[canvas] connected${cred.account ? ` as ${cred.account}` : ""} (${cred.baseUrl})`);
  } catch (err) {
    console.error("[canvas] saved token didn't work:", err instanceof Error ? err.message : err);
    cred = null;
  }
}

/** Validate a pasted token against Canvas, then keep it. */
export async function connectCanvas(token: string, baseUrl = DEFAULT_CANVAS): Promise<string> {
  const c = { baseUrl: baseUrl.trim().replace(/\/$/, ""), token: token.trim() };
  if (!/^https:\/\//.test(c.baseUrl)) throw new Error("Canvas URL must start with https://");
  const me = await api<{ name: string }>("/users/self", {}, c);
  cred = { ...c, account: me.name };
  mkdirSync(dirname(CRED_FILE), { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(cred), { mode: 0o600 });
  console.log(`[canvas] connected as ${me.name}`);
  return me.name;
}

/** A Canvas web address from a school's domain ("canvas.harvard.edu" -> https://canvas.harvard.edu), or null if it isn't one. */
export function canvasBase(domain: string | undefined): string | null {
  const d = (domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? `https://${d}` : null;
}

const schoolCache = new Map<string, { at: number; list: { name: string; domain: string }[] }>();

/**
 * Find a school's Canvas by name, using the public directory the official
 * Canvas apps use ("Find your school"). Any school on Canvas can connect.
 */
export async function searchSchools(term: string): Promise<{ name: string; domain: string }[]> {
  const q = term.trim().slice(0, 80);
  if (q.length < 2) return [];
  const hit = schoolCache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < 3_600_000) return hit.list;
  const res = await fetch(`https://canvas.instructure.com/api/v1/accounts/search?search_term=${encodeURIComponent(q)}&per_page=12`);
  if (!res.ok) throw new Error(`the school directory didn't answer (${res.status})`);
  const raw = (await res.json()) as { name?: string; domain?: string }[];
  const seen = new Set<string>();
  const list = raw
    .filter((x) => x.name && x.domain && canvasBase(x.domain))
    .filter((x) => !seen.has(x.domain!) && seen.add(x.domain!))
    .map((x) => ({ name: x.name!, domain: x.domain! }));
  schoolCache.set(q.toLowerCase(), { at: Date.now(), list });
  return list;
}

export function disconnectCanvas() {
  cred = null;
  if (existsSync(CRED_FILE)) rmSync(CRED_FILE);
}

// ---------------------------------------------------------------- reads

interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  enrollments?: { computed_current_score?: number | null; computed_current_grade?: string | null }[];
}

export async function canvasCourses() {
  const courses = await api<CanvasCourse[]>("/courses", { enrollment_state: "active", per_page: "50", "include[]": ["total_scores"] });
  return courses
    .filter((c) => c.name)
    .map((c) => ({
      id: String(c.id),
      name: c.name,
      code: c.course_code,
      grade: c.enrollments?.[0]?.computed_current_grade ?? c.enrollments?.[0]?.computed_current_score ?? null,
    }));
}

export async function canvasUpcoming(days: number) {
  const courses = await canvasCourses();
  const horizon = Date.now() + days * 86_400_000;
  const perCourse = await Promise.all(
    courses.map(async (c) => {
      const items = await api<{ name: string; due_at: string | null; points_possible: number | null; html_url: string; has_submitted_submissions?: boolean }[]>(
        `/courses/${c.id}/assignments`,
        { bucket: "upcoming", order_by: "due_at", per_page: "30" },
      ).catch(() => []);
      return items
        .filter((a) => a.due_at && new Date(a.due_at).getTime() <= horizon)
        .map((a) => ({ course: c.code || c.name, name: a.name, due: new Date(a.due_at!).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), dueAt: a.due_at, points: a.points_possible, url: a.html_url }));
    }),
  );
  return perCourse.flat().sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
}

export async function canvasAnnouncements(days: number) {
  const courses = await canvasCourses();
  if (courses.length === 0) return [];
  const start = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const items = await api<{ title: string; message: string; posted_at: string; context_code: string }[]>("/announcements", {
    "context_codes[]": courses.map((c) => `course_${c.id}`),
    start_date: start,
    end_date: end,
    per_page: "20",
  });
  const byId = new Map(courses.map((c) => [`course_${c.id}`, c.code || c.name]));
  return items.map((a) => {
    const text = htmlToText(a.message ?? "");
    return { course: byId.get(a.context_code) ?? a.context_code, title: a.title, posted: a.posted_at, text: text.length > 1200 ? text.slice(0, 1200) + " [...]" : text };
  });
}
