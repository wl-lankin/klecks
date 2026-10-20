import { h, icon } from "./dom";
import { saveSettings, settings } from "../state";

// ---------- popover ----------

let openPop: { el: HTMLElement; close: () => void } | null = null;

export function closePopover() {
  openPop?.close();
}

export function popoverOpen() {
  return openPop !== null;
}

export function popover(anchor: HTMLElement, content: HTMLElement, opts: { align?: "start" | "center" | "end"; side?: "bottom" | "right" | "top"; onClose?: () => void; cls?: string } = {}) {
  closePopover();
  const el = h("div", { class: `popover ${opts.cls ?? ""}` }, content);
  document.body.append(el);
  const place = () => {
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    let x: number, y: number;
    if (opts.side === "right") {
      x = a.right + 10;
      y = a.top + a.height / 2 - r.height / 2;
    } else if (opts.side === "top") {
      y = a.top - r.height - 10;
      x = a.left + a.width / 2 - r.width / 2;
    } else {
      y = a.bottom + 10;
      x = opts.align === "end" ? a.right - r.width : opts.align === "start" ? a.left : a.left + a.width / 2 - r.width / 2;
    }
    x = Math.max(8, Math.min(window.innerWidth - r.width - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - r.height - 8, y));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  place();
  requestAnimationFrame(() => el.classList.add("in"));
  const onDown = (e: PointerEvent) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    if (!openPop || openPop.el !== el) return;
    openPop = null;
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    anchor.classList.remove("open");
    el.classList.remove("in");
    setTimeout(() => el.remove(), 150);
    opts.onClose?.();
  };
  setTimeout(() => {
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  });
  anchor.classList.add("open");
  openPop = { el, close };
  return { close, place };
}

// ---------- basic controls ----------

export function sep() {
  return h("div", { class: "pb-sep" });
}

export function label(text: string) {
  return h("span", { class: "pb-label" }, text);
}

export function iconButton(name: string, title: string, onclick: (e: MouseEvent) => void, opts: { active?: boolean; danger?: boolean; text?: string } = {}) {
  return h(
    "button",
    { class: `ibtn ${opts.active ? "active" : ""} ${opts.danger ? "danger" : ""} ${opts.text ? "with-text" : ""}`, title, "aria-label": title, onclick },
    icon(name, 17),
    opts.text ? h("span", {}, opts.text) : null,
  );
}

export function segmented<T extends string>(options: { value: T; icon?: string; text?: string; title: string }[], value: T, onChange: (v: T) => void) {
  const wrap = h("div", { class: "seg", role: "radiogroup" });
  for (const o of options) {
    wrap.append(
      h(
        "button",
        {
          class: `seg-btn ${o.value === value ? "on" : ""} ${o.text && !o.icon ? "txt" : ""}`,
          title: o.title,
          "aria-label": o.title,
          onclick: () => {
            wrap.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("on"));
            (wrap.children[options.indexOf(o)] as HTMLElement).classList.add("on");
            onChange(o.value);
          },
        },
        o.icon ? icon(o.icon, 16) : null,
        o.text ? h("span", {}, o.text) : null,
      ),
    );
  }
  return wrap;
}

export function toggle(name: string, title: string, on: boolean, onChange: (v: boolean) => void) {
  const b: HTMLButtonElement = h("button", {
    class: `ibtn ${on ? "active" : ""}`,
    title,
    "aria-label": title,
    "aria-pressed": String(on),
    onclick: () => {
      on = !on;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
      onChange(on);
    },
  }, icon(name, 17));
  return b;
}

/** Slider with a live value. onInput fires while dragging, onCommit once at the end. */
export function slider(opts: { title: string; min: number; max: number; step?: number; value: number; format?: (v: number) => string; onInput: (v: number) => void; onCommit?: () => void; width?: number; log?: boolean }) {
  const fmt = opts.format ?? ((v: number) => String(Math.round(v)));
  const toPos = (v: number) => (opts.log ? Math.log(v / opts.min) / Math.log(opts.max / opts.min) : (v - opts.min) / (opts.max - opts.min));
  const fromPos = (p: number) => (opts.log ? opts.min * Math.pow(opts.max / opts.min, p) : opts.min + p * (opts.max - opts.min));
  const out = h("span", { class: "sl-val" }, fmt(opts.value));
  const input = h("input", { type: "range", min: 0, max: 1000, step: 1, value: String(Math.round(toPos(opts.value) * 1000)), title: opts.title, "aria-label": opts.title });
  const paint = () => input.style.setProperty("--p", `${(Number(input.value) / 10).toFixed(1)}%`);
  paint();
  input.addEventListener("input", () => {
    let v = fromPos(Number(input.value) / 1000);
    const st = opts.step ?? 1;
    v = Math.round(v / st) * st;
    out.textContent = fmt(v);
    paint();
    opts.onInput(v);
  });
  input.addEventListener("change", () => opts.onCommit?.());
  return h("label", { class: "slider", title: opts.title, style: { width: `${opts.width ?? 132}px` } }, input, out);
}

