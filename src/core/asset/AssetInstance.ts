import { AnimationMixer, LoopOnce, LoopRepeat, Mesh } from 'three';
import type { AnimationAction, BufferGeometry, Object3D } from 'three';
import { loadGltfModel } from './gltf';
import type { AssetDefinition, BuiltModel } from './types';

export interface PlayOptions {
  loop?: boolean;
  timeScale?: number;
  /** Seconds to blend from the current clip. */
  fade?: number;
}

/** A live copy of an asset. This is the entire surface game code gets. */
export class AssetInstance {
  readonly root: Object3D;
  readonly mixer: AnimationMixer;
  private current: AnimationAction | null = null;
  private readonly actions = new Map<string, AnimationAction>();

  constructor(
    readonly definition: AssetDefinition,
    readonly model: BuiltModel,
  ) {
    this.root = model.root;
    this.mixer = new AnimationMixer(model.root);
  }

  get clipNames(): string[] {
    return this.model.clips.map((c) => c.name);
  }

  action(name: string): AnimationAction {
    let action = this.actions.get(name);
    if (!action) {
      const clip = this.model.clips.find((c) => c.name === name);
      if (!clip) throw new Error(`${this.definition.id} has no clip "${name}".`);
      action = this.mixer.clipAction(clip);
      this.actions.set(name, action);
    }
    return action;
  }

  play(name: string, { loop = false, timeScale = 1, fade = 0 }: PlayOptions = {}): AnimationAction {
    const next = this.action(name);
    next.reset();
    next.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.timeScale = timeScale;
    next.play();
    if (this.current && this.current !== next) {
      if (fade > 0) this.current.crossFadeTo(next, fade, false);
      else this.current.stop();
    }
    this.current = next;
    return next;
  }

  stop(): void {
    this.mixer.stopAllAction();
    this.current = null;
  }

  node(name: string): Object3D | undefined {
    return this.root.getObjectByName(name);
  }

  /** Resolves a socket declared in the definition to its live node. */
  socket(name: string): Object3D {
    const spec = this.definition.sockets[name];
    if (!spec) throw new Error(`${this.definition.id} declares no socket "${name}".`);
    const node = this.node(spec.node);
    if (!node) throw new Error(`${this.definition.id} socket "${name}" points at missing node "${spec.node}".`);
    return node;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    const geometries = new Set<BufferGeometry>();
    this.root.traverse((object) => {
      if (object instanceof Mesh) geometries.add(object.geometry);
    });
    // Materials stay: paper is shared across every asset.
    for (const geometry of geometries) geometry.dispose();
    this.root.removeFromParent();
  }
}

export async function instantiate(definition: AssetDefinition): Promise<AssetInstance> {
  const { source } = definition;
  const model = source.kind === 'procedural' ? source.build() : await loadGltfModel(source.url);
  return new AssetInstance(definition, model);
}
