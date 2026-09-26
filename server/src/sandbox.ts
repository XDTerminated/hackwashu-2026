// Sample data used ONLY when an account isn't connected yet (the player chose
// "use sandbox for now"). Every result from here is labeled source: "sandbox"
// so villagers never pass it off as the player's real mail, calendar or classes.

export interface Email {
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
  read: boolean;
}

export type EmailSummary = Omit<Email, "body"> & { snippet?: string };

export interface Draft {
  id: string;
  to: string;
  subject: string;
  body: string;
  sent: boolean;
}

export interface CalEvent {
  id: string;
  title: string;
  start: string; // ISO
  end: string;
  notes?: string;
}

function dayAt(offsetDays: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function nextWeekday(target: number): number {
  // 0 = Sunday ... 6 = Saturday; returns days from today (1..7)
  const today = new Date().getDay();
  const diff = (target - today + 7) % 7;
  return diff === 0 ? 7 : diff;
}

const tue = nextWeekday(2);
const wed = nextWeekday(3);

const inbox: Email[] = [
  {
    id: "m1",
    from: "Prof. Lena Vega <vega@physics.example.edu>",
    subject: "Office hours this week",
    body:
      "Hi! Quick heads up: I'm moving my office hours to Tuesday from 3 to 5pm in Crow Hall 204. " +
      "If you want to talk about your final project, reply and let me know what time works so I can hold a slot.\n\n— Prof. Vega",
    receivedAt: dayAt(-1, 16, 12).toISOString(),
    read: false,
  },
  {
    id: "m2",
    from: "Mom <mom@family.example.com>",
    subject: "are you eating",
    body:
      "Your father says you moved to the moon?? Call me this weekend. Also are you eating real food. " +
      "Grandma's birthday dinner is next Sunday at 6, you'd better be there (in spirit at least).",
    receivedAt: dayAt(0, 9, 3).toISOString(),
    read: false,
  },
  {
    id: "m3",
    from: "HackWashU Team <team@hackwashu.example.org>",
    subject: "Reminder: submissions due Sunday 12:00 PM",
    body: "Hi hackers! Devpost submissions close Sunday at noon sharp. Finalists pitch at 4:30. Good luck!",
    receivedAt: dayAt(0, 7, 45).toISOString(),
    read: false,
  },
  {
    id: "m4",
    from: "Sam (roommate) <sam@example.com>",
    subject: "rent + dishes",
    body: "yo rent's due the 1st, venmo me when you can. also the dishes are becoming a biology experiment",
    receivedAt: dayAt(-2, 22, 30).toISOString(),
    read: true,
  },
];

const calendar: CalEvent[] = [
  { id: "c1", title: "CSE 247 lecture", start: dayAt(tue, 13, 0).toISOString(), end: dayAt(tue, 14, 20).toISOString() },
  { id: "c2", title: "Lab shift", start: dayAt(tue, 17, 30).toISOString(), end: dayAt(tue, 18, 30).toISOString() },
  { id: "c3", title: "Physics 197 recitation", start: dayAt(wed, 10, 0).toISOString(), end: dayAt(wed, 11, 0).toISOString() },
  { id: "c4", title: "HackWashU submission deadline", start: dayAt(nextWeekday(0), 12, 0).toISOString(), end: dayAt(nextWeekday(0), 12, 30).toISOString() },
];

const drafts: Draft[] = [];

let n = 0;
const id = (p: string) => `${p}${++n}`;

// ---------- email ----------

export function listInbox(unreadOnly: boolean): EmailSummary[] {
  const rows = inbox.filter((m) => !unreadOnly || !m.read);
  return rows.map((m) => ({ id: m.id, from: m.from, subject: m.subject, receivedAt: m.receivedAt, read: m.read }));
}

export function readEmail(emailId: string): Email | undefined {
  const m = inbox.find((e) => e.id === emailId);
  if (m) m.read = true;
  return m;
}

export function draftEmail(to: string, subject: string, body: string, _replyToId?: string): Draft {
  const d: Draft = { id: id("d"), to, subject, body, sent: false };
  drafts.push(d);
  return d;
}

export function getDraft(draftId: string): Draft | undefined {
  return drafts.find((d) => d.id === draftId);
}

export function sendDraft(draftId: string): Draft {
  const d = getDraft(draftId);
  if (!d) throw new Error(`no draft with id ${draftId}`);
  if (d.sent) throw new Error(`draft ${draftId} was already sent`);
  d.sent = true;
  console.log(`[earth] ✉️  SENT to ${d.to}: "${d.subject}"`);
  return d;
}

// ---------- calendar ----------

/** Local wall-clock ISO (no "Z") — models misread UTC offsets as local times. */
function localISO(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const present = (e: CalEvent): CalEvent => ({ ...e, start: localISO(e.start), end: localISO(e.end) });

export function listEvents(fromISO: string, toISO: string) {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) throw new Error("dates must be ISO 8601, e.g. 2026-09-29T00:00:00");
  return calendar
    .filter((e) => new Date(e.end).getTime() > from && new Date(e.start).getTime() < to)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map(present);
}

export function createEvent(title: string, startISO: string, endISO: string, notes?: string): CalEvent {
  const s = new Date(startISO);
  const e = new Date(endISO);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) throw new Error("dates must be ISO 8601");
  if (e <= s) throw new Error("end must be after start");
  const clash = calendar.find((c) => new Date(c.start) < e && new Date(c.end) > s);
  if (clash) throw new Error(`conflicts with "${clash.title}" (${localISO(clash.start)} – ${localISO(clash.end)} local)`);
  const ev: CalEvent = { id: id("c"), title, start: s.toISOString(), end: e.toISOString(), notes };
  calendar.push(ev);
  console.log(`[earth] 📅 booked "${title}" at ${localISO(ev.start)} local`);
  return present(ev);
}

// ---------- canvas ----------

const COURSES = [
  { id: "101", name: "CSE 2407: Data Structures & Algorithms", code: "CSE 2407", grade: "A-" },
  { id: "102", name: "PHYSICS 197: Physics I", code: "PHYS 197", grade: "B+" },
  { id: "103", name: "WRITING 1: Writing I", code: "WRITING 1", grade: "A" },
];

export function canvasCourses() {
  return COURSES;
}

export function canvasUpcoming(days: number) {
  const items = [
    { course: "CSE 2407", name: "Studio 5: Heaps & Priority Queues", at: dayAt(2, 23, 59), points: 10 },
    { course: "PHYS 197", name: "Problem Set 4", at: dayAt(4, 17, 0), points: 25 },
    { course: "WRITING 1", name: "Essay 2 draft: \"What the Moon Taught Me\"", at: dayAt(6, 23, 59), points: 50 },
    { course: "CSE 2407", name: "Exam 1", at: dayAt(9, 18, 30), points: 100 },
  ];
  const horizon = Date.now() + days * 86_400_000;
  return items
    .filter((a) => a.at.getTime() <= horizon)
    .map((a) => ({
      course: a.course,
      name: a.name,
      due: a.at.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      dueAt: a.at.toISOString(),
      points: a.points,
      url: "",
    }));
}

export function canvasAnnouncements(_days: number) {
  return [
    { course: "CSE 2407", title: "Exam 1 review session", posted: dayAt(-1, 10, 0).toISOString(), text: "Review session Thursday 7pm in Urbauer 222. Bring questions about heaps and hashing!" },
    { course: "PHYS 197", title: "Office hours moved", posted: dayAt(-2, 14, 0).toISOString(), text: "Prof. Vega's office hours move to Tuesday 3-5pm in Crow Hall 204 this week." },
  ];
}
