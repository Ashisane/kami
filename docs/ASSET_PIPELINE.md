# Asset pipeline

Everything in the game is an asset, and an asset is a contract. The model can
change completely as long as the contract still holds.

## Adding an asset

Create `src/assets/<anywhere>/<name>.asset.ts` with a default export. It appears
in the library by itself.

```ts
import { defineAsset } from '@/core/asset/types';

export default defineAsset({
  id: 'craft.paper_plane',        // category.snake_case, stable forever
  name: 'Paper Plane',
  category: 'craft',
  status: 'blockout',             // blockout, draft, final
  description: 'Lets the crew glide off high ground.',
  source: { kind: 'procedural', build },
  clips: ['fold', 'glide'],       // names game code may play
  sockets: {
    pilot: { node: 'socket_pilot', description: 'Where a player rides.' },
  },
  colliders: [
    { name: 'hull', role: 'solid', shape: 'box', size: [0.6, 0.2, 1.8], node: 'body' },
  ],
  maxTriangles: 400,
  references: ['/references/paper_plane.png'],
});
```

## Replacing it with a Blender model

Change one line:

```ts
source: { kind: 'gltf', url: '/models/paper_plane.glb' },
```

No game code changes. The new file must keep the contract:

| Thing | Rule in Blender |
| --- | --- |
| Units | Metres, Y up on export |
| Node names | snake_case, because glTF strips `.` and similar characters |
| Sockets | An empty named exactly as the definition says, such as `socket_pilot` |
| Colliders | Any `node` they follow must still exist under that name |
| Clips | Action names match the definition, such as `fold` |
| Paper | Name a material `paper:vermilion` and it becomes that stock automatically |

If anything is missing, the Asset tab shows what broke and `npm run verify` fails.
A renamed bone is caught, even though in three.js it would otherwise silently
stop animating.

`npm run verify` also exports every procedural asset to GLB and loads it back
through the real loader, so this path stays proven.

## Building procedurally

- `sheet(name, outline, { top, bottom, edge })` cuts paper with thickness and three material slots.
- Hinges are named `Group`s. Hinge axes sit on the fold line.
- `clip()`, `hinge()`, `scale()` and `move()` bake motion, keeping wind-up and overshoot.
- Colour is always a stock id.

`src/assets/calibration/fold-test.asset.ts` is a complete worked example.

## Matching a reference image

1. Save it to `public/references/` and list it in `references`.
2. In the library, use Reference to overlay it or pin it beside the model.
3. Capture from the same angle and compare side by side, in clay first, then paper.
4. Keep going until it is a 90% match. Say what still differs when reporting back.

## Checklist before calling an asset done

- `npm run capture -- --turnaround <id>` reviewed from every angle
- Each clip scrubbed at ⅒ speed: wind-up, overshoot and settle all read
- Collision fit stays high through each clip
- Checked in Paper noon and Overcast test at least
- Under its triangle budget
- `npm run verify` passes
