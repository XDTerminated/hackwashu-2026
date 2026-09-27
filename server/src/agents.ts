// Villager agents. Each villager is a Claude tool-use loop; every thinking
// summary, tool call, handoff and approval is emitted as a GameEvent so the
// island can replay it. Agents never wait on animations — the client paces itself.

import Anthropic from "@anthropic-ai/sdk";
import {
  BUILDINGS,
  GRAND_BONUS,
  VILLAGER_HOME,
  type Approval,
  type BuildingId,
  type Clod,
  type TaskSource,
  type VillagerId,
} from "../../shared/game.js";
import { waitForApproval } from "./approvals.js";
import * as spotify from "./connectors/spotify.js";
import { MOCK, mockVillager } from "./mock.js";
import { Groq, runVillagerGroq } from "./groq.js";
import * as services from "./services.js";
import { addFacts, befriend, memoryNote, remember } from "./memory.js";
import { retell, splitNotes, tooLongToSay } from "./chat.js";
import { audienceNote, personaFor, nameOf, type Audience } from "./villagers.js";
import { addLantern, emit, newId, owns, putApproval, putClod, setVillager, world } from "./world.js";
import { agentsState } from "./agentwatch.js";

const client = new Anthropic();
const MODEL = "claude-opus-5";
const MAX_TURNS = 12;

type Tool = Anthropic.Beta.BetaToolUnion;
type ToolUse = Anthropic.Beta.BetaToolUseBlock;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

// ------------------------------------------------------------------ tools

