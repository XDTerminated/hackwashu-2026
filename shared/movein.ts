// What to do next, worked out the same way everywhere: the server (Yutu's
// hints), the game's goal line, the Quests list, the plots' signs and the ★.
// First the tutorial: repair the Town Hall (it's where plots are sold), then
// pick your first neighbor, buy their plot, set it down, and build their house.
// After that: set down and build any plot you've bought, buy the next
// neighbor's plot (as many as the Town Hall has room for: a level each), dig
// up a story item that's waiting, or take the next landmark up a stage, and
// make the houses grand.

import { happinessFor } from "./decor.js";
import { SPOTS } from "./layout.js";
import { ITEMS, LANDMARKS, LANDMARK_IDS, TASKS, digSpots, maxStage, neighborCap, stageName, upgradeBlocker, type DigSpot, type LandmarkId } from "./town.js";
import { BUILDINGS, EXTENSIONS, MATERIALS, MATERIAL_NAME, MOVE_INS, VILLAGER_SHORT, type Material, plotsTaken, type BuildingId, type Deco, type Materials, type MoveInDef, type PlotState, type Progress } from "./game.js";

export interface MoveInState {
  progress: Progress;
  materials: Materials;
  buildings: Partial<Record<BuildingId, boolean>>;
  coins: number;
  decos: Pick<Deco, "item" | "x" | "y">[];
}

export const needsText = (needs: Partial<Materials>) =>
  MATERIALS.filter((m) => needs[m])
    .map((m) => `${needs[m]} ${MATERIAL_NAME[m]}`)
    .join(", ");

export const canAfford = (needs: Partial<Materials>, materials: Materials) => MATERIALS.every((m) => (needs[m] ?? 0) <= materials[m]);

export function lovedCount(d: MoveInDef, s: MoveInState) {
  return happinessFor(d.villager, s.decos).items.filter((i) => i.loved).length;
}

/** Room at the Town Hall for another new neighbor's plot? */
export const hasRoom = (s: MoveInState) => plotsTaken(s.progress) < neighborCap(s.progress.town);

/** What taking this plot up its next stage costs (null if it isn't set down yet, or it's already grand). */
export function nextBuild(d: MoveInDef, plot: PlotState | undefined): Partial<Materials> | null {
  if (!plot?.placed || plot.stage >= 2) return null;
  return d.build[plot.stage as 0 | 1];
}

/** Why you can't buy this neighbor's plot right now (or null if you can): what's missing, and in words. */
export function buyBlocker(d: MoveInDef, s: MoveInState): { why: "owned" | "room" | "coins"; text: string } | null {
  if (s.progress.plots[d.home]) return { why: "owned", text: `You already have ${VILLAGER_SHORT[d.villager]}'s plot.` };
  if (!hasRoom(s)) {
    const cap = neighborCap(s.progress.town);
    return { why: "room", text: cap ? `The Town Hall is full (${cap}): take it up a level for one more.` : "Repair the Town Hall first to make room." };
  }
  if (s.coins < d.price) return { why: "coins", text: `It costs ${d.price}¢ (you have ${s.coins}¢).` };
  return null;
}

export type PlotAction = "buy" | "place" | "build" | "grand";

/** The goal in pieces, for the HUD: what to do, what it costs, and how. (`text` says it all in one line.) */
interface GoalParts {
  title: string;
  needs?: Partial<Materials>;
  /** Coins it costs. */
  price?: number;
  how?: string;
}

export type Goal = GoalParts &
  (
    /** `tutorial`: which of the five tutorial steps this is. */
    | { kind: "plot"; text: string; def: MoveInDef; action: PlotAction; ready: boolean; tutorial?: number }
    /** The tutorial's first neighbor: yours to pick, at the Town Hall. */
    | { kind: "choose"; text: string; tutorial: number }
    | { kind: "landmark"; text: string; id: LandmarkId; ready: boolean; tutorial?: number }
    | { kind: "dig"; text: string; spot: DigSpot; tutorial?: undefined }
  );

