import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, Quaternion, Vector3 } from 'three';
import type { Group, Material } from 'three';
import { fold as foldEase, spring } from '../anim/easing';
import { paper } from '../paper/paperLibrary';
import type { SheetPiece } from '../fold/SheetPiece';
import { cornerOffset } from '../fold/soft/softMesh';

const DROP_SECONDS = 0.38;
const SWING_SECONDS = 0.8;
const dropEase = spring(2.2, 0.42);
const swingEase = foldEase(0.14, 0.05, 1.1);
const HANDOVER_FROM = 0.72;

/**
 * The moved faces, drawn apart for the moment a fold takes. The Book and cloth
 * change instantly; this flap is what the eye sees travel, so a fold reads as
 * paper rotating over, not as a shape popping into place.
 */
export class SwingFlap {
  private mesh: Mesh | null = null;
  private positions = new BufferAttribute(new Float32Array(0), 3);
  private normals = new BufferAttribute(new Float32Array(0), 3);
  private faces: number[] = [];
  private from: Float64Array = new Float64Array(0);
  private time = 0;
  private duration = 0;
  private axis: { origin: Vector3; direction: Vector3; angle: number } | null = null;
  private readonly materials: Material[];
  private readonly rotation = new Quaternion();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();
  private readonly n = new Vector3();
  private readonly offset = new Vector3();

  /** Faces hidden from the sheet while the flap stands in for them. */
  hidden: ReadonlySet<number> = new Set();

  constructor(
    private readonly piece: SheetPiece,
    private readonly parent: Group,
  ) {
    const { top, bottom } = piece.definition;
    this.materials = [paper(top, { sheet: true }), paper(bottom, { sheet: true })];
  }

  get active(): boolean {
    return this.mesh !== null;
  }

  /**
   * Starts the flap from where the faces were. Pass an axis to swing them round
   * the crease, or none when a player has already carried them most of the way.
   */
  start(moved: ReadonlySet<number>, before: Float64Array, axis: { origin: Vector3; direction: Vector3; angle: number } | null): void {
    this.clear();
    this.hidden = moved;
    this.faces = [...moved];
    this.from = before;
    this.axis = axis;
    this.time = 0;
    this.duration = axis ? SWING_SECONDS : DROP_SECONDS;

    const { book, unit } = this.piece;
    const count = this.faces.length * 6;
    const uv = new Float32Array(count * 2);
    this.faces.forEach((f, i) => {
      for (let side = 0; side < 2; side++) {
        for (let k = 0; k < 3; k++) {
          const o = (i * 6 + side * 3 + k) * 2;
          uv[o] = ((book.rest[f * 6 + k * 2] as number) - book.span / 2) * unit;
          uv[o + 1] = ((book.rest[f * 6 + k * 2 + 1] as number) - book.span / 2) * unit;
        }
      }
    });
    const geometry = new BufferGeometry();
    this.positions = new BufferAttribute(new Float32Array(count * 3), 3);
    this.normals = new BufferAttribute(new Float32Array(count * 3), 3);
    this.positions.setUsage(DynamicDrawUsage);
    this.normals.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('normal', this.normals);
    geometry.setAttribute('paperUv', new BufferAttribute(uv, 2));
    const faces = this.faces.length;
    const index: number[] = [];
    for (let f = 0; f < faces; f++) {
      const o = f * 6;
      index.push(o, o + 1, o + 2);
    }
    for (let f = 0; f < faces; f++) {
      const o = f * 6 + 3;
      index.push(o, o + 2, o + 1);
    }
    geometry.setIndex(index);
    geometry.addGroup(0, faces * 3, 0);
    geometry.addGroup(faces * 3, faces * 3, 1);
    this.mesh = new Mesh(geometry, this.materials);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.parent.add(this.mesh);
  }

  /** Advances the flap. Returns true on the frame it lands. */
  update(dt: number): boolean {
    if (!this.mesh) return false;
    this.time += dt;
    const k = Math.min(1, this.time / this.duration);
    const after = this.piece.corners();
    const thickness = this.piece.definition.thickness;
    const handover = this.axis ? Math.max(0, (k - HANDOVER_FROM) / (1 - HANDOVER_FROM)) : dropEase(k);
    const blend = this.axis ? handover * handover * (3 - 2 * handover) : handover;
    if (this.axis) this.rotation.setFromAxisAngle(this.axis.direction, this.axis.angle * swingEase(k));

    const out = this.positions.array as Float32Array, normals = this.normals.array as Float32Array;
    const { mesh } = this.piece.soft;
    const place = (from: number, target: Vector3, height: number) => {
      target.set(this.from[from] as number, this.from[from + 1] as number, this.from[from + 2] as number);
      if (this.axis) target.sub(this.axis.origin).applyQuaternion(this.rotation).add(this.axis.origin);
      target.x += ((after[from] as number) - target.x) * blend;
      target.y += ((after[from + 1] as number) + height - target.y) * blend;
      target.z += ((after[from + 2] as number) - target.z) * blend;
    };

    this.faces.forEach((f, i) => {
      const o = f * 9;
      // Lands on the layer it will really be, so nothing jumps at the handover.
      place(o, this.a, cornerOffset(mesh, f, 0, thickness));
      place(o + 3, this.b, cornerOffset(mesh, f, 1, thickness));
      place(o + 6, this.c, cornerOffset(mesh, f, 2, thickness));
      this.n.copy(this.b).sub(this.a).cross(this.offset.copy(this.c).sub(this.a)).normalize();
      // Corners run the same way round as the flat sheet, so this points to the printed side.
      const sign = this.windingSign(f);
      this.n.multiplyScalar(sign);
      this.offset.copy(this.n).multiplyScalar(thickness * 0.5);
      for (let side = 0; side < 2; side++) {
        const s = side === 0 ? 1 : -1;
        const first = i * 6 + side * 3;
        [this.a, this.b, this.c].forEach((p, c) => {
          const j = (first + c) * 3;
          out[j] = p.x + this.offset.x * s;
          out[j + 1] = p.y + this.offset.y * s;
          out[j + 2] = p.z + this.offset.z * s;
          normals[j] = this.n.x * s;
          normals[j + 1] = this.n.y * s;
          normals[j + 2] = this.n.z * s;
        });
      }
    });
    this.positions.needsUpdate = true;
    this.normals.needsUpdate = true;

    if (k >= 1) {
      this.clear();
      return true;
    }
    return false;
  }

  /** +1 if a face's corner order already faces its printed side at rest. */
  private windingSign(f: number): number {
    const { rest } = this.piece.book;
    const ux = (rest[f * 6 + 2] as number) - (rest[f * 6] as number), uz = (rest[f * 6 + 3] as number) - (rest[f * 6 + 1] as number);
    const vx = (rest[f * 6 + 4] as number) - (rest[f * 6] as number), vz = (rest[f * 6 + 5] as number) - (rest[f * 6 + 1] as number);
    return uz * vx - ux * vz > 0 ? 1 : -1;
  }

  clear(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.removeFromParent();
      this.mesh = null;
    }
    this.hidden = new Set();
  }
}
