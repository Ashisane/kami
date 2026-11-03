import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { Spring } from '@/core/anim/spring';

/** How far behind the being the camera rides, and how high above its feet it looks. */
const DISTANCE = 3.8;
const LOOK_HEIGHT = 0.7;

/**
 * Rides behind the selected being, looking where the controls say. The point it
 * follows springs, so switching beings glides across the world instead of cutting,
 * with a little overshoot as it arrives.
 */
export class FollowCamera {
  private readonly follow = [new Spring(0, 1.6, 0.85), new Spring(0, 1.6, 0.85), new Spring(0, 1.6, 0.85)] as const;
  private readonly look = new Vector3();
  private readonly offset = new Vector3();

  constructor(private readonly camera: PerspectiveCamera) {}

  /** Jumps straight to a point, with no glide. */
  snap(x: number, z: number): void {
    this.follow[0].snap(x);
    this.follow[1].snap(LOOK_HEIGHT);
    this.follow[2].snap(z);
  }

  /** Moves towards the being, slowly when switching and tightly once there. */
  update(dt: number, x: number, z: number, yaw: number, pitch: number, gliding: boolean): void {
    const [fx, fy, fz] = this.follow;
    for (const spring of this.follow) spring.frequency = gliding ? 1.6 : 6;
    fx.target = x;
    fy.target = LOOK_HEIGHT;
    fz.target = z;
    this.look.set(fx.update(dt), fy.update(dt), fz.update(dt));
    this.offset.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(DISTANCE);
    this.camera.position.copy(this.look).add(this.offset);
    this.camera.position.y = Math.max(0.25, this.camera.position.y);
    this.camera.lookAt(this.look);
  }

  /** How far the camera still is from settling on the being, in metres. */
  lag(x: number, z: number): number {
    return Math.hypot(this.follow[0].value - x, this.follow[2].value - z);
  }
}
