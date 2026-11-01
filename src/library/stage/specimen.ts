import { CylinderGeometry, Group, Mesh } from 'three';
import { paper } from '@/core/paper/paperLibrary';
import { rect, sheet } from '@/core/paper/sheet';
import type { StockId } from '@/core/paper/stocks';

/**
 * The paper test bench shown when a stock is selected. Each piece tests one
 * thing: flat grain, layer contact, facet shading, the pale reverse, the cut
 * edge, light glowing through, and smooth curved shading.
 */
export function buildSpecimen(stock: StockId): Group {
  const root = new Group();
  root.name = 'specimen';
  const lift = 0.009;

  const base = sheet('card', rect(-1.25, -0.8, 1.25, 0.8), { top: stock });
  base.position.y = lift;
  root.add(base);

  // Loose cards propped on each other, so layer shadows and cut edges are visible.
  const overlay = sheet('overlay', rect(-0.42, -0.3, 0.42, 0.3), { top: stock });
  overlay.position.set(-0.66, 0.05, 0.34);
  overlay.rotation.set(0, 0.38, 0.06);
  root.add(overlay);

  const reverse = sheet('reverse', rect(-0.28, -0.2, 0.28, 0.2), { top: 'washi', bottom: stock });
  reverse.position.set(-0.8, 0.12, 0.26);
  reverse.rotation.set(0.05, -0.5, -0.05);
  root.add(reverse);

  // Accordion: facet shading, and the coloured face alternating with the reverse.
  const width = 0.16;
  const angle = 0.74;
  const accordion = new Group();
  accordion.position.set(-0.05, 0.03, -0.26);
  for (let i = 0; i < 7; i++) {
    const up = i % 2 === 0;
    const panel = new Group();
    panel.position.set(i * width * Math.cos(angle), up ? 0 : width * Math.sin(angle), 0);
    panel.rotation.z = up ? angle : -angle;
    panel.add(sheet(`pleat_${i}`, rect(0, -0.42, width, 0.42), { top: stock }));
    accordion.add(panel);
  }
  root.add(accordion);

  // A tent: the shaded side shows the sun glowing through the paper.
  const lean = 1.02;
  const leaf = 0.5;
  const tent = new Group();
  tent.position.set(0.76, lift * 2 + leaf * Math.sin(lean), 0.34);
  tent.rotation.y = -0.3;
  const leftLeaf = sheet('tent_left', rect(-leaf, -0.34, 0, 0.34), { top: stock });
  leftLeaf.rotation.z = lean;
  const rightLeaf = sheet('tent_right', rect(0, -0.34, leaf, 0.34), { top: stock });
  rightLeaf.rotation.z = -lean;
  tent.add(leftLeaf, rightLeaf);
  root.add(tent);

  // A curl of paper: smooth shading and the triplanar grain path.
  const curl = new Mesh(new CylinderGeometry(0.17, 0.17, 0.7, 40, 1, true, 0, Math.PI * 1.45), paper(stock, { smooth: true }));
  curl.name = 'curl';
  curl.rotation.z = Math.PI / 2;
  curl.position.set(0.72, 0.19, -0.5);
  curl.castShadow = true;
  curl.receiveShadow = true;
  root.add(curl);

  return root;
}
