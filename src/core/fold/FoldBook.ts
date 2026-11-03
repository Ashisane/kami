import { buildTiling, isMirror, reflectX, reflectZ, sideOf, siteKey, UNITS_PER_CELL } from './lattice';
import type { MirrorLine } from './lattice';

/**
 * The exact truth of a piece of paper: every face, where it landed, and the
 * ordered stack of faces on each lattice site. No physics and no floats, so the
 * same folds always give the same paper, on every machine.
 *
 * Folds are one-way. There is no unfold; the lab's step-back restores a snapshot.
 */

/** How moved faces arrive at their landing sites. */
export type Landing =
  /** Rotates over the top of the stack. */
  | { kind: 'over' }
  /** Rotates underneath the stack. */
  | { kind: 'under' }
  /** Slides between layers, keeping its order. `layer` faces stay below it. */
  | { kind: 'tuck'; layer: number };

export interface FoldRequest {
  line: MirrorLine;
  /** Which side of the line moves: +1 or -1. */
  side: number;
  /** Faces the player is holding. Everything connected to them on that side moves too. */
  seeds: readonly number[];
  landing?: Landing;
}

export type FoldFailure = 'not-a-grid-line' | 'nothing-moves' | 'nothing-stays' | 'layers-cross';

export interface FoldPlan {
  request: FoldRequest;
  moved: ReadonlySet<number>;
  failure: FoldFailure | null;
}

/** Why a flap cannot be opened: other paper lies on it, or it would pass through paper. */
export type UnfoldFailure = 'not-a-grid-line' | 'covered' | 'layers-cross';

export interface UnfoldPlan {
  line: MirrorLine;
  flap: ReadonlySet<number>;
  /** Which way it opens: out on top of whatever it lands on, or underneath. */
  landing: Landing;
  failure: UnfoldFailure | null;
}

/** Number of corners and of edges per face. */
const CORNERS = 3;

export class FoldBook {
  readonly faceCount: number;
  /** Faces belonging to this piece. Cutting shrinks this. */
  faces: number[];
  /** Where each face started: x0 z0 x1 z1 x2 z2. Never changes. */
  readonly rest: Int32Array;
  /** Where each face is now, in the same layout. */
  at: Int32Array;
  /** 1 when a face has been turned over. */
  flipped: Uint8Array;
  /** The face across each edge, or -1. Edge k runs from corner k to corner k + 1. */
  readonly neighbour: Int32Array;
  cut: Uint8Array;
  /**
   * 1 on every edge a fold has ever creased, per face edge. Paper remembers a crease
   * after it is opened out again, so it shows, and bends there more easily.
   */
  creased: Uint8Array;
  /** Site id to face ids, bottom to top. */
  stacks = new Map<number, number[]>();
  /** Each face's height within its stack. */
  layer: Int32Array;

  constructor(
    readonly cells: number,
    rest: Int32Array,
    neighbour: Int32Array,
  ) {
    this.rest = rest;
    this.neighbour = neighbour;
    this.faceCount = rest.length / 6;
    this.at = rest.slice();
    this.flipped = new Uint8Array(this.faceCount);
    this.cut = new Uint8Array(this.faceCount * CORNERS);
    this.creased = new Uint8Array(this.faceCount * CORNERS);
    this.layer = new Int32Array(this.faceCount);
    this.faces = Array.from({ length: this.faceCount }, (_, i) => i);
    for (const f of this.faces) this.stacks.set(this.site(f), [f]);
  }

  static sheet(cells: number): FoldBook {
    const { corners, count } = buildTiling(cells);
    const neighbour = new Int32Array(count * CORNERS).fill(-1);
    const point = (f: number, k: number) => `${corners[f * 6 + k * 2]},${corners[f * 6 + k * 2 + 1]}`;
    const open = new Map<string, [number, number]>();
    for (let f = 0; f < count; f++) {
      for (let k = 0; k < CORNERS; k++) {
        const a = point(f, k);
        const b = point(f, (k + 1) % CORNERS);
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const other = open.get(key);
        if (!other) {
          open.set(key, [f, k]);
          continue;
        }
        const [g, j] = other;
        neighbour[f * CORNERS + k] = g;
        neighbour[g * CORNERS + j] = f;
      }
    }
    return new FoldBook(cells, corners, neighbour);
  }

