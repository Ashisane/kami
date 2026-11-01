import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, Mesh } from 'three';
import type { Material } from 'three';
import type { SheetPiece } from '../fold/SheetPiece';
import { cornerOffset } from '../fold/soft/softMesh';
import { paper } from '../paper/paperLibrary';

/**
 * Draws a piece of paper. The solver's triangles are big, so each is drawn as a
 * small curved patch, which lets a 0.5 m mesh drape smoothly. Every layer sits
 * at its true height, and only surfaces that can be seen are drawn: the outside
 * of each run of touching layers, since inner layers show only at the edges,
 * where rims close them off.
 */
const DETAIL = 4;
/** How strongly patches round off towards the surface the normals imply. */
const ROUNDING = 0.75;

const PATCH_POINTS = ((DETAIL + 1) * (DETAIL + 2)) / 2;

/** Index of a patch point, from how many steps it sits along two of the corners. */
const patchIndex = (a: number, b: number): number => {
  const row = DETAIL - a;
  return (row * (row + 1)) / 2 + b;
};

const PATCH_TRIANGLES: number[] = [];
for (let a = 0; a < DETAIL; a++) {
  for (let b = 0; b < DETAIL - a; b++) {
    PATCH_TRIANGLES.push(patchIndex(a, b), patchIndex(a + 1, b), patchIndex(a, b + 1));
    if (b < DETAIL - a - 1) PATCH_TRIANGLES.push(patchIndex(a + 1, b), patchIndex(a + 1, b + 1), patchIndex(a, b + 1));
  }
}

export class SheetView {
  readonly group = new Group();
  private readonly materials: Material[];
  private mesh: Mesh | null = null;
  private revision = -1;
  private hiddenKey = '';

  // One patch of curved surface per solver triangle.
  private patchPosition = new Float32Array(0);
  private patchNormal = new Float32Array(0);
  private vertexNormal = new Float32Array(0);

  // What each drawn vertex is: a patch point, pushed along its normal by a height.
  private drawPatch = new Int32Array(0);
  private drawHeight = new Float32Array(0);
  private drawFlip = new Int8Array(0);
  /** Rim quads: patch points of the edge's two ends, and the outward sense. */
  private rims = new Int32Array(0);
  private rimStart = 0;
  private positions = new BufferAttribute(new Float32Array(0), 3);
  private normals = new BufferAttribute(new Float32Array(0), 3);

  constructor(readonly piece: SheetPiece) {
    const { top, bottom, edge } = piece.definition;
    this.materials = [paper(top, { sheet: true }), paper(bottom, { sheet: true }), paper(edge, { sheet: true })];
  }

  /** Draws the piece, leaving out `hidden` faces while they swing as a separate flap. */
  update(hidden: ReadonlySet<number> = NOTHING): void {
    const key = hidden.size === 0 ? '' : `${hidden.size}:${[...hidden][0]}`;
    if (this.revision !== this.piece.revision || key !== this.hiddenKey) this.build(hidden);
    this.hiddenKey = key;
    this.revision = this.piece.revision;
    this.computePatches();
    this.writeVertices();
  }

  private computePatches(): void {
    const { soft } = this.piece;
    const { mesh, x } = soft;
    const { tris, triCount, vertexCount } = mesh;
    const normal = this.vertexNormal;
    normal.fill(0);
    for (let t = 0; t < triCount; t++) {
      const a = (tris[t * 3] as number) * 3, b = (tris[t * 3 + 1] as number) * 3, c = (tris[t * 3 + 2] as number) * 3;
      const ux = (x[b] as number) - (x[a] as number), uy = (x[b + 1] as number) - (x[a + 1] as number), uz = (x[b + 2] as number) - (x[a + 2] as number);
      const vx = (x[c] as number) - (x[a] as number), vy = (x[c + 1] as number) - (x[a + 1] as number), vz = (x[c + 2] as number) - (x[a + 2] as number);
      // Winding faces +y on flat paper, so this normal points to the top of the stack.
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const i of [a, b, c]) {
        normal[i] = (normal[i] as number) + nx;
        normal[i + 1] = (normal[i + 1] as number) + ny;
        normal[i + 2] = (normal[i + 2] as number) + nz;
      }
    }
    for (let v = 0; v < vertexCount; v++) {
      const i = v * 3;
      const length = Math.hypot(normal[i] as number, normal[i + 1] as number, normal[i + 2] as number) || 1;
      normal[i] = (normal[i] as number) / length;
      normal[i + 1] = (normal[i + 1] as number) / length;
      normal[i + 2] = (normal[i + 2] as number) / length;
    }

