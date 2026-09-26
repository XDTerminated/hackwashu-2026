// Real Gmail + Google Calendar, via the player's own Google sign-in.
//
// Setup (once): Google Cloud console → new project → enable "Gmail API" and
// "Google Calendar API" → OAuth consent screen (External, add yourself as a
// test user) → Credentials → OAuth client ID → "Web application" with
// authorized redirect URI  http://localhost:8787/oauth/google/callback
// → put GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env. Then sign in from the
// game (walk to the Post Office or Clock Tower and press E).

import { calendar as calendarApi } from "@googleapis/calendar";
import { gmail as gmailApi } from "@googleapis/gmail";
import { OAuth2Client, type Credentials } from "google-auth-library";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CalEvent, Draft, Email, EmailSummary } from "../sandbox.js";

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(here, "..", "..", "data", "google.json");
const PORT = Number(process.env.PORT ?? 8787);
export const GOOGLE_REDIRECT = `http://localhost:${PORT}/oauth/google/callback`;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
];

let client: OAuth2Client | null = null;
let account: string | undefined;
let connected = false;

export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleStatus() {
  return { connected, account, configured: googleConfigured() };
}

function oauth(): OAuth2Client {
  if (!client) {
    client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT);
    // Persist refreshed access tokens so the colony keeps working after restarts.
    client.on("tokens", (t) => save({ ...(readSaved()?.tokens ?? {}), ...t }, account));
  }
  return client;
}

function readSaved(): { tokens: Credentials; account?: string } | null {
  try {
    return existsSync(TOKEN_FILE) ? JSON.parse(readFileSync(TOKEN_FILE, "utf8")) : null;
  } catch {
    return null;
  }
}

function save(tokens: Credentials, acct?: string) {
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify({ tokens, account: acct }), { mode: 0o600 });
}

/** Restore a previous sign-in, if any. */
export async function initGoogle() {
  if (!googleConfigured()) return;
  const saved = readSaved();
  if (!saved?.tokens?.refresh_token) return;
  oauth().setCredentials(saved.tokens);
  account = saved.account;
  connected = true;
  console.log(`[google] restored sign-in${account ? ` for ${account}` : ""}`);
}

export function googleAuthUrl(): string {
  return oauth().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state: "moon-village" });
}

export async function finishGoogleAuth(code: string): Promise<string | undefined> {
  const { tokens } = await oauth().getToken(code);
  oauth().setCredentials(tokens);
  const profile = await gmail().users.getProfile({ userId: "me" });
  account = profile.data.emailAddress ?? undefined;
  save(tokens, account);
  connected = true;
  console.log(`[google] connected ${account}`);
  return account;
}

export function disconnectGoogle() {
  connected = false;
  account = undefined;
  client?.setCredentials({});
  if (existsSync(TOKEN_FILE)) rmSync(TOKEN_FILE);
}

const gmail = () => gmailApi({ version: "v1", auth: oauth() });
const cal = () => calendarApi({ version: "v3", auth: oauth() });

// ---------------------------------------------------------------- gmail

type Part = { mimeType?: string | null; body?: { data?: string | null } | null; parts?: Part[] | null };
const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const header = (h: { name?: string | null; value?: string | null }[] | undefined | null, name: string) =>
  h?.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

function textOf(p: Part): string {
  if (p.mimeType === "text/plain" && p.body?.data) return b64(p.body.data);
  for (const c of p.parts ?? []) {
    const t = textOf(c);
    if (t) return t;
  }
  if (p.mimeType === "text/html" && p.body?.data) return htmlToText(b64(p.body.data));
  return "";
}

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function gmailList(unreadOnly: boolean): Promise<EmailSummary[]> {
  const res = await gmail().users.messages.list({ userId: "me", q: unreadOnly ? "in:inbox is:unread" : "in:inbox", maxResults: 12 });
  const ids = res.data.messages?.map((m) => m.id!).filter(Boolean) ?? [];
  const rows = await Promise.all(
    ids.map(async (id) => {
      const m = await gmail().users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
      const h = m.data.payload?.headers;
      return {
        id,
        from: header(h, "From"),
        subject: header(h, "Subject"),
        receivedAt: new Date(Number(m.data.internalDate ?? 0)).toISOString(),
        read: !(m.data.labelIds ?? []).includes("UNREAD"),
        snippet: m.data.snippet ?? "",
      };
    }),
  );
  return rows;
}

