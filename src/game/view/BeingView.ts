import type { AnimationAction } from 'three';
import { Spring } from '@/core/anim/spring';
import { instantiate } from '@/core/asset/AssetInstance';
import type { AssetInstance } from '@/core/asset/AssetInstance';
import { getAsset } from '@/core/asset/registry';
import type { StockId } from '@/core/paper/stocks';
import type { Action, Being } from '../sim/GameSim';
import { RULES } from '../sim/rules';

const ASSET = 'character.being';
/** Clips that play once and hold their last frame; the rest loop. */
const ONCE: ReadonlySet<Action> = new Set(['reach', 'press', 'stumble', 'jump']);
const FADE = 0.14;

/**
 * Draws one being from the sim. It only uses the asset's id, paint slot and clip
 * names, so a Blender model can replace the blockout with nothing here changing.
 */
export class BeingView {
  private current: Action | null = null;
  private action: AnimationAction | null = null;
  /** Squash on a change of action, springing back: the body takes each new effort. */
  private readonly squash = new Spring(1, 4.5, 0.32);

  private constructor(readonly instance: AssetInstance) {}

  static async create(stock: StockId): Promise<BeingView> {
    const instance = await instantiate(getAsset(ASSET));
    instance.paint('body', stock);
    return new BeingView(instance);
  }

  update(being: Being, action: Action, dt: number): void {
    const { root } = this.instance;
    root.position.set(being.x, being.y, being.z);
    root.rotation.y = being.facing;
    if (action !== this.current) {
      this.action = this.instance.play(action, { loop: !ONCE.has(action), fade: FADE });
      this.current = action;
      this.squash.kick(action === 'press' || action === 'stumble' ? -3 : -1.2);
    }
    // Walk and run cycles keep pace with the feet.
    if (this.action && (action === 'walk' || action === 'run')) {
      const speed = Math.hypot(being.vx, being.vz);
      this.action.timeScale = Math.max(0.6, speed / (action === 'run' ? RULES.runSpeed : RULES.walkSpeed));
    }
    const s = this.squash.update(dt);
    root.scale.set(1 + (1 - s) * 0.5, s, 1 + (1 - s) * 0.5);
    this.instance.update(dt);
  }

  /** Feet back on the ground: the body squashes under its own fall and springs back. */
  land(): void {
    this.squash.kick(-3.4);
  }

  dispose(): void {
    this.instance.dispose();
  }
}
