import { describe, expect, it } from 'vitest';
import { FoldBook } from '@/core/fold/FoldBook';
import { layerHeights, platesOf } from '@/core/fold/levels';
import { UNITS_PER_CELL as U } from '@/core/fold/lattice';
import { RECIPES, runRecipe } from '@/core/fold/recipes';

const SIZE = 10;
const THICKNESS = 0.01;

const recipe = (id: string) => {
  const found = RECIPES.find((r) => r.id === id);
  if (!found) throw new Error(`no recipe ${id}`);
  return runRecipe(found, FoldBook.sheet(20), SIZE).book;
};

/** Height at a lattice point of a face, or undefined if the face does not touch it. */
const heightAt = (book: FoldBook, corner: Float32Array, f: number, x: number, z: number) => {
  for (let k = 0; k < 3; k++) {
    if (book.at[f * 6 + k * 2] === x && book.at[f * 6 + k * 2 + 1] === z) return corner[f * 3 + k] as number;
  }
  return undefined;
};

describe('how high layers really sit', () => {
  for (const { id, name } of RECIPES) {
    it(`${name}: every layer clears the one under it, at every corner`, () => {
      const book = recipe(id);
      const { corner } = layerHeights(book);
      for (const stack of book.stacks.values()) {
        for (let i = 1; i < stack.length; i++) {
          const low = stack[i - 1] as number, high = stack[i] as number;
          for (let k = 0; k < 3; k++) {
            const under = heightAt(book, corner, low, book.at[high * 6 + k * 2] as number, book.at[high * 6 + k * 2 + 1] as number);
            expect((corner[high * 3 + k] as number) - (under as number)).toBeGreaterThanOrEqual(1 - 1e-6);
          }
        }
      }
    });

    it(`${name}: flat paper has no seams`, () => {
      const book = recipe(id);
      const { corner } = layerHeights(book);
      const { plate } = platesOf(book);
      const seen = new Map<string, number>();
      for (const f of book.faces) {
        for (let k = 0; k < 3; k++) {
          const key = `${plate[f]}:${book.at[f * 6 + k * 2]}:${book.at[f * 6 + k * 2 + 1]}`;
          const h = corner[f * 3 + k] as number;
          expect(seen.get(key) ?? h).toBe(h);
          seen.set(key, h);
        }
      }
    });
  }

  it('leaves a single sheet at one layer', () => {
    const { top, corner } = layerHeights(FoldBook.sheet(20));
    expect(top).toBe(1);
    expect(Math.max(...corner)).toBe(0);
  });

  it('counts layers exactly on a plain fold', () => {
    const book = FoldBook.sheet(20);
    book.fold({ line: { kind: 'x', c: 5 * 2 * U }, side: 1, seeds: book.faces });
    expect(layerHeights(book).top).toBe(2);
  });

  it('keeps a whole folded plane thin, thick at the nose and pinched at the tail', () => {
    const book = recipe('plane');
    const { corner, top } = layerHeights(book);
    expect(top * THICKNESS).toBeLessThan(0.3);

    // Tail and nose of the same layer: the plate that lies on top of the tail.
    let tail = 0;
    let nose = 0;
    for (const f of book.faces) {
      for (let k = 0; k < 3; k++) {
        const z = (book.at[f * 6 + k * 2 + 1] as number) / 12;
        const h = (corner[f * 3 + k] as number) + 1;
        if (z >= 9.5) tail = Math.max(tail, h);
        if (z >= 5 && z <= 6) nose = Math.max(nose, h);
      }
    }
    expect(tail).toBeLessThanOrEqual(5);
    expect(nose).toBeGreaterThan(tail * 3);
  });

  it('settles quickly enough to run after every fold', () => {
    const book = recipe('plane');
    const start = performance.now();
    layerHeights(book);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
