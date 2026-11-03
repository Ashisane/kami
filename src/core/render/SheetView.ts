import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, LineBasicMaterial, LineSegments, Mesh } from 'three';
import type { Material } from 'three';
import type { SheetPiece } from '../fold/SheetPiece';
import { cornerOffset } from '../fold/soft/softMesh';
import { getStock, paper } from '../paper/paperLibrary';

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
/** How far an opened crease's mark sits off the paper, so it never flickers into it. */
const MARK_LIFT = 0.002;

/**
 * Marks drawn over the top of locked paper, in a material the caller provides. The
 * material reads `paperUv`, where a point sat on the unfolded sheet, and `markStamp`.
 */
export interface SheetMarks {
  readonly material: Material;
  /** Goes up whenever a stamp changes, so views draw their marks again. */
  readonly revision: number;
  /** When a face was marked, in seconds, and the point on the unfolded sheet it was pressed from. */
  stamp(face: number): readonly [number, number, number];
}

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
  private marksRevision = -1;
  private hiddenKey = '';

  // One patch of curved surface per solver triangle.
  private patchPosition = new Float32Array(0);
  private patchNormal = new Float32Array(0);
  private vertexNormal = new Float32Array(0);
  /** Which normal each triangle corner reads. A flap has its own, so a crease stays sharp. */
  private cornerNormal = new Int32Array(0);

  // What each drawn vertex is: a patch point, pushed along its normal by a height.
  private drawPatch = new Int32Array(0);
  private drawHeight = new Float32Array(0);
  private drawFlip = new Int8Array(0);
  /** Rim quads: patch points of the edge's two ends, and the outward sense. */
  private rims = new Int32Array(0);
  private rimStart = 0;
  private positions = new BufferAttribute(new Float32Array(0), 3);
  private normals = new BufferAttribute(new Float32Array(0), 3);
  /** A faint line where a crease was opened out again: drawn vertices, two per segment. */
  private creaseMarks = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: getStock('sumi').color, transparent: true, opacity: 0.32 }));
  private markVertices = new Int32Array(0);

  constructor(
    readonly piece: SheetPiece,
    private readonly marks: SheetMarks | null = null,
  ) {
    const { top, bottom, edge } = piece.definition;
    this.materials = [paper(top, { sheet: true }), paper(bottom, { sheet: true }), paper(edge, { sheet: true })];
    if (marks) this.materials.push(marks.material);
    this.creaseMarks.frustumCulled = false;
    this.group.add(this.creaseMarks);
  }

  /** Draws the piece, leaving out `hidden` faces while they swing as a separate flap. */
  update(hidden: ReadonlySet<number> = NOTHING): void {
    const key = hidden.size === 0 ? '' : `${hidden.size}:${[...hidden][0]}`;
    const marked = this.marks?.revision ?? 0;
    if (this.revision !== this.piece.revision || key !== this.hiddenKey || marked !== this.marksRevision) this.build(hidden);
    this.hiddenKey = key;
    this.revision = this.piece.revision;
    this.marksRevision = marked;
    this.computePatches();
    this.writeVertices();
  }

  private computePatches(): void {
    const { soft } = this.piece;
    const { mesh, x } = soft;
    const { tris, triCount } = mesh;
    const normal = this.vertexNormal;
    const corner = this.cornerNormal;
    normal.fill(0);
    for (let t = 0; t < triCount; t++) {
      const a = (tris[t * 3] as number) * 3, b = (tris[t * 3 + 1] as number) * 3, c = (tris[t * 3 + 2] as number) * 3;
      const ux = (x[b] as number) - (x[a] as number), uy = (x[b + 1] as number) - (x[a + 1] as number), uz = (x[b + 2] as number) - (x[a + 2] as number);
      const vx = (x[c] as number) - (x[a] as number), vy = (x[c + 1] as number) - (x[a + 1] as number), vz = (x[c + 2] as number) - (x[a + 2] as number);
      // Winding faces +y on flat paper, so this normal points to the top of the stack.
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (let k = 0; k < 3; k++) {
        const i = (corner[t * 3 + k] as number) * 3;
        normal[i] = (normal[i] as number) + nx;
        normal[i + 1] = (normal[i + 1] as number) + ny;
        normal[i + 2] = (normal[i + 2] as number) + nz;
      }
    }
    for (let i = 0; i < normal.length; i += 3) {
      const length = Math.hypot(normal[i] as number, normal[i + 1] as number, normal[i + 2] as number) || 1;
      normal[i] = (normal[i] as number) / length;
      normal[i + 1] = (normal[i + 1] as number) / length;
      normal[i + 2] = (normal[i + 2] as number) / length;
    }

    const rounding = soft.hardened ? 0 : ROUNDING;
    const P = this.patchPosition, N = this.patchNormal;
    const { vertexDepth } = mesh;
    const { thickness } = soft.settings;
    let o = 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = (tris[t * 3] as number) * 3, i1 = (tris[t * 3 + 1] as number) * 3, i2 = (tris[t * 3 + 2] as number) * 3;
      const x0 = x[i0] as number, y0 = x[i0 + 1] as number, z0 = x[i0 + 2] as number;
      const x1 = x[i1] as number, y1 = x[i1 + 1] as number, z1 = x[i1 + 2] as number;
      const x2 = x[i2] as number, y2 = x[i2 + 1] as number, z2 = x[i2 + 2] as number;
      // The solver only keeps corners off the table, and rounding can dip between them.
      const floor0 = (vertexDepth[tris[t * 3] as number] as number) * thickness;
      const floor1 = (vertexDepth[tris[t * 3 + 1] as number] as number) * thickness;
      const floor2 = (vertexDepth[tris[t * 3 + 2] as number] as number) * thickness;
      const c0 = (corner[t * 3] as number) * 3, c1 = (corner[t * 3 + 1] as number) * 3, c2 = (corner[t * 3 + 2] as number) * 3;
      const n0x = normal[c0] as number, n0y = normal[c0 + 1] as number, n0z = normal[c0 + 2] as number;
      const n1x = normal[c1] as number, n1y = normal[c1 + 1] as number, n1z = normal[c1 + 2] as number;
      const n2x = normal[c2] as number, n2y = normal[c2 + 1] as number, n2z = normal[c2 + 2] as number;
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
          P[o + 1] = Math.max(py - rounding * (w0 * d0 * n0y + w1 * d1 * n1y + w2 * d2 * n2y), w0 * floor0 + w1 * floor1 + w2 * floor2);
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

    const marks = this.creaseMarks.geometry.getAttribute('position') as BufferAttribute | undefined;
    if (!marks) return;
    const line = marks.array as Float32Array;
    const vertices = this.markVertices;
    for (let i = 0; i < vertices.length; i++) {
      const v = (vertices[i] as number) * 3;
      for (let axis = 0; axis < 3; axis++) line[i * 3 + axis] = (out[v + axis] as number) + (normals[v + axis] as number) * MARK_LIFT;
    }
    marks.needsUpdate = true;
  }

  private build(hidden: ReadonlySet<number>): void {
    const { piece } = this;
    const { book, soft } = piece;
    const { mesh: sim } = soft;
    const { tris, triCount, vertexCount, faceTri, cornerVertex, triFlap } = sim;
    const thickness = piece.definition.thickness;
    const unit = piece.unit;

    this.patchPosition = new Float32Array(triCount * PATCH_POINTS * 3);
    this.patchNormal = new Float32Array(triCount * PATCH_POINTS * 3);
    const normalOf = new Map<number, number>();
    this.cornerNormal = new Int32Array(triCount * 3);
    for (let i = 0; i < triCount * 3; i++) {
      const key = (tris[i] as number) + vertexCount * ((triFlap[Math.floor(i / 3)] as number) + 1);
      let id = normalOf.get(key);
      if (id === undefined) {
        id = normalOf.size;
        normalOf.set(key, id);
      }
      this.cornerNormal[i] = id;
    }
    this.vertexNormal = new Float32Array(normalOf.size * 3);

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
    const stamps: number[] = [];
    const indices: number[][] = [[], [], [], []];
    const { marks } = this;
    const { held } = piece;
    const markVertices: number[] = [];

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
      // Locked paper is marked where its top shows.
      const stamp = marks && up && held.has(f) ? marks.stamp(f) : NO_STAMP;
      // Edges of this face along a crease that lies open, flat, now: they are marked.
      const opened: [number, number][] = [];
      if (up) {
        for (let k = 0; k < 3; k++) {
          const g = book.neighbour[f * 3 + k] as number;
          if (g < 0 || !book.edgeCreased(f, k) || book.site(g) === book.site(f)) continue;
          opened.push([c0 === k ? 0 : c1 === k ? 1 : 2, c0 === (k + 1) % 3 ? 0 : c1 === (k + 1) % 3 ? 1 : 2]);
        }
      }
      const along: number[][] = opened.map(() => []);
      for (let a = DETAIL; a >= 0; a--) {
        const row = DETAIL - a;
        for (let b = 0; b <= row; b++) {
          const w0 = a / DETAIL, w1 = b / DETAIL, w2 = 1 - w0 - w1;
          patch.push(t * PATCH_POINTS + patchIndex(a, b));
          height.push(w0 * h0 + w1 * h1 + w2 * h2 + skin);
          flip.push(up ? 1 : -1);
          uv.push(w0 * rest(c0, 0) + w1 * rest(c1, 0) + w2 * rest(c2, 0), w0 * rest(c0, 1) + w1 * rest(c1, 1) + w2 * rest(c2, 1));
          stamps.push(stamp[0], stamp[1], stamp[2]);
          const steps = [a, b, DETAIL - a - b];
          opened.forEach(([ka, kb], i) => {
            if (steps[3 - ka - kb] === 0) (along[i] as number[])[steps[ka] as number] = patch.length - 1;
          });
        }
      }
      for (const points of along) for (let i = 0; i < DETAIL; i++) markVertices.push(points[i] as number, points[i + 1] as number);
      const list = indices[slot] as number[];
      const mark = stamp === NO_STAMP ? null : (indices[3] as number[]);
      for (let i = 0; i < PATCH_TRIANGLES.length; i += 3) {
        const p = first + (PATCH_TRIANGLES[i] as number), q = first + (PATCH_TRIANGLES[i + 1] as number), r = first + (PATCH_TRIANGLES[i + 2] as number);
        if (up) list.push(p, q, r);
        else list.push(p, r, q);
        mark?.push(p, q, r);
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
        for (let k = 0; k < 4; k++) stamps.push(NO_STAMP[0], NO_STAMP[1], NO_STAMP[2]);
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
    this.markVertices = Int32Array.from(markVertices);
    this.creaseMarks.geometry.dispose();
    this.creaseMarks.geometry = new BufferGeometry();
    this.creaseMarks.geometry.setAttribute('position', new BufferAttribute(new Float32Array(markVertices.length * 3), 3));

    const geometry = new BufferGeometry();
    this.positions = new BufferAttribute(new Float32Array(count * 3), 3);
    this.normals = new BufferAttribute(new Float32Array(count * 3), 3);
    this.positions.setUsage(DynamicDrawUsage);
    this.normals.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('normal', this.normals);
    geometry.setAttribute('paperUv', new BufferAttribute(Float32Array.from(uv), 2));
    if (marks) geometry.setAttribute('markStamp', new BufferAttribute(Float32Array.from(stamps), 3));

    const all = new Uint32Array(indices.reduce((sum, list) => sum + list.length, 0));
    let offset = 0;
    indices.forEach((list, slot) => {
      if (list.length === 0) return;
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
    this.creaseMarks.geometry.dispose();
    this.group.removeFromParent();
  }

  /** The lowest point drawn, so a check can see paper is not under the table. */
  get lowest(): number {
    const y = this.positions.array;
    let low = Infinity;
    for (let i = 1; i < y.length; i += 3) low = Math.min(low, y[i] as number);
    return low;
  }

  /** Vertices drawn right now, for the status display. */
  get triangles(): number {
    return (this.mesh?.geometry.index?.count ?? 0) / 3;
  }
}

const NOTHING: ReadonlySet<number> = new Set();
const NO_STAMP = [0, 0, 0] as const;

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
