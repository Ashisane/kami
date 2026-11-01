/**
 * Runs simulation at a fixed rate, however fast the screen draws. Physics stays
 * the same on every machine, which multiplayer will depend on.
 */
export class FixedStep {
  private accumulator = 0;

  constructor(
    readonly step = 1 / 60,
    /** Steps allowed per frame, so a slow frame cannot snowball into a slower one. */
    private readonly maxSteps = 3,
  ) {}

  /** Calls `tick` as many times as this frame's time covers. */
  advance(dt: number, tick: (step: number) => void): void {
    this.accumulator = Math.min(this.accumulator + dt, this.step * this.maxSteps);
    while (this.accumulator >= this.step) {
      tick(this.step);
      this.accumulator -= this.step;
    }
  }
}
