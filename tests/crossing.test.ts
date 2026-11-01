import { describe, expect, it } from 'vitest';
import type { SheetDefinition } from '@/core/asset/sheetTypes';
import { SheetPiece } from '@/core/fold/SheetPiece';
import { countCrossings } from '@/core/fold/soft/crossings';
import type { Pin } from '@/core/fold/soft/SoftSheet';

const sheet: SheetDefinition = {
  id: 'sheet.test', name: 'Test', description: '', size: 10, cells: 20,
  top: 'vermilion', bottom: 'washi', edge: 'washi', thickness: 0.01, density: 0.4, floppiness: 0.25,
};
const DT = 1 / 60;

const vertexAt = (piece: SheetPiece, x: number, z: number) => {
  const { flat } = piece.soft.mesh;
  let best = 0, distance = Infinity;
  for (let v = 0; v < flat.length / 2; v++) {
    const d = Math.hypot((flat[v * 2] as number) - x, (flat[v * 2 + 1] as number) - z);
    if (d < distance) {
      distance = d;
      best = v;
    }
  }
  return best;
};

function pinAt(piece: SheetPiece, x: number, z: number): Pin {
  const { soft } = piece;
  const v = vertexAt(piece, x, z);
  for (let t = 0; t < soft.mesh.triCount; t++) {
    for (let k = 0; k < 3; k++) {
      if (soft.mesh.tris[t * 3 + k] === v) {
        const pin = soft.addPin(t, k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
        soft.pinPoint(pin, pin);
        return pin;
      }
    }
  }
  throw new Error('no triangle at that point');
}

/** Moves a pin in a straight line, tracking the worst crossing count on the way. */
function haul(piece: SheetPiece, pin: Pin, to: [number, number, number], frames: number, worst: { count: number }) {
  const from = [pin.x, pin.y, pin.z] as const;
  for (let f = 1; f <= frames; f++) {
    const k = f / frames;
    pin.x = from[0] + (to[0] - from[0]) * k;
    pin.y = from[1] + (to[1] - from[1]) * k;
    pin.z = from[2] + (to[2] - from[2]) * k;
    piece.step(DT);
    if (f % 4 === 0) worst.count = Math.max(worst.count, countCrossings(piece.soft.mesh, piece.soft.x));
  }
}

describe('paper does not pass through itself', () => {
  const scenarios: [string, (piece: SheetPiece, worst: { count: number }) => void][] = [
    ['edge pulled across, anchored', (piece, worst) => {
      pinAt(piece, 4.5, -4.5);
      pinAt(piece, 4.5, 4.5);
      const hand = pinAt(piece, -4.5, 0);
      haul(piece, hand, [-1, 2.4, 0], 40, worst);
      haul(piece, hand, [4.5, 1.2, 0], 50, worst);
      haul(piece, hand, [4.5, 0.3, 0], 40, worst);
    }],
    ['corner yanked fast', (piece, worst) => {
      pinAt(piece, 4.5, 4.5);
      const hand = pinAt(piece, -5, -5);
      haul(piece, hand, [3, 1, 3], 24, worst);
      haul(piece, hand, [-3, 2, 3], 24, worst);
      haul(piece, hand, [3, 0.4, -3], 24, worst);
    }],
    ['sheet bunched from the middle', (piece, worst) => {
      const hand = pinAt(piece, 0, 0);
      haul(piece, hand, [0, 5, 0], 50, worst);
      haul(piece, hand, [0, 0.4, 0], 30, worst);
      for (let i = 0; i < 40; i++) {
        piece.step(DT);
        if (i % 4 === 0) worst.count = Math.max(worst.count, countCrossings(piece.soft.mesh, piece.soft.x));
      }
    }],
  ];

  for (const [name, run] of scenarios) {
    it(name, () => {
      const piece = new SheetPiece(sheet);
      const worst = { count: 0 };
      run(piece, worst);
      const start = performance.now();
      for (let i = 0; i < 30; i++) piece.step(DT);
      const ms = (performance.now() - start) / 30;
      console.log(`${name}: worst ${worst.count} crossings, ${(piece.soft.stretch() * 100).toFixed(1)}% stretch, ${ms.toFixed(1)} ms per step, ${piece.soft.contacts} contacts`);
      expect(worst.count).toBeLessThanOrEqual(8);
    });
  }
});
