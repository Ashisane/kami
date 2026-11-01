import { flash, h } from './dom';

export function button(label: string, onClick: () => void, options: { title?: string; primary?: boolean } = {}): HTMLButtonElement {
  return h(`button.btn${options.primary ? '.btn-primary' : ''}`, { type: 'button', title: options.title, onclick: onClick }, label);
}

export function copyButton(label: string, text: () => string): HTMLButtonElement {
  const element = button(label, () => {
    void navigator.clipboard?.writeText(text());
    element.textContent = 'Copied!';
    flash(element, 'stamped');
    window.setTimeout(() => (element.textContent = label), 1200);
  });
  return element;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (value: number) => string;
  onInput: (value: number) => void;
}

export function slider({ label, min, max, step, value, format = String, onInput }: SliderOptions): HTMLElement {
  const readout = h('output.field-value', {}, format(value));
  const input = h('input.slider', { type: 'range', min, max, step, value, 'aria-label': label });
  const paint = () => {
    input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
    readout.textContent = format(Number(input.value));
  };
  input.addEventListener('input', () => {
    paint();
    onInput(Number(input.value));
  });
  paint();
  return h('label.field', {}, h('span.field-head', {}, h('span.field-label', {}, label), readout), input);
}

export function colorField(label: string, value: string, onInput: (value: string) => void): HTMLElement {
  const readout = h('output.field-value', {}, value);
  const input = h('input.color', { type: 'color', value, 'aria-label': label });
  input.addEventListener('input', () => {
    readout.textContent = input.value;
    onInput(input.value);
  });
  return h('label.field.field-row', {}, h('span.field-label', {}, label), h('span.field-end', {}, readout, input));
}

export function toggle(label: string, value: boolean, onChange: (value: boolean) => void, title?: string): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: value, title });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label.toggle', {}, input, h('span.toggle-track', {}, h('span.toggle-thumb')), h('span.toggle-label', {}, label));
}

export interface Option<T extends string> {
  value: T;
  label: string;
  title?: string;
}

export interface Segmented<T extends string> {
  element: HTMLElement;
  set(value: T): void;
}

export function segmented<T extends string>(options: readonly Option<T>[], value: T, onChange: (value: T) => void): Segmented<T> {
  const buttons = new Map<T, HTMLButtonElement>();
  const set = (next: T) => {
    for (const [key, el] of buttons) {
      el.classList.toggle('on', key === next);
      el.setAttribute('aria-pressed', String(key === next));
    }
  };
  const element = h(
    'div.segmented',
    { role: 'group' },
    options.map((option) => {
      const el = h('button.segment', { type: 'button', title: option.title, onclick: () => (set(option.value), onChange(option.value)) }, option.label);
      buttons.set(option.value, el);
      return el;
    }),
  );
  set(value);
  return { element, set };
}

export function section(title: string, ...children: (Node | false | null | undefined)[]): HTMLElement {
  return h('section.group', {}, h('h3.group-title', {}, title), ...children);
}

export function emptyNote(title: string, body: string): HTMLElement {
  return h('div.empty', {}, h('strong', {}, title), h('p', {}, body));
}

export const round = (decimals: number) => (value: number) => value.toFixed(decimals);
