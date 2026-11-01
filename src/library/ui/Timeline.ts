import type { LibraryContext } from '../context';
import { h, replace } from './dom';
import { segmented } from './controls';

const SPEEDS = [
  { value: '0.1', label: '⅒' },
  { value: '0.25', label: '¼' },
  { value: '0.5', label: '½' },
  { value: '1', label: '1×' },
] as const;

/** The transport along the bottom: scrub a clip by hand and watch it in slow motion. */
export function createTimeline({ stage }: LibraryContext): HTMLElement {
  const { deck } = stage;

  const clips = h('div.timeline-clips');
  const play = h('button.play', { type: 'button', title: 'Play or pause (Space)', 'aria-label': 'Play or pause', onclick: () => deck.toggle() });
  const clock = h('output.clock');
  const fill = h('div.scrub-fill');
  const head = h('div.scrub-head');
  const scrub = h('div.scrub', { role: 'slider', 'aria-label': 'Clip time', tabIndex: 0 }, fill, head);
  const loop = h('button.chip', { type: 'button', title: 'Loop the clip', onclick: () => deck.setLoop(!deck.loop) }, 'loop');
  const speed = segmented(SPEEDS, '1', (value) => deck.setSpeed(Number(value)));

  let renderedClips = '';
  const render = () => {
    const names = deck.instance?.clipNames ?? [];
    root.classList.toggle('hidden', names.length === 0);

    const key = `${names.join()}|${deck.clipName}`;
    if (key !== renderedClips) {
      renderedClips = key;
      replace(
        clips,
        names.map((name) =>
          h(`button.chip${name === deck.clipName ? '.on' : ''}`, { type: 'button', onclick: () => { deck.select(name); deck.play(); } }, name),
        ),
      );
    }

    const progress = deck.duration ? (deck.time / deck.duration) * 100 : 0;
    fill.style.width = `${progress}%`;
    head.style.left = `${progress}%`;
    clock.textContent = `${deck.time.toFixed(2)} / ${deck.duration.toFixed(2)} s`;
    play.classList.toggle('playing', deck.playing);
    loop.classList.toggle('on', deck.loop);
  };

  const seekTo = (event: PointerEvent) => {
    const rect = scrub.getBoundingClientRect();
    deck.pause();
    deck.seek(((event.clientX - rect.left) / rect.width) * deck.duration);
  };
  scrub.addEventListener('pointerdown', (event) => {
    scrub.setPointerCapture(event.pointerId);
    seekTo(event);
  });
  scrub.addEventListener('pointermove', (event) => {
    if (scrub.hasPointerCapture(event.pointerId)) seekTo(event);
  });

  const root = h(
    'section.card.timeline',
    { 'aria-label': 'Animation timeline' },
    h('div.timeline-top', {}, clips, h('div.timeline-end', {}, speed.element, loop, clock)),
    h('div.timeline-bottom', {}, play, scrub),
  );

  deck.subscribe(render);
  render();
  return root;
}
