import type { PerspectiveCamera } from 'three';

const MAX_OFFSET_PX = 16;
const MAX_ROLL = 0.012;
const DECAY_PER_SECOND = 1.7;

/**
 * Trauma-based screen shake: strength is trauma squared, so light hits stay
 * subtle and big hits really land. Works by offsetting the view, so it cannot
 * fight whatever is moving the camera.
 */
export class Shake {
  private trauma = 0;
  private time = 0;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  apply(camera: PerspectiveCamera, dt: number, width: number, height: number): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - DECAY_PER_SECOND * dt);
    const strength = this.trauma * this.trauma;
    if (strength <= 0) {
      if (camera.view?.enabled) camera.clearViewOffset();
      return;
    }
    const t = this.time * 38;
    const x = (Math.sin(t) + Math.sin(t * 2.3 + 1.3)) * 0.5 * MAX_OFFSET_PX * strength;
    const y = (Math.sin(t * 1.3 + 4.1) + Math.sin(t * 2.9)) * 0.5 * MAX_OFFSET_PX * strength;
    camera.setViewOffset(width, height, x, y, width, height);
    camera.rotateZ(Math.sin(t * 0.7) * MAX_ROLL * strength);
  }
}
