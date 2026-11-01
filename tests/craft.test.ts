import { describe, expect, it } from 'vitest';
import type { SheetDefinition } from '@/core/asset/sheetTypes';
import { foldRequest, RECIPES } from '@/core/fold/recipes';
import type { CompleteStep, Recipe } from '@/core/fold/recipes';
import { SheetPiece } from '@/core/fold/SheetPiece';

const sheet: SheetDefinition = {
  id: 'sheet.test', name: 'Test', description: '', size: 10, cells: 20,
  top: 'vermilion', bottom: 'washi', edge: 'washi', thickness: 0.0034, density: 0.4, floppiness: 0.25,
};
const U = 12;

/** Runs a recipe on real paper, up to where it would be marked complete. */
function fold(id: string) {
  const recipe = RECIPES.find((r) => r.id === id) as Recipe;
  let piece = new SheetPiece(sheet);
  let wings = new Set<number>();
  for (const step of recipe.steps) {
    if (step.action === 'trim') {
      const pieces = piece.cut({ kind: step.kind, c: step.at * U }, step.from * U, step.to * U);
      piece = pieces.reduce((a, b) => (b.book.faces.length > a.book.faces.length ? b : a));
    } else if (step.action === 'fold') {
      const plan = piece.fold(foldRequest(piece.book, 10, step));
      expect(plan.failure).toBeNull();
      if (step.label.includes('wing')) wings = new Set([...wings, ...plan.moved]);
    }
  }
  return { piece, wings, finish: recipe.steps.find((step) => step.action === 'complete') as CompleteStep };
}

const heights = (piece: SheetPiece) => {
  const { x } = piece.soft;
  let low = Infinity, top = -Infinity;
  for (let i = 1; i < x.length; i += 3) {
    low = Math.min(low, x[i] as number);
    top = Math.max(top, x[i] as number);
  }
  return { low, top };
};

describe('marking a craft complete', () => {
  for (const id of ['plane', 'dart']) {
    it(`${id}: finds exactly its two wings, on one crease, as a mirrored pair`, () => {
      const { piece, wings } = fold(id);
      const joints = piece.complete();
      expect(joints).toHaveLength(2);
      const [a, b] = joints as [(typeof joints)[number], (typeof joints)[number]];
      expect(a.hinge).toBe(b.hinge);
      expect(a.hinge[0]).toBe('x');
      expect(a.side).not.toBe(b.side);
      expect(a.partner).toBe(1);
      expect(b.partner).toBe(0);
      expect(new Set([...a.faces, ...b.faces])).toEqual(wings);
    });

    it(`${id}: holds its length exactly at every angle, because plates do not stretch`, () => {
      const { piece } = fold(id);
      piece.complete();
      for (const angle of [0, 15, 90, 118, 150, 180]) {
        piece.setAngle(0, angle);
        piece.pose();
        expect(piece.soft.stretch()).toBeLessThan(1e-9);
        expect(heights(piece).low).toBeGreaterThanOrEqual(0);
      }
    });

    it(`${id}: leaves its folds untouched, and can go back to being folded`, () => {
      const { piece } = fold(id);
      const stacks = piece.book.tallest;
      piece.complete();
      piece.setAngle(0, 120);
      piece.pose();
      piece.reopen();
      expect(piece.completed).toBe(false);
      expect(piece.joints).toHaveLength(0);
      expect(piece.book.tallest).toBe(stacks);
      expect(piece.book.violations()).toBe(0);
      expect(heights(piece).top).toBeLessThan(0.2);
      piece.step(1 / 60);
      expect(piece.soft.stretch()).toBeLessThan(0.02);
    });
  }

  it('stands a plane on its keel, wings shut, with its body upright', () => {
    const { piece } = fold('plane');
    piece.complete();
    const { top, low } = heights(piece);
    expect(low).toBeLessThan(0.1);
    // Keel and wing hang from the crease, so it stands as tall as the wing is wide.
    expect(top - low).toBeGreaterThan(1.9);
    expect(top - low).toBeLessThan(2.1);
  });

  it('mirrors a wing, and can stop mirroring it', () => {
    const { piece } = fold('plane');
    piece.complete();
    piece.setAngle(0, 110);
    expect(piece.joints[1]?.angle).toBe(110);
    piece.setMirrored(0, false);
    piece.setAngle(1, 60);
    expect(piece.joints[0]?.angle).toBe(110);
    expect(piece.joints[1]?.angle).toBe(60);
    piece.setMirrored(1, true);
    expect(piece.joints[0]?.angle).toBe(60);
  });

  it('keeps an angle between shut and flat out', () => {
    const { piece } = fold('plane');
    piece.complete();
    piece.setAngle(0, 500);
    expect(piece.joints[0]?.angle).toBe(180);
    piece.setAngle(0, -20);
    expect(piece.joints[0]?.angle).toBe(0);
  });

  it('opens wings in a V above the crease', () => {
    const { piece } = fold('plane');
    piece.complete();
    piece.setAngle(0, 118);
    piece.pose();
    const { low, top } = heights(piece);
    // The keel is the low point, 1 m under the crease, and the tips stand over it.
    expect(top - low).toBeGreaterThan(1.8);
    expect(top - low).toBeLessThan(2);
  });

  it('turns only the wings: the body does not move when they open', () => {
    const { piece } = fold('plane');
    piece.complete();
    piece.setAngle(0, 90);
    piece.pose();
    const { mesh, x } = piece.soft;
    const before = x.slice();
    piece.setAngle(0, 140);
    piece.pose();
    const lifted = piece.lifted;
    const shift = (x[1] as number) - (before[1] as number);
    const hinge = (piece.joints[0] as { point: [number, number] }).point[0];
    for (const f of piece.book.faces) {
      if (lifted.has(f)) continue;
      for (let k = 0; k < 3; k++) {
        const v = mesh.cornerVertex[f * 3 + k] as number;
        if (mesh.flat[v * 2] === hinge) continue;
        expect((x[v * 3] as number)).toBeCloseTo(before[v * 3] as number, 9);
        expect((x[v * 3 + 2] as number)).toBeCloseTo(before[v * 3 + 2] as number, 9);
      }
    }
    expect(Number.isFinite(shift)).toBe(true);
  });

  it('does not simulate a finished craft', () => {
    const { piece } = fold('plane');
    piece.complete();
    piece.setAngle(0, 118);
    piece.pose();
    const before = piece.soft.x.slice();
    for (let i = 0; i < 30; i++) piece.step(1 / 60);
    expect(piece.soft.x).toEqual(before);
  });

  it('finds no joints on a plain sheet, and lets it lie where it is', () => {
    const piece = new SheetPiece(sheet);
    expect(piece.complete()).toHaveLength(0);
    expect(piece.completed).toBe(true);
    expect(heights(piece).top).toBeLessThan(0.01);
  });

  it('finds a recipe\'s wing from a point on it', () => {
    const { piece, finish } = fold('dart');
    piece.complete();
    expect(piece.jointNear(finish.at[0], finish.at[1])).toBeGreaterThanOrEqual(0);
  });
});
