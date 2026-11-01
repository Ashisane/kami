import type { SheetDefinition } from '../asset/sheetTypes';
import { FoldBook } from './FoldBook';
import type { FoldPlan, FoldRequest } from './FoldBook';
import { reflectX, reflectZ, sideOf } from './lattice';
import type { MirrorLine } from './lattice';
import { extractRotation, rotateInto } from './soft/rotation';
import type { Quat } from './soft/rotation';
import { buildSoftMesh, metresPerUnit } from './soft/softMesh';
import { SoftSheet } from './soft/SoftSheet';
import type { SoftSettings } from './soft/SoftSheet';

/**
 * One connected piece of paper: the exact Book plus the floppy cloth built from
 * it, kept in step. Everything that changes the paper goes through here. No
 * three.js, so tests and a future server can run it directly.
 */
export class SheetPiece {
  soft: SoftSheet;
  /** Faces currently lifted off their stack, or empty. */
  private peeled: ReadonlySet<number> = new Set();

  /** Goes up whenever the cloth is rebuilt, so a view knows to rebuild too. */
  revision = 0;
  /** Where every face corner was just before the last rebuild, for the view to tween from. */
  previousCorners: Float64Array | null = null;
  /** What the last fold rotated, if it should swing rather than slide. */
  lastSwing: { line: MirrorLine; moved: ReadonlySet<number> } | null = null;

  constructor(
    readonly definition: SheetDefinition,
    public book: FoldBook = FoldBook.sheet(definition.cells),
    private settings: Partial<SoftSettings> = {},
    initial?: Float64Array,
  ) {
    this.soft = new SoftSheet(buildSoftMesh(book, definition.size), this.solverSettings(), initial);
  }

  private solverSettings(): Partial<SoftSettings> {
    return { thickness: this.definition.thickness, floppiness: this.definition.floppiness, ...this.settings };
  }

  get unit(): number {
    return metresPerUnit(this.book, this.definition.size);
  }

  /** Lattice units to metres on the flat sheet, which is centred on the origin. */
  toMetres(units: number): number {
    return (units - this.book.span / 2) * this.unit;
  }

  toUnits(metres: number): number {
    return metres / this.unit + this.book.span / 2;
  }

  step(dt: number): void {
    this.soft.step(dt);
  }

  setFloppiness(floppiness: number): void {
    this.settings = { ...this.settings, floppiness };
    this.soft.setFloppiness(floppiness);
  }

  /** World position of every face corner, in face order. */
  corners(): Float64Array {
    const { cornerVertex } = this.soft.mesh;
    const out = new Float64Array(this.book.faceCount * 9);
    const { x } = this.soft;
    for (const f of this.book.faces) {
      for (let k = 0; k < 3; k++) {
        const v = (cornerVertex[f * 3 + k] as number) * 3;
        const o = f * 9 + k * 3;
        out[o] = x[v] as number;
        out[o + 1] = x[v + 1] as number;
        out[o + 2] = x[v + 2] as number;
      }
    }
    return out;
  }

  /** Replaces the cloth. Pins hold triangles that no longer exist, so their owners must re-grip. */
  private rebuild(positions: (mesh: ReturnType<typeof buildSoftMesh>) => Float64Array): void {
    const mesh = buildSoftMesh(this.book, this.definition.size, this.peeled);
    this.soft = new SoftSheet(mesh, this.solverSettings(), positions(mesh));
    this.revision++;
  }

