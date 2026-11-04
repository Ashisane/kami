import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, Object3D } from 'three';
import type { BufferGeometry } from 'three';
import { clip, hinge, move, scale } from '@/core/anim/clip';
import type { Key } from '@/core/anim/clip';
import { fold, inOutCubic, outCubic, spring } from '@/core/anim/easing';
import { defineAsset } from '@/core/asset/types';
import { paper } from '@/core/paper/paperLibrary';
import type { StockId } from '@/core/paper/stocks';

/**
 * A crew member: a 1 m figure folded from paper, every part a few flat facets so
 * light breaks hard across it like creased card. Blockout: the shape and clips are
 * what gameplay needs, and a Blender model can replace it under the same names.
 *
 * It faces +z and stands on its origin. The body's colour is a paint slot, so each
 * of the crew can be a different stock.
 */
const HIP = 0.4;
const SHOULDER = 0.31;
const NECK = 0.34;
const BODY: StockId = 'marigold';

function part(name: string, geometry: BufferGeometry, stock: StockId, paint?: string): Mesh {
  const mesh = new Mesh(geometry, paper(stock));
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (paint) mesh.userData['paint'] = paint;
  return mesh;
}

function joint(name: string, x: number, y: number, z = 0): Group {
  const group = new Group();
  group.name = name;
  group.position.set(x, y, z);
  return group;
}

function socket(name: string, x: number, y: number, z: number): Object3D {
  const node = new Object3D();
  node.name = name;
  node.position.set(x, y, z);
  return node;
}

/** A leg hanging from the hip, with a wedge of a foot. */
function leg(side: 'left' | 'right', x: number): Group {
  const hip = joint(`leg_${side}`, x, HIP);
  const shin = part(`shin_${side}`, new CylinderGeometry(0.055, 0.045, 0.36, 4), BODY, 'body');
  shin.rotation.y = Math.PI / 4;
  shin.position.y = -0.18;
  const foot = part(`foot_${side}`, new BoxGeometry(0.09, 0.05, 0.16), BODY, 'body');
  foot.position.set(0, -0.375, 0.03);
  hip.add(shin, foot);
  return hip;
}

/** An arm hanging from the shoulder, with a mitten and the socket a hand holds by. */
function arm(side: 'left' | 'right', x: number): Group {
  const shoulder = joint(`arm_${side}`, x, SHOULDER);
  // Splayed out from the body, so the arms clear its flared hem whatever a clip does.
  const splay = joint(`splay_${side}`, 0, 0);
  splay.rotation.z = side === 'left' ? -0.32 : 0.32;
  const sleeve = part(`sleeve_${side}`, new CylinderGeometry(0.032, 0.026, 0.26, 3), BODY, 'body');
  sleeve.position.y = -0.13;
  const hand = joint(`hand_${side}`, 0, -0.27);
  hand.add(part(`mitten_${side}`, new IcosahedronGeometry(0.048, 0), 'washi'), socket(`socket_hand_${side}`, 0, -0.02, 0));
  splay.add(sleeve, hand);
  shoulder.add(splay);
  return shoulder;
}

function build() {
  const root = new Group();
  root.name = 'being';

  const hips = joint('hips', 0, HIP);
  const torso = part('torso', new CylinderGeometry(0.1, 0.16, 0.34, 6), BODY, 'body');
  torso.position.y = 0.17;
  hips.add(torso);

  const head = joint('head', 0, NECK);
  const skull = part('skull', new IcosahedronGeometry(0.13, 0), 'washi');
  skull.position.y = 0.12;
  for (const side of [-1, 1]) {
    const eye = part(side < 0 ? 'eye_left' : 'eye_right', new CircleGeometry(0.022, 6), 'sumi');
    eye.position.set(side * 0.045, 0.14, 0.122);
    head.add(eye);
  }
  head.add(skull, socket('socket_head', 0, 0.26, 0));
  hips.add(head, arm('left', -0.11), arm('right', 0.11));

  root.add(hips, leg('left', -0.075), leg('right', 0.075), socket('socket_feet', 0, 0, 0));
  return { root, clips: clips() };
}

/** A key list that swings to a value and back, for loops. */
const swing = (duration: number, from: number, to: number): Key<number>[] => [
  { at: 0, value: from },
  { at: duration / 2, value: to, ease: inOutCubic },
  { at: duration, value: from, ease: inOutCubic },
];

