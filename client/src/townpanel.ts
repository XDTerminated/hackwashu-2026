// The town's project cards, easy on the eyes: one card per landmark (or per
// neighbor's lot), with its stage as three pips, what the next stage gives,
// and what it takes as a row of chips: the resource's own sprite and a bold
// have/need count, green when you've got enough and red when you haven't.
// Hover a chip to see where to get it. The button to do it sits on the card.
// Lives in the UI scene; the world opens it with the "town-panel" event.

import Phaser from "phaser";
import { BUILDINGS, MATERIALS, MATERIAL_NAME, MATERIAL_SOURCE, VILLAGER_SHORT, moveInAt, type BuildingId, type Material } from "../../shared/game";
import { ITEMS, LANDMARKS, LANDMARK_IDS, STAGE_NAME, TASKS, neighborCap, newNeighborCount, upgradeBlocker, type LandmarkId, type TownItem, type TownTask } from "../../shared/town";
import * as net from "./net";
import { sfx } from "./sfx";
import { store } from "./store";
import { Button, C, Label, TOOLBAR_H, measure, pixBox, ptext, woodFrame } from "./widgets";

export type TownPanelSpec = { kind: "board" } | { kind: "landmark"; id: LandmarkId } | { kind: "lot"; home: BuildingId };

const ITEM_SHORT: Record<TownItem, string> = { charter: "Charter", valve: "Valve", lens: "Lamp Lens", bell: "Shop Bell" };
const TASK_SHORT: Record<TownTask, string> = { nova_search: "Nova search", real_job: "A real job" };
const TASK_ICON: Record<TownTask, string> = { nova_search: "item_search_0", real_job: "item_job_0" };
const STAGE_COLOR = [0xb0302a, 0x2f5f9a, 0x8a5a10];
const OK = 0x2f7a40;
const SHORT = 0xb0302a;

interface Chip {
  icon?: string;
  text: string;
  ok: boolean;
  tip: string;
}

export class TownPanel {
  private root: Phaser.GameObjects.Container;
  private spec: TownPanelSpec | null = null;
  private tip: Label | null = null;

  constructor(private scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(4150).setVisible(false);
  }

  get isOpen() {
    return !!this.spec;
  }

  open(spec: TownPanelSpec) {
    this.spec = spec;
    this.scene.registry.set("townOpen", true);
    this.render();
    this.root.setVisible(true);
  }

  close() {
    if (!this.spec) return;
    this.spec = null;
    this.scene.registry.set("townOpen", false);
    this.tip?.destroy();
    this.tip = null;
    this.root.setVisible(false).removeAll(true);
  }

  /** Materials or stages changed: redraw (if it's open). */
  refresh() {
    if (this.spec) this.render();
  }

  private render() {
    const spec = this.spec;
    if (!spec) return;
    const s = this.scene;
    this.root.removeAll(true);
    this.tip?.destroy();
    this.tip = null;
    const W = s.scale.width;
    const H = s.scale.height;
    const pw = Math.min(W - 20, 460);
    const x0 = Math.round((W - pw) / 2);
    const cards = spec.kind === "board" ? LANDMARK_IDS.length : 1;
    const cardH = 50;
    const headH = 30;
    const ph = headH + cards * (cardH + 4) + 6;
    const y0 = Math.max(6, Math.round((H - TOOLBAR_H - ph) / 2));

    // the frame, title and close
    const g = s.add.graphics();
    woodFrame(g, x0, y0, pw, ph, C.paper);
    const title = spec.kind === "lot" ? `${VILLAGER_SHORT[moveInAt(spec.home)!.villager].toUpperCase()}'S LOT` : spec.kind === "board" ? "TOWN PROJECTS" : LANDMARKS[spec.id].name.toUpperCase();
    const t = ptext(s, x0 + 12, y0 + 9, `★ ${title}`, C.coral, "pxb");
    const sub = ptext(s, 0, y0 + 11, spec.kind === "lot" ? "clear it, repair it, and they move right in" : "Mayor Yutu's town: ruined, repaired, grand", C.inkSoft, "sm");
    sub.setX(Math.max(t.x + measure(t).w + 10, x0 + pw - 30 - measure(sub).w));
    const x = ptext(s, x0 + pw - 16, y0 + 8, "x", C.ink, "pxb").setInteractive({ useHandCursor: true });
    x.on("pointerdown", () => (sfx.blip(), this.close()));
    this.root.add([g, t, sub, x]);

    const cx = x0 + 8;
    const cw = pw - 16;
    let cy = y0 + headH;
    if (spec.kind === "lot") this.lotCard(spec.home, cx, cy, cw, cardH);
    else
      for (const id of spec.kind === "board" ? LANDMARK_IDS : [spec.id]) {
        this.landmarkCard(id, cx, cy, cw, cardH);
        cy += cardH + 4;
      }
  }