  /** Commits a fold. Refused folds change nothing and report why. */
  fold(request: FoldRequest, swing = false): FoldPlan {
    const plan = this.book.plan(request);
    if (plan.failure) return plan;
    const before = this.corners();
    const frame = this.frameOf(plan.moved);

    this.book.fold(request);
    this.peeled = new Set();
    this.previousCorners = before;
    this.lastSwing = swing ? { line: request.line, moved: plan.moved } : null;

    this.rebuild((mesh) => {
      const out = new Float64Array(mesh.vertexCount * 3);
      const weight = new Float64Array(mesh.vertexCount);
      // Whatever did not move stays exactly where it was.
      for (const f of this.book.faces) {
        if (plan.moved.has(f)) continue;
        for (let k = 0; k < 3; k++) {
          const v = mesh.cornerVertex[f * 3 + k] as number;
          out[v * 3] = (out[v * 3] as number) + (before[f * 9 + k * 3] as number);
          out[v * 3 + 1] = (out[v * 3 + 1] as number) + (before[f * 9 + k * 3 + 1] as number);
          out[v * 3 + 2] = (out[v * 3 + 2] as number) + (before[f * 9 + k * 3 + 2] as number);
          weight[v] = (weight[v] as number) + 1;
        }
      }
      // Anything hanging past the rest lands where the sheet's flat frame puts it.
      const landing = new Float64Array(3);
      for (let v = 0; v < mesh.vertexCount; v++) {
        const w = weight[v] as number;
        if (w > 0) {
          out[v * 3] = (out[v * 3] as number) / w;
          out[v * 3 + 1] = (out[v * 3 + 1] as number) / w;
          out[v * 3 + 2] = (out[v * 3 + 2] as number) / w;
        } else {
          frame(mesh.flat[v * 2] as number, mesh.flat[v * 2 + 1] as number, landing);
          out.set(landing, v * 3);
        }
      }
      return out;
    });
    return plan;
  }

  /**
   * The rigid frame that maps the flat sheet to the world, fitted to the paper
   * that is staying put, so an overhang lands in line with whatever it rests on.
   */
  frameOf(excluded: ReadonlySet<number>): (x: number, z: number, out: Float64Array) => void {
    const { mesh, x } = this.soft;
    const use = new Uint8Array(mesh.vertexCount);
    for (const f of this.book.faces) {
      if (excluded.has(f)) continue;
      for (let k = 0; k < 3; k++) use[mesh.cornerVertex[f * 3 + k] as number] = 1;
    }
    let count = 0, wx = 0, wy = 0, wz = 0, fx = 0, fz = 0;
    for (let v = 0; v < mesh.vertexCount; v++) {
      if (!use[v]) continue;
      count++;
      wx += x[v * 3] as number;
      wy += x[v * 3 + 1] as number;
      wz += x[v * 3 + 2] as number;
      fx += mesh.flat[v * 2] as number;
      fz += mesh.flat[v * 2 + 1] as number;
    }
    if (count === 0) return (px, pz, out) => { out[0] = px; out[1] = 0; out[2] = pz; };
    wx /= count; wy /= count; wz /= count; fx /= count; fz /= count;

    const m = new Float64Array(9);
    for (let v = 0; v < mesh.vertexCount; v++) {
      if (!use[v]) continue;
      const px = (x[v * 3] as number) - wx, py = (x[v * 3 + 1] as number) - wy, pz = (x[v * 3 + 2] as number) - wz;
      const qx = (mesh.flat[v * 2] as number) - fx, qz = (mesh.flat[v * 2 + 1] as number) - fz;
      m[0] = (m[0] as number) + px * qx; m[1] = (m[1] as number) + py * qx; m[2] = (m[2] as number) + pz * qx;
      m[6] = (m[6] as number) + px * qz; m[7] = (m[7] as number) + py * qz; m[8] = (m[8] as number) + pz * qz;
    }
    const q: Quat = [0, 0, 0, 1];
    extractRotation(m, q, 24);
    return (px, pz, out) => rotateInto(q, px - fx, 0, pz - fz, out, 0, wx, wy, wz);
  }

