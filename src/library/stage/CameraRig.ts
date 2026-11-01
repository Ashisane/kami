import { MathUtils, Vector3 } from 'three';
import type { Box3, PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const CAMERA_ANGLES = {
  hero: { azimuth: 32, elevation: 28 },
  front: { azimuth: 0, elevation: 4 },
  side: { azimuth: 90, elevation: 4 },
  back: { azimuth: 180, elevation: 12 },
  top: { azimuth: 0, elevation: 89 },
} as const;

export type CameraAngle = keyof typeof CAMERA_ANGLES;

const GLIDE_SPEED = 7;

/** Orbit camera that glides between framings, and gives way the moment you grab it. */
export class CameraRig {
  readonly controls: OrbitControls;
  private readonly goalPosition = new Vector3();
  private readonly goalTarget = new Vector3();
  private readonly center = new Vector3(0, 0.4, 0);
  private distance = 6;
  private gliding = false;
  private angle: CameraAngle = 'hero';

  constructor(
    private readonly camera: PerspectiveCamera,
    element: HTMLElement,
  ) {
    this.controls = new OrbitControls(camera, element);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = Math.PI * 0.497;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 24;
    this.controls.addEventListener('start', () => (this.gliding = false));
    this.view('hero', true);
  }

  /** Frames a box. Below 1 frames tighter, for flat subjects whose corners can sit off screen. */
  frame(bounds: Box3, tightness = 1, instant = false): number {
    const size = bounds.getSize(new Vector3());
    bounds.getCenter(this.center);
    const radius = Math.max(0.35, size.length() / 2);
    const halfFov = MathUtils.degToRad(this.camera.fov / 2);
    this.distance = (radius / Math.sin(halfFov)) * 1.15 * tightness;
    this.controls.maxDistance = Math.max(24, this.distance * 2);
    this.view(this.angle, instant);
    return this.distance;
  }

  /** Multiplies the framing distance. Values above 1 move closer, for inspecting grain. */
  zoom(factor: number): void {
    this.distance /= factor;
  }

  view(angle: CameraAngle, instant = false): void {
    this.angle = angle;
    const { azimuth, elevation } = CAMERA_ANGLES[angle];
    const a = MathUtils.degToRad(azimuth);
    const e = MathUtils.degToRad(elevation);
    this.goalTarget.copy(this.center);
    this.goalPosition
      .set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e))
      .multiplyScalar(this.distance)
      .add(this.center);
    if (instant) {
      this.camera.position.copy(this.goalPosition);
      this.controls.target.copy(this.goalTarget);
      this.gliding = false;
      this.controls.update();
    } else {
      this.gliding = true;
    }
  }

  /** Looks at a point from any direction, for screenshots that match a reference. */
  aim(target: readonly [number, number, number], azimuth: number, elevation: number): void {
    this.center.fromArray(target);
    const a = MathUtils.degToRad(azimuth);
    const e = MathUtils.degToRad(elevation);
    this.camera.position
      .set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e))
      .multiplyScalar(this.distance)
      .add(this.center);
    this.controls.target.copy(this.center);
    this.gliding = false;
    this.controls.update();
  }

  update(dt: number): void {
    if (this.gliding) {
      const k = 1 - Math.exp(-GLIDE_SPEED * dt);
      this.camera.position.lerp(this.goalPosition, k);
      this.controls.target.lerp(this.goalTarget, k);
      if (this.camera.position.distanceToSquared(this.goalPosition) < 1e-5) this.gliding = false;
    }
    this.controls.update();
  }
}