interface LeafTool {
  owner: VillagerId;
  building: BuildingId;
  reward: number;
  def: Anthropic.Beta.BetaTool;
  label: (input: Record<string, unknown>) => string;
  /** Anything that leaves the player's account waits for their OK (letter at the door / text reply). */
  needsApproval?: (input: Record<string, unknown>) => Promise<{ title: string; body: string } | undefined>;
  /** Just a look around (no little star runs off to do it, and nothing to pop). */
  quiet?: boolean;
  run: (input: Record<string, unknown>) => Promise<{ text: string; summary: string }>;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const whenLocal = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const ago = (ms: number) => (ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)} h`);

const LEAF_TOOLS: Record<string, LeafTool> = {
  check_office: {
    owner: "manager",
    building: "office",
    reward: 0,
    quiet: true,
    def: {
      name: "check_office",
      description: "Look around the Office: the player's coding-agent sessions right now, the lead agent and every sub-agent (what each is doing, its status, how long it's been going), and what finished recently.",
      input_schema: { type: "object", properties: {} },
    },
    label: () => "looking around the Office",
    run: async () => {
      const s = agentsState();
      const now = Date.now();
      const view = (a: (typeof s.sessions)[number]["lead"]) => ({ name: a.name, kind: a.kind, status: a.status, doing: a.now, for: ago(now - a.startedAt), last_activity: `${ago(now - a.lastAt)} ago` });
      const sessions = s.sessions.slice(0, 3).map((x) => ({
        title: x.title,
        project: x.project,
        branch: x.branch,
        replay: x.source === "replay" ? "this is a replay of a past session, not live work" : undefined,
        lead: view(x.lead),
        agents: x.workers.map(view),
      }));
      const linked = s.link ? (s.link.status === "linked" ? "their computer is linked" : "no computer linked yet") : undefined;
      const working = s.sessions.reduce((n, x) => n + x.workers.filter((w) => w.status === "working" || w.status === "thinking").length, 0);
      return {
        text: JSON.stringify({ sessions, link: linked, note: sessions.length ? undefined : "Nobody's in the Office right now: no coding agents running." }),
        summary: sessions.length ? `${plural(working, "agent")} at work` : "the Office is quiet",
      };
    },
  },

  list_inbox: {
    owner: "postmaster",
    building: "mailbox",
    reward: 4,
    def: {
      name: "list_inbox",
      description: "List recent emails in the player's inbox (id, sender, subject, time, read/unread, snippet). Use read_email to open one.",
      input_schema: { type: "object", properties: { unread_only: { type: "boolean", description: "Only unread mail. Default true." } } },
    },
    label: () => "checking the mailbox",
    run: async (i) => {
      const { data, source } = await services.mail.list(i.unread_only !== false);
      return { text: JSON.stringify({ source, emails: data }), summary: `${plural(data.length, "letter")} in the mailbox` };
    },
  },
  read_email: {
    owner: "postmaster",
    building: "mailbox",
    reward: 4,
    def: {
      name: "read_email",
      description: "Open one email by id and read its full body.",
      input_schema: { type: "object", properties: { email_id: { type: "string" } }, required: ["email_id"] },
    },
    label: () => "reading a letter",
    run: async (i) => {
      const { data: m, source } = await services.mail.read(str(i.email_id));
      if (!m) throw new Error(`no email with id ${str(i.email_id)}`);
      return { text: JSON.stringify({ source, email: m }), summary: `"${m.subject}" from ${m.from.split("<")[0].trim()}` };
    },
  },
  draft_email: {
    owner: "postmaster",
    building: "post_office",
    reward: 8,
    def: {
      name: "draft_email",
      description:
        "Write a draft email in the player's account. Returns a draft_id. Drafting sends nothing. Pass reply_to_email_id to reply inside an existing conversation.",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address: exactly the one the player gave, or one found in their mail. Any address is fine; never make one up." },
          subject: { type: "string" },
          body: { type: "string" },
          reply_to_email_id: { type: "string", description: "Optional: id of the email you're replying to" },
        },
        required: ["to", "subject", "body"],
      },
    },
    label: (i) => `drafting "${str(i.subject).slice(0, 28)}"`,
    run: async (i) => {
      const { data: d, source } = await services.mail.draft(str(i.to), str(i.subject), str(i.body), str(i.reply_to_email_id) || undefined);
      const next = owns("rocket_pad")
        ? "Next: if you were asked to send it, call send_email with this draft_id now — the player approves it via a letter at their door."
        : "The Mail Rocket isn't built on the Post Office yet, so it can't be sent — it's saved in the player's drafts. Report that.";
      return { text: JSON.stringify({ source, draft_id: d.id, to: d.to, subject: d.subject, next }), summary: `draft to ${d.to}: "${d.subject}"` };
    },
  },
  send_email: {
    owner: "postmaster",
    building: "rocket_pad",
    reward: 12,
    def: {
      name: "send_email",
      description: "Send a drafted email. The player must approve first — this call waits until they answer and tells you whether it was sent.",
      input_schema: { type: "object", properties: { draft_id: { type: "string" } }, required: ["draft_id"] },
    },
    label: () => "launching mail to Earth",
    needsApproval: async (i) => {
      const d = (await services.mail.getDraft(str(i.draft_id)).catch(() => null))?.data;
      if (!d) return undefined; // run() will report the bad id
      return { title: `Send "${d.subject}" to ${d.to}?`, body: d.body };
    },
    run: async (i) => {
      const { data: d, source } = await services.mail.send(str(i.draft_id));
      return { text: JSON.stringify({ source, sent: true, to: d.to, subject: d.subject }), summary: `sent "${d.subject}" to ${d.to}` };
    },
  },
  list_events: {
    owner: "timekeeper",
    building: "clock_tower",
    reward: 4,
    def: {
      name: "list_events",
      description: "List the player's calendar events overlapping a time range. All times are the player's local time (no timezone suffix).",
      input_schema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Local time, e.g. 2026-09-29T00:00" },
          to: { type: "string", description: "Local time, e.g. 2026-09-29T23:59" },
        },
        required: ["from", "to"],
      },
    },
    label: (i) => `reading the clock for ${new Date(str(i.from)).toLocaleDateString("en-US", { weekday: "short" })}`,
    run: async (i) => {
      const { data, source } = await services.calendar.list(str(i.from), str(i.to));
      return { text: JSON.stringify({ source, events: data }), summary: `${plural(data.length, "event")} on the calendar` };
    },
  },
  create_event: {
    owner: "timekeeper",
    building: "clock_tower",
    reward: 10,
    def: {
      name: "create_event",
      description:
        "Add an event to the player's calendar. The player must approve first — this call waits for their answer. Check list_events for conflicts before calling.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          start: { type: "string", description: "Local time, e.g. 2026-09-29T15:00 (no Z / offset)" },
          end: { type: "string", description: "Local time, e.g. 2026-09-29T15:30 (no Z / offset)" },
          notes: { type: "string" },
        },
        required: ["title", "start", "end"],
      },
    },
    label: (i) => `booking "${str(i.title).slice(0, 26)}"`,
    needsApproval: async (i) => {
      const end = new Date(str(i.end)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return { title: `Add "${str(i.title)}" to your calendar?`, body: `${whenLocal(str(i.start))} – ${end}${str(i.notes) ? `\n\n${str(i.notes)}` : ""}` };
    },
    run: async (i) => {
      const { data: ev, source } = await services.calendar.create(str(i.title), str(i.start), str(i.end), str(i.notes) || undefined);
      return { text: JSON.stringify({ source, event: ev }), summary: `booked "${ev.title}" ${whenLocal(ev.start)}` };
    },
  },
  list_courses: {
    owner: "scholar",
    building: "library",
    reward: 4,
    def: {
      name: "list_courses",
      description: "List the player's active Canvas courses with their current grade when available.",
      input_schema: { type: "object", properties: {} },
    },
    label: () => "pulling the course catalog",
    run: async () => {
      const { data, source } = await services.school.courses();
      return { text: JSON.stringify({ source, courses: data }), summary: plural(data.length, "course") };
    },
  },
  upcoming_assignments: {
    owner: "scholar",
    building: "library",
    reward: 6,
    def: {
      name: "upcoming_assignments",
      description: "List assignments due soon across all of the player's Canvas courses, soonest first.",
      input_schema: { type: "object", properties: { days: { type: "number", description: "How many days ahead to look. Default 7." } } },
    },
    label: () => "checking due dates",
    run: async (i) => {
      const { data, source } = await services.school.upcoming(num(i.days, 7));
      return { text: JSON.stringify({ source, assignments: data }), summary: `${plural(data.length, "assignment")} due soon` };
    },
  },
  course_announcements: {
    owner: "scholar",
    building: "library",
    reward: 6,
    def: {
      name: "course_announcements",
      description: "Read recent announcements from the player's Canvas courses.",
      input_schema: { type: "object", properties: { days: { type: "number", description: "How many days back. Default 7." } } },
    },
    label: () => "reading the notice board",
    run: async (i) => {
      const { data, source } = await services.school.announcements(num(i.days, 7));
      return { text: JSON.stringify({ source, announcements: data }), summary: plural(data.length, "announcement") };
    },
  },

  // Echo's Radio Tower: the player's Spotify, playing right in the game tab.
  play_music: {
    owner: "dj",
    building: "radio_tower",
    reward: 0,
    quiet: true,
    def: {
      name: "play_music",
      description: "Find something on Spotify and play it in the game now. kind: track for a specific song, playlist for a mood or genre, album for a whole record, artist for their top songs.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: 'What to search for: "fly me to the moon sinatra", "chill lo-fi beats", "abbey road".' },
          kind: { type: "string", enum: ["track", "playlist", "album", "artist"], description: "Default track." },
        },
        required: ["query"],
      },
    },
    label: () => "cueing up a record",
    run: async (i) => {
      const kind = (["track", "playlist", "album", "artist"] as const).find((k) => k === i.kind) ?? "track";
      const f = await spotify.play(str(i.query), kind);
      emit({ type: "music", action: "playing", track: f.name, artist: f.by });
      return { text: JSON.stringify({ playing: f.name, by: f.by, kind }), summary: `playing ${f.name}` };
    },
  },
  pause_music: {
    owner: "dj",
    building: "radio_tower",
    reward: 0,
    quiet: true,
    def: { name: "pause_music", description: "Pause the music.", input_schema: { type: "object", properties: {} } },
    label: () => "pausing the music",
    run: async () => {
      await spotify.pause();
      emit({ type: "music", action: "paused" });
      return { text: "paused", summary: "paused" };
    },
  },
  resume_music: {
    owner: "dj",
    building: "radio_tower",
    reward: 0,
    quiet: true,
    def: { name: "resume_music", description: "Carry on playing whatever was paused.", input_schema: { type: "object", properties: {} } },
    label: () => "back to the music",
    run: async () => {
      await spotify.resume();
      return { text: "playing again", summary: "resumed" };
    },
  },
  skip_track: {
    owner: "dj",
    building: "radio_tower",
    reward: 0,
    quiet: true,
    def: {
      name: "skip_track",
      description: "Skip to the next song, or back to the previous one.",
      input_schema: { type: "object", properties: { back: { type: "boolean", description: "true to go back a song. Default false." } } },
    },
    label: () => "flipping the record",
    run: async (i) => {
      await spotify.skip(i.back === true);
      return { text: i.back === true ? "went back a song" : "skipped", summary: "skipped" };
    },
  },
  queue_song: {
    owner: "dj",
    building: "radio_tower",
    reward: 0,
    quiet: true,
    def: {
      name: "queue_song",
      description: "Find a song on Spotify and add it to the queue, to play after the current one.",
      input_schema: { type: "object", properties: { query: { type: "string", description: "The song (and artist, if known)." } }, required: ["query"] },
    },
    label: () => "queueing a song",
    run: async (i) => {
      const f = await spotify.queue(str(i.query));
      return { text: JSON.stringify({ queued: f.name, by: f.by }), summary: `queued ${f.name}` };
    },
  },
  set_volume: {
    owner: "dj",
    building: "radio_tower",
    reward: 0,
    quiet: true,
    def: {
      name: "set_volume",
      description: "Set the music's volume, 0 to 100.",
      input_schema: { type: "object", properties: { percent: { type: "number" } }, required: ["percent"] },
    },
    label: () => "turning the dial",
    run: async (i) => {
      await spotify.volume(num(i.percent, 50));
      return { text: `volume ${Math.round(num(i.percent, 50))}%`, summary: "volume set" };
    },
  },
  now_playing: {
    owner: "dj",
    building: "radio_tower",
    reward: 0,
    quiet: true,
    def: { name: "now_playing", description: "What's playing right now (song, artist, how far in), if anything.", input_schema: { type: "object", properties: {} } },
    label: () => "checking the deck",
    run: async () => {
      const n = await spotify.nowPlaying();
      return { text: JSON.stringify(n ?? { playing: false }), summary: n?.track ? `${n.track}` : "nothing on" };
    },
  },
};

const WORKERS: VillagerId[] = ["postmaster", "timekeeper", "scholar", "stargazer", "dj"];
const movedIn = services.isResident;

export function toolsFor(v: VillagerId): Tool[] {
  if (v === "jade_rabbit") {
    if (!services.rabbitTeamwork()) return [];
    const available = WORKERS.filter(movedIn);
    return [
      {
        name: "delegate",
        description:
          "Hand a self-contained task to a neighbor and get their report back. " +
          "postmaster = Gmail (read inbox, draft, send with the player's OK). " +
          "timekeeper = Google Calendar (check free time, book events with the player's OK). " +
          "scholar = Canvas (courses, grades, due dates, announcements). " +
          "stargazer = web research. " +
          "dj = Spotify music in the game (play, pause, skip, queue). Call several at once for independent pieces.",
        input_schema: {
          type: "object",
          properties: {
            villager: { type: "string", enum: available },
            task: { type: "string", description: "Complete instructions; they can't see your conversation." },
          },
          required: ["villager", "task"],
        },
      },
    ];
  }
  if (v === "stargazer") {
    return [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }];
  }
  // (Echo can only play once the player's Spotify is connected)
  if (v === "dj" && !spotify.spotifyStatus().connected) return [];
  return Object.entries(LEAF_TOOLS)
    .filter(([, t]) => t.owner === v && owns(t.building))
    .map(([, t]) => t.def);
}

export function missingBuildingsNote(v: VillagerId): string {
  if (v === "jade_rabbit") {
    const quest = `\n\n${services.townNote()} The player's next goal: ${services.nextStep()} (Neighbors' plots are bought at the Town Hall, set down anywhere, and built with materials. Materials: moonstone from boulders and fallen meteors; stardust from sweeping moondust; moon shards from the wilds; glow ore from meteors and the old glowing craters; ice crystals in the north and scrap metal and helium-3 in the south, once the roads are fixed. Coins from popping the stars neighbors leave after real work, sweeping, meteors and requests.)`;
    const guide = services.rabbitTeamwork()
      ? ""
      : "\n\nRight now you're just the guide: you can't hand out work until two neighbors live here. Point the player at their current goal instead.";
    const home = WORKERS.filter(movedIn).map(nameOf);
    const away = WORKERS.filter((w) => !movedIn(w)).map(nameOf);
    return `${guide}${quest}\n\nNeighbors who live here now: ${home.join(", ") || "none"}.${away.length ? ` Not here yet: ${away.join(", ")}.` : ""}`;
  }
  const missing = [...new Set(Object.values(LEAF_TOOLS).filter((t) => t.owner === v && !owns(t.building)).map((t) => BUILDINGS[t.building].name))];
  return services.accountNote(v) + (missing.length ? `\n\nNot built yet (so you can't do these): ${missing.join(", ")}.` : "");
}

