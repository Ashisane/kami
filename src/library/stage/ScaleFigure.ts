import { Group, Shape } from 'three';
import { sheet } from '@/core/paper/sheet';
import { WORLD } from '@/core/world';

/** A paper-doll cutout of a player, for judging how big a model will feel in the game. */
export function createScaleFigure(): Group {
  const h = WORLD.playerHeight;
  const head = h * 0.16;
  const shoulder = h * 0.2;
  const waist = h * 0.13;

  const body = new Shape();
  body.moveTo(-waist, 0);
  body.lineTo(waist, 0);
  body.lineTo(waist * 1.05, h * 0.42);
  body.quadraticCurveTo(shoulder * 1.2, h * 0.66, shoulder * 0.42, h * 0.7);
  body.lineTo(head * 0.42, h * 0.7);
  body.absarc(0, h - head, head, -Math.PI * 0.36, Math.PI * 1.36, false);
  body.lineTo(-shoulder * 0.42, h * 0.7);
  body.quadraticCurveTo(-shoulder * 1.2, h * 0.66, -waist * 1.05, h * 0.42);
  body.closePath();

  const figure = new Group();
  figure.name = 'scale_figure';

  // Cut flat in sheet space, then stood upright facing the camera.
  const cutout = sheet('scale_cutout', body, { top: 'kraft', bottom: 'washi', edge: 'kraft', thickness: 0.018 });
  cutout.rotation.x = -Math.PI / 2;
  figure.add(cutout);
  return figure;
}