  /** Metres per half-cell is decided by the caller; this is the sheet's side in lattice units. */
  get span(): number {
    return this.cells * UNITS_PER_CELL;
  }

  site(f: number): number {
    const a = this.at;
    const i = f * 6;
    return siteKey((a[i] as number) + (a[i + 2] as number) + (a[i + 4] as number), (a[i + 1] as number) + (a[i + 3] as number) + (a[i + 5] as number));
  }

  stackOf(f: number): readonly number[] {
    return this.stacks.get(this.site(f)) ?? [];
  }

  /** How many layers are lying on the same site as this face. */
  depth(f: number): number {
    return this.stackOf(f).length;
  }

  get tallest(): number {
    let tallest = 0;
    for (const stack of this.stacks.values()) tallest = Math.max(tallest, stack.length);
    return tallest;
  }

  edgeBlocked(f: number, k: number): boolean {
    return this.cut[f * CORNERS + k] === 1;
  }

  /** True if a fold has ever creased this edge of a face. */
  edgeCreased(f: number, k: number): boolean {
    return this.creased[f * CORNERS + k] === 1;
  }

  private onSide(line: MirrorLine, side: number, f: number): boolean {
    const a = this.at;
    const i = f * 6;
    let strictly = false;
    for (let k = 0; k < CORNERS; k++) {
      const s = sideOf(line, a[i + k * 2] as number, a[i + k * 2 + 1] as number) * side;
      if (s < 0) return false;
      if (s > 0) strictly = true;
    }
    return strictly;
  }

  /** Everything connected to the seeds without crossing the line. */
  private gather(line: MirrorLine, side: number, seeds: readonly number[]): Set<number> {
    const moved = new Set<number>();
    const todo: number[] = [];
    for (const seed of seeds) {
      if (this.onSide(line, side, seed) && !moved.has(seed)) {
        moved.add(seed);
        todo.push(seed);
      }
    }
    while (todo.length) {
      const f = todo.pop() as number;
      for (let k = 0; k < CORNERS; k++) {
        const g = this.neighbour[f * CORNERS + k] as number;
        if (g < 0 || this.edgeBlocked(f, k) || moved.has(g) || !this.onSide(line, side, g)) continue;
        moved.add(g);
        todo.push(g);
      }
    }
    return moved;
  }

  /** Works out what a fold would do, without doing it. */
  plan(request: FoldRequest): FoldPlan {
    const moved = this.gather(request.line, request.side, request.seeds);
    const fail = (failure: FoldFailure): FoldPlan => ({ request, moved, failure });
    if (!isMirror(request.line)) return fail('not-a-grid-line');
    if (moved.size === 0) return fail('nothing-moves');

    const landing = request.landing ?? { kind: 'over' };
    if (landing.kind !== 'tuck') {
      // Paper lying on what moves goes over with it, as it would under a hand: a layer
      // cannot turn out from under another. It shares the site, so it is on the moving
      // side too. Paper that truly cannot follow is refused below, as layers crossing.
      for (let grew = true; grew; ) {
        grew = false;
        for (const f of [...moved]) {
          const stack = this.stackOf(f);
          const h = stack.indexOf(f);
          for (const g of landing.kind === 'over' ? stack.slice(h + 1) : stack.slice(0, h)) {
            if (moved.has(g)) continue;
            for (const carried of this.gather(request.line, request.side, [g])) moved.add(carried);
            grew = true;
          }
        }
      }
    }
    if (moved.size === this.faces.length) return fail('nothing-stays');

    const trial = this.clone();
    trial.apply(request.line, moved, landing);
    return trial.violations() > 0 ? fail('layers-cross') : { request, moved, failure: null };
  }

