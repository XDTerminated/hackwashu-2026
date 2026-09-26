import Phaser from "phaser";
import { buildFonts, buildLogo } from "../font";
import { buildTextures, buildAnims } from "../textures";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create() {
    buildTextures(this);
    buildAnims(this);
    buildFonts(this);
    buildLogo(this, "logo", "FL-AI ME\nTO THE MOON", "#f5c542", "#3b2a3a", "#1a1030", [2, 1]);
    this.scene.start("Title");
  }
}
