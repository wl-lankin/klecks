import logoSvg from "../../assets/app-icon.svg?raw";
import markSvg from "../../assets/mark.svg?raw";
import { S, emit, on, saveSettings, settings, type Doc } from "../state";
import { TOOLS, COMMANDS, runCommand, swapColors, keyLabel, openFiles } from "../commands";
import { begin, blankDoc, commit, closeDoc, copyImage, fitView, mutate, redo, saveDoc, switchTo, undo, zoomAt, zoomStep } from "../docs";
import { setTool } from "../tools";
import { FRAME_PRESETS, composite, requestRender } from "../render";
import { MOD, WEBSITE, isMac, isTauri, isWindows, openUrl } from "../io";
import { h, icon, clear, kbd } from "./dom";
import { colorPanel, closePopover, popover, slider } from "./controls";

export function logo(size: number, markOnly = false) {
  const t = document.createElement("template");
  // The mark is the motif without the app-icon tile, for large display on the start screen.
  t.innerHTML = (markOnly ? markSvg : logoSvg).replace("<svg ", `<svg class="logo" width="${size}" height="${Math.round(markOnly ? size * 640 / 600 : size)}" `);
  // Gradient ids must stay unique when the logo appears more than once.
  const n = Math.random().toString(36).slice(2, 7);
  t.innerHTML = t.innerHTML.replace(/id="(\w+)"/g, `id="$1${n}"`).replace(/url\(#(\w+)\)/g, `url(#$1${n})`);
  return t.content.firstElementChild as SVGElement;
}

// ---------- tooltips ----------

function initTooltips() {
  const tip = h("div", { class: "tip" });
  document.body.append(tip);
  let timer = 0;
  let current: HTMLElement | null = null;
  document.addEventListener("pointerover", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    if (el === current) return;
    current = el;
    clearTimeout(timer);
    tip.classList.remove("in");
    if (!el) return;
    timer = window.setTimeout(() => {
      if (!document.body.contains(el)) return;
      clear(tip);
      tip.append(h("span", {}, el.dataset.tip!));
      if (el.dataset.keys) tip.append(kbd(...el.dataset.keys.split(" ")));
      const r = el.getBoundingClientRect();
      const side = el.dataset.side ?? "bottom";
      tip.style.left = "0px";
      tip.style.top = "0px";
      tip.classList.add("in");
      const t = tip.getBoundingClientRect();
      let x = r.left + r.width / 2 - t.width / 2;
      let y = r.bottom + 8;
      if (side === "right") {
        x = r.right + 10;
        y = r.top + r.height / 2 - t.height / 2;
      } else if (side === "top") y = r.top - t.height - 8;
      tip.style.left = `${Math.max(6, Math.min(window.innerWidth - t.width - 6, x))}px`;
      tip.style.top = `${Math.max(6, y)}px`;
    }, 420);
  });
  document.addEventListener("pointerdown", () => {
    clearTimeout(timer);
    tip.classList.remove("in");
  });
}

function keysOf(id: string) {
  const c = COMMANDS.find((x) => x.id === id);
  return c?.keys?.[0] ? keyLabel(c.keys[0]).join(" ") : undefined;
}

// ---------- top bar ----------

let tabsEl: HTMLElement;
let undoBtn: HTMLButtonElement;
let redoBtn: HTMLButtonElement;
let frameBtn: HTMLButtonElement;
let updatePill: HTMLElement;

function thumb(doc: Doc) {
  const c = h("canvas", { class: "tab-thumb", width: 44, height: 30 });
  const ctx = c.getContext("2d")!;
  const img = composite(doc);
  const s = Math.max(44 / doc.w, 30 / doc.h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (44 - doc.w * s) / 2, (30 - doc.h * s) / 2, doc.w * s, doc.h * s);
  return c;
}

function renderTabs() {
  clear(tabsEl);
  for (const d of S.docs) {
    const name = h("span", { class: "tab-name" }, d.name);
    const tab = h(
      "div",
      {
        class: `tab ${d === S.doc ? "on" : ""} ${d.dirty ? "dirty" : ""}`,
        title: `${d.name} · ${d.w} × ${d.h}`,
        onpointerdown: (e: PointerEvent) => {
          if (e.button === 1) {
            e.preventDefault();
            void closeDoc(d);
          } else if (e.button === 0 && !(e.target as HTMLElement).closest(".tab-x")) switchTo(d);
        },
        ondblclick: () => rename(d, name),
      },
      thumb(d),
      name,
      h("span", { class: "tab-dot" }),
      h("button", { class: "tab-x", title: "Schließen", onclick: () => void closeDoc(d) }, icon("X", 13, 2.2)),
    );
    tabsEl.append(tab);
  }
  tabsEl.append(
    h("button", { class: "tab-new", "data-tip": "Neue Leinwand", "data-keys": keysOf("new"), onclick: () => runCommand("new") }, icon("Plus", 16, 2)),
  );
}

function rename(d: Doc, el: HTMLElement) {
  const input = h("input", { class: "tab-rename", value: d.name, spellcheck: false });
  el.replaceWith(input);
  input.focus();
  input.select();
  const done = () => {
    d.name = input.value.trim() || d.name;
    renderTabs();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.value = d.name;
      input.blur();
    }
  });
  input.addEventListener("blur", done);
}

