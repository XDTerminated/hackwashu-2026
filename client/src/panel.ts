// The dialogue box — talking to villagers (giving them tasks), reading
// approval letters, peeking at thoughts, building. Drawn in-game on the
// pixel grid; a hidden <input> handles typing, paste and IME.

import Phaser from "phaser";
import type { Approval, VillagerId } from "../../shared/game";
import { CHORE_EVERY_MIN, VILLAGER_NAMES, VILLAGER_SERVICE } from "../../shared/game";
import { sanitize } from "./font";
import * as net from "./net";
import { sfx } from "./sfx";
import { store } from "./store";
import { closeMoonPad } from "./tablet";
import { claimInput, input, releaseInput, type InputOwner } from "./textinput";
import { Button, C, Label, fit, measure, woodFrame } from "./widgets";

type Kind = "you" | "them" | "sys" | "title" | "letter";
interface ButtonSpec {
  label: string;
  kind?: string;
  onClick: () => void;
}

const EXAMPLES: Partial<Record<VillagerId, string>> = {
  jade_rabbit: 'try: "Tell Prof. Vega I\'ll come to office hours Tuesday and put it on my calendar"',
  postmaster: 'try: "What\'s in my inbox?"',
  timekeeper: 'try: "Am I free Tuesday afternoon?"',
  stargazer: 'try: "When is the next full moon?"',
};


const CHORE_WHAT: Partial<Record<VillagerId, string>> = {
  postmaster: "peek at your unread mail",
  timekeeper: "check your next 24 hours",
  scholar: "check what's due in the next 3 days",
  stargazer: "find a bit of today's space news",
};

class Dialog {
  private root: Phaser.GameObjects.Container;
  private g: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.BitmapText;
  private closeHint: Phaser.GameObjects.BitmapText;
  private content: Phaser.GameObjects.Container;
  private maskG: Phaser.GameObjects.Graphics;
  private inputG: Phaser.GameObjects.Graphics;
  private inputT: Phaser.GameObjects.BitmapText;
  private cursor: Phaser.GameObjects.Rectangle;
  private send: Button;
  private buttons: Button[] = [];
  private items: Label[] = [];
  private typing: Label | null = null;
  private scrollY = 0;
  private contentH = 0;
  private area = { x: 0, y: 0, w: 0, h: 0 };
  private baseAreaH = 0;
  private onSubmit: ((text: string) => void) | null = null;
  private secret = false;
  private placeholder = "Ask them to do something on Earth...";
  private box = { x: 0, y: 0, w: 0, h: 0 };
  talkMode = false;
  private owner: InputOwner = {
    render: () => this.renderInput(),
    submit: () => this.submit(),
    active: () => this.talkMode && this.visible,
  };

