# The paper system

Up to four 1 m players start with a floppy 10 m sheet and physically fold it.
What they build, they mark complete, then use. This is the core of the game.

## Two layers, each doing one job

| | Fold Book | Soft Sheet |
| --- | --- | --- |
| Is | Exact truth | Floppy cloth |
| Code | `src/core/fold/FoldBook.ts` | `src/core/fold/soft/` |
| Numbers | Whole numbers, no physics | XPBD particles |
| Owns | Faces, folds, layer order, legality, cuts | Motion, drape, pins, locks, ground |
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
   hand is, and snaps it to the grid. Halving the paper is sticky, but only within
   0.8 of a step, so the line beside the middle can still be chosen: a plane's wing
   crease sits half a metre off its middle.
   The hand is read against the paper as it lay when the pull began. Paper being
   pulled bends and rolls, and refitting to it each frame misread the hand by metres.
   Once the hand brings paper to a fold, exactly what it would move lifts, turning
   freely on the line like a hinge, so the hand sees the fold it is making. A spring
   back towards flat there was far stronger than paper's weight, and flipped the
   paper beyond the line up to meet the hand.
4. Dropping the pin (click it, or Space) is the one action that creases paper.
   `FoldBook.plan` refuses anything impossible.
5. `SheetPiece.fold` rebuilds the cloth, and layers on a site merge into one
   triangle that is heavier and stiffer. A sheet folded in half really is a
   half-size cloth at double weight, and glued layers never need collision.
6. `SwingFlap` draws the moved faces travelling, because the data changed instantly.

## Rules the Book enforces

- **What moves:** everything connected to the held face without crossing the line.
  That alone gives "only the top flap folds".
- **Carrying:** paper lying on what moves goes over with it. A layer cannot turn out
  from under another, as a hand folding a stack carries the layers on top.
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
| Enter, or Complete | End the folding: flaps become hinges |
| Drag a flap, once complete | Set its angle. Shift turns it freely |
| L | Lock or free the flap under the pointer. Shift: every layer there |
| Lock tool: click | Lock or free a flap |
| Lock tool: drag | Paint a lock on, or off, the paper first pressed |
| U | Free everything |

## Locking paper

A hand folding paper holds the rest of it down. Locking does that job: locked paper
stays still, pressed flat on the table, and nothing moves it until it is freed. What
is not locked is ordinary floppy paper. Paper lifted by a hand pulls the paper it is
joined to, so without a lock the layer under a flap comes up with it.

- **A made fold locks down** with the layers it lands on, as if creased and held
  under a hand. That is the fold's joint with the paper underneath. "Folds stay
  loose" turns this off, and folds then behave as they did before locking existed.
- **Freeing the next flap** is one key: L over it. A layer can be freed while the
  one under it stays locked, so folding only the top layer leaves the rest still.
- **Part of a flap** can be locked or freed by painting it with the Lock tool. The
  brush paints only the paper it was first pressed on, so a hidden layer can be
  locked under a loose one. Shift paints every layer.
- **Locked paper cannot be taken hold of,** and a fold that would move it is refused.
- **A fold that locked paper is in the way of** inks that paper while the hand holds
  it lined up, and L frees exactly that.
- **Following a recipe,** each step frees what it moves, folds, and locks the result.
  Step 9 of the plane is then: L over the top wing, pull it, drop it. No pins.

How the cloth does it:

- A stack with a locked layer in it does not move, and nor do the points loose paper
  shares with it. A loose layer lying there is held too, until a hand lifts it off as
  a flap.
- Locking presses paper flat where it lies, level on the table. Paper locked while
  it hung in the air stayed there, and a bend with all four of its points held then
  divided by nothing in the solver.
- **A pull cannot tear paper.** A hand carries paper only as far as it reaches from
  locked paper, or from another hand, measured on the unfolded sheet. Pulling further,
  the pin strains and a red line runs to where the hand is aiming. Dragged 12 m away
  from locked paper, the paper stretched 13% when a hand could simply get 0.3 m ahead
  of it; with reach it stretches 0.7%, and the hand stops 1 cm from its paper.
  Capping how hard a hand pulls was tried first. It also stopped a hand holding a
  sheet up, because a solver cannot tell weight from paper that is held.

Locked paper is inked with indigo hatching that folds with it. A new lock spreads out
from where it was pressed, and paper that was freed glows for a moment.

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
let go. With nothing holding the body, pulling a wing lifts the whole plane, so the
body is locked instead (see Locking paper).

Paper is joined only where it runs on into other paper. A layer lifted for a fold
shares the line's points with the layer it lay on, through the stack beside them,
but nothing joins those two. Treated as a crease, that line glued them, and folding
a sheet's top layer back lifted the layer under it 3.2 m. It now stays within 1 cm.

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
the pin is dropped, and refuses a fold whose layers would cross. A lifted layer covers nothing,
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

## Finishing a craft

Folding is loose and physical. A finished craft is not. Pressing Complete ends the
folding and turns the paper into stiff plates on hinges (`src/core/fold/craft.ts`):

- **Joints are found, not drawn.** Each outermost free flap becomes a joint, on the
  crease where turning it moves the least paper. That is what picks a wing's fold over
  its lock creases, which would carry the whole body. Anything held by another layer,
  or by two creases, is not a joint and does not light up.
- **Two flaps on one crease are a pair**, one on each face of the stack. They mirror
  each other until told not to, so a plane's lower wing never has to be reached.
- **It stands on its keel.** The first pair's crease runs along the top, with the body
  hanging below it. The lowest point rests on the table.
- **An angle is exact.** Dragging turns a plate about its hinge, snapping every 15
  degrees, or freely with Shift. Nothing is simulated, so a craft is a short list of
  creases and angles, the same on every machine.

The Book does not change, so Back to folding returns the paper as it was and drops
the angles. A recipe's last step does the same thing as a hand: `CompleteStep` marks
it complete and sets an angle.

Only one level of joint exists, so a bent wingtip on a wing is not possible yet. A
joint stops at shut and flat out, but nothing stops it passing through other paper.

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
- **Layers pinned on all sides barely lift.** A visible patch held by a crease or a
  cover along every edge has few free points, so it carries its neighbours along. With
  no pin near it, pulling raises the whole nose.
- **Remembered-side contact** can tangle in principle (Baraff et al.). It only
  matters while paper is loose, and each fold replaces it with the Book's truth.
