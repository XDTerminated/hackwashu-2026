// Villager agents. Each villager is a Claude tool-use loop; every thinking
// summary, tool call, handoff and approval is emitted as a GameEvent so the
// island can replay it. Agents never wait on animations — the client paces itself.

import type Anthropic from "@anthropic-ai/sdk";
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
import { denyPendingFor, waitForApproval } from "./approvals.js";
import * as github from "./connectors/github.js";
import * as spotify from "./connectors/spotify.js";
import { MOCK, mockVillager } from "./mock.js";
import { runLookOnlyGroq, runVillagerGroq } from "./groq.js";
import * as services from "./services.js";
import { addFacts, befriend, memoryNote, remember } from "./memory.js";
import { retell, splitNotes, tooLongToSay } from "./chat.js";
import { audienceNote, personaFor, nameOf, type Audience } from "./villagers.js";
import { addLantern, emit, isGuest, newId, owns, putApproval, putClod, setVillager, world, worldGen } from "./world.js";
import { agentsState } from "./agentwatch.js";

/** Made on first use (the SDK is only loaded when Claude is the brain). */
let client: Anthropic | null = null;
async function claude(): Promise<Anthropic> {
  if (!client) {
    const { default: Sdk } = await import("@anthropic-ai/sdk");
    client ??= new Sdk();
  }
  return client;
}
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
  /** Writes to the player's accounts (drafts, sends, bookings, issues): never on a chore round. */
  writes?: boolean;
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
    writes: true,
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
    writes: true,
    building: "rocket_pad",
    reward: 12,
    def: {
      name: "send_email",
      description: "Send a drafted email. The player must approve first — this call waits until they answer and tells you whether it was sent.",
      input_schema: { type: "object", properties: { draft_id: { type: "string" } }, required: ["draft_id"] },
    },
    label: () => "launching mail to Earth",
    needsApproval: async (i) => {
      const d = (await services.mail.getDraft(str(i.draft_id)))?.data;
      if (!d) throw new Error(`no draft with id ${str(i.draft_id)}`);
      // (the recipient line carries any cc/bcc, so the letter says everyone it goes to)
      return { title: `Send "${d.subject}" to ${d.to}?`, body: `To: ${d.to}\n\n${d.body}` };
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
    writes: true,
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

  // Tinker's Workshop: the player's GitHub, and the branch their Claude Code is on.
  github_my_prs: {
    owner: "mechanic",
    building: "workshop",
    reward: 0,
    quiet: true,
    def: { name: "github_my_prs", description: "The player's open pull requests, and the ones waiting on their review (repo, number, title, draft, last update).", input_schema: { type: "object", properties: {} } },
    label: () => "checking the pull requests",
    run: async () => {
      const r = await github.myPullRequests();
      return { text: JSON.stringify(r), summary: `${plural(r.yours.length, "open PR")}, ${r.waiting_on_your_review.length} awaiting review` };
    },
  },
  github_issues: {
    owner: "mechanic",
    building: "workshop",
    reward: 0,
    quiet: true,
    def: {
      name: "github_issues",
      description: "Open issues in a repo (not pull requests).",
      input_schema: { type: "object", properties: { repo: { type: "string", description: "owner/name, e.g. octocat/hello-world" } }, required: ["repo"] },
    },
    label: () => "reading the issue tracker",
    run: async (i) => {
      const r = await github.repoIssues(str(i.repo));
      return { text: JSON.stringify(r), summary: plural(r.length, "open issue") };
    },
  },
  github_pr_status: {
    owner: "mechanic",
    building: "workshop",
    reward: 0,
    quiet: true,
    def: {
      name: "github_pr_status",
      description: "One pull request: state, draft, mergeable, comments, and its checks (CI): passed, failed, still running.",
      input_schema: { type: "object", properties: { repo: { type: "string", description: "owner/name" }, number: { type: "number" } }, required: ["repo", "number"] },
    },
    label: () => "looking over a pull request",
    run: async (i) => {
      const r = await github.prStatus(str(i.repo), num(i.number, 0));
      return { text: JSON.stringify(r), summary: `#${num(i.number, 0)}: ${r.checks.failed.length ? `${r.checks.failed.length} failing` : r.checks.running.length ? "checks running" : "checks green"}` };
    },
  },
  github_commits: {
    owner: "mechanic",
    building: "workshop",
    reward: 0,
    quiet: true,
    def: {
      name: "github_commits",
      description: "The latest commits in a repo (on a branch, if given).",
      input_schema: { type: "object", properties: { repo: { type: "string", description: "owner/name" }, branch: { type: "string" } }, required: ["repo"] },
    },
    label: () => "reading the commit log",
    run: async (i) => {
      const r = await github.recentCommits(str(i.repo), str(i.branch) || undefined);
      return { text: JSON.stringify(r), summary: plural(r.length, "commit") };
    },
  },
  claude_code_branch: {
    owner: "mechanic",
    building: "workshop",
    reward: 0,
    quiet: true,
    def: {
      name: "claude_code_branch",
      description: "What Ada's Office is working on, on GitHub: the repo and branch of the player's live Claude Code session, its pull request (if any), and how the branch's checks are doing.",
      input_schema: { type: "object", properties: {} },
    },
    label: () => "checking what the Office is working on",
    run: async () => {
      const s = agentsState().sessions.find((x) => x.source === "claude-code") ?? agentsState().sessions[0];
      if (!s) return { text: JSON.stringify({ note: "No Claude Code session is running in the Office right now." }), summary: "the Office is quiet" };
      const repo = await github.findRepo(s.project);
      if (!repo) return { text: JSON.stringify({ project: s.project, branch: s.branch, note: "Couldn't find a GitHub repo of theirs with that project's name. Ask which repo it is." }), summary: "repo not found" };
      const r = await github.branchStatus(repo, s.branch);
      return { text: JSON.stringify({ project: s.project, ...r }), summary: `${repo}@${s.branch}` };
    },
  },
  github_create_issue: {
    owner: "mechanic",
    writes: true,
    building: "workshop",
    reward: 6,
    def: {
      name: "github_create_issue",
      description: "File a new issue in one of the player's repos. It waits for the player's OK first (a letter at their door), so just call it.",
      input_schema: { type: "object", properties: { repo: { type: "string", description: "owner/name" }, title: { type: "string" }, body: { type: "string" } }, required: ["repo", "title", "body"] },
    },
    label: () => "writing up an issue",
    needsApproval: async (i) => ({ title: `File an issue in ${str(i.repo)}?`, body: `${str(i.title)}\n\n${str(i.body)}` }),
    run: async (i) => {
      const r = await github.createIssue(str(i.repo), str(i.title), str(i.body));
      return { text: JSON.stringify(r), summary: `filed #${r.number}` };
    },
  },
  github_comment: {
    owner: "mechanic",
    writes: true,
    building: "workshop",
    reward: 4,
    def: {
      name: "github_comment",
      description: "Comment on an issue or pull request. It waits for the player's OK first (a letter at their door), so just call it.",
      input_schema: { type: "object", properties: { repo: { type: "string", description: "owner/name" }, number: { type: "number" }, body: { type: "string" } }, required: ["repo", "number", "body"] },
    },
    label: () => "leaving a comment",
    needsApproval: async (i) => ({ title: `Comment on ${str(i.repo)}#${num(i.number, 0)}?`, body: str(i.body) }),
    run: async (i) => {
      const r = await github.comment(str(i.repo), num(i.number, 0), str(i.body));
      return { text: JSON.stringify(r), summary: "commented" };
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

const WORKERS: VillagerId[] = ["postmaster", "timekeeper", "scholar", "stargazer", "dj", "mechanic"];
const movedIn = services.isResident;

/** `readOnly` (chore rounds): only tools that look, never ones that draft, send, book or file. */
export function toolsFor(v: VillagerId, readOnly = false): Tool[] {
  if (v === "jade_rabbit") {
    if (!services.rabbitTeamwork()) return [];
    const available = WORKERS.filter(movedIn);
    return [
      {
        name: "delegate",
        description:
          "Hand a self-contained task to a moonfolk and get their report back. " +
          "postmaster = Gmail (read inbox, draft, send with the player's OK). " +
          "timekeeper = Google Calendar (check free time, book events with the player's OK). " +
          "scholar = Canvas (courses, grades, due dates, announcements). " +
          "stargazer = web research. " +
          "dj = Spotify music in the game (play, pause, skip, queue). " +
          "mechanic = GitHub (pull requests, issues, CI checks, the branch Claude Code is on; files issues with the player's OK). Call several at once for independent pieces.",
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
  // (Echo can only play once the player's Spotify is connected; Tinker needs their GitHub)
  if (v === "dj" && !spotify.spotifyStatus().connected) return [];
  if (v === "mechanic" && !github.githubStatus().connected) return [];
  return Object.entries(LEAF_TOOLS)
    .filter(([, t]) => t.owner === v && owns(t.building) && !(readOnly && (t.writes || t.needsApproval)))
    .map(([, t]) => t.def);
}

/** Could this neighbor's work leave a glowing star to pop right now (they live here and have a working tool that makes one)? */
export function makesStars(v: VillagerId): boolean {
  if (v === "jade_rabbit" || !movedIn(v) || services.needsConnect(v)) return false;
  return toolsFor(v).some((t) => "name" in t && (t.name === "web_search" || (LEAF_TOOLS[t.name] && !LEAF_TOOLS[t.name].quiet)));
}

export function missingBuildingsNote(v: VillagerId): string {
  if (v === "jade_rabbit") {
    const quest = `\n\n${services.townNote()} The player's next goal: ${services.nextStep()} (The moonfolk's plots are bought at the Town Hall, set down anywhere, and built with materials. Materials: moonstone from boulders and fallen meteors; stardust from sweeping moondust; moon shards from the wilds; glow ore from meteors and the old glowing craters; ice crystals in the north and scrap metal and helium-3 in the south, once the roads are fixed. Coins from popping the stars moonfolk leave after real work, sweeping, meteors and requests.)`;
    const guide = services.rabbitTeamwork()
      ? ""
      : "\n\nRight now you're just the guide: you can't hand out work until two moonfolk live here. Point the player at their current goal instead.";
    const home = WORKERS.filter(movedIn).map(nameOf);
    const away = WORKERS.filter((w) => !movedIn(w)).map(nameOf);
    return `${guide}${quest}\n\nMoonfolk who live here now: ${home.join(", ") || "none"}.${away.length ? ` Not here yet: ${away.join(", ")}.` : ""}`;
  }
  const missing = [...new Set(Object.values(LEAF_TOOLS).filter((t) => t.owner === v && !owns(t.building)).map((t) => BUILDINGS[t.building].name))];
  return services.accountNote(v) + (missing.length ? `\n\nNot built yet (so you can't do these): ${missing.join(", ")}.` : "");
}

// ------------------------------------------------------------------ loop

/** The save each running task started in; its world-writing effects stop if the live save is swapped (guest, dev mode, reset). */
const taskGen = new Map<string, number>();

/** Still the save this task started in? */
export function taskLive(taskId: string): boolean {
  return taskGen.get(taskId) === worldGen();
}

/** Tasks that took in tool output (mail, web pages, issues...): nothing from them is kept as a memory. */
const untrusted = new Set<string>();
export function sawToolOutput(taskId: string) {
  untrusted.add(taskId);
}

const moved = (id: string): ToolResult => ({ type: "tool_result", tool_use_id: id, is_error: true, content: "The colony changed under you (a different save is loaded). Stop here." });

export async function runLeafTool(v: VillagerId, taskId: string, block: ToolUse): Promise<ToolResult> {
  const tool = LEAF_TOOLS[block.name];
  const input = (block.input ?? {}) as Record<string, unknown>;
  // Only what this villager can use right now (their building's up, their account connected; nothing that writes on a chore round).
  if (!tool || tool.owner !== v || !toolsFor(v, choreTasks.has(taskId)).some((t) => "name" in t && t.name === block.name)) {
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `unknown tool ${block.name}` };
  }
  if (!taskLive(taskId)) return moved(block.id);
  sawToolOutput(taskId);
  if (tool.quiet) {
    setVillager(v, { status: "working", activity: tool.label(input) });
    try {
      return { type: "tool_result", tool_use_id: block.id, content: (await tool.run(input)).text };
    } catch (err) {
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: err instanceof Error ? err.message : String(err) };
    }
  }

  // Anything that needs the player's OK fails closed: no approval letter, no run.
  let gate: { title: string; body: string } | undefined;
  if (tool.needsApproval) {
    try {
      gate = await tool.needsApproval(input);
    } catch (err) {
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `Couldn't ask the player about it: ${err instanceof Error ? err.message : String(err)}. Nothing was done.` };
    }
    if (!gate) return { type: "tool_result", tool_use_id: block.id, is_error: true, content: "Couldn't ask the player about it, so nothing was done." };
    if (!taskLive(taskId)) return moved(block.id);
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
    lastApprovalVia.delete(approval.id);
    if (!taskLive(taskId)) return moved(block.id);
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
    if (!taskLive(taskId)) return { type: "tool_result", tool_use_id: block.id, content: text };
    clod.status = "ready";
    clod.result = summary;
    putClod(clod);
    emit({ type: "tool_end", villager: v, clodId: clod.id, ok: true, result: summary });
    return { type: "tool_result", tool_use_id: block.id, content: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!taskLive(taskId)) return { type: "tool_result", tool_use_id: block.id, is_error: true, content: message };
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

/** Which channel answered each approval — set by the WS / Photon handlers, cleared once read. */
export const lastApprovalVia = new Map<string, "game" | "phone">();

export async function runDelegate(from: VillagerId, taskId: string, block: ToolUse): Promise<ToolResult> {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const to = str(input.villager) as VillagerId;
  const task = str(input.task);
  if (!toolsFor(from).some((t) => "name" in t && t.name === "delegate")) {
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `unknown tool ${block.name}` };
  }
  if (!WORKERS.includes(to) || !movedIn(to)) {
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `${to} hasn't moved in yet` };
  }
  if (!taskLive(taskId)) return moved(block.id);
  // One job at a time per neighbor (the player's own requests, or a second handoff in this same turn).
  if (busy.has(to)) {
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `${nameOf(to)} is busy with something else right now. Don't hand them more this turn.` };
  }
  busy.add(to);
  sawToolOutput(taskId);
  try {
    emit({ type: "handoff", from, to, text: task });
    delegations.get(taskId)?.add(to);
    const report = await runVillager(to, task, taskId, "report");
    if (taskLive(taskId)) emit({ type: "handoff", from: to, to: from, text: report });
    return { type: "tool_result", tool_use_id: block.id, content: report || "(no report)" };
  } catch (err) {
    // (one neighbor failing mustn't sink the others working alongside them)
    console.error(`[agents] ${to} (delegated) failed:`, err);
    denyPendingFor(to);
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `${nameOf(to)} couldn't finish: ${friendlyError(err)}` };
  } finally {
    busy.delete(to);
    if (taskLive(taskId)) setVillager(to, { status: "idle", activity: "relaxing" });
  }
}

/** Emit clods for server-side web searches after the fact — they already ran. */
function surfaceServerTools(v: VillagerId, taskId: string, content: Anthropic.Beta.BetaContentBlock[]) {
  for (const b of content) {
    if (b.type !== "server_tool_use") continue;
    recordSearch(v, taskId, str((b.input as Record<string, unknown>)?.query));
  }
}

/** A web search the Stargazer ran: a clod at the Observatory (the scripted brain uses this too). */
export function recordSearch(v: VillagerId, taskId: string, q: string) {
  sawToolOutput(taskId);
  if (!taskLive(taskId)) return;
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

async function runVillagerClaude(v: VillagerId, taskText: string, taskId: string, audience: Audience): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: taskText }];
  const tools = toolsFor(v, choreTasks.has(taskId));
  const system = personaFor(v) + missingBuildingsNote(v) + memoryNote(v, true) + audienceNote(audience);
  let finalText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // (the save changed under this task: stop, and leave the new one alone)
    if (!taskLive(taskId)) break;
    setVillager(v, { status: "thinking", activity: "thinking…" });

    const response = await (await claude()).beta.messages.create({
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

    if (!taskLive(taskId)) break;
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

    // (each settles on its own, so one failing can't strand the others mid-approval)
    const results = await Promise.all(
      uses.map((u) =>
        (u.name === "delegate" ? runDelegate(v, taskId, u) : runLeafTool(v, taskId, u)).catch(
          (err): ToolResult => ({ type: "tool_result", tool_use_id: u.id, is_error: true, content: err instanceof Error ? err.message : String(err) }),
        ),
      ),
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

// ------------------------------------------------------------------ a friend visiting

/**
 * What a neighbor may do for a friend visiting someone else's island: look things
 * up in the friend's OWN accounts, never send, book, change or play anything.
 */
const LOOK_ONLY = new Set([
  "check_office",
  "list_inbox",
  "read_email",
  "list_events",
  "list_courses",
  "upcoming_assignments",
  "course_announcements",
  "github_my_prs",
  "github_issues",
  "github_pr_status",
  "github_commits",
  "claude_code_branch",
  "now_playing",
]);

/**
 * A friend asked villager `v` something while visiting `host`'s island. This runs on
 * the FRIEND's own island (their accounts, their connections): look-only tools, no
 * buildings needed (that's the point of asking a friend's neighbor), and nothing
 * shows up here. Resolves with what the villager says back.
 */
export async function askLookOnly(v: VillagerId, text: string, host: string, asker: string): Promise<string> {
  const system =
    personaFor(v) +
    audienceNote("talk") +
    `\n\nRIGHT NOW YOU'RE ON ${host.toUpperCase()}'S ISLAND, talking with ${asker}, a friend who's visiting. ${asker} is who you're helping: anything you look up is ${asker}'s own (their inbox, their calendar, their repos), never ${host}'s. You can only look things up for a visitor: never send, draft, book, change, file, queue or play anything. If ${asker} asks for that, say you can only do it for them on their own island.`;
  if (BRAIN === "mock") return `(Visiting mode: I'd look that up in ${asker}'s own accounts, but villagers are on scripted lines right now.)`;
  const tools = Object.entries(LEAF_TOOLS)
    .filter(([name, t]) => t.owner === v && LOOK_ONLY.has(name))
    .map(([, t]) => t.def);
  const run = async (name: string, input: Record<string, unknown>) => {
    const tool = LEAF_TOOLS[name];
    if (!tool || tool.owner !== v || !LOOK_ONLY.has(name)) throw new Error(`can't use ${name} here`);
    return (await tool.run(input)).text;
  };
  const web = v === "stargazer";
  let answer = "";
  if (BRAIN === "groq") answer = await runLookOnlyGroq(v, system, text, tools, web, run);
  else {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: text }];
    const defs: Tool[] = web ? [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }] : tools;
    for (let turn = 0; turn < 6; turn++) {
      const res = await (await claude()).beta.messages.create({
        model: MODEL,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        system,
        ...(defs.length ? { tools: defs } : {}),
        messages,
      });
      const said = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      if (said) answer = said;
      if (res.stop_reason === "refusal") return "Hmm, moondust in my ears - I can't help with that one.";
      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      const uses = res.content.filter((b): b is ToolUse => b.type === "tool_use");
      if (!uses.length || res.stop_reason === "max_tokens") break;
      messages.push({ role: "assistant", content: res.content });
      const results: ToolResult[] = await Promise.all(
        uses.map(async (u) => {
          try {
            return { type: "tool_result" as const, tool_use_id: u.id, content: await run(u.name, (u.input ?? {}) as Record<string, unknown>) };
          } catch (err) {
            return { type: "tool_result" as const, tool_use_id: u.id, is_error: true, content: err instanceof Error ? err.message : String(err) };
          }
        }),
      );
      messages.push({ role: "user", content: results });
    }
  }
  let reply = trimFiller(answer || "Hmm, I came up empty.");
  if (tooLongToSay(reply)) reply = trimFiller((await retell(v, text, reply).catch(() => "")) || reply);
  return reply;
}

