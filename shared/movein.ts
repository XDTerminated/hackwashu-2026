// What to do next, worked out the same way everywhere: the server (Yutu's
// hints), the game's goal line, the Quests list, the plots' signs and the ★.
// First the tutorial: fix up the Market stall, then buy Nova's plot at the Town
// Hall, set it down, and build her Observatory. After that: set down and build
// any plot you've bought, buy the next neighbor's plot (as many as the Town
// Hall has room for), dig up a story item that's waiting, or take the next
// landmark up a stage, and make the houses grand.

import { happinessFor } from "./decor.js";
import { SPOTS } from "./layout.js";
import { LANDMARKS, STAGE_NAME, digSpots, neighborCap, upgradeBlocker, type DigSpot, type LandmarkId } from "./town.js";
import { BUILDINGS, MATERIALS, MATERIAL_NAME, MOVE_INS, TUTORIAL_VILLAGER, VILLAGER_SHORT, plotsTaken, type BuildingId, type Deco, type Materials, type MoveInDef, type PlotState, type Progress } from "./game.js";

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
export function buyBlocker(d: MoveInDef, s: MoveInState): { why: "owned" | "nova" | "room" | "coins"; text: string } | null {
  if (s.progress.plots[d.home]) return { why: "owned", text: `You already have ${VILLAGER_SHORT[d.villager]}'s plot.` };
  if (d.villager !== TUTORIAL_VILLAGER && !s.progress.movedIn.includes(TUTORIAL_VILLAGER)) return { why: "nova", text: "Get Nova moved in first." };
  if (d.villager !== TUTORIAL_VILLAGER && !hasRoom(s)) {
    const cap = neighborCap(s.progress.town);
    return { why: "room", text: `The Town Hall only has room for ${cap} new neighbor${cap === 1 ? "" : "s"}. Upgrade it to make room.` };
  }
  if (s.coins < d.price) return { why: "coins", text: `It costs ${d.price}¢ (you have ${s.coins}¢).` };
  return null;
}

export type PlotAction = "buy" | "place" | "build" | "grand";

export type Goal =
  /** `tutorial`: which of the five tutorial steps this is. */
  | { kind: "plot"; text: string; def: MoveInDef; action: PlotAction; ready: boolean; tutorial?: number }
  | { kind: "landmark"; text: string; id: LandmarkId; ready: boolean; tutorial?: number }
  | { kind: "dig"; text: string; spot: DigSpot; tutorial?: undefined };

/** Landmarks in the order worth doing them: the roads open the map, the rest follow. */
const LANDMARK_ORDER: LandmarkId[] = ["roads", "fountain", "market", "town_hall"];

const landmarkGoal = (s: MoveInState, id: LandmarkId): Goal => {
  const stage = s.progress.town.stages[id];
  return { kind: "landmark", id, text: `Upgrade the ${LANDMARKS[id].name} (${STAGE_NAME[stage + 1]})`, ready: !upgradeBlocker(s.progress.town, id, s.materials) };
};

/** What to do with a neighbor's plot next, in words. */
function plotGoal(d: MoveInDef, s: MoveInState, tutorial?: number): Goal {
  const who = VILLAGER_SHORT[d.villager];
  const plot = s.progress.plots[d.home];
  const home = BUILDINGS[d.home].name;
  const tut = tutorial ? `Tutorial ${tutorial}/5: ` : "";
  if (!plot) return { kind: "plot", def: d, action: "buy", ready: !buyBlocker(d, s), tutorial, text: `${tut}buy ${who}'s plot at the Town Hall (${d.price}¢)` };
  if (!plot.placed) return { kind: "plot", def: d, action: "place", ready: true, tutorial, text: `${tut}set ${who}'s plot down anywhere you like` };
  const needs = nextBuild(d, plot)!;
  if (plot.stage === 0) return { kind: "plot", def: d, action: "build", ready: canAfford(needs, s.materials), tutorial, text: `${tut}build ${who}'s ${home}: ${needsText(needs)} (E at the plot)` };
  return { kind: "plot", def: d, action: "grand", ready: canAfford(needs, s.materials), tutorial, text: `Make ${who}'s ${home} grand: ${needsText(needs)}` };
}

/** The next thing worth doing (null once everyone's home and the whole town is grand). */
export function nextStep(s: MoveInState): Goal | null {
  const town = s.progress.town;
  const plots = s.progress.plots;
  // First, the tutorial: the Market stall, then Nova's plot.
  const nova = MOVE_INS.find((m) => m.villager === TUTORIAL_VILLAGER)!;
  if (!s.progress.movedIn.includes(nova.villager)) {
    if (town.stages.market === 0) {
      const ready = !upgradeBlocker(town, "market", s.materials);
      const text = ready ? "Tutorial 2/5: repair the Market stall (E at the Market)" : "Tutorial 1/5: gather for the Market stall: break a boulder (E) and sweep a moondust drift (hold E)";
      return { kind: "landmark", id: "market", ready, tutorial: ready ? 2 : 1, text };
    }
    const p = plots[nova.home];
    return plotGoal(nova, s, !p ? 3 : !p.placed ? 4 : 5);
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
  if (dig) return { kind: "dig", spot: dig, text: dig.hint };
  // No room for the next neighbor: the Town Hall comes first.
  if (forSale && town.stages.town_hall < 2) return landmarkGoal(s, "town_hall");
  // A grand house you can afford now.
  const grand = MOVE_INS.find((m) => plots[m.home]?.stage === 1 && canAfford(m.build[1], s.materials));
  if (grand) return plotGoal(grand, s);
  // Otherwise whichever landmark is ready to go, or the next one in order.
  const open = LANDMARK_ORDER.filter((id) => town.stages[id] < 2);
  if (open.length) return landmarkGoal(s, open.find((id) => !upgradeBlocker(town, id, s.materials)) ?? open[0]);
  // Last of all: the houses not grand yet.
  const left = MOVE_INS.find((m) => plots[m.home]?.stage === 1);
  return left ? plotGoal(left, s) : null;
}
