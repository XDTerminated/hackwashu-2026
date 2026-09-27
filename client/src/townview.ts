// The town on the map: the rockfalls and shadow over the parts of the crater
// the roads haven't reached yet, the spots to gather ice, scrap, helium-3 and
// glow ore, and the mounds where story items are buried. (The landmarks'
// cards live in townpanel.ts.)

import Phaser from "phaser";
import { SPOTS, WORLD_W, inIsland } from "../../shared/layout";
import { NODES, NORTH_Y, SOUTH_Y, areaOpen, digSpots, openAt, type Area, type HarvestNode } from "../../shared/town";
import * as net from "./net";
import { openInfo } from "./panel";
import { sfx } from "./sfx";
import { store } from "./store";
import { shadowKey } from "./textures";

export interface TownTarget {
  verb: string;
  label: string;
  x: number;
  y: number;
  d: number;
  act: () => void;
}

const VERB: Record<HarvestNode["kind"], string> = { ice: "chip ice", scrap: "salvage scrap", helium: "scoop helium-3", ore: "dig out glow ore" };
const today = () => new Date().toDateString();

/** The shadow over a sealed-off part of the crater: dithered dark, only over the crater floor. */
function fogTexture(scene: Phaser.Scene, key: string, area: Area) {
  if (scene.textures.exists(key)) return;
  const y0 = area === "north" ? 0 : SOUTH_Y - 6;
  const y1 = area === "north" ? NORTH_Y + 6 : 1216;
  const tex = scene.textures.createCanvas(key, WORLD_W, y1 - y0)!;
  const ctx = tex.getContext();
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < WORLD_W; x++) {
      if (!inIsland((x + 0.5) / 16, (y + 0.5) / 16)) continue;
      // a ragged edge where the shadow meets the open crater
      const edge = area === "north" ? NORTH_Y - y : y - SOUTH_Y;
      const wob = Math.sin(x / 23) * 3 + Math.sin(x / 7) * 1.5;
      if (edge + wob < -2) continue;
      ctx.fillStyle = (x + y) % 2 === 0 || edge + wob > 6 ? "rgba(20,16,38,0.62)" : "rgba(20,16,38,0.3)";
      ctx.fillRect(x, y - y0, 1, 1);
    }
  tex.refresh();
}

export class TownView {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private sent = new Set<string>();

  constructor(private scene: Phaser.Scene) {
    fogTexture(scene, "fog_north", "north");
    fogTexture(scene, "fog_south", "south");
  }

  destroy() {
    this.objs.forEach((o) => o.destroy());
    this.objs = [];
  }

