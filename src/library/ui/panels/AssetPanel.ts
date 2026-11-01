import { validateModel, modelStats } from '@/core/asset/validate';
import type { LibraryContext } from '../../context';
import { emptyNote, section } from '../controls';
import { h } from '../dom';

const stat = (label: string, value: string | number) => h('div.stat', {}, h('dt', {}, label), h('dd', {}, value));

export function assetPanel({ stage }: LibraryContext): HTMLElement {
  const { instance } = stage;
  if (!instance) return emptyNote('Paper test bench', 'A sheet of the selected stock, set up to test flat grain, layers, folds, light through paper and curves.');

  const { definition, model } = instance;
  const stats = modelStats(model);
  const issues = validateModel(definition, model);
  const errors = issues.filter((i) => i.severity === 'error');
  const budget = Math.min(100, (stats.triangles / definition.maxTriangles) * 100);
  const sockets = Object.entries(definition.sockets);

  return h(
    'div.panel',
    {},
    h(
      'header.panel-head',
      {},
      h('h2.panel-title', {}, definition.name),
      h(`span.stamp${errors.length ? '.stamp-bad' : ''}`, {}, errors.length ? `${errors.length} broken` : 'Contract OK'),
    ),
    h('p.panel-note', {}, definition.description),
    h('code.id', {}, definition.id),
    section(
      'Budget',
      h(
        'div.meter',
        { role: 'img', 'aria-label': `${stats.triangles} of ${definition.maxTriangles} triangles` },
        h('div.meter-fill', { style: { width: `${budget}%` } }),
      ),
      h('p.meter-label', {}, `${stats.triangles} of ${definition.maxTriangles} triangles`),
      h(
        'dl.stats',
        {},
        stat('Draw calls', stats.drawCalls),
        stat('Papers', stats.materials),
        stat('Meshes', stats.meshes),
      ),
      h('div.stat.stat-wide', {}, h('dt', {}, 'Size in metres'), h('dd', {}, stats.size.map((n) => n.toFixed(2)).join(' × '))),
    ),
    issues.length > 0 &&
      section(
        'Contract',
        h('ul.issues', {}, issues.map((issue) => h(`li.issue-${issue.severity}`, {}, issue.message))),
      ),
    sockets.length > 0 &&
      section(
        'Sockets',
        h(
          'ul.rows',
          {},
          sockets.map(([name, socket]) => h('li', {}, h('strong', {}, name), h('span', {}, socket.description))),
        ),
      ),
  );
}
