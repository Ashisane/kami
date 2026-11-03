import type { SheetPiece } from './SheetPiece';

/**
 * Finding points on living paper: what lies under a spot, what a hand can reach,
 * and where a held point sits on the flat sheet. Shared by everything that touches
 * paper, so a mouse and a being's hands find the same paper. No three.js.
 */

/** A point on the cloth: a triangle and where in it, by barycentric weights. */
export interface PaperPoint {
  tri: number;
  b0: number;
  b1: number;
  b2: number;
}

/** The face on top of a triangle's stack, or at its bottom when reaching from below. */
export function outerFace(piece: SheetPiece, tri: number, fromAbove = true): number {
  const { book, soft } = piece;
  let best = -1;
  let bestLayer = fromAbove ? -1 : Infinity;
  for (const f of book.faces) {
    if (soft.mesh.faceTri[f] !== tri) continue;
    const layer = book.layer[f] as number;
    if (fromAbove ? layer > bestLayer : layer < bestLayer) {
      best = f;
      bestLayer = layer;
    }
  }
  return best;
}

/** Where a point of the cloth sits on the flat, folded sheet, in metres. */
export function flatOf(piece: SheetPiece, point: PaperPoint): { x: number; z: number } {
  const { tris, flat } = piece.soft.mesh;
  const a = tris[point.tri * 3] as number, b = tris[point.tri * 3 + 1] as number, c = tris[point.tri * 3 + 2] as number;
  return {
    x: point.b0 * (flat[a * 2] as number) + point.b1 * (flat[b * 2] as number) + point.b2 * (flat[c * 2] as number),
    z: point.b0 * (flat[a * 2 + 1] as number) + point.b1 * (flat[b * 2 + 1] as number) + point.b2 * (flat[c * 2 + 1] as number),
  };
}

/** Barycentric weights of a flat point in a triangle, clamped into it. */
export function weightsIn(piece: SheetPiece, tri: number, point: { x: number; z: number }): [number, number, number] {
  const { tris, flat } = piece.soft.mesh;
  const a = (tris[tri * 3] as number) * 2, b = (tris[tri * 3 + 1] as number) * 2, c = (tris[tri * 3 + 2] as number) * 2;
  const ax = flat[a] as number, az = flat[a + 1] as number;
  const v0x = (flat[b] as number) - ax, v0z = (flat[b + 1] as number) - az;
  const v1x = (flat[c] as number) - ax, v1z = (flat[c + 1] as number) - az;
  const px = point.x - ax, pz = point.z - az;
  const det = v0x * v1z - v1x * v0z || 1;
  const u = Math.min(1, Math.max(0, (px * v1z - v1x * pz) / det));
  const v = Math.min(1 - u, Math.max(0, (v0x * pz - px * v0z) / det));
  return [1 - u - v, u, v];
}

/** Where a point of the cloth is in the world right now. */
export function worldOf(piece: SheetPiece, point: PaperPoint, out: { x: number; y: number; z: number }): void {
  const { tris } = piece.soft.mesh;
  const x = piece.soft.x;
  const a = (tris[point.tri * 3] as number) * 3, b = (tris[point.tri * 3 + 1] as number) * 3, c = (tris[point.tri * 3 + 2] as number) * 3;
  out.x = point.b0 * (x[a] as number) + point.b1 * (x[b] as number) + point.b2 * (x[c] as number);
  out.y = point.b0 * (x[a + 1] as number) + point.b1 * (x[b + 1] as number) + point.b2 * (x[c + 1] as number);
  out.z = point.b0 * (x[a + 2] as number) + point.b1 * (x[b + 2] as number) + point.b2 * (x[c + 2] as number);
}

/** How much nearer folded paper counts as, in metres: by a flap's edge, a hand means the flap. */
const FOLDED_PULL = 0.2;

/**
 * The paper nearest a point within a reach: what a hand closing there would take
 * hold of. Folded paper counts as a little nearer, so a hand by a flap's edge takes
 * the flap, not the single sheet just past it, and of layers lying together the top
 * one wins. Searches each triangle's closest point.
 */