  /**
   * Works out how a flap would open back out across the crease it turns on. The
   * flap must be outermost on one side, with nothing lying on it. It lands on top
   * of whatever is there, or underneath if only that is possible.
   */
  planUnfold(flap: ReadonlySet<number>, line: MirrorLine): UnfoldPlan {
    const fail = (failure: UnfoldFailure): UnfoldPlan => ({ line, flap, landing: { kind: 'over' }, failure });
    if (!isMirror(line)) return fail('not-a-grid-line');
    const outermost = (top: boolean) =>
      [...flap].every((f) => {
        const stack = this.stackOf(f);
        const h = stack.indexOf(f);
        return (top ? stack.slice(h + 1) : stack.slice(0, h)).every((g) => flap.has(g));
      });
    if (!outermost(true) && !outermost(false)) return fail('covered');
    for (const landing of [{ kind: 'over' }, { kind: 'under' }] as const) {
      const trial = this.clone();
      trial.apply(line, flap, landing);
      if (trial.violations() === 0) return { line, flap, landing, failure: null };
    }
    return fail('layers-cross');
  }

  /** Opens a flap back out, if it can be. Returns the plan, so a caller can see why not. */
  unfold(flap: ReadonlySet<number>, line: MirrorLine): UnfoldPlan {
    const plan = this.planUnfold(flap, line);
    if (!plan.failure) this.apply(line, flap, plan.landing);
    return plan;
  }

  /** Performs a legal fold. Returns the plan, so a caller can see why one was refused. */
  fold(request: FoldRequest): FoldPlan {
    const plan = this.plan(request);
    if (!plan.failure) this.apply(request.line, plan.moved, request.landing ?? { kind: 'over' });
    return plan;
  }

  private apply(line: MirrorLine, moved: ReadonlySet<number>, landing: Landing): void {
    // Where moved paper meets paper that stays, on the line, it creases.
    for (const f of moved) {
      for (let k = 0; k < CORNERS; k++) {
        const g = this.neighbour[f * CORNERS + k] as number;
        if (g < 0 || moved.has(g) || !this.edgeOn(line, f, k)) continue;
        this.creased[f * CORNERS + k] = 1;
        for (let j = 0; j < CORNERS; j++) if (this.neighbour[g * CORNERS + j] === f) this.creased[g * CORNERS + j] = 1;
      }
    }
    // Lift the moved run out of each stack, keeping bottom-to-top order.
    const lifted = new Map<number, number[]>();
    for (const f of moved) {
      const key = this.site(f);
      if (lifted.has(key)) continue;
      const stack = this.stacks.get(key) as number[];
      lifted.set(key, stack.filter((g) => moved.has(g)));
      const remaining = stack.filter((g) => !moved.has(g));
      if (remaining.length) this.stacks.set(key, remaining);
      else this.stacks.delete(key);
    }

    for (const f of moved) {
      const i = f * 6;
      for (let k = 0; k < CORNERS; k++) {
        const x = this.at[i + k * 2] as number;
        const z = this.at[i + k * 2 + 1] as number;
        this.at[i + k * 2] = reflectX(line, x, z);
        this.at[i + k * 2 + 1] = reflectZ(line, x, z);
      }
      this.flipped[f] = 1 - (this.flipped[f] as number);
    }

    // Reflection maps sites one to one, so each lifted run lands on exactly one site.
    for (const run of lifted.values()) {
      const key = this.site(run[0] as number);
      const stack = this.stacks.get(key) ?? [];
      if (landing.kind === 'over') stack.push(...[...run].reverse());
      else if (landing.kind === 'under') stack.unshift(...[...run].reverse());
      else stack.splice(Math.min(landing.layer, stack.length), 0, ...run);
      this.stacks.set(key, stack);
    }
    this.reindex();
  }

