import { Group, Object3D } from 'three';
import { clip, hinge, scale } from '@/core/anim/clip';
import { fold, inOutCubic, outCubic, spring } from '@/core/anim/easing';
import { defineAsset } from '@/core/asset/types';
import { rect, sheet } from '@/core/paper/sheet';

/**
 * Calibration only: not a game asset. It exists so every panel of the library
 * has something real to exercise: nested hinges, a colliders-on-moving-parts
 * case, sockets, two-sided paper, a once clip, a reverse clip and a loop.
 */
const SIZE = 0.6;
const LIFT = 0.012;

function hingeAt(name: string, x: number, y = 0): Group {
  const group = new Group();
  group.name = name;
  group.position.set(x, y, 0);
  return group;
}

function socketNode(name: string, x: number, y: number, z: number): Object3D {
  const node = new Object3D();
  node.name = name;
  node.position.set(x, y, z);
  return node;
}

function build() {
  const root = new Group();
  root.name = 'fold_test';

  const body = new Group();
  body.name = 'body';
  body.position.y = LIFT;
  root.add(body);

  body.add(sheet('base', rect(-SIZE / 2, -SIZE, SIZE / 2, SIZE), { top: 'vermilion' }));

  const left = hingeAt('flap_left', -SIZE / 2);
  left.add(sheet('flap_left_sheet', rect(-SIZE, -SIZE, 0, SIZE), { top: 'vermilion' }));
  body.add(left);

  const right = hingeAt('flap_right', SIZE / 2);
  right.add(sheet('flap_right_sheet', rect(0, -SIZE, SIZE, SIZE), { top: 'vermilion' }));
  body.add(right);

  // A hinge on a hinge: the tip has to follow the flap it hangs from.
  const tip = hingeAt('tip', SIZE);
  tip.add(sheet('tip_sheet', rect(0, -SIZE, SIZE * 0.5, SIZE), { top: 'vermilion' }));
  right.add(tip);

  body.add(socketNode('socket_seat', 0, 0.01, 0));
  left.add(socketNode('socket_handle', -SIZE, 0.01, 0));
  tip.add(socketNode('socket_tip', SIZE * 0.5, 0.01, 0));

  const T = 1.5;
  const foldClip = clip('fold', T, [
    hinge('flap_left', 'z', T, [
      { at: 0, value: 0 },
      { at: 0.75, value: -118, ease: fold() },
      { at: T, value: -118 },
    ]),
    hinge('flap_right', 'z', T, [
      { at: 0, value: 0 },
      { at: 0.16, value: 0 },
      { at: 0.95, value: 118, ease: fold() },
      { at: T, value: 118 },
    ]),
    hinge('tip', 'z', T, [
      { at: 0, value: 0 },
      { at: 0.55, value: 0 },
      { at: 1.2, value: 62, ease: fold(0.18, 0.14) },
      { at: T, value: 62 },
    ]),
    // The sheet takes the weight of the fold: a quick squash, then a springy recovery.
    scale('body', T, [
      { at: 0, value: [1, 1, 1] },
      { at: 0.16, value: [1.03, 0.8, 1.03], ease: outCubic },
      { at: 0.95, value: [1, 1, 1], ease: spring(3.2, 0.3) },
      { at: T, value: [1, 1, 1] },
    ]),
  ]);

  const U = 1;
  const unfoldClip = clip('unfold', U, [
    hinge('flap_left', 'z', U, [
      { at: 0, value: -118 },
      { at: U, value: 0, ease: spring(2.6, 0.42) },
    ]),
    hinge('flap_right', 'z', U, [
      { at: 0, value: 118 },
      { at: 0.08, value: 118 },
      { at: U, value: 0, ease: spring(2.6, 0.42) },
    ]),
    hinge('tip', 'z', U, [
      { at: 0, value: 62 },
      { at: 0.65, value: 0, ease: outCubic },
      { at: U, value: 0 },
    ]),
  ]);

  const F = 2.4;
  const flutterClip = clip('flutter', F, [
    hinge('flap_left', 'z', F, [
      { at: 0, value: -14 },
      { at: F / 2, value: -21, ease: inOutCubic },
      { at: F, value: -14, ease: inOutCubic },
    ]),
    hinge('flap_right', 'z', F, [
      { at: 0, value: 21 },
      { at: F / 2, value: 13, ease: inOutCubic },
      { at: F, value: 21, ease: inOutCubic },
    ]),
    hinge('tip', 'z', F, [
      { at: 0, value: 7 },
      { at: F / 2, value: 20, ease: inOutCubic },
      { at: F, value: 7, ease: inOutCubic },
    ]),
  ]);

  return { root, clips: [foldClip, unfoldClip, flutterClip] };
}

export default defineAsset({
  id: 'calibration.fold_test',
  name: 'Fold Test',
  category: 'calibration',
  status: 'calibration',
  description: 'Pipeline test piece with nested hinges, two-sided paper and colliders on moving parts.',
  source: { kind: 'procedural', build },
  clips: ['fold', 'unfold', 'flutter'],
  sockets: {
    seat: { node: 'socket_seat', description: 'Where a player sits.' },
    handle: { node: 'socket_handle', description: 'Grab point on the left flap.' },
    tip: { node: 'socket_tip', description: 'End of the nested hinge.' },
  },
  colliders: [
    { name: 'base', role: 'solid', shape: 'box', size: [0.6, 0.04, 1.2], node: 'body' },
    { name: 'flap_left', role: 'solid', shape: 'box', size: [0.6, 0.04, 1.2], node: 'flap_left', offset: [-0.3, 0, 0] },
    { name: 'flap_right', role: 'solid', shape: 'box', size: [0.6, 0.04, 1.2], node: 'flap_right', offset: [0.3, 0, 0] },
    { name: 'tip', role: 'solid', shape: 'box', size: [0.3, 0.04, 1.2], node: 'tip', offset: [0.15, 0, 0] },
    { name: 'pickup_zone', role: 'sensor', shape: 'sphere', radius: 0.32, node: 'body', offset: [0, 0.34, 0] },
  ],
  maxTriangles: 200,
});
