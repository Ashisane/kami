import { BufferAttribute, BufferGeometry, CircleGeometry, Color, ConeGeometry, DoubleSide, Group, InstancedMesh, Line, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, RingGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import type { Scene } from 'three';
import { Spring } from '@/core/anim/spring';
import type { SoftMesh } from '@/core/fold/soft/softMesh';
import { PAPER_STOCKS } from '@/core/paper/stocks';
import type { SheetMarks } from '@/core/render/SheetView';

export const PIN_COLOURS = ['#ff5a3c', '#ffc23d', '#18d6b4'] as const;
const GOOD = new Color('#ffc23d');
const BAD = new Color('#ff4040');
const CUT = new Color('#ff4fa3');
/** Locked paper is inked in Indigo, the one stock no sheet starts in. */
const INK = new Color((PAPER_STOCKS.find((stock) => stock.id === 'indigo') as { color: string }).color);
const DASHES = 44;

export class PinMarker {
  readonly group = new Group();
  private readonly pop = new Spring(0, 3.5, 0.32);
  private ready = false;
  private strain = 0;
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

  /** How hard paper is holding the hand back, from 0 to 1. The pin stretches and shivers with it. */
  setStrain(strain: number): void {
    this.strain = strain;
  }

  update(dt: number, camera: { quaternion: Quaternion }): void {
    this.time += dt;
    const pulse = this.ready ? 1 + Math.sin(this.time * 9) * 0.14 : 1;
    const s = Math.max(0.001, this.pop.update(dt)) * pulse;
    const pull = this.strain;
    this.group.scale.set(s * (1 - pull * 0.12), (1 / Math.sqrt(s)) * s * (1 + pull * 0.3), s * (1 - pull * 0.12));
    const shiver = pull * 0.05;
    this.group.position.x += Math.sin(this.time * 61) * shiver;
    this.group.position.z += Math.cos(this.time * 53) * shiver;
    for (const child of this.group.children.slice(1)) child.quaternion.copy(camera.quaternion);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

/** The angle being set, beside the hand. It pops on every snap. */
export class AngleTag {
  private readonly element = document.createElement('div');
  private readonly pop = new Spring(1, 6, 0.4);

  constructor(host: HTMLElement) {
    this.element.className = 'angle-tag';
    this.element.hidden = true;
    host.append(this.element);
  }

  show(x: number, y: number, degrees: number): void {
    const text = `${degrees}°`;
    if (this.element.textContent !== text) this.pop.kick(5);
    this.element.textContent = text;
    this.element.hidden = false;
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
  }

  hide(): void {
    this.element.hidden = true;
  }

  update(dt: number): void {
    if (!this.element.hidden) this.element.style.scale = String(Math.max(0.6, this.pop.update(dt)));
  }

  dispose(): void {
    this.element.remove();
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
  show(mesh: SoftMesh, faces: ReadonlySet<number>, tint: 'lift' | 'lock' = 'lift'): void {
    const colour = tint === 'lock' ? INK : GOOD;
    this.fillMaterial.color.copy(colour);
    this.edgeMaterial.color.copy(colour);
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

const HELD_VERTEX = /* glsl */ `
  attribute vec2 paperUv;
  attribute vec3 markStamp;
  varying vec2 vRest;
  varying vec3 vStamp;
  #include <fog_pars_vertex>
  void main() {
    vRest = paperUv;
    vStamp = markStamp;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const HELD_FRAGMENT = /* glsl */ `
  uniform vec3 uInk;
  uniform float uTime;
  varying vec2 vRest;
  varying vec3 vStamp;
  #include <fog_pars_fragment>
  void main() {
    // Pencil hatching at 45 degrees, fixed to the sheet so it folds with it.
    float along = (vRest.x + vRest.y) * 2.8;
    float toLine = min(fract(along), 1.0 - fract(along));
    float soft = fwidth(along);
    float line = 1.0 - smoothstep(0.15 - soft, 0.15 + soft, toLine);
    // A fresh mark spreads out from where it was pressed, a darker ring leading it.
    float age = uTime - vStamp.x;
    float reach = age * 14.0;
    float away = distance(vRest, vStamp.yz);
    float shown = smoothstep(away - 0.5, away, reach);
    float front = (1.0 - smoothstep(0.0, 0.45, abs(reach - away))) * (1.0 - smoothstep(0.3, 1.2, age));
    float alpha = (line * 0.62 + 0.1) * shown + front * 0.45;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uInk, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Long enough ago that a mark is simply there. */
const SETTLED_STAMP = [-1000, 0, 0] as const;
/** Far enough ahead that a mark has not started to show. */
const PENDING_STAMP = [1e9, 0, 0] as const;

/**
 * Inks locked paper with pencil hatching. Each sheet draws it over its own top
 * surface, so loose paper lying on top hides it. A new lock spreads out from the
 * spot that was pressed, like ink soaking in.
 */
export class HeldMarks implements SheetMarks {
  readonly material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uInk: { value: INK.clone() }, uTime: { value: 0 } }]),
    vertexShader: HELD_VERTEX,
    fragmentShader: HELD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  revision = 0;
  private readonly stamps = new Map<number, readonly [number, number, number]>();
  private time = 0;

  stamp(face: number): readonly [number, number, number] {
    return this.stamps.get(face) ?? SETTLED_STAMP;
  }

  /** Keeps faces unmarked until they are pressed, while a fold carries them over. */
  hide(faces: Iterable<number>): void {
    for (const f of faces) this.stamps.set(f, PENDING_STAMP);
    this.revision++;
  }

  /** Marks faces as pressed just now, spreading out from a point on the unfolded sheet. */
  press(faces: Iterable<number>, from: { x: number; z: number }): void {
    const stamp = [this.time, from.x, from.z] as const;
    for (const f of faces) this.stamps.set(f, stamp);
    this.revision++;
  }

  update(dt: number): void {
    this.time += dt;
    (this.material.uniforms['uTime'] as { value: number }).value = this.time;
  }

  dispose(): void {
    this.material.dispose();
  }
}

/** The brush that paints locks on or off, lying on the paper under the pointer. */
export class LockBrush {
  readonly group = new Group();
  private readonly edgeMaterial = new MeshBasicMaterial({ color: INK, transparent: true, opacity: 0, side: DoubleSide, depthTest: false });
  private readonly fillMaterial = new MeshBasicMaterial({ color: INK, transparent: true, opacity: 0, side: DoubleSide, depthTest: false });
  private readonly size = new Spring(0, 5, 0.45);
  private readonly fade = new Spring(0, 6, 0.9);

  constructor(
    scene: Scene,
    readonly radius: number,
  ) {
    const edge = new Mesh(new RingGeometry(radius * 0.93, radius, 48), this.edgeMaterial);
    const fill = new Mesh(new CircleGeometry(radius * 0.93, 48), this.fillMaterial);
    edge.rotation.x = -Math.PI / 2;
    fill.rotation.x = -Math.PI / 2;
    this.group.add(fill, edge);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Shows the brush at a point: inked for locking, pale for freeing. */
  show(at: Vector3, locking: boolean): void {
    if (!this.group.visible) {
      this.size.snap(0.5);
      this.size.target = 1;
    }
    this.group.visible = true;
    this.group.position.copy(at);
    this.group.position.y += 0.04;
    this.fade.target = 1;
    const colour = locking ? INK : GOOD;
    this.edgeMaterial.color.copy(colour);
    this.fillMaterial.color.copy(colour);
  }

  /** Paint landing: the brush squashes and springs back. */
  press(): void {
    this.size.kick(-3);
  }

  hide(): void {
    this.fade.target = 0;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    const s = Math.max(0.01, this.size.update(dt));
    const fade = Math.max(0, this.fade.update(dt));
    this.group.scale.set(s, 1, s);
    this.edgeMaterial.opacity = 0.9 * fade;
    this.fillMaterial.opacity = 0.14 * fade;
    if (this.fade.target === 0 && fade < 0.01) this.group.visible = false;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

/** A line from a hand to where it is trying to go, when paper is holding it back. */
export class Tether {
  readonly line: Line;
  private readonly material = new LineBasicMaterial({ color: BAD, transparent: true, opacity: 0, depthTest: false });
  private readonly points = new Float32Array(6);

  constructor(scene: Scene) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.points, 3));
    this.line = new Line(geometry, this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);
  }

  /** Draws the strain from the hand to its target, stronger the further paper holds it back. */
  show(from: Vector3, to: Vector3, strain: number): void {
    this.line.visible = strain > 0;
    if (!this.line.visible) return;
    from.toArray(this.points, 0);
    to.toArray(this.points, 3);
    (this.line.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.material.opacity = Math.min(1, strain) * 0.85;
  }

  hide(): void {
    this.line.visible = false;
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.line.removeFromParent();
  }
}
