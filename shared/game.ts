// Contract shared by the agent server and the game client.
// The server is the source of truth; the client renders and animates.

import type { LandmarkId, Stage, Town, TownItem } from "./town.js";

export type VillagerId = "jade_rabbit" | "postmaster" | "timekeeper" | "scholar" | "stargazer" | "manager" | "dj" | "mechanic";

/** Ada the Team Lead lives and works in the Office, not out on the island. */
export const IN_OFFICE = (v: VillagerId) => v === "manager";

export type BuildingId =
  | "player_house"
  | "rabbit_burrow"
  | "post_office"
  | "mailbox"
  | "clock_tower"
  | "rocket_pad"
  | "library"
  | "observatory"
  | "office"
  | "town_hall"
  | "market"
  | "radio_tower"
  | "workshop";

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
  observatory: { id: "observatory", name: "Observatory", price: 0, starter: false, resident: "stargazer", unlocks: "Nova the Stargazer: researches anything on the web" },
  post_office: { id: "post_office", name: "Post Office", price: 30, starter: false, resident: "postmaster", unlocks: "Hoot the Postmaster: reads your Gmail and drafts replies" },
  mailbox: { id: "mailbox", name: "Mailbox", price: 0, starter: false, unlocks: "read & summarize email (comes with the Post Office)" },
  clock_tower: { id: "clock_tower", name: "Clock Tower", price: 60, starter: false, resident: "timekeeper", unlocks: "Cog the Timekeeper: checks and books your Google Calendar" },
  library: { id: "library", name: "Library", price: 90, starter: false, resident: "scholar", unlocks: "Mabel the Scholar: reads your Canvas courses, assignments and announcements" },
  rocket_pad: { id: "rocket_pad", name: "Mail Rocket", price: 0, starter: false, unlocks: "an upgrade to Hoot's Post Office: he can send your emails to Earth (with your OK)" },
  town_hall: { id: "town_hall", name: "Town Hall", price: 0, starter: true, unlocks: "Yutu's office as mayor: upgrade it to make room for more neighbors" },
  market: { id: "market", name: "Market", price: 0, starter: true, unlocks: "decorations: upgrade it for more stock" },
  office: { id: "office", name: "Office", price: 0, starter: false, unlocks: "for developers: watch your coding agents (Claude Code) work, each sub-agent at its own desk, with Ada the Team Lead keeping track" },
  radio_tower: { id: "radio_tower", name: "Radio Tower", price: 0, starter: false, resident: "dj", unlocks: "Echo the DJ: plays your Spotify right here in the game" },
  workshop: { id: "workshop", name: "Workshop", price: 0, starter: false, resident: "mechanic", unlocks: "an extension of Ada's Office: Tinker the Mechanic moves in and keeps an eye on your GitHub (pull requests, issues, checks)" },
};

/**
 * Extensions, built onto a neighbor's home once they live there: the Mail
 * Rocket on Hoot's Post Office (he can send your emails), and the Workshop on
 * Ada's Office (Tinker moves in, for your GitHub). What building one takes.
 */
export const EXTENSIONS: Partial<Record<BuildingId, { of: BuildingId; by: VillagerId; needs: Partial<Materials> }>> = {
  rocket_pad: { of: "post_office", by: "postmaster", needs: { moonstone: 3, stardust: 2, ore: 1 } },
  workshop: { of: "office", by: "manager", needs: { moonstone: 4, stardust: 2, ore: 2 } },
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
  manager: "Ada",
  dj: "Echo",
  mechanic: "Tinker",
};

/** ...their job in the colony... */
export const VILLAGER_ROLE: Record<VillagerId, string> = {
  jade_rabbit: "Jade Rabbit",
  postmaster: "Postmaster",
  timekeeper: "Timekeeper",
  scholar: "Scholar",
  stargazer: "Stargazer",
  manager: "Team Lead",
  dj: "DJ",
  mechanic: "Mechanic",
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
  manager: "office",
  dj: "radio_tower",
  mechanic: "workshop",
};

