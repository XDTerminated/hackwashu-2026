import { ITEMS, LANDMARKS, LANDMARK_IDS, NODES, NODE_MATERIAL, NORTH_Y, SOUTH_Y, maxStage, stageName, neighborCap, openAt, shopOpen, walkableAt, type LandmarkId } from "../../../shared/town";
import { TownView } from "../townview";
import Phaser from "phaser";
import {
  BUILDINGS,
  EXTENSIONS,
  MATERIALS,
  MATERIAL_NAME,
  MOVE_INS,
  MATERIAL_SOURCE,
  VILLAGER_HOME,
  VILLAGER_NAMES,
  VILLAGER_SERVICE,
  VILLAGER_SHORT,
  moveInAt,
  moveInFor,
  onMap,
  type BuildingId,
  type Material,
  type Materials,
  type MoveInDef,
  type SeqEvent,
  type VillagerId,
  IN_OFFICE,
} from "../../../shared/game";
import { lovedCount, materialUses, needsText, nextBuild, nextStep, type MoveInState } from "../../../shared/movein";
import { ClodActor, VillagerActor, puff } from "../actors";
import { conversation, mutter } from "../chatter";
import { ChoreView } from "../choreviews";
import { DECOR, LOVED_POINTS, decorFootprint, happinessFor, sellPrice, yardOf } from "../../../shared/decor";
import type { Deco } from "../../../shared/game";
import { itemById, type ShopItem } from "../items";
import { shadowKey } from "../textures";
import { Button, C, Label } from "../widgets";
import { LANDING, PLAZA_R, SPOTS, STREET, TILE, isAnnex, WORLD_H, WORLD_W, RESERVED, ROCK_NAME, ROCK_STONE, ROCK_TILES, rockKey, shardKey, shardSpots, overlaps, besideDoor, buildingRects, buildingTiles, canOccupy, plazaRing, rockRect, rockSpots, type Rock, footprint, inIsland, inIslandXY, lanternAt, snapToTiles, type Rect } from "../layout";
import * as net from "../net";
import { toggleMusic } from "../music";
import { closePanel, isPanelOpen, onPanelToggle, openConnect, openGuide, openInfo, openLetter } from "../panel";
import { NearTalk } from "../neartalk";
import { closeMoonPad, isMoonPadOpen } from "../tablet";
import { clearListener, setListener, sfx, sfxAt } from "../sfx";
import { OUTER, PLAZA, bakeOuter, bakeTerrain, drawStreet, lampSpots } from "../terrain";
import { drawPaths, redrawTile } from "../pathart";
import { fromKey, pathDef, pathKey, pathTileOk, type PathStyle } from "../../../shared/paths";
import { inTutorial, pendingApprovalFor, store } from "../store";
import { hostName, isMe, mayAsk, mp, onPeers, onSession, perms, visiting } from "../multiplayer";
import { PeerActor } from "../peerview";
import { PlayerIdle } from "../idle";
import type { Peer } from "../../../shared/visit";

/** What Moon Shards go into, in a sentence: "Mabel's Library and the grand Observatory, Town Hall and Fountain". */
const shardUses = () => {
  const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs.join(""));
  const uses = materialUses("shard");
  const grand = uses.filter((u) => u.endsWith(" (grand)")).map((u) => u.replace(" (grand)", "").replace(/^the /, "").replace(/^\S+'s /, ""));
  const built = uses.filter((u) => !u.endsWith(" (grand)")).map((u) => u.replace(/ \(.*\)$/, ""));
  return and([...built, ...(grand.length ? [`the grand ${and(grand)}`] : [])]);
};

const VILLAGERS: VillagerId[] = ["jade_rabbit", "postmaster", "timekeeper", "scholar", "stargazer", "dj", "mechanic"];
const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];

/** What each plot is for, on its sign. */
const PLOT_PURPOSE: Partial<Record<BuildingId, string>> = {
  post_office: "Hoot's home: your Gmail",
  clock_tower: "Cog's home: your calendar",
  library: "Mabel's home: your Canvas",
  radio_tower: "Echo's home: your Spotify",
  workshop: "Ada's Office extension: Tinker moves in, for your GitHub",
  rocket_pad: "Hoot's Post Office extension: he can send your emails (you OK each one)",
  office: "watch your coding agents work",
};

/** Quick hellos when you pass a villager. */
const HELLOS: Record<VillagerId, string[]> = {
  jade_rabbit: ["Hi hi! Hop to it!", "Oh! It's you! *thump thump*", "Found any Moon Shards yet?", "The garden smells lovely today."],
  stargazer: ["Earth looks bright tonight.", "Psst, a meteor's due soon...", "Hello, star-sibling!", "I saw a shard glinting out west!"],
  postmaster: ["Hoo! Any letters for me?", "Stamp of approval! Hoo.", "Mind the mailbox, dear."],
  timekeeper: ["Right on time. *tick*", "Hello! Tock.", "You're three minutes early. Good!"],
  scholar: ["Oh! Hello! *adjusts glasses*", "Did you know the Moon has quakes?", "Reading anything good?"],
  manager: ["Hey! Busy day at the Office.", "Your agents are hard at work."],
  dj: ["Bzzt! Hey hey!", "Want a song? Just ask!", "Feeling a groove today."],
  mechanic: ["Hey there! Mind the grease.", "Got any PRs for me?", "The Workshop's open!"],
};

/**
 * Somewhere someone can stand: feet on the island, and head over it too, so at
 * the island's back edge you stop short instead of standing against open space.
 */
const onGround = (x: number, y: number) => inIslandXY(x, y) && inIslandXY(x - 6, y - 26) && inIslandXY(x + 6, y - 26) && walkableAt(store.progress.town, x, y);

/** Every neighbor's home (the lots that go from ruin to house). */
const MOVE_INS_HOMES = () => MOVE_INS.map((m) => m.home);

const GREETINGS: Record<VillagerId, string> = {
  jade_rabbit: "Ah, my favorite exile! Tell me what you need done on Earth and I'll get the neighbors on it.",
  postmaster: "Hoo! Postmaster here. Letters in, letters out — what shall we do with your mail?",
  timekeeper: "Tick, tock. The Clock Tower keeps your days. Need a slot found or something booked?",
  scholar: "Ahem! The Library has your courses on file. Deadlines, announcements, grades — ask away.",
  stargazer: "The Observatory's dish is pointed at Earth's web. What should I look up?",
  manager: "Ada, Team Lead. I keep an eye on your coding agents. Want the status report?",
  dj: "Bzzt! Echo on the decks. Name a song, a mood, anything, and I'll put it on.",
  mechanic: "Tinker, at your service! I keep an eye on your GitHub: pull requests, issues, checks. What should we look at?",
};

/** Something you can do where you're standing. Drives the world prompt and the action button. */
/** What E can do on a friend's island (the rest is theirs: building, letters, stars, the Town Hall...). */
const VISITOR_VERBS = new Set(["TALK", "CALL", "CLEAR", "GRAB", "SWEEP", "GIFT", "ROCKET", "ENTER"]);

interface Interactable {
  /** Short word for the on-screen action button: TALK, BUILD, POP... */
  verb: string;
  /** Prompt shown in the world, with the keyboard shortcut. */
  label: string;
  /** Where the prompt floats. */
  x: number;
  y: number;
  /** Distance from the player to the thing itself (not the prompt) — nearest wins. */
  d: number;
  act: () => void;
  /** Hold-to-do actions (sweeping) instead of a single press. */
  hold?: boolean;
  /** Part of Yutu's tutorial (the only things E does until it's done). */
  tut?: boolean;
  /** Calling a villager: a CALL button at their door (and on the toolbar), or E. */
  atDoor?: boolean;
  /** The villager this is about (talking or reading their letter). */
  villager?: VillagerId;
}

/** Window centers on each estate's sprite (sprite pixels), for their warm glow. */
const WINDOW_GLOWS: Partial<Record<BuildingId, [number, number][]>> = {
  player_house: [[37, 43], [56, 43], [75, 43], [37, 85], [74, 85], [96, 55], [96, 79], [16, 76], [56, 24]],
  rabbit_burrow: [[24, 72], [89, 70], [44, 55], [56, 80]],
  post_office: [[16, 82], [96, 82], [22, 43], [40, 43], [74, 43], [92, 43], [56, 84]],
  clock_tower: [[26, 114], [48, 114], [36, 158]],
  observatory: [[32, 92], [80, 92], [56, 100]],
  library: [[50, 40], [62, 40], [74, 40], [12, 60], [12, 86], [116, 60], [116, 86], [35, 82], [93, 82], [64, 74]],
};

/** Something picked up to be set down elsewhere: a new purchase, a placed decoration, or a building. */
type Held = { kind: "new"; item: ShopItem } | { kind: "deco"; id: string; item: ShopItem } | { kind: "building"; b: BuildingId } | { kind: "plot"; b: BuildingId } | { kind: "lantern"; id: string };

type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Yutu says hello once per visit, not on every scene restart. */
let welcomed = false;

export class GameScene extends Phaser.Scene {
  player!: Phaser.GameObjects.Sprite;
  private playerShadow!: Phaser.GameObjects.Image;
  villagers = new Map<VillagerId, VillagerActor>();
  clods = new Map<string, ClodActor>();
  private facing: "down" | "up" | "side" = "down";
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private panelOpen = false;
  private buildingObjs = new Map<BuildingId, Phaser.GameObjects.GameObject[]>();
  private solids: Phaser.Geom.Rectangle[] = [];
  private prompt!: Label;
  private promptText = "";
  private callBtn!: Button;
  private doorCall: Interactable | null = null;
  /** The on-screen action button is being held (for hold-to-sweep). */
  private uiHold = false;
  private lastAction = "";
  private target: Interactable | null = null;
  private ghost: Phaser.GameObjects.Image | null = null;
  private handshakes = new Map<string, Deferred[]>();
  private unsubs: Array<() => void> = [];

  constructor() {
    super("Game");
  }