  /** Draw (or redraw) everything for the town as it stands. */
  refresh() {
    this.destroy();
    this.sent.clear();
    const s = this.scene;
    const town = store.progress.town;
    const push = <T extends Phaser.GameObjects.GameObject>(o: T) => (this.objs.push(o), o);

    // Sealed areas: shadow, and a rockfall along the line.
    for (const area of ["north", "south"] as Area[]) {
      if (areaOpen(town, area)) continue;
      push(s.add.image(0, area === "north" ? 0 : SOUTH_Y - 6, `fog_${area}`).setOrigin(0).setDepth(-7));
      const y = area === "north" ? NORTH_Y + 4 : SOUTH_Y + 8;
      for (let x = 40, i = 0; x < WORLD_W - 40; x += 18, i++) {
        const jitter = Math.sin(i * 12.9898) * 4;
        const yy = Math.round(y + jitter);
        if (!inIsland(x / 16, yy / 16) || !inIsland(x / 16, (yy - 20) / 16)) continue;
        const big = i % 3 !== 1;
        push(s.add.image(x, yy, shadowKey(s, big ? 30 : 16)).setDepth(-8));
        push(s.add.image(x, yy, `rock_${big ? "big" : "small"}_${i % 3}`).setOrigin(0.5, 1).setDepth(yy).setFlipX(i % 2 === 1));
      }
    }

    // Spots to gather from (they grow back overnight).
    const picked = town.day === today() ? town.harvested : [];
    for (const n of NODES) {
      if (picked.includes(n.id)) continue;
      const open = openAt(town, n.x, n.y);
      push(s.add.image(n.x, n.y - 1, shadowKey(s, n.kind === "ice" ? 16 : 18)).setDepth(-8));
      const img =
        n.kind === "helium"
          ? push(s.add.sprite(n.x, n.y, "node_helium_0").setOrigin(0.5, 1).setDepth(n.y).play({ key: "helium-shimmer", startFrame: n.x % 2 }))
          : push(s.add.image(n.x, n.y, `node_${n.kind}`).setOrigin(0.5, 1).setDepth(n.y));
      if (!open) img.setTint(0x7a7390);
      if (open && (n.kind === "ice" || n.kind === "ore")) {
        const g = push(s.add.image(n.x, n.y - 8, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(n.kind === "ice" ? 0x9fe3f0 : 0xffb347).setDepth(n.y + 1));
        s.tweens.add({ targets: g, alpha: { from: 0.25, to: 0.6 }, duration: 1300 + (n.x % 5) * 170, yoyo: true, repeat: -1, ease: "sine.inout" });
      }
    }

    // Buried story items, once they're there to find.
    for (const d of digSpots(SPOTS.town_hall)) {
      if (!d.when(town) || town.dug.includes(d.id)) continue;
      const g = push(s.add.image(d.x, d.y - 4, "glow_s").setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff0a0).setDepth(d.y + 1));
      s.tweens.add({ targets: g, alpha: { from: 0.3, to: 0.8 }, duration: 800, yoyo: true, repeat: -1, ease: "sine.inout" });
      push(s.add.sprite(d.x, d.y, "dig_0").setOrigin(0.5, 1).setDepth(d.y).play("dig-sparkle"));
    }
  }

  /** What E would do near here: gather, dig, or read the rockfall. */
  targets(px: number, py: number): TownTarget[] {
    const town = store.progress.town;
    const out: TownTarget[] = [];
    const picked = town.day === today() ? town.harvested : [];
    for (const n of NODES) {
      const d = Math.hypot(px - n.x, py - n.y);
      if (d > 26 || picked.includes(n.id) || !openAt(town, n.x, n.y) || this.sent.has(n.id)) continue;
      out.push({ verb: "GRAB", label: `[E] ${VERB[n.kind]}`, x: n.x, y: n.y + 6, d, act: () => this.harvest(n) });
    }
    for (const s of digSpots(SPOTS.town_hall)) {
      const d = Math.hypot(px - s.x, py - s.y);
      if (d > 26 || !s.when(town) || town.dug.includes(s.id) || this.sent.has(s.id)) continue;
      out.push({ verb: "CLEAR", label: "[E] dig it up", x: s.x, y: s.y + 6, d, act: () => this.dig(s.id) });
    }
    // Standing at a rockfall: say what clears it.
    for (const area of ["north", "south"] as Area[]) {
      if (areaOpen(town, area)) continue;
      const line = area === "north" ? NORTH_Y + 4 : SOUTH_Y + 8;
      const d = Math.abs(py - line);
      if (d > 30) continue;
      out.push({
        verb: "CHECK",
        label: "[E] rockfall",
        x: px,
        y: line + 10,
        d: d + 10,
        act: () => openInfo("ROCKFALL", [`A rockfall seals off the ${area} of the crater. ${area === "north" ? "Repair the Roads & Lamps (at the Town Hall) and the crews will clear it." : "Make the Roads & Lamps grand (at the Town Hall) and the crews will clear it."}`]),
      });
    }
    return out;
  }

  private harvest(n: HarvestNode) {
    this.sent.add(n.id);
    net.send({ type: "harvest", id: n.id });
    sfx.thunk();
  }

  private dig(id: string) {
    this.sent.add(id);
    net.send({ type: "dig", id });
    sfx.hammer();
  }
}
