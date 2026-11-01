import type { AnimationAction } from 'three';
import type { AssetInstance } from '@/core/asset/AssetInstance';

type Listener = () => void;

/**
 * The transport for the timeline. The deck owns time and pokes it into the
 * action, so scrubbing, slow motion and capture are all the same code path.
 */
export class ClipDeck {
  instance: AssetInstance | null = null;
  clipName: string | null = null;
  time = 0;
  playing = false;
  loop = false;
  speed = 1;

  private action: AnimationAction | null = null;
  private readonly listeners = new Set<Listener>();

  get duration(): number {
    return this.action?.getClip().duration ?? 0;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  attach(instance: AssetInstance | null): void {
    this.instance = instance;
    this.action = null;
    this.clipName = null;
    this.time = 0;
    this.playing = false;
    const first = instance?.clipNames[0];
    if (first) this.select(first);
    else this.emit();
  }

  select(name: string): void {
    const { instance } = this;
    if (!instance) return;
    instance.mixer.stopAllAction();
    this.action = instance.action(name);
    this.action.reset();
    this.action.play();
    this.action.paused = true;
    this.clipName = name;
    this.seek(0);
  }

  play(): void {
    if (!this.action) return;
    if (this.time >= this.duration) this.time = 0;
    this.playing = true;
    this.emit();
  }

  pause(): void {
    this.playing = false;
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(time: number): void {
    if (!this.action || !this.instance) return;
    this.time = Math.min(this.duration, Math.max(0, time));
    this.action.time = this.time;
    this.instance.mixer.update(0);
    this.emit();
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    this.emit();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.emit();
  }

  update(dt: number): void {
    if (!this.playing || !this.action) return;
    let next = this.time + dt * this.speed;
    if (next >= this.duration) {
      if (this.loop) next %= this.duration;
      else {
        next = this.duration;
        this.playing = false;
      }
    }
    this.seek(next);
  }
}
