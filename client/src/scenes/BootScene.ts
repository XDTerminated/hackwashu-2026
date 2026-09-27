import Phaser from "phaser";
import { buildFonts } from "../font";
import { buildPixelLogo } from "../logoart";
import { buildTextures, buildAnims } from "../textures";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create() {
    buildTextures(this);
    buildAnims(this);
    buildFonts(this);
    buildPixelLogo(this, "logo");
    this.scene.start("Title");
  }
}
