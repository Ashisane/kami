import { Box3, Mesh, PropertyBinding, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { PaperMaterial } from '../paper/PaperMaterial';
import { ASSET_CATEGORIES } from './types';
import type { AssetDefinition, BuiltModel } from './types';

/**
 * Checks a built model against its definition. This is what makes swapping a
 * model safe: a renamed bone or a missing clip fails here, loudly, instead of
 * silently breaking gameplay three weeks later.
 */
export interface ContractIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface ModelStats {
  triangles: number;
  meshes: number;
  /** One per material slot in use, which is the real draw call count. */
  drawCalls: number;
  materials: number;
  size: [number, number, number];
}

const NODE_NAME = /^[a-z0-9_]+$/;

export function triangleCount(geometry: BufferGeometry): number {
  const vertices = geometry.index ? geometry.index.count : (geometry.getAttribute('position')?.count ?? 0);
  return vertices / 3;
}

export function modelStats(model: BuiltModel): ModelStats {
  const materials = new Set<string>();
  let triangles = 0;
  let meshes = 0;
  let drawCalls = 0;

  model.root.updateMatrixWorld(true);
  model.root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    meshes++;
    triangles += triangleCount(object.geometry);
    const slots = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of slots) materials.add(material.uuid);
    drawCalls += Math.max(1, Array.isArray(object.material) ? object.geometry.groups.length : 1);
  });

  const size = new Box3().setFromObject(model.root).getSize(new Vector3());
  return { triangles, meshes, drawCalls, materials: materials.size, size: [size.x, size.y, size.z] };
}

export function validateDefinition(definition: AssetDefinition): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const error = (message: string) => issues.push({ severity: 'error', message });

  const [prefix, ...rest] = definition.id.split('.');
  if (prefix !== definition.category || rest.length !== 1 || !NODE_NAME.test(rest[0] ?? '')) {
    error(`id "${definition.id}" must look like "${definition.category}.snake_case_name".`);
  }
  if (!ASSET_CATEGORIES.includes(definition.category)) error(`Unknown category "${definition.category}".`);
  if (definition.maxTriangles <= 0) error('maxTriangles must be positive.');
  if (definition.colliders.length === 0) error('An asset needs at least one collider.');

  const colliderNames = new Set<string>();
  for (const collider of definition.colliders) {
    if (colliderNames.has(collider.name)) error(`Duplicate collider "${collider.name}".`);
    colliderNames.add(collider.name);
  }
  return issues;
}

export function validateModel(definition: AssetDefinition, model: BuiltModel): ContractIssue[] {
  const issues = validateDefinition(definition);
  const error = (message: string) => issues.push({ severity: 'error', message });
  const warn = (message: string) => issues.push({ severity: 'warning', message });

  const nodes = new Set<string>();
  model.root.traverse((object) => {
    if (object.name) nodes.add(object.name);
  });

  for (const name of nodes) {
    // glTF loaders strip characters like "." from names, which would break bindings.
    if (!NODE_NAME.test(name) && object3DIsAuthored(name)) {
      warn(`Node "${name}" is not snake_case and may be renamed on export.`);
    }
  }

  const clips = new Map(model.clips.map((c) => [c.name, c]));
  for (const name of definition.clips) {
    if (!clips.has(name)) error(`Declared clip "${name}" is missing from the model.`);
  }
  for (const clip of model.clips) {
    if (!definition.clips.includes(clip.name)) warn(`Clip "${clip.name}" exists but is not declared.`);
    for (const track of clip.tracks) {
      const { nodeName } = PropertyBinding.parseTrackName(track.name);
      if (nodeName && !nodes.has(nodeName)) {
        error(`Clip "${clip.name}" animates missing node "${nodeName}".`);
      }
    }
  }

  for (const [name, socket] of Object.entries(definition.sockets)) {
    if (!nodes.has(socket.node)) error(`Socket "${name}" points at missing node "${socket.node}".`);
  }
  for (const collider of definition.colliders) {
    if (collider.node && !nodes.has(collider.node)) {
      error(`Collider "${collider.name}" follows missing node "${collider.node}".`);
    }
  }

  const painted = new Set<string>();
  model.root.traverse((object) => {
    const slot = object.userData['paint'];
    if (object instanceof Mesh && typeof slot === 'string') painted.add(slot);
  });
  for (const slot of Object.keys(definition.paints ?? {})) {
    if (!painted.has(slot)) error(`Paint slot "${slot}" has no mesh tagged with it.`);
  }

  const stats = modelStats(model);
  if (stats.triangles > definition.maxTriangles) {
    error(`${stats.triangles} triangles is over the budget of ${definition.maxTriangles}.`);
  }

  model.root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const slots = Array.isArray(object.material) ? object.material : [object.material];
    if (slots.some((m) => !(m instanceof PaperMaterial))) {
      warn(`Mesh "${object.name}" uses a material that is not paper.`);
    }
  });

  return issues;
}

// Three names some generated nodes itself; only names we authored must conform.
const object3DIsAuthored = (name: string): boolean => !/^(Scene|AuxScene|RootNode)$/.test(name);