  create() {
    this.signs = [];
    this.peerViews.clear();
    this.selfBubble = null;
    this.flying = false;
    this.villagers.clear();
    // (a restart kills the timers that would have finished these)
    this.constructing.clear();
    this.clods.clear();
    this.lamps = [];
    this.bells.clear();
    this.choreViews.clear();
    this.idleCooldown.clear();
    this.chatting.clear();
    this.buildingObjs.clear();
    this.decoViews.clear();
    this.lanternViews.clear();
    this.solids = [];

    this.bakeGround();
    // The town: rockfalls over the parts the roads haven't reached, things to gather, things to dig up.
    this.town = new TownView(this);
    this.town.refresh();
    this.nodeSolids = [];
    this.refreshNodeSolids();
    this.townStages = { ...store.progress.town.stages };
    this.tutorialStep = undefined;
    this.time.delayedCall(1500, () => this.tutorialLine());

    this.add.image(LANDING.x, LANDING.y - 1, shadowKey(this, 34)).setDepth(-8);
    this.ship = this.add.image(LANDING.x, LANDING.y, "ship").setOrigin(0.5, 1).setDepth(LANDING.y);
    this.solids.push(new Phaser.Geom.Rectangle(LANDING.x - 14, LANDING.y - 10, 28, 10));

    for (const b of BUILDING_IDS) this.placeBuilding(b, false);
    store.decos.forEach((d) => this.spawnDeco(d));
    store.lanterns.forEach((_, i) => this.plantLantern(i, false));

    // Villagers who've moved in stand at home.
    for (const v of VILLAGERS) if (store.residents.includes(v)) this.spawnVillager(v, false);

    // Clods still waiting to be collected (work finished while you were away).
    for (const c of store.clods) {
      const spot = this.clodSpot(c.building);
      const a = new ClodActor(this, c, spot, spot, true);
      if (c.result) a.setLabel(c.status === "failed" ? `✗ ${c.result}` : c.result);
      this.clods.set(c.id, a);
    }

    // Letters still waiting on you: those villagers are standing at your door.
    for (const a of store.approvals) {
      const actor = this.villagers.get(a.villager);
      if (!actor) continue;
      const door = this.houseDoorFor(a.villager);
      actor.sprite.setPosition(door.x, door.y);
      actor.carryLetter(true);
      actor.setAlert("bang");
    }

    // A restart (moved building, reconnect) keeps you where you were standing.
    // (a visitor steps off the rocket on the other side, so nobody lands on top of the owner)
    const start = this.resumeAt ?? (visiting() ? { x: LANDING.x - 34, y: LANDING.y + 26 } : { x: LANDING.x + 34, y: LANDING.y + 26 });
    this.resumeAt = null;
    this.player = this.add.sprite(start.x, start.y, "astro_0").setOrigin(0.5, 1);
    this.playerShadow = this.add.image(this.player.x, this.player.y, shadowKey(this, 16)).setDepth(-8);
    this.idle = new PlayerIdle(this, this.player);
    this.watchPeers();

    this.prompt = new Label(this, 0, 0, "", { bg: C.wood, border: C.woodDark, color: C.paperLight, font: "pxb" }).setDepth(99999).setVisible(false);
    this.callBtn = new Button(this, 0, 0, "CALL", C.greenBtn, () => this.doorCall?.act(), 36).setDepth(99998).setVisible(false);

    for (const c of store.chores) this.choreViews.set(c.id, new ChoreView(this, c, (x, y, r) => this.distTo(x, y) < r));
    this.sweepBar = this.add.graphics().setDepth(99999);

    this.setupInput();

    const cam = this.cameras.main;
    // (the view reaches past the world's edge, so you can see over the crater wall)
    cam.setBounds(-OUTER, -OUTER, WORLD_W + OUTER * 2, WORLD_H + OUTER * 2);
    cam.centerOn(this.player.x, this.player.y);
    cam.startFollow(this.player, true, 0.12, 0.12);

    this.held = null;
    this.ghost = null;
    this.gridKey = "";
    this.gridG = this.add.graphics().setDepth(-7).setVisible(false);
    this.footG = this.add.graphics().setDepth(99997);
    this.emitArrange();
    cam.setRoundPixels(true);

    this.unsubs.push(net.onEvent((e) => this.direct(e)));
    // While you're inside the Office this scene sleeps; catch up when you come back out.
    this.unsubs.push(net.onSnapshot(() => (this.sys.isSleeping() ? (this.restartOnWake = true) : this.restartInPlace())));
    const onWake = () => {
      this.lastAction = "";
      this.emitArrange();
      this.cameras.main.fadeIn(250, 11, 10, 26);
      if (this.restartOnWake) {
        this.restartOnWake = false;
        this.restartInPlace();
      }
    };
    this.events.on(Phaser.Scenes.Events.WAKE, onWake);
    // The UI restarted (window resize): tell it again what the action button and edit bar should show.
    const onUiReady = () => {
      if (!this.sys.isActive()) return;
      this.lastAction = "";
      this.emitArrange();
    };
    this.game.events.on("ui-ready", onUiReady);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.WAKE, onWake);
      this.game.events.off("ui-ready", onUiReady);
    });
    const buy = (itemId: string) => {
      if (!this.sys.isActive()) return;
      const item = itemById(itemId);
      if (item) this.pickUp({ kind: "new", item });
    };
    const toggleEdit = () => this.sys.isActive() && this.setEditMode(!this.editMode);
    const cancel = () => this.sys.isActive() && this.cancelHeld();
    const sell = () => {
      if (!this.sys.isActive()) return;
      if (this.held?.kind !== "deco") return;
      net.send({ type: "sell_deco", id: this.held.id });
      this.cancelHeld();
    };
    this.game.events.on("begin-place", buy);
    const paint = (p: PathStyle | "erase" | null) => this.sys.isActive() && this.setPainting(p);
    this.game.events.on("paint-paths", paint);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => (this.flushStroke(), this.game.events.off("paint-paths", paint)));
    const placePlot = (b: BuildingId) => this.sys.isActive() && this.pickUp({ kind: "plot", b });
    this.game.events.on("place-plot", placePlot);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off("place-plot", placePlot));
    this.game.events.on("edit-toggle", toggleEdit);
    this.game.events.on("arrange-cancel", cancel);
    this.game.events.on("arrange-sell", sell);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      this.game.events.off("begin-place", buy);
      this.game.events.off("edit-toggle", toggleEdit);
      this.game.events.off("arrange-cancel", cancel);
      this.game.events.off("arrange-sell", sell);
    });
    // The UI's action button mirrors whatever you could do right here.
    const press = () => {
      if (!this.sys.isActive()) return;
      if (!this.windowOpen() && !this.arranging) this.eTarget()?.act();
    };
    const hold = (on: boolean) => (this.uiHold = on);
    this.game.events.on("action-press", press);
    this.game.events.on("action-hold", hold);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off("action-press", press);
      this.game.events.off("action-hold", hold);
    });

    const rabbit = this.villagers.get("jade_rabbit");
    // (in the tutorial Yutu's own window says hello, and that counts; a friend's island has its own welcome)
    if (store.connected && (inTutorial() || visiting())) welcomed = true;
    if (rabbit && store.connected && !welcomed) {
      welcomed = true;
      const ready = store.clods.filter((c) => c.status === "ready").length;
      this.time.delayedCall(900, () => {
        const text = ready
          ? `Welcome back! The neighbors finished ${ready} thing${ready === 1 ? "" : "s"} while you were away - pop the glowing stars to collect!`
          : "Welcome back to the Moon! The gold ★ points at what's next.";
        // Off-screen (or down behind the toolbar), a bubble would go unseen: send it as a message instead.
        const v = this.cameras.main.worldView;
        const seen = rabbit.x > v.x + 40 && rabbit.x < v.right - 40 && rabbit.y - 40 > v.y + 30 && rabbit.y < v.bottom - 60;
        if (seen) rabbit.say(text, 5000);
        // A fresh start: Nova says who's coming, once.
        const first = MOVE_INS[0];
        if (!store.progress.movedIn.length && !store.progress.plots[first.home])
          this.time.delayedCall(6500, () => {
            try {
              if (localStorage.getItem("moon-first-teaser") === "1") return;
              localStorage.setItem("moon-first-teaser", "1");
            } catch {
              /* say it anyway */
            }
            this.game.events.emit("npc-toast", { who: VILLAGER_NAMES[first.teaser.by], text: first.teaser.text });
          });
        else this.game.events.emit("npc-toast", { who: VILLAGER_NAMES.jade_rabbit, text });
      });
    }
    this.startPos = { x: this.player.x, y: this.player.y };
    this.input.keyboard!.on("keydown-M", () => !this.windowOpen() && !isMoonPadOpen() && toggleMusic());
  }

  private startPos: { x: number; y: number } | null = null;
  /** Everyone else on the island right now (online). */
  private peerViews = new Map<string, PeerActor>();
  private posSent = { x: 0, y: 0, f: "", moving: false, at: 0 };
  private ship!: Phaser.GameObjects.Image;
  /** Lifting off for another island: nothing more to do here. */
  private flying = false;
  private selfBubble: Label | null = null;

  /** Building and plot signs, shown only when you're nearby (or arranging). */
  private signs: { label: Label; x: number; y: number; r: number }[] = [];

  private updateLabels() {
    this.signs = this.signs.filter((s) => s.label.scene);
    for (const s of this.signs) {
      const want = this.arranging || this.distTo(s.x, s.y) < s.r ? 1 : 0;
      const a = s.label.alpha;
      if (a !== want) s.label.setAlpha(Phaser.Math.Clamp(a + (want > a ? 0.1 : -0.1), 0, 1));
    }
    // (the "[E] talk to ..." prompt already names whoever you're facing)
    for (const [v, a] of this.villagers) a.showName(!this.windowOpen() && this.target?.villager !== v && !this.near?.isWith(v) && this.distTo(a.x, a.y - 10) < 56);
  }

  /** In edit mode or holding something to place. */
  isArranging() {
    return this.arranging;
  }

  /** Everything the moving-in checklist looks at. */
  private moveState(): MoveInState {
    return { progress: store.progress, materials: store.materials, buildings: store.buildings, coins: store.coins, decos: store.decos };
  }

  /** Short on a material: the nearest place to get some (for the ★). */
  private materialSource(m: Material): { x: number; y: number; label: string } | null {
    const near = <T extends { x: number; y: number }>(list: T[]) => list.sort((a, b) => this.distTo(a.x, a.y) - this.distTo(b.x, b.y))[0];
    const town = store.progress.town;
    const node = NODES.find((n) => NODE_MATERIAL[n.kind] === m) ? near(NODES.filter((n) => NODE_MATERIAL[n.kind] === m && openAt(town, n.x, n.y) && !town.harvested.includes(n.id))) : undefined;
    if (node) return { x: node.x, y: node.y - 16, label: `${MATERIAL_NAME[m]}` };
    if (m === "ice" || m === "scrap" || m === "helium") return { ...this.landmarkAt("roads"), label: "Fix the roads to reach it" };
    if (m === "ore") {
      const met = near([...this.choreViews.values()].filter((c) => c.chore.kind === "meteor").map((c) => ({ x: c.chore.x, y: c.chore.y })));
      return met ? { x: met.x, y: met.y - 14, label: "A meteor: glow ore" } : null;
    }
    if (m === "stardust") {
      const d = near([...this.choreViews.values()].filter((c) => c.chore.kind === "dust").map((c) => ({ x: c.chore.x, y: c.chore.y })));
      return d ? { x: d.x, y: d.y - 14, label: "Sweep for stardust" } : null;
    }
    if (m === "moonstone") {
      const r = near([...this.rocks]);
      return r ? { x: r.x, y: r.y - 30, label: "Clear it for moonstone" } : null;
    }
    const sh = near([...this.shards.values()]);
    return sh ? { x: sh.x, y: sh.y - 14, label: "A Moon Shard" } : null;
  }

  /** Where you go to upgrade a landmark: the fountain in the plaza; the Town Hall, Market and roads at their buildings. */
  private landmarkAt(id: LandmarkId): { x: number; y: number } {
    if (id === "fountain") return { x: PLAZA.x, y: PLAZA.y - 50 };
    const s = SPOTS[id === "market" ? "market" : "town_hall"];
    return { x: s.x, y: s.y - 24 };
  }

  /**
   * Where the next goal is: the rubble or the lot, a story item to dig up, a
   * landmark to upgrade, or the nearest place to get a missing material.
   */
  questTarget(): { x: number; y: number; label: string } | null {
    if (visiting()) return null;
    const n = nextStep(this.moveState());
    if (!n) return null;
    if (n.kind === "dig") return { x: n.spot.x, y: n.spot.y - 14, label: "Dig here" };
    if (n.kind === "choose") return { ...this.landmarkAt("town_hall"), label: "Pick your first neighbor" };
    if (n.kind === "landmark") {
      const up = LANDMARKS[n.id].up[store.progress.town.stages[n.id]];
      const short = !n.ready && MATERIALS.find((m) => (up.needs[m] ?? 0) > store.materials[m]);
      const src = short && this.materialSource(short);
      if (src) return src;
      return { ...this.landmarkAt(n.id), label: `Upgrade the ${LANDMARKS[n.id].name}` };
    }
    // A neighbor's plot: buy it at the Town Hall, set it down, then build it up.
    const { def, action } = n;
    const who = VILLAGER_SHORT[def.villager];
    if (action === "buy") return { ...this.landmarkAt("town_hall"), label: `Buy ${who}'s plot` };
    if (action === "place") return this.held?.kind === "plot" ? null : { ...this.landmarkAt("town_hall"), label: `Set ${who}'s plot down` };
    const needs = nextBuild(def, store.progress.plots[def.home]) ?? {};
    if (!n.ready) {
      const short = MATERIALS.find((m) => (needs[m] ?? 0) > store.materials[m]);
      const src = short && this.materialSource(short);
      if (src) return src;
    }
    const s = SPOTS[def.home];
    return { x: s.x, y: s.y - 24, label: action === "build" ? `Build ${who}'s house` : "Make it grand" };
  }

  /** Moved in, but their account isn't connected (and no sample data chosen) yet. */
  private needsConnect(v: VillagerId) {
    if (visiting()) return false;
    const service = VILLAGER_SERVICE[v];
    if (!service || service === "web") return false;
    return !store.connections[service].connected && !store.progress.sandbox[service];
  }

  /** A neighbor's plot: its card (what the next stage takes, and the BUILD button). */
  private showPlot(def: MoveInDef) {
    this.game.events.emit("town-panel", { kind: "lot", home: def.home });
  }

  /** A neighbor's house is built but they haven't moved in: what's still missing, by the door. */
  private needSigns = new Map<BuildingId, Label>();

  private refreshNeedSign(b: BuildingId) {
    const def = moveInAt(b);
    const sign = this.needSigns.get(b);
    // (only while a built house waits on things its neighbor loves in the yard: nobody does, these days)
    if (!def || !def.loves || !store.buildings[b] || store.progress.movedIn.includes(def.villager)) {
      sign?.destroy();
      this.needSigns.delete(b);
      return;
    }
    const text = `${VILLAGER_SHORT[def.villager]} moves in when the yard has\n${def.loves} thing${def.loves === 1 ? "" : "s"} ${VILLAGER_SHORT[def.villager]} loves (${Math.min(lovedCount(def, this.moveState()), def.loves)}/${def.loves})`;
    if (sign?.scene) return void sign.setText(text);
    const d = this.doorOf(b);
    const label = new Label(this, d.x, d.y + 4, text, { bg: C.paperLight, border: C.woodDark, originY: 0, maxWidth: 150 }).setDepth(d.y + 2).setAlpha(0);
    this.needSigns.set(b, label);
    this.signs.push({ label, x: d.x, y: d.y, r: 120 });
  }

  // ================================================================ world

  private bakeGround() {
    bakeTerrain(this);
    // The crater wall, the plains beyond and the Moon's curve, under the crater floor.
    bakeOuter(this);
    this.add.image(-OUTER, -OUTER, "outer").setOrigin(0).setDepth(-11);
    this.add.image(0, 0, "ground").setOrigin(0).setDepth(-10);

    // Main Street (the town's own) on its layer; the paths you lay on theirs, just above.
    const paths = this.textures.exists("paths") ? (this.textures.get("paths") as Phaser.Textures.CanvasTexture) : this.textures.createCanvas("paths", WORLD_W, WORLD_H)!;
    this.pathTex = paths;
    const ctx = paths.getContext();
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);
    drawStreet(ctx, this.roadsBroken());
    paths.refresh();
    this.add.image(0, 0, "paths").setOrigin(0).setDepth(-9.5);
    const tiles = this.textures.exists("pathtiles") ? (this.textures.get("pathtiles") as Phaser.Textures.CanvasTexture) : this.textures.createCanvas("pathtiles", WORLD_W, WORLD_H)!;
    this.tileTex = tiles;
    tiles.getContext().clearRect(0, 0, WORLD_W, WORLD_H);
    drawPaths(tiles.getContext(), store.paths);
    tiles.refresh();
    this.add.image(0, 0, "pathtiles").setOrigin(0).setDepth(-9.4);

    this.bakePlaza();
    for (const p of lampSpots((b) => !!store.buildings[b])) this.addLamp(p.x, p.y, !p.building);
    this.placeRocks();
    this.placeShards();
  }

  /**
   * The grand plaza: open marble paving around the Earthrise Fountain, with
   * obelisks just outside the rim (lampposts are added with the other lamps).
   * Everything sits on the tile grid.
   */
  private bakePlaza() {
    const P = PLAZA;
    const prop = (key: string, dx: number, dy: number, solidW = 0) => {
      const x = P.x + dx;
      const y = P.y + dy;
      this.add.image(x, y - 1, shadowKey(this, Math.max(10, solidW || 12))).setDepth(-8);
      const img = this.add.image(x, y, key).setOrigin(0.5, 1).setDepth(y);
      if (solidW) this.solids.push(new Phaser.Geom.Rectangle(x - solidW / 2, y - 10, solidW, 10));
      return img;
    };
    const fy = P.y + 16;
    this.add.image(P.x, P.y + 8, shadowKey(this, 116)).setDepth(-8);
    this.fountain = {
      sprite: this.add.sprite(P.x, fy, "plaza_fountain_dry").setOrigin(0.5, 1).setDepth(fy),
      star: this.add.image(P.x, P.y - 58, "glow_l").setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe08a).setAlpha(0.3).setDepth(fy + 1),
      water: this.add.image(P.x, P.y + 4, "glow_l").setBlendMode(Phaser.BlendModes.ADD).setTint(0x9fe3f0).setAlpha(0.18).setDepth(fy + 1),
    };
    this.applyFountain();
    // The great basin is an oval (about 114 x 31 on screen): block it in thin
    // slices so you walk around the rim, never into the water. A little
    // wider than the art, since your feet are the point that collides, and
    // deeper at the back so you stand clearly behind the rim, not on it.
    const RX = 63, BACK = 28, FRONT = 19, CY = P.y + 1;
    for (let dy = -BACK; dy < FRONT; dy += 3) {
      const mid = (dy + 1.5) / (dy < 0 ? BACK : FRONT);
      const half = Math.round(RX * Math.sqrt(Math.max(0, 1 - mid * mid)));
      this.solids.push(new Phaser.Geom.Rectangle(P.x - half, CY + dy, half * 2, 3));
    }
    // Obelisks stand just outside the rim at the ends of the east-west axis; the paving stays open.
    plazaRing().obelisks.forEach((o) => prop("obelisk", o.x - P.x, o.y - P.y, 14));
  }

  // ================================================================ the town

  private town!: TownView;
  private townStages!: Record<LandmarkId, number>;
  private fountain?: { sprite: Phaser.GameObjects.Sprite; star: Phaser.GameObjects.Image; water: Phaser.GameObjects.Image };

  private roadsBroken() {
    return store.progress.town.stages.roads === 0;
  }

  /** The Town Hall and Market look like the stage they're at. */
  private textureOf(b: BuildingId) {
    return b === "town_hall" || b === "market" ? `${SPOTS[b].texture}_${store.progress.town.stages[b]}` : SPOTS[b].texture;
  }

  private applyFountain() {
    const f = this.fountain;
    if (!f) return;
    const stage = store.progress.town.stages.fountain;
    if (stage === 0) f.sprite.stop().setTexture("plaza_fountain_dry");
    else f.sprite.play(stage === 1 ? "plaza-fountain-mid" : "plaza-fountain");
    f.water.setVisible(stage >= 1);
    f.star.setVisible(stage === 2);
  }

  private redrawPaths() {
    const ctx = this.pathTex.getContext();
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);
    drawStreet(ctx, this.roadsBroken());
    this.pathTex.refresh();
  }

  /** Path tiles changed: redraw them and their neighbors (whose edges join up to them). */
  private redrawPathTiles(keys: string[]) {
    const ctx = this.tileTex.getContext();
    const done = new Set<string>();
    for (const k of keys) {
      const { tx, ty } = fromKey(k);
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = pathKey(tx + dx, ty + dy);
        if (done.has(key)) continue;
        done.add(key);
        redrawTile(ctx, store.paths, tx + dx, ty + dy);
      }
    }
    this.tileTex.refresh();
  }

  private tutorialStep: number | null | undefined;

  /** The tutorial: Yutu says a word as each step comes up (and once it's all done). */
  private tutorialLine() {
    // (a friend's island: its tutorial is theirs)
    if (visiting()) return;
    const n = nextStep(this.moveState());
    const step = n?.tutorial ?? null;
    const was = this.tutorialStep;
    this.tutorialStep = step;
    // (on arrival, only if there's a tutorial step to pick up)
    if (step === was || (was === undefined && !step)) return;
    const first = MOVE_INS.find((m) => store.progress.plots[m.home]);
    const who = first ? VILLAGER_SHORT[first.villager] : "";
    const LINES: Record<number, string> = {
      1: "Let's get you started! The Town Hall (the glass dome) is a ruin, and it's where neighbors from Earth buy their plots. Fixing it takes a little moonstone and stardust: press E by a boulder to break it up, then stand on a moondust drift and hold E to sweep it.",
      2: "That's enough! Walk over to the Town Hall (follow the gold ★) and press E to repair it.",
      3: "The Town Hall's open, with room for one neighbor! Who moves in first is up to you: each one helps with something real, like Hoot with your Gmail, Cog with your calendar or Echo with your Spotify. Press E at the Town Hall and buy their plot.",
      4: "It's yours! Now pick a spot for it: move it around and click to set it down. Anywhere with room will do.",
      5: `Now build ${who}'s ${first ? BUILDINGS[first.home].name : "house"}. It takes a little moonstone and stardust: gather what you need (follow the ★), then press E at the plot to build it.`,
    };
    const home = store.progress.movedIn[0] ? VILLAGER_SHORT[store.progress.movedIn[0]] : "Your neighbor";
    const text = step ? LINES[step] : was ? `${home}'s home, and that's the ropes! Each new neighbor needs room: take the Town Hall up a level (E at the Town Hall), then buy their plot. Fix up the Market for a Shop, too. The town's all yours now!` : null;
    if (!text) return;
    const done = !step;
    // Yutu's window, with her portrait: once whatever's on screen now is out of the way.
    const show = () => {
      if (this.windowOpen() || isMoonPadOpen()) return void this.time.delayedCall(500, show);
      const hello = step === 1 ? "Welcome to the Moon! I'm Yutu, the mayor around here. " : was === undefined ? "Welcome back! Where were we... " : "";
      openGuide("jade_rabbit", hello + text, done ? "LET'S GO!" : "GOT IT", () => done && this.game.events.emit("tutorial-done"));
    };
    this.time.delayedCall(was === undefined ? 800 : done ? 4000 : 700, show);
  }

  private nodeSolids: Phaser.Geom.Rectangle[] = [];

  /** Ice crystals, scrap and glow-ore craters are solid (until picked for the day); helium-3 is dust you walk over. */
  private refreshNodeSolids() {
    this.solids = this.solids.filter((r) => !this.nodeSolids.includes(r));
    const town = store.progress.town;
    const picked = town.day === new Date().toDateString() ? town.harvested : [];
    this.nodeSolids = NODES.filter((n) => n.kind !== "helium" && !picked.includes(n.id)).map((n) => new Phaser.Geom.Rectangle(n.x - 8, n.y - 6, 16, 6));
    this.solids.push(...this.nodeSolids);
    this.navGrid = null;
  }

  /** After any progress: redraw what's gathered or dug, and celebrate any landmark that went up a stage. */
  private townChanged() {
    this.town.refresh();
    this.refreshNodeSolids();
    this.tutorialLine();
    const now = store.progress.town.stages;
    for (const id of LANDMARK_IDS) {
      if (now[id] === this.townStages[id]) continue;
      const up = now[id] > this.townStages[id];
      this.townStages[id] = now[id];
      this.applyLandmark(id, up);
    }
  }

  private applyLandmark(id: LandmarkId, celebrate: boolean) {
    const at = id === "fountain" ? { x: PLAZA.x, y: PLAZA.y - 30 } : id === "roads" ? { x: this.player.x, y: this.player.y - 20 } : { x: SPOTS[id].x, y: SPOTS[id].y - 40 };
    if (id === "town_hall" || id === "market") this.placeBuilding(id, false);
    if (id === "fountain") this.applyFountain();
    if (id === "roads") {
      this.redrawPaths();
      // the crews clear the rockfall that just opened
      const line = store.progress.town.stages.roads === 1 ? NORTH_Y : SOUTH_Y;
      for (let i = 0; i < 24; i++) this.time.delayedCall(i * 50, () => puff(this, Phaser.Math.Between(200, WORLD_W - 200), line + Phaser.Math.Between(-10, 10)));
    }
    if (!celebrate) return;
    for (let i = 0; i < 10; i++) this.time.delayedCall(i * 60, () => puff(this, at.x + Phaser.Math.Between(-30, 30), at.y + Phaser.Math.Between(-10, 20)));
    const burst = this.add.particles(at.x, at.y, "spark", { speed: { min: 50, max: 140 }, lifespan: 700, quantity: 26, alpha: { start: 1, end: 0 }, emitting: false }).setDepth(99985);
    burst.explode(26);
    this.time.delayedCall(800, () => burst.destroy());
    sfx.buy();
    const stage = store.progress.town.stages[id];
    const perk = LANDMARKS[id].perks[stage];
    this.game.events.emit("npc-toast", { who: VILLAGER_NAMES.jade_rabbit, text: `The ${LANDMARKS[id].name} is ${id === "town_hall" && stage < maxStage(id) ? `up to ${stageName(id, stage)}` : stageName(id, stage)}! ${perk}.` });
  }

  private rocks: Rock[] = [];
  private rockViews = new Map<string, { objs: Phaser.GameObjects.GameObject[]; solid: Phaser.Geom.Rectangle }>();

  /** Moon rocks all over the island (solid; crystal outcrops glow). */
  private placeRocks() {
    const avoid = [
      ...store.decos.flatMap((d) => {
        const item = itemById(d.item);
        return item ? [decorFootprint(item, d.x, d.y)] : [];
      }),
      ...store.lanterns.map((l, i) => footprint(lanternAt(l, i).x, lanternAt(l, i).y, 1, 1)),
    ];
    this.rocks = rockSpots(avoid, store.clearedRocks);
    this.rockViews.clear();
    for (const r of this.rocks) this.addRock(r);
  }

  /** One moon rock on the island (solid; crystal outcrops glow). */
  private addRock(r: Rock) {
    {
      const objs: Phaser.GameObjects.GameObject[] = [];
      const w = ROCK_TILES[r.kind] * TILE;
      objs.push(this.add.image(r.x, r.y - 1, shadowKey(this, w)).setDepth(-8));
      // Variants and mirroring (never scaling) so no two rock fields look alike.
      const n = Math.abs(Math.round(r.x / 16) * 7 + Math.round(r.y / 16) * 13);
      const key = r.kind === "small" || r.kind === "big" ? `rock_${r.kind}_${n % 3}` : `rock_${r.kind}`;
      const img = this.add.image(r.x, r.y, key).setOrigin(0.5, 1).setDepth(r.y).setFlipX(n % 2 === 1);
      // Click a rock you're standing by to clear it (it breaks into moonstone).
      img.setInteractive({ useHandCursor: true }).on("pointerdown", (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        if (this.arranging || this.panelOpen) return;
        ev.stopPropagation();
        if (this.distTo(r.x, r.y - 6) > 60) return void this.floatText(this.player.x, this.player.y - 36, "Walk closer to clear it", 0xe8e4d8, 1200);
        this.clearRockNow(r);
      });
      objs.push(img);
      if (r.kind === "crystal") {
        const g = this.add.image(r.x, r.y - 12, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0x6fe3e1).setDepth(r.y + 1);
        objs.push(g);
        this.tweens.add({ targets: g, alpha: { from: 0.2, to: 0.5 }, duration: 1600 + (r.x % 7) * 150, yoyo: true, repeat: -1, ease: "sine.inout" });
      }
      const f = rockRect(r);
      const solid = new Phaser.Geom.Rectangle(f.x + 2, f.y + 4, f.w - 4, f.h - 4);
      this.solids.push(solid);
      this.rockViews.set(rockKey(r), { objs, solid });
    }
  }

  private shards = new Map<string, { x: number; y: number; objs: Phaser.GameObjects.GameObject[] }>();
  private shardSent = new Set<string>();

  /** Moon Shards still out in the wilds: walk over one to pick it up. */
  private placeShards() {
    this.shards.clear();
    this.shardSent.clear();
    const found = new Set(store.shards);
    for (const p of shardSpots()) {
      const key = shardKey(p);
      if (found.has(key)) continue;
      const glow = this.add.image(p.x, p.y - 8, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0x8ff0f0).setDepth(p.y - 1);
      this.tweens.add({ targets: glow, alpha: { from: 0.25, to: 0.7 }, duration: 900, yoyo: true, repeat: -1, ease: "sine.inout" });
      const s = this.add.sprite(p.x, p.y, "shard_0").setOrigin(0.5, 1).setDepth(p.y).play({ key: "shard-twinkle", startFrame: (p.x >> 4) % 3 });
      this.tweens.add({ targets: s, y: p.y - 2, duration: 700, yoyo: true, repeat: -1, ease: "sine.inout" });
      this.shards.set(key, { x: p.x, y: p.y, objs: [glow, s, this.add.image(p.x, p.y - 1, shadowKey(this, 8)).setDepth(-8)] });
    }
  }

  private pickUpShards() {
    for (const [key, s] of this.shards) {
      if (this.shardSent.has(key) || Math.hypot(this.player.x - s.x, this.player.y - s.y) > 14) continue;
      this.shardSent.add(key);
      net.send({ type: "collect_shard", x: s.x, y: s.y });
    }
  }

  /** Coins burst from a spot in the world and fly into your wallet. */
  private coinFly(x: number, y: number, amount: number) {
    const v = this.cameras.main.worldView;
    this.game.events.emit("coin-fly", { sx: x - v.x, sy: y - v.y, amount });
  }

  private rockSent = new Set<string>();

  /** Clearing a rock is free: it breaks into moonstone for repairs. */
  private clearRockNow(r: Rock) {
    const key = rockKey(r);
    if (this.rockSent.has(key)) return;
    this.rockSent.add(key);
    net.send({ type: "clear_rock", x: r.x, y: r.y });
  }

  private rockGone(x: number, y: number, stone: number, loot?: { coins: number; what: string }) {
    const key = `${x},${y}`;
    const v = this.rockViews.get(key);
    if (!v) return;
    v.objs.forEach((o) => o.destroy());
    this.solids = this.solids.filter((s) => s !== v.solid);
    this.rockViews.delete(key);
    this.rocks = this.rocks.filter((r) => rockKey(r) !== key);
    for (let i = 0; i < 10; i++) this.time.delayedCall(i * 40, () => puff(this, x + Phaser.Math.Between(-12, 12), y - Phaser.Math.Between(0, 8)));
    this.floatText(x, y - 24, `+${stone} moonstone`, 0xc8c1d6);
    sfx.thunk();
    if (loot) {
      // Something under the rock!
      this.time.delayedCall(450, () => {
        this.floatText(x, y - 40, `Found ${loot.what}! +${loot.coins}¢`, 0xf5c542, 2200);
        this.coinFly(x, y - 10, loot.coins);
        sfx.buy();
        const burst = this.add.particles(x, y - 8, "spark", { speed: { min: 40, max: 110 }, lifespan: 500, quantity: 14, alpha: { start: 1, end: 0 }, tint: 0xf5c542, emitting: false }).setDepth(99985);
        burst.explode(14);
        this.time.delayedCall(600, () => burst.destroy());
      });
    }
  }

  private lamps: { x: number; y: number; glow: Phaser.GameObjects.Image }[] = [];
  private bells = new Map<VillagerId, { x: number; y: number; img: Phaser.GameObjects.Image }>();
  private choreViews = new Map<string, ChoreView>();
  private dustScratch: ChoreView[] = [];
  private sweepT = 0;
  private sweepSfxT = 0;
  private sweepBar!: Phaser.GameObjects.Graphics;
  private pathTex!: Phaser.Textures.CanvasTexture;
  /** The paths you've laid (their own layer, redrawn a few tiles at a time). */
  private tileTex!: Phaser.Textures.CanvasTexture;

  private addLamp(x: number, y: number, grand = false) {
    // (the post is solid: you walk around it, not through it)
    this.solids.push(new Phaser.Geom.Rectangle(x - 3, y - 4, 6, 4));
    this.add.image(x, y, shadowKey(this, grand ? 10 : 8)).setDepth(-8);
    this.add.image(x, y, grand ? "lamp_grand" : "lamp").setOrigin(0.5, 1).setDepth(y);
    const glow = this.add.image(x, y - (grand ? 26 : 15), "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0x6fe3e1).setAlpha(0.35).setDepth(y + 1);
    this.lamps.push({ x, y, glow });
  }

  /** Light a new building's doorway lamp (its path is yours to lay: Shop → PATHS). */
  private layPath(b: BuildingId) {
    if (isAnnex(b)) return;
    const lamp = lampSpots((x) => x === b).find((p) => p.building === b);
    if (lamp) this.addLamp(lamp.x, lamp.y);
  }

  private placeBuilding(b: BuildingId, animate: boolean) {
    this.buildingObjs.get(b)?.forEach((o) => {
      this.tweens.killTweensOf(o);
      o.destroy();
    });
    const s = SPOTS[b];
    const def = BUILDINGS[b];
    const objs: Phaser.GameObjects.GameObject[] = [];

    if (store.buildings[b]) {
      // The launch pad's base is a landing disc lying flat on the ground: a shadow under it reads as a second, floating disc.
      if (b !== "rocket_pad") objs.push(this.add.image(s.x, s.y - 1, shadowKey(this, s.fw * 2.2)).setDepth(-8));
      const img = this.add.image(s.x, s.y, this.textureOf(b)).setOrigin(0.5, 1).setDepth(s.y);
      objs.push(img);
      // Signs hang above the roofline so villagers at the door never cover them.
      const top = s.y - img.height - 2;
      const tag = new Label(this, s.x, top, def.name, { bg: C.wood, border: C.woodDark, color: C.paperLight, padX: 2 }).setDepth(s.y + 1).setAlpha(0);
      objs.push(tag);
      this.signs.push({ label: tag, x: s.x, y: s.y - 20, r: 130 });
      this.solids.push(new Phaser.Geom.Rectangle(s.x - s.fw, s.y - s.fh, s.fw * 2, s.fh));
      objs.push(...this.flourishes(b, s));
      const resident = def.resident;
      if (resident) {
        const p = besideDoor(b, 1);
        const bell = this.add.image(p.x, p.y, "bell_0").setOrigin(0.5, 1).setDepth(p.y);
        this.solids.push(new Phaser.Geom.Rectangle(p.x - 2, p.y - 3, 4, 3));
        objs.push(this.add.image(p.x, p.y, shadowKey(this, 8)).setDepth(-8), bell);
        this.bells.set(resident, { x: p.x, y: p.y, img: bell });
      }
      if (animate) this.construct(b, img, [tag, ...objs.filter((o) => o !== img && o !== tag)]);
      this.refreshNeedSign(b);
    } else if (onMap(b, store.progress, store.buildings) && b !== "mailbox") {
      // A plot waiting to be built: a neighbor's you've set down, or one of the colony's.
      const move = moveInAt(b);
      const plot = this.add.image(s.x, s.y, `plot_${b}`).setOrigin(0.5, 1).setDepth(s.y - 20);
      // The sign says what it's for (and, for a neighbor's lot, what's left to do).
      const purpose = PLOT_PURPOSE[b];
      const text = move
        ? `${VILLAGER_SHORT[move.villager]}'s plot: ${def.name} (${move.app})\nBuild it: ${needsText(move.build[0])} (E)`
        : EXTENSIONS[b]
          ? `${def.name}${purpose ? `\n${purpose}` : ""}\nBuild it: ${needsText(EXTENSIONS[b]!.needs)} (E)`
          : `${def.name}${purpose ? `\n${purpose}` : ""}\n${def.price ? `${def.price}¢ - ` : ""}E to build`;
      // A neighbor's sign hangs above the plot (clear of you and the rocks around it); other plots' signs sit below.
      const top = s.y - buildingTiles(b).h * TILE - 18;
      const sign = move
        ? new Label(this, s.x, top, text, { bg: C.paperLight, border: C.woodDark, originY: 1, maxWidth: 170, align: "left" }).setDepth(99970).setAlpha(0)
        : new Label(this, s.x, s.y + 2, text, { bg: C.paperLight, border: C.woodDark, originY: 0, maxWidth: 130 }).setDepth(s.y + 1).setAlpha(0);
      this.signs.push({ label: sign, x: s.x, y: s.y - 10, r: 150 });
      objs.push(plot, sign);
      if (animate) {
        plot.setAlpha(0);
        sign.setAlpha(0);
        this.tweens.add({ targets: [plot, sign], alpha: 1, duration: 600 });
        for (let i = 0; i < 8; i++) this.time.delayedCall(i * 60, () => puff(this, s.x + Phaser.Math.Between(-18, 18), s.y - 6));
      }
    }
    this.buildingObjs.set(b, objs);
  }

  /** Live details on the grand buildings (all hidden while under construction). */
  private flourishes(b: BuildingId, s: { x: number; y: number }): Phaser.GameObjects.GameObject[] {
    const pulse = (img: Phaser.GameObjects.Image, from: number, to: number, ms: number) =>
      this.tweens.add({ targets: img, alpha: { from, to }, duration: ms, yoyo: true, repeat: -1, ease: "sine.inout" });
    // Warm light in the windows.
    const tex = this.textures.get(SPOTS[b].texture).getSourceImage();
    const glows = (WINDOW_GLOWS[b] ?? []).map(([wx, wy], i) => {
      const g = this.add.image(Math.round(s.x - tex.width / 2 + wx), Math.round(s.y - tex.height + wy), "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0xffc070).setDepth(s.y + 1);
      pulse(g, 0.16, 0.3, 1800 + i * 230);
      return g;
    });
    const extra = this.flourish(b, s, pulse);
    return [...glows, ...extra];
  }

  private flourish(b: BuildingId, s: { x: number; y: number }, pulse: (img: Phaser.GameObjects.Image, from: number, to: number, ms: number) => void): Phaser.GameObjects.GameObject[] {
    if (b === "clock_tower") {
      const hands = this.add.graphics().setDepth(s.y + 0.6);
      this.clockHands = { g: hands, x: s.x, y: s.y - 96, drawn: "" };
      return [hands];
    }
    const town = store.progress.town;
    if (b === "town_hall" && town.stages.town_hall >= maxStage("town_hall")) {
      // the beacon on the dome's mast
      const beacon = this.add.image(s.x + 0.5, s.y - 136 + 22, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0xff5a4a).setDepth(s.y + 1);
      pulse(beacon, 0.15, 0.9, 900);
      return [beacon];
    }
    if (b === "market" && town.stages.market === 2) {
      return [12, 66].map((px) => {
        const g = this.add.image(s.x - 38 + px, s.y - 80 + 37, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0xffc070).setDepth(s.y + 1);
        pulse(g, 0.3, 0.6, 1500 + px * 7);
        return g;
      });
    }
    if (b === "rocket_pad") {
      // the beacon on top of the Mail Rocket's gantry
      const beacon = this.add.image(s.x - 13, s.y - 110, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0xff4a3a).setDepth(s.y + 1);
      pulse(beacon, 0.1, 0.9, 700);
      return [beacon];
    }
    const grand = this.grandTouches(b, s, pulse);
    if (b === "observatory") {
      const star = this.add.image(s.x + 44, s.y - 113, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0x6fe3e1).setDepth(s.y + 1);
      pulse(star, 0.15, 0.7, 1300);
      return [star, ...grand];
    }
    if (b === "radio_tower") {
      // the beacon on the mast, and the ON AIR lamp over the door
      const beacon = this.add.image(s.x, s.y - 130, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0xff4a3a).setDepth(s.y + 1);
      pulse(beacon, 0.1, 0.9, 800);
      const onAir = this.add.image(s.x, s.y - 34, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0xff6a5a).setDepth(s.y + 1);
      pulse(onAir, 0.15, 0.45, 1600);
      return [beacon, onAir, ...grand];
    }
    return grand;
  }

  /** A grand house: gold pennants flying from its roof, and a warm shimmer. */
  private grandTouches(b: BuildingId, s: { x: number; y: number }, pulse: (img: Phaser.GameObjects.Image, from: number, to: number, ms: number) => void): Phaser.GameObjects.GameObject[] {
    if (!moveInAt(b) || store.progress.plots[b]?.stage !== 2) return [];
    const tex = this.textures.get(SPOTS[b].texture).getSourceImage();
    const top = s.y - tex.height;
    const out: Phaser.GameObjects.GameObject[] = [];
    for (const dx of [-1, 1]) {
      const x = Math.round(s.x + dx * (tex.width / 2 - 6));
      out.push(this.add.image(x, top + 14, "grand_pennant").setOrigin(0.5, 1).setDepth(s.y + 1).setFlipX(dx < 0));
      const g = this.add.image(x, top + 6, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0xf5c542).setDepth(s.y + 1);
      pulse(g, 0.1, 0.45, 1400 + dx * 200);
      out.push(g);
    }
    return out;
  }

  private clockHands: { g: Phaser.GameObjects.Graphics; x: number; y: number; drawn: string } | null = null;
  private smokeT = 0;
  private smokeSide = false;

  /** The clock tower tells the real time; the farmhouse chimney smokes. */
  private updateFlourishes(dt: number) {
    const c = this.clockHands;
    if (c?.g.active) {
      const now = new Date();
      const key = `${now.getHours()}:${now.getMinutes()}`;
      if (key !== c.drawn) {
        c.drawn = key;
        const hand = (turns: number, len: number, color: number) => {
          const a = turns * Math.PI * 2 - Math.PI / 2;
          for (let i = 0; i <= len; i++) c.g.fillStyle(color, 1).fillRect(Math.round(c.x - 0.5 + Math.cos(a) * i), Math.round(c.y - 0.5 + Math.sin(a) * i), 1, 1);
        };
        c.g.clear();
        const hours = ((now.getHours() % 12) + now.getMinutes() / 60) / 12;
        hand(hours, 6, 0x3b2a3a);
        c.x += 1;
        hand(hours, 6, 0x3b2a3a);
        c.x -= 1;
        hand(now.getMinutes() / 60, 10, 0x3b2a3a);
        c.g.fillStyle(0xd9503f, 1).fillRect(Math.round(c.x - 1.5), Math.round(c.y - 1.5), 3, 3);
      }
    }
    this.smokeT -= dt;
    if (this.smokeT <= 0 && store.buildings.player_house && !this.constructing.has("player_house")) {
      this.smokeT = 0.7;
      const s = SPOTS.player_house;
      this.smokeSide = !this.smokeSide;
      if (this.distTo(s.x, s.y) < 460) puff(this, this.smokeSide ? s.x + 18 : s.x - 40, this.smokeSide ? s.y - 108 : s.y - 79);
    }
  }

  /**
   * Construction site: foundation, scaffolding and hammering little stars, with the
   * building revealed bottom-up in stages (cropped, never scaled). ~5 seconds.
   */
  private constructing = new Map<BuildingId, Array<() => void>>();

  private construct(b: BuildingId, img: Phaser.GameObjects.Image, extras: Phaser.GameObjects.GameObject[], onDone?: () => void) {
    this.constructing.set(b, []);
    const s = SPOTS[b];
    // Standing on the site (or behind it) when it goes up: you step out to the front, by the door.
    if (this.blocked(this.player.x, this.player.y)) {
      const door = this.doorOf(b);
      this.unstick({ x: door.x, y: s.y + 18 });
    }
    const w = img.width;
    const h = img.height;
    const left = Math.round(s.x - w / 2);
    const top = s.y - h;
    const hidden = extras as unknown as Phaser.GameObjects.Components.Visible[];
    hidden.forEach((o) => o.setVisible(false));
    img.setCrop(0, h, w, 0);

    const dust = (n: number) => {
      for (let i = 0; i < n; i++) this.time.delayedCall(i * 50, () => puff(this, s.x + Phaser.Math.Between(-w / 2, w / 2), s.y - Phaser.Math.Between(0, 6)));
    };
    dust(8);

    // Builder clods hop along the site, hammering.
    const crew = [0, 1, 2].map((i) => {
      const c = this.add.sprite(left + Math.round(((i + 1) * w) / 4), s.y + 2, "clod_0").setOrigin(0.5, 1).play("clod-twinkle").setDepth(s.y + 2);
      return c;
    });
    const hammer = this.time.addEvent({
      delay: 160,
      loop: true,
      callback: () => {
        const c = Phaser.Utils.Array.GetRandom(crew);
        c.y = s.y + 2 - (c.y === s.y + 2 ? 3 : 0);
        c.x = Phaser.Math.Clamp(c.x + Phaser.Math.Between(-3, 3), left + 4, left + w - 4);
        if (Math.random() < 0.5) sfxAt(s.x, s.y).hammer();
      },
    });

    const scaffold = this.add.graphics().setDepth(s.y + 1).setVisible(false);
    const drawScaffold = (upTo: number) => {
      scaffold.clear();
      const y0 = Math.max(top - 2, s.y - upTo - 4);
      for (const x of [left - 2, left + Math.round(w / 2) - 1, left + w]) {
        scaffold.fillStyle(0x4a2f27, 1).fillRect(x, y0, 3, s.y - y0);
        scaffold.fillStyle(0xc98f5a, 1).fillRect(x + 1, y0, 1, s.y - y0);
      }
      for (let y = s.y - 10; y >= y0; y -= 12) {
        scaffold.fillStyle(0x4a2f27, 1).fillRect(left - 3, y, w + 6, 3);
        scaffold.fillStyle(0xe2ad76, 1).fillRect(left - 2, y + 1, w + 4, 1);
      }
    };

    // Stage reveals: foundation, walls, upper floor, roof.
    const stages = [0.18, 0.45, 0.72, 1];
    stages.forEach((frac, i) => {
      this.time.delayedCall(700 + i * 950, () => {
        const shown = Math.round(h * frac);
        img.setCrop(0, h - shown, w, shown);
        if (i === 1) scaffold.setVisible(true);
        drawScaffold(shown);
        dust(4);
      });
    });

    this.time.delayedCall(700 + stages.length * 950 + 300, () => {
      hammer.remove();
      crew.forEach((c) => c.destroy());
      scaffold.destroy();
      img.setCrop();
      hidden.forEach((o) => o.setVisible(true));
      const burst = this.add.particles(s.x, s.y - h / 2, "spark", { speed: { min: 30, max: 90 }, lifespan: 600, quantity: 20, alpha: { start: 1, end: 0 }, emitting: false }).setDepth(99985);
      burst.explode(20);
      this.time.delayedCall(700, () => burst.destroy());
      sfxAt(s.x, s.y, 0.2).buy();
      this.layPath(b);
      onDone?.();
      const waiting = this.constructing.get(b) ?? [];
      this.constructing.delete(b);
      waiting.forEach((fn) => fn());
    });
  }

  private spawnVillager(v: VillagerId, walkIn: boolean) {
    if (this.villagers.has(v)) return;
    const home = this.homeSpot(v);
    const start = walkIn ? { x: LANDING.x, y: LANDING.y + 14 } : home;
    const a = new VillagerActor(this, v, start.x, start.y, (actor) =>
      openInfo(`${VILLAGER_NAMES[actor.id].toUpperCase()} IS THINKING...`, [actor.lastThought || "(nothing yet)"]),
    );
    a.router = (fx, fy, tx, ty) => this.route(fx, fy, tx, ty);
    const st = store.villagers[v];
    if (st?.thought) a.lastThought = st.thought;
    if (st?.status === "error") a.setAlert("smoke");
    this.villagers.set(v, a);
    if (walkIn) {
      a.enqueue(async () => {
        a.say("I'm moving in!", 1800);
        await a.walkTo(home.x, home.y);
      });
    }
  }

  private decoViews = new Map<string, { item: ShopItem; x: number; y: number; off: boolean; objs: Phaser.GameObjects.Components.Alpha[]; solid: Phaser.Geom.Rectangle | null }>();

  private spawnDeco(d: Deco) {
    const item = itemById(d.item);
    if (!item) return;
    const objs: Phaser.GameObjects.Components.Alpha[] = [];
    const depth = item.flat ? -6 : d.y;
    if (!item.flat) objs.push(this.add.image(d.x, d.y - 1, shadowKey(this, Math.max(10, Math.round(item.w * 0.7)))).setDepth(-8));
    const off = !!(item.light && d.off);
    const spr = this.add.sprite(d.x, d.y, off ? `deco_${item.id}_off` : item.texture).setOrigin(0.5, 1).setDepth(depth);
    if (item.anim && !off) spr.play({ key: item.anim, startFrame: Phaser.Math.Between(0, 1) });
    objs.push(spr);
    // Hover it to see who loves it, and whose yard it's brightening.
    spr.setInteractive();
    spr.on("pointerover", () => {
      if (this.arranging || this.windowOpen()) return;
      this.decoTip?.destroy();
      const fans = item.likes.map((v) => VILLAGER_SHORT[v]).join(" & ");
      const foot = decorFootprint(item, d.x, d.y);
      const home = (Object.keys(VILLAGER_HOME) as VillagerId[]).find((v) => store.buildings[VILLAGER_HOME[v]] && overlaps(yardOf(v), foot));
      const yard = home ? `\nIn ${VILLAGER_SHORT[home]}'s yard: +${item.likes.includes(home) ? LOVED_POINTS : 1} happiness` : "\nPut it by a home to make them happy";
      this.decoTip = new Label(this, d.x, d.y - item.h - 2, `${item.name}\n♥ ${fans} love${item.likes.length === 1 ? "s" : ""} this${yard}`, { maxWidth: 140, tail: true }).setDepth(99998);
    });
    spr.on("pointerout", () => {
      this.decoTip?.destroy();
      this.decoTip = null;
    });
    if (item.glow && !off) {
      const g = item.glow;
      objs.push(this.add.image(d.x + g.dx, d.y + g.dy, "glow").setBlendMode(Phaser.BlendModes.ADD).setAlpha(g.alpha).setTint(g.color).setDepth(depth - 1));
    }
    let solid: Phaser.Geom.Rectangle | null = null;
    if (!item.flat) {
      const r = decorFootprint(item, d.x, d.y);
      this.solids.push((solid = new Phaser.Geom.Rectangle(r.x, r.y, r.w, r.h)));
    }
    this.decoViews.set(d.id, { item, x: d.x, y: d.y, off, objs, solid });
  }

  private decoTip: Label | null = null;

  private removeDecoView(id: string) {
    const v = this.decoViews.get(id);
    if (!v) return;
    v.objs.forEach((o) => (o as unknown as Phaser.GameObjects.GameObject).destroy());
    this.solids = this.solids.filter((r) => r !== v.solid);
    this.decoViews.delete(id);
  }

  /** Stone lanterns from finished tasks, by lantern id. */
  private lanternViews = new Map<string, { x: number; y: number; objs: (Phaser.GameObjects.Image & Phaser.GameObjects.Components.Alpha)[] }>();

  private plantLantern(i: number, animate: boolean) {
    const l = store.lanterns[i];
    if (!l) return;
    this.lanternViews.get(l.id)?.objs.forEach((o) => o.destroy());
    const p = lanternAt(l, i);
    const shadow = this.add.image(p.x, p.y - 1, shadowKey(this, 12)).setDepth(-8);
    const img = this.add.image(p.x, p.y, "task_lantern").setOrigin(0.5, 1).setDepth(p.y);
    const glow = this.add.image(p.x, p.y - 14, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0xf5c542).setAlpha(0.45).setDepth(p.y - 1);
    this.lanternViews.set(l.id, { x: p.x, y: p.y, objs: [shadow, img, glow] });
    if (animate) {
      img.setAlpha(0);
      glow.setAlpha(0);
      this.tweens.add({ targets: img, alpha: 1, duration: 400 });
      this.tweens.add({ targets: glow, alpha: 0.45, duration: 600 });
    }
  }

  /** A little light floats up from finished work. */
  private riseLantern(x: number, y: number) {
    const l = this.add.image(x, y - 20, "spark").setDepth(99995);
    const g = this.add.image(x, y - 20, "glow").setBlendMode(Phaser.BlendModes.ADD).setTint(0xf5d07a).setAlpha(0.7).setDepth(99994);
    this.tweens.add({
      targets: [l, g],
      y: `-=${260}`,
      x: `+=${Phaser.Math.Between(-30, 30)}`,
      alpha: 0,
      duration: 4200,
      ease: "sine.in",
      onComplete: () => {
        l.destroy();
        g.destroy();
      },
    });
  }

  private flyItem(from: { x: number; y: number }, to: { x: number; y: number }, tex = "letter") {
    const img = this.add.image(from.x, from.y - 14, tex).setDepth(99990);
    this.tweens.add({
      targets: img,
      x: to.x,
      y: to.y - 14,
      duration: 450,
      ease: "quad.inout",
      onComplete: () => img.destroy(),
    });
  }

  // ================================================================ spots

  private doorOf(b: BuildingId) {
    const s = SPOTS[b];
    return { x: s.x + s.door.dx, y: s.y + s.door.dy };
  }

  private homeSpot(v: VillagerId) {
    const d = this.doorOf(VILLAGER_HOME[v]);
    return { x: d.x + 16, y: d.y + 2 };
  }

  private houseDoorFor(v: VillagerId) {
    const d = this.doorOf("player_house");
    const i = VILLAGERS.indexOf(v);
    return { x: d.x - 30 + i * 20, y: d.y + 8 + (i % 2) * 6 };
  }

  private clodSpot(b: BuildingId) {
    const d = this.doorOf(b);
    return { x: d.x + Phaser.Math.Between(-34, 34), y: d.y + Phaser.Math.Between(10, 30) };
  }

  // ================================================================ director
  // Server events → queued villager actions. The server never waits on us.

  private handshake(key: string): Deferred {
    const list = this.handshakes.get(key) ?? [];
    this.handshakes.set(key, list);
    const d = deferred();
    list.push(d);
    return d;
  }

  private takeHandshake(key: string): Deferred {
    const list = this.handshakes.get(key) ?? [];
    this.handshakes.set(key, list);
    return list.shift() ?? this.handshake(key);
  }

  private withTimeout(p: Promise<void>, ms: number) {
    return Promise.race([p, new Promise<void>((r) => this.time.delayedCall(ms, r))]);
  }

  private direct(e: SeqEvent) {
    const actor = (v: VillagerId) => this.villagers.get(v);

    switch (e.type) {
      case "paths":
        this.redrawPathTiles(Object.keys(e.set));
        break;

      case "task_start": {
        const a = actor(e.villager);
        a?.enqueue(async () => {
          a.say(e.from === "phone" ? "📱 A text from Earth! On it." : e.from === "chore" ? "Doing my rounds..." : "On it!", 1500);
          await a.wait(500);
        });
        break;
      }

      case "think": {
        const a = actor(e.villager);
        a?.enqueue(async () => {
          a.showThought(e.text);
          await a.wait(700);
        });
        break;
      }

      case "say": {
        const a = actor(e.villager);
        if (a && this.near.isWith(e.villager)) {
          a.hideThought();
          this.near.reply(e.villager, e.text);
          break;
        }
        a?.enqueue(async () => {
          a.hideThought();
          a.say(e.text, 4000);
          await a.wait(1400);
        });
        break;
      }

      case "handoff": {
        const from = actor(e.from);
        const to = actor(e.to);
        if (!from || !to) break;
        const key = `${e.from}>${e.to}`;
        const shake = this.handshake(key);
        if (e.to !== "jade_rabbit") {
          // Rabbit walks over and hands the neighbor a task.
          from.enqueue(async () => {
            from.hideThought();
            await from.walkTo(to.x - 18, to.y + 4);
            this.flyItem(from, to);
            from.say(`${VILLAGER_NAMES[e.to]}, could you take this?`, 1600);
            shake.resolve();
            await from.wait(700);
          });
          to.enqueue(async () => {
            await this.withTimeout(this.takeHandshake(key).promise, 9000);
            to.say("Leave it to me!", 1300);
            await to.wait(500);
          });
        } else {
          // Neighbor sends their report back to the Rabbit.
          from.enqueue(async () => {
            this.flyItem(from, to);
            from.say("Report's on its way!", 1300);
            shake.resolve();
            await from.wait(500);
            const home = this.homeSpot(e.from);
            await from.walkTo(home.x, home.y);
          });
          to.enqueue(async () => {
            await this.withTimeout(this.takeHandshake(key).promise, 9000);
            await to.wait(300);
          });
        }
        break;
      }

      case "tool_start": {
        const a = actor(e.villager);
        if (!a) break;
        const b = e.clod.building;
        a.enqueue(async () => {
          a.hideThought();
          const d = this.doorOf(b);
          await a.walkTo(d.x + (e.villager === "postmaster" ? -8 : 8), d.y + 4);
          const c = new ClodActor(this, e.clod, { x: a.x, y: a.y - 6 }, this.clodSpot(b));
          this.clods.set(e.clod.id, c);
          sfxAt(a.x, a.y).blip();
          await a.wait(650);
        });
        break;
      }

      case "tool_end": {
        const a = actor(e.villager);
        const run = async () => {
          const c = this.clods.get(e.clodId);
          if (c) {
            c.setStatus(e.ok ? "ready" : "failed");
            c.setLabel(e.ok ? e.result : `✗ ${e.result}`);
          }
          if (e.ok) (c ? sfxAt(c.x, c.y, 0.15) : sfx).coin();
          await a?.wait(350);
        };
        a ? a.enqueue(run) : void run();
        break;
      }

      case "approval_needed": {
        const a = actor(e.villager);
        a?.enqueue(async () => {
          this.clods.get(e.approval.clodId)?.setStatus("stuck");
          a.carryLetter(true);
          a.setAlert("bang");
          sfxAt(a.x, a.y, 0.35).message();
          a.say("I need your OK on this one!", 2200);
          const door = this.houseDoorFor(e.villager);
          await a.walkTo(door.x, door.y);
          a.say("Knock knock! A letter for you ✉", 3000);
        }, { urgent: true });
        break;
      }

      case "approval_resolved": {
        const a = actor(e.villager);
        a?.enqueue(async () => {
          a.setAlert("none");
          a.carryLetter(false);
          if (e.approved) this.flyItem(a, this.doorOf("player_house"));
          a.say(e.via === "phone" ? (e.approved ? "📱 You said yes from Earth!" : "📱 Holding it, per your text.") : e.approved ? "Thank you!" : "Understood — I'll hold it.", 2200);
          this.clods.get(e.clodId)?.setStatus("working");
          await a.wait(700);
          const c = this.clods.get(e.clodId);
          if (c) {
            const d = this.doorOf(c.clod.building);
            await a.walkTo(d.x - 10, d.y + 4);
          }
        });
        break;
      }

      case "building_error": {
        const a = actor(e.villager);
        const run = async () => {
          const s = SPOTS[e.building];
          for (let i = 0; i < 14; i++) this.time.delayedCall(i * 300, () => puff(this, s.x + Phaser.Math.Between(-12, 12), s.y - 30));
          a?.setAlert("smoke");
          a?.say(`The ${BUILDINGS[e.building].name} is closed! ${e.message.slice(0, 80)}`, 3500);
          sfxAt(s.x, s.y, 0.3).deny();
          await a?.wait(900);
        };
        a ? a.enqueue(run) : void run();
        break;
      }

      case "task_done": {
        const a = actor(e.villager);
        const index = store.lanterns.findIndex((l) => l.id === e.lantern.id);
        a?.enqueue(async () => {
          this.riseLantern(a.x, a.y);
          sfxAt(a.x, a.y, 0.15).buy();
          this.plantLantern(index >= 0 ? index : store.lanterns.length - 1, true);
          await a.wait(900);
          const home = this.homeSpot(e.villager);
          await a.walkTo(home.x, home.y);
        });
        break;
      }

      case "clod_popped": {
        const c = this.clods.get(e.clodId);
        if (c) {
          this.clods.delete(e.clodId);
          c.pop();
        }
        break;
      }

      case "building_built": {
        if (e.building === "post_office") this.placeBuilding("mailbox", true);
        // (a house made grand gets its pennants without scaffolding going up again)
        const grand = moveInAt(e.building) && store.progress.plots[e.building]?.stage === 2;
        this.placeBuilding(e.building, !grand);
        if (grand) {
          const move = moveInAt(e.building)!;
          const s = SPOTS[e.building];
          for (let i = 0; i < 10; i++) this.time.delayedCall(i * 60, () => puff(this, s.x + Phaser.Math.Between(-30, 30), s.y - Phaser.Math.Between(10, 60)));
          sfx.buy();
          this.game.events.emit("npc-toast", { who: VILLAGER_NAMES[move.villager], text: `A grand ${BUILDINGS[e.building].name}! ${move.perk[0].toUpperCase()}${move.perk.slice(1)}.` });
        }
        break;
      }

      case "plot": {
        const move = moveInAt(e.building);
        if (!move) break;
        if (!e.plot.placed) {
          // Just bought: pick a spot for it right away.
          this.cancelHeld();
          this.pickUp({ kind: "plot", b: e.building });
          sfx.buy();
        }
        break;
      }

      case "villager_arrived": {
        if (this.villagers.has(e.villager)) break;
        // Ada works in the Office, not out on the island: just a hello.
        if (IN_OFFICE(e.villager)) {
          this.game.events.emit("npc-toast", { who: VILLAGER_NAMES[e.villager], text: "Hi! I'm Ada, the Team Lead. I've set up in the Office to keep an eye on your coding agents. Find me there, or text me on your MoonPad." });
          break;
        }
        // Nobody moves into a house that's still under scaffolding.
        const pending = this.constructing.get(VILLAGER_HOME[e.villager]);
        if (pending) {
          pending.push(() => this.direct(e));
          break;
        }
        this.spawnVillager(e.villager, true);
        sfx.buy();
        // A new neighbor: hello, a housewarming thank-you, and a word about the next lot.
        const arrived = actor(e.villager);
        if (e.hello && arrived) arrived.enqueue(async () => {
          await arrived.wait(1800);
          arrived.say(e.hello!, 7000);
          if (e.gift) {
            this.floatText(arrived.x, arrived.y - 40, `Housewarming gift! +${e.gift}¢`, 0xf5c542, 2400);
            this.coinFly(arrived.x, arrived.y - 20, e.gift);
          }
          await arrived.wait(2000);
        });
        this.refreshNeedSign(VILLAGER_HOME[e.villager]);
        const next = e.next ? moveInFor(e.next) : null;
        if (next)
          this.time.delayedCall(11000, () => this.game.events.emit("npc-toast", { who: VILLAGER_NAMES[next.teaser.by], text: next.teaser.text }));
        // Moved in: their account comes next (or sample data), once the hello's done.
        this.time.delayedCall(9500, () => {
          if (!this.needsConnect(e.villager) || this.windowOpen() || isMoonPadOpen() || this.arranging || !this.sys.isActive()) return;
          openConnect(e.villager);
        });
        const rabbit = actor("jade_rabbit");
        if (e.rabbitTeamwork && e.villager !== "jade_rabbit" && e.residents.filter((r) => r !== "jade_rabbit").length === 2) {
          rabbit?.enqueue(async () => {
            rabbit.say("Two neighbors! Now I can coordinate - give me jobs that need a team.", 5000);
            await rabbit.wait(800);
          });
        }
        break;
      }

      case "plot_revealed":
        this.placeBuilding(e.building, true);
        // Hoot says what the Mail Rocket (his Post Office's upgrade) is for, after his hello.
        if (e.building === "rocket_pad")
          this.time.delayedCall(8500, () =>
            this.game.events.emit("npc-toast", {
              who: VILLAGER_NAMES.postmaster,
              text: "Hoo! I'd love a Mail Rocket on the side of my Post Office. Build it (press E at its plot: a few materials) and I can send your replies to Earth. I'll bring each one to your door for your OK first.",
            }),
          );
        // Ada suggests the Workshop: her friend Tinker would move in, for your GitHub.
        if (e.building === "workshop")
          this.time.delayedCall(8500, () =>
            this.game.events.emit("npc-toast", {
              who: VILLAGER_NAMES.manager,
              text: "There's room for a Workshop on the Office's west wall. Build it (E at its plot: a few materials) and my friend Tinker moves in: pull requests, issues, CI, the works. Your agents code, Tinker keeps GitHub tidy.",
            }),
          );
        break;

      case "chore_spawned": {
        this.choreViews.set(e.chore.id, new ChoreView(this, e.chore, (x, y, r) => this.distTo(x, y) < r));
        const star = actor("stargazer");
        if (e.chore.kind === "meteor" && star?.isFree && Math.random() < 0.35) star.say("Incoming meteor! Watch the sky!", 2500);
        break;
      }

      case "chore_cleared": {
        const cv = this.choreViews.get(e.id);
        if (cv) this.coinFly(cv.x, cv.y - 6, e.reward);
        this.choreViews.get(e.id)?.destroy("collect");
        this.choreViews.delete(e.id);
        break;
      }

      case "chore_gone":
        this.choreViews.get(e.id)?.destroy("fade");
        this.choreViews.delete(e.id);
        break;

      case "progress": {
        // Plots' signs redraw (what building them takes), and pickups float up.
        for (const m of MOVE_INS_HOMES()) if (onMap(m, store.progress, store.buildings) && !store.buildings[m] && !this.constructing.has(m)) this.placeBuilding(m, false);
        this.townChanged();
        if (e.gained) {
          const at = e.at ?? { x: this.player.x, y: this.player.y };
          const text = (Object.entries(e.gained) as [Material, number][]).filter(([, n]) => n).map(([m, n]) => `+${n} ${MATERIAL_NAME[m]}`).join("  ");
          if (text) this.floatText(at.x, at.y - 34, text, 0xc8e8ff, 1600);
        }
        break;
      }

      case "item_found": {
        const item = ITEMS[e.item];
        const needFor = LANDMARK_IDS.find((id) => LANDMARKS[id].up.some((u) => u.item === e.item));
        const text = `${e.text ? `${e.text} ` : ""}Got the ${item.name}: "${item.line}"${needFor ? ` (for the grand ${LANDMARKS[needFor].name})` : ""}`;
        this.game.events.emit("npc-toast", { who: e.by ? VILLAGER_NAMES[e.by] : item.name, text });
        if (e.x !== undefined && e.y !== undefined) {
          this.floatText(e.x, e.y - 30, item.name, 0xfff0a0, 2200);
          const burst = this.add.particles(e.x, e.y - 8, "spark", { speed: { min: 40, max: 110 }, lifespan: 600, quantity: 16, alpha: { start: 1, end: 0 }, tint: 0xfff0a0, emitting: false }).setDepth(99985);
          burst.explode(16);
          this.time.delayedCall(700, () => burst.destroy());
        }
        sfx.bell();
        break;
      }

      case "deco_placed":
        this.spawnDeco(e.deco);
        break;
      case "building_moved":
        this.restartInPlace();
        break;
      case "deco_moved": {
        const v = this.decoViews.get(e.id);
        if (!v) break;
        this.removeDecoView(e.id);
        this.spawnDeco(store.decos.find((d) => d.id === e.id) ?? { id: e.id, item: v.item.id, x: e.x, y: e.y });
        break;
      }
      case "happiness": {
        // Decorations placed by their home: the villager notices.
        if (!e.gained || !store.residents.includes(e.villager)) break;
        const a = this.villagers.get(e.villager);
        const d = this.doorOf(VILLAGER_HOME[e.villager]);
        this.floatText(d.x, d.y - 30, `+${e.gained.loved ? LOVED_POINTS : 1} ♥`, 0xff8fb1, 1400);
        if (a && !a.isHeld) a.say(e.gained.loved ? `A ${e.gained.item}! I love it! ♥` : `Ooh, a ${e.gained.item} by my home. Thank you!`, 3200);
        break;
      }
      case "rock_cleared":
        this.rockGone(e.x, e.y, e.stone, e.loot);
        break;
      case "rock_grown": {
        // It pushes up out of the dust (and nudges you aside if you're standing there).
        const avoid = store.decos.flatMap((d) => {
          const item = itemById(d.item);
          return item ? [decorFootprint(item, d.x, d.y)] : [];
        });
        const r = rockSpots(avoid, store.clearedRocks).find((x) => x.x === e.x && x.y === e.y);
        if (!r || this.rockViews.has(rockKey(r))) break;
        this.rocks.push(r);
        this.rockSent.delete(rockKey(r));
        this.addRock(r);
        for (let i = 0; i < 8; i++) this.time.delayedCall(i * 50, () => puff(this, r.x + Phaser.Math.Between(-10, 10), r.y - Phaser.Math.Between(0, 8)));
        if (this.blocked(this.player.x, this.player.y)) this.unstick();
        break;
      }
      case "shard_found": {
        const key = `${e.x},${e.y}`;
        const s = this.shards.get(key);
        if (!s) break;
        s.objs.forEach((o) => o.destroy());
        this.shards.delete(key);
        const burst = this.add.particles(e.x, e.y - 8, "spark", { speed: { min: 30, max: 100 }, lifespan: 600, quantity: 16, alpha: { start: 1, end: 0 }, tint: 0x8ff0f0, emitting: false }).setDepth(99985);
        burst.explode(16);
        this.time.delayedCall(700, () => burst.destroy());
        this.floatText(e.x, e.y - 22, `Moon Shard ${e.found}/${e.total}! +${e.reward}¢`, 0x8ff0f0, 1800);
        this.coinFly(e.x, e.y - 8, e.reward + (e.bonus ?? 0));
        sfx.bell();
        // What they're for, told by Nova the first time (and a nudge halfway).
        const teller = store.residents.includes("stargazer") ? "stargazer" : "jade_rabbit";
        const shardLine =
          e.found === 1
            ? `Ooh, a Moon Shard! It's a rare building material: ${shardUses()} all need some, so hang on to them!`
            : e.found === Math.floor(e.total / 2)
              ? `${e.found} of ${e.total} Moon Shards! Halfway to relighting the beacon. Spending them on buildings doesn't count against you: it's the finding that counts.`
              : null;
        if (shardLine) this.game.events.emit("npc-toast", { who: VILLAGER_NAMES[teller], text: shardLine });
        if (e.found === 1)
          this.time.delayedCall(4500, () => this.game.events.emit("npc-toast", { who: VILLAGER_NAMES[teller], text: `There are ${e.total} hidden in the wilds, ${e.reward}¢ each, and finding all ${e.total} relights the old colony's beacon (+200¢)!` }));
        break;
      }
      case "lantern_moved": {
        const i = store.lanterns.findIndex((l) => l.id === e.id);
        if (i >= 0) this.plantLantern(i, false);
        break;
      }
      case "deco_toggled": {
        const d = store.decos.find((d) => d.id === e.id);
        if (!d || !this.decoViews.has(e.id)) break;
        this.removeDecoView(e.id);
        this.spawnDeco(d);
        sfx.blip();
        break;
      }
      case "deco_sold": {
        const v = this.decoViews.get(e.id);
        if (!v) break;
        this.removeDecoView(e.id);
        puff(this, v.x, v.y - 4);
        this.floatText(v.x, v.y - 20, `+${e.refund}¢`, 0xf5c542);
        break;
      }
    }
  }

  // ================================================================ input

  private setupInput() {
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys("W,A,S,D,E,B,SPACE") as Record<string, Phaser.Input.Keyboard.Key>;

    // One rule everywhere: E or SPACE does whatever's closest (talk, call, build,
    // pop, grab, switch a light...), and holding either sweeps.
    const interact = () => {
      if (this.windowOpen() || this.arranging) return;
      this.eTarget()?.act();
    };
    kb.on("keydown-E", interact);
    kb.on("keydown-SPACE", interact);
    kb.on("keydown-B", () => {
      if (!this.panelOpen && !this.near.typing && !visiting() && shopOpen(store.progress.town)) this.game.events.emit("toggle-shop");
    });

    // Talking happens right where you stand: E next to a neighbor opens the chat,
    // and you speak (the mic comes on) or type. Their answers are bubbles overhead.
    this.near = new NearTalk({
      scene: this,
      player: () => this.player,
      actor: (v) => this.villagers.get(v),
      nearest: () => (inTutorial() ? null : this.talkable()),
      around: (r) =>
        inTutorial() ? [] :
        [...this.villagers.entries()]
          .map(([v, a]) => [v, this.distTo(a.x, a.y - 8)] as const)
          .filter(([v, d]) => d < r && !pendingApprovalFor(v) && !this.needsConnect(v))
          .sort((x, y) => x[1] - y[1])
          .map(([v]) => v),
      hold: (v) => this.holdForTalk(v),
      release: () => this.releaseTalk(),
      blocked: () => this.panelOpen || isPanelOpen() || !!this.registry.get("shopOpen") || this.arranging || isMoonPadOpen(),
      greeting: (v) => this.greeting(v),
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => (this.near.destroy(), clearListener()));
    this.events.on(Phaser.Scenes.Events.SLEEP, () => clearListener());

    kb.on("keydown-ESC", () => {
      if (this.painting) this.setPainting(null);
      else if (this.held) this.cancelHeld();
      else if (this.editMode) this.setEditMode(false);
    });

    onPanelToggle((open) => {
      this.panelOpen = open;
      if (!open) this.releaseTalk();
      if (open) kb.disableGlobalCapture();
      else kb.enableGlobalCapture();
    });

    this.input.mouse?.disableContextMenu();
    // Drag and drop, or click to pick up and click again to set down.
    const overUI = (p: Phaser.Input.Pointer) => this.scene.get("UI").input.hitTestPointer(p).length > 0;
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.pressedAt = null;
      if (this.painting) {
        if (this.panelOpen || overUI(p)) return;
        this.paintDown = p.rightButtonDown() || this.painting === "erase" ? "erase" : "paint";
        this.paintAt(p);
        return;
      }
      if (!this.arranging || this.panelOpen || overUI(p)) return;
      if (p.rightButtonDown()) return this.cancelHeld();
      if (this.held) return this.dropHeld();
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      const m = this.movableAt(wp.x, wp.y);
      if (!m) return;
      this.pickUp(m.held, { x: m.base.x - wp.x, y: m.base.y - wp.y });
      this.pressedAt = { x: p.x, y: p.y };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.painting && this.paintDown && p.isDown) this.paintAt(p);
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this.paintDown) {
        this.paintDown = null;
        this.flushStroke();
      }
      const from = this.pressedAt;
      this.pressedAt = null;
      // A plain click keeps it in hand (SELL / CANCEL); letting go after a drag sets it down.
      if (!from || !this.held || overUI(p)) return;
      if (Math.hypot(p.x - from.x, p.y - from.y) > 6) this.dropHeld();
    });
  }

  private nearestChore(kind: "dust" | "meteor", r: number): ChoreView | null {
    let best: ChoreView | null = null;
    let bestD = r;
    for (const c of this.choreViews.values()) {
      if (c.chore.kind !== kind || (kind === "meteor" && !c.grabbable)) continue;
      const d = this.distTo(c.x, c.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private tryGrabMeteor() {
    const m = this.nearestChore("meteor", 24);
    // (not down yet by the server's clock: the server would say no, so no coins or pickup here either)
    if (!m || (m.chore.landsAt ?? 0) > net.serverNow() || !net.send({ type: "clear_chore", id: m.chore.id })) return;
    this.choreViews.delete(m.chore.id);
    m.destroy("collect");
    sfx.coin();
    this.floatText(m.x, m.y - 14, `+${m.chore.reward}¢ moon-rock`, 0xf5c542);
  }

  /** Hold E (or SPACE) by a drift to sweep it; a little bar fills up. */
  private updateSweep(dt: number) {
    this.sweepBar.clear();
    const d = this.panelOpen || this.arranging ? null : this.nearestChore("dust", 22);
    if (!d || this.windowOpen() || !(this.keys.E.isDown || this.keys.SPACE.isDown || this.uiHold)) {
      this.sweepT = 0;
      return;
    }
    this.sweepT += dt;
    this.sweepSfxT -= dt;
    if (this.sweepSfxT <= 0) {
      this.sweepSfxT = 0.14;
      sfx.sweep();
      puff(this, d.x + Phaser.Math.Between(-6, 6), d.y);
    }
    const frac = Math.min(1, this.sweepT / 0.8);
    const bx = Math.round(this.player.x - 10);
    const by = Math.round(this.player.y + 3);
    this.sweepBar.fillStyle(0x3b2a3a, 1).fillRect(bx, by, 20, 4);
    this.sweepBar.fillStyle(0x6fe3e1, 1).fillRect(bx + 1, by + 1, Math.round(18 * frac), 2);
    if (frac < 1) return;
    this.sweepT = 0;
    if (!net.send({ type: "clear_chore", id: d.chore.id })) return;
    this.choreViews.delete(d.chore.id);
    d.destroy("sweep");
    sfx.coin();
    this.floatText(d.x, d.y - 14, `+${d.chore.reward}¢`, 0xf5c542);
  }

  private nearestPoppable(): ClodActor | null {
    let best: ClodActor | null = null;
    let bestD = 30;
    for (const c of this.clods.values()) {
      if (c.status !== "ready" && c.status !== "failed") continue;
      const d = this.distTo(c.x, c.y - 6);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private tryPop(): boolean {
    const best = this.nearestPoppable();
    if (!best) return false;
    if (!net.send({ type: "pop", clodId: best.clod.id })) return false;
    const c = best;
    this.clods.delete(c.clod.id);
    sfx.catch();
    const reward = c.status === "ready" ? c.clod.reward : 1;
    this.floatText(c.x, c.y - 16, `+${reward}¢`, 0xf5c542);
    this.coinFly(c.x, c.y - 8, reward);
    if (c.clod.result) this.floatText(c.x, c.y - 28, c.clod.result.slice(0, 40), 0xffd9c8, 1800);
    c.pop();
    return true;
  }

  private findTarget(): Interactable | null {
    const dist = (x: number, y: number) => this.distTo(x, y);
    const options: Interactable[] = [];
    // (in the tutorial, only the tutorial's own things: Nova's lot, boulders, meteors, moondust)
    const guest = visiting();
    const add = (o: Interactable, r: number) => o.d < r && (!inTutorial() || o.tut) && (!guest || VISITOR_VERBS.has(o.verb)) && options.push(o);

    for (const [v, a] of this.villagers) {
      const letter = pendingApprovalFor(v);
      const d = dist(a.x, a.y - 8);
      if (letter) add({ verb: "READ LETTER", label: "[E] read letter", x: a.x, y: a.y + 27, d, villager: v, act: () => (this.holdForTalk(v), openLetter(letter)) }, 36);
      // Just moved in and their account isn't connected yet: that comes first.
      else if (this.needsConnect(v)) add({ verb: "TALK", label: `[E] talk to ${VILLAGER_SHORT[v]}`, x: a.x, y: a.y + 27, d, villager: v, act: () => openConnect(v) }, 34);
      else add({ verb: "TALK", label: `[E] talk to ${VILLAGER_SHORT[v]}`, x: a.x, y: a.y + 27, d, villager: v, act: () => this.near.start(v) }, 34);
    }
    for (const v of VILLAGERS) {
      const home = VILLAGER_HOME[v];
      if (!store.buildings[home]) continue;
      if (!store.residents.includes(v)) {
        // Built, but they haven't moved in: what's still missing (the yard, usually).
        const move = moveInFor(v);
        const door = this.doorOf(home);
        if (move) add({ verb: "CHECK", label: `[E] what ${VILLAGER_SHORT[v]} needs`, x: door.x, y: door.y + 18, d: dist(door.x, door.y), act: () => this.showPlot(move) }, 44);
        continue;
      }
      // Not home? Ring the doorbell and they'll walk back.
      const bell = this.bells.get(v);
      const a = this.villagers.get(v);
      if (!bell || !a) continue;
      const home_ = this.homeSpot(v);
      if (Phaser.Math.Distance.Between(a.x, a.y, home_.x, home_.y) < 48) continue;
      const door = this.doorOf(home);
      add({ verb: "CALL", label: `[E] call ${VILLAGER_NAMES[v]}`, x: door.x, y: door.y + 18, d: Math.min(dist(door.x, door.y), dist(bell.x, bell.y - 6)), act: () => this.ringBell(v), atDoor: true }, 44);
    }
    // The town's landmarks: the Town Hall's board, the Market, the Fountain. Gathering and digging.
    const th = this.doorOf("town_hall");
    // (in the tutorial the Town Hall shows just what's next: its own repair, then the homes to pick from)
    const town = (spec: { kind: "board"; tab?: "homes" } | { kind: "landmark"; id: LandmarkId }) => () =>
      this.game.events.emit("town-panel", spec.kind === "board" && inTutorial() ? (store.progress.town.stages.town_hall === 0 ? { kind: "landmark", id: "town_hall" } : { kind: "board", tab: "homes" }) : spec);
    add({ verb: "BOARD", label: "[E] the Town Hall", x: th.x, y: th.y + 16, d: dist(th.x, th.y), act: town({ kind: "board" }), tut: true }, 40);
    const mk = this.doorOf("market");
    add({ verb: "CHECK", label: "[E] the Market", x: mk.x, y: mk.y + 14, d: dist(mk.x, mk.y), act: town({ kind: "landmark", id: "market" }), tut: true }, 36);
    const fd = Math.max(0, dist(PLAZA.x, PLAZA.y) - 66);
    add({ verb: "CHECK", label: "[E] the Fountain", x: PLAZA.x, y: PLAZA.y - 66, d: fd + 6, act: town({ kind: "landmark", id: "fountain" }), tut: true }, 26);
    for (const t of this.town.targets(this.player.x, this.player.y)) add(t, 40);
    // The rocket: off to a friend's island (online), or home again.
    if (net.auth.state === "in" && !net.auth.guest) {
      add({ verb: "ROCKET", label: guest ? "[E] the rocket: fly home" : "[E] the rocket: visit a friend", x: LANDING.x, y: LANDING.y - 46, d: dist(LANDING.x, LANDING.y - 10), act: () => this.game.events.emit("friends-panel", { kind: "travel" }), tut: true }, 34);
    }
    // Visiting: leave your friend something on their doorstep.
    if (guest) {
      const hd = this.doorOf("player_house");
      add({ verb: "GIFT", label: `[E] leave ${hostName()} a gift`, x: hd.x, y: hd.y - 50, d: dist(hd.x, hd.y), act: () => this.game.events.emit("friends-panel", { kind: "gift" }) }, 40);
    }
    // (a friend may look inside the Office only if its owner said so)
    if (store.buildings.office && (!guest || perms().office)) {
      const od = this.doorOf("office");
      add({ verb: "ENTER", label: "[E] enter the Office", x: od.x, y: od.y - 40, d: dist(od.x, od.y - 4), act: () => this.enterOffice() }, 30);
    }
    const houseDoor = this.doorOf("player_house");
    if (store.approvals.length) {
      add({ verb: "READ LETTER", label: `[E] ${store.approvals.length} letter(s)`, x: houseDoor.x, y: houseDoor.y - 50, d: dist(houseDoor.x, houseDoor.y), act: () => openLetter(store.approvals[0]) }, 40);
    }
    for (const b of BUILDING_IDS) {
      const move = moveInAt(b);
      const s = SPOTS[b];
      const def = BUILDINGS[b];
      // A neighbor's house: make it grand (by the door, behind talking to them).
      if (move && store.buildings[b]) {
        if (store.progress.plots[b]?.stage === 1) {
          const d = this.doorOf(b);
          add({ verb: "UPGRADE", label: `[E] ${VILLAGER_SHORT[move.villager]}'s house`, x: d.x, y: d.y + 18, d: dist(d.x, d.y) + 14, act: () => this.showPlot(move) }, 40);
        }
        continue;
      }
      if (store.buildings[b] || !onMap(b, store.progress, store.buildings) || b === "mailbox") continue;
      // An extension's plot (the Mail Rocket, the Workshop): its card, with what it takes.
      if (EXTENSIONS[b]) {
        add({ verb: "BUILD", label: `[E] build the ${def.name}`, x: s.x, y: s.y - 36, d: dist(s.x, s.y), act: () => this.game.events.emit("town-panel", { kind: "extension", b }) }, 46);
        continue;
      }
      // A neighbor's plot you've set down: build their house on it.
      if (move) {
        add({ verb: "BUILD", label: `[E] build ${VILLAGER_SHORT[move.villager]}'s ${def.name}`, x: s.x, y: s.y - 36, d: dist(s.x, s.y), act: () => this.showPlot(move), tut: true }, 46);
        continue;
      }
      add(
        {
          verb: "BUILD",
          label: "[E] build",
          x: s.x,
          y: s.y - 36,
          d: dist(s.x, s.y),
          act: () =>
            openInfo(`BUILD: ${def.name.toUpperCase()}`, [`Unlocks: ${def.unlocks}.`, def.price ? `Cost: ${def.price}¢ (you have ${store.coins}¢).${store.coins < def.price ? " Earn coins: pop stars after your neighbors finish work, sweep moondust, grab meteor rocks, and do today's requests." : ""}` : "Free: a gift from the colony."], [
              {
                label: store.coins >= def.price ? (def.price ? `BUILD (${def.price}¢)` : "BUILD") : "NOT ENOUGH COINS",
                kind: store.coins >= def.price ? "ok" : "",
                onClick: () => {
                  if (store.coins >= def.price) net.send({ type: "build", building: b });
                  else sfx.deny();
                  closePanel();
                },
              },
            ]),
        },
        46,
      );
    }
    // Lights you've placed switch on and off (moving and selling is in edit mode).
    for (const [id, v] of this.decoViews) {
      if (!v.item.light) continue;
      const r = Math.max(16, v.item.w / 2 + 4);
      add({ verb: v.off ? "TURN ON" : "TURN OFF", label: `[E] turn ${v.off ? "on" : "off"}`, x: v.x, y: v.y - v.item.h - 2, d: dist(v.x, v.y - 4) + 6, act: () => net.send({ type: "toggle_deco", id }) }, r + 6);
    }
    // Rocks you could clear.
    for (const r of this.rocks) {
      const w = ROCK_TILES[r.kind] * TILE;
      add({ verb: "CLEAR", label: `[E] clear ${ROCK_NAME[r.kind].toLowerCase()} (+${ROCK_STONE[r.kind]} moonstone)`, x: r.x, y: r.y - 30, d: dist(r.x, r.y - 6) + 8, act: () => this.clearRockNow(r), tut: true }, Math.max(20, w / 2 + 10));
    }
    // Things you stand on: prompts float above the player's head.
    const head = this.player.y - 30;
    const clod = this.nearestPoppable();
    if (clod) add({ verb: "POP", label: "[E] pop star", x: clod.x, y: head, d: dist(clod.x, clod.y - 6), act: () => this.tryPop() }, 30);
    const rock = this.nearestChore("meteor", 24);
    if (rock) add({ verb: "GRAB", label: "[E] grab moon-rock", x: rock.x, y: head, d: dist(rock.x, rock.y), act: () => this.tryGrabMeteor(), tut: true }, 24);
    const drift = this.nearestChore("dust", 22);
    if (drift) add({ verb: "SWEEP", label: "[hold E] sweep", x: drift.x, y: head, d: dist(drift.x, drift.y), act: () => {}, hold: true, tut: true }, 22);
    options.sort((a, b) => a.d - b.d);
    this.doorCall = options.find((o) => o.atDoor) ?? null;
    return options.find((o) => !o.atDoor) ?? null;
  }

  private talkingWith: VillagerId | null = null;
  private near!: NearTalk;
  private typingCapture = false;

  /** The neighbor close enough to just talk to (moved in, connected, no letter waiting). */
  private talkable(): VillagerId | null {
    let best: VillagerId | null = null;
    let bestD = 34;
    // (someone wandering past doesn't steal the conversation)
    const partner = this.near?.partner;
    const pa = partner ? this.villagers.get(partner) : undefined;
    if (partner && pa && this.distTo(pa.x, pa.y - 8) < 60) return partner;
    for (const [v, a] of this.villagers) {
      const d = this.distTo(a.x, a.y - 8);
      if (d < bestD && !pendingApprovalFor(v) && !this.needsConnect(v)) {
        best = v;
        bestD = d;
      }
    }
    return best;
  }

  /** The villager you're talking to stands still, faces you, and holds any work until you're done. */
  private holdForTalk(v: VillagerId) {
    this.releaseTalk();
    const a = this.villagers.get(v);
    if (!a) return;
    this.talkingWith = v;
    a.hold(true);
    a.face(this.player.x);
    const dx = a.x - this.player.x;
    const dy = a.y - this.player.y;
    this.facing = Math.abs(dx) > Math.abs(dy) ? "side" : dy < 0 ? "up" : "down";
    this.player.setFlipX(this.facing === "side" && dx < 0);
    this.player.anims.stop();
    this.player.setTexture({ down: "astro_0", up: "astro_3", side: "astro_6" }[this.facing]);
  }

  private releaseTalk() {
    if (this.talkingWith) this.villagers.get(this.talkingWith)?.hold(false);
    this.talkingWith = null;
  }

  /** E does whichever is closer: the regular action or a door CALL. */
  private eTarget(): Interactable | null {
    return this.target && (!this.doorCall || this.target.d <= this.doorCall.d) ? this.target : this.doorCall;
  }

  /** Ring a villager's doorbell: if they're just out and about, they walk home and wait. */
  private ringBell(v: VillagerId) {
    const bell = this.bells.get(v);
    const a = this.villagers.get(v);
    if (!bell || !a) return;
    sfxAt(bell.x, bell.y).bell();
    for (let i = 0; i < 6; i++) this.time.delayedCall(i * 110, () => bell.img.setTexture(`bell_${(i + 1) % 2}`));
    if (a.working) {
      const doing = store.villagers[v]?.activity ?? "working";
      this.floatText(bell.x, bell.y - 24, `${VILLAGER_NAMES[v]} is busy: ${doing}`, 0xffd9c8, 2400);
      return;
    }
    const home = this.homeSpot(v);
    this.idleCooldown.set(v, 25);
    a.enqueue(async () => {
      a.say("Coming!", 1400);
      await a.walkTo(home.x, home.y);
      a.face(this.player.x);
      a.say("You rang?", 2200);
    });
  }



  /** The Rabbit doubles as the guide: she knows what the next neighbor's lot needs. */
  private greeting(v: VillagerId): string {
    // On a friend's island: a welcome, and whether they can help you (with your own accounts).
    if (visiting()) {
      const hi = v === "jade_rabbit" ? `Welcome to ${hostName()}'s island! I'm Yutu, the mayor around here.` : GREETINGS[v];
      return mayAsk(v) ? `${hi} ${hostName()} says I can help you too: with your own accounts, just looking things up.` : hi;
    }
    if (v !== "jade_rabbit") return GREETINGS[v];
    const n = nextStep(this.moveState());
    if (!n) return GREETINGS.jade_rabbit;
    const goal = `Mayor's note: ${n.text.replace(/\.$/, "")}.`;
    return store.rabbitTeamwork ? `${GREETINGS.jade_rabbit} ${goal}` : `Welcome, exile! I'm the guide around here. ${goal}`;
  }

  // ================================================================ arranging
  // The pencil (edit mode) lets you pick up any building, plot or decoration and
  // set it down somewhere else on the tile grid. Buying from the Shop and
  // MOVE on a decoration use the same pick-up / set-down flow.

  private editMode = false;
  /** Painting paths (Shop → PATHS): the style, or the eraser. */
  private painting: PathStyle | "erase" | null = null;
  /** The button down right now: laying path, or taking it up. */
  private paintDown: "paint" | "erase" | null = null;
  /** Tiles changed in this stroke, not yet sent. */
  private stroke = new Map<string, PathStyle | null>();
  private strokeSentAt = 0;
  private held: Held | null = null;
  private grabOffset = { x: 0, y: 8 };
  private gridG!: Phaser.GameObjects.Graphics;
  private footG!: Phaser.GameObjects.Graphics;
  private gridKey = "";
  private resumeAt: { x: number; y: number } | null = null;
  private restartOnWake = false;

  /** Step through the Office doors into the interior scene. */
  private enterOffice() {
    if (!store.buildings.office) return;
    this.near.hush();
    sfx.blip();
    this.game.events.emit("action", null);
    this.cameras.main.fadeOut(220, 11, 10, 26);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.sleep();
      this.scene.run("Office");
    });
  }
  /** Where the pointer went down to pick something up (screen px), to tell a drag from a click. */
  private pressedAt: { x: number; y: number } | null = null;

  private get arranging() {
    return this.editMode || this.held !== null || this.painting !== null;
  }

  /** Start (or stop, with null) painting paths. */
  private setPainting(p: PathStyle | "erase" | null) {
    if (p && visiting()) return;
    this.flushStroke();
    if (p) {
      this.editMode = false;
      this.cancelHeld();
      closePanel();
    }
    this.painting = p;
    this.paintDown = null;
    this.emitArrange();
  }

  /** Paint (or erase) the tile under the pointer, right away on screen; the server gets it in batches. */
  private paintAt(p: Phaser.Input.Pointer) {
    if (!this.painting || !this.paintDown) return;
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    const tx = Math.floor(wp.x / TILE);
    const ty = Math.floor(wp.y / TILE);
    if (!pathTileOk(tx, ty, store.buildings)) return;
    const key = pathKey(tx, ty);
    const style = this.paintDown === "erase" || this.painting === "erase" ? null : this.painting;
    if ((store.paths[key] ?? null) === style) return;
    if (style) store.paths[key] = style;
    else delete store.paths[key];
    this.stroke.set(key, style);
    this.redrawPathTiles([key]);
    if (this.stroke.size >= 60) this.flushStroke();
  }

  /** Send the stroke so far (one message per style). */
  private flushStroke() {
    if (!this.stroke.size) return;
    const by = new Map<PathStyle | null, [number, number][]>();
    for (const [key, style] of this.stroke) {
      const { tx, ty } = fromKey(key);
      if (!by.has(style)) by.set(style, []);
      by.get(style)!.push([tx, ty]);
    }
    this.stroke.clear();
    this.strokeSentAt = this.time.now;
    for (const [style, tiles] of by) net.send({ type: "paint_paths", style, tiles });
  }

  private restartInPlace() {
    if (this.player?.active) this.resumeAt = { x: this.player.x, y: this.player.y };
    this.scene.restart();
  }

  private setEditMode(on: boolean) {
    if (on === this.editMode || (on && visiting())) return;
    if (on && this.painting) this.setPainting(null);
    this.editMode = on;
    if (on) {
      closePanel();
      closeMoonPad();
    } else this.cancelHeld();
    sfx.blip();
    this.emitArrange();
  }

  private emitArrange() {
    const h = this.held;
    const p = this.painting;
    this.game.events.emit("arrange", {
      paint: p ? { name: p === "erase" ? "eraser" : pathDef(p)!.name, price: p === "erase" ? 0 : pathDef(p)!.price, erase: p === "erase" } : null,
      edit: this.editMode,
      holding: h ? { name: this.heldName(h), isNew: h.kind === "new", refund: h.kind === "deco" ? sellPrice(h.item) : null } : null,
    });
  }

  private heldName(h: Held) {
    if (h.kind === "lantern") {
      const l = store.lanterns.find((l) => l.id === h.id);
      return l ? `${VILLAGER_NAMES[l.villager]}'s lantern` : "lantern";
    }
    if (h.kind === "plot") return `${VILLAGER_SHORT[moveInAt(h.b)!.villager]}'s plot`;
    return h.kind === "building" ? BUILDINGS[h.b].name : h.item.name;
  }

  private heldTiles(h: Held): { w: number; h: number; apron: number } {
    if (h.kind === "building" || h.kind === "plot") return { ...buildingTiles(h.b), apron: isAnnex(h.b) ? 0 : 1 };
    if (h.kind === "lantern") return { w: 1, h: 1, apron: 0 };
    return { w: h.item.tiles[0], h: h.item.tiles[1], apron: 0 };
  }

  /** Every tile the held thing would claim at (x, y). */
  private heldRects(h: Held, x: number, y: number): Rect[] {
    if (h.kind === "building" || h.kind === "plot") return buildingRects(h.b, { x, y });
    const t = this.heldTiles(h);
    return [footprint(x, y, t.w, t.h, t.apron)];
  }

  /** Buildings you can see: built ones, and plots waiting to be built. */
  private isShown(b: BuildingId) {
    return onMap(b, store.progress, store.buildings);
  }

  /** Footprints of everything placed, except what you're holding. */
  private occupied(h: Held | null): Rect[] {
    const out: Rect[] = [];
    for (const b of BUILDING_IDS) if (this.isShown(b) && !((h?.kind === "building" || h?.kind === "plot") && h.b === b)) out.push(...buildingRects(b));
    for (const [id, v] of this.decoViews) if (!(h?.kind === "deco" && h.id === id)) out.push(decorFootprint(v.item, v.x, v.y));
    for (const [id, v] of this.lanternViews) if (!(h?.kind === "lantern" && h.id === id)) out.push(footprint(v.x, v.y, 1, 1));
    for (const r of this.rocks) out.push(rockRect(r));
    // unfound shards keep their tile (the server refuses placements there too)
    for (const s of this.shards.values()) out.push(footprint(s.x, s.y, 1, 1));
    return out;
  }

  private dropSpot(h: Held) {
    const p = this.input.activePointer;
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    return snapToTiles(wp.x + this.grabOffset.x, wp.y + this.grabOffset.y, this.heldTiles(h).w);
  }

  /** Its tiles are free and on the island, and it wouldn't land on top of you. */
  private canDrop(h: Held, x: number, y: number) {
    const t = this.heldTiles(h);
    if (!canOccupy(this.heldRects(h, x, y), this.occupied(h))) return false;
    const solid =
      h.kind === "building" || h.kind === "plot"
        ? { x: x - SPOTS[h.b].fw, y: y - SPOTS[h.b].fh, w: SPOTS[h.b].fw * 2, h: SPOTS[h.b].fh }
        : h.kind === "lantern" || h.item.flat
          ? null
          : footprint(x, y, t.w, t.h);
    const px = this.player.x;
    const py = this.player.y;
    return !solid || !(px > solid.x && px < solid.x + solid.w && py > solid.y && py < solid.y + solid.h);
  }

  /** The front-most building, plot or decoration under a world point. */
  private movableAt(wx: number, wy: number): { held: Held; base: { x: number; y: number } } | null {
    let best: { held: Held; base: { x: number; y: number } } | null = null;
    let bestY = -Infinity;
    const hit = (x: number, y: number, w: number, h: number) => wx >= x - w / 2 && wx < x + w / 2 && wy >= y - h && wy < y + 4;
    // (the outlined tiles count too: the footprint, and the row in front of a door)
    const onTiles = (rects: Rect[]) => rects.some((r) => wx >= r.x && wx < r.x + r.w && wy >= r.y && wy < r.y + r.h);
    for (const b of BUILDING_IDS) {
      // (the Mail Rocket is part of the Post Office: move the Post Office and it comes along)
      if (!this.isShown(b) || this.constructing.has(b) || b === "rocket_pad") continue;
      const s = SPOTS[b];
      const tex = this.textures.get(store.buildings[b] ? s.texture : `plot_${b}`).getSourceImage();
      const h = tex.height;
      if ((hit(s.x, s.y, tex.width, h) || onTiles(buildingRects(b))) && s.y > bestY) {
        bestY = s.y;
        best = { held: { kind: "building", b }, base: { x: s.x, y: s.y } };
      }
    }
    for (const [id, v] of this.decoViews) {
      if ((hit(v.x, v.y, v.item.w, v.item.h) || onTiles([decorFootprint(v.item, v.x, v.y)])) && v.y >= bestY) {
        bestY = v.y;
        best = { held: { kind: "deco", id, item: v.item }, base: { x: v.x, y: v.y } };
      }
    }
    for (const [id, v] of this.lanternViews) {
      if (hit(v.x, v.y, 16, 26) && v.y >= bestY) {
        bestY = v.y;
        best = { held: { kind: "lantern", id }, base: { x: v.x, y: v.y } };
      }
    }
    return best;
  }

  private fadeOriginal(h: Held, alpha: number) {
    if (h.kind === "building" || h.kind === "plot") this.buildingObjs.get(h.b)?.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(alpha));
    else if (h.kind === "deco") this.decoViews.get(h.id)?.objs.forEach((o) => o.setAlpha(alpha));
    else if (h.kind === "lantern") this.lanternViews.get(h.id)?.objs.forEach((o, i) => o.setAlpha(i === 2 ? alpha * 0.45 : alpha));
  }

  private pickUp(h: Held, grab = { x: 0, y: 8 }) {
    if (visiting()) return;
    this.cancelHeld();
    this.held = h;
    this.grabOffset = grab;
    this.fadeOriginal(h, 0.35);
    const key = h.kind === "plot" ? `plot_${h.b}` : h.kind === "building" ? (store.buildings[h.b] ? SPOTS[h.b].texture : `plot_${h.b}`) : h.kind === "lantern" ? "task_lantern" : h.item.texture;
    this.ghost = this.add.image(this.player.x, this.player.y, key).setOrigin(0.5, 1).setAlpha(0.8).setDepth(99998);
    sfx.blip();
    this.emitArrange();
  }

  private cancelHeld() {
    if (this.held) this.fadeOriginal(this.held, 1);
    this.held = null;
    this.ghost?.destroy();
    this.ghost = null;
    this.footG?.clear();
    this.emitArrange();
  }

  private dropHeld() {
    const h = this.held;
    if (!h) return;
    const { x, y } = this.dropSpot(h);
    if (!this.canDrop(h, x, y)) {
      sfx.deny();
      return;
    }
    const sent =
      h.kind === "new"
        ? net.send({ type: "place_deco", item: h.item.id, x, y })
        : h.kind === "deco"
          ? net.send({ type: "move_deco", id: h.id, x, y })
          : h.kind === "lantern"
            ? net.send({ type: "move_lantern", id: h.id, x, y })
            : h.kind === "plot"
              ? net.send({ type: "place_plot", building: h.b, x, y })
              : net.send({ type: "move_building", building: h.b, x, y });
    if (!sent) {
      sfx.deny();
      return;
    }
    sfx.place();
    if (h.kind === "new") this.floatText(x, y - 20, `-${h.item.price}¢`, 0xff9a7a);
    this.cancelHeld();
  }

  private drawFoot(r: Rect, color: number) {
    const g = this.footG;
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    g.fillStyle(color, 0.3).fillRect(x, y, r.w, r.h);
    g.fillStyle(color, 0.9).fillRect(x, y, r.w, 1).fillRect(x, y + r.h - 1, r.w, 1).fillRect(x, y, 1, r.h).fillRect(x + r.w - 1, y, 1, r.h);
    for (let tx = x + TILE; tx < x + r.w; tx += TILE) g.fillStyle(color, 0.45).fillRect(tx, y + 1, 1, r.h - 2);
    for (let ty = y + TILE; ty < y + r.h; ty += TILE) g.fillStyle(color, 0.45).fillRect(x + 1, ty, r.w - 2, 1);
  }

  /** Faint tile lines over the island while arranging (only the part on screen). */
  private drawGrid() {
    const v = this.cameras.main.worldView;
    const key = `${Math.floor(v.x / TILE)},${Math.floor(v.y / TILE)},${Math.ceil(v.width / TILE)},${Math.ceil(v.height / TILE)}`;
    if (key === this.gridKey) return;
    this.gridKey = key;
    const g = this.gridG.clear();
    g.fillStyle(0xffffff, 0.13);
    for (let ty = Math.floor(v.y / TILE); ty <= Math.ceil((v.y + v.height) / TILE); ty++) {
      for (let tx = Math.floor(v.x / TILE); tx <= Math.ceil((v.x + v.width) / TILE); tx++) {
        if (!inIsland(tx + 0.5, ty + 0.5)) continue;
        g.fillRect(tx * TILE, ty * TILE, TILE, 1).fillRect(tx * TILE, ty * TILE, 1, TILE);
      }
    }
  }

  /**
   * Holding a decoration: outline the villagers' yards and say whose happiness
   * it would change if set down here.
   */
  private showYards(h: Extract<Held, { kind: "new" | "deco" }>, x: number, y: number) {
    const now = store.decos;
    const then = [...now.filter((d) => h.kind !== "deco" || d.id !== h.id), { item: h.item.id, x, y }];
    const lines: string[] = [];
    for (const v of store.residents) {
      const yard = yardOf(v);
      this.footG.fillStyle(0xf5c542, 0.05).fillRect(yard.x, yard.y, yard.w, yard.h);
      this.footG.fillStyle(0xf5c542, 0.5).fillRect(yard.x, yard.y, yard.w, 1).fillRect(yard.x, yard.y + yard.h - 1, yard.w, 1).fillRect(yard.x, yard.y, 1, yard.h).fillRect(yard.x + yard.w - 1, yard.y, 1, yard.h);
      const delta = happinessFor(v, then).score - happinessFor(v, now).score;
      if (delta > 0) lines.push(`+${delta} ♥ ${VILLAGER_NAMES[v]}${h.item.likes.includes(v) ? " loves it!" : ""}`);
      else if (delta < 0) lines.push(`${delta} ♥ ${VILLAGER_NAMES[v]}`);
    }
    const text = lines.join("\n");
    this.prompt.setVisible(!!text);
    if (!text) return;
    if (text !== this.promptText) this.prompt.setText((this.promptText = text));
    this.prompt.place(x, y - h.item.h - 4);
  }

  private cursor = "default";

  /**
   * The cursor over the island when not over a button. Only set on change:
   * setting it every frame would stomp on buttons' pointer cursors.
   */
  private setCursor(c: string) {
    if (c === this.cursor) return;
    this.cursor = c;
    this.input.setDefaultCursor(c);
  }

  private updateArrange() {
    const on = this.arranging && !this.panelOpen;
    this.gridG.setVisible(on);
    this.footG.clear();
    if (!on) return this.setCursor("default");
    this.drawGrid();
    if (this.painting) {
      // (a long drag goes out in pieces, so it lands while you're still painting)
      if (this.paintDown && this.stroke.size && this.time.now - this.strokeSentAt > 250) this.flushStroke();
      const p = this.input.activePointer;
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      const tx = Math.floor(wp.x / TILE);
      const ty = Math.floor(wp.y / TILE);
      const ok = pathTileOk(tx, ty, store.buildings);
      this.setCursor(ok ? "crosshair" : "not-allowed");
      this.drawFoot({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE }, !ok ? 0xff5a5a : this.painting === "erase" || this.paintDown === "erase" ? 0xffb070 : 0x7cf08c);
      return;
    }
    if (this.held && this.ghost) {
      this.setCursor("grabbing");
      const h = this.held;
      const { x, y } = this.dropSpot(h);
      const ok = this.canDrop(h, x, y);
      // Tiles that are already taken, including things you can't move (lamps, the plaza, the ship).
      for (const r of [...RESERVED, ...this.occupied(h)]) this.footG.fillStyle(0xff5a5a, 0.18).fillRect(Math.round(r.x), Math.round(r.y), r.w, r.h);
      for (const r of this.heldRects(h, x, y)) this.drawFoot(r, ok ? 0x7cf08c : 0xff5a5a);
      if (h.kind === "new" || h.kind === "deco") this.showYards(h, x, y);
      this.ghost.setPosition(x, y).setTint(ok ? 0xffffff : 0xff9a9a);
      return;
    }
    // Edit mode, empty-handed: outline whatever's under the cursor.
    const p = this.input.activePointer;
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    const m = this.movableAt(wp.x, wp.y);
    this.setCursor(m ? "grab" : "default");
    if (!m) return;
    const rects = this.heldRects(m.held, m.base.x, m.base.y);
    for (const r of rects) this.drawFoot(r, 0xf5c542);
    const r = rects[0];
    this.prompt.setVisible(true);
    const label = `${this.heldName(m.held)} - click to move`;
    if (label !== this.promptText) this.prompt.setText((this.promptText = label));
    this.prompt.place(m.base.x, Math.round(r.y) - 2);
  }

  // ================================================================ getting around
  // Neighbors walk around buildings, rocks, lamps and the fountain, not through
  // them: a grid of the tiles their feet can't go on (kept a moment, since the
  // island rarely changes), a shortest way across it (A*, never cutting a
  // corner), then straightened into as few stretches as still stay clear.

  private navGrid: { at: number; blocked: Uint8Array } | null = null;

  private navBlocked(): Uint8Array {
    if (this.navGrid && this.time.now - this.navGrid.at < 1500) return this.navGrid.blocked;
    const cols = WORLD_W / TILE;
    const rows = WORLD_H / TILE;
    const blocked = new Uint8Array(cols * rows);
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) if (!onGround(tx * TILE + TILE / 2, ty * TILE + TILE / 2 + 4)) blocked[ty * cols + tx] = 1;
    for (const r of this.solids) {
      for (let ty = Math.max(0, Math.floor(r.y / TILE)); ty <= Math.min(rows - 1, Math.floor((r.y + r.height - 1) / TILE)); ty++)
        for (let tx = Math.max(0, Math.floor(r.x / TILE)); tx <= Math.min(cols - 1, Math.floor((r.x + r.width - 1) / TILE)); tx++) blocked[ty * cols + tx] = 1;
    }
    this.navGrid = { at: this.time.now, blocked };
    return blocked;
  }

  /** The points to walk through from one spot to another, or null if there's no way. */
  private route(fx: number, fy: number, tx: number, ty: number): { x: number; y: number }[] | null {
    const cols = WORLD_W / TILE;
    const rows = WORLD_H / TILE;
    const blocked = this.navBlocked();
    const tileOf = (x: number, y: number) => Math.max(0, Math.min(rows - 1, Math.floor(y / TILE))) * cols + Math.max(0, Math.min(cols - 1, Math.floor(x / TILE)));
    const start = tileOf(fx, fy);
    const goal = tileOf(tx, ty);
    // (where you're standing and where you're going always count as open, even right by a wall)
    const open = (i: number) => i === start || i === goal || !blocked[i];
    const clear = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
      for (let k = 1; k < n; k++) if (!open(tileOf(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n))) return false;
      return true;
    };
    const to = { x: tx, y: ty };
    if (clear({ x: fx, y: fy }, to)) return [to];
    // A* over the tiles, eight ways, with a little heap
    const g = new Float32Array(cols * rows).fill(Infinity);
    const came = new Int32Array(cols * rows).fill(-1);
    const closed = new Uint8Array(cols * rows);
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => {
      heap.push([f, i]);
      for (let c = heap.length - 1; c > 0; ) {
        const p = (c - 1) >> 1;
        if (heap[p][0] <= heap[c][0]) break;
        [heap[p], heap[c]] = [heap[c], heap[p]];
        c = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let c = 0; ; ) {
          const l = c * 2 + 1;
          const r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top[1];
    };
    const gx = goal % cols;
    const gy = Math.floor(goal / cols);
    const h = (i: number) => {
      const dx = Math.abs((i % cols) - gx);
      const dy = Math.abs(Math.floor(i / cols) - gy);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    g[start] = 0;
    push(h(start), start);
    while (heap.length) {
      const i = pop();
      if (i === goal) break;
      if (closed[i]) continue;
      closed[i] = 1;
      const x = i % cols;
      const y = Math.floor(i / cols);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (!open(j) || closed[j]) continue;
          // (no squeezing diagonally between two blocked tiles)
          if (dx && dy && (!open(y * cols + nx) || !open(ny * cols + x))) continue;
          const cost = g[i] + (dx && dy ? 1.414 : 1);
          if (cost >= g[j]) continue;
          g[j] = cost;
          came[j] = i;
          push(cost + h(j), j);
        }
    }
    if (came[goal] === -1) return null;
    const tiles: number[] = [];
    for (let i = goal; i !== start; i = came[i]) tiles.push(i);
    const pts = [{ x: fx, y: fy }, ...tiles.reverse().slice(0, -1).map((i) => ({ x: (i % cols) * TILE + TILE / 2, y: Math.floor(i / cols) * TILE + TILE / 2 })), to];
    // straighten: from each point, go as far along as stays clear
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < pts.length - 1; ) {
      let j = pts.length - 1;
      while (j > i + 1 && !clear(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  // ================================================================ helpers

  /** Is anything solid under your feet here? (Your feet are a few pixels wide, not a point.) */
  private blocked(x: number, y: number) {
    return this.solids.some((r) => r.contains(x, y) || r.contains(x - 5, y) || r.contains(x + 5, y));
  }

  /** Move to the nearest spot you can actually stand on (straight down, in front, first). */
  private unstick(prefer?: { x: number; y: number }) {
    const free = (x: number, y: number) => onGround(x, y) && !this.blocked(x, y) && !this.blocked(x, y - 6);
    const go = (x: number, y: number) => {
      for (let i = 0; i < 5; i++) this.time.delayedCall(i * 40, () => puff(this, x + Phaser.Math.Between(-6, 6), y - Phaser.Math.Between(0, 4)));
      this.player.setPosition(Math.round(x), Math.round(y));
      this.playerShadow.setPosition(Math.round(x), Math.round(y) - 1);
    };
    if (prefer && free(prefer.x, prefer.y)) return go(prefer.x, prefer.y);
    const { x, y } = this.player;
    const dirs = [[0, 1], [1, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7], [0, -1], [0.7, -0.7], [-0.7, -0.7]];
    for (let r = 6; r <= 240; r += 6) for (const [dx, dy] of dirs) if (free(x + dx * r, y + dy * r)) return go(x + dx * r, y + dy * r);
    go(LANDING.x + 34, LANDING.y + 26); // (can't happen, but never leave you stuck)
  }

  private distTo(x: number, y: number) {
    return Phaser.Math.Distance.Between(this.player.x, this.player.y - 8, x, y);
  }

  private floatText(x: number, y: number, str: string, color: number, ms = 900) {
    const t = new Label(this, x, y, str, { bg: C.outline, border: null, color, font: "pxb", originY: 0.5, padX: 2 }).setDepth(99999);
    this.tweens.add({ targets: t, y: y - 22, alpha: 0, duration: ms, ease: "sine.out", onComplete: () => t.destroy() });
  }

  /** For the minimap. */
  minimapDots() {
    const meteors = [...this.choreViews.values()].filter((c) => c.falling || c.grabbable).map((c) => ({ x: c.x, y: c.y, incoming: c.falling }));
    return {
      meteors,
      player: { x: this.player.x, y: this.player.y },
      villagers: [...this.villagers.values()].map((a) => ({ id: a.id, x: a.x, y: a.y })),
      clods: [...this.clods.values()].map((c) => ({ x: c.x, y: c.y, status: c.status })),
      // (other players on the island, online)
      peers: [...this.peerViews.values()].map((p) => ({ x: p.x, y: p.y, tint: p.sprite.tintTopLeft })),
    };
  }

  // ================================================================ idle life
  // Villagers with nothing to do stroll, visit and gossip. Purely client-side;
  // any real work cancels it instantly.

  private idleCooldown = new Map<VillagerId, number>();
  private chatting = new Set<VillagerId>();

  private ambient(dt: number) {
    for (const [v, a] of this.villagers) {
      // Walk up to someone and they stop to say hi instead of wandering off.
      if (this.target?.villager === v && !a.working) {
        a.stopStrolling();
        continue;
      }
      if (!a.isFree || this.chatting.has(v)) continue;
      const cd = (this.idleCooldown.get(v) ?? Phaser.Math.FloatBetween(1, 4)) - dt;
      this.idleCooldown.set(v, cd);
      if (cd > 0) continue;
      this.idleCooldown.set(v, Phaser.Math.FloatBetween(5, 11));
      // Standing near you, they stay put, but do their own little thing now and then.
      if (this.distTo(a.x, a.y - 8) < 48) {
        if (Math.random() < 0.5) void a.fidget();
        continue;
      }
      // Now and then, a fidget instead of a walk.
      if (Math.random() < 0.3) {
        void a.fidget();
        this.idleCooldown.set(v, Phaser.Math.FloatBetween(3, 7));
        continue;
      }
      const partners = [...this.villagers.values()].filter((b) => b.id !== v && b.isFree && !this.chatting.has(b.id));
      // Mostly in town: a visit, a turn around the fountain, a stroll down Main
      // Street, a potter in the front yard; now and then a wander a bit further out.
      const roll = Math.random();
      const home = this.homeSpot(v);
      if (roll < 0.3 && partners.length) void this.visit(a, Phaser.Utils.Array.GetRandom(partners));
      else if (roll < 0.45) {
        const t = Math.random() * Math.PI * 2;
        const r = Phaser.Math.Between(72, PLAZA_R - 12);
        void this.strollTo(a, PLAZA.x + Math.cos(t) * r, PLAZA.y + 10 + Math.sin(t) * r * 0.8);
      } else if (roll < 0.72) void this.strollTo(a, Phaser.Math.Between(STREET.x0 + 60, STREET.x1 - 60), STREET.y + Phaser.Math.Between(-10, 12));
      else if (roll < 0.92) {
        void this.strollTo(a, home.x + Phaser.Math.Between(-44, 44), home.y + Phaser.Math.Between(2, 34)).then((ok) => {
          if (ok && Math.random() < 0.25) a.say(mutter(v), 2400);
        });
      } else void this.strollTo(a, home.x + Phaser.Math.Between(-130, 130), home.y + Phaser.Math.Between(-40, 90));
    }
  }

  private strollTo(a: VillagerActor, x: number, y: number): Promise<boolean> {
    if (!onGround(x, y) || this.blocked(x, y) || this.blocked(x, y - 6)) return Promise.resolve(false);
    return a.stroll(x, y);
  }

  private async visit(a: VillagerActor, b: VillagerActor) {
    this.chatting.add(a.id);
    this.chatting.add(b.id);
    try {
      const side = b.x > a.x ? -18 : 18;
      const arrived = await this.strollTo(a, b.x + side, b.y + 2);
      if (!arrived || !a.isFree || !b.isFree) return;
      a.face(b.x);
      b.face(a.x);
      for (const [who, line] of conversation(a.id, b.id)) {
        if (!a.isFree || !b.isFree) return;
        (who === a.id ? a : b).say(line, 2600);
        await new Promise((r) => this.time.delayedCall(2700, r));
      }
    } finally {
      this.chatting.delete(a.id);
      this.chatting.delete(b.id);
    }
  }

  // ================================================================ loop

  update(time: number, delta: number) {
    const dt = delta / 1000;
    this.updatePlayer(dt);
    this.ambient(dt);
    // (meteors land on the server's clock)
    const now = net.serverNow();
    for (const c of this.choreViews.values()) c.update(now);
    this.updateSweep(dt);
    // Moondust dims the solar lamps it settles near.
    // (collected once per frame into a reused array, not re-spread per lamp)
    const dust = this.dustScratch;
    dust.length = 0;
    for (const c of this.choreViews.values()) if (c.chore.kind === "dust") dust.push(c);
    // (lamps stay dark until the roads are fixed, and shine brighter when they're grand)
    const bright = [0, 1, 1.4][store.progress.town.stages.roads];
    for (const l of this.lamps) {
      let dusty = false;
      for (const c of dust) if (Math.hypot(c.x - l.x, c.y - l.y) < 40) { dusty = true; break; }
      l.glow.setAlpha(bright * (dusty ? 0.08 : 0.3 + 0.06 * Math.sin(time / 700 + l.x)));
    }
    for (const a of this.villagers.values()) a.update(time);
    // Only the clod you're standing nearest shows its label — no pile-ups.
    let nearest: ClodActor | null = null;
    let nearestD = 60;
    for (const c of this.clods.values()) {
      c.update(time, dt);
      c.showLabel(false);
      const d = this.distTo(c.x, c.y);
      if (d < nearestD) {
        nearestD = d;
        nearest = c;
      }
    }
    nearest?.showLabel(true);
    this.player.setDepth(this.player.y);
    for (const p of this.peerViews.values()) p.update(dt);
    this.selfBubble?.place(Math.round(this.player.x), Math.round(this.player.y) - 42);
    this.sendPos(time);
    setListener(this.player.x, this.player.y); // (sounds in the colony are heard from where you stand)
    this.playerShadow.setPosition(Math.round(this.player.x), Math.round(this.player.y) - 1);

    this.target = this.flying || this.panelOpen || this.arranging || this.near.typing ? null : this.findTarget();
    if (this.panelOpen || this.arranging) this.doorCall = null;
    this.callBtn.setVisible(!!this.doorCall);
    if (this.doorCall) this.callBtn.setPosition(Math.round(this.doorCall.x - 18), Math.round(this.doorCall.y));
    // The toolbar's action button does exactly what E would (including CALL at a door).
    const e = this.eTarget();
    const action = e ? `${e.verb}|${e.hold ? 1 : 0}` : "";
    if (action !== this.lastAction) {
      this.lastAction = action;
      this.game.events.emit("action", e ? { verb: e.verb, hold: !!e.hold } : null);
    }
    this.prompt.setVisible(!!e);
    if (e) {
      if (e.label !== this.promptText) this.prompt.setText((this.promptText = e.label));
      // A door CALL's prompt sits just above its button.
      this.prompt.place(e.x, e.atDoor ? e.y - 1 : e.y);
    }

    this.near.update();
    // While you type (to a neighbor, a chat line, a friend code), keys go to your words (not to walking or the toolbar).
    const typing = this.near.typing || !!this.registry.get("keysFree");
    if (typing !== this.typingCapture) {
      this.typingCapture = typing;
      if (this.typingCapture) this.input.keyboard!.disableGlobalCapture();
      else if (!this.panelOpen) this.input.keyboard!.enableGlobalCapture();
    }
    this.updateArrange();
    this.updateFlourishes(dt);
    this.updateLabels();
    if (!this.arranging && !this.panelOpen) {
      this.pickUpShards();
      this.greetings();
    }
  }

  private moveTime = 0;
  /** What you do while standing still (breathe, look around, doze off). */
  private idle!: PlayerIdle;
  private dustT = 0;
  private greeted = new Map<VillagerId, number>();

  /** Villagers say hi (by name) when you pass by. */
  private greetings() {
    const now = this.time.now;
    for (const [v, a] of this.villagers) {
      if (!a.isFree || this.chatting.has(v) || this.near.isWith(v) || now - (this.greeted.get(v) ?? -1e9) < 45_000) continue;
      if (Math.hypot(this.player.x - a.x, this.player.y - a.y) > 40) continue;
      this.greeted.set(v, now);
      a.face(this.player.x);
      const lines = HELLOS[v];
      a.say(lines[Math.floor(Math.random() * lines.length)], 2400);
    }
  }

  // ================================================================ other players (online)

  /** Everyone else on this island: draw them, keep them moving, and show what they say. */
  private watchPeers() {
    const tintSelf = () => {
      const t = mp.session?.you.tint ?? 0xffffff;
      if (t === 0xffffff) this.player.clearTint();
      else this.player.setTint(t);
    };
    tintSelf();
    const mine = () => mp.session?.you.id;
    const put = (p: Peer) => {
      // (you, or you in another tab: not a second player)
      if (p.id === mine() || isMe(p.id)) return;
      const v = this.peerViews.get(p.id);
      if (v) v.apply(p);
      else this.peerViews.set(p.id, new PeerActor(this, p));
    };
    for (const p of mp.peers.values()) put(p);
    this.unsubs.push(onSession(tintSelf));
    this.unsubs.push(
      onPeers((c) => {
        if (c.kind === "all") {
          for (const [id, v] of this.peerViews) if (!mp.peers.has(id)) (v.destroy(), this.peerViews.delete(id));
          for (const p of mp.peers.values()) put(p);
        } else if (c.kind === "move") put(c.peer);
        else if (c.kind === "left") {
          this.peerViews.get(c.id)?.destroy();
          this.peerViews.delete(c.id);
        } else if (c.kind === "chat") {
          sfx.blip();
          if (c.id === mine()) this.sayOverMe(c.text);
          else this.peerViews.get(c.id)?.say(c.text);
        }
      }),
    );
    // Say where we are right away (and again after a restart).
    this.posSent = { x: 0, y: 0, f: "", moving: false, at: 0 };
  }

  /** Your own chat line, over your head (everyone else sees it over you too). */
  private sayOverMe(text: string) {
    this.selfBubble?.destroy();
    const b = new Label(this, this.player.x, this.player.y - 42, text, { maxWidth: 130, tail: true }).setDepth(99990);
    this.selfBubble = b;
    this.time.delayedCall(Math.max(3500, text.length * 60), () => {
      b.destroy();
      if (this.selfBubble === b) this.selfBubble = null;
    });
  }

  /** Where you are, for everyone else on the island (a few times a second while you move). */
  private sendPos(time: number) {
    if (!net.HOSTED || !mp.session) return;
    const last = this.posSent;
    const moving = this.player.anims.isPlaying;
    const f = `${this.facing}${this.player.flipX ? 1 : 0}`;
    const x = Math.round(this.player.x);
    const y = Math.round(this.player.y);
    const changed = Math.abs(x - last.x) + Math.abs(y - last.y) > 1 || f !== last.f || moving !== last.moving;
    if (!changed || time - last.at < 100) return;
    if (net.send({ type: "pos", x, y, facing: this.facing, flip: this.player.flipX, moving })) this.posSent = { x, y, f, moving, at: time };
  }

  /** The rocket lifts off (then the page flies you to the other island). */
  liftOff(go: () => void) {
    if (this.flying) return;
    this.flying = true;
    this.near.hush();
    this.prompt.setVisible(false);
    this.game.events.emit("action", null);
    sfx.whoosh();
    this.tweens.add({ targets: this.ship, y: this.ship.y - 260, duration: 1400, ease: "quad.in" });
    for (let i = 0; i < 10; i++) this.time.delayedCall(i * 90, () => puff(this, this.ship.x + Phaser.Math.Between(-6, 6), LANDING.y - 2));
    this.player.setVisible(false);
    this.playerShadow.setVisible(false);
    this.time.delayedCall(700, () => this.cameras.main.fadeOut(700, 11, 10, 26));
    this.time.delayedCall(1450, go);
  }

  /** A dialog, the MoonPad or the shop is up: keys belong to it. */
  private windowOpen() {
    return this.flying || this.panelOpen || isPanelOpen() || !!this.registry.get("shopOpen") || !!this.registry.get("townOpen") || !!this.registry.get("friendsOpen") || !!this.registry.get("chatTyping") || !!this.near?.typing;
  }

  private updatePlayer(dt: number) {
    // Something solid appeared where you're standing (a house going up, a decoration,
    // a building moved in edit mode): step out instead of being stuck inside it.
    if (!this.arranging && this.blocked(this.player.x, this.player.y)) this.unstick();
    if (this.startPos && Math.hypot(this.player.x - this.startPos.x, this.player.y - this.startPos.y) > 40) {
      this.startPos = null;
      this.game.events.emit("player-moved");
    }
    if (this.windowOpen()) {
      this.player.anims.stop();
      this.idle.reset();
      return;
    }
    const left = this.cursors.left.isDown || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    const up = this.cursors.up.isDown || this.keys.W.isDown;
    const down = this.cursors.down.isDown || this.keys.S.isDown;

    let dx = (right ? 1 : 0) - (left ? 1 : 0);
    let dy = (down ? 1 : 0) - (up ? 1 : 0);
    if (dx === 0 && dy === 0) {
      this.player.anims.stop();
      this.player.setTexture({ down: "astro_0", up: "astro_3", side: "astro_6" }[this.facing]);
      this.moveTime = 0;
      // (talking with someone, or busy placing things: no fidgeting)
      if (this.talkingWith || this.near.partner || this.arranging) this.idle.reset();
      else this.idle.update(dt, this.facing);
      return;
    }
    this.idle.reset();
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    // Walk, then break into a run after a moment (kicking up moondust).
    this.moveTime += dt;
    const run = Math.min(1, Math.max(0, (this.moveTime - 0.35) / 0.5));
    const speed = 125 + run * 60;
    this.player.anims.timeScale = 1 + run * 0.6;
    this.dustT -= dt;
    if (run >= 1 && this.dustT <= 0) {
      this.dustT = 0.16;
      puff(this, this.player.x - dx * 6, this.player.y - 1);
    }
    const nx = this.player.x + dx * speed * dt;
    const ny = this.player.y + dy * speed * dt;
    if (onGround(nx, this.player.y) && !this.blocked(nx, this.player.y)) this.player.x = nx;
    if (onGround(this.player.x, ny) && !this.blocked(this.player.x, ny)) this.player.y = ny;

    if (Math.abs(dx) > Math.abs(dy)) {
      this.facing = "side";
      this.player.setFlipX(dx < 0);
    } else {
      this.facing = dy < 0 ? "up" : "down";
      this.player.setFlipX(false);
    }
    this.player.anims.play(`walk-${this.facing}`, true);
  }
}
