import { describe, expect, it } from 'vitest';
import type { SheetDefinition } from '@/core/asset/sheetTypes';
import { UNITS_PER_CELL as U } from '@/core/fold/lattice';
import type { LineKind, MirrorLine } from '@/core/fold/lattice';
import { SheetPiece } from '@/core/fold/SheetPiece';
import { buildSoftMesh } from '@/core/fold/soft/softMesh';
import { FoldBook } from '@/core/fold/FoldBook';
import { foldRequest, RECIPES } from '@/core/fold/recipes';
import type { Recipe, SpreadStep } from '@/core/fold/recipes';

const sheet: SheetDefinition = {
  id: 'sheet.test', name: 'Test', description: '', size: 10, cells: 20,
  top: 'vermilion', bottom: 'washi', edge: 'washi', thickness: 0.01, density: 0.4, floppiness: 0.25,
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
    const mesh = buildSoftMesh(book, 10, [flap]);
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

/** How far the free end of a long strip sags, with its other end clamped high up. */
const sag = (folds: number) => {
  const piece = new SheetPiece(sheet);
  if (folds > 0) foldAll(piece, line('z', 5), 1);
  if (folds > 1) foldAll(piece, line('z', 2.5), 1);
  const { soft } = piece;
  const CLAMP_HEIGHT = 12;
  for (let t = 0; t < soft.mesh.triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = soft.mesh.tris[t * 3 + k] as number;
      if ((soft.mesh.flat[v * 2] as number) > -3.9) continue;
      const pin = soft.addPin(t, k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
      soft.pinPoint(pin, pin);
      pin.y = CLAMP_HEIGHT;
    }
  }
  run(piece, 360);
  let low = Infinity;
  for (let i = 1; i < soft.x.length; i += 3) low = Math.min(low, soft.x[i] as number);
  return CLAMP_HEIGHT - low;
};

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

  it('sags less the more it is folded, but never turns to board', () => {
    const [flat, twoLayers, fourLayers] = [sag(0), sag(1), sag(2)] as [number, number, number];
    console.log('sag in metres over 6 m of strip', flat.toFixed(2), twoLayers.toFixed(2), fourLayers.toFixed(2));
    expect(twoLayers).toBeLessThan(flat);
    expect(fourLayers).toBeLessThan(twoLayers);
    expect(fourLayers).toBeLessThan(flat - 0.3);
    expect(fourLayers).toBeGreaterThan(flat * 0.8);
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

  it('keeps a crease shut while a flap is pulled, instead of opening like cloth', () => {
    const piece = new SheetPiece(sheet);
    foldAll(piece, line('x', 5), 1);
    run(piece, 20);
    const top = piece.book.faces.find((f) => piece.book.flipped[f] === 1 && piece.book.stackOf(f).at(-1) === f) as number;
    piece.peel(top);
    const { soft } = piece;
    const creases = soft.mesh.hingeFolded.reduce((sum, f) => sum + f, 0);
    expect(creases).toBeGreaterThan(10);
    // Lift the flap's free edge a little and let the solver work.
    const free = soft.mesh.faceTri[top] as number;
    const pin = soft.addPin(free, 1, 0, 0);
    soft.pinPoint(pin, pin);
    for (let i = 0; i < 60; i++) {
      pin.y = Math.min(0.8, pin.y + 0.02);
      piece.step(DT);
    }
    let widest = 0;
    for (let h = 0; h < soft.mesh.hingeFolded.length; h++) {
      if (soft.mesh.hingeFolded[h]) widest = Math.max(widest, Math.PI - Math.abs(soft.angleAt(h)));
    }
    expect(widest).toBeLessThan(0.6);
  });

  it('turns a plane\'s wing on its fold, not on a small lock crease', () => {
    let piece = new SheetPiece(sheet);
    const plane = RECIPES.find((r) => r.id === 'plane') as Recipe;
    let wing = new Set<number>();
    for (const step of plane.steps) {
      if (step.action === 'trim') {
        const pieces = piece.cut({ kind: step.kind, c: step.at * 2 * U }, step.from * 2 * U, step.to * 2 * U);
        piece = pieces.reduce((a, b) => (b.book.faces.length > a.book.faces.length ? b : a));
      } else if (step.action === 'fold') {
        const plan = piece.fold(foldRequest(piece.book, 10, step));
        expect(plan.failure).toBeNull();
        if (step.label === 'Fold the top wing down') wing = new Set(plan.moved);
      }
    }
    const { book } = piece;
    // Wherever the wing is the top of the stack, lifting it takes exactly what its fold moved.
    const tops = [...wing].filter((f) => book.stackOf(f).at(-1) === f);
    expect(tops.length).toBeGreaterThan(20);
    for (const top of tops) expect(piece.flapToLift(top)).toEqual(wing);
  });

  /** Runs a recipe on real paper, leaving out any step that opens it. */
  const foldedRecipe = (id: string) => {
    let piece = new SheetPiece(sheet);
    const recipe = RECIPES.find((r) => r.id === id) as Recipe;
    for (const step of recipe.steps) {
      if (step.action === 'trim') {
        const pieces = piece.cut({ kind: step.kind, c: step.at * 2 * U }, step.from * 2 * U, step.to * 2 * U);
        piece = pieces.reduce((a, b) => (b.book.faces.length > a.book.faces.length ? b : a));
      } else if (step.action === 'fold') {
        expect(piece.fold(foldRequest(piece.book, 10, step)).failure).toBeNull();
      }
    }
    return { piece, spread: recipe.steps.find((step) => step.action === 'spread') as SpreadStep };
  };
  const outer = (piece: SheetPiece, under: boolean) => {
    const { book } = piece;
    const faces = [...book.stacks.values()].map((stack) => (under ? stack[0] : stack.at(-1)) as number);
    // Near the tail, and as far out along the wing as it goes.
    const tail = faces.filter((f) => (book.at[f * 6 + 1] as number) > 9 * 2 * U);
    return tail.reduce((far, f) => ((book.at[f * 6] as number) > (book.at[far * 6] as number) ? f : far));
  };

  it('lifts both wings at once, each from its own side, without welding them', () => {
    const { piece } = foldedRecipe('plane');
    expect(piece.peel(outer(piece, false))).toBe(true);
    piece.fixFlaps();
    expect(piece.peel(outer(piece, true), true)).toBe(true);
    const { triFlap } = piece.soft.mesh;
    expect(triFlap.filter((f) => f === 0).length).toBeGreaterThan(10);
    expect(triFlap.filter((f) => f === 1).length).toBeGreaterThan(10);
    expect(piece.lifted.size).toBe(224);
  });

  it('keeps a wing open once fixed, where a loose wing falls shut', () => {
    const opened = (fix: boolean) => {
      const { piece } = foldedRecipe('plane');
      const wing = outer(piece, false);
      piece.peel(wing);
      const { soft } = piece;
      // Hands on the body at both ends, and one on the wing.
      const body = Array.from({ length: soft.mesh.triCount }, (_, t) => t).filter((t) => soft.mesh.triFlap[t] === -1);
      for (const t of [body[0] as number, body.at(-1) as number]) soft.pinPoint(soft.addPin(t, 1, 0, 0), { x: 0, y: 0, z: 0 });
      for (const pin of soft.pins) soft.pinPoint(pin, pin);
      const hand = soft.addPin(soft.mesh.faceTri[wing] as number, 1, 0, 0);
      soft.pinPoint(hand, hand);
      for (let i = 0; i < 120; i++) {
        hand.y = Math.min(1.8, hand.y + 0.03);
        piece.step(DT);
      }
      if (fix) piece.fixFlaps();
      soft.removePin(hand);
      run(piece, 180);
      return heights(piece).top;
    };
    const [fixed, loose] = [opened(true), opened(false)];
    console.log('wing height after letting go, fixed and loose', fixed.toFixed(2), loose.toFixed(2));
    expect(fixed).toBeGreaterThan(loose + 0.4);
  });

  it('spreads a plane without stretching it or changing its folds', () => {
    for (const id of ['plane', 'dart']) {
      const { piece, spread } = foldedRecipe(id);
      expect(piece.spread(spread)).toBe(true);
      expect(piece.soft.stretch()).toBeLessThan(0.01);
      expect(piece.fixedFlaps).toBe(2);
      expect(piece.book.violations()).toBe(0);
      // Wings open upwards from the hinge, in a V above the keel.
      expect(heights(piece).top).toBeGreaterThan(spread.height + 0.4);
      expect(heights(piece).low).toBeLessThan(spread.height - 0.4);
    }
  });

  it('lets anything that shows be lifted, at every step of a plane', () => {
    let piece = new SheetPiece(sheet);
    const plane = RECIPES.find((r) => r.id === 'plane') as Recipe;
    for (const step of plane.steps) {
      if (step.action === 'trim') {
        const pieces = piece.cut({ kind: step.kind, c: step.at * 2 * U }, step.from * 2 * U, step.to * 2 * U);
        piece = pieces.reduce((a, b) => (b.book.faces.length > a.book.faces.length ? b : a));
      }
      if (step.action !== 'fold') continue;
      piece.fold(foldRequest(piece.book, 10, step));
      for (const stack of piece.book.stacks.values()) {
        if (stack.length > 1) expect(piece.flapToLift(stack.at(-1) as number)).not.toBeNull();
      }
    }
  });

  it('finds what a lifted wing was covering', () => {
    const { piece } = foldedRecipe('plane');
    const wing = outer(piece, false);
    const covered = piece.book.stackOf(wing).at(-2) as number;
    expect(piece.flapToLift(covered)).toBeNull();
    piece.peel(wing);
    piece.fixFlaps();
    expect(piece.flapToLift(covered)).not.toBeNull();
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
    soft.harden(true);
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

  it('softens again when released', () => {
    const piece = new SheetPiece(sheet);
    piece.harden(true);
    expect(piece.soft.hardened).toBe(true);
    piece.harden(false);
    expect(piece.soft.hardened).toBe(false);
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

it('steps one sheet in well under a 60 Hz frame', () => {
  const piece = new SheetPiece(sheet);
  run(piece, 10);
  const start = performance.now();
  run(piece, 60);
  const ms = (performance.now() - start) / 60;
  console.log(`soft sheet: ${ms.toFixed(2)} ms per step, ${piece.soft.mesh.triCount} triangles`);
  expect(ms).toBeLessThan(12);
});