  /** The flat position, in metres, that a world point sits over. */
  worldToFlat(point: { x: number; y: number; z: number }, excluded: ReadonlySet<number>): { x: number; z: number; height: number } {
    const frame = this.frameOf(excluded);
    const origin = new Float64Array(3), ax = new Float64Array(3), az = new Float64Array(3);
    frame(0, 0, origin);
    frame(1, 0, ax);
    frame(0, 1, az);
    const ux = (ax[0] as number) - (origin[0] as number), uy = (ax[1] as number) - (origin[1] as number), uz = (ax[2] as number) - (origin[2] as number);
    const vx = (az[0] as number) - (origin[0] as number), vy = (az[1] as number) - (origin[1] as number), vz = (az[2] as number) - (origin[2] as number);
    const dx = point.x - (origin[0] as number), dy = point.y - (origin[1] as number), dz = point.z - (origin[2] as number);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return { x: dx * ux + dy * uy + dz * uz, z: dx * vx + dy * vy + dz * vz, height: -(dx * nx + dy * ny + dz * nz) };
  }

  /** Flat paper connected to a face, stopping at every crease. */
  private flatRegion(face: number): Set<number> {
    const { book } = this;
    const region = new Set([face]);
    const todo = [face];
    while (todo.length) {
      const f = todo.pop() as number;
      for (let k = 0; k < 3; k++) {
        const g = book.neighbour[f * 3 + k] as number;
        if (g < 0 || region.has(g) || book.edgeBlocked(f, k) || book.flipped[g] !== book.flipped[f]) continue;
        region.add(g);
        todo.push(g);
      }
    }
    return region;
  }

  /** Which straight line a face's edge lies along, as a key. */
  private edgeLine(f: number, k: number): string {
    const { at } = this.book;
    const n = (k + 1) % 3;
    const ax = at[f * 6 + k * 2] as number, az = at[f * 6 + k * 2 + 1] as number;
    const bx = at[f * 6 + n * 2] as number, bz = at[f * 6 + n * 2 + 1] as number;
    if (ax === bx) return `x${ax}`;
    if (az === bz) return `z${az}`;
    return (bx - ax) * (bz - az) > 0 ? `d${ax - az}` : `s${ax + az}`;
  }

  /**
   * Every face that lifts with this one. A flap turns on its longest crease, like
   * the spine of a book, and anything folded into it on its other creases comes
   * along. If that would be the whole piece, only the flat paper lifts.
   */
  flapOf(face: number): Set<number> {
    const { book } = this;
    const flat = this.flatRegion(face);

    const crease = new Map<string, number>();
    for (const f of flat) {
      for (let k = 0; k < 3; k++) {
        const g = book.neighbour[f * 3 + k] as number;
        if (g < 0 || flat.has(g) || book.edgeBlocked(f, k)) continue;
        const line = this.edgeLine(f, k);
        crease.set(line, (crease.get(line) ?? 0) + 1);
      }
    }
    let hinge = '';
    let longest = 0;
    for (const [line, length] of crease) {
      if (length > longest) {
        longest = length;
        hinge = line;
      }
    }

    const flap = new Set(flat);
    const todo = [...flat];
    while (todo.length) {
      const f = todo.pop() as number;
      for (let k = 0; k < 3; k++) {
        const g = book.neighbour[f * 3 + k] as number;
        if (g < 0 || flap.has(g) || book.edgeBlocked(f, k) || this.edgeLine(f, k) === hinge) continue;
        flap.add(g);
        todo.push(g);
      }
    }
    return flap.size === book.faces.length ? flat : flap;
  }

  /** Faces currently lifted off their stack. */
  get lifted(): ReadonlySet<number> {
    return this.peeled;
  }

