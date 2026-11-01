import type { LibraryContext } from '../../context';
import { emptyNote, section } from '../controls';
import { h } from '../dom';

export function motionPanel({ stage }: LibraryContext): HTMLElement {
  const { instance, deck } = stage;
  if (!instance || instance.clipNames.length === 0) {
    return emptyNote('No clips here', 'Clips appear here once the selected asset declares them.');
  }

  return h(
    'div.panel',
    {},
    section(
      'Clips',
      h(
        'ul.rows.rows-buttons',
        {},
        instance.model.clips.map((clip) =>
          h(
            'li',
            {},
            h(
              `button.row-button${clip.name === deck.clipName ? '.on' : ''}`,
              { type: 'button', onclick: () => { deck.select(clip.name); deck.play(); } },
              h('strong', {}, clip.name),
              h('span', {}, `${clip.duration.toFixed(2)} s · ${clip.tracks.length} tracks`),
            ),
          ),
        ),
      ),
    ),
    h('p.panel-note', {}, 'Scrub on the timeline below. Slow it to ⅒ speed to check wind-up, overshoot and settle.'),
  );
}
