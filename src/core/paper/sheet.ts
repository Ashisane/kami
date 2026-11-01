import { BufferGeometry, Float32BufferAttribute, Mesh, Shape, ShapeUtils, Vector2 } from 'three';
import { WORLD } from '../world';
import { paper } from './paperLibrary';
import type { StockId } from './stocks';

/**
 * A cut piece of paper with real thickness, lying flat in the XZ plane. It has
 * three material slots, because the look of origami depends on all three: a
 * coloured top, a usually pale reverse, and a bright cut edge.
 */
export interface SheetOptions {
  /** Printed face. */
  top: StockId;
  /** Reverse face. Defaults to washi, like real origami paper. */
  bottom?: StockId;
  /** Cut edge. Defaults to washi. */
  edge?: StockId;
  thickness?: number;
}

/** Outline points in sheet space: x is world x, y is world z. */
export function rect(minX: number, minZ: number, maxX: number, maxZ: number): Vector2[] {
  return [new Vector2(minX, minZ), new Vector2(maxX, minZ), new Vector2(maxX, maxZ), new Vector2(minX, maxZ)];
}

/** Builds indexed-free geometry with groups 0 = top, 1 = bottom, 2 = edge. */
export function sheetGeometry(outline: Vector2[] | Shape, thickness: number = WORLD.sheetThickness): BufferGeometry {
  const points = outline instanceof Shape ? outline.getPoints() : outline;
  // Shape.getPoints repeats the first point when the path is closed.
  const last = points[points.length - 1];
  const contour = last && points[0]?.equals(last) ? points.slice(0, -1) : [...points];
  if (ShapeUtils.isClockWise(contour)) contour.reverse();

  const half = thickness / 2;
  const triangles = ShapeUtils.triangulateShape(contour, []);
  const positions: number[] = [];
  const normals: number[] = [];

  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
  };

  // Contour counter-clockwise in (x, z) means +y faces need the reversed winding.
  for (const [a, b, c] of triangles) {
    for (const i of [c, b, a] as number[]) {
      const p = contour[i] as Vector2;
      push(p.x, half, p.y, 0, 1, 0);
    }
  }
  const topCount = positions.length / 3;

  for (const [a, b, c] of triangles) {
    for (const i of [a, b, c] as number[]) {
      const p = contour[i] as Vector2;
      push(p.x, -half, p.y, 0, -1, 0);
    }
  }
  const bottomCount = positions.length / 3 - topCount;

  for (let i = 0; i < contour.length; i++) {
    const p = contour[i] as Vector2;
    const q = contour[(i + 1) % contour.length] as Vector2;
    const nx = q.y - p.y;
    const nz = p.x - q.x;
    const length = Math.hypot(nx, nz) || 1;
    const n = [nx / length, 0, nz / length] as const;
    push(p.x, half, p.y, ...n);
    push(q.x, half, q.y, ...n);
    push(q.x, -half, q.y, ...n);
    push(p.x, half, p.y, ...n);
    push(q.x, -half, q.y, ...n);
    push(p.x, -half, p.y, ...n);
  }
  const edgeCount = positions.length / 3 - topCount - bottomCount;

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.addGroup(0, topCount, 0);
  geometry.addGroup(topCount, bottomCount, 1);
  geometry.addGroup(topCount + bottomCount, edgeCount, 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function sheet(name: string, outline: Vector2[] | Shape, options: SheetOptions): Mesh {
  const { top, bottom = 'washi', edge = 'washi', thickness } = options;
  const mesh = new Mesh(sheetGeometry(outline, thickness), [paper(top), paper(bottom), paper(edge)]);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