let thumbTimer = 0;
function scheduleThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = window.setTimeout(() => {
    const on = tabsEl.querySelector(".tab.on .tab-thumb");
    if (on && S.doc) on.replaceWith(thumb(S.doc));
    const t = tabsEl.querySelector(".tab.on");
    t?.classList.toggle("dirty", !!S.doc?.dirty);
  }, 400);
}

function frameMenu(anchor: HTMLElement) {
  const d = S.doc;
  if (!d) return;
  const set = (fn: () => void, label = "Rahmen") => {
    mutate(label, fn);
    emit("frame");
  };
  const toggleRow = h(
    "label",
    { class: "fm-switch" },
    h("span", {}, h("b", {}, "Schmuckrahmen"), h("small", {}, "Verlauf, Rand und Schatten für die Weitergabe")),
    h("input", {
      type: "checkbox",
      class: "switch",
      checked: d.frame.on,
      onchange: (e: Event) => {
        set(() => (d.frame.on = (e.target as HTMLInputElement).checked));
        fitView();
      },
    }),
  );
  const grid = h(
    "div",
    { class: "fm-grid" },
    FRAME_PRESETS.map((p, i) =>
      h("button", {
        class: `fm-sw ${d.frame.preset === i ? "on" : ""} ${p.stops.length ? "" : "none"}`,
        title: p.name,
        style: { background: p.stops.length ? `linear-gradient(135deg, ${p.stops.join(",")})` : "" },
        onclick: (e: MouseEvent) => {
          set(() => {
            d.frame.preset = i;
            d.frame.on = true;
          });
          grid.querySelectorAll(".fm-sw").forEach((b) => b.classList.remove("on"));
          (e.currentTarget as HTMLElement).classList.add("on");
          (toggleRow.querySelector("input") as HTMLInputElement).checked = true;
        },
      }),
    ),
  );
  let tx = false;
  const live = (fn: () => void) => {
    if (!tx) {
      tx = true;
      // One undo step per slider drag.
      begin();
    }
    fn();
    d.frame.on = true;
    (toggleRow.querySelector("input") as HTMLInputElement).checked = true;
    d.version++;
    emit("frame");
    requestRender();
  };
  const end = () => {
    if (tx) commit("Rahmen");
    tx = false;
  };
  const row = (name: string, el: Node) => h("div", { class: "fm-row" }, h("span", {}, name), el);
  popover(
    anchor,
    h(
      "div",
      { class: "frame-menu" },
      toggleRow,
      grid,
      row("Rand", slider({ title: "Rand", min: 0, max: 200, value: d.frame.padding, width: 170, onInput: (v) => live(() => (d.frame.padding = v)), onCommit: end })),
      row("Ecken", slider({ title: "Ecken", min: 0, max: 48, value: d.frame.radius, width: 170, onInput: (v) => live(() => (d.frame.radius = v)), onCommit: end })),
      row("Schatten", slider({ title: "Schatten", min: 0, max: 1, step: 0.01, value: d.frame.shadow, width: 170, format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => live(() => (d.frame.shadow = v)), onCommit: end })),
    ),
    { align: "end" },
  );
}

export function toggleFrame() {
  const d = S.doc;
  if (!d) return;
  mutate("Rahmen", () => (d.frame.on = !d.frame.on));
  emit("frame");
  fitView();
}

