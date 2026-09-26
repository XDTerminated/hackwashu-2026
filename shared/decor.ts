// The Supply Pod catalog. Shared so the server charges the real price
// (the client only says which item and where).

import { VILLAGER_HOME, type Deco, type VillagerId } from "./game.js";
import { TILE, buildingFootprint, footprint, overlaps, type Rect } from "./layout.js";

export interface DecorDef {
  id: string;
  cat: DecorCategory;
  name: string;
  price: number;
  blurb: string;
  /** Footprint in tiles (width, rows). */
  tiles: [number, number];
  /** Lies flat on the ground: you can walk over it. */
  flat?: boolean;
  /** A light you can switch on and off by walking up to it. */
  light?: boolean;
  /** Villagers who love this near their home. */
  likes: VillagerId[];
}

export type DecorCategory = "garden" | "cozy" | "scifi" | "festival";

export const DECOR_CATEGORIES: { id: DecorCategory; name: string }[] = [
  { id: "garden", name: "GARDEN" },
  { id: "cozy", name: "COZY" },
  { id: "scifi", name: "SCI-FI" },
  { id: "festival", name: "FESTIVAL" },
];

export const DECOR: DecorDef[] = [
  // Garden
  { id: "shrub", cat: "garden", name: "Silverleaf Shrub", price: 20, blurb: "Moon-hardy, with pale blue berries.", tiles: [1, 1], likes: ["postmaster"] },
  { id: "planter", cat: "garden", name: "Moonflower Planter", price: 30, blurb: "Pale blooms that open at Earthrise.", tiles: [2, 1], likes: ["postmaster", "scholar"] },
  { id: "rockgarden", cat: "garden", name: "Zen Rock Garden", price: 50, blurb: "Raked regolith. Very calming.", tiles: [3, 1], flat: true, likes: ["timekeeper"] },
  { id: "tree", cat: "garden", name: "Osmanthus Tree", price: 55, blurb: "Legend says one already grows up here.", tiles: [2, 1], likes: ["jade_rabbit", "scholar"] },
  { id: "pond", cat: "garden", name: "Frost Pond", price: 90, blurb: "Crater ice that never quite melts.", tiles: [3, 1], flat: true, likes: ["postmaster"] },
  { id: "fountain", cat: "garden", name: "Moonstone Fountain", price: 140, blurb: "Two tiers of sparkling meltwater.", tiles: [3, 1], likes: ["jade_rabbit", "postmaster"] },
  // Cozy
  { id: "flag", cat: "cozy", name: "Colony Flag", price: 25, blurb: "Claim a crater as home.", tiles: [1, 1], likes: ["postmaster"] },
  { id: "lantern", cat: "cozy", name: "Moon Lantern", price: 35, blurb: "A red paper lantern, for Mid-Autumn nights.", tiles: [1, 1], light: true, likes: ["jade_rabbit"] },
  { id: "bench", cat: "cozy", name: "Crater Bench", price: 40, blurb: "A good spot to watch Earth go round.", tiles: [2, 1], likes: ["scholar"] },
  { id: "picnic", cat: "cozy", name: "Picnic Table", price: 60, blurb: "Tea for two, mooncakes for four.", tiles: [2, 1], likes: ["scholar"] },
  { id: "arch", cat: "cozy", name: "Flower Arch", price: 75, blurb: "Vines, blossoms, and a little romance.", tiles: [2, 1], likes: ["scholar"] },
  { id: "swing", cat: "cozy", name: "Crescent Swing", price: 95, blurb: "Sit in the moon while you're on the Moon.", tiles: [2, 1], likes: ["stargazer"] },
  // Sci-fi
  { id: "crystal", cat: "scifi", name: "Lunar Crystal", price: 45, blurb: "Dug up from the Sea of Tranquility.", tiles: [1, 1], likes: ["stargazer"] },
  { id: "solar", cat: "scifi", name: "Solar Panel", price: 60, blurb: "Two weeks of sunshine at a time.", tiles: [2, 1], likes: ["timekeeper"] },
  { id: "telescope", cat: "scifi", name: "Brass Telescope", price: 65, blurb: "Point it at home and wave.", tiles: [1, 1], likes: ["stargazer", "scholar"] },
  { id: "dish", cat: "scifi", name: "Comms Dish", price: 70, blurb: "Keeps the line to Earth open.", tiles: [2, 1], likes: ["stargazer"] },
  { id: "rover", cat: "scifi", name: "Mini Rover", price: 100, blurb: "Parked. Mostly.", tiles: [2, 1], likes: ["timekeeper"] },
  { id: "dome", cat: "scifi", name: "Habitat Dome", price: 120, blurb: "Real estate, but make it airtight.", tiles: [3, 1], light: true, likes: ["stargazer", "timekeeper"] },
  // Festival
  { id: "drum", cat: "festival", name: "Festival Drum", price: 40, blurb: "Boom. The whole crater hears it.", tiles: [1, 1], likes: ["timekeeper"] },
  { id: "garland", cat: "festival", name: "Lantern Garland", price: 60, blurb: "A string of little moons.", tiles: [3, 1], light: true, likes: ["stargazer"] },
  { id: "mooncake", cat: "festival", name: "Mooncake Stall", price: 70, blurb: "Lotus paste, red bean, and one mystery.", tiles: [2, 1], likes: ["jade_rabbit"] },
  { id: "statue", cat: "festival", name: "Jade Rabbit Statue", price: 80, blurb: "The guide, carved in moon-jade.", tiles: [1, 1], likes: ["jade_rabbit"] },
  { id: "pagoda", cat: "festival", name: "Tiny Pagoda", price: 130, blurb: "Three roofs, one very small monk.", tiles: [2, 1], light: true, likes: ["timekeeper"] },
  { id: "gate", cat: "festival", name: "Moon Gate", price: 150, blurb: "A round doorway to nowhere, beautifully.", tiles: [3, 1], likes: ["jade_rabbit"] },
];

