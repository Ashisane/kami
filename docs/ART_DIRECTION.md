# Art direction

A living document. Every decision here was checked on screen, not assumed.

## The world

Everything is paper, and it should feel like a handmade thing you could touch.

| Reference | What we take from it |
| --- | --- |
| Paper Mario: The Origami King | High-key daylight, saturated colour, crisp cut edges with a pale core, visible tooth on large surfaces |
| Tearaway | Hard folded facets, warm dramatic light, mixed printed paper for variety |
| Photographed paper dioramas | Saturated stock colours, layered depth from soft contact shadows, miniature feel |

Shared rules that came out of looking at those:

- **Facets stay flat and creases stay crisp.** A fold is a hard change in light.
- **Cut edges are lighter than the face.** The pale core is the single strongest cue that something is paper, so every sheet has one.
- **Origami paper has two sides.** Colour out, pale reverse in.
- **Shade stays colourful.** Paper bounces light. Shadows never go black.
- **Light glows through.** A sheet with the sun behind it lights up, with the fibres in silhouette.

## Type

**Display: Potta One.** A heavy Japanese display face with slightly uneven,
scissor-cut edges. It reads as paper without being a themed gimmick, and it has
real kana and kanji for the name and the 紙 mark.

**Reading: Kiwi Maru.** A warm rounded serif with some personality. It stays
legible at 13px.

How they were chosen: twenty candidates were rendered as real UI specimens
(title, headline, small interface text with numbers) on coloured paper, then
compared by eye. Rejected finalists:

- Darumadrop One is lovely, but it is the typeface PEAK is built on, so using it would read as an imitation.
- Mochiy Pop One is friendly but looks like app branding.
- Cherry Bomb One falls apart at small sizes.
- Rampart One and Hachi Maru Pop are unreadable in interface text.

Rules: two families only. Display for titles, tabs and values. Reading for
everything else. Numbers use tabular figures.

## Colour

All colour lives in `src/core/paper/stocks.ts`. Nine stocks: Washi, Kraft,
Vermilion, Marigold, Sakura, Moss, Teal, Indigo, Sumi. The interface reuses the
same colours in `src/library/styles/tokens.css`.

Tone mapping is Neutral because it keeps hues true. ACES and AgX shift a stock
away from the colour it was picked to be.

## The paper material

One `PaperMaterial`, one shader program, shared textures baked at startup.

- Fibres are real stamped curves, not stretched noise, in tiling textures.
- Grain is projected from the rest pose, so it needs no UVs and stays glued to folding paper.
- Flat facets project along their own plane, so grain never stretches on a slope.
- Each stock tunes fibre size, relief, cloudiness, flecks, long threads and how much light passes through.

Keep relief subtle. Strong relief looked like leather under a low sun. At
gameplay distance paper should read as a fine tooth on a flat colour.

## Motion

Every move has character. The signature is `fold()` in `src/core/anim/easing.ts`:
wind up, snap, overshoot, settle.

- Heavy things squash when they take weight, and stretch when they move fast. Volume is preserved.
- Authored motion is baked into clips. Reactive motion uses `Spring`.
- Impacts get a scrap burst and a little screen shake. Shake is trauma squared, so small hits stay subtle.
- The interface follows the same rules: buttons squash on press and spring back.

## Lighting

Presets are in `src/core/render/lighting.ts`.

- **Paper noon** is the default look: bright, clean, three-quarter sun.
- **Golden hour** is warm, with long shadows.
- **Lantern dusk** is backlit, and is the test for light through paper.
- **Overcast test** is neutral. Use it to judge form with no mood flattering it.

Never put the sun behind the camera. It hides every shadow and flattens the
model. That mistake was made once already.

## Sources

- [PEAK's font, on the community wiki](https://peak.wiki.gg/wiki/Font)
- [Paper Mario creative team on The Origami King](https://gameluster.com/paper-mario-creative-team-talk-the-origami-king/)
- [Paper material model: fibre fields, torn outlines, transmission](https://www.skills.sh/mengto/skills/3d-paper-material)
