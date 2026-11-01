import { Box3, Vector3 } from 'three';
import type { ColliderSpec } from '@/core/asset/types';
import type { LibraryContext } from '../../context';
import { emptyNote, section } from '../controls';
import { h, replace } from '../dom';

function describeShape(spec: ColliderSpec): string {
  switch (spec.shape) {
    case 'box':
      return `box ${spec.size.join(' × ')}`;
    case 'sphere':
      return `sphere r ${spec.radius}`;
    case 'capsule':
      return `capsule r ${spec.radius} h ${spec.height}`;
  }
}

/** How much of the model's bounds the solid colliders span, per axis. */
function fitReport(model: Box3, colliders: Box3): { axis: string; percent: number }[] {
  const m = model.getSize(new Vector3());
  const overlap = model.clone().intersect(colliders).getSize(new Vector3());
  return (['x', 'y', 'z'] as const).map((axis) => ({
    axis: axis.toUpperCase(),
    percent: m[axis] > 0 ? Math.round((overlap[axis] / m[axis]) * 100) : 100,
  }));
}

export function collidePanel({ stage }: LibraryContext): HTMLElement {
  const { instance } = stage;
  if (!instance) return emptyNote('Nothing to collide', 'Select an asset to inspect its collision shapes.');

  const { colliders } = instance.definition;
  const fit = h('dl.stats.stats-3');
  const renderFit = () =>
    replace(
      fit,
      fitReport(stage.subjectBounds(), stage.colliders.solidBounds()).map(({ axis, percent }) =>
        h('div.stat', {}, h('dt', {}, axis), h('dd', {}, `${percent}%`)),
      ),
    );
  renderFit();
  const unsubscribe = stage.deck.subscribe(() => {
    if (fit.isConnected) renderFit();
    else unsubscribe();
  });

  return h(
    'div.panel',
    {},
    section(
      'Shapes',
      h(
        'ul.rows',
        {},
        colliders.map((spec) =>
          h(
            'li.collider-row',
            {
              onpointerenter: () => stage.colliders.highlight(spec.name),
              onpointerleave: () => stage.colliders.highlight(null),
            },
            h('span.collider-dot', { 'data-role': spec.role }),
            h('strong', {}, spec.name),
            h('span', {}, `${describeShape(spec)}${spec.node ? ` on ${spec.node}` : ''}`),
          ),
        ),
      ),
    ),
    section(
      'Fit on model',
      fit,
      h('p.panel-note', {}, 'Live, solid shapes only. Scrub a clip to check the fit holds while it moves.'),
    ),
  );
}
