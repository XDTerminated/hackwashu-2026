// The story's chapters. Chapter 1 opens with the intro cutscene; each
// neighbor who moves in opens the next chapter (a card slides in), and when
// the last one is home the finale plays.

import { MOVE_INS, type VillagerId } from "../../shared/game";

export interface Chapter {
  n: number;
  title: string;
  line: string;
}

export const FIRST_CHAPTER: Chapter = {
  n: 1,
  title: "A LINE HOME",
  line: "Stranded on the Moon with a rabbit, a stargazer and no signal.",
};

/** The chapter that begins when the first, then the second, new neighbor moves in (you choose who). */
export const CHAPTER_AFTER: Record<number, Chapter> = {
  1: {
    n: 2,
    title: "A TOWN AGAIN",
    line: "A new neighbor is home. Mayor Yutu has plans: the Town Hall, the Fountain, the Roads, the Market.",
  },
  2: {
    n: 3,
    title: "THE LAST LOT",
    line: "Two new neighbors home. Make the Town Hall grand and there's room for the last one.",
  },
};

/** How many new neighbors are home, given everyone who lives here. */
export const newNeighbors = (residents: VillagerId[]) => MOVE_INS.filter((m) => residents.includes(m.villager)).length;
/** With every new neighbor home, the finale plays. */
export const FINALE_AT = MOVE_INS.length;

const PENDING = "moon-finale-pending";

/**
 * Story beats waiting for a good moment (you're outside, no window open).
 * The finale is remembered across reloads so it can never be missed.
 */
export const pending: { finaleAt: number | null; chapter: { ch: Chapter; at: number } | null } = {
  finaleAt: (() => {
    try {
      return localStorage.getItem(PENDING) === "1" ? Date.now() : null;
    } catch {
      return null;
    }
  })(),
  chapter: null,
};

export function setFinalePending(on: boolean, delay = 4500) {
  pending.finaleAt = on ? Date.now() + delay : null;
  try {
    if (on) localStorage.setItem(PENDING, "1");
    else localStorage.removeItem(PENDING);
  } catch {
    /* it'll just need the Quests button */
  }
}