// ------------------------------------------------------------------ loop

export async function runLeafTool(v: VillagerId, taskId: string, block: ToolUse): Promise<ToolResult> {
  const tool = LEAF_TOOLS[block.name];
  const input = (block.input ?? {}) as Record<string, unknown>;
  if (!tool || tool.owner !== v) {
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `unknown tool ${block.name}` };
  }
  if (tool.quiet) {
    setVillager(v, { status: "working", activity: tool.label(input) });
    try {
      return { type: "tool_result", tool_use_id: block.id, content: (await tool.run(input)).text };
    } catch (err) {
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: err instanceof Error ? err.message : String(err) };
    }
  }

  const clod: Clod = {
    id: newId("clod"),
    taskId,
    villager: v,
    building: tool.building,
    label: tool.label(input),
    status: "working",
    // (a grand house pays more for its neighbor's work)
    reward: Math.round(tool.reward * (services.grandHome(v) ? GRAND_BONUS : 1)),
  };
  putClod(clod);
  setVillager(v, { status: "working", activity: clod.label });
  emit({ type: "tool_start", villager: v, clod: { ...clod } });

  const gate = await tool.needsApproval?.(input).catch(() => undefined);
  if (gate) {
    const approval: Approval = { id: newId("ok"), villager: v, clodId: clod.id, title: gate.title, body: gate.body, status: "pending" };
    clod.status = "stuck";
    clod.approvalId = approval.id;
    putClod(clod);
    putApproval(approval);
    setVillager(v, { status: "waiting", activity: "waiting for your OK" });
    emit({ type: "approval_needed", villager: v, approval });

    const approved = await waitForApproval(approval);
    const via = lastApprovalVia.get(approval.id) ?? "game";
    emit({ type: "approval_resolved", villager: v, approvalId: approval.id, clodId: clod.id, approved, via });
    setVillager(v, { status: "working", activity: clod.label });

    if (!approved) {
      clod.status = "ready";
      clod.reward = 2;
      clod.result = "held back — you said no";
      putClod(clod);
      emit({ type: "tool_end", villager: v, clodId: clod.id, ok: true, result: clod.result });
      return { type: "tool_result", tool_use_id: block.id, content: "The player declined. Nothing was done. Don't retry unless they ask." };
    }
  }

  try {
    const { text, summary } = await tool.run(input);
    clod.status = "ready";
    clod.result = summary;
    putClod(clod);
    emit({ type: "tool_end", villager: v, clodId: clod.id, ok: true, result: summary });
    return { type: "tool_result", tool_use_id: block.id, content: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    clod.status = "failed";
    clod.result = message;
    putClod(clod);
    emit({ type: "tool_end", villager: v, clodId: clod.id, ok: false, result: message });
    emit({ type: "building_error", villager: v, building: tool.building, message });
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: message };
  }
}