// ---------- colors ----------

export const QUICK = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#0A84FF", "#AF52DE", "#111114", "#FFFFFF"];
export const HIGHLIGHTS = ["#FFE14D", "#9BF26B", "#FF8AD8", "#7FD8FF", "#FFB056"];
const PALETTE = [
  ["#FF3B30", "#FF6B3D", "#FF9500", "#FFCC00", "#A8E10C", "#34C759", "#00C7BE", "#32ADE6", "#0A84FF", "#5856D6", "#AF52DE", "#FF2D92"],
  ["#B3261E", "#C2410C", "#B45309", "#A16207", "#4D7C0F", "#15803D", "#0F766E", "#0369A1", "#1D4ED8", "#4338CA", "#7E22CE", "#BE185D"],
  ["#FECACA", "#FED7AA", "#FDE68A", "#FEF08A", "#D9F99D", "#BBF7D0", "#99F6E4", "#BAE6FD", "#BFDBFE", "#C7D2FE", "#E9D5FF", "#FBCFE8"],
  ["#000000", "#1C1C1E", "#3A3A3C", "#48484A", "#636366", "#8E8E93", "#AEAEB2", "#C7C7CC", "#D1D1D6", "#E5E5EA", "#F2F2F7", "#FFFFFF"],
];

export function rememberColor(c: string) {
  settings.recent = [c.toUpperCase(), ...settings.recent.filter((x) => x.toUpperCase() !== c.toUpperCase())].slice(0, 12);
  saveSettings();
}

function normHex(v: string): string | null {
  let s = v.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toUpperCase()}` : null;
}

export function colorPanel(current: string, onPick: (c: string, final: boolean) => void) {
  const swatch = (c: string) =>
    h("button", {
      class: `sw ${c.toUpperCase() === current.toUpperCase() ? "on" : ""}`,
      style: { "--c": c } as any,
      title: c,
      onclick: () => {
        rememberColor(c);
        onPick(c, true);
      },
    });
  const hex = h("input", { class: "hex", value: current.toUpperCase(), spellcheck: false, maxLength: 7 });
  const native = h("input", { type: "color", class: "native", value: current.slice(0, 7) });
  native.addEventListener("input", () => {
    hex.value = native.value.toUpperCase();
    onPick(native.value.toUpperCase(), false);
  });
  native.addEventListener("change", () => {
    rememberColor(native.value);
    onPick(native.value.toUpperCase(), true);
  });
  hex.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const v = normHex(hex.value);
      if (v) {
        rememberColor(v);
        onPick(v, true);
      }
    }
  });
  return h(
    "div",
    { class: "color-panel" },
    h("div", { class: "cp-grid" }, PALETTE.flat().map(swatch)),
    settings.recent.length ? h("div", { class: "cp-sub" }, "Zuletzt verwendet") : null,
    settings.recent.length ? h("div", { class: "cp-row" }, settings.recent.map(swatch)) : null,
    h("div", { class: "cp-custom" }, h("label", { class: "native-wrap", title: "Eigene Farbe" }, native, icon("Pipette", 15)), hex),
  );
}

export function swatchRow(colors: string[], current: string, onPick: (c: string) => void, more = true) {
  const row = h("div", { class: "swatches" });
  const inQuick = colors.some((c) => c.toUpperCase() === current.toUpperCase());
  for (const c of colors) {
    row.append(
      h("button", {
        class: `sw ${c.toUpperCase() === current.toUpperCase() ? "on" : ""}`,
        style: { "--c": c } as any,
        title: c,
        onclick: () => onPick(c),
      }),
    );
  }
  if (more) {
    const btn: HTMLButtonElement = h("button", {
      class: `sw more ${inQuick ? "" : "on"}`,
      style: { "--c": inQuick ? "transparent" : current } as any,
      title: "Weitere Farben",
      onclick: () => popover(btn, colorPanel(current, (c, final) => {
        onPick(c);
        if (final) closePopover();
      })),
    }, inQuick ? icon("Plus", 13, 2.4) : null);
    row.append(btn);
  }
  return row;
}