/** Everything a material goes into, in words ("Mabel's Library (build & grand)", "the Fountain (grand)"). */
export function materialUses(m: Material): string[] {
  const out: string[] = [];
  const stages = (name: string, at: string[], of: number) => {
    // ("level 1 & level 2" reads better as "levels 1, 2")
    const lv = at.filter((a) => a.startsWith("level "));
    const said = lv.length > 1 ? [`levels ${lv.map((a) => a.slice(6)).join(", ")}`, ...at.filter((a) => !lv.includes(a))] : at;
    out.push(at.length === of && of > 2 ? `${name} (every stage)` : `${name} (${said.join(" & ")})`);
  };
  for (const d of MOVE_INS) {
    const at = [d.build[0][m] && "build", d.build[1][m] && "grand"].filter((x): x is string => !!x);
    if (at.length) stages(`${VILLAGER_SHORT[d.villager]}'s ${BUILDINGS[d.home].name}`, at, 2);
  }
  for (const [id, x] of Object.entries(EXTENSIONS)) if (x?.needs[m]) out.push(BUILDINGS[id as BuildingId].name);
  for (const id of LANDMARK_IDS) {
    const at = LANDMARKS[id].up.flatMap((u, i) => (u.needs[m] ? [stageName(id, i + 1)] : []));
    if (at.length) stages(`the ${LANDMARKS[id].name}`, at, LANDMARKS[id].up.length);
  }
  return out;
}

/** What taking a landmark up its next stage does, in a few words (for the goal). */
const WHY: Record<LandmarkId, (next: number) => string> = {
  town_hall: () => "Room for one more moonfolk",
  fountain: (n) => (n === 1 ? "Moonfolk make daily wishes" : "Friendships grow faster"),
  roads: (n) => (n === 1 ? "Clears the rockfall to the north" : "Clears the rockfall to the south"),
  market: (n) => (n === 1 ? "Opens the Shop" : "The Shop stocks everything"),
};

/** Landmarks in the order worth doing them: the roads open the map, the rest follow. */
const LANDMARK_ORDER: LandmarkId[] = ["roads", "fountain", "market", "town_hall"];

const landmarkGoal = (s: MoveInState, id: LandmarkId): Goal => {
  const town = s.progress.town;
  const stage = town.stages[id];
  const up = LANDMARKS[id].up[stage];
  const name = LANDMARKS[id].name;
  // (what it takes besides materials: a story item, a job for a neighbor)
  const extra = [
    up.item && !town.items.includes(up.item) ? `Needs the ${ITEMS[up.item].name}: ${ITEMS[up.item].from}` : "",
    up.task && !town.tasks.includes(up.task) ? TASKS[up.task] : "",
  ].filter(Boolean);
  // (the roads are a Town Hall project: there's nowhere else to fix them from)
  const where = id === "roads" ? "the Town Hall" : `the ${name}`;
  const title = id === "roads" ? (stage === 0 ? "Fix the Roads" : "Make the Roads grand") : `Upgrade the ${name} (${stageName(id, stage + 1)})`;
  const why = WHY[id](stage + 1);
  const text = `${title}: ${why.toLowerCase()} (E at ${where})`;
  return { kind: "landmark", id, text, title, needs: up.needs, how: extra.length ? extra.join(". ") : `${why}. E at ${where}`, ready: !upgradeBlocker(town, id, s.materials) };
};