const at = (y: number): [number, number, number] => [0, y, 0];

function clips() {
  const I = 2.4;
  const idle = clip('idle', I, [
    scale('hips', I, [
      { at: 0, value: [1, 1, 1] },
      { at: I / 2, value: [1.015, 1.03, 1.015], ease: inOutCubic },
      { at: I, value: [1, 1, 1], ease: inOutCubic },
    ]),
    hinge('head', 'z', I, swing(I, -3, 3)),
    hinge('arm_left', 'x', I, swing(I, 3, -3)),
    hinge('arm_right', 'x', I, swing(I, -3, 3)),
  ]);

  const W = 0.8;
  const bob = (duration: number, low: number, high: number): Key<[number, number, number]>[] => [
    { at: 0, value: at(low) },
    { at: duration / 4, value: at(high), ease: outCubic },
    { at: duration / 2, value: at(low), ease: inOutCubic },
    { at: (duration * 3) / 4, value: at(high), ease: outCubic },
    { at: duration, value: at(low), ease: inOutCubic },
  ];
  const walk = clip('walk', W, [
    hinge('leg_left', 'x', W, swing(W, -26, 26)),
    hinge('leg_right', 'x', W, swing(W, 26, -26)),
    hinge('arm_left', 'x', W, swing(W, 22, -22)),
    hinge('arm_right', 'x', W, swing(W, -22, 22)),
    move('hips', W, bob(W, HIP, HIP + 0.025)),
  ]);

  const R = 0.5;
  const run = clip('run', R, [
    hinge('leg_left', 'x', R, swing(R, -46, 40)),
    hinge('leg_right', 'x', R, swing(R, 40, -46)),
    hinge('arm_left', 'x', R, swing(R, 50, -55)),
    hinge('arm_right', 'x', R, swing(R, -55, 50)),
    hinge('hips', 'x', R, swing(R, 12, 15)),
    move('hips', R, bob(R, HIP - 0.01, HIP + 0.04)),
  ]);

  // Arms forward to take hold: a little wind-up back, then out past the mark and settling.
  const C = 0.35;
  const reachArm = (side: 'left' | 'right') =>
    hinge(`arm_${side}`, 'x', C, [
      { at: 0, value: 0 },
      { at: 0.08, value: 14, ease: outCubic },
      { at: 0.26, value: -96, ease: fold(0.12, 0.1) },
      { at: C, value: -82, ease: outCubic },
    ]);
  const reach = clip('reach', C, [reachArm('left'), reachArm('right'), hinge('hips', 'x', C, [{ at: 0, value: 0 }, { at: C, value: 10, ease: outCubic }])]);

  // Holding paper up: arms out, leaning back a touch against its weight.
  const H = 1.6;
  const hold = clip('hold', H, [
    hinge('arm_left', 'x', H, swing(H, -80, -75)),
    hinge('arm_right', 'x', H, swing(H, -80, -75)),
    hinge('hips', 'x', H, swing(H, -4, -6)),
  ]);

  // Paper pulled taut: leaning hard away, heels dug in, shaking with the effort.
  const S = 0.3;
  const strain = clip('strain', S, [
    hinge('hips', 'x', S, swing(S, -18, -14)),
    hinge('arm_left', 'x', S, swing(S, -66, -58)),
    hinge('arm_right', 'x', S, swing(S, -62, -70)),
    hinge('leg_left', 'x', S, swing(S, -22, -20)),
    hinge('leg_right', 'x', S, swing(S, 16, 18)),
    hinge('head', 'z', S, swing(S, -5, 5)),
  ]);

  // Slapping a crease flat: arms up, then down hard with a squash, and springing back.
  const P = 0.55;
  const pressArm = (side: 'left' | 'right') =>
    hinge(`arm_${side}`, 'x', P, [
      { at: 0, value: -80 },
      { at: 0.12, value: -128, ease: outCubic },
      { at: 0.22, value: -18, ease: (t) => t * t * t },
      { at: P, value: -40, ease: spring(3, 0.4) },
    ]);
  const press = clip('press', P, [
    pressArm('left'),
    pressArm('right'),
    hinge('hips', 'x', P, [
      { at: 0, value: 0 },
      { at: 0.12, value: -8, ease: outCubic },
      { at: 0.22, value: 26, ease: (t) => t * t },
      { at: P, value: 0, ease: spring(3, 0.35) },
    ]),
    scale('hips', P, [
      { at: 0, value: [1, 1, 1] },
      { at: 0.22, value: [1.12, 0.8, 1.12], ease: (t) => t * t },
      { at: P, value: [1, 1, 1], ease: spring(3.2, 0.3) },
    ]),
  ]);

  // Pitching forward when a grip slips, arms thrown up, then catching itself.
  const T = 0.8;
  const stumble = clip('stumble', T, [
    hinge('hips', 'x', T, [
      { at: 0, value: 0 },
      { at: 0.2, value: 32, ease: outCubic },
      { at: T, value: 0, ease: spring(2.4, 0.35) },
    ]),
    hinge('arm_left', 'x', T, [
      { at: 0, value: -60 },
      { at: 0.25, value: -150, ease: outCubic },
      { at: T, value: 0, ease: spring(2.2, 0.4) },
    ]),
    hinge('arm_right', 'x', T, [
      { at: 0, value: -60 },
      { at: 0.3, value: -140, ease: outCubic },
      { at: T, value: 0, ease: spring(2.2, 0.4) },
    ]),
    hinge('leg_left', 'x', T, [
      { at: 0, value: 0 },
      { at: 0.2, value: -34, ease: outCubic },
      { at: T, value: 0, ease: spring(2.6, 0.4) },
    ]),
  ]);

  // Springing off the ground: a stretch up out of the legs, arms flung high, legs split
  // in the air, then easing into a float it holds until it lands.
  const J = 0.45;
  const jumpArm = (side: 'left' | 'right', high: number) =>
    hinge(`arm_${side}`, 'x', J, [
      { at: 0, value: 10 },
      { at: 0.12, value: -high, ease: outCubic },
      { at: J, value: -high + 10, ease: inOutCubic },
    ]);
  const jumpLeg = (side: 'left' | 'right', swingTo: number) =>
    hinge(`leg_${side}`, 'x', J, [
      { at: 0, value: 0 },
      { at: 0.15, value: swingTo, ease: outCubic },
      { at: J, value: swingTo * 0.75, ease: inOutCubic },
    ]);
  const jump = clip('jump', J, [
    jumpArm('left', 125),
    jumpArm('right', 115),
    jumpLeg('left', -32),
    jumpLeg('right', 22),
    hinge('hips', 'x', J, [
      { at: 0, value: 6 },
      { at: 0.15, value: -6, ease: outCubic },
      { at: J, value: -3, ease: inOutCubic },
    ]),
    scale('hips', J, [
      { at: 0, value: [1.08, 0.88, 1.08] },
      { at: 0.07, value: [0.9, 1.16, 0.9], ease: outCubic },
      { at: J, value: [1, 1, 1], ease: spring(3, 0.35) },
    ]),
  ]);

  return [idle, walk, run, reach, hold, strain, press, stumble, jump];
}

export default defineAsset({
  id: 'character.being',
  name: 'Being',
  category: 'character',
  status: 'blockout',
  description: 'A 1 m crew member folded from paper. Holds paper by both hands.',
  source: { kind: 'procedural', build },
  clips: ['idle', 'walk', 'run', 'reach', 'hold', 'strain', 'press', 'stumble', 'jump'],
  sockets: {
    hand_left: { node: 'socket_hand_left', description: 'Where the left hand grips paper.' },
    hand_right: { node: 'socket_hand_right', description: 'Where the right hand grips paper.' },
    feet: { node: 'socket_feet', description: 'The ground point it stands on.' },
    head: { node: 'socket_head', description: 'Top of the head, for labels and the camera.' },
  },
  colliders: [
    { name: 'body', role: 'solid', shape: 'capsule', radius: 0.22, height: 1, offset: [0, 0.5, 0] },
    { name: 'reach', role: 'sensor', shape: 'sphere', radius: 0.7, offset: [0, 0.55, 0.25] },
  ],
  paints: { body: 'The crew member\'s colour: body, sleeves and legs.' },
  maxTriangles: 400,
});
