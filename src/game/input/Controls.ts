import { IDLE } from '../sim/GameSim';
import type { Intent } from '../sim/GameSim';

/** Metres the hands move per wheel notch. */
const RAISE_PER_NOTCH = 0.08;
/** Radians the view turns per pixel of mouse. */
const LOOK_SPEED = 0.0042;
const PITCH_LOW = 0.08;
const PITCH_HIGH = 1.25;

/**
 * Keys and mouse, turned into an intent for whichever being is selected. Moving is
 * relative to where the camera looks. Presses that happen once, grab and press, are
 * held until the sim takes them, so a quick tap between steps is never lost.
 *
 * WASD walk, Shift runs, Space jumps, E grabs or lets go, F presses paper down, the
 * wheel raises or lowers the hands, 1 2 3 choose a being, R lays out a fresh sheet.
 * The mouse looks around while the pointer is locked (click the world), or while
 * the right button is held.
 */
export class Controls {
  /** Which being the keys steer. */
  selected = 0;
  /** Where the camera looks: radians around y (0 faces +z) and down from level. */
  yaw = 0;
  pitch = 0.42;
  private readonly held = new Set<string>();
  private grab = false;
  private press = false;
  private jump = false;
  private raise = 0;
  private looking = false;
  private readonly listeners = new Set<() => void>();
  private readonly resets = new Set<() => void>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly beings: number,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /** Called when the selected being changes. */
  onSelect(listener: () => void): void {
    this.listeners.add(listener);
  }

  /** Called when R asks for a fresh sheet. */
  onReset(listener: () => void): void {
    this.resets.add(listener);
  }

  /** One intent per being for the next sim step. Only the selected being gets the keys. */
  intents(): Intent[] {
    const intents: Intent[] = Array.from({ length: this.beings }, () => IDLE);
    const ahead = (this.held.has('KeyW') ? 1 : 0) - (this.held.has('KeyS') ? 1 : 0);
    const side = (this.held.has('KeyD') ? 1 : 0) - (this.held.has('KeyA') ? 1 : 0);
    // Forward is where the camera looks; right is a quarter turn clockwise from it.
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const x = fx * ahead - fz * side, z = fz * ahead + fx * side;
    const length = Math.hypot(x, z) || 1;
    intents[this.selected] = {
      move: { x: x / length, z: z / length },
      run: this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
      grab: this.grab,
      press: this.press,
      raise: this.raise,
      jump: this.jump,
    };
    this.grab = false;
    this.press = false;
    this.jump = false;
    this.raise = 0;
    return intents;
  }

  select(index: number): void {
    if (index < 0 || index >= this.beings || index === this.selected) return;
    this.selected = index;
    for (const listener of this.listeners) listener();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= this.beings) this.select(digit - 1);
    if (event.code === 'KeyE') this.grab = true;
    if (event.code === 'KeyF') this.press = true;
    if (event.code === 'KeyR') for (const listener of this.resets) listener();
    if (event.code === 'Space') {
      event.preventDefault();
      this.jump = true;
    }
    this.held.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.looking = false;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button === 2) this.looking = true;
    else if (event.button === 0 && document.pointerLockElement !== this.canvas) void this.canvas.requestPointerLock?.();
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 2) this.looking = false;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.looking && document.pointerLockElement !== this.canvas) return;
    this.turn(event.movementX, event.movementY);
  };

  /** Turns the view by a mouse movement, in pixels. */
  turn(dx: number, dy: number): void {
    this.yaw -= dx * LOOK_SPEED;
    this.pitch = Math.max(PITCH_LOW, Math.min(PITCH_HIGH, this.pitch + dy * LOOK_SPEED));
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.raise += (event.deltaY < 0 ? 1 : -1) * RAISE_PER_NOTCH;
  };
}