/** What to do with a neighbor's plot next, in words. */
function plotGoal(d: MoveInDef, s: MoveInState, tutorial?: number): Goal {
  const who = VILLAGER_SHORT[d.villager];
  const plot = s.progress.plots[d.home];
  const home = BUILDINGS[d.home].name;
  const tut = tutorial ? `Tutorial ${tutorial}/5: ` : "";
  if (!plot) return { kind: "plot", def: d, action: "buy", ready: !buyBlocker(d, s), tutorial, title: `Buy ${who}'s plot`, price: d.price, how: "E at the Town Hall", text: `${tut}buy ${who}'s plot at the Town Hall (${d.price}¢)` };
  if (!plot.placed) return { kind: "plot", def: d, action: "place", ready: true, tutorial, title: `Set ${who}'s plot down`, how: "Anywhere you like: it's in your bag", text: `${tut}set ${who}'s plot down anywhere you like` };
  const needs = nextBuild(d, plot)!;
  if (plot.stage === 0) return { kind: "plot", def: d, action: "build", ready: canAfford(needs, s.materials), tutorial, title: `Build ${who}'s ${home}`, needs, how: "E at the plot", text: `${tut}build ${who}'s ${home}: ${needsText(needs)} (E at the plot)` };
  return { kind: "plot", def: d, action: "grand", ready: canAfford(needs, s.materials), tutorial, title: `Make ${who}'s ${home} grand`, needs, how: "E at the house", text: `Make ${who}'s ${home} grand: ${needsText(needs)}` };
}

/** The next thing worth doing (null once everyone's home and the whole town is grand). */
export function nextStep(s: MoveInState): Goal | null {
  const town = s.progress.town;
  const plots = s.progress.plots;
  // First, the tutorial: the Town Hall, then your first neighbor (you pick who).
  if (!s.progress.movedIn.length) {
    if (town.stages.town_hall === 0) {
      const ready = !upgradeBlocker(town, "town_hall", s.materials);
      const text = ready ? "Tutorial 2/5: repair the Town Hall (E at the Town Hall)" : "Tutorial 1/5: gather for the Town Hall: break a boulder (E) and sweep a moondust drift (hold E)";
      const needs = LANDMARKS.town_hall.up[0].needs;
      return ready
        ? { kind: "landmark", id: "town_hall", ready, tutorial: 2, text, title: "Repair the Town Hall", needs, how: "E at the Town Hall" }
        : { kind: "landmark", id: "town_hall", ready, tutorial: 1, text, title: "Gather for the Town Hall", needs, how: "Break a boulder (E), sweep moondust (hold E)" };
    }
    const first = MOVE_INS.find((m) => plots[m.home]);
    if (!first) return { kind: "choose", tutorial: 3, title: "Pick your first moonfolk", how: "E at the Town Hall: you buy their plot there", text: "Tutorial 3/5: pick your first moonfolk and buy their plot (E at the Town Hall)" };
    return plotGoal(first, s, !plots[first.home]!.placed ? 4 : 5);
  }
  const waiting = MOVE_INS.filter((m) => !s.progress.movedIn.includes(m.villager));
  // A plot you've bought: set it down, then build it.
  const bought = waiting.find((m) => plots[m.home] && !plots[m.home]!.placed) ?? waiting.find((m) => plots[m.home]?.placed);
  if (bought) return plotGoal(bought, s);
  // Room at the Town Hall: the next neighbor's plot.
  const forSale = waiting.find((m) => !plots[m.home]);
  if (forSale && hasRoom(s)) return plotGoal(forSale, s);
  // A story item waiting to be dug up.
  const dig = digSpots(SPOTS.town_hall).find((d) => d.when(town) && !town.dug.includes(d.id));
  if (dig) return { kind: "dig", spot: dig, text: dig.hint, title: `Dig up the ${ITEMS[dig.item].name}`, how: dig.hint };
  // No room for the next neighbor: the Town Hall comes first.
  if (forSale && town.stages.town_hall < maxStage("town_hall")) return landmarkGoal(s, "town_hall");
  // A grand house you can afford now.
  const grand = MOVE_INS.find((m) => plots[m.home]?.stage === 1 && canAfford(m.build[1], s.materials));
  if (grand) return plotGoal(grand, s);
  // Otherwise whichever landmark is ready to go, or the next one in order.
  const open = LANDMARK_ORDER.filter((id) => town.stages[id] < maxStage(id));
  if (open.length) return landmarkGoal(s, open.find((id) => !upgradeBlocker(town, id, s.materials)) ?? open[0]);
  // Last of all: the houses not grand yet.
  const left = MOVE_INS.find((m) => plots[m.home]?.stage === 1);
  return left ? plotGoal(left, s) : null;
}