  constructor(private scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(5000).setVisible(false);
    this.g = scene.make.graphics({}, false);
    this.title = scene.make.bitmapText({ font: "pxb", text: "" }, false).setTint(C.cream);
    this.closeHint = scene.make.bitmapText({ font: "px", text: "x esc" }, false).setTint(C.paper);
    this.content = scene.make.container({}, false);
    this.maskG = scene.make.graphics({}, false);
    this.content.setMask(this.maskG.createGeometryMask());
    this.inputG = scene.make.graphics({}, false);
    this.inputT = scene.make.bitmapText({ font: "px", text: "" }, false);
    this.cursor = new Phaser.GameObjects.Rectangle(scene, 0, 0, 1, 9, C.ink).setOrigin(0);
    this.send = new Button(scene, 0, 0, "SEND", C.woodMid, () => this.submit(), 34);
    this.root.add([this.g, this.title, this.closeHint, this.content, this.inputG, this.inputT, this.cursor, this.send]);

    this.closeHint.setInteractive({ useHandCursor: true }).on("pointerdown", () => closePanel());
    scene.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!this.root.visible) return;
      this.scrollY += dy > 0 ? 11 : -11;
      this.clampScroll();
    });
    scene.time.addEvent({ delay: 480, loop: true, callback: () => this.cursor.setVisible(this.talkMode && !this.cursor.visible) });
    this.layout();
  }

  get visible() {
    return this.root.visible;
  }

  layout() {
    const W = this.scene.scale.width;
    const H = this.scene.scale.height;
    const w = Math.min(330, W - 16);
    const h = Math.min(156, H - 30);
    const x = Math.round((W - w) / 2);
    const y = H - h - 6;
    this.box = { x, y, w, h };
    this.area = { x: x + 9, y: y + 22, w: w - 18, h: h - 22 - 26 };
    this.baseAreaH = this.area.h;
    this.g.clear();
    woodFrame(this.g, x, y, w, h);
    this.g.fillStyle(C.woodMid, 1).fillRect(x + 4, y + 4, w - 8, 14);
    this.g.fillStyle(C.woodLight, 1).fillRect(x + 4, y + 4, w - 8, 1);
    this.title.setPosition(x + 9, y + 7);
    this.closeHint.setPosition(x + w - 9 - measure(this.closeHint).w, y + 7);
    this.maskG.clear().fillStyle(0xffffff, 1).fillRect(this.area.x, this.area.y, this.area.w, this.area.h);
    const fy = y + h - 22;
    this.send.setPosition(x + w - 9 - 34, fy);
    this.inputG.clear();
    this.inputG.fillStyle(C.paperDark, 1).fillRect(x + 9, fy, w - 18 - 38, 15);
    this.inputG.fillStyle(C.paperLight, 1).fillRect(x + 10, fy + 1, w - 20 - 38, 13);
    this.inputT.setPosition(x + 13, fy + 4);
    this.relayoutItems();
    this.placeButtons();
  }

  open(title: string, talk: boolean, opts: { placeholder?: string; secret?: boolean; onSubmit?: (text: string) => void } = {}) {
    this.clear();
    this.onSubmit = opts.onSubmit ?? null;
    this.secret = !!opts.secret;
    this.placeholder = opts.placeholder ?? "Ask them to do something on Earth...";
    this.setAreaHeight(this.baseAreaH);
    this.title.setText(sanitize(title));
    this.talkMode = talk;
    this.inputG.setVisible(talk);
    this.inputT.setVisible(talk);
    this.cursor.setVisible(talk);
    this.send.setVisible(talk);
    this.root.setVisible(true);
    if (talk) claimInput(this.owner);
    else releaseInput(this.owner);
    this.renderInput();
  }

  close() {
    this.root.setVisible(false);
    this.talkMode = false;
    releaseInput(this.owner);
    this.clear();
  }

  private clear() {
    this.items.forEach((i) => i.destroy());
    this.items = [];
    this.typing = null;
    this.buttons.forEach((b) => b.destroy());
    this.buttons = [];
    this.scrollY = 0;
    this.contentH = 0;
  }

  add(kind: Kind, text: string) {
    const w = this.area.w;
    let l: Label;
    if (kind === "you") l = new Label(this.scene, 0, 0, text, { bg: 0xe6c189, border: 0xc9975a, maxWidth: w - 40, originX: 1, originY: 0, align: "left" });
    else if (kind === "them") l = new Label(this.scene, 0, 0, text, { bg: C.paperLight, border: C.paperDark, maxWidth: w - 40, originX: 0, originY: 0, align: "left" });
    else if (kind === "title") l = new Label(this.scene, 0, 0, text, { bg: null, border: null, font: "pxb", color: C.coral, maxWidth: w, originX: 0, originY: 0, align: "left", padX: 0 });
    else if (kind === "letter") l = new Label(this.scene, 0, 0, text, { bg: 0xfffaf0, border: C.paperDark, maxWidth: w - 10, originX: 0, originY: 0, align: "left", padX: 4 });
    else l = new Label(this.scene, 0, 0, text, { bg: null, border: null, color: C.inkSoft, maxWidth: w - 8, originX: 0.5, originY: 0, align: "center" });
    (l as Label & { kind?: Kind }).kind = kind;
    this.content.add(l);
    this.items.push(l);
    this.relayoutItems();
    if (this.talkMode) this.scrollToEnd();
    return l;
  }

  showTyping() {
    this.hideTyping();
    this.typing = this.add("them", ". . .");
  }

  hideTyping() {
    if (!this.typing) return;
    this.items = this.items.filter((i) => i !== this.typing);
    this.typing.destroy();
    this.typing = null;
    this.relayoutItems();
  }

  /** Buttons sit on the footer; with a text field too, they get their own row above it. */
  private setAreaHeight(h: number) {
    this.area.h = h;
    this.maskG.clear().fillStyle(0xffffff, 1).fillRect(this.area.x, this.area.y, this.area.w, this.area.h);
    this.clampScroll();
  }

  setButtons(specs: ButtonSpec[]) {
    this.setAreaHeight(this.talkMode && specs.length ? this.baseAreaH - 19 : this.baseAreaH);
    this.buttons.forEach((b) => b.destroy());
    this.buttons = specs.map((s) => {
      const b = new Button(this.scene, 0, 0, s.label, s.kind === "ok" ? C.greenBtn : C.woodMid, s.onClick, 40);
      this.root.add(b);
      return b;
    });
    this.placeButtons();
  }

  private placeButtons() {
    let x = this.box.x + this.box.w - 9;
    const y = this.box.y + this.box.h - 22 - (this.talkMode ? 19 : 0);
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      x -= b.width_;
      b.setPosition(x, y);
      x -= 5;
    }
  }

  private relayoutItems() {
    let y = 0;
    for (const l of this.items) {
      const kind = (l as Label & { kind?: Kind }).kind;
      const x = kind === "you" ? this.area.w : kind === "sys" ? Math.round(this.area.w / 2) : 0;
      l.setPosition(x, y);
      y += l.boxH + 4;
    }
    this.contentH = y;
    this.clampScroll();
  }

  private scrollToEnd() {
    this.scrollY = this.contentH;
    this.clampScroll();
  }

  private clampScroll() {
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, Math.max(0, this.contentH - this.area.h));
    this.content.setPosition(this.area.x, this.area.y - Math.round(this.scrollY));
  }

  renderInput() {
    const maxW = this.box.w - 20 - 38 - 8;
    const raw = this.secret ? "*".repeat(input.value.length) : input.value;
    if (!raw) {
      this.inputT.setText(fit(this.scene, this.placeholder, maxW)).setTint(0xb09a78);
      this.cursor.setPosition(this.inputT.x, this.inputT.y - 1);
      return;
    }
    let s = sanitize(raw);
    this.inputT.setTint(C.ink).setText(s);
    while (s.length > 1 && measure(this.inputT).w > maxW) this.inputT.setText((s = s.slice(1)));
    this.cursor.setPosition(this.inputT.x + measure(this.inputT).w + 1, this.inputT.y - 1);
  }

  submit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    this.renderInput();
    if (this.onSubmit) return this.onSubmit(text);
    if (!talkingTo) return;
    this.add("you", text);
    sfx.blip();
    if (net.send({ type: "task", villager: talkingTo, text })) this.showTyping();
    else this.add("sys", "The line to the colony server is down - start it with npm run dev:server.");
  }
}

