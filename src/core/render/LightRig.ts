import { Color, DirectionalLight, Fog, Group, HemisphereLight, MathUtils, Vector3 } from 'three';
import type { Scene } from 'three';
import type { LightingPreset } from './lighting';

const SUN_DISTANCE = 30;

export class LightRig {
  readonly group = new Group();
  private readonly sun = new DirectionalLight();
  private readonly fill = new DirectionalLight();
  private readonly sky = new HemisphereLight();
  private readonly focus = new Vector3();
  private radius = 3;
  private preset: LightingPreset | null = null;

  constructor(private readonly scene: Scene) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = SUN_DISTANCE * 2;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.005;
    this.group.add(this.sun, this.sun.target, this.fill, this.fill.target, this.sky);
    scene.add(this.group);
    scene.background = new Color();
    scene.fog = new Fog(0xffffff, 12, 26);
  }

  apply(preset: LightingPreset): void {
    this.preset = preset;
    this.sun.color.set(preset.sunColor);
    this.sun.intensity = preset.sunIntensity;
    this.sun.shadow.radius = preset.shadowSoftness;
    this.sky.color.set(preset.skyColor);
    this.sky.groundColor.set(preset.groundColor);
    this.sky.intensity = preset.skyIntensity;
    this.fill.color.set(preset.skyColor);
    this.fill.intensity = preset.fillIntensity;
    (this.scene.background as Color).set(preset.background);
    this.scene.fog?.color.set(preset.background);
    this.place();
  }

  /** Keeps the far desk fading away without ever fogging the subject. */
  fitFog(cameraDistance: number): void {
    const fog = this.scene.fog as Fog;
    fog.near = cameraDistance * 1.5;
    fog.far = cameraDistance * 3.2;
  }

  setShadowResolution(size: number): void {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /** Fits the shadow map to the subject, so small models get sharp shadows. */
  focusOn(center: Vector3, radius: number): void {
    this.focus.copy(center);
    this.radius = Math.max(1.5, radius);
    const shadow = this.sun.shadow.camera;
    shadow.left = shadow.bottom = -this.radius;
    shadow.right = shadow.top = this.radius;
    shadow.updateProjectionMatrix();
    this.place();
  }

  private place(): void {
    if (!this.preset) return;
    const azimuth = MathUtils.degToRad(this.preset.sunAzimuth);
    const elevation = MathUtils.degToRad(this.preset.sunElevation);
    const direction = new Vector3(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    );
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(direction, SUN_DISTANCE);
    this.fill.target.position.copy(this.focus);
    this.fill.position.copy(this.focus).addScaledVector(direction, -SUN_DISTANCE).setY(SUN_DISTANCE * 0.4);
  }
}
