/** A unit quaternion: x y z w. */
export type Quat = [number, number, number, number];

/**
 * Finds the rotation closest to a 3x3 matrix, updating `q` in place. Starts from
 * the previous answer, so it stays stable and quick frame to frame, and unlike
 * polar decomposition it survives flat point sets, which paper always is.
 * After Mueller et al. 2016, A Robust Method to Extract the Rotational Part of
 * Deformations. `m` holds the matrix column by column.
 */
export function extractRotation(m: Float64Array, q: Quat, iterations = 8): void {
  for (let n = 0; n < iterations; n++) {
    const [x, y, z, w] = q;
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y + z * w), r02 = 2 * (x * z - y * w);
    const r10 = 2 * (x * y - z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z + x * w);
    const r20 = 2 * (x * z + y * w), r21 = 2 * (y * z - x * w), r22 = 1 - 2 * (x * x + y * y);

    const a00 = m[0] as number, a01 = m[1] as number, a02 = m[2] as number;
    const a10 = m[3] as number, a11 = m[4] as number, a12 = m[5] as number;
    const a20 = m[6] as number, a21 = m[7] as number, a22 = m[8] as number;

    let ox = r01 * a02 - r02 * a01 + (r11 * a12 - r12 * a11) + (r21 * a22 - r22 * a21);
    let oy = r02 * a00 - r00 * a02 + (r12 * a10 - r10 * a12) + (r22 * a20 - r20 * a22);
    let oz = r00 * a01 - r01 * a00 + (r10 * a11 - r11 * a10) + (r20 * a21 - r21 * a20);
    const scale = 1 / (Math.abs(r00 * a00 + r01 * a01 + r02 * a02 + r10 * a10 + r11 * a11 + r12 * a12 + r20 * a20 + r21 * a21 + r22 * a22) + 1e-9);
    ox *= scale;
    oy *= scale;
    oz *= scale;

    const angle = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (angle < 1e-9) return;
    const s = Math.sin(angle / 2) / angle;
    const c = Math.cos(angle / 2);
    const dx = ox * s, dy = oy * s, dz = oz * s;
    const nx = c * x + dx * w + dy * z - dz * y;
    const ny = c * y - dx * z + dy * w + dz * x;
    const nz = c * z + dx * y - dy * x + dz * w;
    const nw = c * w - dx * x - dy * y - dz * z;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    q[0] = nx / length;
    q[1] = ny / length;
    q[2] = nz / length;
    q[3] = nw / length;
  }
}

/** Rotates (x, y, z) by `q` and writes it to `out` at `offset`, plus a translation. */
export function rotateInto(q: Quat, x: number, y: number, z: number, out: Float64Array, offset: number, tx: number, ty: number, tz: number): void {
  const [qx, qy, qz, qw] = q;
  const cx = 2 * (qy * z - qz * y);
  const cy = 2 * (qz * x - qx * z);
  const cz = 2 * (qx * y - qy * x);
  out[offset] = tx + x + qw * cx + qy * cz - qz * cy;
  out[offset + 1] = ty + y + qw * cy + qz * cx - qx * cz;
  out[offset + 2] = tz + z + qw * cz + qx * cy - qy * cx;
}
