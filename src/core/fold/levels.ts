import type { FoldBook } from './FoldBook';

/**
 * How high every layer really sits. A stack's order only compares faces on one
 * site, but paper is continuous: a flap is one sheet whether it lies over two
 * layers or twenty, and it slopes down off a thick stack instead of stepping.
 * So heights are worked out across the paper: every layer clears whatever lies
 * under it, a sheet can only climb so steeply, and otherwise paper lies as low
 * as it can. That is what pinches a plane's tail shut behind its thick nose.
 */
export interface LayerHeights {
  /** Height of each face corner, in layers: index by face * 3 + corner. */
  corner: Float32Array;
  /** Height of the very top of the paper, in layers. */
  top: number;
}

/** Layers a sheet can climb per lattice unit: six per grid cell. */
const SLOPE = 1;

/** Numbers each flat plate of paper: faces joined with no crease and no cut. */
export function platesOf(book: FoldBook): { plate: Int32Array; count: number } {
  const plate = new Int32Array(book.faceCount).fill(-1);
  let count = 0;
  for (const start of book.faces) {
    if ((plate[start] as number) >= 0) continue;
    const id = count++;
    plate[start] = id;
    const todo = [start];
    while (todo.length) {
      const f = todo.pop() as number;
      for (let k = 0; k < 3; k++) {
        const g = book.neighbour[f * 3 + k] as number;
        if (g < 0 || (plate[g] as number) >= 0 || book.edgeBlocked(f, k) || book.flipped[g] !== book.flipped[f]) continue;
        plate[g] = id;
        todo.push(g);
      }
    }
  }
  return { plate, count };
}

export function layerHeights(book: FoldBook): LayerHeights {
  const { at } = book;
  const { plate, count: plates } = platesOf(book);

  // One height per point of a plate, so a flat sheet has no seams.
  const span = book.span + 1;
  const points = new Map<number, number>();
  const cornerPoint = new Int32Array(book.faceCount * 3).fill(-1);
  for (const f of book.faces) {
    for (let k = 0; k < 3; k++) {
      const key = ((plate[f] as number) * span + (at[f * 6 + k * 2] as number)) * span + (at[f * 6 + k * 2 + 1] as number);
      let id = points.get(key);
      if (id === undefined) {
        id = points.size;
        points.set(key, id);
      }
      cornerPoint[f * 3 + k] = id;
    }
  }

  // Every rule reads: `to` stands at least `rise` above `from`.
  const from: number[] = [];
  const to: number[] = [];
  const rise: number[] = [];
  const rule = (a: number, b: number, r: number) => {
    from.push(a);
    to.push(b);
    rise.push(r);
  };
  for (const stack of book.stacks.values()) {
    for (let i = 1; i < stack.length; i++) {
      const low = stack[i - 1] as number, high = stack[i] as number;
      for (let k = 0; k < 3; k++) {
        for (let j = 0; j < 3; j++) {
          if (at[high * 6 + k * 2] === at[low * 6 + j * 2] && at[high * 6 + k * 2 + 1] === at[low * 6 + j * 2 + 1]) {
            rule(cornerPoint[low * 3 + j] as number, cornerPoint[high * 3 + k] as number, 1);
          }
        }
      }
    }
  }
  for (const f of book.faces) {
    for (let k = 0; k < 3; k++) {
      const n = (k + 1) % 3;
      const a = cornerPoint[f * 3 + k] as number, b = cornerPoint[f * 3 + n] as number;
      const length = Math.hypot((at[f * 6 + k * 2] as number) - (at[f * 6 + n * 2] as number), (at[f * 6 + k * 2 + 1] as number) - (at[f * 6 + n * 2 + 1] as number));
      rule(a, b, -SLOPE * length);
      rule(b, a, -SLOPE * length);
    }
  }

  // Raise points until every rule holds. Flaps can tuck into a true cycle that no
  // height satisfies, so the ceiling is what guarantees this ends.
  const height = new Float64Array(points.size);
  const ceiling = plates + 1;
  for (let changed = true; changed; ) {
    changed = false;
    for (let r = 0; r < rise.length; r++) {
      const b = to[r] as number;
      const wanted = Math.min(ceiling, (height[from[r] as number] as number) + (rise[r] as number));
      if ((height[b] as number) < wanted) {
        height[b] = wanted;
        changed = true;
      }
    }
  }

  const corner = new Float32Array(book.faceCount * 3);
  let top = 1;
  for (const f of book.faces) {
    for (let k = 0; k < 3; k++) {
      const h = height[cornerPoint[f * 3 + k] as number] as number;
      corner[f * 3 + k] = h;
      top = Math.max(top, h + 1);
    }
  }
  return { corner, top };
}