function updateHistoryButtons() {
  const h_ = S.doc?.history;
  undoBtn.disabled = !h_?.canUndo;
  redoBtn.disabled = !h_?.canRedo;
  undoBtn.dataset.tip = h_?.canUndo ? `Rückgängig: ${h_.undoLabel}` : "Rückgängig";
  redoBtn.dataset.tip = h_?.canRedo ? `Wiederholen: ${h_.redoLabel}` : "Wiederholen";
}

export function setUpdateState(state: string, version?: string | null, onRestart?: () => void) {
  if (!updatePill) return;
  clear(updatePill);
  updatePill.className = "update-pill";
  if (state === "ready" && version) {
    updatePill.classList.add("in");
    updatePill.append(icon("Sparkles", 14, 2), h("span", {}, `Version ${version} ist bereit`), h("button", { onclick: onRestart }, "Neu starten"));
  } else if (state === "downloading" && version) {
    updatePill.classList.add("in", "quiet");
    updatePill.append(h("span", { class: "spin" }), h("span", {}, `Update ${version} wird geladen`));
  }
}

function buildTopbar(menu: () => void) {
  tabsEl = h("div", { class: "tabs" });
  undoBtn = h("button", { class: "ibtn", "data-keys": keysOf("undo"), onclick: () => undo() }, icon("Undo2", 18));
  redoBtn = h("button", { class: "ibtn", "data-keys": keysOf("redo"), onclick: () => redo() }, icon("Redo2", 18));
  frameBtn = h("button", { class: "ibtn with-text frame-btn", "data-tip": "Schmuckrahmen für die Weitergabe", "data-keys": keysOf("frame"), onclick: () => frameMenu(frameBtn) }, icon("Sparkles", 17), h("span", {}, "Rahmen"));
  updatePill = h("div", { class: "update-pill" });
  const brand: HTMLButtonElement = h("button", { class: "brand", "data-tip": "Menü", onclick: () => menu() }, logo(26), h("span", { class: "wordmark" }, "klecks"), icon("ChevronDown", 14, 2));
  const actions = h(
    "div",
    { class: "tb-actions" },
    undoBtn,
    redoBtn,
    h("div", { class: "tb-sep" }),
    frameBtn,
    h("button", { class: "ibtn with-text", "data-tip": "Als Datei speichern", "data-keys": keysOf("save"), onclick: () => void saveDoc() }, icon("Download", 17), h("span", {}, "Speichern")),
    h("button", { class: "btn primary copy-btn", "data-tip": "Das fertige Bild in die Zwischenablage kopieren, zum Einfügen in Chat, Mail oder Ticket", "data-keys": keysOf("copyImage"), onclick: () => void copyImage() }, icon("Copy", 16, 2.2), h("span", {}, "Kopieren")),
  );
  const winControls = isWindows && isTauri
    ? h(
        "div",
        { class: "win-controls" },
        h("button", { class: "wc", title: "Minimieren", onclick: () => winAction("minimize") }, icon("Minus", 16)),
        h("button", { class: "wc", title: "Maximieren", onclick: () => winAction("toggleMaximize") }, icon("Square", 13)),
        h("button", { class: "wc close", title: "Schließen", onclick: () => winAction("close") }, icon("X", 16)),
      )
    : null;
  const bar = h(
    "header",
    { class: `topbar ${isMac ? "mac" : ""}`, "data-tauri-drag-region": "" },
    isMac && isTauri ? h("div", { class: "traffic", "data-tauri-drag-region": "" }) : null,
    brand,
    tabsEl,
    h("div", { class: "tb-fill", "data-tauri-drag-region": "" }),
    updatePill,
    actions,
    winControls,
  );
  bar.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).hasAttribute("data-tauri-drag-region") && isTauri) winAction("toggleMaximize");
  });
  return bar;
}

async function winAction(a: "minimize" | "toggleMaximize" | "close") {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  if (a === "minimize") await w.minimize();
  else if (a === "toggleMaximize") await w.toggleMaximize();
  else await w.close();
}

// ---------- dock ----------

