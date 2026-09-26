// Scripted agents for when there's no model key (or the venue Wi-Fi dies).
// They run the SAME tools, events and approval gate as the real agents — only
// the "brain" is a script. Force with MOCK_AGENTS=1.

import type Anthropic from "@anthropic-ai/sdk";
import type { VillagerId } from "../../shared/game.js";
import { runLeafTool } from "./agents.js";
import { emit, owns, setVillager } from "./world.js";

/** Forced on with MOCK_AGENTS=1; otherwise agents.ts falls back to it only when no model key exists. */
export const MOCK = process.env.MOCK_AGENTS === "1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;

async function tool(v: VillagerId, taskId: string, name: string, input: Record<string, unknown>) {
  const block = { type: "tool_use", id: `mock_${++n}`, name, input } as Anthropic.Beta.BetaToolUseBlock;
  const r = await runLeafTool(v, taskId, block);
  return { ok: !r.is_error, text: typeof r.content === "string" ? r.content : "" };
}

function think(v: VillagerId, text: string) {
  setVillager(v, { status: "thinking", activity: "thinking…", thought: text });
  emit({ type: "think", villager: v, text });
}

function nextTuesdayAt(h: number, m = 0) {
  const d = new Date();
  d.setDate(d.getDate() + (((2 - d.getDay() + 7) % 7) || 7));
  d.setHours(h, m, 0, 0);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}:00`;
}

async function postmaster(taskId: string, task: string): Promise<string> {
  think("postmaster", "Let me see what's in the mailbox first, then write the reply in the player's voice.");
  await sleep(900);
  await tool("postmaster", taskId, "list_inbox", { unread_only: true });
  await sleep(500);
  await tool("postmaster", taskId, "read_email", { email_id: "m1" });
  await sleep(700);
  if (!owns("post_office")) return "I read Prof. Vega's note, but the Post Office isn't built, so I can't draft a reply.";
  const draft = await tool("postmaster", taskId, "draft_email", {
    to: "vega@physics.example.edu",
    subject: "Re: Office hours this week",
    body:
      "Hi Prof. Vega,\n\nThanks for the heads up! I'd love to come by Tuesday at 3pm to talk about my final project. " +
      "See you in Crow Hall 204.\n\nBest,\n(sent from the Moon)",
  });
  const draftId = (() => {
    try {
      return JSON.parse(draft.text).draft_id as string;
    } catch {
      return "";
    }
  })();
  await sleep(600);
  if (!owns("rocket_pad")) return `Drafted a reply to Prof. Vega (${draftId}), but there's no Mail Rocket on the Post Office yet: build it and I'll send it.`;
  const sent = await tool("postmaster", taskId, "send_email", { draft_id: draftId });
  return sent.ok && sent.text.includes('"sent":true')
    ? "Read Prof. Vega's note and sent your reply confirming Tuesday at 3pm."
    : "Drafted the reply to Prof. Vega, but held it back as you asked.";
}

async function timekeeper(taskId: string): Promise<string> {
  think("timekeeper", "Tuesday afternoon: lecture ends at 2:20, lab shift at 4. 3:00–3:30 should be open.");
  await sleep(1100);
  await tool("timekeeper", taskId, "list_events", { from: nextTuesdayAt(12), to: nextTuesdayAt(18) });
  await sleep(700);
  const booked = await tool("timekeeper", taskId, "create_event", {
    title: "Office hours w/ Prof. Vega",
    start: nextTuesdayAt(15),
    end: nextTuesdayAt(15, 30),
    notes: "Crow Hall 204 — talk about the final project",
  });
  return booked.ok ? "Booked office hours with Prof. Vega, Tuesday 3:00–3:30pm." : `Couldn't book it: ${booked.text}`;
}

async function scholar(taskId: string): Promise<string> {
  think("scholar", "Let me check what's due soon across all the courses.");
  await sleep(900);
  await tool("scholar", taskId, "upcoming_assignments", { days: 7 });
  await sleep(600);
  await tool("scholar", taskId, "course_announcements", { days: 7 });
  return "Next up: Studio 5 (Heaps) is due in two days, then Physics Problem Set 4. Also, Prof. Vega moved office hours to Tuesday 3-5pm.";
}

async function stargazer(taskId: string, task: string): Promise<string> {
  think("stargazer", "Pointing the dish at Earth's web…");
  await sleep(1200);
  return `(Mock mode can't search the real web — add an ANTHROPIC_API_KEY.) You asked: "${task.slice(0, 80)}"`;
}

export async function mockVillager(v: VillagerId, task: string, taskId: string): Promise<string> {
  await sleep(600);
  if (v === "postmaster") return postmaster(taskId, task);
  if (v === "timekeeper") return timekeeper(taskId);
  if (v === "stargazer") return stargazer(taskId, task);
  if (v === "scholar") return scholar(taskId);

  // Jade Rabbit: the teamwork demo — split the job between two neighbors.
  think("jade_rabbit", "Two jobs here: an email to Prof. Vega, and a calendar hold. Postmaster and Timekeeper can do them at the same time.");
  await sleep(1300);
  const jobs: Promise<string>[] = [];
  const handoff = async (to: VillagerId, text: string, run: () => Promise<string>) => {
    emit({ type: "handoff", from: "jade_rabbit", to, text });
    const report = await run();
    emit({ type: "handoff", from: to, to: "jade_rabbit", text: report });
    setVillager(to, { status: "idle", activity: "relaxing" });
    return report;
  };
  jobs.push(handoff("postmaster", "Reply to Prof. Vega: the player will come to office hours Tuesday at 3pm.", () => postmaster(taskId, task)));
  await sleep(400);
  jobs.push(handoff("timekeeper", "Book office hours with Prof. Vega on Tuesday 3:00–3:30pm, Crow Hall 204.", () => timekeeper(taskId)));
  const reports = await Promise.all(jobs);
  await sleep(800);
  const sent = reports[0].startsWith("Read Prof.") ? "your reply is winging its way to Prof. Vega" : "the reply is drafted";
  return `All set! ${sent[0].toUpperCase()}${sent.slice(1)}, and Tuesday 3pm is on your calendar. 🏮`;
}
