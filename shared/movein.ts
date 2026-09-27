// What to do next, worked out the same way everywhere: the server (Yutu's
// hints), the HUD's goal line, the Quests list, the lots' signs and the ★.
// A neighbor's lot: clear the rubble, then repair it and they move right in
// (as many as the Town Hall has room for). Otherwise: dig up a story item
// that's waiting, or take the next landmark up a stage.

import { happinessFor } from "./decor.js";
import { SPOTS } from "./layout.js";
import { LANDMARKS, STAGE_NAME, digSpots, neighborCap, newNeighborCount, upgradeBlocker, type DigSpot, type LandmarkId } from "./town.js";
import { MATERIALS, MATERIAL_NAME, MOVE_INS, TUTORIAL_VILLAGER, VILLAGER_SHORT, type BuildingId, type Deco, type Materials, type MoveInDef, type Progress } from "./game.js";

export interface MoveInState {
  progress: Progress;
  materials: Materials;
  buildings: Partial<Record<BuildingId, boolean>>;
  coins: number;
  decos: Pick<Deco, "item" | "x" | "y">[];
}

export type StepKey = "rubble" | "repair";

export interface Step {
  key: StepKey;
  done: boolean;
  /** "Clear the rubble (1/2)" */
  text: string;
  /** Can you do it right now (enough materials, and room at the Town Hall)? */
  ready?: boolean;
}

export const needsText = (needs: Partial<Materials>) =>
  MATERIALS.filter((m) => needs[m])
    .map((m) => `${needs[m]} ${MATERIAL_NAME[m]}`)
    .join(", ");

export function lovedCount(d: MoveInDef, s: MoveInState) {
  return happinessFor(d.villager, s.decos).items.filter((i) => i.loved).length;
}

/** Is there room at the Town Hall for another new neighbor? */
export const hasRoom = (s: MoveInState) => newNeighborCount(s.progress.movedIn) < neighborCap(s.progress.town);

export function checklist(d: MoveInDef, s: MoveInState): Step[] {
  const lot = s.progress.lots[d.home] ?? { cleared: [], repaired: false };
  const cleared = lot.cleared.length >= d.rubble;
  const enough = MATERIALS.every((m) => (d.repair[m] ?? 0) <= s.materials[m]);
  return [
    { key: "rubble", done: cleared, text: `Clear the rubble (${Math.min(lot.cleared.length, d.rubble)}/${d.rubble})` },
    { key: "repair", done: lot.repaired, text: `Repair the lot: ${needsText(d.repair)} (then ${VILLAGER_SHORT[d.villager]} moves in)`, ready: cleared && enough && (d.villager === TUTORIAL_VILLAGER || hasRoom(s)) },
  ];
}

export type Goal =
  /** `tutorial`: which of Nova's four tutorial steps this is (1-4). */
  | { kind: "lot"; text: string; def: MoveInDef; step: Step; tutorial?: number }
  | { kind: "landmark"; text: string; id: LandmarkId; ready: boolean }
  | { kind: "dig"; text: string; spot: DigSpot };

/** Landmarks in the order worth doing them: the roads open the map, the rest follow. */
const LANDMARK_ORDER: LandmarkId[] = ["roads", "fountain", "market", "town_hall"];

const landmarkGoal = (s: MoveInState, id: LandmarkId): Goal => {
  const stage = s.progress.town.stages[id];
  return { kind: "landmark", id, text: `Upgrade the ${LANDMARKS[id].name} (${STAGE_NAME[stage + 1]})`, ready: !upgradeBlocker(s.progress.town, id, s.materials) };
};

/** The next thing worth doing (null once everyone's home and the whole town is grand). */
export function nextStep(s: MoveInState): Goal | null {
  const town = s.progress.town;
  // First, the tutorial: Nova's Observatory, step by step.
  const nova = MOVE_INS.find((m) => m.villager === TUTORIAL_VILLAGER)!;
  if (!s.progress.movedIn.includes(nova.villager)) {
    const steps = checklist(nova, s);
    const short = (m: keyof Materials) => (nova.repair[m] ?? 0) > s.materials[m];
    if (!steps[0].done) return { kind: "lot", def: nova, step: steps[0], tutorial: 1, text: `Tutorial 1/4: clear the rubble on Nova's lot (E by each heap)` };
    if (short("moonstone")) return { kind: "lot", def: nova, step: steps[1], tutorial: 2, text: "Tutorial 2/4: break a boulder for moonstone (E by any rock)" };
    if (short("stardust")) return { kind: "lot", def: nova, step: steps[1], tutorial: 3, text: "Tutorial 3/4: sweep a moondust drift for stardust (hold E)" };
    return { kind: "lot", def: nova, step: steps[1], tutorial: 4, text: "Tutorial 4/4: repair Nova's Observatory, and she moves in" };
  }
  const waiting = MOVE_INS.filter((m) => !s.progress.movedIn.includes(m.villager));
  // A neighbor can move in: the lot furthest along first.
  if (waiting.length && hasRoom(s)) {
    const cleared = (m: MoveInDef) => s.progress.lots[m.home]?.cleared.length ?? 0;
    const def = [...waiting].sort((a, b) => cleared(b) - cleared(a))[0];
    const step = checklist(def, s).find((x) => !x.done)!;
    return { kind: "lot", def, step, text: `${VILLAGER_SHORT[def.villager]}'s lot: ${step.text}` };
  }
  // A story item waiting to be dug up.
  const dig = digSpots(SPOTS.town_hall).find((d) => d.when(town) && !town.dug.includes(d.id));
  if (dig) return { kind: "dig", spot: dig, text: dig.hint };
  // No room for the next neighbor: the Town Hall comes first.
  if (waiting.length && town.stages.town_hall < 2) return landmarkGoal(s, "town_hall");
  // Otherwise whichever landmark is ready to go, or the next one in order.
  const open = LANDMARK_ORDER.filter((id) => town.stages[id] < 2);
  if (!open.length) return null;
  return landmarkGoal(s, open.find((id) => !upgradeBlocker(town, id, s.materials)) ?? open[0]);
}