  /**
   * Lifts a flap off the stack so it can be folded alone. Refused if the flap is
   * the whole piece, or if another layer is lying on top of any part of it.
   */
  peel(face: number): boolean {
    const flap = this.flapOf(face);
    if (flap.size === this.book.faces.length) return false;
    for (const f of flap) {
      const stack = this.book.stackOf(f);
      if (stack.slice(stack.indexOf(f) + 1).some((g) => !flap.has(g))) return false;
    }
    if (![...flap].some((f) => this.book.depth(f) > 1)) return false;

    const before = this.corners();
    this.peeled = flap;
    const lift = this.definition.thickness * 1.5;
    this.rebuild((mesh) => {
      const out = new Float64Array(mesh.vertexCount * 3);
      for (const f of this.book.faces) {
        for (let k = 0; k < 3; k++) {
          const v = mesh.cornerVertex[f * 3 + k] as number;
          out[v * 3] = before[f * 9 + k * 3] as number;
          out[v * 3 + 1] = (before[f * 9 + k * 3 + 1] as number) + (flap.has(f) ? lift : 0);
          out[v * 3 + 2] = before[f * 9 + k * 3 + 2] as number;
        }
      }
      return out;
    });
    return true;
  }

  /** Lets a lifted flap fall back into the stack. */
  settle(): void {
    if (this.peeled.size === 0) return;
    const before = this.corners();
    const flap = this.peeled;
    this.peeled = new Set();
    this.previousCorners = before;
    this.lastSwing = null;
    this.rebuild((mesh) => {
      const out = new Float64Array(mesh.vertexCount * 3);
      const seen = new Uint8Array(mesh.vertexCount);
      for (const f of this.book.faces) {
        for (let k = 0; k < 3; k++) {
          const v = mesh.cornerVertex[f * 3 + k] as number;
          if (flap.has(f) && seen[v]) continue;
          if (!flap.has(f)) seen[v] = 1;
          out[v * 3] = before[f * 9 + k * 3] as number;
          out[v * 3 + 1] = before[f * 9 + k * 3 + 1] as number;
          out[v * 3 + 2] = before[f * 9 + k * 3 + 2] as number;
        }
      }
      return out;
    });
  }

  /** Cuts along a stretch of a line. Returns every resulting piece, this one first. */
  cut(line: MirrorLine, from: number, to: number): SheetPiece[] {
    const before = this.corners();
    const books = this.book.cutAlong(line, from, to);
    const pieces = books.map((book) => {
      if (book === this.book) return this;
      const mesh = buildSoftMesh(book, this.definition.size);
      const initial = new Float64Array(mesh.vertexCount * 3);
      for (const f of book.faces) {
        for (let k = 0; k < 3; k++) {
          const v = mesh.cornerVertex[f * 3 + k] as number;
          initial[v * 3] = before[f * 9 + k * 3] as number;
          initial[v * 3 + 1] = before[f * 9 + k * 3 + 1] as number;
          initial[v * 3 + 2] = before[f * 9 + k * 3 + 2] as number;
        }
      }
      return new SheetPiece(this.definition, book, this.settings, initial);
    });
    if (books.length === 1 && books[0] === this.book) {
      this.rebuild((mesh) => {
        const out = new Float64Array(mesh.vertexCount * 3);
        for (const f of this.book.faces) {
          for (let k = 0; k < 3; k++) {
            const v = mesh.cornerVertex[f * 3 + k] as number;
            out.set(before.subarray(f * 9 + k * 3, f * 9 + k * 3 + 3), v * 3);
          }
        }
        return out;
      });
    }
    return pieces;
  }

  /** Freezes the paper's present shape into one solid body, or releases it. */
  harden(solid: boolean): void {
    this.soft.harden(solid);
  }
}

/** Where a point lands if folded across a line, in metres on the flat sheet. */
export function mirroredPoint(piece: SheetPiece, line: MirrorLine, x: number, z: number): { x: number; z: number } {
  const ux = piece.toUnits(x), uz = piece.toUnits(z);
  return { x: piece.toMetres(reflectX(line, ux, uz)), z: piece.toMetres(reflectZ(line, ux, uz)) };
}

/** Which side of a line a flat point falls on. */
export const flatSide = (piece: SheetPiece, line: MirrorLine, x: number, z: number): number =>
  sideOf(line, piece.toUnits(x), piece.toUnits(z));
