import { Box3, Group, MeshBasicMaterial, MeshNormalMaterial, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { Material, Object3D, WebGLRenderer } from 'three';
import { Spring } from '@/core/anim/spring';
import { instantiate } from '@/core/asset/AssetInstance';
import type { AssetInstance } from '@/core/asset/AssetInstance';
import { getAsset } from '@/core/asset/registry';
import { getSheet } from '@/core/asset/sheets';
import { ScrapBurst } from '@/core/fx/ScrapBurst';
import { Shake } from '@/core/fx/Shake';
import { bakePaperGrain } from '@/core/paper/grainBake';
import { setPaperGrain } from '@/core/paper/PaperMaterial';
import { LightRig } from '@/core/render/LightRig';
import { createRenderer, QUALITY, RenderPipeline } from '@/core/render/RenderPipeline';
import type { Quality } from '@/core/render/RenderPipeline';
import type { LightingPreset } from '@/core/render/lighting';
import type { StockId } from '@/core/paper/stocks';
import { FoldLab } from '../lab/FoldLab';
import { CameraRig } from './CameraRig';
import type { CameraAngle } from './CameraRig';
import { ClipDeck } from './ClipDeck';
import { ColliderOverlay } from './ColliderOverlay';
import { CuttingMat } from '@/core/render/CuttingMat';
import type { Surface } from '@/core/render/CuttingMat';
import { createScaleFigure } from './ScaleFigure';
import { SocketOverlay } from './SocketOverlay';
import { buildSpecimen } from './specimen';

export type ViewMode = 'lit' | 'clay' | 'wire' | 'normals';

const TURNTABLE_SPEED = 0.42;
const MAX_FRAME_TIME = 1 / 20;
const SHEET_FRAMING = 1;
const SCRAP_STOCKS: readonly StockId[] = ['washi', 'vermilion', 'marigold', 'sakura', 'teal'];

export class LibraryStage {
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
  readonly deck = new ClipDeck();
  readonly lights: LightRig;
  readonly colliders: ColliderOverlay;
  readonly rig: CameraRig;
  instance: AssetInstance | null = null;
  lab: FoldLab | null = null;

  /** Rolling average frame time in milliseconds, for the status bar. */
  frameMs = 16;

  private readonly scene = new Scene();
  private readonly overlay = new Scene();
  private readonly pipeline: RenderPipeline;
  private readonly sockets: SocketOverlay;
  private readonly mat: CuttingMat;
  private readonly scaleFigure = createScaleFigure();
  private readonly scraps = new ScrapBurst();
  private readonly shake = new Shake();

  /** Holds the subject; turntable and squash act here, leaving the model's own root alone. */
  private readonly pivot = new Group();
  private readonly pop = new Spring(1, 2.6, 0.34);
  private subject: Object3D | null = null;
  private landed = true;
  private onLanded: (() => void) | null = null;

  private readonly overrides: Record<Exclude<ViewMode, 'lit'>, Material> = {
    clay: new MeshStandardMaterial({ color: '#d8d4cc', roughness: 0.75, flatShading: true }),
    wire: new MeshBasicMaterial({ color: '#17352f', wireframe: true }),
    normals: new MeshNormalMaterial({ flatShading: true }),
  };

  private viewMode: ViewMode = 'lit';
  private ambientOcclusion = true;
  private deskWanted = true;
  private turntable = false;
  private frozen = false;
  private width = 1;
  private height = 1;
  private last = 0;
  private loadToken = 0;

  constructor(canvas: HTMLCanvasElement, labels: HTMLElement) {
    this.renderer = createRenderer(canvas);
    this.camera = new PerspectiveCamera(30, 1, 0.05, 80);
    this.lights = new LightRig(this.scene);
    this.colliders = new ColliderOverlay(this.overlay);
    this.sockets = new SocketOverlay(this.overlay, labels);
    this.rig = new CameraRig(this.camera, canvas);

    const grain = bakePaperGrain(this.renderer);
    setPaperGrain(grain.surface, grain.mottle);

    this.mat = new CuttingMat(this.renderer.capabilities.getMaxAnisotropy());
    this.scaleFigure.position.set(-1.3, 0, -0.6);
    this.scaleFigure.visible = false;
    this.scene.add(this.mat.mesh, this.pivot, this.scaleFigure, this.scraps.mesh);

    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera, this.overlay);
    this.setOverlays({ colliders: false, sockets: false });

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  start(): void {
    this.renderer.setAnimationLoop((now) => this.tick(now));
  }

  async showAsset(id: string, onLanded?: () => void): Promise<void> {
    const token = ++this.loadToken;
    const instance = await instantiate(getAsset(id));
    if (token !== this.loadToken) {
      instance.dispose();
      return;
    }
    this.clearSubject();
    this.instance = instance;
    this.setSubject(instance.root, onLanded);
    this.deck.attach(instance);
    this.colliders.attach(instance);
    this.sockets.attach(instance);
  }

  showSpecimen(stock: StockId): void {
    this.loadToken++;
    this.clearSubject();
    this.deck.attach(null);
    this.colliders.attach(null);
    this.sockets.attach(null);
    this.setSubject(buildSpecimen(stock));
  }

  /** Opens living paper in the Fold Lab. */
  showSheet(id: string): void {
    this.loadToken++;
    this.clearSubject();
    this.deck.attach(null);
    this.colliders.attach(null);
    this.sockets.attach(null);
    const lab = new FoldLab(getSheet(id), this.scene, this.overlay, this.camera, this.renderer.domElement, this.scraps, this.shake, (enabled) => {
      this.rig.controls.enabled = enabled;
    });
    lab.frozen = this.frozen;
    this.lab = lab;
    this.scaleFigure.position.set(-6.2, 0, 0);
    const bounds = lab.bounds();
    this.lights.fitFog(this.rig.frame(bounds, SHEET_FRAMING));
    this.lights.focusOn(bounds.getCenter(new Vector3()), bounds.getSize(new Vector3()).length() * 0.8);
    lab.update(0);
  }

  private clearSubject(): void {
    this.lab?.dispose();
    this.lab = null;
    this.scaleFigure.position.set(-1.3, 0, -0.6);
    this.instance?.dispose();
    this.instance = null;
    if (this.subject) {
      this.subject.traverse((object) => {
        if ('geometry' in object) (object as unknown as { geometry: { dispose(): void } }).geometry.dispose();
      });
      this.subject.removeFromParent();
      this.subject = null;
    }
  }

  private setSubject(root: Object3D, onLanded?: () => void): void {
    this.subject = root;
    this.pivot.rotation.y = 0;
    this.pivot.add(root);
    this.pivot.scale.setScalar(1);
    this.pivot.updateMatrixWorld(true);

    const bounds = this.subjectBounds();
    this.lights.fitFog(this.rig.frame(bounds));
    const center = bounds.getCenter(new Vector3());
    this.lights.focusOn(center, bounds.getSize(new Vector3()).length() * 0.9);

    this.onLanded = onLanded ?? null;
    if (this.frozen) {
      this.finishPop();
      return;
    }
    this.landed = false;
    this.pop.snap(0.02);
    this.pop.target = 1;
  }

  subjectBounds(): Box3 {
    if (this.lab) return this.lab.bounds();
    const bounds = new Box3();
    if (this.subject) bounds.setFromObject(this.subject);
    return bounds;
  }

  private finishPop(): void {
    this.pop.snap(1);
    this.landed = true;
    this.applyPop();
    this.onLanded?.();
    this.onLanded = null;
  }

  /** Squash and stretch: y drives, x and z preserve volume. */
  private applyPop(): void {
    const y = Math.max(0.02, this.pop.value);
    const wide = 1 / Math.sqrt(Math.max(0.35, y));
    this.pivot.scale.set(wide * Math.min(1, y * 3), y, wide * Math.min(1, y * 3));
  }

  private tick(now: number): void {
    const raw = this.last ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;
    this.frameMs += (raw * 1000 - this.frameMs) * 0.08;
    if (this.frozen) return;
    this.advance(Math.min(raw, MAX_FRAME_TIME));
    this.draw(Math.min(raw, MAX_FRAME_TIME));
  }

  private advance(dt: number): void {
    this.deck.update(dt);

    if (!this.landed) {
      const before = this.pop.value;
      this.pop.update(dt);
      this.applyPop();
      if (before < 1 && this.pop.value >= 1) {
        this.landed = true;
        const bounds = this.subjectBounds();
        const center = bounds.getCenter(new Vector3()).setY(0);
        this.scraps.burst(center, 34, SCRAP_STOCKS, 1, Math.min(1, bounds.getSize(new Vector3()).length() * 0.3));
        this.shake.add(0.34);
        this.onLanded?.();
        this.onLanded = null;
      }
    } else if (!this.pop.settled) {
      this.pop.update(dt);
      this.applyPop();
    }

    if (this.turntable) this.pivot.rotation.y += TURNTABLE_SPEED * dt;
    this.lab?.update(dt);
    this.scraps.update(dt);
    this.rig.update(dt);
  }

  private draw(dt: number): void {
    this.renderer.info.reset();
    this.pivot.updateMatrixWorld(true);
    this.colliders.update();
    this.sockets.update(this.camera, this.width, this.height);
    if (!this.frozen) this.shake.apply(this.camera, dt, this.width, this.height);
    this.pipeline.render(dt);
  }

  /** Stops the clock and renders exactly one frame per `step`, for repeatable screenshots. */
  freeze(): void {
    this.frozen = true;
    this.camera.clearViewOffset();
    this.scraps.clear();
    if (this.lab) this.lab.frozen = true;
    if (!this.landed) this.finishPop();
  }

  step(): void {
    this.rig.update(0);
    this.draw(0);
  }

  applyLighting(preset: LightingPreset): void {
    this.lights.apply(preset);
    this.pipeline.setAmbientOcclusion(this.ambientOcclusion && this.viewMode !== 'wire' && this.viewMode !== 'normals');
  }

  setView(mode: ViewMode): void {
    this.viewMode = mode;
    this.setOverlays({});
    this.pipeline.setOverride(mode === 'lit' ? null : this.overrides[mode]);
    this.pipeline.setAmbientOcclusion(this.ambientOcclusion && mode !== 'wire' && mode !== 'normals');
  }

  setAmbientOcclusion(enabled: boolean): void {
    this.ambientOcclusion = enabled;
    this.setView(this.viewMode);
  }

  setOverlays(overlays: { colliders?: boolean; sockets?: boolean; grid?: boolean; scale?: boolean }): void {
    if (overlays.colliders !== undefined) this.colliders.group.visible = overlays.colliders;
    if (overlays.sockets !== undefined) this.sockets.setVisible(overlays.sockets);
    if (overlays.grid !== undefined) this.deskWanted = overlays.grid;
    if (overlays.scale !== undefined) this.scaleFigure.visible = overlays.scale;
    this.mat.mesh.visible = this.deskWanted && this.viewMode !== 'wire';
  }

  setSurface(surface: Surface): void {
    this.mat.set(surface);
  }

  setTurntable(enabled: boolean): void {
    this.turntable = enabled;
  }

  frameSubject(): void {
    this.lights.fitFog(this.rig.frame(this.subjectBounds(), this.lab ? SHEET_FRAMING : 1));
  }

  view(angle: CameraAngle, instant = false): void {
    this.rig.view(angle, instant);
  }

  private resize(): void {
    const canvas = this.renderer.domElement;
    this.width = canvas.clientWidth || 1;
    this.height = canvas.clientHeight || 1;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(this.width, this.height);
  }

  setQuality(quality: Quality): void {
    this.pipeline.setQuality(quality);
    this.lights.setShadowResolution(QUALITY[quality].shadowMap);
  }

  /** Average milliseconds per fully finished frame, waiting on the GPU each time. */
  benchmark(frames = 40): number {
    const gl = this.renderer.getContext();
    const pixel = new Uint8Array(4);
    const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    this.draw(0);
    finish();
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      this.draw(0);
      finish();
    }
    return (performance.now() - start) / frames;
  }
}
