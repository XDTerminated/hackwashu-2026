// Contract shared by the agent server and the game client.
// The server is the source of truth; the client renders and animates.

export type VillagerId = "jade_rabbit" | "postmaster" | "timekeeper" | "scholar" | "stargazer";

export type BuildingId =
  | "player_house"
  | "rabbit_burrow"
  | "post_office"
  | "mailbox"
  | "clock_tower"
  | "rocket_pad"
  | "library"
  | "observatory"
  | "office";

export interface BuildingDef {
  id: BuildingId;
  name: string;
  price: number;
  starter: boolean;
  /** Villager who lives here (building one moves them in). */
  resident?: VillagerId;
  /** What owning it lets agents do — shown in the build menu. */
  unlocks: string;
}

/** Houses cost coins (from your neighbors' work and keeping the colony tidy); the rest are gifts. */
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  player_house: { id: "player_house", name: "Your House", price: 0, starter: true, unlocks: "where villagers bring letters that need your OK" },
  rabbit_burrow: { id: "rabbit_burrow", name: "Rabbit's Burrow", price: 0, starter: true, resident: "jade_rabbit", unlocks: "Yutu the Jade Rabbit: your guide, and later the one who coordinates everyone" },
  observatory: { id: "observatory", name: "Observatory", price: 0, starter: true, resident: "stargazer", unlocks: "Nova the Stargazer: researches anything on the web" },
  post_office: { id: "post_office", name: "Post Office", price: 30, starter: false, resident: "postmaster", unlocks: "Hoot the Postmaster: reads your Gmail and drafts replies" },
  mailbox: { id: "mailbox", name: "Mailbox", price: 0, starter: false, unlocks: "read & summarize email (comes with the Post Office)" },
  clock_tower: { id: "clock_tower", name: "Clock Tower", price: 60, starter: false, resident: "timekeeper", unlocks: "Cog the Timekeeper: checks and books your Google Calendar" },
  library: { id: "library", name: "Library", price: 90, starter: false, resident: "scholar", unlocks: "Mabel the Scholar: reads your Canvas courses, assignments and announcements" },
  rocket_pad: { id: "rocket_pad", name: "Mail Rocket", price: 0, starter: false, unlocks: "an upgrade to Hoot's Post Office: he can send your emails to Earth (with your OK)" },
  office: { id: "office", name: "Office", price: 120, starter: false, unlocks: "for developers: watch your coding agents (Claude Code) work, each sub-agent at its own desk" },
};

// ---------------------------------------------------------------- the office
// A live view of your coding agents. The server reads Claude Code's session
// logs (and events other tools POST to /agents/event): the main session is the
// team lead, and every sub-agent it spins up is a worker at a desk. Watching
// only: nothing here steers the agents.

export type AgentStatus = "thinking" | "working" | "waiting" | "done" | "failed";

export interface AgentFeedItem {
  at: number;
  /** think = its reasoning, say = what it wrote, tool = a tool call, result = what came back, prompt = its instructions / your message */
  kind: "think" | "say" | "tool" | "result" | "error" | "prompt";
  text: string;
}

export interface AgentInfo {
  id: string;
  /** A sub-agent's task description ("Audit server bugs"); "Claude" for the lead. */
  name: string;
  /** Its agent type (general-purpose, Explore, ...), or "main" for the lead. */
  kind: string;
  /** 1 = sent out by the lead, 2 = by one of its helpers, ... */
  depth: number;
  parent: string | null;
  status: AgentStatus;
  /** What it's doing right now, in a few words. */
  now: string;
  model: string;
  startedAt: number;
  lastAt: number;
  doneAt?: number;
  /** Tool calls so far. */
  tools: number;
  /** Output tokens so far. */
  tokens: number;
  /** Its instructions (sub-agents). */
  task: string;
  /** Its last message: the answer, when it's done. */
  result: string;
  /** Recent thinking, messages, tool calls and results (oldest first). */
  feed: AgentFeedItem[];
}

export interface AgentSession {
  id: string;
  source: "claude-code" | "api" | "replay";
  title: string;
  /** The project folder's name. */
  project: string;
  branch: string;
  lead: AgentInfo;
  workers: AgentInfo[];
  live: boolean;
  lastAt: number;
  /** A replay of a past session: how sped up, and how far along (0..1). */
  replay?: { speed: number; progress: number };
}

