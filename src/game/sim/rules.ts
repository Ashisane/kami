/**
 * How a being moves and handles paper, in metres and seconds. One place, so the
 * feel can be tuned without hunting through the sim.
 */
export const RULES = {
  walkSpeed: 1.6,
  runSpeed: 3.4,
  /** How quickly a being reaches the speed it wants, per second. */
  acceleration: 14,
  /** How quickly it turns to face where it is going, in radians per second. */
  turnRate: 11,
  /** Carrying paper slows a being, and thicker stacks slow it more. */
  carryingPace: 0.65,

  /** Body capsule: radius, and the spine's bottom and top above the ground. */
  bodyRadius: 0.22,
  bodyBottom: 0.15,
  bodyTop: 0.78,

  /** Hand height while holding paper, and how far it can be raised or lowered. */
  handRest: 0.55,
  handLowest: 0.05,
  handHighest: 1.45,
  /** How far in front of the body the hands hold paper. */
  arm: 0.42,
  /** Where a hand closing on paper reaches to: ahead, low, and how far around that. */
  grabAhead: 0.35,
  grabHeight: 0.15,
  grabReach: 0.65,
  /** A hand that has moved this far from where it took hold is carrying the paper. */
  carryStart: 0.1,

  /** Metres the paper holds a being back by before it counts as straining. */
  heldBack: 0.015,
  /** Seconds paper counts as taut after it last held a being back. */
  tautMemory: 0.25,
  /** A being walking on paper plants its feet anew once it has moved this far. */
  footStep: 0.3,
  /** Paper higher than this under a being is not underfoot. */
  footReach: 0.12,

  /** Speed a jump leaves the ground at, and how fast a being falls: about 0.4 m high, half a second in the air. */
  jumpSpeed: 3.4,
  gravity: 14,
  /** How much of its usual steering a being has in the air. */
  airControl: 0.3,

  reachSeconds: 0.35,
  pressSeconds: 0.55,
  stumbleSeconds: 0.8,
  /** Speed a being pitches forward at when its grip slips. */
  stumbleSpeed: 2.2,
} as const;
