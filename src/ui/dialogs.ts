import { COMMANDS, keyLabel, type Command } from "../commands";
import { S, settings } from "../state";
import { blankDoc, canvasSize, resizeImage } from "../docs";
import { h, icon, kbd, clear } from "./dom";
import { modal } from "./modal";
import { popover, closePopover } from "./controls";
import { logo } from "./chrome";
import { WEBSITE, openUrl } from "../io";

const firstKey = (c: Command) => (c.keys?.[0] ? kbd(...keyLabel(c.keys[0])) : null);

// ---------- command palette ----------

let paletteOpen = false;

function score(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i === 0) return 100;
  if (i > 0) return 80 - i;
  let ti = 0;
  let s = 0;
  for (const ch of q) {
    const f = t.indexOf(ch, ti);
    if (f < 0) return 0;
    s += f === ti ? 3 : 1;
    ti = f + 1;
  }
  return s;
}

export function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;
  const input = h("input", { class: "pal-input", placeholder: "Befehl oder Werkzeug suchen …", spellcheck: false });
  const list = h("div", { class: "pal-list" });
  let items: Command[] = [];
  let active = 0;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    items = COMMANDS.filter((c) => !c.hidden && (!c.when || c.when()))
      .map((c) => ({ c, s: Math.max(score(q, c.title), score(q, `${c.group} ${c.title}`) * 0.6) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c);
    active = Math.min(active, Math.max(0, items.length - 1));
    clear(list);
    items.forEach((c, i) =>
      list.append(
        h(
          "button",
          {
            class: `pal-item ${i === active ? "on" : ""}`,
            onpointermove: () => {
              if (active !== i) {
                active = i;
                mark();
              }
            },
            onclick: () => run(c),
          },
          h("span", { class: "pal-ico" }, c.icon ? icon(c.icon, 16) : null),
          h("span", { class: "pal-title" }, c.title),
          h("span", { class: "pal-group" }, c.group),
          firstKey(c),
        ),
      ),
    );
    if (!items.length) list.append(h("div", { class: "pal-empty" }, "Nichts gefunden"));
  };
  const mark = () => {
    list.querySelectorAll(".pal-item").forEach((el, i) => el.classList.toggle("on", i === active));
    list.children[active]?.scrollIntoView({ block: "nearest" });
  };
  const run = (c: Command) => {
    m.close();
    setTimeout(() => c.run(), 10);
  };
  input.addEventListener("input", () => {
    active = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      active = Math.min(items.length - 1, active + 1);
      mark();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      active = Math.max(0, active - 1);
      mark();
      e.preventDefault();
    } else if (e.key === "Enter" && items[active]) run(items[active]);
    else if (e.key === "Escape") m.close();
  });
  const m = modal("", h("div", { class: "palette" }, h("div", { class: "pal-head" }, icon("Search", 17), input), list), {
    width: 560,
    onClose: () => (paletteOpen = false),
  });
  m.el.classList.add("pal-modal");
  render();
  setTimeout(() => input.focus(), 20);
}

// ---------- main menu ----------

export function openMenu(anchor: HTMLElement) {
  const col = (g: Command["group"]) =>
    h(
      "div",
      { class: "menu-col" },
      h("div", { class: "menu-head" }, g),
      COMMANDS.filter((c) => c.group === g && !c.hidden && c.id !== "palette").map((c) => {
        const enabled = !c.when || c.when();
        return h(
          "button",
          {
            class: "menu-item",
            disabled: !enabled,
            onclick: () => {
              closePopover();
              setTimeout(() => c.run(), 10);
            },
          },
          h("span", { class: "pal-ico" }, c.icon ? icon(c.icon, 15) : null),
          h("span", {}, c.title),
          firstKey(c),
        );
      }),
    );
  popover(
    anchor,
    h(
      "div",
      { class: "menu" },
      h("div", { class: "menu-cols" }, h("div", {}, col("Datei"), col("Ansicht")), h("div", {}, col("Bearbeiten"), col("Objekt")), h("div", {}, col("Bild"), col("Hilfe"))),
      h("div", { class: "menu-foot" }, icon("Command", 14), "Alle Befehle durchsuchen", kbd(...keyLabel("mod+k"))),
    ),
    { align: "start" },
  );
}

// ---------- forms ----------

function num(value: number, onInput?: (v: number) => void) {
  const el = h("input", { type: "number", class: "num", value: String(value), min: 1, max: 30000 });
  el.addEventListener("keydown", (e) => e.stopPropagation());
  el.addEventListener("input", () => onInput?.(Number(el.value)));
  return el;
}