function buildDock() {
  const grid = h("div", { class: "dock-grid" });
  let group = 0;
  for (const t of TOOLS) {
    if (t.group !== group) {
      grid.append(h("div", { class: "dock-sep" }));
      group = t.group;
    }
    grid.append(
      h("button", {
        class: "tool",
        "data-tool": t.id,
        "data-tip": t.title,
        "data-keys": t.key,
        "data-side": "right",
        "aria-label": t.title,
        onclick: () => setTool(t.id),
      }, icon(t.icon, 19)),
    );
  }
  const primary: HTMLButtonElement = h("button", { class: "cw primary", "data-tip": "Farbe 1 (Linksklick)", "data-side": "right", onclick: () => pickColor(primary, false) });
  const secondary: HTMLButtonElement = h("button", { class: "cw secondary", "data-tip": "Farbe 2 (Rechtsklick, Füllung)", "data-side": "right", onclick: () => pickColor(secondary, true) });
  const swap = h("button", { class: "cw-swap", "data-tip": "Farben tauschen", "data-keys": "X", "data-side": "right", onclick: swapColors }, icon("ArrowLeftRight", 12, 2.2));
  const colors = h("div", { class: "dock-colors" }, secondary, primary, swap);
  const paint = () => {
    primary.style.setProperty("--c", settings.color);
    secondary.style.setProperty("--c", settings.secondary);
  };
  on("settings", paint);
  on("color", paint);
  paint();
  const dock = h("nav", { class: "dock glass" }, grid, colors);
  const mark = () => dock.querySelectorAll<HTMLElement>(".tool").forEach((b) => b.classList.toggle("on", b.dataset.tool === S.tool));
  on("tool", mark);
  mark();
  return dock;
}

function pickColor(anchor: HTMLElement, second: boolean) {
  popover(
    anchor,
    colorPanel(second ? settings.secondary : settings.color, (c, final) => {
      if (second) settings.secondary = c;
      else settings.color = c;
      saveSettings();
      emit("color");
      if (final) {
        closePopover();
        emit("settings");
      }
    }),
    { side: "right" },
  );
}

// ---------- bottom ----------

function buildBottom() {
  const info = h("div", { class: "pill info glass" });
  const zoomLabel = h("button", { class: "zoom-val", "data-tip": "Zwischen Einpassen und 100 % wechseln" , onclick: () => (Math.abs((S.doc?.view.zoom ?? 1) - 1) < 0.001 ? fitView() : zoomAt(1)) });
  const zoom = h(
    "div",
    { class: "pill zoom glass" },
    h("button", { class: "ibtn sm", "data-tip": "Verkleinern", "data-keys": keysOf("zoomOut"), onclick: () => zoomStep(-1) }, icon("Minus", 15)),
    zoomLabel,
    h("button", { class: "ibtn sm", "data-tip": "Vergrößern", "data-keys": keysOf("zoomIn"), onclick: () => zoomStep(1) }, icon("Plus", 15)),
    h("div", { class: "tb-sep" }),
    h("button", { class: "ibtn sm", "data-tip": "Einpassen", "data-keys": keysOf("fit"), onclick: () => fitView() }, icon("Maximize", 15)),
  );
  const hint = h("div", { class: "hint" });
  const upd = () => {
    const d = S.doc;
    [info, zoom, hint].forEach((e) => e.classList.toggle("hidden", !d));
    if (!d) return;
    zoomLabel.textContent = `${Math.round(d.view.zoom * 100)} %`;
    clear(info);
    info.append(icon("Image", 14), h("span", { class: "mono" }, `${d.w} × ${d.h}`));
    if (S.cursor && S.cursor.x >= 0 && S.cursor.y >= 0 && S.cursor.x < d.w && S.cursor.y < d.h) {
      info.append(h("span", { class: "dim" }, "·"), icon("Crosshair", 13), h("span", { class: "mono" }, `${Math.floor(S.cursor.x)}, ${Math.floor(S.cursor.y)}`));
    }
    const m = S.marquee?.r ?? S.crop;
    if (m) info.append(h("span", { class: "dim" }, "·"), icon("SquareDashed", 13), h("span", { class: "mono" }, `${Math.round(m.w)} × ${Math.round(m.h)}`));
  };
  const updHint = () => {
    hint.textContent = TOOLS.find((t) => t.id === S.tool)?.hint ?? "";
  };
  for (const ev of ["view", "cursor", "docs", "doc", "marquee", "crop"]) on(ev, upd);
  on("tool", updHint);
  updHint();
  upd();
  return [info, hint, zoom];
}

