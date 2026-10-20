import type { ArrowStyle, BrushVariant, Dash, FillMode, FontKey, Obj, ShapeKind, TextBg, ToolId } from "../types";
import { S, emit, on, saveSettings, selectedObjects, settings, touch } from "../state";
import { begin, commit, copyMarquee, clearMarquee, cropToMarquee, adjustMarquee, deleteSelection, duplicateSelection, reorder, mergeSelection, transformSelectedImage, txOpen, nextStepNumber } from "../docs";
import { applyCrop, setTool, layoutEditor } from "../tools";
import { requestRender } from "../render";
import { h, icon, clear } from "./dom";
import { HIGHLIGHTS, QUICK, iconButton, label, popover, closePopover, segmented, sep, slider, swatchRow, toggle } from "./controls";
import { shapePath, FONTS } from "../objects";

let bar: HTMLElement;
let signature = "";

type Key = ToolId | "image";

function keyFor(o: Obj): Key {
  switch (o.type) {
    case "line":
      return o.arrow === "none" ? "line" : "arrow";
    case "stroke":
      return "highlighter";
    default:
      return o.type as Key;
  }
}

/** Applies a property to the selection (all objects that have it) and to the tool default. */
function apply(fn: (o: any) => void, settingsFn?: () => void, live = false) {
  settingsFn?.();
  saveSettings();
  const sel = selectedObjects();
  if (sel.length) {
    const own = !txOpen();
    if (own && !live) begin();
    if (own && live && !sliderTx) {
      begin();
      sliderTx = true;
    }
    for (const o of sel) fn(o);
    touch();
    if (own && !live) commit("Eigenschaft");
    if (S.editingText) layoutEditor();
  }
  emit("color");
  requestRender();
}

let sliderTx = false;
function endSlider() {
  if (sliderTx) {
    commit("Eigenschaft");
    sliderTx = false;
  }
}

function colorControl(key: Key, current: string) {
  const colors = key === "highlighter" ? HIGHLIGHTS : QUICK;
  return swatchRow(colors, current, (c) => {
    apply(
      (o) => {
        if ("color" in o) o.color = c;
      },
      () => {
        if (key === "highlighter") settings.highlighter.color = c;
        else settings.color = c;
      },
    );
    refresh(true);
  });
}

const ARROWS: { value: ArrowStyle; icon: string; title: string }[] = [
  { value: "taper", icon: "taper", title: "Schwung-Pfeil" },
  { value: "classic", icon: "ArrowUpRight", title: "Klassischer Pfeil" },
  { value: "open", icon: "ChevronRight", title: "Offene Spitze" },
  { value: "double", icon: "MoveDiagonal", title: "Doppelpfeil" },
  { value: "none", icon: "lineTool", title: "Ohne Spitze" },
];

const DASHES: { value: Dash; text: string; title: string }[] = [
  { value: "solid", text: "—", title: "Durchgezogen" },
  { value: "dashed", text: "– –", title: "Gestrichelt" },
  { value: "dotted", text: "···", title: "Gepunktet" },
];

const FILLS: { value: FillMode; icon: string; title: string }[] = [
  { value: "none", icon: "Square", title: "Ohne Füllung" },
  { value: "tint", icon: "SquareDashedBottom", title: "Zarte Füllung in der Linienfarbe" },
  { value: "solid", icon: "SquareSquare", title: "Gefüllt mit der zweiten Farbe" },
];

const SHAPES: { value: ShapeKind; title: string }[] = [
  { value: "triangle", title: "Dreieck" },
  { value: "rtriangle", title: "Rechtwinkliges Dreieck" },
  { value: "diamond", title: "Raute" },
  { value: "pentagon", title: "Fünfeck" },
  { value: "hexagon", title: "Sechseck" },
  { value: "star", title: "Stern" },
  { value: "heart", title: "Herz" },
  { value: "bubble", title: "Sprechblase" },
  { value: "blockarrow", title: "Blockpfeil" },
  { value: "check", title: "Haken" },
  { value: "cross", title: "Kreuz" },
];

function shapeIcon(kind: ShapeKind, size = 18) {
  const c = h("canvas", { width: size * 2, height: size * 2, style: { width: `${size}px`, height: `${size}px` } });
  const ctx = c.getContext("2d")!;
  ctx.scale(2, 2);
  const p = shapePath(kind, 2, 2, size - 4, size - 4);
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#fff";
  ctx.stroke(p);
  return c;
}