function field(label: string, el: Node, suffix?: string) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), h("span", { class: "field-in" }, el, suffix ? h("span", { class: "suffix" }, suffix) : null));
}

function actions(onOk: () => void, close: () => void, okLabel: string) {
  return h(
    "div",
    { class: "modal-actions" },
    h("button", { class: "btn", onclick: close }, "Abbrechen"),
    h("button", { class: "btn primary", onclick: onOk }, okLabel),
  );
}

export function newDialog(preset?: [number, number]) {
  let w = preset?.[0] ?? 1920;
  let hh = preset?.[1] ?? 1080;
  let bg: string | null = "#FFFFFF";
  const wIn = num(w, (v) => (w = v));
  const hIn = num(hh, (v) => (hh = v));
  const presets: [string, number, number][] = [
    ["Full HD", 1920, 1080],
    ["HD", 1280, 720],
    ["4K", 3840, 2160],
    ["Quadrat", 1080, 1080],
    ["Story", 1080, 1920],
    ["A4 (300 dpi)", 2480, 3508],
    ["Icon", 512, 512],
  ];
  const chips = h("div", { class: "chips" }, presets.map(([n, pw, ph]) =>
    h("button", { class: "chip", onclick: () => { w = pw; hh = ph; wIn.value = String(pw); hIn.value = String(ph); } }, h("b", {}, n), h("small", {}, `${pw}×${ph}`)),
  ));
  const bgs: [string, string | null][] = [["Weiß", "#FFFFFF"], ["Schwarz", "#111114"], ["Transparent", null], ["Farbe 2", settings.secondary]];
  const bgRow = h("div", { class: "chips" }, bgs.map(([n, c], i) => {
    const b: HTMLButtonElement = h("button", {
      class: `chip bg ${i === 0 ? "on" : ""}`,
      onclick: () => {
        bg = c;
        bgRow.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
      },
    }, h("span", { class: `bg-sw ${c ? "" : "checker"}`, style: { background: c ?? "" } }), n);
    return b;
  }));
  const ok = () => {
    if (w > 0 && hh > 0 && w <= 30000 && hh <= 30000) {
      m.close();
      blankDoc(Math.round(w), Math.round(hh), bg);
    }
  };
  const body = h("div", { class: "form" }, chips, h("div", { class: "row2" }, field("Breite", wIn, "px"), field("Höhe", hIn, "px")), h("div", { class: "field-label" }, "Hintergrund"), bgRow);
  body.addEventListener("keydown", (e) => e.key === "Enter" && ok());
  const m = modal("Neue Leinwand", body, { footer: actions(ok, () => m.close(), "Erstellen"), width: 480 });
  setTimeout(() => wIn.select(), 30);
}

export function resizeDialog() {
  const d = S.doc;
  if (!d) return;
  let w = d.w, hh = d.h, keep = true, pct = 100;
  const ar = d.w / d.h;
  const wIn = num(w), hIn = num(hh), pIn = num(pct);
  wIn.addEventListener("input", () => {
    w = Number(wIn.value);
    if (keep) { hh = Math.round(w / ar); hIn.value = String(hh); }
    pct = Math.round((w / d.w) * 100); pIn.value = String(pct);
  });
  hIn.addEventListener("input", () => {
    hh = Number(hIn.value);
    if (keep) { w = Math.round(hh * ar); wIn.value = String(w); }
    pct = Math.round((hh / d.h) * 100); pIn.value = String(pct);
  });
  pIn.addEventListener("input", () => {
    pct = Number(pIn.value);
    w = Math.max(1, Math.round((d.w * pct) / 100)); hh = Math.max(1, Math.round((d.h * pct) / 100));
    wIn.value = String(w); hIn.value = String(hh);
  });
  const keepBox = h("label", { class: "check" }, h("input", { type: "checkbox", checked: true, onchange: (e: Event) => (keep = (e.target as HTMLInputElement).checked) }), "Seitenverhältnis beibehalten");
  const ok = () => {
    if (w > 0 && hh > 0 && w <= 30000 && hh <= 30000) {
      m.close();
      resizeImage(Math.round(w), Math.round(hh));
    }
  };
  const body = h("div", { class: "form" },
    h("p", { class: "modal-text" }, `Aktuell ${d.w} × ${d.h} px. Markierungen werden mitskaliert.`),
    field("Prozent", pIn, "%"),
    h("div", { class: "row2" }, field("Breite", wIn, "px"), field("Höhe", hIn, "px")),
    keepBox,
  );
  body.addEventListener("keydown", (e) => e.key === "Enter" && ok());
  const m = modal("Bildgröße", body, { footer: actions(ok, () => m.close(), "Ändern") });
}

