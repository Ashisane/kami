import { Mesh } from 'three';
import type { Material } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { paper } from '../paper/paperLibrary';
import { isStockId } from '../paper/stocks';
import type { BuiltModel } from './types';

const PAPER_PREFIX = 'paper:';

function rebind(material: Material): Material {
  if (!material.name.startsWith(PAPER_PREFIX)) return material;
  const stock = material.name.slice(PAPER_PREFIX.length);
  if (!isStockId(stock)) throw new Error(`Material "${material.name}" names an unknown paper stock.`);
  material.dispose();
  return paper(stock);
}

/** Turns a loaded glTF into a BuiltModel, swapping `paper:<stock>` materials for the real paper. */
export function modelFromGltf(gltf: GLTF): BuiltModel {
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.material = Array.isArray(object.material) ? object.material.map(rebind) : rebind(object.material);
  });
  return { root: gltf.scene, clips: gltf.animations };
}

export async function loadGltfModel(url: string): Promise<BuiltModel> {
  return modelFromGltf(await new GLTFLoader().loadAsync(url));
}

export async function parseGltfModel(data: ArrayBuffer): Promise<BuiltModel> {
  return modelFromGltf(await new GLTFLoader().parseAsync(data, ''));
}
