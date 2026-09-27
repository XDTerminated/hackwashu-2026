// The dialogue box — talking to villagers (giving them tasks), reading
// approval letters, peeking at thoughts, building. Drawn in-game on the
// pixel grid; a hidden <input> handles typing, paste and IME.

import Phaser from "phaser";
<<<<<<< Updated upstream
import type { Approval, VillagerId } from "../../shared/game";
import { CHORE_EVERY_MIN, VILLAGER_NAMES, VILLAGER_SERVICE } from "../../shared/game";
import { sanitize } from "./font";
=======
import type { Approval, OfficeProvider, OfficeWorker, VillagerId } from "../../shared/game";
import { CHORE_EVERY_MIN, MAX_HEARTS, VILLAGER_NAMES, VILLAGER_SERVICE, heartsFor } from "../../shared/game";
import { FONT_METRICS, sanitize } from "./font";
import { listen, micSupported, type Listening } from "./mic";
>>>>>>> Stashed changes
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
      dialog.add("sys", `Signal received! ${VILLAGER_NAMES[e.villager]} is landing.`);
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
<<<<<<< Updated upstream
  dialog.setButtons([
    {
      label: on ? "[x] CHORES" : "[ ] CHORES",
      kind: on ? "ok" : "",
      onClick: () => net.send({ type: "set_chore_optin", villager: v, enabled: !store.choreOptIn[v] }),
    },
  ]);
=======
  dialog.setSide({
    label: on ? "[x] CHORES" : "[ ] CHORES",
    kind: on ? "ok" : "",
    tip: `When idle, ${VILLAGER_NAMES[v]} will ${CHORE_WHAT[v]} on their own about every ${CHORE_EVERY_MIN} min. Each round uses REAL API calls.`,
    onClick: () => net.send({ type: "set_chore_optin", villager: v, enabled: !store.choreOptIn[v] }),
  });
>>>>>>> Stashed changes
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
        ? "Hoot the Postmaster is still on Earth, waiting for a signal. Connect your Google account and they'll land with your Gmail: reading, summarizing and drafting replies. Nothing gets sent without your OK."
        : "Cog the Timekeeper is waiting for a signal from Earth. Connect your Google account so they can read your calendar and book events (you approve every booking).",
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
      "Mabel the Scholar needs a line to your Canvas. In Canvas (wustl.instructure.com): Account > Settings > + New Access Token. Paste it below. Read-only - Mabel never submits anything.",
    );
    dialog.setButtons([sampleButton]);
  }
  toggleCb(true);
}

export function closePanel() {
  if (!dialog?.visible) return;
  officeView = null;
  dialog.close();
  talkingTo = null;
  callingFor = null;
  toggleCb(false);
}

// ---------------------------------------------------------------- the office

let officeView: { kind: "board"; status: string; keys: string } | { kind: "worker"; id: string; now: Label | null } | { kind: "connect"; keys: string } | null = null;
let officeProvider: OfficeProvider | null = null;
let officeWired = false;

const excerpt = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 3).trimEnd()}...` : t);
const reportUrl = (id: string) => `http://${location.hostname || "localhost"}:8787/office/${id}`;
const serverUrl = (path: string) => `http://${location.hostname || "localhost"}:8787${path}`;
/** A fingerprint of which AIs are connected (and OpenRouter's model), to know when to redraw. */
const keysSig = () => store.office.providers.map((p) => `${p.id}:${p.available}:${p.masked}:${p.model}`).join("|");

/** Where to get each key, shown on the connect screen. */
const HOW_TO_CONNECT: Record<OfficeProvider, string> = {
  openrouter: "One click: sign in and it works with Claude, GPT, Gemini and some free models.",
  groq: "Free key: console.groq.com/keys",
  gemini: "Free key: aistudio.google.com/apikey",
  openai: "Paid key: platform.openai.com/api-keys",
  claude: "Paid key: console.anthropic.com (API keys)",
};

