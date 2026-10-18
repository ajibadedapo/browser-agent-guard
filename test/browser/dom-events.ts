export function trusted<E extends Event>(event: E): E {
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

export function steppingClock(start = 1000.5, step = 10.25): () => number {
  let now = start - step;
  return () => {
    now += step;
    return now;
  };
}

export function stubRect(element: Element, rect: { x: number; y: number; w: number; h: number }): void {
  element.getBoundingClientRect = () =>
    ({
      left: rect.x,
      top: rect.y,
      width: rect.w,
      height: rect.h,
      x: rect.x,
      y: rect.y,
      right: rect.x + rect.w,
      bottom: rect.y + rect.h,
      toJSON: () => ({}),
    }) as DOMRect;
}

export function typeText(target: HTMLInputElement, text: string): void {
  for (const character of text) {
    target.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: character, code: `Key${character.toUpperCase()}`, bubbles: true })));
    target.value += character;
    target.dispatchEvent(trusted(new InputEvent("input", { inputType: "insertText", data: character, bubbles: true })));
  }
}