/** Which real account each villager needs before they'll move in. */
export type Service = "google" | "canvas" | "web" | "spotify" | "github";
export const VILLAGER_SERVICE: Record<VillagerId, Service | null> = {
  jade_rabbit: null,
  stargazer: "web",
  postmaster: "google",
  timekeeper: "google",
  scholar: "canvas",
  manager: null,
  dj: "spotify",
  mechanic: "github",
};
export const SERVICE_NAMES: Record<Service, string> = { google: "Gmail + Google Calendar", canvas: "Canvas", web: "the web", spotify: "Spotify", github: "GitHub" };

// ---------------------------------------------------------------- moving in
// Every neighbor still on Earth needs a home on the Moon: buy their plot (a
// deed) at the Town Hall, as many as it has room for; set it down wherever you
// like; then build their house with materials you collect, and they move right
// in. Later, upgrade it to a grand house for a perk. Connecting your real
// account comes after, when you want them to work with your real stuff.

export type Material = "moonstone" | "stardust" | "shard" | "ore" | "ice" | "scrap" | "helium";
export type Materials = Record<Material, number>;
export const MATERIALS: Material[] = ["moonstone", "stardust", "shard", "ore", "ice", "scrap", "helium"];
export const noMaterials = (): Materials => ({ moonstone: 0, stardust: 0, shard: 0, ore: 0, ice: 0, scrap: 0, helium: 0 });
export const MATERIAL_NAME: Record<Material, string> = { moonstone: "moonstone", stardust: "stardust", shard: "moon shard", ore: "glow ore", ice: "ice crystal", scrap: "scrap metal", helium: "helium-3" };
/** Where each one comes from (shown when you're short). */
export const MATERIAL_SOURCE: Record<Material, string> = {
  moonstone: "clear boulders and rubble, or grab fallen meteor rocks",
  stardust: "sweep moondust drifts",
  shard: "find Moon Shards glinting in the wilds",
  ore: "grab fallen meteors, or dig it out of the old glowing craters",
  ice: "chip it from the crystals in the shadowed north (fix the roads first)",
  scrap: "salvage it from the old wrecks in the south (the grand roads open it)",
  helium: "scoop the shimmering dust in the south (the grand roads open it)",
};

export interface MoveInDef {
  villager: VillagerId;
  home: BuildingId;
  /** What they help with for real (shown on their plot): "Gmail", "Spotify"... */
  app: string;
  /** What their plot (the deed) costs at the Town Hall. */
  price: number;
  /** What building their house takes, then what making it grand takes. */
  build: [Partial<Materials>, Partial<Materials>];
  /** What the grand house gives you. */
  perk: string;
  /** Different things they love, in their yard. */
  loves: number;
  /** Said when their plot goes up for sale (by whoever lives here already). */
  teaser: { by: VillagerId; text: string };
  /** Said when they move in. */
  hello: string;
  /** Coins they bring as a housewarming thank-you. */
  gift: number;
}

/** A grand house pays out more for its neighbor's work. */
export const GRAND_BONUS = 1.5;