function shapePicker(current: ShapeKind) {
  const btn: HTMLButtonElement = h(
    "button",
    {
      class: "pick-btn",
      title: "Form wählen",
      onclick: () => {
        const grid = h("div", { class: "shape-grid" }, SHAPES.map((s) =>
          h("button", {
            class: `shape-cell ${s.value === current ? "on" : ""}`,
            title: s.title,
            onclick: () => {
              apply((o) => {
                if (o.type === "shape") o.kind = s.value;
              }, () => (settings.shape.kind = s.value));
              closePopover();
              refresh(true);
            },
          }, shapeIcon(s.value, 22)),
        ));
        popover(btn, grid);
      },
    },
    shapeIcon(current),
    icon("ChevronDown", 13),
  );
  return btn;
}

function strokeControls(key: "arrow" | "line" | "rect" | "ellipse" | "shape", vals: { width: number; dash: Dash; shadow: boolean }) {
  const s = settings[key];
  return [
    slider({
      title: "Stärke",
      min: key === "arrow" || key === "line" ? 1 : 0,
      max: 48,
      value: vals.width,
      format: (v) => `${Math.round(v)} px`,
      onInput: (v) => apply((o) => ("width" in o ? (o.width = v) : null), () => (s.width = v), true),
      onCommit: endSlider,
    }),
    segmented(DASHES, vals.dash, (v) => apply((o) => ("dash" in o ? (o.dash = v) : null), () => (s.dash = v))),
    toggle("Layers2", "Schatten", vals.shadow, (v) => apply((o) => (o.shadow = v), () => (s.shadow = v))),
  ];
}

