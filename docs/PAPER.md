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
| Click paper | Plant a pin on the whole stack |
| Drag | Pull paper. It stays held |
| Click the pin, or Space | Drop it: crease on the guide |
| Right click the pin, or Esc | Let go, no crease |
| Shift + drag | Grip every layer at that point |

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
while joined along its crease. A flap turns on its longest crease, like a book's
spine, and whatever is folded into it on shorter creases comes with it.

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
- **Bottom layers cannot be grabbed** while paper lies on the ground, because the
  camera cannot go under it. So a plane's second wing cannot be lifted by hand.
- **Thick stacks draw thick.** A folded plane reaches 22 layers, about 0.7 m.
- **Remembered-side contact** can tangle in principle (Baraff et al.). It only
  matters while paper is loose, and each fold replaces it with the Book's truth.