    const rounding = soft.hardened ? 0 : ROUNDING;
    const P = this.patchPosition, N = this.patchNormal;
    let o = 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = (tris[t * 3] as number) * 3, i1 = (tris[t * 3 + 1] as number) * 3, i2 = (tris[t * 3 + 2] as number) * 3;
      const x0 = x[i0] as number, y0 = x[i0 + 1] as number, z0 = x[i0 + 2] as number;
      const x1 = x[i1] as number, y1 = x[i1 + 1] as number, z1 = x[i1 + 2] as number;
      const x2 = x[i2] as number, y2 = x[i2 + 1] as number, z2 = x[i2 + 2] as number;
      const n0x = normal[i0] as number, n0y = normal[i0 + 1] as number, n0z = normal[i0 + 2] as number;
      const n1x = normal[i1] as number, n1y = normal[i1 + 1] as number, n1z = normal[i1 + 2] as number;
      const n2x = normal[i2] as number, n2y = normal[i2 + 1] as number, n2z = normal[i2 + 2] as number;
      for (let a = DETAIL; a >= 0; a--) {
        const row = DETAIL - a;
        for (let b = 0; b <= row; b++) {
          const w0 = a / DETAIL, w1 = b / DETAIL, w2 = 1 - w0 - w1;
          const px = w0 * x0 + w1 * x1 + w2 * x2, py = w0 * y0 + w1 * y1 + w2 * y2, pz = w0 * z0 + w1 * z1 + w2 * z2;
          // Phong tessellation: project onto each corner's tangent plane, then blend.
          const d0 = (px - x0) * n0x + (py - y0) * n0y + (pz - z0) * n0z;
          const d1 = (px - x1) * n1x + (py - y1) * n1y + (pz - z1) * n1z;
          const d2 = (px - x2) * n2x + (py - y2) * n2y + (pz - z2) * n2z;
          P[o] = px - rounding * (w0 * d0 * n0x + w1 * d1 * n1x + w2 * d2 * n2x);
          P[o + 1] = py - rounding * (w0 * d0 * n0y + w1 * d1 * n1y + w2 * d2 * n2y);
          P[o + 2] = pz - rounding * (w0 * d0 * n0z + w1 * d1 * n1z + w2 * d2 * n2z);
          const nx = w0 * n0x + w1 * n1x + w2 * n2x, ny = w0 * n0y + w1 * n1y + w2 * n2y, nz = w0 * n0z + w1 * n1z + w2 * n2z;
          const length = Math.hypot(nx, ny, nz) || 1;
          N[o] = nx / length;
          N[o + 1] = ny / length;
          N[o + 2] = nz / length;
          o += 3;
        }
      }
    }
  }

  private writeVertices(): void {
    const P = this.patchPosition, N = this.patchNormal;
    const out = this.positions.array as Float32Array, normals = this.normals.array as Float32Array;
    const { drawPatch, drawHeight, drawFlip } = this;
    for (let i = 0; i < drawPatch.length; i++) {
      const p = (drawPatch[i] as number) * 3;
      const h = drawHeight[i] as number;
      const nx = N[p] as number, ny = N[p + 1] as number, nz = N[p + 2] as number;
      const flip = drawFlip[i] as number;
      out[i * 3] = (P[p] as number) + nx * h;
      out[i * 3 + 1] = (P[p + 1] as number) + ny * h;
      out[i * 3 + 2] = (P[p + 2] as number) + nz * h;
      normals[i * 3] = nx * flip;
      normals[i * 3 + 1] = ny * flip;
      normals[i * 3 + 2] = nz * flip;
    }

    // Rims face outward, across the edge they close off.
    const { rims } = this;
    for (let r = 0; r < rims.length; r += 3) {
      const a = (rims[r] as number) * 3, b = (rims[r + 1] as number) * 3, sense = rims[r + 2] as number;
      const ex = (P[b] as number) - (P[a] as number), ey = (P[b + 1] as number) - (P[a + 1] as number), ez = (P[b + 2] as number) - (P[a + 2] as number);
      const nx = N[a] as number, ny = N[a + 1] as number, nz = N[a + 2] as number;
      let ox = ey * nz - ez * ny, oy = ez * nx - ex * nz, oz = ex * ny - ey * nx;
      const length = (Math.hypot(ox, oy, oz) || 1) * sense;
      ox /= length; oy /= length; oz /= length;
      const first = this.rimStart + (r / 3) * 4;
      for (let k = 0; k < 4; k++) {
        normals[(first + k) * 3] = ox;
        normals[(first + k) * 3 + 1] = oy;
        normals[(first + k) * 3 + 2] = oz;
      }
    }
    this.positions.needsUpdate = true;
    this.normals.needsUpdate = true;
  }

  private build(hidden: ReadonlySet<number>): void {
    const { piece } = this;
    const { book, soft } = piece;
    const { mesh: sim } = soft;
    const { tris, triCount, vertexCount, faceTri, cornerVertex } = sim;
    const thickness = piece.definition.thickness;
    const unit = piece.unit;

    this.patchPosition = new Float32Array(triCount * PATCH_POINTS * 3);
    this.patchNormal = new Float32Array(triCount * PATCH_POINTS * 3);
    this.vertexNormal = new Float32Array(vertexCount * 3);

    // Faces per solver triangle, bottom to top, with swinging faces left out.
    const stacks: number[][] = Array.from({ length: triCount }, () => []);
    for (const stack of book.stacks.values()) {
      for (const f of stack) {
        if (!hidden.has(f)) (stacks[faceTri[f] as number] as number[]).push(f);
      }
    }

    const patch: number[] = [];
    const height: number[] = [];
    const flip: number[] = [];
    const uv: number[] = [];
    const indices: number[][] = [[], [], []];

    /** Which book corner of a face sits on each solver corner. */
    const cornersOn = (f: number, t: number): [number, number, number] => {
      const map: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const v = tris[t * 3 + k] as number;
        for (let c = 0; c < 3; c++) if (cornerVertex[f * 3 + c] === v) map[k] = c;
      }
      return map;
    };

    /** Height of the middle of a face at each solver corner, in metres. */
    const heightsOn = (f: number, t: number): [number, number, number] => {
      const [c0, c1, c2] = cornersOn(f, t);
      return [cornerOffset(sim, f, c0, thickness), cornerOffset(sim, f, c1, thickness), cornerOffset(sim, f, c2, thickness)];
    };

    const surface = (t: number, f: number, up: boolean) => {
      const printed = (book.flipped[f] === 1) !== up;
      const slot = printed ? 0 : 1;
      const first = patch.length;
      const [c0, c1, c2] = cornersOn(f, t);
      const [h0, h1, h2] = heightsOn(f, t);
      const skin = up ? thickness / 2 : -thickness / 2;
      const rest = (c: number, axis: number) => ((book.rest[f * 6 + c * 2 + axis] as number) - book.span / 2) * unit;
      for (let a = DETAIL; a >= 0; a--) {
        const row = DETAIL - a;
        for (let b = 0; b <= row; b++) {
          const w0 = a / DETAIL, w1 = b / DETAIL, w2 = 1 - w0 - w1;
          patch.push(t * PATCH_POINTS + patchIndex(a, b));
          height.push(w0 * h0 + w1 * h1 + w2 * h2 + skin);
          flip.push(up ? 1 : -1);
          uv.push(w0 * rest(c0, 0) + w1 * rest(c1, 0) + w2 * rest(c2, 0), w0 * rest(c0, 1) + w1 * rest(c1, 1) + w2 * rest(c2, 1));
        }
      }
      const list = indices[slot] as number[];
      for (let i = 0; i < PATCH_TRIANGLES.length; i += 3) {
        const p = first + (PATCH_TRIANGLES[i] as number), q = first + (PATCH_TRIANGLES[i + 1] as number), r = first + (PATCH_TRIANGLES[i + 2] as number);
        if (up) list.push(p, q, r);
        else list.push(p, r, q);
      }
    };

    /** True if air can show between two layers of a stack. */
    const gapBetween = (low: number, high: number, t: number) => {
      const a = heightsOn(low, t), b = heightsOn(high, t);
      return Math.max(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > thickness * 1.02;
    };
    stacks.forEach((stack, t) => {
      stack.forEach((f, i) => {
        const below = stack[i - 1], above = stack[i + 1];
        if (below === undefined || gapBetween(below, f, t)) surface(t, f, false);
        if (above === undefined || gapBetween(f, above, t)) surface(t, f, true);
      });
    });
    this.rimStart = patch.length;

    // Cut edges, and the outside of creases, close the sheet off with a rim.
    const rims: number[] = [];
    const rimSegment = (t: number, { face: f, ka, kb, lowA, lowB, highA, highB, slot, sense }: RimPiece) => {
      for (let s = 0; s < DETAIL; s++) {
        const step = (i: number) => {
          const third = 3 - ka - kb;
          const counts = [0, 0, 0];
          counts[ka] = DETAIL - i;
          counts[kb] = i;
          counts[third] = 0;
          return patchIndex(counts[0] as number, counts[1] as number);
        };
        const a = t * PATCH_POINTS + step(s), b = t * PATCH_POINTS + step(s + 1);
        const first = patch.length;
        patch.push(a, b, b, a);
        const k0 = s / DETAIL, k1 = (s + 1) / DETAIL;
        const low0 = lerp(lowA, lowB, k0), low1 = lerp(lowA, lowB, k1), high0 = lerp(highA, highB, k0), high1 = lerp(highA, highB, k1);
        height.push(low0, low1, high1, high0);
        flip.push(1, 1, 1, 1);
        const u = (book.rest[f * 6] as number) * unit, w = (book.rest[f * 6 + 1] as number) * unit;
        uv.push(u, low0 * 8 + w, u + 0.25, low1 * 8 + w, u + 0.25, high1 * 8 + w, u, high0 * 8 + w);
        if (sense > 0) (indices[slot] as number[]).push(first, first + 1, first + 2, first, first + 2, first + 3);
        else (indices[slot] as number[]).push(first, first + 2, first + 1, first, first + 3, first + 2);
        rims.push(a, b, sense);
      }
    };

    // Rims that share an edge sit on one plane, so only the outermost is drawn:
    // a crease folded inside another is hidden by it, and would only flicker.
    const pieces = new Map<number, RimPiece[]>();
    const half = thickness / 2;
    const wanted = (t: number, piece: RimPiece) => {
      const key = t * 3 + Math.min(piece.ka, piece.kb) + Math.max(piece.ka, piece.kb) - 1;
      const list = pieces.get(key);
      if (list) list.push(piece);
      else pieces.set(key, [piece]);
    };

    for (const f of book.faces) {
      if (hidden.has(f)) continue;
      const t = faceTri[f] as number;
      const stack = stacks[t] as number[];
      const layer = stack.indexOf(f);
      for (let k = 0; k < 3; k++) {
        const va = cornerVertex[f * 3 + k] as number, vb = cornerVertex[f * 3 + (k + 1) % 3] as number;
        let ka = -1, kb = -1;
        for (let c = 0; c < 3; c++) {
          if (tris[t * 3 + c] === va) ka = c;
          if (tris[t * 3 + c] === vb) kb = c;
        }
        // Keep the third corner on the inside, so the rim always faces out.
        const sense = (kb - ka + 3) % 3 === 1 ? 1 : -1;
        const g = book.neighbour[f * 3 + k] as number;
        const open = g < 0 || book.edgeBlocked(f, k) || hidden.has(g);
        const onFace = heightsOn(f, t);
        const lowA = (onFace[ka] as number) - half, lowB = (onFace[kb] as number) - half;
        if (open) {
          wanted(t, { face: f, ka, kb, lowA, lowB, highA: lowA + thickness, highB: lowB + thickness, slot: 2, sense });
        } else if (faceTri[g] === t && stack.indexOf(g) > layer) {
          // A crease wraps from this layer round to the one above: paint the wrap.
          const onOther = heightsOn(g, t);
          const slot = book.flipped[f] === 1 ? 0 : 1;
          wanted(t, { face: f, ka, kb, lowA, lowB, highA: (onOther[ka] as number) + half, highB: (onOther[kb] as number) + half, slot, sense });
        }
      }
    }

    for (const [key, list] of pieces) {
      const t = Math.floor(key / 3);
      const low = (p: RimPiece) => (p.lowA + p.lowB) / 2, high = (p: RimPiece) => (p.highA + p.highB) / 2;
      for (const piece of list) {
        const inside = list.some((other) => other !== piece && low(other) <= low(piece) + 1e-4 && high(other) >= high(piece) - 1e-4
          && (high(other) - low(other) > high(piece) - low(piece) + 1e-4 || list.indexOf(other) < list.indexOf(piece)));
        if (!inside) rimSegment(t, piece);
      }
    }

    const count = patch.length;
    this.drawPatch = Int32Array.from(patch);
    this.drawHeight = Float32Array.from(height);
    this.drawFlip = Int8Array.from(flip);
    this.rims = Int32Array.from(rims);

    const geometry = new BufferGeometry();
    this.positions = new BufferAttribute(new Float32Array(count * 3), 3);
    this.normals = new BufferAttribute(new Float32Array(count * 3), 3);
    this.positions.setUsage(DynamicDrawUsage);
    this.normals.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('normal', this.normals);
    geometry.setAttribute('paperUv', new BufferAttribute(Float32Array.from(uv), 2));

    const all = new Uint32Array(indices.reduce((sum, list) => sum + list.length, 0));
    let offset = 0;
    indices.forEach((list, slot) => {
      geometry.addGroup(offset, list.length, slot);
      all.set(list, offset);
      offset += list.length;
    });
    geometry.setIndex(new BufferAttribute(all, 1));

    this.mesh?.geometry.dispose();
    if (this.mesh) this.group.remove(this.mesh);
    this.mesh = new Mesh(geometry, this.materials);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
    this.group.removeFromParent();
  }

  /** Vertices drawn right now, for the status display. */
  get triangles(): number {
    return (this.mesh?.geometry.index?.count ?? 0) / 3;
  }
}

const NOTHING: ReadonlySet<number> = new Set();

/** A stretch of rim up the side of a stack, not yet drawn. */
interface RimPiece {
  face: number;
  ka: number;
  kb: number;
  /** Heights at each end of the edge. */
  lowA: number;
  lowB: number;
  highA: number;
  highB: number;
  slot: number;
  sense: number;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
