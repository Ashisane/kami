import type { LibraryContext } from '../context';
import { h } from './dom';
import { button, segmented, slider } from './controls';

type Mode = 'overlay' | 'side';

/**
 * Matching a reference image is a hard rule of this project, so the reference
 * lives on the stage. Drop an image anywhere, then lay it over the model or pin
 * it alongside. Images named in an asset's definition load automatically.
 */
export function createReference({ stage, store }: LibraryContext): { trigger: HTMLElement; layer: HTMLElement; load(url: string): void } {
  let mode: Mode = 'overlay';
  let opacity = 0.5;

  const image = h('img.reference-image', { alt: 'Reference image', hidden: true });
  const dropHint = h('div.drop-hint', {}, h('span', {}, 'Drop your reference'));
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });

  const apply = () => {
    const shown = Boolean(image.getAttribute('src'));
    image.hidden = !shown;
    panel.hidden = !shown && !panelOpen;
    trigger.classList.toggle('on', shown);
    image.dataset['mode'] = mode;
    image.style.opacity = mode === 'overlay' ? String(opacity) : '1';
  };

  const load = (url: string) => {
    image.src = url;
    apply();
  };
  const clear = () => {
    image.removeAttribute('src');
    panelOpen = false;
    apply();
  };

  let panelOpen = false;
  const trigger = h('button.chip', { type: 'button', title: 'Compare with a reference image', onclick: () => {
    panelOpen = !panelOpen;
    if (!image.getAttribute('src') && panelOpen) file.click();
    apply();
  } }, 'Reference');

  const modes = segmented<Mode>(
    [{ value: 'overlay', label: 'Overlay' }, { value: 'side', label: 'Pinned' }],
    mode,
    (value) => { mode = value; apply(); },
  );

  const panel = h(
    'div.card.reference-panel',
    { hidden: true },
    h('h3.group-title', {}, 'Reference'),
    modes.element,
    slider({ label: 'Opacity', min: 0.1, max: 1, step: 0.05, value: opacity, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { opacity = v; apply(); } }),
    h('div.button-row', {}, button('Replace', () => file.click()), button('Remove', clear)),
  );

  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (chosen) load(URL.createObjectURL(chosen));
  });

  let depth = 0;
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    depth++;
    dropHint.classList.add('on');
  });
  window.addEventListener('dragleave', () => {
    if (--depth <= 0) dropHint.classList.remove('on');
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    dropHint.classList.remove('on');
    const dropped = event.dataTransfer?.files[0];
    if (dropped?.type.startsWith('image/')) load(URL.createObjectURL(dropped));
  });

  // Asset-declared references follow the selection.
  store.subscribe((_, changed) => {
    if (!changed.has('selection')) return;
    const first = stage.instance?.definition.references?.[0];
    if (first) load(first);
  });

  return { trigger, layer: h('div.reference-layer', {}, image, panel, dropHint, file), load };
}
