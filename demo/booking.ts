const ITEM_COUNT = 40;

export function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`demo page is missing #${id}`);
  }
  return element as T;
}

export function renderItems(list: HTMLElement): void {
  for (let index = 1; index <= ITEM_COUNT; index += 1) {
    const entry = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#item-${index}`;
    link.id = `item-${index}`;
    link.className = "item";
    link.textContent = `Item ${index}`;
    entry.appendChild(link);
    list.appendChild(entry);
  }
}

export function setUpBooking(): void {
  renderItems(requireElement("list"));
  const form = requireElement<HTMLFormElement>("booking");
  const done = requireElement("done");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    done.textContent = "Booked.";
  });
}
