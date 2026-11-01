# The paper system

Up to four 1 m players start with a floppy 10 m sheet and physically fold it.
What they build, they harden, then use. This is the core of the game.

## Two layers, each doing one job

| | Fold Book | Soft Sheet |
| --- | --- | --- |
| Is | Exact truth | Floppy cloth |
| Code | `src/core/fold/FoldBook.ts` | `src/core/fold/soft/` |
| Numbers | Whole numbers, no physics | XPBD particles |
| Owns | Faces, folds, layer order, legality, cuts | Motion, drape, pins, ground |
| Rebuilt | Never | From the Book after every fold |

`SheetPiece` keeps the two in step. Everything that changes paper goes through it.

## Why the Book is possible

Every edge of the tetrakis tiling lies on a straight mirror line, and reflecting
across any of them maps the tiling exactly onto itself. So a folded face always
lands precisely on another lattice triangle, called a site.

That turns layering from a physics problem into an ordered list per site. Tested:
26,720 reflected faces, 0 misses. Coordinates are integers, so rounding error
cannot build up, and the same folds give the same paper on every machine.

Only 45° and 90° lines exist. There is no 22.5°, so a classic crane is impossible.

## What was tried and failed

Do not repeat these. All were measured in throwaway tests:

- **One big spring mesh for everything.** The sheet stands up instead of folding.
  With one side held it hit 6% stretch, 300 m/s spikes and layers flipping. A fold
  cannot travel through 20 rows of stiff hinges quickly enough.
- **Rigid plates forced through that solver.** Up to 49% stretch.

A rigid fold is not a force. It is a plate rotating about a line. Forces are only
for floppy paper, where they work very well.

## How a fold happens

1. Pins hold the paper. Nothing holding it means it slides along with the hand.
2. A player drags a point. The paper rolls over. Letting go does nothing: the pin
   stays, holding the paper up, with its guide showing.
3. `guessFold` finds the line halfway between where the point started and where the
   hand is, and snaps it to the grid. Halving the paper is sticky.
4. Dropping the pin (click it, or Space) is the one action that creases paper.
   `FoldBook.plan` refuses anything impossible.
5. `SheetPiece.fold` rebuilds the cloth, and layers on a site merge into one
   triangle that is heavier and stiffer. A sheet folded in half really is a
   half-size cloth at double weight, and glued layers never need collision.
6. `SwingFlap` draws the moved faces travelling, because the data changed instantly.

## Rules the Book enforces

- **What moves:** everything connected to the held face without crossing the line.
  That alone gives "only the top flap folds".
- **Jams:** a stationary layer on the side paper must rotate towards pins it down.
- **Layer validity:** two creases may nest but not interleave, a flat sheet cannot
  pass through a crease, and two flat sheets crossing a line keep their order.

## Gestures

| Gesture | Meaning |
| --- | --- |
| Hover | Lights up the flap that pulling here would lift |
| Click paper | Plant a pin on the whole stack |
| Drag | Pull paper. It stays held |
| Click the pin, or Space | Drop it: crease on the guide |
| Right click the pin, or Esc | Let go, no crease |
| Shift + drag | Grip every layer at that point |
| Ctrl | Reach the underside: the flap below |
| B | Bend a lifted flap: it stays at that angle |
| U, or Hold it up | Two hands lift the paper by both ends |

## How paper keeps from going through itself

Measured with `countCrossings` while hauling the sheet around. Worst case, before
and after: 382 to 4 crossings, 18% to 5% stretch. In normal folding, 30 to 0.

- **Fixed stiffness.** Floppiness 0.25, set in the sheet asset.
- **Minimum bend radius.** `BEND_LIMIT` stops any uncreased edge past about 49
  degrees, so paper rolls where cloth crumples. Most of the improvement is this.
- **Hands cannot outrun paper.** `HAND_SPEED` caps a pin at 7 m/s.
- **Contact** samples seven points per triangle and searches twice per frame.

## Creases hold

A made fold merges into the stack, so it stays shut. When a flap lifts off, its crease
becomes a hinge with a rest angle of 180 degrees, so it wants to stay closed. A
crease is a line of weakness, so it stiffens far less with thickness than flat paper.
That is why a pin can open a wing when the body is pinned, and why it falls shut when
let go. With nothing pinning the body, pulling a wing lifts the whole plane.

## Flaps

`SheetPiece.peel` keeps a flap out of the merge, so it can lift off its stack
while joined along its crease. A flap turns on one crease, like a book's spine: the
longest one that leaves it free to lift.

A flap is more than one connected piece of paper. A plane's wing is several layers
tucked over each other, each joined to the body along the same crease. So
`turningOn` cuts the paper along the crease, keeps what the flap is joined to as
the part that stays, and swings every other part lying above it. For the plane this
gives exactly the faces its wing fold moved. Testing height alone hid this for a
while: a pull on the wing raised the whole plane, and the height looked right.

Layers are too thin to tell apart by eye, so hovering lights up the flap first.

Anything that shows can be taken hold of. When no whole flap is free, because part
of it is tucked under something, `flapToLift` falls back to the part that can be
seen, and that bends away from whatever covers it. The Book only hears about it if
the pin is dropped, and refuses a fold that would jam. A lifted layer covers nothing,
so opening a wing exposes what was under it.

How far it comes up depends on what still holds it. Measured on the lock tip, with
paper held down beside it: straight after its fold it rises 1 m clear. Once the plane
is folded in half, the tip is creased along the keel with one free point, so it
strains up about 0.36 m. On the finished plane it is buried under the wing and shows
from neither side, so what shows at the nose there is a different layer.

