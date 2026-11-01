# Roadmap

## Done: foundation

- Project, rules and asset contract
- Paper material, stocks, lighting moods and quality tiers
- Asset Library: catalogue, stage, motion, collision, paper and light panels
- Capture tool, tests, GLB round trip

- The paper: Fold Book, Soft Sheet, Fold Lab, cut, finished crafts (see `docs/PAPER.md`)

## Next: finish the paper

1. Owner plays the Fold Lab by hand and critiques the feel
2. Decide how a flat boat opens into a hull
3. Pick the final grid size from that playtest

## Then: mechanics

1. Player character blockout, with idle, walk, jump, fold and carry clips
2. Paper meets the world: a finished craft becomes a physics body
3. Plane gliding and boat floating
4. Terrain pieces: ground, cliff edge, water
5. A small test level: walk, fold a plane, leap a gap, fold a boat, cross water

## Later

- Multiplayer
- Real content, levels and final art

## Open questions

- **Performance target.** On the development Intel UHD GPU at 1440×900, with
  one small model on stage: High 14 to 20 fps, Balanced 24 to 36 fps, Fast 45
  to 84 fps. The lower figures were measured with a second library open on the
  same GPU. Real scenes cost more, so contact shadows need a cheaper approach
  or an explicit decision that low-end players use Fast.
- **Distribution.** Decide before multiplayer: browser, or a desktop wrapper for Steam.