/** Neighbors each top-level task handed work to — the teamwork quest counts these. */
const delegations = new Map<string, Set<VillagerId>>();

/** Which channel answered each approval — set by the WS / Photon handlers. */
export const lastApprovalVia = new Map<string, "game" | "phone">();

export async function runDelegate(from: VillagerId, taskId: string, block: ToolUse): Promise<ToolResult> {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const to = str(input.villager) as VillagerId;
  const task = str(input.task);
  if (!WORKERS.includes(to) || !movedIn(to)) {
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `${to} hasn't moved in yet` };
  }
  emit({ type: "handoff", from, to, text: task });
  delegations.get(taskId)?.add(to);
  const report = await runVillager(to, task, taskId, "report");
  emit({ type: "handoff", from: to, to: from, text: report });
  setVillager(to, { status: "idle", activity: "relaxing" });
  return { type: "tool_result", tool_use_id: block.id, content: report || "(no report)" };
}

/** Emit clods for server-side web searches after the fact — they already ran. */
function surfaceServerTools(v: VillagerId, taskId: string, content: Anthropic.Beta.BetaContentBlock[]) {
  for (const b of content) {
    if (b.type !== "server_tool_use") continue;
    const q = str((b.input as Record<string, unknown>)?.query);
    const clod: Clod = {
      id: newId("clod"),
      taskId,
      villager: v,
      building: "observatory",
      label: `searching "${q.slice(0, 30)}"`,
      status: "ready",
      reward: 6,
      result: `searched Earth for "${q}"`,
    };
    putClod({ ...clod });
    emit({ type: "tool_start", villager: v, clod: { ...clod, status: "working" } });
    emit({ type: "tool_end", villager: v, clodId: clod.id, ok: true, result: clod.result! });
  }
}

