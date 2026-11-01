import type { SoftMesh } from './softMesh';

/**
 * Counts places where paper has gone through itself, by testing every triangle's
 * edges against nearby triangles. Too slow to run per frame in a game, and only
 * meant for tests and the lab, where it turns "it looks glitchy" into a number.
 */
export function countCrossings(mesh: SoftMesh, x: Float64Array): number {
  const { tris, triCount } = mesh;
  const cell = Math.max(...mesh.edgeLength) * 1.1;
  const key = (i: number, j: number, k: number) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  const grid = new Map<number, number[]>();
  const centres = new Float64Array(triCount * 3);

  for (let t = 0; t < triCount; t++) {
    for (let axis = 0; axis < 3; axis++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += x[(tris[t * 3 + k] as number) * 3 + axis] as number;
      centres[t * 3 + axis] = sum / 3;
    }
    const k = key(Math.floor((centres[t * 3] as number) / cell), Math.floor((centres[t * 3 + 1] as number) / cell), Math.floor((centres[t * 3 + 2] as number) / cell));
    const list = grid.get(k);
    if (list) list.push(t);
    else grid.set(k, [t]);
  }

  const point = (v: number): [number, number, number] => [x[v * 3] as number, x[v * 3 + 1] as number, x[v * 3 + 2] as number];
  const shares = (a: number, b: number) => {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (tris[a * 3 + i] === tris[b * 3 + j]) return true;
    return false;
  };

  let crossings = 0;
  for (let t = 0; t < triCount; t++) {
    const ix = Math.floor((centres[t * 3] as number) / cell), iy = Math.floor((centres[t * 3 + 1] as number) / cell), iz = Math.floor((centres[t * 3 + 2] as number) / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const o of grid.get(key(ix + dx, iy + dy, iz + dz)) ?? []) {
            if (o === t || shares(t, o)) continue;
            const a = point(tris[o * 3] as number), b = point(tris[o * 3 + 1] as number), c = point(tris[o * 3 + 2] as number);
            for (let k = 0; k < 3; k++) {
              const p = point(tris[t * 3 + k] as number), q = point(tris[t * 3 + (k + 1) % 3] as number);
              if (segmentHitsTriangle(p, q, a, b, c)) crossings++;
            }
          }
        }
      }
    }
  }
  return crossings;
}

type Vec = [number, number, number];

function segmentHitsTriangle(p: Vec, q: Vec, a: Vec, b: Vec, c: Vec): boolean {
  const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
  const fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const hx = dy * fz - dz * fy, hy = dz * fx - dx * fz, hz = dx * fy - dy * fx;
  const det = ex * hx + ey * hy + ez * hz;
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const sx = p[0] - a[0], sy = p[1] - a[1], sz = p[2] - a[2];
  const u = inv * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return false;
  const qx = sy * ez - sz * ey, qy = sz * ex - sx * ez, qz = sx * ey - sy * ex;
  const v = inv * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return false;
  const t = inv * (fx * qx + fy * qy + fz * qz);
  return t >= 0 && t <= 1;
}
