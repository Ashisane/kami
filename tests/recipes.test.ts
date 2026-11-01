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

  it('makes a hat with a brim on both sides', () => {
    const hat = RECIPES.find((r) => r.id === 'hat');
    if (!hat) throw new Error('no hat recipe');
    const { book } = runRecipe(hat, FoldBook.sheet(20), SIZE);
    const box = bounds(book);
    expect(box.maxX - box.minX).toBeCloseTo(8);
    expect(box.maxZ).toBeCloseTo(9);
    expect(box.minZ).toBeCloseTo(5);
  });
});
