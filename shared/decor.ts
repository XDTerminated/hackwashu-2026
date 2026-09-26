// The Supply Pod catalog. Shared so the server charges the real price
// (the client only says which item and where).

import { footprint, type Rect } from "./layout.js";

export interface DecorDef {
  id: string;
  name: string;
  price: number;
  blurb: string;
  /** Footprint in tiles (width, rows). */
  tiles: [number, number];
  /** Lies flat on the ground: you can walk over it. */
  flat?: boolean;
}

export const DECOR: DecorDef[] = [
  { id: "flag", name: "Colony Flag", price: 25, blurb: "Claim a crater as home.", tiles: [1, 1] },
  { id: "planter", name: "Moonflower Planter", price: 30, blurb: "Pale blooms that open at Earthrise.", tiles: [2, 1] },
  { id: "lantern", name: "Moon Lantern", price: 35, blurb: "A red paper lantern, for Mid-Autumn nights.", tiles: [1, 1] },
  { id: "bench", name: "Crater Bench", price: 40, blurb: "A good spot to watch Earth go round.", tiles: [2, 1] },
  { id: "crystal", name: "Lunar Crystal", price: 45, blurb: "Dug up from the Sea of Tranquility.", tiles: [1, 1] },
  { id: "tree", name: "Osmanthus Tree", price: 55, blurb: "Legend says one already grows up here.", tiles: [2, 1] },
  { id: "solar", name: "Solar Panel", price: 60, blurb: "Two weeks of sunshine at a time.", tiles: [2, 1] },
  { id: "dish", name: "Comms Dish", price: 70, blurb: "Keeps the line to Earth open.", tiles: [2, 1] },
  { id: "statue", name: "Jade Rabbit Statue", price: 80, blurb: "The guide, carved in moon-jade.", tiles: [1, 1] },
  { id: "pond", name: "Frost Pond", price: 90, blurb: "Crater ice that never quite melts.", tiles: [3, 1], flat: true },
  { id: "rover", name: "Mini Rover", price: 100, blurb: "Parked. Mostly.", tiles: [2, 1] },
  { id: "dome", name: "Habitat Dome", price: 120, blurb: "Real estate, but make it airtight.", tiles: [3, 1] },
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