/** The hosted game: your Claude Code, on your own computer, linked to your Office. */
export interface AgentLink {
  status: "off" | "waiting" | "linked" | "lost";
  /** While waiting: the one-time code, and the command that uses it. */
  code?: string;
  command?: string;
  expiresAt?: number;
  /** Once linked: the computer's name. */
  host?: string;
  at?: number;
}

export interface AgentsState {
  /** The Claude Code sessions folder being watched ("~/.claude/projects"), or null if there isn't one. */
  watching: string | null;
  /** Hosted: linking your own Claude Code (null when the game runs on your computer and just watches). */
  link: AgentLink | null;
  /** Live sessions, most relevant first. */
  sessions: AgentSession[];
}

// ---------------------------------------------------------------- colony requests
// Three small goals a day from the villagers, for coins: something to do
// every time you open the game.

export type RequestKind = "sweep" | "meteor" | "pop" | "rock" | "decorate" | "shard" | "text" | "visit" | "wish" | "place";

export interface ColonyRequest {
  id: string;
  kind: RequestKind;
  villager: VillagerId;
  text: string;
  goal: number;
  count: number;
  reward: number;
  done: boolean;
  /** A wish: the decoration (id) the villager wants in their yard. */
  item?: string;
}

/** Each villager's own name... */
export const VILLAGER_SHORT: Record<VillagerId, string> = {
  jade_rabbit: "Yutu",
  postmaster: "Hoot",
  timekeeper: "Cog",
  scholar: "Mabel",
  stargazer: "Nova",
};

/** ...their job in the colony... */
export const VILLAGER_ROLE: Record<VillagerId, string> = {
  jade_rabbit: "Jade Rabbit",
  postmaster: "Postmaster",
  timekeeper: "Timekeeper",
  scholar: "Scholar",
  stargazer: "Stargazer",
};

/** ...and how they're shown: "Nova the Stargazer". */
export const VILLAGER_NAMES = Object.fromEntries(
  (Object.keys(VILLAGER_SHORT) as VillagerId[]).map((v) => [v, `${VILLAGER_SHORT[v]} the ${VILLAGER_ROLE[v]}`]),
) as Record<VillagerId, string>;

export const VILLAGER_HOME: Record<VillagerId, BuildingId> = {
  jade_rabbit: "rabbit_burrow",
  postmaster: "post_office",
  timekeeper: "clock_tower",
  scholar: "library",
  stargazer: "observatory",
};

/** Which real account each villager needs before they'll move in. */
export type Service = "google" | "canvas" | "web";
export const VILLAGER_SERVICE: Record<VillagerId, Service | null> = {
  jade_rabbit: null,
  stargazer: "web",
  postmaster: "google",
  timekeeper: "google",
  scholar: "canvas",
};
export const SERVICE_NAMES: Record<Service, string> = { google: "Gmail + Google Calendar", canvas: "Canvas", web: "the web" };

// ---------------------------------------------------------------- moving in
// Animal Crossing style: each neighbor still on Earth has a lot on the Moon,
// and it's a ruin. Clear the rubble, repair the foundation with materials you
// collect around the island, build the house with coins, and put something
// they love in the yard: then they move in. Connecting your real account
// comes after, when you want them to work with your real stuff.

export type Material = "moonstone" | "stardust" | "shard";
export type Materials = Record<Material, number>;
export const MATERIALS: Material[] = ["moonstone", "stardust", "shard"];
export const MATERIAL_NAME: Record<Material, string> = { moonstone: "moonstone", stardust: "stardust", shard: "moon shard" };
/** Where each one comes from (shown when you're short). */
export const MATERIAL_SOURCE: Record<Material, string> = {
  moonstone: "clear boulders and rubble, or grab fallen meteor rocks",
  stardust: "sweep moondust drifts",
  shard: "find Moon Shards glinting in the wilds",
};

export interface MoveInDef {
  villager: VillagerId;
  home: BuildingId;
  /** Rubble piles on the lot to clear first. */
  rubble: number;
  /** What rebuilding the old foundation takes. */
  repair: Partial<Materials>;
  /** Different things they love, in their yard. */
  loves: number;
  /** Said when their lot opens up (by whoever lives here already). */
  teaser: { by: VillagerId; text: string };
  /** Said when they move in. */
  hello: string;
  /** Coins they bring as a housewarming thank-you. */
  gift: number;
}

