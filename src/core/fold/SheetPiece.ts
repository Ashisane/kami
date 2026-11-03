import type { SheetDefinition } from '../asset/sheetTypes';
import { FoldBook } from './FoldBook';
import type { FoldFailure, FoldPlan, FoldRequest, UnfoldPlan } from './FoldBook';
import { applyOpen } from './recipes';
import type { OpenStep } from './recipes';
import type { ReshapeFailure } from './reshape';
import { jointPoint, poseCraft, standOn, toWorld } from './craft';
import type { Joint, Stance } from './craft';
import { reflectX, reflectZ, sideOf, UNITS_PER_CELL } from './lattice';
import type { MirrorLine } from './lattice';
import { extractRotation, rotateInto } from './soft/rotation';
import type { Quat } from './soft/rotation';
import { buildSoftMesh, metresPerUnit } from './soft/softMesh';
import { CONTACT_GAP, SoftSheet } from './soft/SoftSheet';
import type { Body, SoftSettings } from './soft/SoftSheet';

/** Why a fold cannot be made: one of the Book's reasons, or paper that is locked. */
export type FoldRefusal = FoldFailure | 'held';

/** A fold as this piece would make it. The Book may allow a fold that locked paper refuses. */
export interface PiecePlan extends Omit<FoldPlan, 'failure'> {
  failure: FoldRefusal | null;
}

/**
 * One connected piece of paper: the exact Book plus the floppy cloth built from
 * it, kept in step. Everything that changes the paper goes through here. No
 * three.js, so tests and a future server can run it directly.
 */
