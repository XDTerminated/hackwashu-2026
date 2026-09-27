// Another player on the island (the owner, or a friend visiting): their
// astronaut in their own suit color, their name overhead, and what they say
// in a bubble. They glide to where their game says they are.

import Phaser from "phaser";
import type { Peer } from "../../shared/visit";
import { shadowKey } from "./textures";
import { C, Label } from "./widgets";

const STILL = { down: "astro_0", up: "astro_3", side: "astro_6" } as const;

export class PeerActor {
  readonly sprite: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Image;
  private tag: Label;
  private bubble: Label | null = null;
  private bubbleTimer: Phaser.Time.TimerEvent | null = null;
  private target: { x: number; y: number };
  private peer: Peer;

  constructor(
    private scene: Phaser.Scene,
    peer: Peer,
  ) {
    this.peer = peer;
    this.target = { x: peer.x, y: peer.y };
    this.sprite = scene.add.sprite(peer.x, peer.y, STILL[peer.facing]).setOrigin(0.5, 1);
    if (peer.tint !== 0xffffff) this.sprite.setTint(peer.tint);
    this.shadow = scene.add.image(peer.x, peer.y - 1, shadowKey(scene, 16)).setDepth(-8);
    this.tag = new Label(scene, peer.x, peer.y - 30, peer.owner ? `★ ${peer.name}` : peer.name, { bg: C.outline, border: null, color: peer.owner ? C.gold : C.cream, font: "sm", padX: 3, originY: 1 }).setDepth(99980).setAlpha(0.85);
    this.apply(peer);
  }

  get x() {
    return this.sprite.x;
  }
  get y() {
    return this.sprite.y;
  }
  get name() {
    return this.peer.name;
  }

  apply(peer: Peer) {
    this.peer = peer;
    this.target = { x: peer.x, y: peer.y };
    // (a long way off: they flew, or just arrived; no gliding across the map)
    if (Math.hypot(peer.x - this.sprite.x, peer.y - this.sprite.y) > 220) this.sprite.setPosition(peer.x, peer.y);
    this.sprite.setFlipX(peer.facing === "side" && peer.flip);
    if (peer.moving) this.sprite.anims.play(`walk-${peer.facing}`, true);
    else {
      this.sprite.anims.stop();
      this.sprite.setTexture(STILL[peer.facing]);
    }
  }

  say(text: string) {
    this.bubble?.destroy();
    this.bubbleTimer?.remove();
    this.bubble = new Label(this.scene, this.sprite.x, this.sprite.y - 42, text, { maxWidth: 130, tail: true }).setDepth(99990);
    this.bubbleTimer = this.scene.time.delayedCall(Math.max(3500, text.length * 60), () => {
      this.bubble?.destroy();
      this.bubble = null;
    });
  }

  update(dt: number) {
    const s = this.sprite;
    // Glide toward where they are (their updates come a few times a second).
    const k = Math.min(1, dt * 12);
    s.x += (this.target.x - s.x) * k;
    s.y += (this.target.y - s.y) * k;
    s.setDepth(s.y);
    this.shadow.setPosition(Math.round(s.x), Math.round(s.y) - 1);
    this.tag.place(Math.round(s.x), Math.round(s.y) - 30);
    this.bubble?.place(Math.round(s.x), Math.round(s.y) - 42);
  }

  destroy() {
    this.bubbleTimer?.remove();
    this.bubble?.destroy();
    this.tag.destroy();
    this.shadow.destroy();
    this.sprite.destroy();
  }
}