async function runVillagerClaude(v: VillagerId, taskText: string, taskId: string, audience: Audience): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: taskText }];
  const tools = toolsFor(v);
  const system = personaFor(v) + missingBuildingsNote(v) + memoryNote(v, true) + audienceNote(audience);
  let finalText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    setVillager(v, { status: "thinking", activity: "thinking…" });

    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      system,
      ...(tools.length ? { tools } : {}),
      messages,
    });

    for (const b of response.content) {
      if (b.type === "thinking" && b.thinking.trim()) {
        setVillager(v, { thought: b.thinking.trim() });
        emit({ type: "think", villager: v, text: b.thinking.trim() });
      }
    }
    surfaceServerTools(v, taskId, response.content);

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (text) finalText = text;

    if (response.stop_reason === "refusal") {
      return "Hmm, moondust in my ears — I can't help with that one.";
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    const uses = response.content.filter((b): b is ToolUse => b.type === "tool_use");
    if (uses.length === 0) break;
    if (response.stop_reason === "max_tokens") {
      throw new Error("tool input was cut off at max_tokens");
    }

    messages.push({ role: "assistant", content: response.content });
    if (text && v !== "jade_rabbit") emit({ type: "say", villager: v, text });

    const results = await Promise.all(
      uses.map((u) => (u.name === "delegate" ? runDelegate(v, taskId, u) : runLeafTool(v, taskId, u))),
    );
    messages.push({ role: "user", content: results });
  }

  return finalText;
}