export function decorById(id: string): DecorDef | undefined {
  return DECOR.find((d) => d.id === id);
}

export function decorFootprint(d: DecorDef, x: number, y: number): Rect {
  return footprint(x, y, d.tiles[0], d.tiles[1]);
}

/** Selling a placed decoration gives back half. */
export function sellPrice(d: DecorDef): number {
  return Math.floor(d.price / 2);
}

// ---------------------------------------------------------------- happiness
// Decorating around a villager's home makes them happy, and happiness adds to
// their friendship. Each kind of item counts once per yard: variety wins.

/** How far (in tiles) a villager's yard reaches past their house's footprint. */
export const YARD_TILES = 3;
export const LOVED_POINTS = 3;
export const LIKED_POINTS = 1;
export const HAPPY_MAX = 12;

export function yardOf(v: VillagerId): Rect {
  const r = buildingFootprint(VILLAGER_HOME[v]);
  const m = YARD_TILES * TILE;
  return { x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 };
}

export interface Happiness {
  score: number;
  /** The decorations counted, first of each kind. */
  items: { name: string; loved: boolean }[];
}

export function happinessFor(v: VillagerId, decos: Pick<Deco, "item" | "x" | "y">[]): Happiness {
  const yard = yardOf(v);
  const seen = new Set<string>();
  const items: Happiness["items"] = [];
  let score = 0;
  for (const d of decos) {
    const def = decorById(d.item);
    if (!def || seen.has(def.id) || !overlaps(decorFootprint(def, d.x, d.y), yard)) continue;
    seen.add(def.id);
    const loved = def.likes.includes(v);
    items.push({ name: def.name, loved });
    score += loved ? LOVED_POINTS : LIKED_POINTS;
  }
  return { score: Math.min(score, HAPPY_MAX), items };
}