export class SheetPiece {
  soft: SoftSheet;
  /**
   * Locked paper, as if held under a hand: it stays still and pressed flat, and
   * nothing moves it until it is unlocked. Loose paper lying on it is held with it,
   * until a hand lifts it off as a flap.
   */
  private holds: Set<number>;
  /** Paper lifted off its stacks right now. */
  private flaps: ReadonlySet<number>[] = [];
  /** The line each flap is being folded along, if a fold is lined up for it. */
  private bends: (MirrorLine | null)[] = [];
  /** Set once the paper is marked complete: it is then stiff plates on hinges. */
  private finished: { joints: Joint[]; stance: Stance; lying: Stance } | null = null;

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
    held: Iterable<number> = [],
    /** Bodies standing in the paper's way, kept across every rebuild of the cloth. */
    readonly bodies: Body[] = [],
  ) {
    this.holds = new Set(held);
    this.soft = new SoftSheet(buildSoftMesh(book, definition.size, [], [], this.holds), this.solverSettings(), initial, bodies);
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
    if (!this.finished) this.soft.step(dt);
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
    if (this.bends.length !== this.flaps.length) this.bends = this.flaps.map(() => null);
    // A finished craft is stiff plates, and nothing on it is held.
    const mesh = buildSoftMesh(this.book, this.definition.size, this.flaps, this.bends, this.finished ? undefined : this.holds);
    this.soft = new SoftSheet(mesh, this.solverSettings(), positions(mesh), this.bodies);
    this.revision++;
  }

  /** What a fold would do. It is refused if it would move locked paper. */
  plan(request: FoldRequest): PiecePlan {
    const plan = this.book.plan(request);
    if (!plan.failure && [...plan.moved].some((f) => this.holds.has(f))) return { ...plan, failure: 'held' };
    return plan;
  }

  /** Paper that is locked right now. */
  get held(): ReadonlySet<number> {
    return this.holds;
  }

  /**
   * Locks paper, or unlocks it. Locking presses paper flat onto the table where it
   * lies, as a hand does, and paper lifted in a hand drops back onto its stack.
   * Returns the faces that changed.
   */
  lock(faces: Iterable<number>, locked: boolean): Set<number> {
    const changed = new Set<number>();
    for (const f of faces) {
      if (locked === this.holds.has(f)) continue;
      if (locked) this.holds.add(f);
      else this.holds.delete(f);
      changed.add(f);
    }
    if (changed.size === 0) return changed;
    if (locked) {
      const kept = this.flaps.map((flap) => new Set([...flap].filter((f) => !this.holds.has(f))));
      this.bends = this.bends.filter((_, i) => (kept[i] as Set<number>).size > 0);
      this.flaps = kept.filter((flap) => flap.size > 0);
    }
    const before = this.corners();
    const table = locked ? this.tableFrame(this.lifted) : null;
    this.rebuild((mesh) => {
      // Every point stays where it is. Points that now weld meet halfway.
      const out = new Float64Array(mesh.vertexCount * 3);
      const count = new Float64Array(mesh.vertexCount);
      for (const f of this.book.faces) {
        for (let k = 0; k < 3; k++) {
          const v = mesh.cornerVertex[f * 3 + k] as number;
          for (let i = 0; i < 3; i++) out[v * 3 + i] = (out[v * 3 + i] as number) + (before[f * 9 + k * 3 + i] as number);
          count[v] = (count[v] as number) + 1;
        }
      }
      for (let v = 0; v < mesh.vertexCount; v++) for (let i = 0; i < 3; i++) out[v * 3 + i] = (out[v * 3 + i] as number) / ((count[v] as number) || 1);
      if (table) this.pressFlat(mesh, out, changed, table);
      return out;
    });
    return changed;
  }

  /**
   * The paper's flat frame, turned level and set down on the table: where pressing
   * paper flat puts it. Paper locked while it hung in the air would stay there.
   */
  private tableFrame(excluded: ReadonlySet<number>): (x: number, z: number, out: Float64Array) => void {
    const frame = this.frameOf(excluded);
    const origin = new Float64Array(3), ax = new Float64Array(3), az = new Float64Array(3);
    frame(0, 0, origin);
    frame(1, 0, ax);
    frame(0, 1, az);
    let xx = (ax[0] as number) - (origin[0] as number), xz = (ax[2] as number) - (origin[2] as number);
    const xLength = Math.hypot(xx, xz);
    if (xLength < 1e-6) [xx, xz] = [1, 0];
    else [xx, xz] = [xx / xLength, xz / xLength];
    // The flat sheet's other axis, square to the first, and keeping the side it was on.
    let zx = (az[0] as number) - (origin[0] as number), zz = (az[2] as number) - (origin[2] as number);
    const along = zx * xx + zz * xz;
    zx -= along * xx;
    zz -= along * xz;
    const zLength = Math.hypot(zx, zz);
    if (zLength < 1e-6) [zx, zz] = [-xz, xx];
    else [zx, zz] = [zx / zLength, zz / zLength];
    const ox = origin[0] as number, oz = origin[2] as number;
    return (px, pz, out) => {
      out[0] = ox + xx * px + zx * pz;
      out[1] = 0;
      out[2] = oz + xz * px + zz * pz;
    };
  }

  /** Lays some faces flat on the table, each corner at the height its layers rest at. */
  private pressFlat(mesh: ReturnType<typeof buildSoftMesh>, out: Float64Array, faces: ReadonlySet<number>, table: (x: number, z: number, out: Float64Array) => void): void {
    const point = new Float64Array(3);
    for (const f of faces) {
      for (let k = 0; k < 3; k++) {
        const v = mesh.cornerVertex[f * 3 + k] as number;
        table(mesh.flat[v * 2] as number, mesh.flat[v * 2 + 1] as number, point);
        out[v * 3] = point[0] as number;
        out[v * 3 + 1] = (mesh.vertexDepth[v] as number) * this.definition.thickness;
        out[v * 3 + 2] = point[2] as number;
      }
    }
  }

  /**
   * Commits a fold. Refused folds change nothing and report why. A pressed fold
   * locks what it moved together with the layers it came to lie on: the fold is
   * then a joint with the paper underneath, as if creased and held under a hand.
   */
  fold(request: FoldRequest, swing = false, press = false): PiecePlan {
    const plan = this.plan(request);
    if (plan.failure) return plan;
    const before = this.corners();
    const frame = this.frameOf(plan.moved);
    const table = press ? this.tableFrame(plan.moved) : null;

    this.book.fold(request);
    const pressed = new Set<number>();
    if (press) {
      for (const f of plan.moved) {
        for (const g of this.book.stackOf(f)) {
          if (!this.holds.has(g)) pressed.add(g);
          this.holds.add(g);
        }
      }
    }
    this.flaps = [];
    this.bends = [];
    this.previousCorners = before;
    this.lastSwing = swing ? { line: request.line, moved: plan.moved } : null;

    this.rebuild((mesh) => {
      const out = this.landedPositions(mesh, plan.moved, before, frame);
      if (table) this.pressFlat(mesh, out, pressed, table);
      return out;
    });
    return plan;
  }

  /**
   * Opens the outermost flap at a face back out across the crease it turns on.
   * Returns null if no flap there is free to open: something lies on it, or it is
   * not folded at all.
   */
  unfold(face: number, under = false): UnfoldPlan | null {
    const opening = this.jointAt(face, under);
    if (!opening) return null;
    const line = lineOfKey(opening.hinge);
    const plan = this.book.planUnfold(opening.faces, line);
    if (plan.failure) return plan;
    if ([...opening.faces].some((f) => this.holds.has(f))) return { ...plan, failure: 'covered' };
    const before = this.corners();
    const frame = this.frameOf(opening.faces);
    this.book.unfold(opening.faces, line);
    this.flaps = [];
    this.bends = [];
    this.previousCorners = before;
    this.lastSwing = { line, moved: opening.faces };
    this.rebuild((mesh) => this.landedPositions(mesh, opening.faces, before, frame));
    return plan;
  }

  /** Where the cloth's points go after paper moved: the rest stays, the moved paper lands flat. */
  private landedPositions(mesh: ReturnType<typeof buildSoftMesh>, moved: ReadonlySet<number>, before: Float64Array, frame: (x: number, z: number, out: Float64Array) => void): Float64Array {
    const out = new Float64Array(mesh.vertexCount * 3);
    const weight = new Float64Array(mesh.vertexCount);
    // Whatever did not move stays exactly where it was.
    for (const f of this.book.faces) {
      if (moved.has(f)) continue;
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
  }

  /** Opens a pocket and flattens it a new way. The whole piece moves, so all of it lands afresh. */
  open(step: OpenStep): ReshapeFailure | null {
    const frame = this.frameOf(new Set());
    const failure = applyOpen(this.book, this.definition.size, step);
    if (failure) return failure;
    // The whole piece is laid out afresh, so nothing stays held where it was.
    this.holds.clear();
    this.flaps = [];
    this.bends = [];
    this.rebuild((mesh) => {
      const out = new Float64Array(mesh.vertexCount * 3);
      const landing = new Float64Array(3);
      for (let v = 0; v < mesh.vertexCount; v++) {
        frame(mesh.flat[v * 2] as number, mesh.flat[v * 2 + 1] as number, landing);
        out.set(landing, v * 3);
      }
      return out;
    });
    return null;
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
    return readFlat(this.frameOf(excluded), point);
  }

  /** Fits a frame to the paper as it lies now, minus some, to read points against later. */
  frameNow(excluded: ReadonlySet<number>): (x: number, z: number, out: Float64Array) => void {
    const frame = this.frameOf(excluded);
    const origin = new Float64Array(3), ax = new Float64Array(3), az = new Float64Array(3);
    frame(0, 0, origin);
    frame(1, 0, ax);
    frame(0, 1, az);
    return (x, z, out) => {
      for (let i = 0; i < 3; i++) out[i] = (origin[i] as number) + x * ((ax[i] as number) - (origin[i] as number)) + z * ((az[i] as number) - (origin[i] as number));
    };
  }

  /** Faces whose middles lie within a radius of a flat point, in metres. */
  facesWithin(x: number, z: number, radius: number): number[] {
    const { at } = this.book;
    const reach = radius / this.unit;
    const ux = this.toUnits(x), uz = this.toUnits(z);
    return this.book.faces.filter((f) => {
      const cx = ((at[f * 6] as number) + (at[f * 6 + 2] as number) + (at[f * 6 + 4] as number)) / 3;
      const cz = ((at[f * 6 + 1] as number) + (at[f * 6 + 3] as number) + (at[f * 6 + 5] as number)) / 3;
      return Math.hypot(cx - ux, cz - uz) <= reach;
    });
  }

  /** Flat paper connected to a face, stopping at every crease. */
  flatRegion(face: number): Set<number> {
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
   * Every face that lifts with this one. A flap turns on one crease, like the
   * spine of a book, and anything folded into it on its other creases comes along.
   * A plane's wing is several separate layers tucked over each other, all turning
   * on the same crease, and they lift as one.
   * The longest crease that leaves the flap free to lift is the one it turns on.
   * If nothing can lift, this answers with the longest crease's flap, or just the
   * flat paper when that would be the whole piece. `under` works from the far side.
   */
  flapOf(face: number, under = false): Set<number> {
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
    let longest: Set<number> | null = null;
    for (const [hinge] of [...crease].sort((a, b) => b[1] - a[1])) {
      const flap = this.turningOn(face, hinge, under);
      if (flap.size === book.faces.length) continue;
      if (!this.heldDown(flap, under)) return flap;
      longest ??= flap;
    }
    return longest ?? flat;
  }

  /**
   * Everything that swings with a face when it turns on a line. Cutting the paper
   * along the line splits it into parts. What the face is joined to across the line
   * stays behind, and every other part lying outside of that swings too. A tab tucked
   * between the layers that stay is held by them, so it stays. Returns the whole
   * piece if the line does not actually part the paper.
   */
  private turningOn(face: number, hinge: string, under: boolean): Set<number> {
    const { book, lifted } = this;
    const part = new Int32Array(book.faceCount).fill(-1);
    let parts = 0;
    for (const start of book.faces) {
      if ((part[start] as number) >= 0) continue;
      const id = parts++;
      part[start] = id;
      const todo = [start];
      while (todo.length) {
        const f = todo.pop() as number;
        for (let k = 0; k < 3; k++) {
          const g = book.neighbour[f * 3 + k] as number;
          if (g < 0 || (part[g] as number) >= 0 || book.edgeBlocked(f, k) || this.edgeLine(f, k) === hinge) continue;
          part[g] = id;
          todo.push(g);
        }
      }
    }

    const swinging = new Set([part[face] as number]);
    const staying = new Set<number>();
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of book.faces) {
        if (!swinging.has(part[f] as number)) continue;
        for (let k = 0; k < 3; k++) {
          const g = book.neighbour[f * 3 + k] as number;
          if (g >= 0 && !book.edgeBlocked(f, k) && part[g] !== part[f]) staying.add(part[g] as number);
        }
      }
      for (const stack of book.stacks.values()) {
        // In from the outside. Everything outside the paper that stays swings, and so
        // does whatever lies on the outside of swinging paper: it is carried, as in a fold.
        const outside: number[] = [];
        let innermost = -1;
        let reachedStaying = false;
        for (let i = 0; i < stack.length; i++) {
          const f = stack[under ? i : stack.length - 1 - i] as number;
          if (lifted.has(f)) continue;
          const p = part[f] as number;
          if (staying.has(p)) {
            reachedStaying = true;
            break;
          }
          outside.push(p);
          if (swinging.has(p)) innermost = outside.length - 1;
        }
        for (const p of reachedStaying ? outside : outside.slice(0, innermost + 1)) {
          if (swinging.has(p)) continue;
          swinging.add(p);
          grew = true;
        }
      }
    }
    if ([...swinging].some((p) => staying.has(p))) return new Set(book.faces);
    return new Set(book.faces.filter((f) => swinging.has(part[f] as number)));
  }

  /** True if another layer is lying on the outside of any part of this paper. A lifted one is not. */
  private heldDown(flap: ReadonlySet<number>, under: boolean): boolean {
    const { lifted } = this;
    for (const f of flap) {
      const stack = this.book.stackOf(f);
      const at = stack.indexOf(f);
      if ((under ? stack.slice(0, at) : stack.slice(at + 1)).some((g) => !flap.has(g) && !lifted.has(g))) return true;
    }
    return false;
  }

  /**
   * The flat paper around a face that can be seen, stopping at whatever covers it.
   * Empty if the face itself is covered. Real paper can always be lifted where it
   * shows: it bends away from under the layer holding it, and from its creases.
   */
  private showing(face: number, under: boolean): Set<number> {
    const { book, lifted, holds } = this;
    const outermost = (f: number) => {
      const stack = book.stackOf(f);
      const at = stack.indexOf(f);
      return !(under ? stack.slice(0, at) : stack.slice(at + 1)).some((g) => !lifted.has(g));
    };
    const shown = new Set<number>();
    if (lifted.has(face) || holds.has(face) || !outermost(face)) return shown;
    const flat = this.flatRegion(face);
    shown.add(face);
    const todo = [face];
    while (todo.length) {
      const f = todo.pop() as number;
      for (let k = 0; k < 3; k++) {
        const g = book.neighbour[f * 3 + k] as number;
        if (g < 0 || shown.has(g) || !flat.has(g) || book.edgeBlocked(f, k) || lifted.has(g) || holds.has(g) || !outermost(g)) continue;
        shown.add(g);
        todo.push(g);
      }
    }
    return shown;
  }

  /**
   * The paper that pulling this face would lift, or null if there is none to peel
   * away from anything. A whole flap if one is free, and otherwise as much as shows:
   * anything that can be seen can be taken hold of.
   */
  flapToLift(face: number, under = false): Set<number> | null {
    const { book, lifted } = this;
    if (this.holds.has(face)) return null;
    const stacked = (paper: ReadonlySet<number>) => [...paper].some((f) => book.depth(f) > 1);
    const flap = this.loose(this.flapOf(face, under), face);
    if (flap.size < book.faces.length && !this.heldDown(flap, under) && ![...flap].some((f) => lifted.has(f)) && stacked(flap)) return flap;
    const shown = this.showing(face, under);
    return shown.size > 0 && shown.size < book.faces.length && stacked(shown) ? shown : null;
  }

  /** The unlocked part of some paper that a face can reach without crossing locked paper. */
  private loose(paper: ReadonlySet<number>, face: number): Set<number> {
    const { book, holds } = this;
    if (![...paper].some((f) => holds.has(f))) return new Set(paper);
    const part = new Set([face]);
    const todo = [face];
    while (todo.length) {
      const f = todo.pop() as number;
      for (let k = 0; k < 3; k++) {
        const g = book.neighbour[f * 3 + k] as number;
        if (g < 0 || part.has(g) || !paper.has(g) || holds.has(g) || book.edgeBlocked(f, k)) continue;
        part.add(g);
        todo.push(g);
      }
    }
    return part;
  }

  /** Where a flat point of a face sat on the sheet before any folding, in metres. */
  restPoint(face: number, x: number, z: number): { x: number; z: number } {
    const { at, rest, span } = this.book;
    const px = this.toUnits(x), pz = this.toUnits(z);
    const ax = at[face * 6] as number, az = at[face * 6 + 1] as number;
    const ux = (at[face * 6 + 2] as number) - ax, uz = (at[face * 6 + 3] as number) - az;
    const vx = (at[face * 6 + 4] as number) - ax, vz = (at[face * 6 + 5] as number) - az;
    const det = ux * vz - vx * uz || 1;
    const s = ((px - ax) * vz - vx * (pz - az)) / det, t = (ux * (pz - az) - (px - ax) * uz) / det;
    const r = (k: number, axis: number) => rest[face * 6 + k * 2 + axis] as number;
    const unit = this.unit;
    return {
      x: (r(0, 0) + s * (r(1, 0) - r(0, 0)) + t * (r(2, 0) - r(0, 0)) - span / 2) * unit,
      z: (r(0, 1) + s * (r(1, 1) - r(0, 1)) + t * (r(2, 1) - r(0, 1)) - span / 2) * unit,
    };
  }

  /** The way the paper's top faces in the world, read from the paper that is not lifted. */
  private surfaceUp(): [number, number, number] {
    const frame = this.frameOf(this.lifted);
    const origin = new Float64Array(3), ax = new Float64Array(3), az = new Float64Array(3);
    frame(0, 0, origin);
    frame(1, 0, ax);
    frame(0, 1, az);
    const ux = (ax[0] as number) - (origin[0] as number), uy = (ax[1] as number) - (origin[1] as number), uz = (ax[2] as number) - (origin[2] as number);
    const vx = (az[0] as number) - (origin[0] as number), vy = (az[1] as number) - (origin[1] as number), vz = (az[2] as number) - (origin[2] as number);
    return [vy * uz - vz * uy, vz * ux - vx * uz, vx * uy - vy * ux];
  }

  /** Lifts a flap off the stack so it can be folded alone. */
  peel(face: number, under = false): boolean {
    const flap = this.flapToLift(face, under);
    if (!flap) return false;

    const before = this.corners();
    const [nx, ny, nz] = this.surfaceUp();
    this.flaps = [...this.flaps, flap];
    this.bends = [...this.bends, null];
    const lift = CONTACT_GAP * 1.5 * (under ? -1 : 1);
    this.rebuild((mesh) => {
      const out = new Float64Array(mesh.vertexCount * 3);
      for (const f of this.book.faces) {
        const k0 = flap.has(f) ? lift : 0;
        for (let k = 0; k < 3; k++) {
          const v = mesh.cornerVertex[f * 3 + k] as number;
          // A crease on locked paper stays down: only the flap's free points lift.
          if (mesh.inverseMass[v] === 0 && k0 !== 0) continue;
          out[v * 3] = (before[f * 9 + k * 3] as number) + nx * k0;
          out[v * 3 + 1] = (before[f * 9 + k * 3 + 1] as number) + ny * k0;
          out[v * 3 + 2] = (before[f * 9 + k * 3 + 2] as number) + nz * k0;
        }
      }
      return out;
    });
    return true;
  }

  /**
   * Lifts exactly what a fold would move, bending freely along its line, so a hand
   * sees the fold it is lining up. With no line, it lifts paper as an ordinary flap. Without this, paper held down elsewhere, as under a
   * Nakamura lock, could only lift as a patch, and pulling it dragged the whole craft.
   */
  liftFor(moved: ReadonlySet<number>, line: MirrorLine | null, under: boolean): void {
    const before = this.corners();
    const was = this.lifted;
    const [nx, ny, nz] = this.surfaceUp();
    const lift = CONTACT_GAP * 1.5 * (under ? -1 : 1);
    this.flaps = [moved];
    this.bends = [line];
    this.rebuild((mesh) => {
      const out = new Float64Array(mesh.vertexCount * 3);
      const placed = new Uint8Array(mesh.vertexCount);
      const place = (f: number, rise: number) => {
        for (let k = 0; k < 3; k++) {
          const v = mesh.cornerVertex[f * 3 + k] as number;
          if (placed[v]) continue;
          placed[v] = 1;
          out[v * 3] = (before[f * 9 + k * 3] as number) + nx * rise;
          out[v * 3 + 1] = (before[f * 9 + k * 3 + 1] as number) + ny * rise;
          out[v * 3 + 2] = (before[f * 9 + k * 3 + 2] as number) + nz * rise;
        }
      };
      // Paper on the stack keeps its place first: a strip dropping back lands on it.
      for (const f of this.book.faces) if (!moved.has(f) && !was.has(f)) place(f, 0);
      for (const f of this.book.faces) if (moved.has(f)) place(f, was.has(f) ? 0 : lift);
      for (const f of this.book.faces) place(f, 0);
      return out;
    });
  }

  /** True while paper is lifted: someone has it in hand. */
  get pulling(): boolean {
    return this.flaps.length > 0;
  }

  /**
   * The outermost paper that can turn with this face: the smallest free flap, on a
   * crease that parts it from the rest. A wing has lock creases too, but turning on
   * those would carry the whole body with it.
   */
  private jointAt(face: number, under: boolean): { faces: Set<number>; hinge: string } | null {
    const { book } = this;
    const flat = this.flatRegion(face);
    const lines = new Set<string>();
    for (const f of flat) {
      for (let k = 0; k < 3; k++) {
        const g = book.neighbour[f * 3 + k] as number;
        if (g >= 0 && !flat.has(g) && !book.edgeBlocked(f, k)) lines.add(this.edgeLine(f, k));
      }
    }
    let best: { faces: Set<number>; hinge: string } | null = null;
    for (const hinge of lines) {
      const faces = this.turningOn(face, hinge, under);
      if (faces.size === book.faces.length || this.heldDown(faces, under)) continue;
      if (!best || faces.size < best.faces.size) best = { faces, hinge };
    }
    return best;
  }

  /** The outermost flap at a face that is free to open out, and the crease it turns on, or null. */
  openingAt(face: number, under = false): { faces: ReadonlySet<number>; line: MirrorLine } | null {
    const opening = this.jointAt(face, under);
    return opening ? { faces: opening.faces, line: lineOfKey(opening.hinge) } : null;
  }

  /** Works a crease's line key out into a joint, shut. */
  private makeJoint(faces: ReadonlySet<number>, hinge: string, under: boolean): Joint {
    const { book } = this;
    const c = Number(hinge.slice(1));
    const root = Math.SQRT1_2;
    const line = {
      x: { point: [c, 0], along: [0, 1] },
      z: { point: [0, c], along: [1, 0] },
      d: { point: [c, 0], along: [root, root] },
      s: { point: [c, 0], along: [root, -root] },
    }[hinge[0] as 'x' | 'z' | 'd' | 's'];
    const [ax, az] = line.along as [number, number];
    const point: [number, number] = [this.toMetres(line.point[0] as number), this.toMetres(line.point[1] as number)];

    // Across points to the side the paper lies on when shut.
    let lean = 0;
    for (const f of faces) {
      for (let k = 0; k < 3; k++) {
        lean += (this.toMetres(book.at[f * 6 + k * 2] as number) - point[0]) * az - (this.toMetres(book.at[f * 6 + k * 2 + 1] as number) - point[1]) * ax;
      }
    }
    const sign = lean < 0 ? -1 : 1;
    return { faces, hinge, point, along: [ax, az], across: [az * sign, -ax * sign], side: under ? -1 : 1, angle: 0, partner: -1, mirrored: true };
  }

  /** Every outermost flap there is, once each. */
  private findJoints(): Joint[] {
    const { book } = this;
    const taken = new Set<number>();
    const tried = new Set<number>();
    const joints: Joint[] = [];
    for (const under of [false, true]) {
      tried.clear();
      for (const stack of book.stacks.values()) {
        const face = (under ? stack[0] : stack[stack.length - 1]) as number;
        if (taken.has(face) || tried.has(face)) continue;
        for (const f of this.flatRegion(face)) tried.add(f);
        const found = this.jointAt(face, under);
        if (!found || [...found.faces].some((f) => taken.has(f))) continue;
        for (const f of found.faces) taken.add(f);
        joints.push(this.makeJoint(found.faces, found.hinge, under));
      }
    }
    joints.forEach((joint, i) => {
      joint.partner = joints.findIndex((other, j) => j !== i && other.hinge === joint.hinge && other.side !== joint.side);
    });
    return joints;
  }

  /** The way the paper lies right now, flattened onto the table. */
  private lyingStance(): Stance {
    const frame = this.frameOf(this.lifted);
    const origin = new Float64Array(3), ax = new Float64Array(3), az = new Float64Array(3);
    frame(0, 0, origin);
    frame(1, 0, ax);
    frame(0, 1, az);
    const flat = (to: Float64Array): [number, number, number] => {
      const dx = (to[0] as number) - (origin[0] as number), dz = (to[2] as number) - (origin[2] as number);
      const length = Math.hypot(dx, dz) || 1;
      return [dx / length, 0, dz / length];
    };
    return { origin: [origin[0] as number, 0, origin[2] as number], x: flat(ax), up: [0, 1, 0], z: flat(az), upright: false };
  }

  /**
   * Marks the paper complete. It becomes stiff plates turning on its outermost
   * creases, and stands on its keel if any can turn. The Book does not change.
   */
  complete(): readonly Joint[] {
    const lying = this.lyingStance();
    this.flaps = [];
    this.bends = [];
    const joints = this.findJoints();
    // Pairs go first: a plane's wings are what say which way up it stands.
    const lead = joints.find((joint) => joint.partner >= 0) ?? joints[0];
    this.finished = { joints, lying, stance: lead ? standOn(lying, lead) : lying };
    this.flaps = joints.map((joint) => joint.faces);
    this.bends = joints.map(() => null);
    this.rebuild((mesh) => {
      const out = new Float64Array(mesh.vertexCount * 3);
      poseCraft(mesh, joints, joints.map(() => 0), (this.finished as { stance: Stance }).stance, this.definition.thickness, out);
      return out;
    });
    this.soft.harden(true);
    return joints;
  }

  /** Takes a craft back to loose paper, to fold further. Its joints are dropped. */
  reopen(): void {
    if (!this.finished) return;
    const { lying } = this.finished;
    this.finished = null;
    this.flaps = [];
    this.bends = [];
    this.rebuild((mesh) => {
      const out = new Float64Array(mesh.vertexCount * 3);
      poseCraft(mesh, [], [], lying, this.definition.thickness, out);
      return out;
    });
  }

  get completed(): boolean {
    return this.finished !== null;
  }

  /** The joints of a finished craft, in the order its flaps are numbered. */
  get joints(): readonly Joint[] {
    return this.finished?.joints ?? [];
  }

  /** Sets how far a joint is open, and its partner too while they are mirrored. */
  setAngle(joint: number, degrees: number): void {
    const { joints } = this;
    const target = joints[joint];
    if (!target) return;
    target.angle = Math.max(0, Math.min(180, degrees));
    const partner = joints[target.partner];
    if (partner && target.mirrored) partner.angle = target.angle;
  }

  /** Lets a pair move apart or together. Mirroring again brings the partner to this angle. */
  setMirrored(joint: number, mirrored: boolean): void {
    const { joints } = this;
    const target = joints[joint];
    if (!target) return;
    target.mirrored = mirrored;
    const partner = joints[target.partner];
    if (partner) partner.mirrored = mirrored;
    this.setAngle(joint, target.angle);
  }

  /** Lays the paper out at a set of angles, which may be mid-way to the joints' own. */
  pose(angles: readonly number[] = this.joints.map((joint) => joint.angle)): void {
    if (!this.finished) return;
    poseCraft(this.soft.mesh, this.finished.joints, angles, this.finished.stance, this.definition.thickness, this.soft.x);
  }

  /** Where a flat point of a joint would be in the world at an angle, for aiming a drag. */
  jointWorld(joint: number, fx: number, fz: number, degrees: number, out: Float64Array): void {
    if (!this.finished) return;
    const local = new Float64Array(3);
    jointPoint(this.finished.joints[joint] as Joint, fx, fz, degrees, local);
    toWorld(this.finished.stance, local, out);
  }

  /** The joint outermost over a point of the paper, in metres from its first corner. */
  jointNear(x: number, z: number, under = false): number {
    const scale = (this.book.cells * UNITS_PER_CELL) / this.definition.size;
    const face = this.outerFaceAt(x * scale, z * scale, under);
    return this.joints.findIndex((joint) => joint.faces.has(face));
  }

  /** The outermost face over a lattice point, on the top of the stack or the underside. */
  private outerFaceAt(x: number, z: number, under: boolean): number {
    const { book } = this;
    let best = -1, bestDistance = Infinity;
    for (const stack of book.stacks.values()) {
      const f = (under ? stack[0] : stack[stack.length - 1]) as number;
      const i = f * 6;
      const cx = ((book.at[i] as number) + (book.at[i + 2] as number) + (book.at[i + 4] as number)) / 3;
      const cz = ((book.at[i + 1] as number) + (book.at[i + 3] as number) + (book.at[i + 5] as number)) / 3;
      const distance = Math.hypot(cx - x, cz - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = f;
      }
    }
    return best;
  }

  /** Faces currently lifted off their stack. */
  get lifted(): ReadonlySet<number> {
    const all = new Set<number>();
    for (const flap of this.flaps) for (const f of flap) all.add(f);
    return all;
  }

  /** Lets lifted paper fall back into the stack. */
  settle(): void {
    const flap = this.lifted;
    if (flap.size === 0) return;
    const before = this.corners();
    this.flaps = [];
    this.bends = [];
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
    this.flaps = [];
    this.bends = [];
    const books = this.book.cutAlong(line, from, to);
    const heldIn = (book: FoldBook) => book.faces.filter((f) => this.holds.has(f));
    const pieces = books.map((book) => {
      if (book === this.book) return this;
      const held = heldIn(book);
      const mesh = buildSoftMesh(book, this.definition.size, [], [], new Set(held));
      const initial = new Float64Array(mesh.vertexCount * 3);
      for (const f of book.faces) {
        for (let k = 0; k < 3; k++) {
          const v = mesh.cornerVertex[f * 3 + k] as number;
          initial[v * 3] = before[f * 9 + k * 3] as number;
          initial[v * 3 + 1] = before[f * 9 + k * 3 + 1] as number;
          initial[v * 3 + 2] = before[f * 9 + k * 3 + 2] as number;
        }
      }
      return new SheetPiece(this.definition, book, this.settings, initial, held, this.bodies);
    });
    this.holds = new Set(heldIn(this.book));
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

/** A crease's line from its key: x, z, d (x - z) or s (x + z), then the constant. */
function lineOfKey(key: string): MirrorLine {
  const c = Number(key.slice(1));
  const kind = ({ x: 'x', z: 'z', d: 'diff', s: 'sum' } as const)[key[0] as 'x' | 'z' | 'd' | 's'];
  return { kind, c };
}

/** The flat position, in metres, that a world point sits over, against a frame. */
export function readFlat(frame: (x: number, z: number, out: Float64Array) => void, point: { x: number; y: number; z: number }): { x: number; z: number; height: number } {
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

/** Where a point lands if folded across a line, in metres on the flat sheet. */
export function mirroredPoint(piece: SheetPiece, line: MirrorLine, x: number, z: number): { x: number; z: number } {
  const ux = piece.toUnits(x), uz = piece.toUnits(z);
  return { x: piece.toMetres(reflectX(line, ux, uz)), z: piece.toMetres(reflectZ(line, ux, uz)) };
}

/** Which side of a line a flat point falls on. */
export const flatSide = (piece: SheetPiece, line: MirrorLine, x: number, z: number): number =>
  sideOf(line, piece.toUnits(x), piece.toUnits(z));