  private materialChips(needs: Partial<Record<Material, number>>): Chip[] {
    return MATERIALS.filter((m) => needs[m]).map((m) => {
      const need = needs[m] ?? 0;
      const have = store.materials[m];
      return { icon: `mat_${m}_0`, text: `${Math.min(have, 99)}/${need}`, ok: have >= need, tip: `${need} ${MATERIAL_NAME[m]} (you have ${have})${have >= need ? "" : `\n${MATERIAL_SOURCE[m]}`}` };
    });
  }

  /** A row of requirement chips; returns where the row ends. */
  private chips(list: Chip[], x: number, y: number) {
    const s = this.scene;
    for (const c of list) {
      const start = x;
      if (c.icon) {
        this.root.add(s.add.image(x, y + 1, c.icon).setOrigin(0));
        x += 10;
      }
      const t = ptext(s, x, y, c.text, c.ok ? OK : SHORT, "pxb");
      this.root.add(t);
      x += measure(t).w + 4;
      const mark = ptext(s, x, y, c.ok ? "✓" : "", OK, "pxb");
      this.root.add(mark);
      if (c.ok) x += measure(mark).w;
      // hover for where it comes from
      const hit = s.add.zone(start - 2, y - 2, x - start + 4, 12).setOrigin(0).setInteractive();
      hit.on("pointerover", () => {
        this.tip?.destroy();
        this.tip = new Label(s, start + (x - start) / 2, y - 4, c.tip, { maxWidth: 170, tail: true }).setDepth(4200);
      });
      hit.on("pointerout", () => {
        this.tip?.destroy();
        this.tip = null;
      });
      this.root.add(hit);
      x += 12;
    }
    return x;
  }

