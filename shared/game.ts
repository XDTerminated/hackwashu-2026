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
  | "observatory";

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

/** Buildings the quest chain reveals are free — you can never be too broke to progress. */
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  player_house: { id: "player_house", name: "Your House", price: 0, starter: true, unlocks: "where villagers bring letters that need your OK" },
  rabbit_burrow: { id: "rabbit_burrow", name: "Rabbit's Burrow", price: 0, starter: true, resident: "jade_rabbit", unlocks: "Jade Rabbit: your guide, and later the one who coordinates everyone" },
  observatory: { id: "observatory", name: "Observatory", price: 0, starter: true, resident: "stargazer", unlocks: "Stargazer: researches anything on the web" },
  post_office: { id: "post_office", name: "Post Office", price: 0, starter: false, resident: "postmaster", unlocks: "Postmaster: reads your Gmail and drafts replies" },
  mailbox: { id: "mailbox", name: "Mailbox", price: 0, starter: false, unlocks: "read & summarize email (comes with the Post Office)" },
  clock_tower: { id: "clock_tower", name: "Clock Tower", price: 0, starter: false, resident: "timekeeper", unlocks: "Timekeeper: checks and books your Google Calendar" },
  library: { id: "library", name: "Library", price: 0, starter: false, resident: "scholar", unlocks: "Scholar: reads your Canvas courses, assignments and announcements" },
  rocket_pad: { id: "rocket_pad", name: "Rocket Pad", price: 0, starter: false, unlocks: "lets the Postmaster send mail to Earth (with your OK)" },
};

export const VILLAGER_NAMES: Record<VillagerId, string> = {
  jade_rabbit: "Jade Rabbit",
  postmaster: "Postmaster",
  timekeeper: "Timekeeper",
  scholar: "Scholar",
  stargazer: "Stargazer",
};

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

/**
 * The unlock chain: each villager's real work uncovers the next one.
 * A quest counts either finished tasks by a villager, or successful uses of one tool.
 */
export interface QuestDef {
  id: string;
  title: string;
  hint: string;
  villager: VillagerId;
  goal: number;
  counts: { tool?: string; teamTask?: boolean };
  reveals: BuildingId[];
  story: string;
  bonus: number;
}

export const QUESTS: QuestDef[] = [
  {
    id: "stargaze",
    title: "Ask the Stargazer 3 questions",
    hint: "Walk to the Observatory (south) and press E. Ask anything - she searches Earth's web.",
    villager: "stargazer",
    goal: 3,
    counts: {},
    reveals: ["post_office", "mailbox"],
    story: "My telescope caught a glint in the west crater... a crashed MAIL POD! Build a Post Office there and maybe its pilot will stay.",
    bonus: 20,
  },
  {
    id: "inbox",
    title: "Have the Postmaster check your mail",
    hint: "Talk to the Postmaster and ask what's in your inbox.",
    villager: "postmaster",
    goal: 1,
    counts: { tool: "list_inbox" },
    reveals: ["clock_tower", "rocket_pad"],
    story: "Hoo! Invitations, deadlines, meetings... this colony needs someone to keep time. Build a Clock Tower!",
    bonus: 20,
  },
  {
    id: "week",
    title: "Ask the Timekeeper about your week",
    hint: "Talk to the Timekeeper and ask what your week looks like.",
    villager: "timekeeper",
    goal: 1,
    counts: { tool: "list_events" },
    reveals: ["library"],
    story: "Tick... your week is packed with classes. A Library would bring the Scholar - they know Canvas inside out.",
    bonus: 25,
  },
  {
    id: "team",
    title: "Give the Rabbit a job for two neighbors",
    hint: "Now the Rabbit can coordinate. Try: \"Reply to my professor and put it on my calendar.\"",
    villager: "jade_rabbit",
    goal: 1,
    counts: { teamTask: true },
    reveals: [],
    story: "Look at the colony go! Every line home is open. Happy Mid-Autumn, traveler.",
    bonus: 50,
  },
];

export interface Progress {
  /** Index into QUESTS; QUESTS.length means the chain is complete. */
  quest: number;
  count: number;
  revealed: BuildingId[];
  /** Services the player chose to run on sample data for now. */
  sandbox: Partial<Record<Service, boolean>>;
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
  coins: number;
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
  | { type: "building_moved"; building: BuildingId; x: number; y: number }
  | { type: "deco_sold"; id: string; refund: number; coins: number }
  | { type: "phone"; direction: "in" | "out"; text: string }
  /** A text-message chat with a villager (MoonPad or real phone). Chats never do real work. */
  | { type: "text"; villager: VillagerId; direction: "in" | "out"; text: string; via: "moonpad" | "phone" }
  | { type: "friendship"; villager: VillagerId; points: number; hearts: number; levelUp?: boolean }
  /** A villager's happiness changed because of decorations around their home. */
  | { type: "happiness"; villager: VillagerId; score: number; hearts: number; levelUp?: boolean; gained?: { item: string; loved: boolean } }
  | { type: "connections"; connections: Connections }
  | { type: "quest"; progress: Progress; completed?: string; story?: string; bonus?: number; coins: number }
  | { type: "villager_arrived"; villager: VillagerId; residents: VillagerId[]; rabbitTeamwork: boolean }
  | { type: "plot_revealed"; building: BuildingId }
  | { type: "chore_spawned"; chore: Chore }
  | { type: "chore_cleared"; id: string; reward: number; coins: number }
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
  | { type: "place_deco"; item: string; x: number; y: number }
  | { type: "move_deco"; id: string; x: number; y: number }
  | { type: "move_building"; building: BuildingId; x: number; y: number }
  | { type: "sell_deco"; id: string }
  | { type: "toggle_deco"; id: string }
  /** Switch to (or back from) the dev showcase save. */
  | { type: "dev_mode"; on: boolean }
  | { type: "move_lantern"; id: string; x: number; y: number }
  | { type: "connect_canvas"; token: string; baseUrl?: string }
  | { type: "use_sandbox"; service: Service }
  | { type: "clear_chore"; id: string }
  | { type: "phone_link_start"; phone: string }
  | { type: "phone_unlink"; id: string }
  | { type: "set_chore_optin"; villager: VillagerId; enabled: boolean }
  /** Dev/demo-prep only; ignored unless the server runs with DEV_TOOLS=1. */
  | { type: "dev"; action: "complete_quest" | "meteor" | "dust" }
  | { type: "disconnect"; service: "google" | "canvas" };

export type ServerMessage =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "event"; event: SeqEvent }
  | { type: "notice"; text: string }
  /**
   * Linking a phone on Photon's shared pool: the person texts the colony first
   * (iMessage anti-spam), so the game shows a number + code + QR link to send it.
   */
  | { type: "phone_link"; state: "awaiting_text" | "linked" | "error"; text: string; line?: string; code?: string; link?: string };
