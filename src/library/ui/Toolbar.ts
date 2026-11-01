import type { LibraryContext } from '../context';
import { CAMERA_ANGLES } from '../stage/CameraRig';
import type { CameraAngle } from '../stage/CameraRig';
import type { ViewMode } from '../stage/LibraryStage';
import type { LibraryState } from '../state';
import { h } from './dom';
import { segmented } from './controls';
import type { Option } from './controls';

const VIEW_OPTIONS: readonly Option<ViewMode>[] = [
  { value: 'lit', label: 'Paper', title: 'Final look (1)' },
  { value: 'clay', label: 'Clay', title: 'Form only, no colour (2)' },
  { value: 'wire', label: 'Wire', title: 'Wireframe (3)' },
  { value: 'normals', label: 'Normals', title: 'Facet directions (4)' },
];

type OverlayKey = Extract<keyof LibraryState, 'colliders' | 'sockets' | 'scale' | 'turntable' | 'grid'>;

const OVERLAYS: readonly { key: OverlayKey; label: string; title: string }[] = [
  { key: 'colliders', label: 'Collision', title: 'Show collision shapes (C)' },
  { key: 'sockets', label: 'Sockets', title: 'Show attachment points (S)' },
  { key: 'scale', label: 'Scale', title: 'Show a player-sized cutout (H)' },
  { key: 'grid', label: 'Desk', title: 'Show the desk (G)' },
  { key: 'turntable', label: 'Spin', title: 'Rotate the model (T)' },
];

export function createToolbar({ stage, store }: LibraryContext, reference: HTMLElement): HTMLElement {
  const view = segmented(VIEW_OPTIONS, store.state.view, (value) => store.set({ view: value }));

  const overlays = OVERLAYS.map(({ key, label, title }) => {
    const element = h('button.chip', { type: 'button', title, onclick: () => store.set({ [key]: !store.state[key] }) }, label);
    element.classList.toggle('on', store.state[key]);
    return { key, element };
  });

  store.subscribe((state, changed) => {
    if (changed.has('view')) view.set(state.view);
    for (const { key, element } of overlays) element.classList.toggle('on', state[key]);
  });

  const cameras = (Object.keys(CAMERA_ANGLES) as CameraAngle[]).map((angle) =>
    h('button.chip', { type: 'button', title: `${angle} view`, onclick: () => stage.view(angle) }, angle),
  );

  return h(
    'nav.toolbar',
    { 'aria-label': 'View controls' },
    h('div.card.tool-card', {}, view.element),
    h('div.card.tool-card', {}, overlays.map((o) => o.element), reference),
    h('div.card.tool-card.cameras', {}, cameras, h('button.chip', { type: 'button', title: 'Frame the model (F)', onclick: () => stage.frameSubject() }, 'frame')),
  );
}