/** Which model thinks for the villagers: Claude if keyed, else Groq, else the scripted mock. */
export const BRAIN: "claude" | "groq" | "mock" = MOCK
  ? "mock"
  : process.env.ANTHROPIC_API_KEY
    ? "claude"
    : process.env.GROQ_API || process.env.GROQ_API_KEY
      ? "groq"
      : "mock";

function runVillager(v: VillagerId, taskText: string, taskId: string, audience: Audience): Promise<string> {
  return BRAIN === "groq" ? runVillagerGroq(v, taskText, taskId, audience) : runVillagerClaude(v, taskText, taskId, audience);
}

// ------------------------------------------------------------------ entry

export function friendlyError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "The colony's thinking-cap is missing its key crystal! (No valid ANTHROPIC_API_KEY on the server.)";
  }
  if (error instanceof Anthropic.RateLimitError) return "Too many moonbeams at once — give me a breath and ask again?";
  if (error instanceof Anthropic.APIError) return `The line to Earth crackled (API error ${error.status}). Try again?`;
  if (error instanceof Groq.RateLimitError) return "Too many moonbeams at once — give me a breath and ask again?";
  if (error instanceof Groq.AuthenticationError) return "The colony's thinking-cap rejected its key crystal (check GROQ_API in .env).";
  if (error instanceof Groq.APIError) return `The line to Earth crackled (Groq error ${error.status}). Try again?`;
  if (error instanceof Error && error.message.includes("authentication method")) {
    return "The colony's thinking-cap is missing its key crystal! (Put ANTHROPIC_API_KEY in server/.env.)";
  }
  return "Something rattled loose in the burrow. Check the server log, traveler.";
}

/**
 * Stock closers the models love to tack on ("Let me know if...", "Happy to help!",
 * an emoji) come off the end of a reply. Only whole trailing sentences that are
 * nothing but filler; the answer itself is never touched.
 */
const FILLER = [
  /^(just )?let me know if (there'?s|you (need|want|'d like|have|ever)|anything)/i,
  /^(feel free|happy to help|glad (i|to) (could )?help|hope (this|that) helps|anything else\b|is there anything else|enjoy\b|have a (great|nice|good|lovely)\b)/i,
  /^if you (need|want|'d like|have|spot|see|think of|ever)\b.*\b(let me know|just ask|i'm (always )?(here|around)|holler)[.!]*$/i,
  /^(i'm (always )?(here|around)( if you need me| to help)?|just (ask|holler|say the word))[.!]*$/i,
];
export function trimFiller(text: string): string {
  let out = text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/[ \t]+([.!?,])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  for (;;) {
    const parts = out.split(/(?<=[.!?…])\s+/);
    const last = parts[parts.length - 1].trim();
    if (parts.length < 2 || !FILLER.some((f) => f.test(last))) break;
    out = parts.slice(0, -1).join(" ").trim();
  }
  return out || text.trim();
}

