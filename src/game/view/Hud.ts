import type { Being, GameSim, SimEvent } from '../sim/GameSim';

/** What each kind of event says, when it says anything. */
const SAYS: Partial<Record<SimEvent['kind'], string>> = {
  whiff: 'Nothing in reach.',
  slip: 'The paper pulled out of their hands.',
  press: 'Creased.',
  unfold: 'Opened back out.',
};
const MESSAGE_SECONDS = 2.4;
/** The keys, and what each does, in the order a player learns them. */
const HELP: readonly [string, string][] = [
  ['WASD', 'walk'],
  ['Shift', 'run'],
  ['Space', 'jump'],
  ['E', 'grab or let go'],
  ['F', 'press it down'],
  ['Wheel', 'raise hands'],
  ['Right drag', 'look'],
  ['R', 'fresh sheet'],
];

/**
 * The crew along the bottom, one card each, and a line of news at the top. The
 * selected card lifts, and a card shakes when its being strains or slips.
 */
export class Hud {
  readonly element = document.createElement('div');
  private readonly cards: { card: HTMLElement; status: HTMLElement; tension: HTMLElement }[] = [];
  private readonly message = document.createElement('p');
  private messageLeft = 0;

  constructor(names: readonly { name: string; colour: string }[]) {
    this.element.className = 'hud';
    this.message.className = 'hud-message';
    const crew = document.createElement('div');
    crew.className = 'hud-crew';
    names.forEach(({ name, colour }, i) => {
      const card = document.createElement('div');
      card.className = 'hud-card';
      card.style.setProperty('--colour', colour);
      const key = document.createElement('kbd');
      key.textContent = String(i + 1);
      const title = document.createElement('strong');
      title.textContent = name;
      const status = document.createElement('span');
      const tension = document.createElement('i');
      card.append(key, title, status, tension);
      crew.append(card);
      this.cards.push({ card, status, tension });
    });
    const help = document.createElement('p');
    help.className = 'hud-help';
    for (const [key, does] of HELP) {
      const pair = document.createElement('span');
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      pair.append(kbd, ` ${does}`);
      help.append(pair);
    }
    this.element.append(this.message, crew, help);
  }

  update(sim: GameSim, selected: number, dt: number): void {
    sim.beings.forEach((being, i) => {
      const entry = this.cards[i];
      if (!entry) return;
      entry.card.classList.toggle('selected', i === selected);
      const action = sim.action(being);
      entry.card.classList.toggle('straining', action === 'strain' || action === 'stumble');
      entry.status.textContent = statusOf(being, action);
      entry.tension.style.width = `${Math.round(being.strain.tension * 100)}%`;
    });
    this.messageLeft = Math.max(0, this.messageLeft - dt);
    this.message.classList.toggle('shown', this.messageLeft > 0);
  }

  /** Says something about an event, if it is worth saying. */
  tell(event: SimEvent): void {
    const text = event.kind === 'refuse' ? event.reason : SAYS[event.kind];
    if (!text) return;
    this.message.textContent = text;
    this.message.classList.toggle('refused', event.kind === 'refuse');
    this.messageLeft = MESSAGE_SECONDS;
    // Restart the pop-in, even for the same words twice.
    this.message.classList.remove('pop');
    void this.message.offsetWidth;
    this.message.classList.add('pop');
  }
}

function statusOf(being: Being, action: string): string {
  if (action === 'stumble') return 'Stumbling';
  if (action === 'strain') return 'Straining';
  if (being.grip?.unfolding) return 'Opening a fold';
  if (being.grip?.aim?.reachable) return 'Ready to crease';
  if (being.grip) return 'Holding paper';
  if (being.y > 0) return 'In the air';
  if (being.foothold) return 'Standing on paper';
  return 'Free hands';
}
