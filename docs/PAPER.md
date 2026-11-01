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
2. A player drags a point. The cloth moves freely.
3. `guessFold` finds the line halfway between where the point started and where it
   is now, and snaps it to the grid. Halving the paper is sticky.
4. Releasing commits. `FoldBook.plan` refuses anything impossible.
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
| Click | Plant a pin |
| Drag, release | Fold |
| Drag, wheel up, release | Hold it in the air |
| Shift + drag | Grip every layer at that point |

The wheel exists because grid lines are 0.5 m apart, so every release is close to
some valid fold. "Holding" had to be a deliberate act.

## Flaps

`SheetPiece.peel` keeps a flap out of the merge, so it can lift off its stack
while joined along its crease. A flap turns on its longest crease, like a book's
spine, and whatever is folded into it on shorter creases comes with it.

## Hardening

There is no hinge system for 3D shape. Players hold the paper where they want it
and harden it, which freezes the current pose. Between 0 and 1 it is springy shape
memory, and at 1 it is one solid body. Hardened paper no longer folds.

## Cutting

Cuts follow grid lines and go through every layer at that spot. Pieces that no
longer join become separate sheets. A slit stays one piece and stays open.

## Numbers on the Intel UHD development machine

| | 1 m cells | 0.5 m cells |
| --- | --- | --- |
| Triangles simulated | 800 | 3,200 |
| Finest fold | 0.5 m | 0.25 m |
| Simulation | 1 to 3 ms per step | 16 to 20 ms per step |
| Frame rate, Balanced | about 32 fps | about 27 fps |

## Known weak spots

- **The boat is rough.** It opens into a real V hull with pointed ends, then rests
  on one side of the hull. The classic hat boat was tried and could not open,
  because its corners lie on top of the layer that has to lift.
- **Bottom layers cannot be grabbed** while paper lies on the ground, because the
  camera cannot go under it. So a plane's second wing cannot be folded on its own.
- **Remembered-side contact** can tangle in principle (Baraff et al.). It only
  matters while paper is loose, and each fold replaces it with the Book's truth.
