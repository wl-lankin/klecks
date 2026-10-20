import * as L from "lucide";

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, any>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith("--")) el.style.setProperty(sk, String(sv));
        else (el.style as any)[sk] = sv;
      }
    }
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && !k.includes("-")) (el as any)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, kids);
  return el;
}

function append(el: Element, kids: (Child | Child[])[]) {
  for (const k of kids.flat()) {
    if (k === null || k === undefined || k === false) continue;
    el.append(typeof k === "object" ? k : document.createTextNode(String(k)));
  }
}

const custom: Record<string, string> = {
  step: '<circle cx="12" cy="12" r="9"/><path d="M10.5 9.2 12.6 7.8V16.2"/>',
  flipH: '<path d="M12 3v18"/><path d="M8 7 3 12l5 5V7Z"/><path d="M16 7l5 5-5 5V7Z"/>',
  flipV: '<path d="M3 12h18"/><path d="M7 8l5-5 5 5H7Z"/><path d="M7 16l5 5 5-5H7Z"/>',
  taper: '<path d="M4 20 15 9" stroke-width="2.6"/><path d="M10 6h8v8" />',
  blurBox: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h2v2H8zM14 8h2v2h-2zM11 11h2v2h-2zM8 14h2v2H8zM14 14h2v2h-2z" fill="currentColor" stroke="none"/>',
  spot: '<rect x="2.5" y="2.5" width="19" height="19" rx="3" fill="currentColor" fill-opacity=".28" stroke="none"/><rect x="7" y="7" width="10" height="10" rx="2"/>',
  lineTool: '<path d="M5 19 19 5"/>',
  marker: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
};

export function icon(name: string, size = 18, stroke = 1.75): SVGElement {
  if (custom[name]) {
    const t = document.createElement("template");
    t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${custom[name]}</svg>`;
    return t.content.firstElementChild as SVGElement;
  }
  const node = (L as any)[name];
  if (!node) throw new Error(`unknown icon ${name}`);
  return L.createElement(node, { width: size, height: size, "stroke-width": stroke });
}

export function kbd(...keys: string[]) {
  return h("span", { class: "kbds" }, keys.map((k) => h("kbd", {}, k)));
}

export function clear(el: Element) {
  while (el.firstChild) el.firstChild.remove();
}