// ---------- empty state ----------

function buildEmpty(newDialog: (preset?: [number, number]) => void) {
  const k = (s: string) => h("kbd", {}, s);
  const presets: [string, number, number, string][] = [
    ["Full HD", 1920, 1080, "Querformat"],
    ["Quadrat", 1080, 1080, "Social Media"],
    ["Hochformat", 1080, 1920, "Story, Handy"],
    ["A4", 2480, 3508, "Druck, 300 dpi"],
  ];
  return h(
    "div",
    { class: "empty" },
    h("div", { class: "empty-glow" }),
    h(
      "div",
      { class: "empty-card" },
      h("div", { class: "empty-logo" }, logo(128, true)),
      h("h1", {}, "Malen, zeichnen, gestalten."),
      h("p", { class: "lead" }, "Ein modernes Malprogramm für Mac und Windows. Soll ein Bild weitergegeben werden, sind Pfeile, Nummern, Verpixeln und Schmuckrahmen nur einen Klick entfernt."),
      h("div", { class: "empty-label" }, "Neue Leinwand"),
      h(
        "div",
        { class: "presets" },
        presets.map(([n, w, hh, sub]) =>
          h("button", { class: "preset", onclick: () => blankDoc(w, hh, "#FFFFFF", n) },
            h("span", { class: "pv-box" }, h("span", { class: "pv", style: { aspectRatio: `${w} / ${hh}` } })),
            h("b", {}, n),
            h("small", {}, `${w} × ${hh}`),
            h("em", {}, sub),
          ),
        ),
        h("button", { class: "preset custom", onclick: () => newDialog() },
          h("span", { class: "pv-box" }, icon("Plus", 22, 1.8)),
          h("b", {}, "Eigene Größe"),
          h("span", { class: "kbds" }, k(MOD), k("N")),
        ),
      ),
      h(
        "div",
        { class: "empty-actions" },
        h("button", { class: "ghost", onclick: () => void openFiles() }, icon("FolderOpen", 17), "Bild öffnen", h("span", { class: "kbds" }, k(MOD), k("O"))),
        h("button", { class: "ghost", onclick: () => runCommand("paste") }, icon("ClipboardPaste", 17), "Aus der Zwischenablage einfügen", h("span", { class: "kbds" }, k(MOD), k("V"))),
      ),
      h("div", { class: "empty-foot" }, "Bilder lassen sich auch einfach hierher ziehen", h("span", { class: "dim" }, "·"), "Alle Befehle:", h("span", { class: "kbds" }, k(MOD), k("K"))),
      h("div", { class: "empty-credit" }, "Klecks von", h("button", { class: "link", onclick: () => void openUrl(WEBSITE) }, "Wolfgang Linz")),
    ),
  );
}

// ---------- assembly ----------

export function buildChrome(app: HTMLElement, opts: { menu: () => void; newDialog: (preset?: [number, number]) => void }) {
  initTooltips();
  const top = buildTopbar(opts.menu);
  const stage = h("main", { class: "stage" });
  const view = h("canvas", { class: "view" });
  const editor = h("textarea", { class: "text-editor", spellcheck: false, autocomplete: "off" });
  const empty = buildEmpty(opts.newDialog);
  const drop = h("div", { class: "drop" }, h("div", { class: "drop-card" }, icon("ImageDown", 36, 1.6), h("b", {}, "Loslassen zum Öffnen"), h("small", {}, "Jedes Bild öffnet sich in einem eigenen Tab")));
  stage.append(view, editor, buildDock(), ...buildBottom(), empty, drop);
  app.append(top, stage);

  const sync = () => {
    app.classList.toggle("no-doc", !S.doc);
    renderTabs();
    updateHistoryButtons();
    frameBtn.classList.toggle("active", !!S.doc?.frame.on);
    frameBtn.disabled = !S.doc;
  };
  on("docs", sync);
  on("history", () => {
    updateHistoryButtons();
    scheduleThumbs();
  });
  on("frame", () => frameBtn.classList.toggle("active", !!S.doc?.frame.on));
  on("doc", scheduleThumbs);
  sync();
  return { stage, view, editor, drop };
}
