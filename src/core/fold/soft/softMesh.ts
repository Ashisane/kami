import type { FoldBook } from '../FoldBook';
import { UNITS_PER_CELL } from '../lattice';

/**
 * The cloth the solver actually moves, derived from a Fold Book. Layers lying on
 * the same site merge into one triangle that is heavier and stiffer, so glued
 * layers never need collision. A sheet folded in half really is a half-size
 * cloth of double weight.
 *
 * `peeled` faces stay out of the merge, so a flap can lift away from the stack
 * while staying joined to it along its crease.
 */
export interface SoftMesh {
  vertexCount: number;
  /** Flat position of each vertex in metres: x z, centred on the sheet. */
  flat: Float64Array;
  /** Vertex ids, three per triangle, wound so a flat sheet faces +y. */
  tris: Int32Array;
  triCount: number;
  /** How many layers each triangle stands for. */
  triLayers: Int32Array;
  /** Vertex pairs, two per edge. */
  edges: Int32Array;
  edgeLength: Float64Array;
  /** a b c d per hinge: a b is the shared edge, c d the two wings. */
  hinges: Int32Array;
  hingeLayers: Float64Array;
  /** Which triangle each book face belongs to, by face id; -1 if not in this piece. */
  faceTri: Int32Array;
  /** Which vertex each face corner belongs to: index by face * 3 + corner. */
  cornerVertex: Int32Array;
  /** Layers per vertex: the tallest stack it touches. */
  vertexLayers: Int32Array;
  /** Inverse mass, normalised so one layer's interior vertex is 1. */
  inverseMass: Float64Array;
}

/** Metres per lattice unit for a sheet of this size. */
export const metresPerUnit = (book: FoldBook, size: number): number => size / (book.cells * UNITS_PER_CELL);

class Corners {
  private readonly parent: Int32Array;

  constructor(count: number) {
    this.parent = Int32Array.from({ length: count }, (_, i) => i);
  }

  find(i: number): number {
    const p = this.parent;
    while (p[i] !== i) {
      p[i] = p[p[i] as number] as number;
      i = p[i] as number;
    }
    return i;
  }

  unite(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b);
  }
}