let dialog: Dialog | null = null;
let talkingTo: VillagerId | null = null;
/** The villager whose account we're connecting in the open dialog, if any. */
let callingFor: VillagerId | null = null;
let toggleCb: (open: boolean) => void = () => {};

/** Called by the UI scene; re-mounting after a resize keeps callers working. */
export function mountPanel(scene: Phaser.Scene) {
  dialog = new Dialog(scene);
}

/** Tell the game a screen is open (freezes the player) or closed. Shared with the MoonPad. */
export function setUiOpen(open: boolean) {
  toggleCb(open);
}

export function initPanel() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isPanelOpen()) closePanel();
  });

  net.onNotice((text) => {
    if (dialog?.visible && callingFor) dialog.add("sys", text);
  });

  net.onEvent((e) => {
    if (e.type === "chore_optin" && dialog?.visible && talkingTo) {
      choreToggle(talkingTo);
      dialog.add("sys", store.choreOptIn[talkingTo] ? "Chores ON - first round in about a minute." : "Chores OFF.");
      return;
    }
    if (e.type === "villager_arrived" && dialog?.visible && callingFor === e.villager) {
      dialog.add("sys", `Signal received! The ${VILLAGER_NAMES[e.villager]} is landing.`);
      setTimeout(closePanel, 1600);
      return;
    }
    if (!dialog?.visible || !talkingTo) return;
    if (e.type === "say" && e.villager === talkingTo) {
      dialog.hideTyping();
      dialog.add("them", e.text);
      sfx.message();
    } else if (e.type === "handoff" && e.from === talkingTo) {
      dialog.hideTyping();
      dialog.add("sys", `-> handed to ${VILLAGER_NAMES[e.to]}: "${e.text.slice(0, 80)}${e.text.length > 80 ? "..." : ""}"`);
      dialog.showTyping();
    } else if (e.type === "approval_needed") {
      dialog.add("sys", `! ${VILLAGER_NAMES[e.villager]} is walking a letter to your house for your OK.`);
    }
  });
}

export function onPanelToggle(cb: (open: boolean) => void) {
  toggleCb = cb;
}

export function isPanelOpen() {
  return !!dialog?.visible;
}

/** The opt-in "chores" checkbox: honest about the fact that it spends real API calls. */
function choreToggle(v: VillagerId) {
  if (!dialog || !CHORE_WHAT[v]) return;
  const on = !!store.choreOptIn[v];
  dialog.setButtons([
    {
      label: on ? "[x] CHORES" : "[ ] CHORES",
      kind: on ? "ok" : "",
      onClick: () => net.send({ type: "set_chore_optin", villager: v, enabled: !store.choreOptIn[v] }),
    },
  ]);
}