function wireOffice() {
  if (officeWired) return;
  officeWired = true;
  net.onOffice(() => {
    const v = officeView;
    if (!v || !dialog?.visible) return;
    const p = store.office.project;
    if (v.kind === "board") {
      // The brief form stays put while you type; the live view re-renders.
      const status = p?.status ?? "none";
      const running = !!p && !["done", "failed"].includes(p.status);
      if (running || status !== v.status || keysSig() !== v.keys) renderBoard();
    } else if (v.kind === "connect") {
      if (keysSig() !== v.keys) openConnectAI();
    } else {
      const w = p?.workers.find((x) => x.id === v.id);
      if (w && v.now) v.now.setText(workerNow(w));
    }
  });
  net.onOfficeAnswer((workerId, text) => {
    const v = officeView;
    if (v?.kind !== "worker" || v.id !== workerId || !dialog?.visible) return;
    dialog.hideTyping();
    dialog.add("them", text);
    sfx.message();
  });
}

function workerNow(w: OfficeWorker) {
  const state = w.status === "working" ? "working" : w.status === "done" ? "done" : "stuck";
  return excerpt(`Now (${state}): ${w.step}`, 70);
}

/** The project board: brief the team (you're the PM), watch them work, read the result. */
export function openOfficeBoard() {
  if (!dialog) return;
  wireOffice();
  closeMoonPad();
  talkingTo = null;
  callingFor = null;
  renderBoard();
  toggleCb(true);
}

function renderBoard() {
  if (!dialog) return;
  const o = store.office;
  const p = o.project;
  const running = !!p && !["done", "failed"].includes(p.status);
  officeView = { kind: "board", status: p?.status ?? "none", keys: keysSig() };
  const available = o.providers.filter((x) => x.available);
  if (!officeProvider || !available.some((x) => x.id === officeProvider)) officeProvider = available[0]?.id ?? null;

  if (running && p) {
    dialog.open("PROJECT BOARD", false);
    dialog.add("title", excerpt(p.brief, 160));
    const name = o.providers.find((x) => x.id === p.provider)?.name ?? p.provider;
    dialog.add("sys", `Team lead (${name}, ${p.model}): ${p.lead}`);
    if (!p.workers.length) dialog.add("sys", "Planning who to hire...");
    for (const w of p.workers) dialog.add("them", `${w.name} - ${w.role} ${w.status === "done" ? "[done]" : w.status === "failed" ? "[stuck]" : ""}\n${excerpt(w.step, 90)}`);
    dialog.setButtons([]);
    return;
  }

  dialog.open("PROJECT BOARD", true, {
    placeholder: available.length ? "Brief the team: what should they build or research?" : "No LLM is set up on the server",
    onSubmit: (text) => {
      if (!officeProvider) return sfx.deny();
      net.send({ type: "office_start", brief: text, provider: officeProvider });
      sfx.blip();
    },
  });
  if (p?.status === "done") {
    dialog.add("title", `Delivered: ${excerpt(p.brief, 80)}`);
    dialog.add("letter", excerpt(p.result ?? "", 900));
  } else if (p?.status === "failed") {
    dialog.add("sys", `The last project stopped: ${p.error ?? "something went wrong"}.`);
  }
  dialog.add(
    "sys",
    available.length
      ? "You're the project manager. Write a brief below: the team lead splits it up and spins up a worker (a sub-agent) for each piece. Walk up to any desk to check in on them."
      : "Your team needs an AI to think with. Press CONNECT AI to sign in with OpenRouter or paste a key (Groq and Gemini keys are free).",
  );
  const buttons: ButtonSpec[] = available.map((x) => ({
    label: x.id === officeProvider ? `[x] ${x.name.toUpperCase()}` : `[ ] ${x.name.toUpperCase()}`,
    kind: x.id === officeProvider ? "ok" : "",
    onClick: () => {
      officeProvider = x.id;
      sfx.blip();
      renderBoard();
    },
  }));
  const chosen = available.find((x) => x.id === officeProvider);
  if (chosen?.id === "openrouter" && chosen.models?.length) {
    const models = chosen.models;
    const short = chosen.model.split("/").pop()!.replace(/:free$/, " (free)");
    buttons.push({
      label: `MODEL: ${short.length > 22 ? `${short.slice(0, 20)}..` : short}`,
      onClick: () => {
        const next = models[(models.indexOf(chosen.model) + 1) % models.length];
        net.send({ type: "office_model", provider: "openrouter", model: next });
        sfx.blip();
      },
    });
  }
  buttons.push({ label: "CONNECT AI", onClick: () => openConnectAI() });
  if (p?.status === "done") buttons.push({ label: "OPEN REPORT", kind: "ok", onClick: () => window.open(reportUrl(p.id), "_blank") });
  if (p) buttons.push({ label: "CLEAR BOARD", onClick: () => net.send({ type: "office_clear" }) });
  dialog.setButtons(buttons);
}

