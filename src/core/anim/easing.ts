/** Easing curves: t in [0, 1] maps to a value that starts at 0 and ends at 1. */
export type Ease = (t: number) => number;

const PI2 = Math.PI * 2;

export const linear: Ease = (t) => t;
export const outCubic: Ease = (t) => 1 - (1 - t) ** 3;
export const inCubic: Ease = (t) => t ** 3;
export const inOutCubic: Ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Overshoots the target, then settles. `amount` is roughly the overshoot strength. */
export const outBack =
  (amount = 1.70158): Ease =>
  (t) => {
    const u = t - 1;
    return 1 + (amount + 1) * u ** 3 + amount * u ** 2;
  };

/** Pulls back past the start before committing: the wind-up before a fold. */
export const inBack =
  (amount = 1.70158): Ease =>
  (t) =>
    (amount + 1) * t ** 3 - amount * t ** 2;

/** Decaying wobble around the target, for paper that is still ringing after a hard stop. */
export const outElastic =
  (period = 0.32, decay = 9): Ease =>
  (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 2 ** (-decay * t) * Math.sin(((t - period / 4) * PI2) / period) + 1;
  };

/**
 * Wind-up, snap, overshoot, settle: the signature Kami motion.
 * Spends `windup` of the time pulling backwards, then springs past the target.
 */
export const fold =
  (windup = 0.22, pullback = 0.1, overshoot = 2.2): Ease =>
  (t) => {
    if (t < windup) return -pullback * Math.sin((t / windup) * (Math.PI / 2));
    const u = (t - windup) / (1 - windup);
    return -pullback + (1 + pullback) * outBack(overshoot)(u);
  };

/** Closed-form damped spring from 0 to 1, for baking spring motion into clips. */
export const spring =
  (frequency = 4, damping = 0.35): Ease =>
  (t) => {
    if (t >= 1) return 1;
    const w = frequency * PI2;
    const wd = w * Math.sqrt(1 - damping * damping);
    const e = Math.exp(-damping * w * t);
    const raw = 1 - e * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
    // Blend away the residual so the curve lands exactly on 1 at t = 1.
    return raw + (1 - raw) * t ** 8;
  };