## How high layers sit

`layerHeights` gives every corner of every face a true height. The cloth is one
surface through the middle of the paper, and `SheetView` draws each layer at its
height above that surface. Three rules decide it:

- Every layer clears the one under it, at every corner.
- A sheet can climb at most 6 layers per grid cell.
- Otherwise paper lies as low as it can.

Heights must come from the paper, not from stack counts. Drawing each stack centred
on the cloth, by its count alone, put a thin wing in the middle of a thick nose. One
height per flat plate was closer, but the nose then propped the tail wide open. A
slope limit is what makes a wedge: thick at the nose, pinched at the tail.

Nested creases share one plane at the fold, so only the outermost rim is drawn.

Paper this thin has no spare height. The solver keeps its points on the table, but
rounding curves the surface between them, so `SheetView` clamps that surface too. The
mat also sits back in depth, or a far camera could not tell paper from it.

## Thickness and stiffness

- **Thickness** is 0.0034 m a layer, which is a real sheet of A4 scaled to 10 m. A
  whole plane is about 8 cm at the nose. It is a look, kept apart from `CONTACT_GAP`,
  the 0.03 m the solver holds loose sheets apart by. Thin paper would otherwise tunnel
  through itself.
- **Stiffness** grows with layers squared. A solid beam would be cubed, but folded
  layers slide over each other. Cubed, 22 layers were 10,000 times stiffer than one
  sheet, which read as rubber. A power of 1.5 went too far the other way: a clamped
  strip of 4 layers sagged almost as far as one sheet (8.6 m against 8.8 m). Squared
  it sags 8.3 m, and cubed it sagged 7.2 m.

## Opening wings

A pulled flap wants to shut. Pressing B bends its crease for good at the angle it is
held, as real paper keeps a bend, and the flap stays when every hand lets go. Several
flaps can be open at once: `buildSoftMesh` takes them as a list, so two wings on one
crease stay apart instead of welding together.

A plane lies on one wing, so that wing cannot open against the bench. Hold it up
first, then Ctrl reaches it, straight through any flap already open. The third pin is
free for that, since two hold the body.

A flap has its own surface normals. Shared across a crease, the normals of two
opposed wings cancel, and the top and bottom of each wing collapse together there.

`SpreadStep` does all this at once, for a recipe: it stands the paper on its keel
with its wings open and two hands holding it. It is shape only, so the Book is
unchanged. Folding again shuts every flap, because the Book only knows flat paper.

## Hardening

There is no hinge system for 3D shape. Players hold the paper where they want it
and press Harden, which freezes the current pose into one solid body. It is a
finishing step: there is no rigidity control while building, and hardened paper no
longer folds.

## Opening a pocket

Plain folds cannot do what a hat does when pulled out into a square, because old
creases open as new ones form. `reshape` handles this as a change to the crease
pattern: it lays the paper out again from the new creases, refuses a pattern that
cannot lie flat, then searches for a layer order. Several orders are usually valid,
so an `OpenStep` can name the folds it has to leave possible.

Worked out for the boat: a hat opens by flattening one diagonal and creasing the
centre line. The other diagonal stays folded. That asymmetry is what instructions
mean by "tuck one flap under the other".

## Recipes

Recipes follow real sources and run one step at a time in the Fold tab.

- **Nakamura plane.** Southwest Adopt-A-Pilot sheet, all folds, cut to 6 by 10 m.
  One change: the triangle folds 1 m below its base, because a 45 degree fold puts the
  corner exactly on the tip otherwise, leaving no tip to lock with. The classic dart
  cannot be made at all: its second fold is 22.5 degrees.
- **Dart.** The same plane with its tail cut off through every layer and a 0.5 m keel,
  so each wing comes to a point, after an owner reference. The wings still sweep at
  45 degrees and start 0.5 m behind the nose: a true dart needs 22.5 degree lines.
- **Paper boat.** Nottinghamshire Mayflower sheet, through step 9, cut to 8 by 10 m.
  Steps 10 and 11 are pulling it open by hand.

## Cutting

Cuts follow grid lines and go through every layer at that spot. Pieces that no
longer join become separate sheets. A slit stays one piece and stays open.

## Numbers on the Intel UHD development machine

| | 1 m cells | 0.5 m cells |
| --- | --- | --- |
| Triangles simulated | 800 | 3,200 |
| Finest fold | 0.5 m | 0.25 m |
| Simulation | 4 to 13 ms per step | 16 to 60 ms per step |
| Frame rate, Balanced | 23 to 39 fps | 10 to 27 fps |

## Known weak spots

- **The boat stops flat.** The recipe reaches the diamond of step 9, but pulling it
  open into a hull has not been shown to work.
- **The boat's diamond has small tips showing.** They are the brim ends, which real
  paper tucks away. Tucking them first left no workable layer order.
- **An opening can stall the frame.** The layer search is capped, but it runs on the
  main thread and can take a few seconds.
- **A plane held up rolls.** Two hands make an axis, so the weight of an open wing turns
  it, and the wing below can end up edge-on. Orbit the camera to reach it.
- **Layers pinned on all sides barely lift.** A visible patch held by a crease or a
  cover along every edge has few free points, so it carries its neighbours along. With
  no pin near it, pulling raises the whole nose.
- **Remembered-side contact** can tangle in principle (Baraff et al.). It only
  matters while paper is loose, and each fold replaces it with the Book's truth.
