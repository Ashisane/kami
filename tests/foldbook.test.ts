import { describe, expect, it } from 'vitest';
import { FoldBook } from '@/core/fold/FoldBook';
import { blankBook } from '@/core/fold/paper';
import type { FoldRequest, Landing } from '@/core/fold/FoldBook';
import { buildTiling, reflectX, reflectZ, siteKey, UNITS_PER_CELL as U } from '@/core/fold/lattice';
import type { LineKind, MirrorLine } from '@/core/fold/lattice';

const CELLS = 20;
/** Metres to lattice units, on a 10 m sheet of 0.5 m half-cells. */
const m = (metres: number) => metres * 2 * U;
const line = (kind: LineKind, metres: number): MirrorLine => ({ kind, c: m(metres) });

function topFace(book: FoldBook, l: MirrorLine, side: number): number {
  const movable = book.faces.find((f) => {
    const stack = book.stackOf(f);
    if (stack[stack.length - 1] !== f) return false;
    return book.plan({ line: l, side, seeds: [f] }).moved.size > 0;
  });
  if (movable === undefined) throw new Error('no face on that side');
  return movable;
}

/** Holds every face on the side, like gripping all the layers at once. */
const everything = (book: FoldBook) => book.faces;

function fold(book: FoldBook, l: MirrorLine, side: number, options: { all?: boolean; seed?: number; landing?: Landing } = {}) {
  const seeds = options.all ? everything(book) : [options.seed ?? topFace(book, l, side)];
  const request: FoldRequest = { line: l, side, seeds, landing: options.landing };
  return book.fold(request);
}

const stacked = (book: FoldBook) => [...book.stacks.values()].reduce((sum, s) => sum + s.length, 0);

describe('the tetrakis lattice', () => {
  it('maps every face exactly onto a face, for every mirror line', () => {
    const { corners, count } = buildTiling(CELLS);
    const sum = (f: number, offset: number) => (corners[f * 6 + offset] as number) + (corners[f * 6 + offset + 2] as number) + (corners[f * 6 + offset + 4] as number);
    const sites = new Set(Array.from({ length: count }, (_, f) => siteKey(sum(f, 0), sum(f, 1))));
    const lines: MirrorLine[] = [];
    for (let k = 0; k <= CELLS; k++) lines.push({ kind: 'x', c: k * U }, { kind: 'z', c: k * U });
    for (let k = -CELLS; k <= CELLS; k += 2) lines.push({ kind: 'diff', c: k * U });
    for (let k = 0; k <= CELLS * 2; k += 2) lines.push({ kind: 'sum', c: k * U });

    let misses = 0;
    for (const l of lines) {
      for (let f = 0; f < count; f++) {
        let sx = 0;
        let sz = 0;
        let inside = true;
        for (let k = 0; k < 3; k++) {
          const x = corners[f * 6 + k * 2] as number;
          const z = corners[f * 6 + k * 2 + 1] as number;
          const rx = reflectX(l, x, z);
          const rz = reflectZ(l, x, z);
          sx += rx;
          sz += rz;
          inside &&= rx >= 0 && rz >= 0 && rx <= CELLS * U && rz <= CELLS * U;
        }
        if (inside && !sites.has(siteKey(sx, sz))) misses++;
      }
    }
    expect(misses).toBe(0);
  });
});

describe('folding', () => {
  it('folds in half into two layers', () => {
    const book = FoldBook.sheet(CELLS);
    expect(fold(book, line('x', 5), 1).failure).toBeNull();
    expect(book.tallest).toBe(2);
    expect(stacked(book)).toBe(800);
  });

  it('folds in half twice with the layer order real paper has', () => {
    const book = FoldBook.sheet(CELLS);
    fold(book, line('x', 5), 1);
    fold(book, line('z', 5), 1, { all: true });
    expect(book.tallest).toBe(4);
    // a/c is which third of the sheet a face started in, * means it is turned over.
    expect(book.describeStackAt(m(2.2), m(2.2))).toBe('aa ca* cc ac*');
    expect(book.violations()).toBe(0);
  });

  it('puts the middle of a letter fold between two flaps', () => {
    const book = FoldBook.sheet(CELLS);
    fold(book, line('x', 7), 1);
    expect(fold(book, line('x', 3), -1).failure).toBeNull();
    expect(book.describeStackAt(m(4.9), m(4.9))).toBe('bb cb* ab*');
  });

  it('folds all four corners to the centre on diagonals', () => {
    const book = FoldBook.sheet(CELLS);
    for (const [l, side] of [[line('sum', 5), -1], [line('sum', 15), 1], [line('diff', 5), 1], [line('diff', -5), -1]] as const) {
      expect(fold(book, l, side).failure).toBeNull();
    }
    expect(book.tallest).toBe(2);
    expect(book.violations()).toBe(0);
  });

  it('moves only the top flap when only the top flap is held', () => {
    const book = FoldBook.sheet(CELLS);
    fold(book, line('x', 5), 1);
    const flap = book.faces.find((f) => book.flipped[f] === 1 && (book.at[f * 6] as number) < m(2));
    const plan = fold(book, line('x', 2.5), -1, { seed: flap });
    expect(plan.failure).toBeNull();
    expect(plan.moved.size).toBe(200);
    expect(book.tallest).toBe(3);
  });

  it('tucks both corners between their own layers in an inside fold', () => {
    const book = FoldBook.sheet(CELLS);
    fold(book, line('z', 5), 1);
    const plan = fold(book, line('diff', 5), 1, { all: true, landing: { kind: 'tuck', layer: 1 } });
    expect(plan.failure).toBeNull();
    expect(book.tallest).toBe(4);
  });
});

