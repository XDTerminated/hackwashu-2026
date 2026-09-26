// A neighbor's moving-in checklist, worked out the same way everywhere: the
// server (Yutu's hints), the HUD, the Quests list, the plot's sign and the ★.

import { happinessFor } from "./decor.js";
import { BUILDINGS, MATERIALS, MATERIAL_NAME, VILLAGER_SHORT, currentMoveIn, type BuildingId, type Deco, type Materials, type MoveInDef, type Progress } from "./game.js";

export interface MoveInState {
  progress: Progress;
  materials: Materials;
  buildings: Partial<Record<BuildingId, boolean>>;
  coins: number;
  decos: Pick<Deco, "item" | "x" | "y">[];
}

export type StepKey = "rubble" | "repair" | "build" | "yard";

export interface Step {
  key: StepKey;
  done: boolean;
  /** "Clear the rubble (1/3)" */
  text: string;
  /** Can you do it right now (enough materials / coins)? */
  ready?: boolean;
}

export const needsText = (needs: Partial<Materials>) =>
  MATERIALS.filter((m) => needs[m])
    .map((m) => `${needs[m]} ${MATERIAL_NAME[m]}`)
    .join(", ");

export function lovedCount(d: MoveInDef, s: MoveInState) {
  return happinessFor(d.villager, s.decos).items.filter((i) => i.loved).length;
}

export function checklist(d: MoveInDef, s: MoveInState): Step[] {
  const lot = s.progress.lots[d.home] ?? { cleared: [], repaired: false };
  const cleared = lot.cleared.length >= d.rubble;
  const built = !!s.buildings[d.home];
  const loved = lovedCount(d, s);
  const who = VILLAGER_SHORT[d.villager];
  const enough = MATERIALS.every((m) => (d.repair[m] ?? 0) <= s.materials[m]);
  const price = BUILDINGS[d.home].price;
  return [
    { key: "rubble", done: cleared, text: `Clear the rubble (${Math.min(lot.cleared.length, d.rubble)}/${d.rubble})` },
    { key: "repair", done: lot.repaired, text: `Repair the foundation: ${needsText(d.repair)}`, ready: cleared && enough },
    { key: "build", done: built, text: `Build the ${BUILDINGS[d.home].name}: ${price}¢`, ready: lot.repaired && s.coins >= price },
    { key: "yard", done: loved >= d.loves, text: `${d.loves} thing${d.loves === 1 ? "" : "s"} ${who} loves in the yard (${Math.min(loved, d.loves)}/${d.loves})` },
  ];
}

/** The next thing to do for the lot being worked on (null once everyone's home). */
export function nextStep(s: MoveInState): { def: MoveInDef; step: Step } | null {
  const def = currentMoveIn(s.progress);
  if (!def) return null;
  const steps = checklist(def, s);
  // Decorating can happen any time, but it's shown last.
  const step = steps.find((x) => !x.done && x.key !== "yard") ?? steps.find((x) => !x.done) ?? steps[steps.length - 1];
  return { def, step };
}
