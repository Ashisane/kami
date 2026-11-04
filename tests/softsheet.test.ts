import { describe, expect, it } from 'vitest';
import type { SheetDefinition } from '@/core/asset/sheetTypes';
import { UNITS_PER_CELL as U } from '@/core/fold/lattice';
import type { LineKind, MirrorLine } from '@/core/fold/lattice';
import { SheetPiece } from '@/core/fold/SheetPiece';
import { buildSoftMesh } from '@/core/fold/soft/softMesh';
import { FULL_STRAIN, StrainClock } from '@/core/fold/soft/SoftSheet';
import { SheetView } from '@/core/render/SheetView';
import { LineSegments } from 'three';
import { FoldBook } from '@/core/fold/FoldBook';
import { foldRequest, RECIPES } from '@/core/fold/recipes';
import type { Recipe } from '@/core/fold/recipes';

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

  it('folds only the top layer, leaving the one under it on the table', () => {
    const piece = new SheetPiece(sheet);
    foldAll(piece, line('x', 5), 1);
    run(piece, 20);
    const { book } = piece;
    // The top layer's free edge now lies along x = 0. Fold just that layer back, on x = 2.5.
    const edge = book.faces.find((f) => book.flipped[f] === 1 && (book.at[f * 6] as number) <= 1 && Math.abs((book.at[f * 6 + 1] as number) - m(5)) <= m(0.5)) as number;
    const fold = line('x', 2.5);
    const plan = book.plan({ line: fold, side: -1, seeds: [edge] });
    expect(plan.failure).toBeNull();
    expect([...plan.moved].every((f) => book.flipped[f] === 1)).toBe(true);
    piece.liftFor(plan.moved, fold, false);

    const base = book.faces.filter((f) => book.flipped[f] === 0);
    const before = piece.corners();
    const { soft } = piece;
    const hand = soft.addPin(soft.mesh.faceTri[edge] as number, 1 / 3, 1 / 3, 1 / 3);
    const start = hand.x;
    // Up and over to where the edge lands, then held there.
    for (let i = 1; i <= 120; i++) {
      const t = Math.min(1, i / 80);
      hand.x = start + t * 2 * (-2.5 - start);
      hand.y = 0.25 + Math.sin(t * Math.PI) * 2;
      piece.step(DT);
    }
    const now = piece.corners();
    let rose = 0, slid = 0;
    for (const f of base) {
      for (let k = 0; k < 3; k++) {
        const o = f * 9 + k * 3;
        rose = Math.max(rose, now[o + 1] as number);
        slid = Math.max(slid, Math.hypot((now[o] as number) - (before[o] as number), (now[o + 2] as number) - (before[o + 2] as number)));
      }
    }
    console.log('the layer under a folded top layer rises', rose.toFixed(2), 'm and slides', slid.toFixed(2), 'm');
    expect(rose).toBeLessThan(0.1);
    expect(slid).toBeLessThan(0.1);
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
    return { piece };
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
    expect(piece.peel(outer(piece, true), true)).toBe(true);
    const { triFlap } = piece.soft.mesh;
    expect(triFlap.filter((f) => f === 0).length).toBeGreaterThan(10);
    expect(triFlap.filter((f) => f === 1).length).toBeGreaterThan(10);
    expect(piece.lifted.size).toBe(224);
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

  it('raises the lock tip clear of the paper held down beside it', () => {
    let piece = new SheetPiece(sheet);
    const plane = RECIPES.find((r) => r.id === 'plane') as Recipe;
    let tip = new Set<number>();
    for (const step of plane.steps) {
      if (step.action === 'trim') {
        const pieces = piece.cut({ kind: step.kind, c: step.at * 2 * U }, step.from * 2 * U, step.to * 2 * U);
        piece = pieces.reduce((a, b) => (b.book.faces.length > a.book.faces.length ? b : a));
      } else if (step.action === 'fold') {
        tip = new Set(piece.fold(foldRequest(piece.book, 10, step)).moved);
        if (step.label.includes('Nakamura lock')) break;
      }
    }
    run(piece, 20);
    const { book } = piece;
    expect(piece.peel([...tip].find((f) => book.stackOf(f).at(-1) === f) as number)).toBe(true);
    const { soft } = piece;
    const { mesh } = soft;
    const tris = Array.from({ length: mesh.triCount }, (_, t) => t);
    const stackPoints = new Set(tris.filter((t) => mesh.triFlap[t] < 0).flatMap((t) => [0, 1, 2].map((k) => mesh.tris[t * 3 + k] as number)));
    // A hand on the free end of the tip, and hands on the stack a little way off.
    const handTri = tris.find((t) => mesh.triFlap[t] === 0 && !stackPoints.has(mesh.tris[t * 3] as number)) as number;
    const hand = soft.addPin(handTri, 1, 0, 0);
    soft.pinPoint(hand, hand);
    const from = { x: hand.x, y: hand.y, z: hand.z };
    const away = (t: number) => Math.hypot((soft.x[(mesh.tris[t * 3] as number) * 3] as number) - from.x, (soft.x[(mesh.tris[t * 3] as number) * 3 + 2] as number) - from.z);
    const held = tris.filter((t) => mesh.triFlap[t] < 0 && away(t) > 0.8).sort((a, b) => away(a) - away(b)).slice(0, 8);
    for (const t of held) {
      const pin = soft.addPin(t, 1, 0, 0);
      soft.pinPoint(pin, pin);
    }
    for (let i = 0; i < 90; i++) {
      hand.y += 0.012;
      piece.step(DT);
    }
    const now = { x: 0, y: 0, z: 0 };
    soft.pinPoint(hand, now);
    const pinned = { x: 0, y: 0, z: 0 };
    soft.pinPoint(soft.pins[1] as (typeof soft.pins)[number], pinned);
    expect(now.y - from.y).toBeGreaterThan(0.7);
    expect(now.y - pinned.y).toBeGreaterThan(0.5);
  });

  it('finds what a lifted wing was covering', () => {
    const { piece } = foldedRecipe('plane');
    const wing = outer(piece, false);
    const covered = piece.book.stackOf(wing).at(-2) as number;
    expect(piece.flapToLift(covered)).toBeNull();
    piece.peel(wing);
    expect(piece.flapToLift(covered)).not.toBeNull();
  });

  it('refuses to peel a flap with another layer on top of it', () => {
    const piece = new SheetPiece(sheet);
    foldAll(piece, line('x', 5), 1);
    const bottom = piece.book.faces.find((f) => piece.book.flipped[f] === 0 && piece.book.stackOf(f)[0] === f) as number;
    expect(piece.peel(bottom)).toBe(false);
  });
});

