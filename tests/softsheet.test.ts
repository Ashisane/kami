import { describe, expect, it } from 'vitest';
import type { SheetDefinition } from '@/core/asset/sheetTypes';
import { UNITS_PER_CELL as U } from '@/core/fold/lattice';
import type { LineKind, MirrorLine } from '@/core/fold/lattice';
import { SheetPiece } from '@/core/fold/SheetPiece';
import { buildSoftMesh } from '@/core/fold/soft/softMesh';
import { FoldBook } from '@/core/fold/FoldBook';

const sheet: SheetDefinition = {
  id: 'sheet.test', name: 'Test', description: '', size: 10, cells: 20,
  top: 'vermilion', bottom: 'washi', edge: 'washi', thickness: 0.03, density: 0.4, floppiness: 1,
};
const m = (metres: number) => metres * 2 * U;
const line = (kind: LineKind, metres: number): MirrorLine => ({ kind, c: m(metres) });
const DT = 1 / 60;

const run = (piece: SheetPiece, frames: number) => {
  for (let i = 0; i < frames; i++) piece.step(DT);
};
const heights = (piece: SheetPiece) => {
  let top = -Infinity, low = Infinity;
  for (let i = 1; i < piece.soft.x.length; i += 3) {
    top = Math.max(top, piece.soft.x[i] as number);
    low = Math.min(low, piece.soft.x[i] as number);
  }
  return { top, low };
};
function foldAll(piece: SheetPiece, l: MirrorLine, side: number) {
  const plan = piece.fold({ line: l, side, seeds: piece.book.faces });
  expect(plan.failure).toBeNull();
}

describe('soft mesh', () => {
  it('matches the sheet when nothing is folded', () => {
    const mesh = buildSoftMesh(FoldBook.sheet(20), 10);
    expect(mesh.vertexCount).toBe(441);
    expect(mesh.triCount).toBe(800);
    expect(mesh.edgeLength.length).toBe(1240);
    expect(mesh.hinges.length / 4).toBe(1160);
  });

  it('merges a folded sheet into half the cloth at double weight', () => {
    const book = FoldBook.sheet(20);
    book.fold({ line: line('x', 5), side: 1, seeds: book.faces });
    const mesh = buildSoftMesh(book, 10);
    expect(mesh.triCount).toBe(400);
    expect(mesh.vertexCount).toBe(231);
    expect(Math.max(...mesh.triLayers)).toBe(2);

    const flatMesh = buildSoftMesh(FoldBook.sheet(20), 10);
    const interiorW = (w: Float64Array) => w.reduce((low, v) => Math.min(low, v), Infinity);
    expect(interiorW(mesh.inverseMass) / interiorW(flatMesh.inverseMass)).toBeCloseTo(0.5, 5);
  });

  it('keeps a slit open instead of welding it shut', () => {
    const book = FoldBook.sheet(20);
    const whole = buildSoftMesh(book, 10).vertexCount;
    book.cutAlong(line('x', 5), 0, m(4));
    expect(buildSoftMesh(book, 10).vertexCount).toBeGreaterThan(whole);
  });

  it('lets a peeled flap move apart from its stack, joined only along the crease', () => {
    const book = FoldBook.sheet(20);
    book.fold({ line: line('x', 5), side: 1, seeds: book.faces });
    const flap = new Set(book.faces.filter((f) => book.flipped[f] === 1));
    const mesh = buildSoftMesh(book, 10, flap);
    expect(mesh.triCount).toBe(800);
    // 441 of the flat sheet: the spine stays shared, nothing else does.
    expect(mesh.vertexCount).toBe(441);
  });
});

describe('cloth', () => {
  it('lies still on the ground', () => {
    const piece = new SheetPiece(sheet);
    run(piece, 60);
    expect(piece.soft.stretch()).toBeLessThan(0.001);
    expect(heights(piece).top).toBeLessThan(0.05);
  });

  it('hangs from a pin without stretching or exploding', () => {
    const piece = new SheetPiece(sheet);
    const { soft } = piece;
    const pin = soft.addPin(0, 1, 0, 0);
    soft.pinPoint(pin, pin);
    for (let i = 0; i < 180; i++) {
      pin.y = Math.min(6, pin.y + 0.05);
      piece.step(DT);
    }
    expect(soft.stretch()).toBeLessThan(0.02);
    const { top, low } = heights(piece);
    expect(top).toBeGreaterThan(5);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(top)).toBe(true);
  });

  it('settles a corner dragged across the sheet without tearing through itself', () => {
    const piece = new SheetPiece(sheet);
    const { soft } = piece;
    const pin = soft.addPin(0, 1, 0, 0);
    soft.pinPoint(pin, pin);
    const frames = 240;
    for (let f = 0; f < frames; f++) {
      const k = f / frames;
      pin.x = -5 + 8 * k;
      pin.z = -5 + 8 * k;
      pin.y = 0.2 + Math.sin(k * Math.PI) * 3;
      piece.step(DT);
    }
    soft.removePin(pin);
    run(piece, 120);
    expect(soft.stretch()).toBeLessThan(0.03);
    expect(heights(piece).top).toBeLessThan(3);
  });
});

