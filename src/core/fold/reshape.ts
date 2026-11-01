import type { FoldBook } from './FoldBook';
import { sideOf } from './lattice';
import type { LineKind } from './lattice';

/**
 * The move a plain fold cannot make: opening a pocket and flattening it a new way.
 * Old creases open while new ones form at once, as when a paper hat is pulled out
 * into a square. It is described as a change to the crease pattern, and the paper's
 * new position follows from that. If the pattern cannot lie flat, or no layer order
 * works, it is refused and nothing changes.
 */
export interface CreaseChange {
  /** The line on the flat sheet, in lattice units. */
  kind: LineKind;
  c: number;
  crease: boolean;
}

export type ReshapeFailure = 'cannot-lie-flat' | 'no-layer-order';

/** Placements to try before giving up, so a hard case can never hang the game. */
const SEARCH_BUDGET = 6000;

const point = (values: Int32Array, f: number, k: number): [number, number] => [values[f * 6 + k * 2] as number, values[f * 6 + k * 2 + 1] as number];

/** Which edges of the paper will be creased after the change. */
function creaseMap(book: FoldBook, changes: readonly CreaseChange[]): Uint8Array {
  const creased = new Uint8Array(book.faceCount * 3);
  for (const f of book.faces) {
    for (let k = 0; k < 3; k++) {
      const g = book.neighbour[f * 3 + k] as number;
      if (g < 0) continue;
      let folded = book.flipped[f] !== book.flipped[g];
      const [ax, az] = point(book.rest, f, k);
      const [bx, bz] = point(book.rest, f, (k + 1) % 3);
      for (const { kind, c, crease } of changes) {
        if (sideOf({ kind, c }, ax, az) === 0 && sideOf({ kind, c }, bx, bz) === 0) folded = crease;
      }
      creased[f * 3 + k] = folded ? 1 : 0;
    }
  }
  return creased;
}

/** Where a neighbour's third corner goes, given the shared edge and how it joins. */
function placeThird(
  restA: [number, number], restB: [number, number], restD: [number, number],
  a: [number, number], b: [number, number], ownThird: [number, number], folded: boolean,
): [number, number] {
  const ux = restB[0] - restA[0], uz = restB[1] - restA[1];
  const vx = restD[0] - restA[0], vz = restD[1] - restA[1];
  const length = ux * ux + uz * uz;
  const along = (vx * ux + vz * uz) / length;
  const across = Math.abs(vx * uz - vz * ux) / length;

  const nx = b[0] - a[0], nz = b[1] - a[1];
  const ownSide = Math.sign(nx * (ownThird[1] - a[1]) - nz * (ownThird[0] - a[0]));
  // Flat paper carries on past the edge; folded paper comes back over it.
  const sign = folded ? ownSide : -ownSide;
  return [Math.round(a[0] + along * nx - across * sign * nz), Math.round(a[1] + along * nz + across * sign * nx)];
}

/** Lays the paper out from one face, following the creases. Null if it does not close up. */
function layOut(book: FoldBook, creased: Uint8Array): Int32Array | null {
  const at = new Int32Array(book.at.length);
  const placed = new Uint8Array(book.faceCount);
  const start = book.faces[0] as number;
  for (let i = 0; i < 6; i++) at[start * 6 + i] = book.at[start * 6 + i] as number;
  placed[start] = 1;
  const todo = [start];

  while (todo.length) {
    const f = todo.pop() as number;
    for (let k = 0; k < 3; k++) {
      const g = book.neighbour[f * 3 + k] as number;
      if (g < 0 || book.edgeBlocked(f, k)) continue;
      const n = (k + 1) % 3;
      const third = (k + 2) % 3;
      const restA = point(book.rest, f, k), restB = point(book.rest, f, n);
      const a = point(at, f, k), b = point(at, f, n), own = point(at, f, third);

      const next = new Int32Array(6);
      for (let j = 0; j < 3; j++) {
        const rest = point(book.rest, g, j);
        let spot: [number, number];
        if (rest[0] === restA[0] && rest[1] === restA[1]) spot = a;
        else if (rest[0] === restB[0] && rest[1] === restB[1]) spot = b;
        else spot = placeThird(restA, restB, rest, a, b, own, creased[f * 3 + k] === 1);
        next[j * 2] = spot[0];
        next[j * 2 + 1] = spot[1];
      }
      if (placed[g]) {
        for (let i = 0; i < 6; i++) if (at[g * 6 + i] !== next[i]) return null;
        continue;
      }
      at.set(next, g * 6);
      placed[g] = 1;
      todo.push(g);
    }
  }
  return at;
}