describe('locked paper', () => {
  /** A sheet folded in half, its top layer's free edge along x = 0, with the layer under it locked. */
  const halfWithBaseLocked = () => {
    const piece = new SheetPiece(sheet);
    foldAll(piece, line('x', 5), 1);
    const { book } = piece;
    piece.lock(book.faces.filter((f) => book.flipped[f] === 0), true);
    run(piece, 20);
    return piece;
  };
  /** The highest any of these faces rises, and the furthest they slide, since `before`. */
  const motion = (piece: SheetPiece, faces: readonly number[], before: Float64Array) => {
    const now = piece.corners();
    let rose = 0, slid = 0;
    for (const f of faces) {
      for (let k = 0; k < 3; k++) {
        const o = f * 9 + k * 3;
        rose = Math.max(rose, now[o + 1] as number);
        slid = Math.max(slid, Math.hypot((now[o] as number) - (before[o] as number), (now[o + 2] as number) - (before[o + 2] as number)));
      }
    }
    return { rose, slid };
  };

  it('keeps locked paper still with whatever lies on it, until a layer is lifted off', () => {
    const piece = halfWithBaseLocked();
    const held = (p: SheetPiece) => p.soft.mesh.triHeld.reduce((sum, h) => sum + h, 0);
    // The loose top layer lies pressed under the same hand.
    expect(piece.soft.mesh.triCount).toBe(400);
    expect(held(piece)).toBe(400);
    expect(piece.soft.mesh.inverseMass.every((w) => w === 0)).toBe(true);
    const top = piece.book.faces.find((f) => piece.book.flipped[f] === 1) as number;
    expect(piece.peel(top)).toBe(true);
    const { mesh } = piece.soft;
    expect(mesh.triCount).toBe(800);
    expect(held(piece)).toBe(400);
    // The lifted layer moves everywhere except along the crease it shares with locked paper.
    const free = new Set<number>(), still = new Set<number>();
    for (let t = 0; t < mesh.triCount; t++) {
      if (mesh.triHeld[t]) continue;
      for (let k = 0; k < 3; k++) {
        const v = mesh.tris[t * 3 + k] as number;
        (mesh.inverseMass[v] === 0 ? still : free).add(v);
      }
    }
    expect(still.size).toBe(21);
    expect(free.size).toBeGreaterThan(200);
  });

  it('lifts the top layer alone when the layer under it is locked', () => {
    const piece = halfWithBaseLocked();
    const { book } = piece;
    const base = book.faces.filter((f) => book.flipped[f] === 0);
    const edge = book.faces.find((f) => book.flipped[f] === 1 && (book.at[f * 6] as number) <= 1 && Math.abs((book.at[f * 6 + 1] as number) - m(5)) <= m(0.5)) as number;
    // Pulled by its free edge, with no fold lined up: the crease wants it shut, and nothing else holds the base.
    expect(piece.peel(edge)).toBe(true);
    const before = piece.corners();
    const { soft } = piece;
    const hand = soft.addPin(soft.mesh.faceTri[edge] as number, 1 / 3, 1 / 3, 1 / 3);
    for (let i = 0; i < 90; i++) {
      hand.y = Math.min(2.5, hand.y + 0.04);
      hand.x += 0.02;
      piece.step(DT);
    }
    const { rose, slid } = motion(piece, base, before);
    console.log('locked layer under a pulled top layer rises', rose.toFixed(3), 'm and slides', slid.toFixed(3), 'm; the top layer reaches', heights(piece).top.toFixed(2), 'm');
    expect(rose).toBeLessThan(0.05);
    expect(slid).toBeLessThan(0.001);
    expect(heights(piece).top).toBeGreaterThan(2);
    expect(piece.soft.stretch()).toBeLessThan(0.03);
  });

  it('presses paper flat on the table when it is locked mid-air, and the solver stays sound', () => {
    const piece = new SheetPiece(sheet);
    const { soft } = piece;
    // Lift a corner well up, then lock the paper around it while it hangs there.
    let corner = 0, best = Infinity;
    for (let t = 0; t < soft.mesh.triCount; t++) {
      const v = (soft.mesh.tris[t * 3] as number) * 2;
      const d = Math.hypot((soft.mesh.flat[v] as number) + 5, (soft.mesh.flat[v + 1] as number) + 5);
      if (d < best) {
        best = d;
        corner = t;
      }
    }
    const hand = soft.addPin(corner, 1 / 3, 1 / 3, 1 / 3);
    for (let i = 0; i < 60; i++) {
      hand.y = Math.min(2, hand.y + 0.05);
      piece.step(DT);
    }
    expect(heights(piece).top).toBeGreaterThan(1.5);
    const { book } = piece;
    const near = book.faces.filter((f) => (book.at[f * 6] as number) < m(3) && (book.at[f * 6 + 1] as number) < m(3));
    piece.lock(near, true);
    run(piece, 30);
    // Locked paper lies on the table, and nothing in the cloth has gone to NaN.
    const { rose } = motion(piece, near, piece.corners());
    expect(rose).toBeLessThan(sheet.thickness * 2);
    expect(piece.soft.x.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('refuses a fold that would move locked paper', () => {
    const piece = halfWithBaseLocked();
    expect(piece.plan({ line: line('z', 5), side: 1, seeds: piece.book.faces }).failure).toBe('held');
    expect(piece.fold({ line: line('z', 5), side: 1, seeds: piece.book.faces }).failure).toBe('held');
    expect(piece.book.tallest).toBe(2);
  });

  it('locks a pressed fold to the layers it lands on', () => {
    const piece = new SheetPiece(sheet);
    const plan = piece.fold({ line: line('x', 5), side: 1, seeds: piece.book.faces }, false, true);
    expect(plan.failure).toBeNull();
    // Folded in half, everything the flap moved and everything it now lies on.
    expect(piece.held.size).toBe(800);
    piece.lock(piece.book.faces, false);
    expect(piece.held.size).toBe(0);
    expect(piece.soft.mesh.triHeld.every((h) => h === 0)).toBe(true);
    expect(piece.soft.mesh.triCount).toBe(400);
  });

  it('stops a hand that pulls paper further than it reaches, instead of tearing it', () => {
    const piece = new SheetPiece(sheet);
    const { book } = piece;
    piece.lock(book.faces.filter((f) => (book.at[f * 6] as number) >= m(5) && (book.at[f * 6 + 2] as number) >= m(5) && (book.at[f * 6 + 4] as number) >= m(5)), true);
    const { soft } = piece;
    let near = 0, best = Infinity;
    for (let t = 0; t < soft.mesh.triCount; t++) {
      const v = (soft.mesh.tris[t * 3] as number) * 2;
      const d = Math.hypot((soft.mesh.flat[v] as number) + 1, soft.mesh.flat[v + 1] as number);
      if (!soft.mesh.triHeld[t] && d < best) {
        best = d;
        near = t;
      }
    }
    const hand = soft.addPin(near, 1 / 3, 1 / 3, 1 / 3);
    // Two metres from the locked half, dragged twelve metres away.
    for (let i = 0; i < 120; i++) {
      hand.x -= 0.1;
      hand.y = 1;
      piece.step(DT);
    }
    const paper = { x: 0, y: 0, z: 0 };
    soft.pinPoint(hand, paper);
    const ahead = Math.hypot(hand.heldX - paper.x, hand.heldY - paper.y, hand.heldZ - paper.z);
    console.log('hand dragged 12 m from locked paper: stretch', (soft.stretch() * 100).toFixed(1), '%, hand ahead of its paper by', ahead.toFixed(2), 'm');
    expect(soft.stretch()).toBeLessThan(0.05);
    expect(ahead).toBeLessThan(0.1);
  });

  it('keeps its locks when cut, each piece with its own', () => {
    const piece = new SheetPiece(sheet);
    const { book } = piece;
    piece.lock(book.faces.filter((f) => (book.at[f * 6 + 1] as number) < m(2)), true);
    const pieces = piece.cut(line('x', 5), 0, m(10));
    expect(pieces).toHaveLength(2);
    const total = pieces.reduce((sum, p) => sum + p.held.size, 0);
    expect(total).toBe(160);
    for (const p of pieces) expect(p.soft.mesh.triHeld.reduce((sum, h) => sum + h, 0)).toBe(p.held.size);
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

describe('bodies and hands', () => {
  it('lets soft paper pass through a body, so a sheet never fights whoever is in it', () => {
    // The same sweep twice, with a body standing in its way and without: the paper does the same.
    const sweep = (withBody: boolean) => {
      const piece = new SheetPiece(sheet);
      if (withBody) piece.bodies.push({ x: 0, z: 0, bottom: 0.15, top: 0.78, radius: 0.22 });
      const { soft } = piece;
      let corner = 0, best = Infinity;
      for (let t = 0; t < soft.mesh.triCount; t++) {
        const v = (soft.mesh.tris[t * 3] as number) * 2;
        const d = Math.hypot((soft.mesh.flat[v] as number) + 5, (soft.mesh.flat[v + 1] as number) + 5);
        if (d < best) {
          best = d;
          corner = t;
        }
      }
      const hand = soft.addPin(corner, 1 / 3, 1 / 3, 1 / 3);
      for (let i = 0; i < 150; i++) {
        const t = Math.min(1, i / 110);
        hand.x = -5 + t * 10;
        hand.z = -5 + t * 10;
        hand.y = 0.5;
        piece.step(DT);
      }
      return piece.soft.x;
    };
    const through = sweep(true), clear = sweep(false);
    let apart = 0;
    for (let i = 0; i < through.length; i++) apart = Math.max(apart, Math.abs((through[i] as number) - (clear[i] as number)));
    expect(apart).toBeLessThan(1e-9);
  });

  it('pushes hardened paper aside as one solid piece', () => {
    const piece = new SheetPiece(sheet);
    run(piece, 10);
    piece.harden(true);
    const body = { x: -5.6, z: 0, bottom: 0.15, top: 0.78, radius: 0.22 };
    piece.bodies.push(body);
    const westmost = () => Math.min(...Array.from(piece.soft.x).filter((_, i) => i % 3 === 0));
    const before = westmost();
    for (let i = 0; i < 60; i++) {
      body.x = -5.6 + (i / 59) * 1.2;
      piece.step(DT);
    }
    // Walked 0.8 m into the sheet's edge, the body has pushed it along.
    expect(westmost() - before).toBeGreaterThan(0.4);
    expect(piece.soft.stretch()).toBeLessThan(0.01);
  });

  it('keeps a body after the cloth is rebuilt by a fold', () => {
    const piece = new SheetPiece(sheet);
    piece.bodies.push({ x: 1, z: 1, bottom: 0.15, top: 0.78, radius: 0.22 });
    foldAll(piece, line('x', 5), 1);
    expect(piece.soft.bodies).toHaveLength(1);
  });

  it('slips a grip held at full strain, but not one that eases off', () => {
    const clock = new StrainClock();
    let slipped = false;
    for (let i = 0; i < 7; i++) slipped ||= clock.update(FULL_STRAIN, 0.1);
    expect(slipped).toBe(false);
    for (let i = 0; i < 5; i++) clock.update(0, 0.1);
    for (let i = 0; i < 7; i++) slipped ||= clock.update(FULL_STRAIN, 0.1);
    expect(slipped).toBe(false);
    for (let i = 0; i < 3; i++) slipped ||= clock.update(FULL_STRAIN * 2, 0.1);
    expect(slipped).toBe(true);
  });
});

describe('opening a fold back out', () => {
  it('lays the flap flat beside the paper it turns on, softer along the old crease', () => {
    const piece = new SheetPiece(sheet);
    foldAll(piece, line('x', 5), 1);
    run(piece, 20);
    const top = piece.book.faces.find((f) => piece.book.flipped[f] === 1 && piece.book.stackOf(f).at(-1) === f) as number;
    const plan = piece.unfold(top);
    expect(plan?.failure).toBeNull();
    expect(piece.book.tallest).toBe(1);
    expect(piece.soft.mesh.triCount).toBe(800);
    expect(piece.soft.mesh.hingeCreased.reduce((sum, h) => sum + h, 0)).toBeGreaterThan(10);
    run(piece, 60);
    let wide = -Infinity, narrow = Infinity;
    for (let i = 0; i < piece.soft.x.length; i += 3) {
      wide = Math.max(wide, piece.soft.x[i] as number);
      narrow = Math.min(narrow, piece.soft.x[i] as number);
    }
    // The whole 10 m width again, lying flat.
    expect(wide - narrow).toBeGreaterThan(9.8);
    expect(heights(piece).top).toBeLessThan(0.1);
  });

  it('draws the opened crease as a mark, and none on paper never folded', () => {
    const marked = (piece: SheetPiece) => {
      const view = new SheetView(piece);
      view.update();
      const count = view.group.children.filter((c) => c instanceof LineSegments).reduce((sum, c) => sum + ((c as LineSegments).geometry.getAttribute('position')?.count ?? 0), 0);
      view.dispose();
      return count;
    };
    const fresh = new SheetPiece(sheet);
    expect(marked(fresh)).toBe(0);
    const piece = new SheetPiece(sheet);
    foldAll(piece, line('x', 5), 1);
    const top = piece.book.faces.find((f) => piece.book.flipped[f] === 1 && piece.book.stackOf(f).at(-1) === f) as number;
    piece.unfold(top);
    expect(marked(piece)).toBeGreaterThan(0);
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
