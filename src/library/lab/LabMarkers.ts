import { CircleGeometry, Color, ConeGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, RingGeometry, Vector3 } from 'three';
import type { Scene } from 'three';
import { Spring } from '@/core/anim/spring';

export const PIN_COLOURS = ['#ff5a3c', '#ffc23d', '#18d6b4'] as const;
const GOOD = new Color('#ffc23d');
const BAD = new Color('#ff4040');
const CUT = new Color('#ff4fa3');
const DASHES = 44;

export class PinMarker {
  readonly group = new Group();
  private readonly pop = new Spring(0, 3.5, 0.32);

  constructor(colour: string) {
    const material = new MeshBasicMaterial({ color: colour });
    const head = new Mesh(new CircleGeometry(0.17, 24), material);
    head.position.y = 0.62;
    const ring = new Mesh(new RingGeometry(0.19, 0.24, 24), new MeshBasicMaterial({ color: '#fff6e6', side: DoubleSide }));
    ring.position.y = 0.62;
    const stem = new Mesh(new ConeGeometry(0.1, 0.5, 12), material);
    stem.rotation.x = Math.PI;
    stem.position.y = 0.28;
    this.group.add(stem, ring, head);
    this.pop.target = 1;
  }

  update(dt: number, camera: { quaternion: Quaternion }): void {
    const s = Math.max(0.001, this.pop.update(dt));
    this.group.scale.set(s, 1 / Math.sqrt(s) * s, s);
    for (const child of this.group.children.slice(1)) child.quaternion.copy(camera.quaternion);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

/** The line a fold would crease along, and where the held point would land. */
export class FoldGhost {
  readonly group = new Group();
  private readonly dashes: InstancedMesh;
  private readonly dashMaterial = new MeshBasicMaterial({ color: GOOD, transparent: true, opacity: 0.95, side: DoubleSide });
  private readonly ring: Mesh;
  private readonly ringMaterial = new MeshBasicMaterial({ color: GOOD, side: DoubleSide });
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly along = new Vector3();
  private readonly point = new Vector3();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly x = new Vector3();
  private readonly z = new Vector3();
  private readonly basis = new Matrix4();
  private time = 0;

  constructor(scene: Scene) {
    const plane = new PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.dashes = new InstancedMesh(plane, this.dashMaterial, DASHES);
    this.dashes.frustumCulled = false;
    this.ring = new Mesh(new RingGeometry(0.34, 0.46, 32), this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.group.add(this.dashes, this.ring);
    this.group.visible = false;
    scene.add(this.group);
  }

  hide(): void {
    this.group.visible = false;
  }

  /** Shows the line between two world points, and a landing ring if there is one. */
  show(a: Vector3, b: Vector3, landing: Vector3 | null, state: 'good' | 'bad' | 'cut', dt: number): void {
    this.group.visible = true;
    this.time += dt;
    const colour = state === 'good' ? GOOD : state === 'bad' ? BAD : CUT;
    this.dashMaterial.color.copy(colour);
    this.ringMaterial.color.copy(colour);

    this.along.copy(b).sub(a);
    const length = this.along.length();
    this.along.normalize();
    const count = Math.min(DASHES, Math.ceil(length / 0.46));
    this.dashes.count = count;
    this.z.copy(this.along);
    this.x.crossVectors(this.up, this.z).normalize();
    this.basis.makeBasis(this.x, this.up, this.z);
    this.quaternion.setFromRotationMatrix(this.basis);
    const crawl = (this.time * 0.8) % 1;
    for (let i = 0; i < count; i++) {
      const t = ((i + crawl) / count) * length;
      this.point.copy(a).addScaledVector(this.along, t);
      this.point.y += 0.02;
      this.scale.set(0.07, 1, 0.27);
      this.matrix.compose(this.point, this.quaternion, this.scale);
      this.dashes.setMatrixAt(i, this.matrix);
    }
    this.dashes.instanceMatrix.needsUpdate = true;

    this.ring.visible = landing !== null;
    if (landing) {
      this.ring.position.copy(landing);
      this.ring.position.y += 0.03;
      const pulse = 1 + Math.sin(this.time * 7) * 0.08;
      this.ring.scale.setScalar(pulse);
    }
  }
}