/** Whether a face has been turned over, from its corners. */
function isFlipped(rest: Int32Array, at: Int32Array, f: number): number {
  const area = (values: Int32Array) => {
    const [ax, az] = point(values, f, 0), [bx, bz] = point(values, f, 1), [cx, cz] = point(values, f, 2);
    return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  };
  return Math.sign(area(rest)) === Math.sign(area(at)) ? 0 : 1;
}

/** Groups faces into plates: flat pieces with no crease inside them. */
function findPlates(book: FoldBook, creased: Uint8Array): number[][] {
  const seen = new Set<number>();
  const plates: number[][] = [];
  for (const start of book.faces) {
    if (seen.has(start)) continue;
    const plate: number[] = [];
    const todo = [start];
    seen.add(start);
    while (todo.length) {
      const f = todo.pop() as number;
      plate.push(f);
      for (let k = 0; k < 3; k++) {
        const g = book.neighbour[f * 3 + k] as number;
        if (g < 0 || book.edgeBlocked(f, k) || creased[f * 3 + k] || seen.has(g)) continue;
        seen.add(g);
        todo.push(g);
      }
    }
    plates.push(plate);
  }
  return plates;
}

/**
 * Finds an order for the plates that real paper could have, by placing them one
 * at a time and backing out of dead ends. Plates keep close to their old order,
 * so the answer stays as near as it can to what the paper was doing already.
 */
function orderPlates(book: FoldBook, plates: number[][], at: Int32Array, flipped: Uint8Array, accept: (candidate: FoldBook) => boolean): Map<number, number[]> | null {
  const trial = book.clone();
  trial.at = at;
  trial.flipped = flipped;
  const height = (plate: number[]) => plate.reduce((sum, f) => sum + (book.layer[f] as number), 0) / plate.length;
  const queue = [...plates].sort((a, b) => height(a) - height(b));
  const order: number[][] = [];
  let tries = 0;

  const apply = () => {
    trial.stacks = new Map();
    trial.layer.fill(-1);
    for (const plate of order) {
      for (const f of plate) {
        const key = trial.site(f);
        const stack = trial.stacks.get(key);
        if (stack) stack.push(f);
        else trial.stacks.set(key, [f]);
      }
    }
    return trial.violations() === 0;
  };

  const place = (index: number): boolean => {
    const plate = queue[index];
    if (!plate) return accept(trial.clone());
    for (let position = order.length; position >= 0; position--) {
      if (++tries > SEARCH_BUDGET) return false;
      order.splice(position, 0, plate);
      if (apply() && place(index + 1)) return true;
      order.splice(position, 1);
    }
    return false;
  };

  if (!place(0)) return null;
  apply();
  return trial.stacks;
}

/**
 * Applies a change to the crease pattern. Returns why it could not be done, or
 * null. Several layer orders can be valid, so `accept` picks: paper is arranged
 * with the next step in mind, and hands do the same thing.
 */
export function reshape(book: FoldBook, changes: readonly CreaseChange[], accept: (candidate: FoldBook) => boolean = () => true): ReshapeFailure | null {
  const creased = creaseMap(book, changes);
  const at = layOut(book, creased);
  if (!at) return 'cannot-lie-flat';

  const flipped = new Uint8Array(book.faceCount);
  for (const f of book.faces) flipped[f] = isFlipped(book.rest, at, f);

  const stacks = orderPlates(book, findPlates(book, creased), at, flipped, accept);
  if (!stacks) return 'no-layer-order';
  book.at = at;
  book.flipped = flipped;
  book.stacks = stacks;
  book.violations();
  return null;
}