export function buildSoftMesh(book: FoldBook, size: number, peeled: ReadonlySet<number> = new Set()): SoftMesh {
  const corners = new Corners(book.faceCount * 3);
  const { rest, at, neighbour } = book;
  const unit = metresPerUnit(book, size);
  const half = (book.cells * UNITS_PER_CELL) / 2;

  // Paper joins corners across every uncut edge.
  for (const f of book.faces) {
    for (let k = 0; k < 3; k++) {
      const g = neighbour[f * 3 + k] as number;
      if (g < f || book.edgeBlocked(f, k)) continue;
      for (const own of [k, (k + 1) % 3]) {
        for (let j = 0; j < 3; j++) {
          if (rest[f * 6 + own * 2] === rest[g * 6 + j * 2] && rest[f * 6 + own * 2 + 1] === rest[g * 6 + j * 2 + 1]) {
            corners.unite(f * 3 + own, g * 3 + j);
          }
        }
      }
    }
  }

  // Layers in one stack weld together, group by group.
  const groups: number[][] = [];
  for (const stack of book.stacks.values()) {
    const base = stack.filter((f) => !peeled.has(f));
    const lifted = stack.filter((f) => peeled.has(f));
    for (const group of [base, lifted]) {
      if (group.length === 0) continue;
      groups.push(group);
      const first = group[0] as number;
      for (const f of group) {
        for (let k = 0; k < 3; k++) {
          for (let j = 0; j < 3; j++) {
            if (at[f * 6 + k * 2] === at[first * 6 + j * 2] && at[f * 6 + k * 2 + 1] === at[first * 6 + j * 2 + 1]) {
              corners.unite(f * 3 + k, first * 3 + j);
            }
          }
        }
      }
    }
  }

  // Each union of corners is one solver vertex.
  const ids = new Map<number, number>();
  const cornerVertex = new Int32Array(book.faceCount * 3).fill(-1);
  const flatList: number[] = [];
  for (const f of book.faces) {
    for (let k = 0; k < 3; k++) {
      const root = corners.find(f * 3 + k);
      let id = ids.get(root);
      if (id === undefined) {
        id = ids.size;
        ids.set(root, id);
        flatList.push(((at[f * 6 + k * 2] as number) - half) * unit, ((at[f * 6 + k * 2 + 1] as number) - half) * unit);
      }
      cornerVertex[f * 3 + k] = id;
    }
  }
  const vertexCount = ids.size;
  const flat = Float64Array.from(flatList);

  const triCount = groups.length;
  const tris = new Int32Array(triCount * 3);
  const triLayers = new Int32Array(triCount);
  const faceTri = new Int32Array(book.faceCount).fill(-1);
  const area = new Float64Array(triCount);
  groups.forEach((group, t) => {
    const f = group[0] as number;
    let a = cornerVertex[f * 3] as number;
    let b = cornerVertex[f * 3 + 1] as number;
    const c = cornerVertex[f * 3 + 2] as number;
    const ux = (flat[b * 2] as number) - (flat[a * 2] as number);
    const uz = (flat[b * 2 + 1] as number) - (flat[a * 2 + 1] as number);
    const vx = (flat[c * 2] as number) - (flat[a * 2] as number);
    const vz = (flat[c * 2 + 1] as number) - (flat[a * 2 + 1] as number);
    const cross = uz * vx - ux * vz;
    if (cross < 0) [a, b] = [b, a];
    tris[t * 3] = a;
    tris[t * 3 + 1] = b;
    tris[t * 3 + 2] = c;
    triLayers[t] = group.length;
    area[t] = Math.abs(cross) / 2;
    for (const g of group) faceTri[g] = t;
  });

  // Edges and hinges come from the merged triangles.
  const edgeTris = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k] as number;
      const b = tris[t * 3 + (k + 1) % 3] as number;
      const key = Math.min(a, b) * vertexCount + Math.max(a, b);
      const list = edgeTris.get(key);
      if (list) list.push(t);
      else edgeTris.set(key, [t]);
    }
  }
  const edges = new Int32Array(edgeTris.size * 2);
  const edgeLength = new Float64Array(edgeTris.size);
  const hingeList: number[] = [];
  const hingeLayerList: number[] = [];
  const opposite = (t: number, a: number, b: number) => {
    for (let k = 0; k < 3; k++) {
      const v = tris[t * 3 + k] as number;
      if (v !== a && v !== b) return v;
    }
    return -1;
  };
  const isLifted = (t: number) => peeled.has((groups[t] as number[])[0] as number);

  let e = 0;
  for (const [key, list] of edgeTris) {
    const a = Math.floor(key / vertexCount);
    const b = key % vertexCount;
    edges[e * 2] = a;
    edges[e * 2 + 1] = b;
    edgeLength[e] = Math.hypot((flat[a * 2] as number) - (flat[b * 2] as number), (flat[a * 2 + 1] as number) - (flat[b * 2 + 1] as number));
    e++;
    // A peeled flap meets its stack at a free crease, so that pair gets no hinge.
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const s = list[i] as number;
        const t = list[j] as number;
        if (isLifted(s) !== isLifted(t)) continue;
        hingeList.push(a, b, opposite(s, a, b), opposite(t, a, b));
        hingeLayerList.push(((triLayers[s] as number) + (triLayers[t] as number)) / 2);
      }
    }
  }

  const mass = new Float64Array(vertexCount);
  const vertexLayers = new Int32Array(vertexCount);
  let reference = 0;
  for (let t = 0; t < triCount; t++) {
    const share = ((area[t] as number) * (triLayers[t] as number)) / 3;
    reference = Math.max(reference, (area[t] as number) * 2);
    for (let k = 0; k < 3; k++) {
      const v = tris[t * 3 + k] as number;
      mass[v] = (mass[v] as number) + share;
      vertexLayers[v] = Math.max(vertexLayers[v] as number, triLayers[t] as number);
    }
  }
  const inverseMass = mass.map((m) => (m > 0 ? reference / m : 0));

  return {
    vertexCount,
    flat,
    tris,
    triCount,
    triLayers,
    edges,
    edgeLength,
    hinges: Int32Array.from(hingeList),
    hingeLayers: Float64Array.from(hingeLayerList),
    faceTri,
    cornerVertex,
    vertexLayers,
    inverseMass,
  };
}
