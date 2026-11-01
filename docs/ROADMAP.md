# Roadmap

## Done: foundation

- Project, rules and asset contract
- Paper material, stocks, lighting moods and quality tiers
- Asset Library: catalogue, stage, motion, collision, paper and light panels
- Capture tool, tests, GLB round trip

## Next: bare minimum artifacts

Only what is needed to test the mechanics, each proven in the library first.

1. Player character blockout, with idle, walk, jump, fold and carry clips
2. Blank sheet of paper, the raw material of every fold
3. Paper plane, folded from a sheet, with a glide clip
4. Paper boat, folded from a sheet, with a float clip
5. Terrain pieces: ground, cliff edge, water

## Then: mechanics, single player

1. Character controller and physics, using the collider data
2. The fold interaction, the core of the game
3. Plane gliding and boat floating
4. A small test level: walk, fold a plane, leap a gap, fold a boat, cross water

## Later

- Multiplayer
- Real content, levels and final art

## Open questions

- **Performance target.** On the development Intel UHD GPU at 1440×900, with
  one small model on stage: High 20 fps, Balanced 36 fps, Fast 84 fps. Real
  scenes cost more, so contact shadows need a cheaper approach or an explicit
  decision that low-end players use Fast.
- **Distribution.** Decide before multiplayer: browser, or a desktop wrapper for Steam.