describe('impossible folds are refused', () => {
  it('starts an A4 sheet 7 by 10 m, centred, flat and whole', () => {
    const book = blankBook(CELLS, 'a4');
    expect(book.faces.length).toBe(560);
    expect(book.tallest).toBe(1);
    const xs = book.faces.flatMap((f) => [book.at[f * 6] as number, book.at[f * 6 + 2] as number, book.at[f * 6 + 4] as number]);
    expect(Math.min(...xs)).toBe(m(1.5));
    expect(Math.max(...xs)).toBe(m(8.5));
    expect(blankBook(CELLS, 'square').faces.length).toBe(800);
  });

  it('carries a flap lying on the paper over with it, as a hand would', () => {
    const book = FoldBook.sheet(CELLS);
    fold(book, line('x', 6.5), 1);
    // Hold only the bottom layer: the flap lying on it cannot stay behind, so it folds too.
    const bottom = book.faces.find((f) => (book.at[f * 6] as number) < m(1)) as number;
    const everyLayer = book.plan({ line: line('x', 3.5), side: -1, seeds: everything(book) }).moved;
    const plan = book.fold({ line: line('x', 3.5), side: -1, seeds: [bottom] });
    expect(plan.failure).toBeNull();
    expect(plan.moved).toEqual(everyLayer);
    expect(book.violations()).toBe(0);
  });

  it('refuses a tuck that would make layers pass through each other', () => {
    const book = FoldBook.sheet(CELLS);
    fold(book, line('z', 5), 1);
    const bad = book.fold({ line: line('x', 8), side: 1, seeds: [book.faces[0] as number], landing: { kind: 'tuck', layer: 1 } });
    expect(bad.failure).toBe('nothing-moves');
    const crossing = book.plan({ line: line('diff', 5), side: 1, seeds: everything(book), landing: { kind: 'tuck', layer: 0 } });
    expect(crossing.failure).toBe('layers-cross');
  });

  it('refuses a line that is not on the grid', () => {
    const book = FoldBook.sheet(CELLS);
    expect(book.plan({ line: { kind: 'x', c: 7 }, side: 1, seeds: everything(book) }).failure).toBe('not-a-grid-line');
    expect(book.plan({ line: { kind: 'sum', c: U }, side: 1, seeds: everything(book) }).failure).toBe('not-a-grid-line');
  });

  it('refuses a fold that moves everything', () => {
    const book = FoldBook.sheet(CELLS);
    expect(book.plan({ line: line('x', 0), side: 1, seeds: everything(book) }).failure).toBe('nothing-stays');
  });

  it('keeps every legal sequence physically valid', () => {
    const book = FoldBook.sheet(CELLS);
    const folds: [MirrorLine, number][] = [[line('x', 5), 1], [line('z', 5), 1], [line('sum', 5), -1], [line('x', 2.5), -1]];
    for (const [l, side] of folds) {
      fold(book, l, side, { all: true });
      expect(book.violations()).toBe(0);
    }
  });
});

describe('cutting', () => {
  it('cuts a sheet in two', () => {
    const book = FoldBook.sheet(CELLS);
    const pieces = book.cutAlong(line('x', 5), 0, m(10));
    expect(pieces).toHaveLength(2);
    expect(pieces.map((p) => p.faces.length)).toEqual([400, 400]);
  });

  it('leaves a slit as one piece', () => {
    const book = FoldBook.sheet(CELLS);
    expect(book.cutAlong(line('x', 5), 0, m(4))).toHaveLength(1);
  });

  it('cuts through every layer of a stack, so one cut can free a corner of each', () => {
    const book = FoldBook.sheet(CELLS);
    fold(book, line('x', 5), 1);
    const pieces = book.cutAlong(line('z', 2), 0, m(5));
    // The strip below the cut stays joined along the spine, so it comes away as one piece.
    expect(pieces.map((p) => p.faces.length).sort((a, b) => a - b)).toEqual([160, 640]);
    expect(pieces.every((p) => p.violations() === 0)).toBe(true);
  });

  it('stops folds from travelling across a slit', () => {
    const book = FoldBook.sheet(CELLS);
    book.cutAlong(line('z', 5), m(5), m(10));
    const flap = book.faces.find((f) => (book.at[f * 6] as number) > m(9) && (book.at[f * 6 + 1] as number) < m(1));
    const plan = book.plan({ line: line('x', 7.5), side: 1, seeds: [flap as number] });
    expect(plan.moved.size).toBe(100);
  });
});

it('performs a fold quickly enough to preview every frame', () => {
  const book = FoldBook.sheet(CELLS);
  fold(book, line('x', 5), 1);
  const start = performance.now();
  for (let i = 0; i < 100; i++) book.plan({ line: line('z', 5), side: 1, seeds: book.faces });
  expect((performance.now() - start) / 100).toBeLessThan(8);
});
