import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { TitleScene } from "./scenes/TitleScene";
import { GameScene } from "./scenes/GameScene";
import { UIScene } from "./scenes/UIScene";
import { OfficeScene } from "./scenes/OfficeScene";
import { IntroScene } from "./scenes/IntroScene";
import { EndingScene } from "./scenes/EndingScene";
import * as net from "./net";
import { initChatter } from "./chatter";
import { startMusic } from "./music";
import { initPanel } from "./panel";
import { initMoonPad } from "./tablet";
import { initTextInput } from "./textinput";
import { closePanel } from "./panel";
import { closeMoonPad } from "./tablet";
import type { Cutscene } from "./scenes/Cutscene";

/**
 * Pixel-perfect sizing: the game renders at art resolution (1 canvas pixel =
 * 1 art pixel) and the canvas is upscaled by a whole number, so every pixel
 * on screen — sprites, text, UI — is exactly the same size.
 */
function fitToWindow() {
  const zoom = Math.max(1, Math.floor(window.innerHeight / 260));
  return {
    zoom,
    width: Math.ceil(window.innerWidth / zoom),
    height: Math.ceil(window.innerHeight / zoom),
  };
}

// ?fresh forgets this browser's "seen it" flags (intro, tips), for a brand-new start.
if (new URLSearchParams(location.search).has("fresh")) {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("moon-") && !k.endsWith("-muted")) localStorage.removeItem(k);
  } catch {
    /* nothing stored */
  }
  history.replaceState(null, "", location.pathname);
}

// Music is on by default: it starts with your first key press or click
// (browsers don't allow sound before that).
for (const type of ["pointerdown", "keydown"] as const) window.addEventListener(type, () => startMusic(), { once: true });

initTextInput();
initPanel();
initMoonPad();
initChatter();
net.start();

const initial = fitToWindow();
const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: "game",
  width: initial.width,
  height: initial.height,
  backgroundColor: "#0b0a1a",
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: initial.zoom,
  },
  scene: [BootScene, TitleScene, IntroScene, EndingScene, GameScene, OfficeScene, UIScene],
});

let resizeTimer = 0;
let relayoutOnWake = false;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const f = fitToWindow();
    game.scale.setZoom(f.zoom);
    game.scale.resize(f.width, f.height);
    // Screen-space scenes lay themselves out from the new size. Windows close
    // first (cleanly), and a cutscene picks up at the shot it was on.
    closePanel();
    closeMoonPad();
    for (const key of ["UI", "Title"]) if (game.scene.isActive(key)) game.scene.getScene(key).scene.restart();
    const ui = game.scene.getScene("UI");
    if (ui?.sys.isSleeping() && !relayoutOnWake) {
      relayoutOnWake = true;
      ui.events.once(Phaser.Scenes.Events.WAKE, () => {
        relayoutOnWake = false;
        ui.scene.restart();
      });
    }
    for (const key of ["Intro", "Ending"])
      if (game.scene.isActive(key)) {
        const s = game.scene.getScene(key) as Cutscene;
        s.scene.restart({ ...(s.sys.settings.data as object), from: s.current });
      }
  }, 120);
});

if (import.meta.env.DEV || location.search.includes("debug")) (window as unknown as { __game: Phaser.Game }).__game = game;