export const MOVE_INS: MoveInDef[] = [
  {
    villager: "stargazer",
    home: "observatory",
    app: "web search",
    price: 30,
    build: [{ moonstone: 3, stardust: 2 }, { moonstone: 4, shard: 1, ice: 1 }],
    perk: "a bigger telescope: you and Nova become friends faster, and her research pays 50% more",
    loves: 0,
    teaser: { by: "jade_rabbit", text: "Nova the Stargazer wants to come up from Earth! Buy her plot at the Town Hall, pick a spot, and build her an Observatory." },
    hello: "Oh, what a view of Earth's web! I'm Nova. Ask me anything and I'll look it up for you.",
    gift: 20,
  },
  {
    villager: "postmaster",
    home: "post_office",
    app: "Gmail",
    price: 30,
    build: [{ moonstone: 3, stardust: 2 }, { moonstone: 4, scrap: 1, ore: 1 }],
    perk: "a grand sorting hall: you and Hoot become friends faster, and his mail work pays 50% more",
    loves: 0,
    teaser: { by: "stargazer", text: "My telescope caught a signal: an owl postmaster on Earth wants to move up! His plot's for sale at the Town Hall." },
    hello: "Hoo! What a lovely little post office. I'm moving in! Connect your Google when you'd like me to read your mail.",
    gift: 20,
  },
  {
    villager: "dj",
    home: "radio_tower",
    app: "Spotify",
    price: 30,
    build: [{ moonstone: 3, stardust: 2, ore: 1 }, { moonstone: 4, helium: 1, ore: 1 }],
    perk: "a bigger antenna and a light show: you and Echo become friends faster",
    loves: 0,
    teaser: { by: "jade_rabbit", text: "A little robot DJ called Echo keeps sending us mixtapes from Earth. Buy their plot at the Town Hall and they'll bring the music!" },
    hello: "Bzzt! Levels checked, antenna up. I'm Echo! Connect your Spotify and tell me what to play.",
    gift: 20,
  },
  {
    villager: "timekeeper",
    home: "clock_tower",
    app: "Google Calendar",
    price: 40,
    build: [{ moonstone: 3, stardust: 2, ore: 1 }, { moonstone: 4, ore: 2, ice: 1 }],
    perk: "a grand clock face: you and Cog become friends faster, and his scheduling pays 50% more",
    loves: 0,
    teaser: { by: "postmaster", text: "Hoo! Invitations, deadlines, meetings... this colony needs someone to keep time. My friend Cog would come up if you bought him a plot." },
    hello: "Tick... tock! A tower of my own. I'm home. Connect your Google Calendar and I'll keep your week in order.",
    gift: 25,
  },
  {
    villager: "scholar",
    home: "library",
    app: "Canvas",
    price: 40,
    build: [{ moonstone: 3, stardust: 2, shard: 1 }, { moonstone: 4, shard: 2, scrap: 1 }],
    perk: "a reading room: you and Mabel become friends faster, and her coursework help pays 50% more",
    loves: 0,
    teaser: { by: "timekeeper", text: "Tick... your week is packed with classes. Mabel the Scholar knows Canvas inside out, and she'd love a library of her own." },
    hello: "Books! Shelves! A reading nook! I'm staying. Connect your Canvas and I'll tell you what's due.",
    gift: 30,
  },
  {
    villager: "manager",
    home: "office",
    app: "Claude Code",
    price: 60,
    build: [{ moonstone: 4, stardust: 3, ore: 1 }, { moonstone: 5, scrap: 2, ore: 2 }],
    perk: "a corner office: you and Ada become friends faster",
    loves: 0,
    teaser: { by: "jade_rabbit", text: "Ada, a team lead down on Earth, wants an Office up here to keep an eye on your coding agents. Her plot's for sale at the Town Hall." },
    hello: "Ada, Team Lead. The Office is open: step inside to watch your coding agents work.",
    gift: 20,
  },
];

export const moveInFor = (v: VillagerId) => MOVE_INS.find((m) => m.villager === v);
export const moveInAt = (b: BuildingId) => MOVE_INS.find((m) => m.home === b);

/** A neighbor's plot once you've bought it: set down yet? and 0 empty, 1 their house, 2 a grand house. */
export interface PlotState {
  placed: boolean;
  stage: 0 | 1 | 2;
}

export interface Progress {
  /** The town's landmarks, story items and the rest (see town.ts). */
  town: Town;
  revealed: BuildingId[];
  /** Services the player chose to run on sample data for now. */
  sandbox: Partial<Record<Service, boolean>>;
  /** Neighbors who've moved in (Yutu was here first; Nova's the tutorial). */
  movedIn: VillagerId[];
  /** Neighbors' plots you've bought. */
  plots: Partial<Record<BuildingId, PlotState>>;
}

