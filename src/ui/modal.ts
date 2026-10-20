import { h } from "./dom";

let root: HTMLElement;
let openCount = 0;

export function initModals(parent: HTMLElement) {
  root = h("div", { class: "modal-root" });
  parent.append(root);
}

export function modalOpen() {
  return openCount > 0;
}

export interface ModalHandle {
  close: () => void;
  el: HTMLElement;
}

/** A centered card. Escape or a click on the backdrop closes it (calls onClose). */
export function modal(title: string, body: Node, opts: { onClose?: () => void; width?: number; footer?: Node } = {}): ModalHandle {
  openCount++;
  const card = h("div", { class: "modal", style: { width: `${opts.width ?? 440}px` } }, h("div", { class: "modal-title" }, title), body, opts.footer ?? null);
  const back = h("div", { class: "modal-back" }, card);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openCount--;
    document.removeEventListener("keydown", onKey, true);
    back.classList.remove("in");
    setTimeout(() => back.remove(), 200);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);
  back.addEventListener("pointerdown", (e) => {
    if (e.target === back) close();
  });
  root.append(back);
  requestAnimationFrame(() => back.classList.add("in"));
  return { close, el: card };
}

export function choose<T extends string>(title: string, text: string, buttons: { id: T; label: string; primary?: boolean; danger?: boolean }[]): Promise<T | null> {
  return new Promise((resolve) => {
    let result: T | null = null;
    const footer = h(
      "div",
      { class: "modal-actions" },
      buttons.map((b) =>
        h("button", {
          class: `btn ${b.primary ? "primary" : ""} ${b.danger ? "danger" : ""}`,
          onclick: () => {
            result = b.id;
            m.close();
          },
        }, b.label),
      ),
    );
    const m = modal(title, h("p", { class: "modal-text" }, text), { footer, onClose: () => resolve(result) });
    (footer.querySelector(".primary") as HTMLElement | null)?.focus();
  });
}