  /** True if a face's edge lies along a line. */
  private edgeOn(line: MirrorLine, f: number, k: number): boolean {
    const i = f * 6, n = (k + 1) % CORNERS;
    return sideOf(line, this.at[i + k * 2] as number, this.at[i + k * 2 + 1] as number) === 0 && sideOf(line, this.at[i + n * 2] as number, this.at[i + n * 2 + 1] as number) === 0;
  }

  private reindex(): void {
    for (const stack of this.stacks.values()) stack.forEach((f, h) => (this.layer[f] = h));
  }

  /**
   * Counts ways the current stacks could not exist in real paper. Three rules,
   * all checked per folded edge: two creases may nest but not interleave, a flat
   * sheet may not pass through a crease, and two flat sheets crossing the same
   * line keep their order on both sides of it.
   */
  violations(): number {
    this.reindex();
    interface Crease { site: number; low: number; high: number }
    interface Flat { a: number; b: number; la: number; lb: number }
    const creases = new Map<string, Crease[]>();
    const flats = new Map<string, Flat[]>();

    for (const f of this.faces) {
      for (let k = 0; k < CORNERS; k++) {
        const g = this.neighbour[f * CORNERS + k] as number;
        if (g < f || this.edgeBlocked(f, k)) continue;
        // A layer of -1 means not placed yet, while a reshape searches for an order.
        if ((this.layer[f] as number) < 0 || (this.layer[g] as number) < 0) continue;
        const i = f * 6;
        const n = (k + 1) % CORNERS;
        const p = `${this.at[i + k * 2]},${this.at[i + k * 2 + 1]}`;
        const q = `${this.at[i + n * 2]},${this.at[i + n * 2 + 1]}`;
        const edge = p < q ? `${p}|${q}` : `${q}|${p}`;
        const siteF = this.site(f);
        const siteG = this.site(g);
        if (siteF === siteG) {
          const low = Math.min(this.layer[f] as number, this.layer[g] as number);
          const high = Math.max(this.layer[f] as number, this.layer[g] as number);
          const list = creases.get(edge) ?? [];
          list.push({ site: siteF, low, high });
          creases.set(edge, list);
        } else {
          const swap = siteF > siteG;
          const list = flats.get(edge) ?? [];
          list.push({
            a: swap ? siteG : siteF,
            b: swap ? siteF : siteG,
            la: (swap ? this.layer[g] : this.layer[f]) as number,
            lb: (swap ? this.layer[f] : this.layer[g]) as number,
          });
          flats.set(edge, list);
        }
      }
    }

    let bad = 0;
    for (const [edge, list] of creases) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i] as Crease;
        for (let j = i + 1; j < list.length; j++) {
          const d = list[j] as Crease;
          if (c.site !== d.site) continue;
          if ((c.low < d.low && d.low < c.high && c.high < d.high) || (d.low < c.low && c.low < d.high && d.high < c.high)) bad++;
        }
        for (const flat of flats.get(edge) ?? []) {
          const h = flat.a === c.site ? flat.la : flat.b === c.site ? flat.lb : -1;
          if (h > c.low && h < c.high) bad++;
        }
      }
    }
    for (const list of flats.values()) {
      for (let i = 0; i < list.length; i++) {
        const s = list[i] as Flat;
        for (let j = i + 1; j < list.length; j++) {
          const t = list[j] as Flat;
          if (s.a === t.a && s.b === t.b && s.la < t.la !== s.lb < t.lb) bad++;
        }
      }
    }
    return bad;
  }

  /** Cuts every layer along a stretch of a line, then returns the resulting pieces. */
  cutAlong(line: MirrorLine, from: number, to: number): FoldBook[] {
    const along = (x: number, z: number) => (line.kind === 'x' ? z : x);
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    for (const f of this.faces) {
      for (let k = 0; k < CORNERS; k++) {
        const n = (k + 1) % CORNERS;
        const i = f * 6;
        const ax = this.at[i + k * 2] as number;
        const az = this.at[i + k * 2 + 1] as number;
        const bx = this.at[i + n * 2] as number;
        const bz = this.at[i + n * 2 + 1] as number;
        if (sideOf(line, ax, az) !== 0 || sideOf(line, bx, bz) !== 0) continue;
        if (Math.min(along(ax, az), along(bx, bz)) < low || Math.max(along(ax, az), along(bx, bz)) > high) continue;
        this.cut[f * CORNERS + k] = 1;
        const g = this.neighbour[f * CORNERS + k] as number;
        if (g >= 0) {
          for (let j = 0; j < CORNERS; j++) if (this.neighbour[g * CORNERS + j] === f) this.cut[g * CORNERS + j] = 1;
        }
      }
    }
    return this.split();
  }

  /** Separates pieces no longer joined by paper. Returns just this book if it is still whole. */
  private split(): FoldBook[] {
    const seen = new Set<number>();
    const groups: number[][] = [];
    for (const start of this.faces) {
      if (seen.has(start)) continue;
      const group: number[] = [];
      const todo = [start];
      seen.add(start);
      while (todo.length) {
        const f = todo.pop() as number;
        group.push(f);
        for (let k = 0; k < CORNERS; k++) {
          const g = this.neighbour[f * CORNERS + k] as number;
          if (g >= 0 && !this.edgeBlocked(f, k) && !seen.has(g)) {
            seen.add(g);
            todo.push(g);
          }
        }
      }
      groups.push(group);
    }
    if (groups.length === 1) return [this];
    return groups.map((group) => this.piece(group));
  }

  private piece(group: number[]): FoldBook {
    const copy = this.clone();
    const keep = new Set(group);
    copy.faces = group;
    copy.stacks = new Map();
    for (const [key, stack] of this.stacks) {
      const kept = stack.filter((f) => keep.has(f));
      if (kept.length) copy.stacks.set(key, kept);
    }
    copy.reindex();
    return copy;
  }

  clone(): FoldBook {
    const copy = new FoldBook(this.cells, this.rest, this.neighbour);
    copy.faces = [...this.faces];
    copy.at = this.at.slice();
    copy.flipped = this.flipped.slice();
    copy.cut = this.cut.slice();
    copy.creased = this.creased.slice();
    copy.layer = this.layer.slice();
    copy.stacks = new Map([...this.stacks].map(([key, stack]) => [key, [...stack]]));
    return copy;
  }

  /** Stack layout as text, bottom to top, for tests that pin exact results. */
  describeStackAt(x: number, z: number): string {
    let best: number[] | undefined;
    let bestDistance = Infinity;
    for (const stack of this.stacks.values()) {
      const f = stack[0] as number;
      const i = f * 6;
      const cx = ((this.at[i] as number) + (this.at[i + 2] as number) + (this.at[i + 4] as number)) / 3;
      const cz = ((this.at[i + 1] as number) + (this.at[i + 3] as number) + (this.at[i + 5] as number)) / 3;
      const distance = Math.hypot(cx - x, cz - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = stack;
      }
    }
    return (best ?? [])
      .map((f) => {
        const i = f * 6;
        const cx = ((this.rest[i] as number) + (this.rest[i + 2] as number) + (this.rest[i + 4] as number)) / 3;
        const cz = ((this.rest[i + 1] as number) + (this.rest[i + 3] as number) + (this.rest[i + 5] as number)) / 3;
        return `${this.quadrant(cx)}${this.quadrant(cz)}${this.flipped[f] ? '*' : ''}`;
      })
      .join(' ');
  }

  /** A letter for which third of the sheet a coordinate started in. */
  private quadrant(value: number): string {
    return value < this.span / 3 ? 'a' : value < (this.span * 2) / 3 ? 'b' : 'c';
  }
}