export function openTalk(v: VillagerId, greeting: string) {
  if (!dialog) return;
  closeMoonPad();
  talkingTo = v;
  callingFor = null;
  dialog.open(VILLAGER_NAMES[v].toUpperCase(), true);
  dialog.add("them", greeting);
  if (CHORE_WHAT[v]) {
    dialog.add("sys", `Chores: when idle, the ${VILLAGER_NAMES[v]} will ${CHORE_WHAT[v]} on their own about every ${CHORE_EVERY_MIN} min. Each round uses REAL API calls.`);
    choreToggle(v);
  }
  // The Rabbit's example is a team job — only useful once she can coordinate.
  if (EXAMPLES[v] && (v !== "jade_rabbit" || store.rabbitTeamwork)) dialog.add("sys", EXAMPLES[v]!);
  toggleCb(true);
}

export function openLetter(a: Approval) {
  if (!dialog) return;
  closeMoonPad();
  talkingTo = null;
  callingFor = null;
  dialog.open(`✉ LETTER FROM ${VILLAGER_NAMES[a.villager].toUpperCase()}`, false);
  dialog.add("sys", "This needs your OK before it leaves the Moon.");
  dialog.add("title", a.title);
  dialog.add("letter", a.body);
  dialog.setButtons([
    {
      label: "APPROVE",
      kind: "ok",
      onClick: () => {
        net.send({ type: "approve", approvalId: a.id, approved: true });
        sfx.buy();
        closePanel();
      },
    },
    {
      label: "HOLD IT",
      onClick: () => {
        net.send({ type: "approve", approvalId: a.id, approved: false });
        sfx.deny();
        closePanel();
      },
    },
  ]);
  toggleCb(true);
}

export function openInfo(title: string, lines: string[], buttons: ButtonSpec[] = []) {
  if (!dialog) return;
  closeMoonPad();
  talkingTo = null;
  callingFor = null;
  dialog.open(title, false);
  for (const l of lines) dialog.add("them", l);
  dialog.setButtons(buttons);
  toggleCb(true);
}

/**
 * "Call" a villager who's still on Earth: their house is built, and connecting
 * their real account is what brings them to the Moon.
 */
export function openConnect(v: VillagerId) {
  const service = VILLAGER_SERVICE[v];
  if (!dialog || !service || service === "web") return;
  closeMoonPad();
  const name = VILLAGER_NAMES[v];
  talkingTo = null;
  callingFor = v;
  const sampleButton = {
    label: "USE SAMPLE DATA",
    onClick: () => {
      net.send({ type: "use_sandbox", service });
      dialog?.add("sys", "OK - they'll practice on sample data until you connect for real.");
    },
  };

  if (service === "google") {
    dialog.open(`CALL THE ${name.toUpperCase()}`, false);
    dialog.add(
      "them",
      v === "postmaster"
        ? "The Postmaster is still on Earth, waiting for a signal. Connect your Google account and they'll land with your Gmail: reading, summarizing and drafting replies. Nothing gets sent without your OK."
        : "The Timekeeper is waiting for a signal from Earth. Connect your Google account so they can read your calendar and book events (you approve every booking).",
    );
    if (!store.connections.google.configured) dialog.add("sys", "Host setup needed first: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env (see README).");
    dialog.setButtons([
      {
        label: "CONNECT GOOGLE",
        kind: "ok",
        onClick: () => {
          window.open(`http://${location.hostname || "localhost"}:8787/connect/google`, "_blank");
          dialog?.add("sys", "Finish signing in with Google in the new tab, then come back here.");
        },
      },
      sampleButton,
    ]);
  } else {
    dialog.open(`CALL THE ${name.toUpperCase()}`, true, {
      placeholder: "Paste your Canvas access token...",
      secret: true,
      onSubmit: (token) => {
        net.send({ type: "connect_canvas", token });
        dialog?.add("sys", "Checking that token with Canvas...");
      },
    });
    dialog.add(
      "them",
      "The Scholar needs a line to your Canvas. In Canvas (wustl.instructure.com): Account > Settings > + New Access Token. Paste it below. Read-only - the Scholar never submits anything.",
    );
    dialog.setButtons([sampleButton]);
  }
  toggleCb(true);
}

export function closePanel() {
  if (!dialog?.visible) return;
  dialog.close();
  talkingTo = null;
  callingFor = null;
  toggleCb(false);
}