function sectionFor(key: Key, obj: Obj | null): (Node | null)[] {
  const out: (Node | null)[] = [];
  switch (key) {
    case "arrow":
    case "line": {
      const o = obj?.type === "line" ? obj : null;
      const s = key === "arrow" ? settings.arrow : settings.line;
      out.push(colorControl(key, o?.color ?? settings.color), sep());
      out.push(segmented(ARROWS, o?.arrow ?? (key === "arrow" ? settings.arrow.arrow : "none"), (v) =>
        apply((x) => (x.type === "line" ? (x.arrow = v) : null), () => key === "arrow" && v !== "none" && (settings.arrow.arrow = v)),
      ));
      out.push(sep(), ...strokeControls(key, { width: o?.width ?? s.width, dash: o?.dash ?? s.dash, shadow: o?.shadow ?? s.shadow }));
      break;
    }
    case "rect":
    case "ellipse":
    case "shape": {
      const o = obj && (obj.type === "rect" || obj.type === "ellipse" || obj.type === "shape") ? obj : null;
      const s = settings[key];
      if (key === "shape") out.push(shapePicker(o?.kind ?? settings.shape.kind), sep());
      out.push(colorControl(key, o?.color ?? settings.color), sep());
      out.push(segmented(FILLS, o?.fill ?? s.fill, (v) => {
        apply((x) => {
          if ("fill" in x) {
            x.fill = v;
            if (v === "solid") x.fillColor = settings.secondary;
          }
        }, () => (s.fill = v));
      }));
      if (key === "rect")
        out.push(slider({
          title: "Eckenradius",
          min: 0,
          max: 80,
          value: o?.radius ?? settings.rect.radius,
          width: 110,
          format: (v) => `◜ ${Math.round(v)}`,
          onInput: (v) => apply((x) => (x.type === "rect" ? (x.radius = v) : null), () => (settings.rect.radius = v), true),
          onCommit: endSlider,
        }));
      out.push(sep(), ...strokeControls(key, { width: o?.width ?? s.width, dash: o?.dash ?? s.dash, shadow: o?.shadow ?? s.shadow }));
      break;
    }
    case "text": {
      const o = obj?.type === "text" ? obj : null;
      const s = settings.text;
      out.push(colorControl(key, o?.color ?? settings.color), sep());
      out.push(segmented<FontKey>(
        (Object.keys(FONTS) as FontKey[]).map((k) => ({ value: k, text: k === "sans" ? "Aa" : k === "hand" ? "Hand" : k === "serif" ? "Serif" : "Mono", title: FONTS[k].label })),
        o?.font ?? s.font,
        (v) => apply((x) => (x.type === "text" ? (x.font = v) : null), () => (s.font = v)),
      ));
      out.push(slider({
        title: "Schriftgröße",
        min: 10,
        max: 240,
        log: true,
        value: o?.size ?? s.size,
        format: (v) => `${Math.round(v)} pt`,
        onInput: (v) => apply((x) => (x.type === "text" ? (x.size = v) : null), () => (s.size = v), true),
        onCommit: endSlider,
      }));
      out.push(sep(), segmented<TextBg>([
        { value: "none", icon: "Type", title: "Nur Text" },
        { value: "pill", icon: "RectangleHorizontal", title: "Text auf farbigem Etikett" },
        { value: "outline", icon: "Baseline", title: "Text mit Kontur, lesbar auf jedem Hintergrund" },
      ], o?.bg ?? s.bg, (v) => apply((x) => (x.type === "text" ? (x.bg = v) : null), () => (s.bg = v))));
      out.push(toggle("Layers2", "Schatten", o?.shadow ?? s.shadow, (v) => apply((x) => (x.shadow = v), () => (s.shadow = v))));
      break;
    }
    case "step": {
      const o = obj?.type === "step" ? obj : null;
      out.push(colorControl(key, o?.color ?? settings.color), sep());
      out.push(slider({
        title: "Größe",
        min: 16,
        max: 160,
        value: o?.size ?? settings.step.size,
        format: (v) => `${Math.round(v)} px`,
        onInput: (v) => apply((x) => (x.type === "step" ? (x.size = v) : null), () => (settings.step.size = v), true),
        onCommit: endSlider,
      }));
      if (o) {
        out.push(sep(), label("Nummer"), stepper(o.n, (n) => apply((x) => (x.type === "step" ? (x.n = n) : null))));
      } else out.push(sep(), h("span", { class: "pb-chip" }, icon("step", 14), `Nächste: ${S.doc ? nextStepNumber() : 1}`));
      break;
    }
    case "highlighter": {
      const o = obj?.type === "stroke" ? obj : null;
      out.push(colorControl(key, o?.color ?? settings.highlighter.color), sep());
      out.push(slider({
        title: "Breite",
        min: 4,
        max: 120,
        value: o?.width ?? settings.highlighter.width,
        format: (v) => `${Math.round(v)} px`,
        onInput: (v) => apply((x) => (x.type === "stroke" ? (x.width = v) : null), () => (settings.highlighter.width = v), true),
        onCommit: endSlider,
      }));
      break;
    }
    case "blur": {
      const o = obj?.type === "blur" ? obj : null;
      out.push(segmented<"pixelate" | "blur">([
        { value: "pixelate", icon: "Grid3x3", text: "Pixel", title: "Verpixeln" },
        { value: "blur", icon: "Droplets", text: "Weich", title: "Weichzeichnen" },
      ], o?.mode ?? settings.blur.mode, (v) => apply((x) => (x.type === "blur" ? (x.mode = v) : null), () => (settings.blur.mode = v))));
      out.push(slider({
        title: "Stärke",
        min: 4,
        max: 60,
        value: o?.strength ?? settings.blur.strength,
        onInput: (v) => apply((x) => (x.type === "blur" ? (x.strength = v) : null), () => (settings.blur.strength = v), true),
        onCommit: endSlider,
      }));
      break;
    }
    case "spotlight": {
      const o = obj?.type === "spotlight" ? obj : null;
      out.push(segmented<"r" | "e">([
        { value: "r", icon: "Square", title: "Rechteckig" },
        { value: "e", icon: "Circle", title: "Rund" },
      ], (o?.ellipse ?? settings.spotlight.ellipse) ? "e" : "r", (v) => apply((x) => (x.type === "spotlight" ? (x.ellipse = v === "e") : null), () => (settings.spotlight.ellipse = v === "e"))));
      out.push(slider({
        title: "Abdunkeln",
        min: 0.15,
        max: 0.9,
        step: 0.01,
        value: o?.dim ?? settings.spotlight.dim,
        format: (v) => `${Math.round(v * 100)} %`,
        onInput: (v) => apply((x) => (x.type === "spotlight" ? (x.dim = v) : null), () => (settings.spotlight.dim = v), true),
        onCommit: endSlider,
      }));
      break;
    }
    case "brush":
      out.push(colorControl(key, settings.color), sep());
      out.push(segmented<BrushVariant>([
        { value: "round", icon: "Brush", title: "Rundpinsel" },
        { value: "calligraphy", icon: "PenTool", title: "Kalligrafie" },
        { value: "soft", icon: "Cloud", title: "Weicher Airbrush" },
        { value: "spray", icon: "SprayCan", title: "Sprühdose" },
      ], settings.brush.variant, (v) => apply(() => {}, () => (settings.brush.variant = v))));
      out.push(sizeSlider("brush", 1, 300), slider({
        title: "Deckkraft",
        min: 0.05,
        max: 1,
        step: 0.01,
        value: settings.brush.opacity,
        width: 112,
        format: (v) => `${Math.round(v * 100)} %`,
        onInput: (v) => {
          settings.brush.opacity = v;
          saveSettings();
        },
      }));
      break;
    case "pencil":
      out.push(colorControl(key, settings.color), sep(), sizeSlider("pencil", 1, 40));
      break;
    case "eraser":
      out.push(sizeSlider("eraser", 2, 400));
      break;
    case "fill":
      out.push(colorControl(key, settings.color), sep(), label("Toleranz"), slider({
        title: "Toleranz",
        min: 0,
        max: 100,
        value: settings.fill.tolerance,
        format: (v) => `${Math.round(v)} %`,
        onInput: (v) => {
          settings.fill.tolerance = v;
          saveSettings();
        },
      }));
      break;
    case "picker":
      out.push(h("span", { class: "pb-hint" }, icon("Pipette", 15), "Klick nimmt die Farbe auf, Rechtsklick als zweite Farbe"));
      break;
    case "marquee":
      out.push(segmented<"r" | "l">([
        { value: "r", icon: "SquareDashed", text: "Rechteck", title: "Rechteckige Auswahl" },
        { value: "l", icon: "Lasso", text: "Frei", title: "Freie Auswahl (Lasso)" },
      ], settings.marquee.lasso ? "l" : "r", (v) => {
        settings.marquee.lasso = v === "l";
        saveSettings();
      }));
      if (S.marquee) {
        out.push(
          sep(),
          h("span", { class: "pb-chip mono" }, `${Math.round(S.marquee.r.w)} × ${Math.round(S.marquee.r.h)}`),
          iconButton("Crop", "Auf Auswahl zuschneiden", () => cropToMarquee(), { text: "Zuschneiden" }),
          iconButton("Copy", "Auswahl kopieren", () => void copyMarquee()),
          iconButton("Scissors", "Ausschneiden", () => void copyMarquee(true)),
          iconButton("Contrast", "Farben umkehren", () => adjustMarquee("invert")),
          iconButton("Trash", "Leeren", () => clearMarquee(), { danger: true }),
        );
      } else out.push(h("span", { class: "pb-hint" }, "Bereich aufziehen, dann verschieben, kopieren oder zuschneiden"));
      break;
    case "crop":
      if (S.crop) {
        out.push(
          h("span", { class: "pb-chip mono" }, `${S.crop.w} × ${S.crop.h}`),
          segmented<string>([
            { value: "free", text: "Frei", title: "Freies Seitenverhältnis" },
            { value: "1", text: "1:1", title: "Quadrat" },
            { value: "1.7778", text: "16:9", title: "16:9" },
            { value: "1.3333", text: "4:3", title: "4:3" },
          ], "free", (v) => {
            if (v === "free" || !S.doc || !S.crop) return;
            const ar = Number(v);
            const d = S.doc;
            let w = d.w, hh = Math.round(w / ar);
            if (hh > d.h) {
              hh = d.h;
              w = Math.round(hh * ar);
            }
            S.crop = { x: Math.round((d.w - w) / 2), y: Math.round((d.h - hh) / 2), w, h: hh };
            requestRender();
            refresh(true);
          }),
          sep(),
          iconButton("X", "Abbrechen (Esc)", () => setTool("select"), { text: "Abbrechen" }),
          h("button", { class: "btn primary sm", onclick: () => applyCrop() }, icon("Check", 15, 2.4), "Zuschneiden"),
        );
      }
      break;
    case "image":
      out.push(
        iconButton("flipH", "Horizontal spiegeln", () => transformSelectedImage("flipH")),
        iconButton("flipV", "Vertikal spiegeln", () => transformSelectedImage("flipV")),
        iconButton("RotateCw", "Um 90° drehen", () => transformSelectedImage("cw")),
        sep(),
        iconButton("Merge", "Ins Bild einbrennen", () => mergeSelection(), { text: "Einbrennen" }),
      );
      break;
    case "select":
      out.push(h("span", { class: "pb-hint" }, icon("MousePointer2", 15), "Markierung anklicken, um sie zu bearbeiten. Ziehen wählt mehrere."));
      break;
    case "hand":
      out.push(h("span", { class: "pb-hint" }, icon("Hand", 15), "Ziehen verschiebt die Ansicht. Tipp: Leertaste halten geht mit jedem Werkzeug."));
      break;
  }
  return out;
}

