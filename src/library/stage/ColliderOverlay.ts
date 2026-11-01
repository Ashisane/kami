import { Box3, BoxGeometry, CapsuleGeometry, Color, DoubleSide, EdgesGeometry, Euler, Group, LineBasicMaterial, LineSegments, MathUtils, Matrix4, Mesh, MeshBasicMaterial, Object3D, Quaternion, SphereGeometry, Vector3, WireframeGeometry } from 'three';
import type { BufferGeometry, Scene } from 'three';
import type { AssetInstance } from '@/core/asset/AssetInstance';
import type { ColliderSpec } from '@/core/asset/types';

const COLORS = { solid: '#19f0c8', sensor: '#ffcf33', highlight: '#ff4fa3' } as const;

interface Shell {
  spec: ColliderSpec;
  node: Object3D;
  local: Matrix4;
  holder: Group;
  fill: MeshBasicMaterial;
  line: LineBasicMaterial;
}

function shapeGeometry(spec: ColliderSpec): { solid: BufferGeometry; outline: BufferGeometry } {
  switch (spec.shape) {
    case 'box': {
      const solid = new BoxGeometry(...spec.size);
      return { solid, outline: new EdgesGeometry(solid) };
    }
    case 'sphere': {
      const solid = new SphereGeometry(spec.radius, 14, 10);
      return { solid, outline: new WireframeGeometry(solid) };
    }
    case 'capsule': {
      const solid = new CapsuleGeometry(spec.radius, spec.height, 4, 12);
      return { solid, outline: new WireframeGeometry(solid) };
    }
  }
}

/** Draws colliders from the asset's data, following their nodes while clips play. */
export class ColliderOverlay {
  readonly group = new Group();
  private shells: Shell[] = [];
  private readonly world = new Matrix4();

  constructor(scene: Scene) {
    scene.add(this.group);
  }

  attach(instance: AssetInstance | null): void {
    this.clear();
    if (!instance) return;
    for (const spec of instance.definition.colliders) {
      const node = spec.node ? instance.node(spec.node) ?? instance.root : instance.root;
      const local = new Matrix4().compose(
        new Vector3(...(spec.offset ?? [0, 0, 0])),
        new Quaternion().setFromEuler(
          new Euler(...((spec.rotation ?? [0, 0, 0]).map((d) => MathUtils.degToRad(d)) as [number, number, number])),
        ),
        new Vector3(1, 1, 1),
      );
      const { solid, outline } = shapeGeometry(spec);
      const color = new Color(COLORS[spec.role]);
      const fill = new MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide });
      const line = new LineBasicMaterial({ color, transparent: true, opacity: spec.shape === 'box' ? 1 : 0.5 });
      const holder = new Group();
      holder.matrixAutoUpdate = false;
      holder.add(new Mesh(solid, fill), new LineSegments(outline, line));
      this.group.add(holder);
      this.shells.push({ spec, node, local, holder, fill, line });
    }
  }

  highlight(name: string | null): void {
    for (const shell of this.shells) {
      const active = shell.spec.name === name;
      shell.fill.color.set(active ? COLORS.highlight : COLORS[shell.spec.role]);
      shell.line.color.set(active ? COLORS.highlight : COLORS[shell.spec.role]);
      shell.fill.opacity = active ? 0.34 : name ? 0.06 : 0.16;
    }
  }

  update(): void {
    for (const { node, local, holder } of this.shells) {
      holder.matrix.copy(this.world.multiplyMatrices(node.matrixWorld, local));
      holder.matrixWorldNeedsUpdate = true;
    }
    this.group.updateMatrixWorld(true);
  }

  /** Bounds of the solid colliders, for reporting how well they fit the model. */
  solidBounds(): Box3 {
    const box = new Box3();
    this.update();
    for (const shell of this.shells) {
      if (shell.spec.role === 'solid') box.expandByObject(shell.holder.children[0] as Object3D);
    }
    return box;
  }

  private clear(): void {
    for (const shell of this.shells) {
      shell.holder.traverse((object) => {
        if (object instanceof Mesh || object instanceof LineSegments) object.geometry.dispose();
      });
      shell.fill.dispose();
      shell.line.dispose();
    }
    this.group.clear();
    this.shells = [];
  }
}
