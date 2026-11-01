/**
 * A damped spring you drive frame by frame, for motion that has to react to
 * input (camera, UI, squash and stretch). For authored motion use clips.
 */
export class Spring {
  value: number;
  velocity = 0;
  target: number;

  constructor(
    initial = 0,
    /** Oscillations per second. */
    public frequency = 4,
    /** 1 is critically damped; lower wobbles more. */
    public damping = 0.5,
  ) {
    this.value = initial;
    this.target = initial;
  }

  /** Sets value and target together, killing any motion. */
  snap(value: number): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  /** Adds velocity for a one-off kick; the spring pulls itself back. */
  kick(velocity: number): void {
    this.velocity += velocity;
  }

  update(dt: number): number {
    const w = this.frequency * Math.PI * 2;
    // Fixed substeps keep the spring stable through frame hitches.
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const accel = w * w * (this.target - this.value) - 2 * this.damping * w * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  get settled(): boolean {
    return Math.abs(this.target - this.value) < 1e-3 && Math.abs(this.velocity) < 1e-3;
  }
}