const busy = new Set<VillagerId>();
/** Chore rounds are self-started, so they don't earn quest progress. */
const choreTasks = new Set<string>();

export function isBusy(v: VillagerId) {
  return busy.has(v);
}

/** A task from the player (in-game or by text). Resolves with the villager's reply. */
export async function startTask(v: VillagerId, text: string, from: TaskSource): Promise<string> {
  // Early outs still answer, so a message never just vanishes.
  // Texts (phone, MoonPad) are answered by text (chat.ts sends the reply); only visits get speech bubbles.
  const texting = from === "phone" || from === "moonpad";
  const early = (reply: string) => {
    if (from === "game") emit({ type: "say", villager: v, text: reply });
    return reply;
  };
  if (!movedIn(v)) {
    const home = BUILDINGS[VILLAGER_HOME[v]].name;
    return early(`${nameOf(v)} hasn't moved in yet: get the ${home} ready first.`);
  }
  // Moved in, but their account isn't connected yet (and no sample data chosen).
  const needs = services.needsConnect(v);
  if (needs) return early(`Connect your ${needs === "google" ? "Google account" : "Canvas"} first (or try me on sample data), and I'm all yours!`);
  if (busy.has(v)) return early(`Still busy with your last request — hang tight!`);

  const taskId = newId("task");
  busy.add(v);
  delegations.set(taskId, new Set());
  if (from === "chore") choreTasks.add(taskId);
  emit({ type: "task_start", taskId, villager: v, text, from });

  try {
    const audience: Audience = from === "chore" ? "chore" : texting ? "text" : "talk";
    const answer = (BRAIN === "mock" ? await mockVillager(v, text, taskId) : await runVillager(v, text, taskId, audience)) || "Done!";
    // Face to face, a long answer becomes a short spoken one; the rest is kept for "tell me more".
    // An email sign-off ("— sent from the Moon") never belongs on a chat reply.
    let reply = trimFiller(answer.replace(/\s*[-—–]+\s*sent from the moon\.?\s*$/i, "").trim() || answer);
    let notes: string | undefined;
    if (audience === "talk" && BRAIN !== "mock" && tooLongToSay(answer)) {
      setVillager(v, { status: "thinking", activity: "finding the words…" });
      reply = trimFiller((await retell(v, text, answer).catch((err) => (console.warn(`[agents] ${v} retell failed:`, err), ""))) || answer);
      if (reply !== answer) notes = answer;
    }
    // A text can end with a private note to remember; it's not part of the reply.
    let facts: string[] = [];
    if (texting) ({ reply, facts } = splitNotes(reply));
    if (!texting) emit({ type: "say", villager: v, text: reply });

    const madeClods = Object.values(world.clods).some((c) => c.taskId === taskId);
    // Real work done for you counts toward the town (a couple of grand upgrades need it).
    if (madeClods && from !== "chore") services.taskDone(v === "stargazer" ? "nova_search" : "real_job");
    if (madeClods) {
      const lantern = { id: newId("lantern"), taskId, villager: v, summary: reply.slice(0, 140), at: Date.now() };
      addLantern(lantern);
      emit({ type: "task_done", taskId, villager: v, summary: reply, lantern });
    }
    if (from === "game") {
      remember(v, text, reply, "visit", notes);
      befriend(v, "visit");
    } else if (texting) {
      remember(v, text, reply, "text");
      if (facts.length) addFacts(v, facts);
      befriend(v, "text");
    }
    return reply;
  } catch (error) {
    console.error(`[agents] ${v} failed:`, error);
    const msg = friendlyError(error);
    setVillager(v, { status: "error", activity: "stuck" });
    emit({ type: "building_error", villager: v, building: VILLAGER_HOME[v], message: msg });
    if (!texting) emit({ type: "say", villager: v, text: msg });
    return msg;
  } finally {
    busy.delete(v);
    delegations.delete(taskId);
    choreTasks.delete(taskId);
    if (world.villagers[v].status !== "error") setVillager(v, { status: "idle", activity: "relaxing" });
  }
}