export const MOVE_INS: MoveInDef[] = [
  {
    villager: "postmaster",
    home: "post_office",
    rubble: 3,
    repair: { moonstone: 3, stardust: 2 },
    loves: 1,
    teaser: { by: "stargazer", text: "My telescope caught a signal: an owl postmaster on Earth wants to move up! The old post office lot is a wreck, though (follow the gold ★). Clear it, fix the foundation, build, and make it cozy." },
    hello: "Hoo! What a lovely little post office. I'm moving in! Connect your Google when you'd like me to read your mail.",
    gift: 20,
  },
  {
    villager: "timekeeper",
    home: "clock_tower",
    rubble: 3,
    repair: { moonstone: 4, stardust: 3, shard: 1 },
    loves: 2,
    teaser: { by: "postmaster", text: "Hoo! Invitations, deadlines, meetings... this colony needs someone to keep time. My friend Cog, a clockwork fellow on Earth, would come if the old clock tower lot were fixed up." },
    hello: "Tick... tock! A tower of my own. I'm home. Connect your Google Calendar and I'll keep your week in order.",
    gift: 25,
  },
  {
    villager: "scholar",
    home: "library",
    rubble: 4,
    repair: { moonstone: 5, stardust: 3, shard: 2 },
    loves: 2,
    teaser: { by: "timekeeper", text: "Tick... your week is packed with classes. Mabel the Scholar knows Canvas inside out, and the old library lot is waiting for her. It needs work, mind you." },
    hello: "Books! Shelves! A reading nook! I'm staying. Connect your Canvas and I'll tell you what's due.",
    gift: 30,
  },
];

export const moveInFor = (v: VillagerId) => MOVE_INS.find((m) => m.villager === v);
export const moveInAt = (b: BuildingId) => MOVE_INS.find((m) => m.home === b);

/** A lot's progress: which rubble piles are gone, and whether the foundation is fixed. */
export interface LotState {
  cleared: number[];
  repaired: boolean;
}

export interface Progress {
  revealed: BuildingId[];
  /** Services the player chose to run on sample data for now. */
  sandbox: Partial<Record<Service, boolean>>;
  /** Neighbors who've moved in (besides Yutu and Nova, who were here first). */
  movedIn: VillagerId[];
  lots: Partial<Record<BuildingId, LotState>>;
}

/** The lot being worked on now (the first neighbor not home yet), or null once everyone's home. */
export function currentMoveIn(p: Progress): MoveInDef | null {
  return MOVE_INS.find((m) => !p.movedIn.includes(m.villager)) ?? null;
}

/** A phone linked to the colony over iMessage (co-op: any number of them). Numbers are masked for display. */
export interface LinkedPhone {
  id: string;
  masked: string;
  /** The colony's number as this person sees it (Photon shared pool assigns one per person). */
  line?: string;
}

/** Real accounts the colony is wired to. When one isn't connected, its villager uses labeled sandbox data. */
export interface Connections {
  google: { connected: boolean; account?: string; configured: boolean };
  canvas: { connected: boolean; account?: string; baseUrl?: string };
  photon: { connected: boolean; phoneLinked: boolean; phones: LinkedPhone[] };
  web: { connected: boolean };
}

export type VillagerStatus = "idle" | "thinking" | "working" | "waiting" | "error";

export type ClodStatus = "working" | "ready" | "stuck" | "failed" | "popped";

export interface Clod {
  id: string;
  taskId: string;
  villager: VillagerId;
  building: BuildingId;
  label: string;
  status: ClodStatus;
  result?: string;
  reward: number;
  approvalId?: string;
}

export interface Approval {
  id: string;
  villager: VillagerId;
  clodId: string;
  title: string;
  body: string;
  status: "pending" | "approved" | "denied";
}

export interface Lantern {
  id: string;
  taskId: string;
  villager: VillagerId;
  summary: string;
  at: number;
  /** Where the player moved it; otherwise it stands on the ring around the plaza. */
  x?: number;
  y?: number;
}

export interface Deco {
  id: string;
  item: string;
  /** Lights only: switched off by the player (on by default). */
  off?: boolean;
  x: number;
  y: number;
}

