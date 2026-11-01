import { Vector3 } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { listAssets, getAsset } from '@/core/asset/registry';
import { instantiate } from '@/core/asset/AssetInstance';
import { parseGltfModel } from '@/core/asset/gltf';
import { validateModel } from '@/core/asset/validate';
import type { ContractIssue } from '@/core/asset/validate';
import type { StockId } from '@/core/paper/stocks';
import { LIGHTING_PRESETS } from '@/core/render/lighting';
import { QUALITY } from '@/core/render/RenderPipeline';
import type { Quality } from '@/core/render/RenderPipeline';
import type { LibraryContext } from './context';
import type { CameraAngle } from './stage/CameraRig';
import type { ViewMode } from './stage/LibraryStage';
import type { InspectorTab } from './state';

export interface CaptureRequest {
  asset?: string;
  stock?: StockId;
  sheet?: string;
  /** A fold recipe to apply to the sheet. */
  recipe?: string;
  /** Half-cells per side, to compare grid sizes. */
  cells?: number;
  /** Hold a flat spot up: x, z, height. */
  hold?: [number, number, number];
  /** Sets rigidity after everything else. */
  rigidity?: number;
  /** Simulation steps to run before the shot. */
  settle?: number;
  clip?: string;
  /** Seconds into the clip. */
  time?: number;
  camera?: CameraAngle;
  /** Above 1 moves closer than the default framing. */
  zoom?: number;
  view?: ViewMode;
  lighting?: string;
  tab?: InspectorTab;
  colliders?: boolean;
  sockets?: boolean;
  scale?: boolean;
}

export interface RoundTripReport {
  id: string;
  bytes: number;
  clips: string[];
  issues: ContractIssue[];
}

/**
 * Export a procedural asset to .glb and bring it back through the real loader.
 * This proves a Blender model following the naming rules can replace a
 * procedural one with no game code changing.
 */
async function roundTrip(id: string): Promise<RoundTripReport> {
  const definition = getAsset(id);
  const instance = await instantiate(definition);
  const exported = await new GLTFExporter().parseAsync(instance.root, { binary: true, animations: instance.model.clips });
  const data = exported as ArrayBuffer;
  const model = await parseGltfModel(data);
  return { id, bytes: data.byteLength, clips: model.clips.map((c) => c.name), issues: validateModel(definition, model) };
}

/** Everything `tools/capture.mjs` drives, so screenshots are exact and repeatable. */
export function installDebugApi({ stage, store }: LibraryContext, selectionLoaded: () => Promise<void>): void {
  const api = {
    assets: () => listAssets().map((a) => a.id),
    gpu: () => {
      const gl = stage.renderer.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    },
    roundTrip,
    errors: [] as string[],
    lab: () => stage.lab?.readout() ?? null,
    /** Where a world point appears on screen, so a test can aim the real mouse at it. */
    screenOf(x: number, y: number, z: number): [number, number] {
      const point = new Vector3(x, y, z).project(stage.camera);
      const rect = stage.renderer.domElement.getBoundingClientRect();
      return [((point.x + 1) / 2) * rect.width, ((1 - point.y) / 2) * rect.height];
    },

    /** Real frame cost of each quality tier on this machine's GPU. */
    benchmark(): Record<string, string> {
      const result: Record<string, string> = {};
      for (const quality of Object.keys(QUALITY) as Quality[]) {
        stage.setQuality(quality);
        const ms = stage.benchmark();
        result[quality] = `${ms.toFixed(1)} ms (${Math.round(1000 / ms)} fps)`;
      }
      stage.setQuality(store.state.quality);
      return result;
    },

    async capture(request: CaptureRequest): Promise<void> {
      stage.freeze();
      if (request.asset) store.set({ selection: { kind: 'asset', id: request.asset } });
      if (request.stock) store.set({ selection: { kind: 'stock', id: request.stock } });
      if (request.sheet) store.set({ selection: { kind: 'sheet', id: request.sheet } });
      await selectionLoaded();
      stage.deck.pause();
      if (stage.lab) {
        const { lab } = stage;
        lab.frozen = true;
        if (request.cells) lab.setCells(request.cells);
        const failures = request.recipe ? lab.applyRecipe(request.recipe).filter(Boolean) : [];
        if (failures.length) throw new Error(`Recipe ${request.recipe} failed: ${failures.join(', ')}`);
        if (request.hold) lab.holdAt(...request.hold);
        if (request.settle) lab.settle(request.settle);
        if (request.rigidity !== undefined) lab.setRigidity(request.rigidity);
        lab.update(0);
      }
      if (request.tab) store.set({ tab: request.tab });
      if (request.view) store.set({ view: request.view });
      if (request.colliders !== undefined) store.set({ colliders: request.colliders });
      if (request.sockets !== undefined) store.set({ sockets: request.sockets });
      if (request.scale !== undefined) store.set({ scale: request.scale });
      if (request.lighting) {
        const preset = LIGHTING_PRESETS.find((p) => p.id === request.lighting);
        if (!preset) throw new Error(`Unknown lighting "${request.lighting}".`);
        store.set({ lighting: { ...preset } });
      }
      if (request.clip) stage.deck.select(request.clip);
      if (request.time !== undefined) stage.deck.seek(request.time);
      stage.frameSubject();
      if (request.zoom) stage.rig.zoom(request.zoom);
      stage.view(request.camera ?? 'hero', true);
      stage.step();
      await document.fonts.ready;
    },
  };
  (window as unknown as { kami: typeof api }).kami = api;
  window.addEventListener('error', (event) => api.errors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => api.errors.push(String(event.reason)));
}
