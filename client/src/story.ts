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

/** The chapter that begins when a neighbor moves in. */
export const CHAPTER_AFTER: Partial<Record<VillagerId, Chapter>> = {
  postmaster: {
    n: 2,
    title: "KEEPING TIME",
    line: "Hoot is home and the letters are flowing. Next: fix up the old clock tower lot for Cog.",
  },
  timekeeper: {
    n: 3,
    title: "THE SCHOLAR",
    line: "Cog keeps the colony on time. Last one: Mabel the Scholar's old library lot.",
  },
};

/** The last neighbor home plays the finale. */
export const FINALE_VILLAGER: VillagerId = MOVE_INS[MOVE_INS.length - 1].villager;

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
