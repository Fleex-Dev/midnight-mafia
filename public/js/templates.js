// Fetch and cache HTML once; all user-provided content is inserted via textContent.
const NAMES = [
  "player",
  "target",
  "lobby",
  "reveal-hidden",
  "reveal",
  "waiting",
  "night",
  "day",
  "vote",
  "ended",
  "header",
  "footer",
  "landing-start",
  "landing-create",
  "landing-join",
];
const cache = new Map();
export async function loadTemplates() {
  const response = await fetch("/templates.json");
  if (!response.ok) throw new Error("화면 템플릿을 불러오지 못했습니다.");
  const sources = await response.json();
  for (const name of NAMES) {
    if (typeof sources[name] !== "string") throw new Error(`템플릿 누락: ${name}`);
    const template = document.createElement("template");
    template.innerHTML = sources[name];
    cache.set(name, template);
  }
}
export function view(name, values = {}) {
  const template = cache.get(name);
  if (!template) throw new Error(`템플릿 누락: ${name}`);
  const element = template.content.firstElementChild.cloneNode(true);
  for (const [key, value] of Object.entries(values)) {
    element.querySelectorAll(`[data-text="${key}"]`).forEach((node) => {
      node.textContent = value ?? "";
    });
  }
  return element;
}
export function visible(root, name, show) {
  root.querySelectorAll(`[data-if="${name}"]`).forEach((node) => {
    if (!show) node.remove();
  });
}
export function slot(root, name, children) {
  const container = root.querySelector(`[data-slot="${name}"]`);
  if (container)
    container.replaceChildren(
      ...(Array.isArray(children) ? children : [children]),
    );
}
