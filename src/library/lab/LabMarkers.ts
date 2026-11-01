import { BufferAttribute, BufferGeometry, CircleGeometry, Color, ConeGeometry, DoubleSide, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, RingGeometry, Vector3 } from 'three';
import type { Scene } from 'three';
import { Spring } from '@/core/anim/spring';
import type { SoftMesh } from '@/core/fold/soft/softMesh';

export const PIN_COLOURS = ['#ff5a3c', '#ffc23d', '#18d6b4'] as const;
const GOOD = new Color('#ffc23d');
const BAD = new Color('#ff4040');
const CUT = new Color('#ff4fa3');
const DASHES = 44;

export class PinMarker {
  readonly group = new Group();
  private readonly pop = new Spring(0, 3.5, 0.32);
  private ready = false;
  private time = 0;

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

  /** A pin that would crease if dropped pulses, inviting the click. */
  setReady(ready: boolean): void {
    this.ready = ready;
  }

  update(dt: number, camera: { quaternion: Quaternion }): void {
    this.time += dt;
    const pulse = this.ready ? 1 + Math.sin(this.time * 9) * 0.14 : 1;
    const s = Math.max(0.001, this.pop.update(dt)) * pulse;
    this.group.scale.set(s, 1 / Math.sqrt(s) * s, s);
    for (const child of this.group.children.slice(1)) child.quaternion.copy(camera.quaternion);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

const HINT_FILL = 0.22;
const HINT_EDGE = 0.95;

/**
 * Lights up the flap that would lift if the paper under the pointer were pulled.
 * Layers are too thin to tell apart by eye, so the paper says which one you mean.
 */
export class FlapHint {
  readonly group = new Group();
  private readonly fillMaterial = new MeshBasicMaterial({ color: GOOD, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false });
  private readonly edgeMaterial = new LineBasicMaterial({ color: GOOD, transparent: true, opacity: 0 });
  private readonly fill = new Mesh(new BufferGeometry(), this.fillMaterial);
  private readonly edge = new LineSegments(new BufferGeometry(), this.edgeMaterial);
  private readonly glow = new Spring(0, 5, 0.55);
  /** Solver vertices of the flap's triangles, then of its outline. */
  private fillVertices = new Int32Array(0);
  private edgeVertices = new Int32Array(0);

  constructor(scene: Scene) {
    this.fill.frustumCulled = false;
    this.edge.frustumCulled = false;
    this.group.add(this.fill, this.edge);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Lights a new flap. Folded paper merges, so each solver triangle is drawn once. */
  show(mesh: SoftMesh, faces: ReadonlySet<number>): void {
    const tris = new Set<number>();
    for (const f of faces) tris.add(mesh.faceTri[f] as number);
    const outline = new Map<number, [number, number, number]>();
    const fill: number[] = [];
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const a = mesh.tris[t * 3 + k] as number, b = mesh.tris[t * 3 + (k + 1) % 3] as number;
        fill.push(a);
        const key = Math.min(a, b) * mesh.vertexCount + Math.max(a, b);
        const seen = outline.get(key);
        if (seen) seen[2]++;
        else outline.set(key, [a, b, 1]);
      }
    }
    const edges: number[] = [];
    for (const [a, b, count] of outline.values()) if (count === 1) edges.push(a, b);
    this.fillVertices = Int32Array.from(fill);
    this.edgeVertices = Int32Array.from(edges);
    this.fill.geometry.setAttribute('position', new BufferAttribute(new Float32Array(fill.length * 3), 3));
    this.edge.geometry.setAttribute('position', new BufferAttribute(new Float32Array(edges.length * 3), 3));
    this.glow.target = 1;
    this.glow.kick(3);
    this.group.visible = true;
  }

  hide(): void {
    this.glow.target = 0;
  }

  /** Drops the hint at once: the paper it pointed at no longer exists. */
  clear(): void {
    this.glow.snap(0);
    this.group.visible = false;
  }

  update(dt: number, x: Float64Array | null): void {
    if (!this.group.visible) return;
    const glow = Math.max(0, this.glow.update(dt));
    if (this.glow.target === 0 && this.glow.settled) this.group.visible = false;
    this.fillMaterial.opacity = HINT_FILL * glow;
    this.edgeMaterial.opacity = Math.min(1, HINT_EDGE * glow);
    if (!x) return;
    write(this.fill.geometry, this.fillVertices, x);
    write(this.edge.geometry, this.edgeVertices, x);
  }

  dispose(): void {
    this.fill.geometry.dispose();
    this.edge.geometry.dispose();
    this.group.removeFromParent();
  }
}

function write(geometry: BufferGeometry, vertices: Int32Array, x: Float64Array): void {
  const position = geometry.getAttribute('position') as BufferAttribute;
  const out = position.array as Float32Array;
  for (let i = 0; i < vertices.length; i++) {
    const v = (vertices[i] as number) * 3;
    out[i * 3] = x[v] as number;
    out[i * 3 + 1] = x[v + 1] as number;
    out[i * 3 + 2] = x[v + 2] as number;
  }
  position.needsUpdate = true;
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