export async function gmailRead(id: string): Promise<Email | undefined> {
  const m = await gmail().users.messages.get({ userId: "me", id, format: "full" });
  const h = m.data.payload?.headers;
  const body = textOf(m.data.payload as Part) || m.data.snippet || "";
  return {
    id,
    from: header(h, "From"),
    subject: header(h, "Subject"),
    receivedAt: new Date(Number(m.data.internalDate ?? 0)).toISOString(),
    read: !(m.data.labelIds ?? []).includes("UNREAD"),
    body: body.length > 5000 ? body.slice(0, 5000) + "\n[...truncated]" : body,
  };
}

const encodeSubject = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);

export async function gmailDraft(to: string, subject: string, body: string, replyToId?: string): Promise<Draft> {
  const headers = [`To: ${to}`, `Subject: ${encodeSubject(subject)}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"'];
  let threadId: string | undefined;
  if (replyToId) {
    // Keep replies in the original conversation.
    const orig = await gmail().users.messages.get({ userId: "me", id: replyToId, format: "metadata", metadataHeaders: ["Message-ID"] });
    threadId = orig.data.threadId ?? undefined;
    const mid = header(orig.data.payload?.headers, "Message-ID");
    if (mid) headers.push(`In-Reply-To: ${mid}`, `References: ${mid}`);
  }
  const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`).toString("base64url");
  const res = await gmail().users.drafts.create({ userId: "me", requestBody: { message: { raw, threadId } } });
  return { id: res.data.id!, to, subject, body, sent: false };
}

export async function gmailGetDraft(id: string): Promise<Draft | undefined> {
  try {
    const d = await gmail().users.drafts.get({ userId: "me", id, format: "full" });
    const h = d.data.message?.payload?.headers;
    return { id, to: header(h, "To"), subject: header(h, "Subject"), body: textOf(d.data.message?.payload as Part), sent: false };
  } catch {
    return undefined;
  }
}

export async function gmailSend(id: string): Promise<Draft> {
  const d = await gmailGetDraft(id);
  if (!d) throw new Error(`no draft with id ${id}`);
  await gmail().users.drafts.send({ userId: "me", requestBody: { id } });
  console.log(`[google] ✉️  SENT to ${d.to}: "${d.subject}"`);
  return { ...d, sent: true };
}

// ---------------------------------------------------------------- calendar

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Local wall-clock ISO without offset — models misread UTC offsets. */
export function localISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const withSeconds = (local: string) => (/T\d\d:\d\d$/.test(local) ? `${local}:00` : local.replace(/(Z|[+-]\d\d:?\d\d)$/, ""));

export async function calendarList(fromLocal: string, toLocal: string): Promise<CalEvent[]> {
  const from = new Date(fromLocal);
  const to = new Date(toLocal);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("times must look like 2026-09-29T09:00");
  const res = await cal().events.list({
    calendarId: "primary",
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });
  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? "",
    title: e.summary ?? "(no title)",
    start: e.start?.dateTime ? localISO(new Date(e.start.dateTime)) : `${e.start?.date} (all day)`,
    end: e.end?.dateTime ? localISO(new Date(e.end.dateTime)) : `${e.end?.date}`,
    notes: e.location ?? undefined,
  }));
}

export async function calendarCreate(title: string, startLocal: string, endLocal: string, notes?: string): Promise<CalEvent> {
  const s = new Date(startLocal);
  const e = new Date(endLocal);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) throw new Error("times must look like 2026-09-29T15:00");
  if (e <= s) throw new Error("end must be after start");
  const res = await cal().events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      description: notes ? `${notes}\n\n— booked by the Timekeeper, Moon Village` : "Booked by the Timekeeper, Moon Village",
      start: { dateTime: withSeconds(startLocal), timeZone: TZ },
      end: { dateTime: withSeconds(endLocal), timeZone: TZ },
    },
  });
  console.log(`[google] 📅 booked "${title}" at ${localISO(s)} local`);
  return { id: res.data.id ?? "", title, start: localISO(s), end: localISO(e), notes };
}
