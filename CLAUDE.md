# Kami

A co-op adventure in a world made entirely of paper. Players fold origami tools
to solve the journey: a plane to leap off a cliff, a boat to cross the ocean.
Kami (紙) means paper; a homophone (神) means spirit.

The owner directs and verifies; Claude builds. Treat their critique as the bar.

## The rules

These are the owner's rules. They override convenience.

1. **Commit after every big win.** Small, working, described commits.
2. **Assets come first.** Models, animations, collision and paper look are built
   and proven in the Asset Library before gameplay touches them.
3. **See what you build.** Run `npm run capture` and actually read the images.
   Critique them. Never call visual work done from the code alone.
4. **Reference images are a target, not a suggestion.** When the owner shares an
   image, match it as closely as possible while staying optimized. Do not stop
   at 50% because it is acceptable. Go to 90%.
5. **Bare minimum artifacts first.** Build only what is needed to test the
   mechanics. Multiplayer comes later, but see "Multiplayer" below.
6. **Modular, clean code. No throwaway prototypes.** Prototype-quality code is
   how past attempts failed: it gets forgotten, then hardcoded assumptions make
   models impossible to swap. If it ships to the repo, it is written properly.
7. **Minor details are the job.** Particles, squash and stretch, wind-up,
   overshoot, springy easing, trails, inertia, screen shake. Everything that
   moves gets juice, including the UI.
8. **Typography is design.** The font is what separates this from generic AI
   output. See `docs/ART_DIRECTION.md`. Never fall back to a default font.
9. **Use the internet for visual reference.** Claude's visual instincts are weak
   without it. Look at real images, in the browser, before designing.

## The architecture rule that matters most

**Game code never touches a mesh.** It uses an asset's id, named clips, named
sockets and collider data. That is the whole point of `src/core/asset/types.ts`.

- No hardcoded offsets, sizes, vertex data or colours in game code.
- Colour comes from paper stocks (`src/core/paper/stocks.ts`), never hex in an asset.
- Moods come from lighting presets, never ad hoc lights.
- A model is replaced by changing its asset file alone. `validateModel` proves it.

If a task seems to need a model detail in game code, add a socket, a clip or a
collider to the contract instead.

## The paper system

Paper is the core of the game. Read `docs/PAPER.md` before touching it. In short:
the **Fold Book** is exact truth with no physics, the **Soft Sheet** is floppy
cloth rebuilt from the Book after every fold. Never make rigid folds emerge from
forces: that was tested and fails badly. Never let either side own the other's job.

## Layout

```
src/core/        Engine. Must never import from library/ or game code.
  anim/          Easing, springs, clip baking
  asset/         The contract, registry, validation, glTF loading
  fold/          The Fold Book, lattice, recipes, fold guide, SheetPiece
  fold/soft/     The Soft Sheet solver, in typed arrays with no three.js
  fx/            Scraps, screen shake
  paper/         Grain bake, PaperMaterial, stocks, cut sheet geometry
  render/        Renderer, post pipeline, quality tiers, lights, sheet drawing
  sim/           Fixed-step clock
src/assets/      One `*.asset.ts` per model, one `*.sheet.ts` per sheet. Auto-registered.
src/library/     The Asset Library app: stage, Fold Lab, panels, styles.
tools/           capture.mjs and labcheck.mjs, the eyes of this project.
tests/           Contract and motion tests.
docs/            Art direction, asset pipeline, roadmap.
```

## Commands

```
npm run dev          Asset Library at localhost:5173
npm run verify       Typecheck, tests, screenshots, GLB round trip, benchmark
npm run check:lab    Plays the Fold Lab with a real mouse
npm run capture -- --suite smoke
npm run capture -- --asset <id> --clip <name> --time 0.6 --camera side --bare
npm run capture -- --stock kraft --zoom 4 --lighting golden --bare
npm run capture -- --turnaround <id>
npm run capture -- --sheet sheet.standard --recipe plane --settle 40 --bare
```

Run `npm run verify` before every commit. Screenshots land in `.shots/`.

## Multiplayer

Not being built yet, but do not make it hard. When gameplay starts, keep
simulation state separate from presentation, drive it from input, and keep it
free of three.js objects where practical.

## Performance

The development machine has an **Intel UHD integrated GPU**, so it is a useful
low-end target. Real numbers come from `kami.benchmark()`, printed by the smoke
suite. Never guess; measure. Do not raise the default quality tier without
checking it. One material per stock, one shader program, instancing for
repeats, baked textures shared across everything.

## Tooling traps

- **Do not rewrite source files with PowerShell `Get-Content`/`Set-Content`.**
  PowerShell 5.1 corrupts non-ASCII characters and adds a BOM. Use the Edit tool.
- `PCFSoftShadowMap` was removed in three r186. `PCFShadowMap` is soft now.
- Three.js divides diffuse by pi, so light intensities near 3 mean full light.
- glTF strips `.` and other characters from names, so node names are snake_case.
- `GTAOPass` writes `scene.overrideMaterial` itself. Use `RenderPass.overrideMaterial`.
- Never spread a mesh-sized array into a call (`push(...list)`). It overflows the stack.
- Test what a player sees, not a proxy. A boat "passed" on fold count while flat.

## Writing commits

Say what changed and why. End with the attribution line the session specifies.
