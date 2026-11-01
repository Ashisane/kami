import type { LibraryContext } from '../context';
import type { InspectorTab } from '../state';
import { flash, h, replace } from './dom';
import { assetPanel } from './panels/AssetPanel';
import { collidePanel } from './panels/CollidePanel';
import { foldPanel } from './panels/FoldPanel';
import { lightPanel } from './panels/LightPanel';
import { motionPanel } from './panels/MotionPanel';
import { paperPanel } from './panels/PaperPanel';

const TABS: readonly { id: InspectorTab; label: string; panel: (context: LibraryContext) => HTMLElement }[] = [
  { id: 'fold', label: 'Fold', panel: foldPanel },
  { id: 'asset', label: 'Asset', panel: assetPanel },
  { id: 'motion', label: 'Motion', panel: motionPanel },
  { id: 'collide', label: 'Collide', panel: collidePanel },
  { id: 'paper', label: 'Paper', panel: paperPanel },
  { id: 'light', label: 'Light', panel: lightPanel },
];

export interface Inspector {
  element: HTMLElement;
  /** Rebuilds the open panel, after a new asset has loaded. */
  refresh(): void;
}

export function createInspector(context: LibraryContext): Inspector {
  const { store } = context;
  const body = h('div.inspector-body');

  const tabs = TABS.map(({ id, label }) => ({
    id,
    // Opening Collide means you want to see the shapes.
    element: h('button.tab', { type: 'button', role: 'tab', 'data-tab': id, onclick: () => store.set(id === 'collide' ? { tab: id, colliders: true } : { tab: id }) }, label),
  }));

  const refresh = () => {
    const tab = TABS.find((t) => t.id === store.state.tab) ?? (TABS[0] as (typeof TABS)[number]);
    for (const { id, element } of tabs) {
      element.classList.toggle('on', id === tab.id);
      element.setAttribute('aria-selected', String(id === tab.id));
    }
    replace(body, tab.panel(context));
    flash(body, 'unfold');
  };

  // Slider drags edit the lighting in place; only a new mood needs a rebuild.
  let lightingId = store.state.lighting.id;
  store.subscribe((state, changed) => {
    const moodChanged = state.lighting.id !== lightingId;
    lightingId = state.lighting.id;
    if (changed.has('tab') || moodChanged) refresh();
  });
  refresh();

  return {
    refresh,
    element: h('aside.inspector', {}, h('div.tabs', { role: 'tablist' }, tabs.map((t) => t.element)), h('div.card.inspector-card', {}, body)),
  };
}