/** Island chores the player does for coins: sweep moondust, grab fallen moon-rocks. */
export interface Chore {
  id: string;
  kind: "dust" | "meteor";
  x: number;
  y: number;
  reward: number;
  /** Meteors: when it hits the ground (a shadow warns before that). */
  landsAt?: number;
  /** Meteors: when the rock has cooled and crumbles. */
  expires?: number;
}

/** Villagers can do small real chores on their own (opt-in; each round is real API calls). */
export const CHORE_EVERY_MIN = 15;

export interface VillagerState {
  status: VillagerStatus;
  activity: string;
  thought?: string;
}

export interface Snapshot {
  /** The hosted game (each player signed in to their own copy): who's playing. */
  account?: { email: string; name: string } | null;
  coins: number;
  materials: Materials;
  buildings: Partial<Record<BuildingId, boolean>>;
  villagers: Record<VillagerId, VillagerState>;
  clods: Clod[];
  approvals: Approval[];
  lanterns: Lantern[];
  decos: Deco[];
  lastSeq: number;
  phoneLinked: boolean;
  connections: Connections;
  progress: Progress;
  /** Villagers who have actually moved in. */
  residents: VillagerId[];
  /** The Rabbit coordinates once two agent neighbors live here. */
  rabbitTeamwork: boolean;
  chores: Chore[];
  choreOptIn: Partial<Record<VillagerId, boolean>>;
  /** Friendship points per villager, earned by texting and visiting. */
  friendship: Partial<Record<VillagerId, number>>;
  /** Buildings the player has moved off their starting spot. */
  layout: Partial<Record<BuildingId, { x: number; y: number }>>;
  /** Playing on the dev showcase save (everything unlocked) instead of the real one. */
  devMode: boolean;
  /** Rocks the player has paid to clear ("x,y"). */
  clearedRocks: string[];
  /** Moon shards picked up ("x,y"). */
  shards: string[];
  /** Today's colony requests. */
  requests: ColonyRequest[];
}

/** Friendship points needed for each heart (5 hearts = best friends). */
export const HEART_AT = [3, 8, 15, 25, 40] as const;
export const MAX_HEARTS = HEART_AT.length;
export function heartsFor(points: number): number {
  return HEART_AT.filter((p) => points >= p).length;
}

/** Where a task came from: in person, the in-game MoonPad, your real phone, or a villager's own chore round. */
export type TaskSource = "game" | "moonpad" | "phone" | "chore";

/** Everything an agent does becomes one of these. The client replays them at a watchable pace. */
export type GameEvent =
  | { type: "task_start"; taskId: string; villager: VillagerId; text: string; from: TaskSource }
  | { type: "think"; villager: VillagerId; text: string }
  | { type: "say"; villager: VillagerId; text: string }
  | { type: "handoff"; from: VillagerId; to: VillagerId; text: string }
  | { type: "tool_start"; villager: VillagerId; clod: Clod }
  | { type: "tool_end"; villager: VillagerId; clodId: string; ok: boolean; result: string }
  | { type: "approval_needed"; villager: VillagerId; approval: Approval }
  | { type: "approval_resolved"; villager: VillagerId; approvalId: string; clodId: string; approved: boolean; via: "game" | "phone" }
  | { type: "building_error"; villager: VillagerId; building: BuildingId; message: string }
  | { type: "task_done"; taskId: string; villager: VillagerId; summary: string; lantern: Lantern }
  | { type: "clod_popped"; clodId: string; reward: number; coins: number }
  | { type: "building_built"; building: BuildingId; coins: number }
  | { type: "deco_placed"; deco: Deco; coins: number }
  | { type: "deco_moved"; id: string; x: number; y: number }
  | { type: "deco_toggled"; id: string; off: boolean }
  | { type: "lantern_moved"; id: string; x: number; y: number }
  | { type: "rock_cleared"; x: number; y: number; stone: number; coins: number; loot?: { coins: number; what: string } }
  | { type: "shard_found"; x: number; y: number; found: number; total: number; reward: number; coins: number; bonus?: number }
  /** The day's colony requests changed (progress, or one was just completed). */
  | { type: "requests"; requests: ColonyRequest[]; completed?: ColonyRequest; coins: number }
  | { type: "building_moved"; building: BuildingId; x: number; y: number }
  | { type: "deco_sold"; id: string; refund: number; coins: number }
  | { type: "phone"; direction: "in" | "out"; text: string }
  /** A text-message chat with a villager (MoonPad or real phone). Chats never do real work. */
  | { type: "text"; villager: VillagerId; direction: "in" | "out"; text: string; via: "moonpad" | "phone" }
  | { type: "friendship"; villager: VillagerId; points: number; hearts: number; levelUp?: boolean }
  /** A villager's happiness changed because of decorations around their home. */
  | { type: "happiness"; villager: VillagerId; score: number; hearts: number; levelUp?: boolean; gained?: { item: string; loved: boolean } }
  | { type: "connections"; connections: Connections }
  /** Which services the player chose to run on sample data. */
  | { type: "sandbox"; sandbox: Partial<Record<Service, boolean>> }
  /** Moving-in progress changed (rubble cleared, a repair, materials picked up). `gained` floats up at `at`. */
  | { type: "progress"; progress: Progress; materials: Materials; coins: number; gained?: Partial<Materials>; at?: { x: number; y: number } }
  | { type: "villager_arrived"; villager: VillagerId; residents: VillagerId[]; rabbitTeamwork: boolean; hello?: string; gift?: number; next?: VillagerId | null }
  | { type: "plot_revealed"; building: BuildingId }
  | { type: "rubble_cleared"; building: BuildingId; index: number }
  | { type: "chore_spawned"; chore: Chore }
  | { type: "chore_cleared"; id: string; kind: "dust" | "meteor"; reward: number; coins: number }
  | { type: "chore_gone"; id: string }
  | { type: "chore_optin"; optIn: Partial<Record<VillagerId, boolean>> };

