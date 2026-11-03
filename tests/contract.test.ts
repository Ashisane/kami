import { Group, Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { clip, hinge } from '@/core/anim/clip';
import { fold, outBack, spring } from '@/core/anim/easing';
import { Spring } from '@/core/anim/spring';
import { instantiate } from '@/core/asset/AssetInstance';
import { getAsset, listAssets } from '@/core/asset/registry';
import { defineAsset } from '@/core/asset/types';
import type { BuiltModel } from '@/core/asset/types';
import { modelStats, validateModel } from '@/core/asset/validate';
import type { PaperMaterial } from '@/core/paper/PaperMaterial';
import { rect, sheet, sheetGeometry } from '@/core/paper/sheet';

const errors = (issues: { severity: string; message: string }[]) => issues.filter((i) => i.severity === 'error');

describe('every registered asset', () => {
  for (const definition of listAssets()) {
    it(`${definition.id} honours its contract`, () => {
      if (definition.source.kind !== 'procedural') return;
      expect(errors(validateModel(definition, definition.source.build()))).toEqual([]);
    });
  }
});

describe('the contract catches model swaps that would break the game', () => {
  const makeModel = (): BuiltModel => {
    const root = new Group();
    const arm = new Object3D();
    arm.name = 'arm';
    const socket = new Object3D();
    socket.name = 'socket_grip';
    root.add(arm, socket);
    root.add(sheet('body', rect(-1, -1, 1, 1), { top: 'teal' }));
    return { root, clips: [clip('wave', 1, [hinge('arm', 'z', 1, [{ at: 0, value: 0 }, { at: 1, value: 40 }])])] };
  };
  const definition = defineAsset({
    id: 'prop.test',
    name: 'Test',
    category: 'prop',
    status: 'blockout',
    description: '',
    source: { kind: 'procedural', build: makeModel },
    clips: ['wave'],
    sockets: { grip: { node: 'socket_grip', description: '' } },
    colliders: [{ name: 'body', role: 'solid', shape: 'box', size: [2, 0.1, 2], node: 'arm' }],
    maxTriangles: 100,
  });

  it('accepts a matching model', () => {
    expect(errors(validateModel(definition, makeModel()))).toEqual([]);
  });

  it('fails when a socket node disappears', () => {
    const model = makeModel();
    model.root.getObjectByName('socket_grip')?.removeFromParent();
    expect(errors(validateModel(definition, model)).map((i) => i.message).join()).toContain('socket_grip');
  });

  it('fails when a bone is renamed, because clips would silently stop working', () => {
    const model = makeModel();
    const arm = model.root.getObjectByName('arm');
    if (arm) arm.name = 'left_arm';
    const messages = errors(validateModel(definition, model)).map((i) => i.message).join();
    expect(messages).toContain('animates missing node "arm"');
    expect(messages).toContain('follows missing node "arm"');
  });

  it('fails when a clip disappears', () => {
    const model = makeModel();
    model.clips = [];
    expect(errors(validateModel(definition, model)).map((i) => i.message).join()).toContain('wave');
  });

  it('fails when the triangle budget is exceeded', () => {
    const tight = { ...definition, maxTriangles: 1 };
    expect(errors(validateModel(tight, makeModel())).map((i) => i.message).join()).toContain('over the budget');
  });

  it('rejects an id that does not match its category', () => {
    const wrong = { ...definition, id: 'craft.test' };
    expect(errors(validateModel(wrong, makeModel())).length).toBeGreaterThan(0);
  });

  it('fails when a declared paint slot has no mesh tagged with it', () => {
    const painted = { ...definition, paints: { coat: 'The coat.' } };
    expect(errors(validateModel(painted, makeModel())).map((i) => i.message).join()).toContain('Paint slot "coat"');
    const model = makeModel();
    (model.root.getObjectByName('body') as Mesh).userData['paint'] = 'coat';
    expect(errors(validateModel(painted, model))).toEqual([]);
  });

  it('paints a slot in another stock, leaving the rest of the model alone', async () => {
    const instance = await instantiate(getAsset('character.being'));
    const stockOf = (name: string) => ((instance.node(name) as Mesh).material as PaperMaterial).stockId;
    instance.paint('body', 'teal');
    expect(stockOf('torso')).toBe('teal');
    expect(stockOf('shin_left')).toBe('teal');
    expect(stockOf('skull')).toBe('washi');
  });
});

describe('sheet geometry', () => {
  it('has outward facing top, bottom and edge groups', () => {
    const geometry = sheetGeometry(rect(0, 0, 1, 1), 0.1);
    expect(geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1, 2]);
    const y = geometry.getAttribute('normal');
    expect(y?.getY(0)).toBe(1);
    expect(y?.getY(6)).toBe(-1);
  });

  it('winds top faces towards +y regardless of outline direction', () => {
    for (const outline of [rect(0, 0, 1, 1), rect(0, 0, 1, 1).reverse()]) {
      const position = sheetGeometry(outline, 0.1).getAttribute('position');
      if (!position) throw new Error('no positions');
      const [ax, az, bx, bz, cx, cz] = [
        position.getX(0), position.getZ(0), position.getX(1), position.getZ(1), position.getX(2), position.getZ(2),
      ] as [number, number, number, number, number, number];
      const crossY = (cx - ax) * (bz - az) - (cz - az) * (bx - ax);
      expect(crossY).toBeGreaterThan(0);
    }
  });

  it('counts triangles and draw calls per material slot', () => {
    const mesh = sheet('a', rect(0, 0, 1, 1), { top: 'teal' });
    const stats = modelStats({ root: mesh, clips: [] });
    expect(stats.triangles).toBe(12);
    expect(stats.drawCalls).toBe(3);
    expect(mesh).toBeInstanceOf(Mesh);
  });
});

describe('motion', () => {
  it('easing curves start at 0 and land on 1', () => {
    for (const ease of [fold(), outBack(), spring()]) {
      expect(ease(0)).toBeCloseTo(0, 5);
      expect(ease(1)).toBeCloseTo(1, 5);
    }
  });

  it('fold pulls back, then overshoots', () => {
    const samples = Array.from({ length: 200 }, (_, i) => fold()(i / 199));
    expect(Math.min(...samples)).toBeLessThan(-0.05);
    expect(Math.max(...samples)).toBeGreaterThan(1.02);
  });

  it('spring settles on its target and overshoots when under-damped', () => {
    const s = new Spring(0, 4, 0.4);
    s.target = 1;
    let peak = 0;
    for (let i = 0; i < 300; i++) peak = Math.max(peak, s.update(1 / 60));
    expect(peak).toBeGreaterThan(1.05);
    expect(s.value).toBeCloseTo(1, 2);
  });

  it('spring stays stable through a huge frame hitch', () => {
    const s = new Spring(0, 12, 0.3);
    s.target = 1;
    s.update(1);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(2);
  });
});

describe('registry', () => {
  it('finds the calibration asset without any manual registration', () => {
    expect(getAsset('calibration.fold_test').name).toBe('Fold Test');
  });
});