  private landmarkCard(id: LandmarkId, x: number, y: number, w: number, h: number) {
    const s = this.scene;
    const town = store.progress.town;
    const def = LANDMARKS[id];
    const stage = town.stages[id];
    const g = s.add.graphics();
    pixBox(g, x, y, w, h, C.paperLight, C.paperDark);
    this.root.add(g);
    // name, the three pips, and the stage
    const name = ptext(s, x + 8, y + 6, def.name, C.ink, "pxb");
    let px = x + 8 + measure(name).w + 8;
    for (let i = 0; i < 3; i++) {
      g.fillStyle(C.outline, 1).fillRect(px, y + 7, 8, 7);
      g.fillStyle(i <= stage ? [0xd9b24a, 0xd9b24a, 0xf5c542][i] : C.paperLight, 1).fillRect(px + 1, y + 8, 6, 5);
      px += 10;
    }
    const word = ptext(s, px + 4, y + 7, STAGE_NAME[stage].toUpperCase(), STAGE_COLOR[stage], "sm");
    this.root.add([name, word]);
    // what's next
    const next = stage < 2 ? `Next: ${def.perks[stage + 1]}` : `${def.perks[2]}.`;
    const line = ptext(s, x + 8, y + 19, next, C.inkSoft, "sm").setMaxWidth(w - 90);
    this.root.add(line);
    // what it takes, and the button
    if (stage < 2) {
      const up = def.up[stage as 0 | 1];
      const list = [
        ...this.materialChips(up.needs),
        ...(up.item ? [{ icon: `item_${up.item}_0`, text: ITEM_SHORT[up.item], ok: town.items.includes(up.item), tip: `the ${ITEMS[up.item].name}: ${town.items.includes(up.item) ? `"${ITEMS[up.item].line}"` : ITEMS[up.item].from}` }] : []),
        ...(up.task ? [{ icon: TASK_ICON[up.task], text: TASK_SHORT[up.task], ok: town.tasks.includes(up.task), tip: TASKS[up.task] }] : []),
      ];
      this.chips(list, x + 8, y + h - 15);
    }
    const buttons: { label: string; fill: number; act: () => void }[] = [];
    if (id === "market" && stage >= 1) buttons.push({ label: "SHOP", fill: C.woodMid, act: () => (this.close(), s.game.events.emit("toggle-shop")) });
    if (stage < 2) {
      const ready = !upgradeBlocker(town, id, store.materials);
      buttons.push({ label: ready ? "UPGRADE" : "NOT YET", fill: ready ? C.greenBtn : 0x9a93a8, act: () => (ready ? this.upgrade(id) : sfx.deny()) });
    } else {
      const done = ptext(s, 0, y + 7, "GRAND ✓", C.gold, "pxb");
      done.setX(x + w - 8 - measure(done).w);
      this.root.add(done);
    }
    let bx = x + w - 6;
    for (const b of buttons.reverse()) {
      const btn = new Button(s, 0, y + h - 22, b.label, b.fill, b.act, 56);
      bx -= btn.width;
      btn.setX(bx);
      bx -= 4;
      this.root.add(btn);
    }
  }

  private lotCard(home: BuildingId, x: number, y: number, w: number, h: number) {
    const s = this.scene;
    const def = moveInAt(home)!;
    const who = VILLAGER_SHORT[def.villager];
    const lot = store.progress.lots[home] ?? { cleared: [], repaired: false };
    const cap = neighborCap(store.progress.town);
    const free = cap - newNeighborCount(store.progress.movedIn);
    // (Nova, the tutorial, never waits on the Town Hall)
    const room = def.villager === "stargazer" || free > 0;
    const cleared = lot.cleared.length >= def.rubble;
    const g = s.add.graphics();
    pixBox(g, x, y, w, h, C.paperLight, C.paperDark);
    const name = ptext(s, x + 8, y + 6, `The old ${BUILDINGS[home].name}`, C.ink, "pxb");
    const line = ptext(s, x + 8, y + 19, `Repair it and ${who} moves right in.`, C.inkSoft, "sm");
    this.root.add([g, name, line]);
    const list: Chip[] = [
      { text: `Rubble ${Math.min(lot.cleared.length, def.rubble)}/${def.rubble}`, ok: cleared, tip: "Press E by each heap of rubble on the lot" },
      ...this.materialChips(def.repair),
      ...(def.villager === "stargazer" ? [] : [{ icon: "item_room_0", text: room ? `${free} room${free === 1 ? "" : "s"} free` : "No room", ok: room, tip: room ? "The Town Hall has room for them" : "The Town Hall is full: upgrade it to make room (E at the Town Hall)" }]),
    ];
    this.chips(list, x + 8, y + h - 15);
    const ready = cleared && room && MATERIALS.every((m) => (def.repair[m] ?? 0) <= store.materials[m]);
    const btn = new Button(s, 0, y + h - 22, ready ? "REPAIR" : "NOT YET", ready ? C.greenBtn : 0x9a93a8, () => {
      if (!ready) return sfx.deny();
      net.send({ type: "repair_lot", building: home });
      sfx.hammer();
      this.close();
    }, 56);
    btn.setX(x + w - 6 - btn.width);
    this.root.add(btn);
  }

  private upgrade(id: LandmarkId) {
    net.send({ type: "upgrade", landmark: id });
    sfx.hammer();
    // (stays open: the card redraws with the new stage)
  }
}