export type SeqEvent = GameEvent & { seq: number; at: number };

export type ClientMessage =
  | { type: "hello" }
  | { type: "landed" }
  | { type: "task"; villager: VillagerId; text: string; via?: "moonpad" }
  | { type: "approve"; approvalId: string; approved: boolean }
  | { type: "pop"; clodId: string }
  | { type: "build"; building: BuildingId }
  | { type: "clear_rubble"; building: BuildingId; index: number }
  | { type: "repair_lot"; building: BuildingId }
  | { type: "place_deco"; item: string; x: number; y: number }
  | { type: "move_deco"; id: string; x: number; y: number }
  | { type: "move_building"; building: BuildingId; x: number; y: number }
  | { type: "sell_deco"; id: string }
  | { type: "toggle_deco"; id: string }
  /** Switch to (or back from) the dev showcase save. */
  | { type: "dev_mode"; on: boolean }
  | { type: "move_lantern"; id: string; x: number; y: number }
  | { type: "clear_rock"; x: number; y: number }
  | { type: "collect_shard"; x: number; y: number }
  | { type: "canvas_login"; domain?: string }
  | { type: "canvas_schools"; query: string }
  | { type: "test_connections" }
  | { type: "agents_replay"; on: boolean }
  /** Hosted: a fresh one-time code for linking your Claude Code (or unlink it). */
  | { type: "office_link"; on: boolean }
  | { type: "connect_canvas"; token: string; baseUrl?: string }
  | { type: "use_sandbox"; service: Service }
  | { type: "clear_chore"; id: string }
  | { type: "phone_link_start"; phone: string }
  | { type: "phone_unlink"; id: string }
  | { type: "set_chore_optin"; villager: VillagerId; enabled: boolean }
  /** Dev/demo-prep only; ignored unless the server runs with DEV_TOOLS=1. */
  | { type: "dev"; action: "move_in" | "materials" | "meteor" | "dust" }
  | { type: "disconnect"; service: "google" | "canvas" };

export type ServerMessage =
  | { type: "connection_test"; results: { name: string; ok: boolean | null; detail: string }[] }
  | { type: "canvas_schools"; query: string; schools: { name: string; domain: string }[]; error?: string }
  | { type: "snapshot"; snapshot: Snapshot }
  /** Your coding agents changed (only sent to the game on this computer). */
  | { type: "agents"; state: AgentsState }
  | { type: "event"; event: SeqEvent }
  | { type: "notice"; text: string; tone?: "ok" }
  /**
   * Linking a phone on Photon's shared pool: the person texts the colony first
   * (iMessage anti-spam), so the game shows a number + code + QR link to send it.
   */
  | { type: "phone_link"; state: "awaiting_text" | "linked" | "error"; text: string; line?: string; code?: string; link?: string };