export function nearestPaper(piece: SheetPiece, at: { x: number; y: number; z: number }, reach: number): (PaperPoint & { distance: number }) | null {
  const { tris, triCount, triLayers } = piece.soft.mesh;
  let bestScore = Infinity;
  const x = piece.soft.x;
  let best: (PaperPoint & { distance: number }) | null = null;
  const p = [0, 0, 0], q = [0, 0, 0], r = [0, 0, 0];
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = (tris[t * 3 + k] as number) * 3;
      const target = k === 0 ? p : k === 1 ? q : r;
      target[0] = x[v] as number;
      target[1] = x[v + 1] as number;
      target[2] = x[v + 2] as number;
    }
    const [b0, b1, b2] = closestOnTriangle(at, p, q, r);
    const cx = b0 * (p[0] as number) + b1 * (q[0] as number) + b2 * (r[0] as number);
    const cy = b0 * (p[1] as number) + b1 * (q[1] as number) + b2 * (r[1] as number);
    const cz = b0 * (p[2] as number) + b1 * (q[2] as number) + b2 * (r[2] as number);
    const distance = Math.hypot(cx - at.x, cy - at.y, cz - at.z);
    if (distance > reach) continue;
    const score = distance - ((triLayers[t] as number) > 1 ? FOLDED_PULL : 0);
    // Within a few centimetres, layers of one stack tie: the higher one is on top.
    if (!best || score < bestScore - 0.03 || (score < bestScore + 0.03 && cy > highest(piece, best))) {
      best = { tri: t, b0, b1, b2, distance };
      bestScore = score;
    }
  }
  return best;
}

function highest(piece: SheetPiece, point: PaperPoint): number {
  const out = { x: 0, y: 0, z: 0 };
  worldOf(piece, point, out);
  return out.y;
}

/** The paper directly under a ground spot, and how high it lies there, or null if none. */
export function paperUnder(piece: SheetPiece, x: number, z: number): (PaperPoint & { y: number }) | null {
  const { tris, triCount } = piece.soft.mesh;
  const s = piece.soft.x;
  let best: (PaperPoint & { y: number }) | null = null;
  for (let t = 0; t < triCount; t++) {
    const a = (tris[t * 3] as number) * 3, b = (tris[t * 3 + 1] as number) * 3, c = (tris[t * 3 + 2] as number) * 3;
    const ax = s[a] as number, az = s[a + 2] as number;
    const v0x = (s[b] as number) - ax, v0z = (s[b + 2] as number) - az;
    const v1x = (s[c] as number) - ax, v1z = (s[c + 2] as number) - az;
    const det = v0x * v1z - v1x * v0z;
    if (Math.abs(det) < 1e-9) continue;
    const px = x - ax, pz = z - az;
    const u = (px * v1z - v1x * pz) / det, v = (v0x * pz - px * v0z) / det;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const y = (1 - u - v) * (s[a + 1] as number) + u * (s[b + 1] as number) + v * (s[c + 1] as number);
    // The lowest paper there is what lies on the ground.
    if (!best || y < best.y) best = { tri: t, b0: 1 - u - v, b1: u, b2: v, y };
  }
  return best;
}

/** Barycentric weights of the point of a triangle closest to a point (Ericson, Real-Time Collision Detection). */
function closestOnTriangle(at: { x: number; y: number; z: number }, a: number[], b: number[], c: number[]): [number, number, number] {
  const ab = [(b[0] as number) - (a[0] as number), (b[1] as number) - (a[1] as number), (b[2] as number) - (a[2] as number)];
  const ac = [(c[0] as number) - (a[0] as number), (c[1] as number) - (a[1] as number), (c[2] as number) - (a[2] as number)];
  const ap = [at.x - (a[0] as number), at.y - (a[1] as number), at.z - (a[2] as number)];
  const dot = (u: number[], v: number[]) => (u[0] as number) * (v[0] as number) + (u[1] as number) * (v[1] as number) + (u[2] as number) * (v[2] as number);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = [at.x - (b[0] as number), at.y - (b[1] as number), at.z - (b[2] as number)];
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const cp = [at.x - (c[0] as number), at.y - (c[1] as number), at.z - (c[2] as number)];
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [1 - w, 0, w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [0, 1 - w, w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return [1 - v - w, v, w];
}