function sizeSlider(key: "brush" | "pencil" | "eraser", min: number, max: number) {
  return slider({
    title: "Größe",
    min,
    max,
    log: max > 60,
    value: settings[key].size,
    format: (v) => `${Math.round(v)} px`,
    onInput: (v) => {
      settings[key].size = v;
      saveSettings();
      requestRender();
    },
  });
}

function stepper(value: number, onChange: (n: number) => void) {
  const out = h("span", { class: "sl-val" }, String(value));
  const set = (n: number) => {
    value = Math.max(1, n);
    out.textContent = String(value);
    onChange(value);
  };
  return h("div", { class: "stepper" }, iconButton("Minus", "Kleiner", () => set(value - 1)), out, iconButton("Plus", "Größer", () => set(value + 1)));
}

function selectionActions(): Node[] {
  return [
    sep(),
    iconButton("BringToFront", "Nach vorn", () => reorder("front")),
    iconButton("SendToBack", "Nach hinten", () => reorder("back")),
    iconButton("CopyPlus", "Duplizieren", () => duplicateSelection()),
    iconButton("Trash", "Löschen", () => deleteSelection(), { danger: true }),
  ];
}

export function refresh(force = false) {
  if (!bar) return;
  const sel = selectedObjects();
  const sig = `${S.tool}|${sel.map((o) => `${o.id}:${keyFor(o)}`).join(",")}|${!!S.marquee}|${!!S.crop}|${S.doc?.id}`;
  if (!force && sig === signature) return;
  signature = sig;
  clear(bar);
  if (!S.doc) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  const keys = [...new Set(sel.map(keyFor))];
  let content: (Node | null)[];
  if (S.marquee) {
    content = sectionFor("marquee", null);
    if (sel.length) content.push(sep(), h("span", { class: "pb-chip" }, icon("Boxes", 14), `inkl. ${sel.length} ${sel.length === 1 ? "Markierung" : "Markierungen"}`));
  } else if (sel.length && keys.length === 1) {
    content = sectionFor(keys[0], sel[0]);
    if (keys[0] === "image") content = [h("span", { class: "pb-chip" }, icon("Image", 14), "Bild"), sep(), ...content];
    content.push(...selectionActions());
  } else if (sel.length) {
    content = [h("span", { class: "pb-chip" }, icon("Boxes", 14), `${sel.length} Objekte`), ...selectionActions()];
  } else {
    content = sectionFor(S.tool, null);
  }
  bar.append(...content.filter((x): x is Node => !!x));
}

export function initPropbar(parent: HTMLElement) {
  bar = h("div", { class: "propbar glass" });
  parent.append(bar);
  for (const ev of ["tool", "selection", "docs", "marquee", "crop"]) on(ev, () => refresh());
  on("settings", () => refresh(true));
  on("crop", () => {
    const chip = bar.querySelector(".pb-chip.mono");
    if (chip && S.crop) chip.textContent = `${S.crop.w} × ${S.crop.h}`;
  });
  on("marquee", () => {
    const chip = bar.querySelector(".pb-chip.mono");
    if (chip && S.marquee) chip.textContent = `${Math.round(S.marquee.r.w)} × ${Math.round(S.marquee.r.h)}`;
  });
  refresh(true);
}
