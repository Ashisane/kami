import type { SheetDefinition } from '../asset/sheetTypes';
import { FoldBook } from './FoldBook';
import type { FoldPlan, FoldRequest } from './FoldBook';
import { applyOpen } from './recipes';
import type { OpenStep, SpreadStep } from './recipes';
import type { ReshapeFailure } from './reshape';
import { reflectX, reflectZ, sideOf, UNITS_PER_CELL } from './lattice';
import type { MirrorLine } from './lattice';
import { extractRotation, rotateInto } from './soft/rotation';
import type { Quat } from './soft/rotation';
import { buildSoftMesh, metresPerUnit } from './soft/softMesh';
import { CONTACT_GAP, SoftSheet } from './soft/SoftSheet';
import type { SoftSettings } from './soft/SoftSheet';

/** Paper lifted off its stack, turning on one crease. */
interface Flap {
  faces: ReadonlySet<number>;
  /** True once its crease is bent for good, so it stays where it was left. */
  fixed: boolean;
}

/**
 * One connected piece of paper: the exact Book plus the floppy cloth built from
 * it, kept in step. Everything that changes the paper goes through here. No
 * three.js, so tests and a future server can run it directly.
 */
export class SheetPiece {
  soft: SoftSheet;
  /** Flaps lifted off their stacks right now. */
  private flaps: Flap[] = [];

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
    const mesh = buildSoftMesh(this.book, this.definition.size, this.flaps.map((flap) => flap.faces));
    this.soft = new SoftSheet(mesh, this.solverSettings(), positions(mesh));
    this.flaps.forEach((flap, i) => {
      if (flap.fixed) this.soft.fixFlap(i);
    });
    this.revision++;
  }

  /** Commits a fold. Refused folds change nothing and report why. */
  fold(request: FoldRequest, swing = false): FoldPlan {
    const plan = this.book.plan(request);
    if (plan.failure) return plan;
    const before = this.corners();
    const frame = this.frameOf(plan.moved);

    this.book.fold(request);
    this.flaps = [];
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

  /** Opens a pocket and flattens it a new way. The whole piece moves, so all of it lands afresh. */
  open(step: OpenStep): ReshapeFailure | null {
    const frame = this.frameOf(new Set());
    const failure = applyOpen(this.book, this.definition.size, step);
    if (failure) return failure;
    this.flaps = [];
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
        if (!stack.some((f) => staying.has(part[f] as number))) continue;
        // In from the outside, up to the first layer that stays.
        for (let i = 0; i < stack.length; i++) {
          const f = stack[under ? i : stack.length - 1 - i] as number;
          if (lifted.has(f)) continue;
          const p = part[f] as number;
          if (staying.has(p)) break;
          if (!swinging.has(p)) {
            swinging.add(p);
            grew = true;
          }
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
    const { book, lifted } = this;
    const outermost = (f: number) => {
      const stack = book.stackOf(f);
      const at = stack.indexOf(f);
      return !(under ? stack.slice(0, at) : stack.slice(at + 1)).some((g) => !lifted.has(g));
    };
    const shown = new Set<number>();
    if (lifted.has(face) || !outermost(face)) return shown;
    const flat = this.flatRegion(face);
    shown.add(face);
    const todo = [face];
    while (todo.length) {
      const f = todo.pop() as number;
      for (let k = 0; k < 3; k++) {
        const g = book.neighbour[f * 3 + k] as number;
        if (g < 0 || shown.has(g) || !flat.has(g) || book.edgeBlocked(f, k) || lifted.has(g) || !outermost(g)) continue;
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
    const stacked = (paper: ReadonlySet<number>) => [...paper].some((f) => book.depth(f) > 1);
    const flap = this.flapOf(face, under);
    if (flap.size < book.faces.length && !this.heldDown(flap, under) && ![...flap].some((f) => lifted.has(f)) && stacked(flap)) return flap;
    const shown = this.showing(face, under);
    return shown.size > 0 && shown.size < book.faces.length && stacked(shown) ? shown : null;
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
    this.flaps = [...this.flaps, { faces: flap, fixed: false }];
    const lift = CONTACT_GAP * 1.5 * (under ? -1 : 1);
    this.rebuild((mesh) => {
      const out = new Float64Array(mesh.vertexCount * 3);
      for (const f of this.book.faces) {
        const k0 = flap.has(f) ? lift : 0;
        for (let k = 0; k < 3; k++) {
          const v = mesh.cornerVertex[f * 3 + k] as number;
          out[v * 3] = (before[f * 9 + k * 3] as number) + nx * k0;
          out[v * 3 + 1] = (before[f * 9 + k * 3 + 1] as number) + ny * k0;
          out[v * 3 + 2] = (before[f * 9 + k * 3 + 2] as number) + nz * k0;
        }
      }
      return out;
    });
    return true;
  }

  /** Bends every flap still being pulled for good, at the angle it is held. Returns how many. */
  fixFlaps(): number {
    let count = 0;
    this.flaps.forEach((flap, i) => {
      if (flap.fixed) return;
      flap.fixed = true;
      this.soft.fixFlap(i);
      count++;
    });
    return count;
  }

  /** Takes a fixed flap back in hand, so it can be moved. Returns false if this face is on none. */
  unfix(face: number): boolean {
    const i = this.flaps.findIndex((flap) => flap.fixed && flap.faces.has(face));
    if (i < 0) return false;
    (this.flaps[i] as Flap).fixed = false;
    this.soft.unfixFlap(i);
    return true;
  }

  /** True while a flap is lifted but not fixed: someone has it in hand. */
  get pulling(): boolean {
    return this.flaps.some((flap) => !flap.fixed);
  }

  get fixedFlaps(): number {
    return this.flaps.filter((flap) => flap.fixed).length;
  }

  /**
   * Stands the paper up on its keel with its wings opened out, as hands would hold
   * a plane. The Book does not change: this is shape, which only the cloth owns.
   */
  spread(step: SpreadStep): boolean {
    const { book, definition } = this;
    const scale = (book.cells * UNITS_PER_CELL) / definition.size;
    const axis = { across: step.hinge.kind, c: step.hinge.at * scale };
    const hinge = `${axis.across}${axis.c}`;
    const chosen = step.wings.map(({ at, under }) => {
      const faces = this.turningOn(this.outerFaceAt(at[0] * scale, at[1] * scale, under), hinge, under);
      return { faces, under };
    });
    if (chosen.some(({ faces, under }) => faces.size === book.faces.length || this.heldDown(faces, under))) return false;

    // Which way the keel lies from the hinge: towards the paper that stays.
    const hingeAt = this.toMetres(axis.c);
    const stays = book.faces.filter((f) => !chosen.some((wing) => wing.faces.has(f)));
    const across = stays.reduce((sum, f) => sum + (axis.across === 'x' ? (book.at[f * 6] as number) : (book.at[f * 6 + 1] as number)), 0) / stays.length;
    const toKeel = this.toMetres(across) > hingeAt ? 1 : -1;

    this.flaps = chosen.map((wing) => ({ faces: wing.faces, fixed: true }));
    const flapOfVertex = (mesh: ReturnType<typeof buildSoftMesh>) => {
      const owner = new Int32Array(mesh.vertexCount).fill(-1);
      chosen.forEach((wing, i) => {
        for (const f of wing.faces) for (let k = 0; k < 3; k++) owner[mesh.cornerVertex[f * 3 + k] as number] = i;
      });
      return owner;
    };
    const open = (step.angle * Math.PI) / 180;
    this.rebuild((mesh) => {
      const owner = flapOfVertex(mesh);
      const out = new Float64Array(mesh.vertexCount * 3);
      let middle = 0;
      for (let v = 0; v < mesh.vertexCount; v++) middle += mesh.flat[v * 2 + (axis.across === 'x' ? 1 : 0)] as number;
      middle /= mesh.vertexCount;
      for (let v = 0; v < mesh.vertexCount; v++) {
        const fx = mesh.flat[v * 2] as number, fz = mesh.flat[v * 2 + 1] as number;
        const along = (axis.across === 'x' ? fz : fx) - middle;
        const drop = ((axis.across === 'x' ? fx : fz) - hingeAt) * toKeel;
        const wing = owner[v] as number;
        const side = wing < 0 ? 0 : (chosen[wing] as { under: boolean }).under ? -1 : 1;
        const down = wing < 0 ? drop : drop * Math.cos(open);
        const out1 = wing < 0 ? 0 : drop * Math.sin(open) * side;
        const i = v * 3;
        if (axis.across === 'x') {
          out[i] = out1 * toKeel;
          out[i + 2] = along + middle;
        } else {
          out[i] = along + middle;
          out[i + 2] = -out1 * toKeel;
        }
        out[i + 1] = step.height - down;
      }
      return out;
    });
    return true;
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
    for (const flap of this.flaps) for (const f of flap.faces) all.add(f);
    return all;
  }

  /** Lets any flap not fixed fall back into the stack. */
  settle(): void {
    const falling = new Set<number>();
    for (const flap of this.flaps) if (!flap.fixed) for (const f of flap.faces) falling.add(f);
    if (falling.size === 0) return;
    const before = this.corners();
    const flap = falling;
    this.flaps = this.flaps.filter((f) => f.fixed);
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