// ------------------------------------------------------------------ entry

export function friendlyError(error: unknown): string {
  // An Anthropic or Groq SDK APIError (checked by shape, so neither SDK has to be loaded to tell).
  // Both set status/headers/error; only Anthropic's has requestID.
  if (error instanceof Error && "status" in error && "headers" in error && "error" in error) {
    const status = (error as { status?: number }).status;
    const anthropic = "requestID" in error;
    if (status === 401) {
      return anthropic
        ? "The colony's thinking-cap is missing its key crystal! (No valid ANTHROPIC_API_KEY on the server.)"
        : "The colony's thinking-cap rejected its key crystal (check GROQ_API in .env).";
    }
    if (status === 429) return "Too many moonbeams at once — give me a breath and ask again?";
    return anthropic ? `The line to Earth crackled (API error ${status}). Try again?` : `The line to Earth crackled (Groq error ${status}). Try again?`;
  }
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

export function isChoreTask(taskId: string) {
  return choreTasks.has(taskId);
}

export function isBusy(v: VillagerId) {
  return busy.has(v);
}

/** Every task is a real model run: at most this many start per window (fewer for a guest, who pays nothing). */
const START_WINDOW_MS = 10 * 60_000;
const startLimit = () => (isGuest() ? 8 : 20);
const starts: number[] = [];
function takeStart(): boolean {
  const now = Date.now();
  while (starts.length && now - starts[0] > START_WINDOW_MS) starts.shift();
  if (starts.length >= startLimit()) return false;
  starts.push(now);
  return true;
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
  if (!takeStart()) {
    console.warn(`[agents] task limit reached (${startLimit()} per ${START_WINDOW_MS / 60_000} min); ${v} sat this one out`);
    return early(`Phew, the whole colony's been run off its feet. Give us a few minutes' breather, then ask again?`);
  }

  const taskId = newId("task");
  taskGen.set(taskId, worldGen());
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
    // (the save changed while they worked: nothing from this task goes into the new one)
    if (!taskLive(taskId)) return reply;
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
      // Only from a plain chat: a turn that read mail, pages or issues could be carrying someone else's words.
      if (facts.length && !untrusted.has(taskId)) addFacts(v, facts);
      befriend(v, "text");
    }
    return reply;
  } catch (error) {
    console.error(`[agents] ${v} failed:`, error);
    const msg = friendlyError(error);
    if (!taskLive(taskId)) return msg;
    setVillager(v, { status: "error", activity: "stuck" });
    emit({ type: "building_error", villager: v, building: VILLAGER_HOME[v], message: msg });
    if (!texting) emit({ type: "say", villager: v, text: msg });
    return msg;
  } finally {
    busy.delete(v);
    delegations.delete(taskId);
    choreTasks.delete(taskId);
    untrusted.delete(taskId);
    if (taskLive(taskId) && world.villagers[v]?.status !== "error") setVillager(v, { status: "idle", activity: "relaxing" });
    taskGen.delete(taskId);
  }
}