/** Is this building (or its plot) on the map? A neighbor's home only once its plot is set down. */
export function onMap(b: BuildingId, p: Progress, built: Partial<Record<BuildingId, boolean>>): boolean {
  if (moveInAt(b)) return !!p.plots[b]?.placed;
  if (b === "mailbox") return !!built.mailbox;
  return !!built[b] || p.revealed.includes(b);
}

/** Neighbors with a plot (bought, placed or built) so far: each takes up a level's room at the Town Hall. */
export const plotsTaken = (p: Progress) => MOVE_INS.filter((m) => p.plots[m.home]).length;

/** A phone linked to the colony over iMessage (co-op: any number of them). Numbers are masked for display. */
export interface LinkedPhone {
  id: string;
  masked: string;
  /** The colony's number as this person sees it (Photon shared pool assigns one per person). */
  line?: string;
}

/** Real accounts the colony is wired to. When one isn't connected, its villager uses labeled sandbox data. */
export interface Connections {
  /** Who signed in on the title screen (name and email only), on your own computer. */
  me?: { name: string; email: string };
  google: { connected: boolean; account?: string; configured: boolean };
  /** Spotify: plays inside the game tab (Spotify only allows that for Premium accounts). */
  spotify: { connected: boolean; account?: string; configured: boolean; premium?: boolean };
  /** GitHub (for Tinker): a token you paste, or the GitHub CLI's login on this computer (`cli`: it's there to use). */
  github: { connected: boolean; account?: string; cli?: boolean };
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
  /** This player has seen the intro (it plays once, the first time they play). */
  introSeen: boolean;
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
  /** A cleared rock has slowly grown back. */
  | { type: "rock_grown"; x: number; y: number }
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
  /** A neighbor's plot: bought (set it down next), placed, or built up a stage. */
  | { type: "plot"; building: BuildingId; plot: PlotState }
  /** What Echo just put on (or paused), for the game's Spotify player to show. */
  | { type: "music"; action: "playing" | "paused"; track?: string; artist?: string }
  | { type: "landmark_upgraded"; landmark: LandmarkId; stage: Stage }
  | { type: "item_found"; item: TownItem; by?: VillagerId; text?: string; x?: number; y?: number }
  | { type: "harvested"; id: string; x: number; y: number }
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
  /** Neighbors' plots: buy the deed at the Town Hall, set it down, build it up a stage. */
  | { type: "buy_plot"; building: BuildingId }
  | { type: "place_plot"; building: BuildingId; x: number; y: number }
  | { type: "build_plot"; building: BuildingId }
  /** GitHub for Tinker: a token you pasted, or the GitHub CLI's login on this computer. */
  | { type: "connect_github"; token: string }
  | { type: "github_cli" }
  /** The game's Spotify player is ready (its device id), so Echo can play to it. */
  | { type: "spotify_device"; id: string }
  | { type: "place_deco"; item: string; x: number; y: number }
  | { type: "move_deco"; id: string; x: number; y: number }
  | { type: "move_building"; building: BuildingId; x: number; y: number }
  | { type: "sell_deco"; id: string }
  | { type: "toggle_deco"; id: string }
  /** Switch to (or back from) the dev showcase save. */
  | { type: "dev_mode"; on: boolean }
  /** Sign out on the title screen (on your own computer). */
  | { type: "forget_me" }
  /** The intro's been watched (it only plays the first time). */
  | { type: "intro_seen" }
  /** Testing: start this save over from scratch (the server keeps a copy of the old one). */
  | { type: "reset_world" }
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
  | { type: "upgrade"; landmark: LandmarkId }
  | { type: "harvest"; id: string }
  | { type: "dig"; id: string }
  | { type: "dev"; action: "move_in" | "materials" | "meteor" | "dust" | "town" }
  | { type: "disconnect"; service: "google" | "canvas" | "spotify" | "github" };

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
