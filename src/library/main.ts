import '@fontsource/potta-one/index.css';
import '@fontsource/kiwi-maru/400.css';
import '@fontsource/kiwi-maru/500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/layout.css';
import { hasAsset, listAssets } from '@/core/asset/registry';
import type { StockId } from '@/core/paper/stocks';
import { isStockId } from '@/core/paper/stocks';
import type { LibraryContext } from './context';
import { installDebugApi } from './debug';
import { LibraryStage } from './stage/LibraryStage';
import { defaultState, Store } from './state';
import type { Selection } from './state';
import { createCatalogue } from './ui/Catalogue';
import { h } from './ui/dom';
import { createInspector } from './ui/Inspector';
import { createReference } from './ui/Reference';
import { createTimeline } from './ui/Timeline';
import { createToolbar } from './ui/Toolbar';

const DEFAULT_STOCK: StockId = 'vermilion';

function firstSelection(): Selection {
  const first = listAssets()[0];
  return first ? { kind: 'asset', id: first.id } : { kind: 'stock', id: DEFAULT_STOCK };
}

function isValid(selection: Selection): boolean {
  return selection.kind === 'asset' ? hasAsset(selection.id) : isStockId(selection.id);
}

async function boot(): Promise<void> {
  // The desk texture draws text, so the font has to be ready first.
  await document.fonts.load('46px "Kiwi Maru"');

  const canvas = h('canvas.stage');
  const labels = h('div.socket-labels', { hidden: true });
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) throw new Error('Missing #app.');
  app.append(canvas, labels);

  const stage = new LibraryStage(canvas, labels);
  const store = new Store(defaultState(firstSelection()), !navigator.webdriver);
  if (!isValid(store.state.selection)) store.set({ selection: firstSelection() });

  const context: LibraryContext = { stage, store };
  const reference = createReference(context);
  const inspector = createInspector(context);
  const status = h('output.status');

  app.append(
    reference.layer,
    createCatalogue(context, status),
    createToolbar(context, reference.trigger),
    inspector.element,
    createTimeline(context),
  );

  const showSelection = async () => {
    const { selection } = store.state;
    if (selection.kind === 'stock') stage.showSpecimen(selection.id);
    else await stage.showAsset(selection.id, () => stage.deck.play());
    inspector.refresh();
  };

  const applyAll = () => {
    const { state } = store;
    stage.applyLighting(state.lighting);
    stage.setView(state.view);
    stage.setAmbientOcclusion(state.ambientOcclusion);
    stage.setSurface(state.surface);
    stage.setTurntable(state.turntable);
    stage.setOverlays(state);
  };

  let selectionLoaded = showSelection();
  store.subscribe((state, changed) => {
    if (changed.has('selection')) selectionLoaded = showSelection();
    if (changed.has('quality')) stage.setQuality(state.quality);
    applyAll();
  });
  stage.setQuality(store.state.quality);
  applyAll();
  await selectionLoaded;

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type !== 'range') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const { state } = store;
    const views = { '1': 'lit', '2': 'clay', '3': 'wire', '4': 'normals' } as const;
    if (event.key in views) store.set({ view: views[event.key as keyof typeof views] });
    else if (event.key === ' ') {
      event.preventDefault();
      stage.deck.toggle();
    } else if (event.key === 'c') store.set({ colliders: !state.colliders });
    else if (event.key === 's') store.set({ sockets: !state.sockets });
    else if (event.key === 'h') store.set({ scale: !state.scale });
    else if (event.key === 'g') store.set({ grid: !state.grid });
    else if (event.key === 't') store.set({ turntable: !state.turntable });
    else if (event.key === 'f') stage.frameSubject();
  });

  // Status is read straight from the renderer, once a second so it stays legible.
  window.setInterval(() => {
    const { calls, triangles } = stage.renderer.info.render;
    status.textContent = `${Math.round(1000 / stage.frameMs)} fps · ${stage.frameMs.toFixed(1)} ms · ${calls} draws · ${triangles.toLocaleString()} tris`;
  }, 1000);

  installDebugApi(context, () => selectionLoaded);
  stage.start();
  document.documentElement.dataset['ready'] = 'true';
}

void boot();
