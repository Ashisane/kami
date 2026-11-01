import { describe, expect, it } from 'vitest';
import { FoldBook } from '@/core/fold/FoldBook';
import { RECIPES, runRecipe } from '@/core/fold/recipes';

const SIZE = 10;
const metres = (book: FoldBook, f: number, k: number, axis: number) => ((book.at[f * 6 + k * 2 + axis] as number) * SIZE) / (book.cells * 6);

function bounds(book: FoldBook) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const f of book.faces) {
    for (let k = 0; k < 3; k++) {
      minX = Math.min(minX, metres(book, f, k, 0));
      maxX = Math.max(maxX, metres(book, f, k, 0));
      minZ = Math.min(minZ, metres(book, f, k, 1));
      maxZ = Math.max(maxZ, metres(book, f, k, 1));
    }
  }
  return { minX, maxX, minZ, maxZ };
}

describe('recipes', () => {
  for (const recipe of RECIPES) {
    it(`${recipe.name} folds without breaking the rules of paper`, () => {
      const { book, failure } = runRecipe(recipe, FoldBook.sheet(20), SIZE);
      expect(failure).toBeNull();
      expect(book.violations()).toBe(0);
    });
  }

  it('makes a Nakamura plane the length of the sheet and narrow in the body', () => {
    const plane = RECIPES.find((r) => r.id === 'plane');
    if (!plane) throw new Error('no plane recipe');
    const { book } = runRecipe(plane, FoldBook.sheet(20), SIZE);
    const box = bounds(book);
    console.log('plane', box, 'layers', book.tallest);
    expect(book.faces.length).toBeLessThan(800);
    expect(box.maxZ - box.minZ).toBeGreaterThan(5);
    expect(book.tallest).toBeGreaterThanOrEqual(6);
  });

  const boatUpTo = (steps: number) => {
    const boat = RECIPES.find((r) => r.id === 'boat');
    if (!boat) throw new Error('no boat recipe');
    return runRecipe({ ...boat, steps: boat.steps.slice(0, steps) }, FoldBook.sheet(20), SIZE).book;
  };
  /** Where a point of the flat sheet has ended up, in metres. */
  const placeOf = (book: FoldBook, x: number, z: number) => {
    for (const f of book.faces) {
      for (let k = 0; k < 3; k++) {
        if (book.rest[f * 6 + k * 2] === x * 12 && book.rest[f * 6 + k * 2 + 1] === z * 12) return [metres(book, f, k, 0), metres(book, f, k, 1)];
      }
    }
    throw new Error('no such point');
  };

  it('makes the hat of step 5, with a brim on both sides', () => {
    const box = bounds(boatUpTo(6));
    expect(box.maxX - box.minX).toBeCloseTo(8);
    expect(box.maxZ).toBeCloseTo(9);
    expect(box.minZ).toBeCloseTo(5);
  });

  it('opens the hat into the square of step 6, brim corners together', () => {
    const book = boatUpTo(7);
    const box = bounds(book);
    expect(box.maxX - box.minX).toBeCloseTo(4);
    expect(box.maxZ - box.minZ).toBeCloseTo(4);
    for (const [x, z] of [[0, 1], [8, 1], [0, 9], [8, 9]] as const) expect(placeOf(book, x, z)).toEqual([0, 9]);
    expect(placeOf(book, 4, 1)).not.toEqual(placeOf(book, 4, 9));
  });

  it('folds both bottom points up to the top, the triangle of step 8', () => {
    const book = boatUpTo(9);
    for (const [x, z] of [[0, 1], [8, 1], [0, 9], [8, 9]] as const) expect(placeOf(book, x, z)).toEqual(placeOf(book, 4, 5));
  });

  it('opens the triangle into the diamond of step 9, with its seam down the middle', () => {
    const book = boatUpTo(10);
    const box = bounds(book);
    expect(box.maxX - box.minX).toBeCloseTo(4);
    expect(box.maxZ - box.minZ).toBeCloseTo(4);
    expect(placeOf(book, 4, 1)).toEqual(placeOf(book, 4, 9));
    expect(book.violations()).toBe(0);
  });
});