/** Check in on a worker: what they're on, what they've done, and ask them about it. */
export function openOfficeWorker(id: string) {
  if (!dialog) return;
  wireOffice();
  const w = store.office.project?.workers.find((x) => x.id === id);
  if (!w) return;
  closeMoonPad();
  talkingTo = null;
  callingFor = null;
  dialog.open(`${w.name.toUpperCase()} - ${w.role.toUpperCase()}`, true, {
    placeholder: `Ask ${w.name} how it's going...`,
    onSubmit: (q) => {
      dialog?.add("you", q);
      dialog?.showTyping();
      net.send({ type: "office_ask", workerId: id, question: q });
    },
  });
  dialog.add("title", "Their task");
  dialog.add("letter", excerpt(w.task, 420));
  const now = dialog.add("sys", workerNow(w));
  const recent = w.steps.slice(-6, -1).map((s) => `- ${excerpt(s.text, 70)}`);
  if (recent.length) dialog.add("sys", `Earlier:\n${recent.join("\n")}`);
  if (w.result) dialog.add("them", excerpt(w.result, 500));
  officeView = { kind: "worker", id, now };
  dialog.setButtons([]);
  toggleCb(true);
}

/** Plug your own AI into the Office: OpenRouter sign-in, or paste a key. Keys stay on the server. */
export function openConnectAI() {
  if (!dialog) return;
  wireOffice();
  closeMoonPad();
  talkingTo = null;
  callingFor = null;
  dialog.open("CONNECT YOUR AI", false);
  officeView = { kind: "connect", keys: keysSig() };
  dialog.add("sys", "Bring your own model for the Office. Keys are checked, stored privately on this server, and never shown again.");
  for (const p of store.office.providers) {
    const status = !p.available ? "not connected" : p.source === "you" ? `connected by you (${p.masked})` : `connected on the server (${p.masked})`;
    dialog.add("them", `${p.name}: ${status}\n${HOW_TO_CONNECT[p.id]}`);
  }
  const buttons: ButtonSpec[] = [
    { label: "OPENROUTER SIGN-IN", kind: "ok", onClick: () => window.open(serverUrl("/connect/openrouter"), "_blank") },
    { label: "PASTE A KEY", onClick: () => openPasteKey() },
    ...store.office.providers.filter((p) => p.source === "you").map((p) => ({ label: `DISCONNECT ${p.name.toUpperCase()}`, onClick: () => net.send({ type: "office_disconnect", provider: p.id }) })),
    { label: "BACK", onClick: () => openOfficeBoard() },
  ];
  dialog.setButtons(buttons);
  toggleCb(true);
}

function openPasteKey(provider?: OfficeProvider) {
  if (!dialog) return;
  if (!provider) {
    dialog.open("PASTE A KEY", false);
    officeView = null;
    dialog.add("sys", "Which AI is the key for?");
    const ids: OfficeProvider[] = ["groq", "gemini", "openai", "claude", "openrouter"];
    dialog.setButtons([
      ...ids.map((id) => ({ label: store.office.providers.find((p) => p.id === id)?.name.toUpperCase() ?? id.toUpperCase(), onClick: () => openPasteKey(id) })),
      { label: "BACK", onClick: () => openConnectAI() },
    ]);
    return;
  }
  const name = store.office.providers.find((p) => p.id === provider)?.name ?? provider;
  dialog.open(`${name.toUpperCase()} KEY`, true, {
    secret: true,
    placeholder: `Paste your ${name} API key`,
    onSubmit: (key) => {
      net.send({ type: "office_key", provider, key });
      dialog?.add("sys", "Checking the key...");
      setTimeout(() => openConnectAI(), 1800);
    },
  });
  officeView = null;
  dialog.add("sys", HOW_TO_CONNECT[provider]);
  dialog.setButtons([{ label: "BACK", onClick: () => openConnectAI() }]);
}
