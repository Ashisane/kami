# In the world: three beings and a sheet

The Fold Lab looks down on paper and folds it with a mouse. This experiment puts
you inside the world instead, as one of three 1 m beings around the 10 m sheet.
It is where the paper meets hands, feet and bodies.

Open `localhost:5173/play.html` with `npm run dev`. `npm run check:play` plays it
with real keys and saves `.shots/play-*.png`.

| Key | Does |
| --- | --- |
| 1 2 3 | Choose the being the keys steer. The camera glides over |
| W A S D | Walk, relative to where the camera looks. Shift runs |
| E | Take hold of the paper in reach, or let go |
| Space | Press the held paper down: crease it, or open a flap back out |
| Wheel | Raise or lower the hands |
| Right drag, or click to lock the pointer | Look around |
| R | A fresh sheet, and the crew back at the start |

Beings not being steered keep doing what they were: a being holding paper keeps
holding it, still, until it is chosen again.

## Shape of the code

| Part | Is | three.js? |
| --- | --- | --- |
| `src/game/sim/` | `GameSim`: beings and paper stepped at 60 Hz from intents alone | No |
| `src/game/input/` | Keys and mouse to an intent for the chosen being | No |
| `src/game/view/` | Draws the sim: paper, beings, guides, camera, cards | Yes |

The sim never holds a three.js object, so the same inputs give the same world,
which a server can run later. Paper rules come from core and are shared with
the Lab: `foldIntent.ts` lines folds up the same way for a mouse or a hand, and
`paperPoints.ts` finds paper under feet and in reach.

## Every case, and what happens

Each one is a test in `tests/game.test.ts`, played headless.

| Case | What happens |
| --- | --- |
| Grab with nothing in reach | Hands close on air |
| Grab paper | Both hands pinch the nearest paper in reach and lift it to hand height. By a flap's edge, the flap wins over the single sheet past it |
| Two hold the same paper | Allowed |
| Walk holding paper | It drags along. Carrying slows a being, thicker stacks more |
| Run off while two others hold still | Taut paper stops the runner, which strains. After 0.8 s of pulling, its grip slips and it stumbles. Paper never tears |
| Two pull apart | Both strain; one grip gives |
| Lift the sheet | Raised hands lift it between them. Let go and it comes down |
| Fold | Carry paper over a fold line and press. It creases on the snapped line, and hands on paper that moved let go |
| Fold with someone on the moving paper | Refused: someone is standing on it |
| Unfold | Take a flap, carry it back across its crease, and press. The crease stays as a faint line |
| Stand on paper | Feet hold it down. Dragged hard, it slides out from under, and the being wobbles |
| Walk into hanging paper | It is pushed aside, never through a being |

## What was learned

- **Folding is a crew job.** Alone, a being dragging an edge across drags the whole
  sheet with it, and folded it over its own head. One holds the far edge; the
  other carries a corner along beside the sheet.
- **Taut paper must stop a being, never drag one.** Snapping a being back to its
  hands made the weight of a held sheet walk two holders towards each other. Only
  the part of a step that took the hands past the paper's reach is undone.
- **Paper holds back by reach, not force.** The Lab's reach rule carries over: a
  hand gets only as far as the paper spans from the other hands.
- **A flap a hand carried open is already where it lands.** Laying it out by the
  frame of the paper it joins stretched it 43% wherever that paper was held up.
- **Big flaps swing rubbery.** Carried fast, a 3.5 m flap stretches up to 12% for a
  moment before it settles. Lifted at two points and dropped, stiff paper can leave a
  ridge standing, like card.