describe('folded paper in the solver', () => {
  it('rebuilds from the Book and lands flat, two layers thick', () => {
    const piece = new SheetPiece(sheet);
    foldAll(piece, line('x', 5), 1);
    expect(piece.soft.mesh.triCount).toBe(400);
    run(piece, 60);
    expect(piece.soft.stretch()).toBeLessThan(0.01);
    expect(heights(piece).top).toBeLessThan(0.1);
  });

  it('stays half the width after folding', () => {
    const piece = new SheetPiece(sheet);
    foldAll(piece, line('x', 5), 1);
    run(piece, 30);
    let maxX = -Infinity;
    for (let i = 0; i < piece.soft.x.length; i += 3) maxX = Math.max(maxX, piece.soft.x[i] as number);
    expect(maxX).toBeLessThan(0.1);
  });

  it('droops less the more it is folded', () => {
    const droop = (folds: number) => {
      const piece = new SheetPiece(sheet);
      if (folds > 0) foldAll(piece, line('x', 5), 1);
      if (folds > 1) foldAll(piece, line('z', 5), 1);
      const { soft } = piece;
      // Hold the whole left edge up and let the far side hang.
      const pins = [];
      for (let t = 0; t < soft.mesh.triCount; t++) {
        const v = soft.mesh.tris[t * 3] as number;
        if ((soft.mesh.flat[v * 2] as number) < -4.9) {
          const pin = soft.addPin(t, 1, 0, 0);
          soft.pinPoint(pin, pin);
          pin.y = 4;
          pins.push(pin);
        }
      }
      run(piece, 150);
      let low = Infinity, high = -Infinity;
      for (let i = 1; i < soft.x.length; i += 3) {
        low = Math.min(low, soft.x[i] as number);
        high = Math.max(high, soft.x[i] as number);
      }
      return high - low;
    };
    expect(droop(2)).toBeLessThan(droop(0));
  });

  it('lifts a flap off its stack, then lets it fall back', () => {
    const piece = new SheetPiece(sheet);
    foldAll(piece, line('x', 5), 1);
    const top = piece.book.faces.find((f) => piece.book.flipped[f] === 1 && piece.book.stackOf(f).at(-1) === f) as number;
    expect(piece.peel(top)).toBe(true);
    expect(piece.soft.mesh.triCount).toBe(800);
    run(piece, 20);
    piece.settle();
    expect(piece.soft.mesh.triCount).toBe(400);
  });

  it('refuses to peel a flap with another layer on top of it', () => {
    const piece = new SheetPiece(sheet);
    foldAll(piece, line('x', 5), 1);
    const bottom = piece.book.faces.find((f) => piece.book.flipped[f] === 0 && piece.book.stackOf(f)[0] === f) as number;
    expect(piece.peel(bottom)).toBe(false);
  });
});

describe('hardening', () => {
  it('holds its shape as one solid body when dropped', () => {
    const piece = new SheetPiece(sheet);
    foldAll(piece, line('x', 5), 1);
    const { soft } = piece;
    const pin = soft.addPin(0, 1, 0, 0);
    soft.pinPoint(pin, pin);
    for (let i = 0; i < 90; i++) {
      pin.y += 0.03;
      piece.step(DT);
    }
    soft.removePin(pin);
    soft.harden(1);
    const edge = (x: Float64Array) => {
      const { edges, edgeLength } = soft.mesh;
      const n = edgeLength.length >> 1;
      const a = (edges[n * 2] as number) * 3, b = (edges[n * 2 + 1] as number) * 3;
      return Math.hypot((x[a] as number) - (x[b] as number), (x[a + 1] as number) - (x[b + 1] as number), (x[a + 2] as number) - (x[b + 2] as number));
    };
    // Two distant points keep their distance exactly, unlike cloth.
    const far = (x: Float64Array) => Math.hypot((x[0] as number) - (x[x.length - 3] as number), (x[1] as number) - (x[x.length - 2] as number), (x[2] as number) - (x[x.length - 1] as number));
    const span = far(soft.x);
    const length = edge(soft.x);
    run(piece, 120);
    expect(far(soft.x)).toBeCloseTo(span, 3);
    expect(edge(soft.x)).toBeCloseTo(length, 3);
    expect(heights(piece).low).toBeGreaterThanOrEqual(0);
  });

  it('springs back towards its hardened shape when only partly rigid', () => {
    const piece = new SheetPiece(sheet);
    const { soft } = piece;
    const pin = soft.addPin(0, 1, 0, 0);
    soft.pinPoint(pin, pin);
    for (let i = 0; i < 60; i++) {
      pin.y += 0.05;
      piece.step(DT);
    }
    soft.harden(0.9);
    soft.removePin(pin);
    run(piece, 60);
    expect(Number.isFinite(heights(piece).top)).toBe(true);
    expect(soft.stretch()).toBeLessThan(0.05);
  });
});

describe('cutting a piece', () => {
  it('makes two independent pieces that keep their place', () => {
    const piece = new SheetPiece(sheet);
    const pieces = piece.cut(line('x', 5), 0, m(10));
    expect(pieces).toHaveLength(2);
    run(pieces[0] as SheetPiece, 10);
    run(pieces[1] as SheetPiece, 10);
    expect((pieces[0] as SheetPiece).soft.stretch()).toBeLessThan(0.01);
  });
});

it('is fast enough for four sheets on one laptop', () => {
  const piece = new SheetPiece(sheet);
  run(piece, 10);
  const start = performance.now();
  run(piece, 60);
  const ms = (performance.now() - start) / 60;
  console.log(`soft sheet: ${ms.toFixed(2)} ms per step, ${piece.soft.mesh.triCount} triangles`);
  expect(ms).toBeLessThan(8);
});
