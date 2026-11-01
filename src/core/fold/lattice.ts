/**
 * The tetrakis lattice all paper lives on.
 *
 * A square sheet is split into half-cells, each cut along one diagonal, with the
 * diagonals alternating. Every edge of that tiling lies on a straight mirror
 * line, and reflecting across any of them maps the tiling exactly onto itself.
 * That single property is why folding can be exact: a folded face always lands
 * precisely on another lattice triangle, called a site.
 *
 * Coordinates are integers. Six units per half-cell keeps triangle centres whole
 * too, so no fold ever accumulates rounding error.
 */
export const UNITS_PER_CELL = 6;

export type LineKind = 'x' | 'z' | 'sum' | 'diff';

/** A mirror line: x = c, z = c, x + z = c, or x - z = c, in lattice units. */
export interface MirrorLine {
  kind: LineKind;
  c: number;
}

export function sideOf(line: MirrorLine, x: number, z: number): number {
  switch (line.kind) {
    case 'x':
      return x - line.c;
    case 'z':
      return z - line.c;
    case 'sum':
      return x + z - line.c;
    case 'diff':
      return x - z - line.c;
  }
}

export function reflectX(line: MirrorLine, x: number, z: number): number {
  switch (line.kind) {
    case 'x':
      return 2 * line.c - x;
    case 'z':
      return x;
    case 'sum':
      return line.c - z;
    case 'diff':
      return z + line.c;
  }
}

export function reflectZ(line: MirrorLine, x: number, z: number): number {
  switch (line.kind) {
    case 'x':
      return z;
    case 'z':
      return 2 * line.c - z;
    case 'sum':
      return line.c - x;
    case 'diff':
      return x - line.c;
  }
}

/** Axis lines fall on every half-cell. Diagonals only run through every other lattice point. */
export function isMirror({ kind, c }: MirrorLine): boolean {
  if (c % UNITS_PER_CELL !== 0) return false;
  return kind === 'x' || kind === 'z' || (c / UNITS_PER_CELL) % 2 === 0;
}

/** The unit vector a line reflects along, in lattice space. */
export function lineNormal(kind: LineKind): readonly [number, number] {
  const d = Math.SQRT1_2;
  switch (kind) {
    case 'x':
      return [1, 0];
    case 'z':
      return [0, 1];
    case 'sum':
      return [d, d];
    case 'diff':
      return [d, -d];
  }
}

const SITE_OFFSET = 1 << 16;
const SITE_SCALE = 1 << 17;

/** A lattice triangle's id, from the sum of its corners. Reflections keep these exact. */
export const siteKey = (sumX: number, sumZ: number): number => (sumX + SITE_OFFSET) * SITE_SCALE + (sumZ + SITE_OFFSET);

export interface Tiling {
  /** Half-cells per side. */
  cells: number;
  /** Corner coordinates, six numbers per triangle: x0 z0 x1 z1 x2 z2. */
  corners: Int32Array;
  count: number;
}

/** Builds the tiling for a sheet of `cells` half-cells per side. */
export function buildTiling(cells: number): Tiling {
  const corners: number[] = [];
  const u = UNITS_PER_CELL;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const ax = i * u, az = j * u;
      const bx = (i + 1) * u, bz = j * u;
      const cx = (i + 1) * u, cz = (j + 1) * u;
      const dx = i * u, dz = (j + 1) * u;
      if ((i + j) % 2 === 0) corners.push(ax, az, cx, cz, bx, bz, ax, az, dx, dz, cx, cz);
      else corners.push(ax, az, dx, dz, bx, bz, bx, bz, dx, dz, cx, cz);
    }
  }
  return { cells, corners: Int32Array.from(corners), count: corners.length / 6 };
}
