import type { AnimationClip, Object3D } from 'three';

/**
 * THE ASSET CONTRACT.
 *
 * Game code talks to assets only through what is declared here: an id, named
 * clips, named sockets and collider data. It never reads a mesh, a vertex or a
 * hardcoded offset. Replacing a procedural model with a Blender file therefore
 * touches one file and no game code, as long as the same names still exist.
 */

export const ASSET_CATEGORIES = ['character', 'craft', 'tool', 'prop', 'terrain', 'calibration'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** `calibration` assets exist to test the pipeline and never ship in the game. */
export type AssetStatus = 'calibration' | 'blockout' | 'draft' | 'final';

export type Vec3 = readonly [number, number, number];

/** A built model. Procedural builders and glTF files both produce exactly this. */
export interface BuiltModel {
  root: Object3D;
  clips: AnimationClip[];
}

export interface ProceduralSource {
  kind: 'procedural';
  build: () => BuiltModel;
}

export interface GltfSource {
  kind: 'gltf';
  /** Path under /public. Materials named `paper:<stock>` bind to that stock. */
  url: string;
}

export type AssetSource = ProceduralSource | GltfSource;

interface ColliderBase {
  name: string;
  /** `solid` blocks movement; `sensor` only reports overlap. */
  role: 'solid' | 'sensor';
  /** Node this collider follows, so it stays on moving parts. Defaults to the root. */
  node?: string;
  offset?: Vec3;
  /** Degrees. */
  rotation?: Vec3;
}

export type ColliderSpec =
  | (ColliderBase & { shape: 'box'; size: Vec3 })
  | (ColliderBase & { shape: 'sphere'; radius: number })
  | (ColliderBase & { shape: 'capsule'; radius: number; height: number });

/** A named attachment point. Lives in the model, so it moves with the model. */
export interface SocketSpec {
  /** Node name in the model. */
  node: string;
  description: string;
}

export interface AssetDefinition {
  /** `category.name`, e.g. `craft.paper_plane`. Stable forever: game code stores it. */
  id: string;
  name: string;
  category: AssetCategory;
  status: AssetStatus;
  description: string;
  source: AssetSource;
  /** Clip names game code relies on. Loading fails the contract if any are missing. */
  clips: readonly string[];
  sockets: Readonly<Record<string, SocketSpec>>;
  colliders: readonly ColliderSpec[];
  /** Triangle budget. Exceeding it is reported as a contract failure. */
  maxTriangles: number;
  /** Target images under /public/references, shown in the library's reference overlay. */
  references?: readonly string[];
}

export const defineAsset = (definition: AssetDefinition): AssetDefinition => definition;
