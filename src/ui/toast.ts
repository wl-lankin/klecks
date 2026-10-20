import { h, icon } from "./dom";

let root: HTMLElement;

export function initToasts(parent: HTMLElement) {
  root = h("div", { class: "toasts" });
  parent.append(root);
}

export function toast(text: string, opts: { icon?: string; tone?: "ok" | "err" | "info"; action?: { label: string; run: () => void }; ms?: number } = {}) {
  const el = h(
    "div",
    { class: `toast ${opts.tone ?? "info"}` },
    h("span", { class: "toast-ico" }, icon(opts.icon ?? (opts.tone === "err" ? "CircleAlert" : opts.tone === "ok" ? "Check" : "Info"), 16, 2.2)),
    h("span", { class: "toast-text" }, text),
    opts.action &&
      h("button", {
        class: "toast-act",
        onclick: () => {
          opts.action!.run();
          close();
        },
      }, opts.action.label),
  );
  root.append(el);
  requestAnimationFrame(() => el.classList.add("in"));
  const close = () => {
    el.classList.remove("in");
    setTimeout(() => el.remove(), 260);
  };
  setTimeout(close, opts.ms ?? 2600);
}
