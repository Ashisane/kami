import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import type { Camera, Object3D, Scene } from 'three';
import type { AssetInstance } from '@/core/asset/AssetInstance';

const AXIS_LENGTH = 0.14;

interface Marker {
  node: Object3D;
  gizmo: LineSegments;
  label: HTMLElement;
}

function axesGeometry(): BufferGeometry {
  const l = AXIS_LENGTH;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, l, 0, 0, 0, 0, 0, 0, l, 0, 0, 0, 0, 0, 0, l], 3));
  // Red x, green y, blue z, as in Blender.
  const r = [1, 0.25, 0.25];
  const g = [0.35, 1, 0.35];
  const b = [0.35, 0.55, 1];
  geometry.setAttribute('color', new Float32BufferAttribute([...r, ...r, ...g, ...g, ...b, ...b], 3));
  return geometry;
}

/** Axes on every socket, with a name tag in the DOM that tracks it on screen. */
export class SocketOverlay {
  readonly group = new Group();
  private markers: Marker[] = [];
  private readonly geometry = axesGeometry();
  private readonly material = new LineBasicMaterial({ vertexColors: true });
  private readonly world = new Vector3();

  constructor(
    scene: Scene,
    private readonly labels: HTMLElement,
  ) {
    scene.add(this.group);
  }

  attach(instance: AssetInstance | null): void {
    for (const marker of this.markers) marker.label.remove();
    this.group.clear();
    this.markers = [];
    if (!instance) return;
    for (const name of Object.keys(instance.definition.sockets)) {
      const node = instance.node(instance.definition.sockets[name]?.node ?? '');
      if (!node) continue;
      const gizmo = new LineSegments(this.geometry, this.material);
      gizmo.matrixAutoUpdate = false;
      const label = document.createElement('span');
      label.className = 'socket-label';
      label.textContent = name;
      this.labels.append(label);
      this.group.add(gizmo);
      this.markers.push({ node, gizmo, label });
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.labels.hidden = !visible;
  }

  update(camera: Camera, width: number, height: number): void {
    if (!this.group.visible) return;
    for (const { node, gizmo, label } of this.markers) {
      gizmo.matrix.copy(node.matrixWorld);
      gizmo.matrixWorldNeedsUpdate = true;
      node.getWorldPosition(this.world).project(camera);
      label.style.transform = `translate(${((this.world.x + 1) / 2) * width}px, ${((1 - this.world.y) / 2) * height}px)`;
    }
  }
}