export function canvasDialog() {
  const d = S.doc;
  if (!d) return;
  let w = d.w, hh = d.h, ax = 0.5, ay = 0.5;
  let fill: string | null = null;
  const wIn = num(w, (v) => (w = v)), hIn = num(hh, (v) => (hh = v));
  const anchor = h("div", { class: "anchor" });
  for (let i = 0; i < 9; i++) {
    const b: HTMLButtonElement = h("button", {
      class: `anc ${i === 4 ? "on" : ""}`,
      onclick: () => {
        ax = (i % 3) / 2;
        ay = Math.floor(i / 3) / 2;
        anchor.querySelectorAll(".anc").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
      },
    });
    anchor.append(b);
  }
  const fillRow = h("div", { class: "chips" }, ([["Transparent", null], ["Weiß", "#FFFFFF"], ["Farbe 2", settings.secondary]] as [string, string | null][]).map(([n, c], i) => {
    const b: HTMLButtonElement = h("button", {
      class: `chip bg ${i === 0 ? "on" : ""}`,
      onclick: () => {
        fill = c;
        fillRow.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
      },
    }, h("span", { class: `bg-sw ${c ? "" : "checker"}`, style: { background: c ?? "" } }), n);
    return b;
  }));
  const ok = () => {
    if (w > 0 && hh > 0 && w <= 30000 && hh <= 30000) {
      m.close();
      canvasSize(Math.round(w), Math.round(hh), ax, ay, fill);
    }
  };
  const body = h("div", { class: "form" },
    h("div", { class: "row-anchor" }, h("div", {}, field("Breite", wIn, "px"), field("Höhe", hIn, "px")), h("div", {}, h("div", { class: "field-label" }, "Anker"), anchor)),
    h("div", { class: "field-label" }, "Neue Fläche"),
    fillRow,
  );
  body.addEventListener("keydown", (e) => e.key === "Enter" && ok());
  const m = modal("Zeichenfläche", body, { footer: actions(ok, () => m.close(), "Ändern") });
}

export function shortcutsDialog() {
  const groups = ["Werkzeug", "Datei", "Bearbeiten", "Bild", "Objekt", "Ansicht", "Hilfe"] as const;
  const body = h("div", { class: "shortcuts" }, groups.map((g) =>
    h("div", { class: "sc-group" }, h("div", { class: "menu-head" }, g), COMMANDS.filter((c) => c.group === g && c.keys?.length && !c.hidden).map((c) =>
      h("div", { class: "sc-row" }, h("span", {}, c.title), firstKey(c)),
    )),
  ),
  h("div", { class: "sc-group" }, h("div", { class: "menu-head" }, "Beim Zeichnen"),
    ...([
      ["Winkel einrasten / Quadrat / Kreis", "Shift"],
      ["Von der Mitte aus", "Alt"],
      ["Ansicht verschieben", "Leertaste"],
      ["Beim Verschieben duplizieren", "Alt"],
      ["Werkzeug größer / kleiner", "+ / −"],
      ["Mit Farbe 2 malen", "Rechtsklick"],
    ] as const).map(([t, k]) => h("div", { class: "sc-row" }, h("span", {}, t), kbd(k))),
  ));
  modal("Tastenkürzel", body, { width: 820 });
}

export async function aboutDialog() {
  let version = "1.0.0";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    version = await getVersion();
  } catch {}
  modal("", h("div", { class: "about" },
    logo(96),
    h("h2", {}, "Klecks"),
    h("div", { class: "dim" }, `Version ${version}`),
    h("p", {}, "Modernes Paint und Screenshot-Markierung für Mac und Windows."),
    h("div", { class: "creator" },
      h("span", { class: "dim" }, "Entwickelt von"),
      h("button", { class: "link", onclick: () => void openUrl(WEBSITE) }, "Wolfgang Linz"),
    ),
    h("button", { class: "link small", onclick: () => void openUrl(WEBSITE) }, icon("Globe", 13), "wolfgang-linz.de"),
    h("button", { class: "link small dim", onclick: () => void openUrl("https://github.com/wl-lankin/klecks") }, icon("Code", 13), "Quellcode auf GitHub"),
  ), { width: 360 }).el.classList.add("about-modal");
}
