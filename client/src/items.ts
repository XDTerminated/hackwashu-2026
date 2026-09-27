// How each Supply Pod decoration looks and sits in the world. Names and
// prices live in shared/decor.ts so the server can charge the real price.

import { DECOR, type DecorDef } from "../../shared/decor";
import { decorArt } from "./decorart";

interface Look {
  glow?: { color: number; alpha: number; dx: number; dy: number };
}

const LOOKS: Record<string, Look> = {
  planter: { glow: { color: 0xcfe7ff, alpha: 0.18, dx: 0, dy: -12 } },
  lantern: { glow: { color: 0xf5c542, alpha: 0.5, dx: 3, dy: -15 } },
  crystal: { glow: { color: 0x6fe3e1, alpha: 0.35, dx: 0, dy: -9 } },
  dome: { glow: { color: 0xffd98a, alpha: 0.2, dx: 11, dy: -10 } },
};

export interface ShopItem extends DecorDef, Look {
  texture: string;
  /** Animation key when the item has more than one frame. */
  anim?: string;
  w: number;
  h: number;
}

export const SHOP_ITEMS: ShopItem[] = DECOR.map((d) => {
  const a = decorArt(d.id)!;
  return { ...d, ...LOOKS[d.id], texture: `deco_${d.id}_0`, anim: a.frames > 1 ? `deco_${d.id}` : undefined, w: a.w, h: a.h };
});

export function itemById(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((i) => i.id === id);
}
