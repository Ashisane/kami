import { describe, expect, it } from 'vitest';
import type { SheetDefinition } from '@/core/asset/sheetTypes';
import { guessFold } from '@/core/fold/foldGuide';
import { SheetPiece } from '@/core/fold/SheetPiece';

const sheet: SheetDefinition = {
  id: 'sheet.test', name: 'Test', description: '', size: 10, cells: 20,
  top: 'vermilion', bottom: 'washi', edge: 'washi', thickness: 0.0034, density: 0.4, floppiness: 0.25,
};
/** Flat metres from the sheet's first corner to the centred coordinates the guide reads. */
const at = (x: number, z: number) => ({ x: x - 5, z: z - 5 });
const lineAt = (piece: SheetPiece, from: [number, number], to: [number, number]) => {
  const guess = guessFold(piece, at(...from), at(...to));
  return guess ? (guess.line.c * 10) / (piece.book.cells * 6) : null;
};

describe('the fold guide', () => {
  it('locks onto the middle when the pull is roughly there', () => {
    const piece = new SheetPiece(sheet);
    expect(lineAt(piece, [0.2, 5], [9.4, 5])).toBe(5);
  });

  it('still reaches the line beside the middle', () => {
    const piece = new SheetPiece(sheet);
    // Halfway is 5.5: half a metre off the middle, one step over.
    expect(lineAt(piece, [1, 5], [10, 5])).toBe(5.5);
  });

  it('lets a plane folded in half take its wing crease beside the middle', () => {
    // Cut to the plane's 6 m, then folded in half: 3 m wide, its middle at 1.5.
    const pieces = new SheetPiece(sheet).cut({ kind: 'x', c: 72 }, 0, 120);
    const piece = pieces.reduce((a, b) => (b.book.faces.length > a.book.faces.length ? b : a));
    expect(piece.fold({ line: { kind: 'x', c: 36 }, side: 1, seeds: piece.book.faces }).failure).toBeNull();
    expect(lineAt(piece, [0.2, 8], [2.8, 8])).toBe(1.5);
    // The wing crease is at 2, one step over.
    expect(lineAt(piece, [0.5, 8], [3.5, 8])).toBe(2);
  });
});
