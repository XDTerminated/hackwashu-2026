import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { TitleScene } from "./scenes/TitleScene";
import { GameScene } from "./scenes/GameScene";
import { UIScene } from "./scenes/UIScene";
import { OfficeScene } from "./scenes/OfficeScene";
import * as net from "./net";
import { initChatter } from "./chatter";
import { initPanel } from "./panel";
import { initMoonPad } from "./tablet";
import { initTextInput } from "./textinput";

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

initTextInput();
initPanel();
initMoonPad();
initChatter();
net.connect();

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
  scene: [BootScene, TitleScene, GameScene, OfficeScene, UIScene],
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const f = fitToWindow();
    game.scale.setZoom(f.zoom);
    game.scale.resize(f.width, f.height);
    // Screen-space scenes lay themselves out from the new size.
    for (const key of ["UI", "Title"]) if (game.scene.isActive(key)) game.scene.getScene(key).scene.restart();
  }, 120);
});

if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
