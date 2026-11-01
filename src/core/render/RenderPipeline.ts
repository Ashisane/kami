import { DoubleSide, HalfFloatType, NeutralToneMapping, PCFShadowMap, SRGBColorSpace, Vector2, WebGLRenderTarget, WebGLRenderer } from 'three';
import type { Camera, Material, Scene } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

export function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  // Neutral keeps a stock's hue honest, which ACES and AgX do not: the red paper stays that red.
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.info.autoReset = false;
  return renderer;
}

export type Quality = 'high' | 'balanced' | 'fast';

interface QualitySettings {
  /** Colour buffer samples. */
  msaa: number;
  /** Contact AO resolution relative to the screen; 0 turns it off. */
  aoScale: number;
  aoSamples: number;
  shadowMap: number;
  maxPixelRatio: number;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  high: { msaa: 4, aoScale: 1, aoSamples: 16, shadowMap: 2048, maxPixelRatio: 2 },
  balanced: { msaa: 2, aoScale: 0.5, aoSamples: 8, shadowMap: 2048, maxPixelRatio: 1.5 },
  fast: { msaa: 2, aoScale: 0, aoSamples: 0, shadowMap: 1024, maxPixelRatio: 1 },
};

/** GTAOPass with its buffers at a fraction of the screen, since AO is soft enough to upscale. */
class ScaledGTAOPass extends GTAOPass {
  scale = 1;

  override setSize(width: number, height: number): void {
    super.setSize(Math.ceil(width * this.scale), Math.ceil(height * this.scale));
  }
}

/**
 * Scene, then contact AO, then an overlay scene for debug shapes, so debug
 * geometry never darkens the picture. AO is what makes stacked paper read as
 * stacked: without it, layers look like they float.
 */
export class RenderPipeline {
  private readonly composer: EffectComposer;
  private readonly target: WebGLRenderTarget;
  private readonly scenePass: RenderPass;
  private readonly aoPass: ScaledGTAOPass;
  private readonly drawing = new Vector2();
  private width = 1;
  private height = 1;
  private wantsAmbientOcclusion = true;
  private quality: Quality = 'balanced';

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    overlay: Scene,
  ) {
    renderer.getDrawingBufferSize(this.drawing);
    this.target = new WebGLRenderTarget(this.drawing.x, this.drawing.y, { type: HalfFloatType, samples: QUALITY.balanced.msaa });
    this.composer = new EffectComposer(renderer, this.target);

    this.scenePass = new RenderPass(scene, camera);
    this.composer.addPass(this.scenePass);

    this.aoPass = new ScaledGTAOPass(scene, camera, this.drawing.x, this.drawing.y);
    this.aoPass.normalMaterial.flatShading = true;
    this.aoPass.normalMaterial.side = DoubleSide;
    // Partial blend: AO should deepen shade, never turn a fold black.
    this.aoPass.blendIntensity = 0.72;
    this.composer.addPass(this.aoPass);

    const overlayPass = new RenderPass(overlay, camera);
    overlayPass.clear = false;
    overlayPass.clearDepth = true;
    this.composer.addPass(overlayPass);

    this.composer.addPass(new OutputPass());
    this.setQuality(this.quality);
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    const settings = QUALITY[quality];
    this.composer.renderTarget1.samples = settings.msaa;
    this.composer.renderTarget2.samples = settings.msaa;
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();

    this.aoPass.scale = settings.aoScale || 1;
    this.aoPass.updateGtaoMaterial({
      radius: 0.3,
      distanceExponent: 1.4,
      thickness: 0.6,
      scale: 1,
      samples: Math.max(4, settings.aoSamples),
      distanceFallOff: 1,
      screenSpaceRadius: false,
    });
    this.aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1.4, rings: 2, samples: 12 });
    this.applyAmbientOcclusion();
    this.setSize(this.width, this.height);
  }

  setAmbientOcclusion(enabled: boolean): void {
    this.wantsAmbientOcclusion = enabled;
    this.applyAmbientOcclusion();
  }

  private applyAmbientOcclusion(): void {
    this.aoPass.enabled = this.wantsAmbientOcclusion && QUALITY[this.quality].aoScale > 0;
  }

  /** Replaces every material for debug views. Null restores the real look. */
  setOverride(material: Material | null): void {
    this.scenePass.overrideMaterial = material;
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const pixelRatio = Math.min(window.devicePixelRatio, QUALITY[this.quality].maxPixelRatio);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
