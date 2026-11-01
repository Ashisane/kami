import { LIGHTING_PRESETS } from '@/core/render/lighting';
import type { LightingPreset } from '@/core/render/lighting';
import type { Quality } from '@/core/render/RenderPipeline';
import type { StockId } from '@/core/paper/stocks';
import type { Surface } from './stage/CuttingMat';
import type { ViewMode } from './stage/LibraryStage';

export type Selection = { kind: 'sheet'; id: string } | { kind: 'asset'; id: string } | { kind: 'stock'; id: StockId };
export type InspectorTab = 'fold' | 'asset' | 'motion' | 'collide' | 'paper' | 'light';

export interface LibraryState {
  selection: Selection;
  tab: InspectorTab;
  view: ViewMode;
  colliders: boolean;
  sockets: boolean;
  grid: boolean;
  scale: boolean;
  turntable: boolean;
  ambientOcclusion: boolean;
  quality: Quality;
  surface: Surface;
  lighting: LightingPreset;
}

type Listener = (state: LibraryState, changed: ReadonlySet<keyof LibraryState>) => void;

const STORAGE_KEY = 'kami.library.v1';
const PERSISTED: readonly (keyof LibraryState)[] = ['selection', 'tab', 'view', 'surface', 'lighting', 'quality'];

function restore(): Partial<LibraryState> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<LibraryState>;
  } catch {
    return {};
  }
}

export class Store {
  state: LibraryState;
  private readonly listeners = new Set<Listener>();

  constructor(defaults: LibraryState, private readonly persist = true) {
    this.state = persist ? { ...defaults, ...restore() } : defaults;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(patch: Partial<LibraryState>): void {
    const changed = new Set<keyof LibraryState>();
    for (const key of Object.keys(patch) as (keyof LibraryState)[]) {
      if (patch[key] !== this.state[key]) changed.add(key);
    }
    if (changed.size === 0) return;
    this.state = { ...this.state, ...patch };
    this.save();
    for (const listener of this.listeners) listener(this.state, changed);
  }

  private save(): void {
    if (!this.persist) return;
    try {
      const saved = Object.fromEntries(PERSISTED.map((key) => [key, this.state[key]]));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Private windows can refuse storage. The library just forgets its place.
    }
  }
}

export function defaultState(selection: Selection): LibraryState {
  return {
    selection,
    tab: selection.kind === 'sheet' ? 'fold' : 'asset',
    view: 'lit',
    colliders: false,
    sockets: false,
    grid: true,
    scale: false,
    turntable: false,
    ambientOcclusion: true,
    quality: 'balanced',
    surface: 'mat',
    lighting: { ...(LIGHTING_PRESETS[0] as LightingPreset) },
  };
}
