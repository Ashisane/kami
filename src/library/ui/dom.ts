export type Child = Node | string | number | null | undefined | false;

type Props = Record<string, unknown>;

type TagOf<S extends string> = S extends `${infer Tag}.${string}` ? Tag : S;
type ElementOf<S extends string> = TagOf<S> extends keyof HTMLElementTagNameMap
  ? HTMLElementTagNameMap[TagOf<S>]
  : HTMLElement;

/**
 * Tiny element builder. `h('div.card.wide', { onclick }, child, child)`.
 * Props that exist on the element are set directly; the rest become attributes.
 */
export function h<S extends string>(selector: S, props: Props = {}, ...children: (Child | Child[])[]): ElementOf<S> {
  const [tag, ...classes] = selector.split('.') as [string, ...string[]];
  const element = document.createElement(tag) as ElementOf<S>;
  if (classes.length) element.className = classes.join(' ');

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === 'style' && typeof value === 'object') {
      for (const [name, v] of Object.entries(value as Record<string, string>)) element.style.setProperty(name, v);
    } else if (key in element) {
      (element as unknown as Props)[key] = value;
    } else {
      element.setAttribute(key, String(value));
    }
  }

  element.append(...toNodes(children));
  return element;
}

function toNodes(children: (Child | Child[])[]): (Node | string)[] {
  return children.flat().flatMap((child) => {
    if (child === null || child === undefined || child === false) return [];
    return [child instanceof Node ? child : String(child)];
  });
}

export function replace(parent: HTMLElement, ...children: (Child | Child[])[]): void {
  parent.replaceChildren(...toNodes(children));
}

/** Re-triggers a CSS animation class, for one-shot feedback like a press or a stamp. */
export function flash(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}
