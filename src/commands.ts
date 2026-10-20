import type { ToolId } from "./types";
import { S, emit, saveSettings, settings } from "./state";
import * as D from "./docs";
import { applyCrop, setTool } from "./tools";
import { isMac, pickAndOpen } from "./io";
import { requestRender } from "./render";

export interface Command {
  id: string;
  title: string;
  group: "Datei" | "Bearbeiten" | "Bild" | "Objekt" | "Ansicht" | "Werkzeug" | "Hilfe";
  keys?: string[];
  icon?: string;
  run: () => void;
  when?: () => boolean;
  hidden?: boolean;
}

const hasDoc = () => !!S.doc;
const hasSel = () => S.selection.length > 0;

export const TOOLS: { id: ToolId; title: string; icon: string; key: string; group: number; hint: string }[] = [
  { id: "select", title: "Auswählen", icon: "MousePointer2", key: "V", group: 0, hint: "Klicken wählt · Ziehen wählt mehrere · Alt+Ziehen dupliziert · Doppelklick bearbeitet Text" },
  { id: "hand", title: "Ansicht verschieben", icon: "Hand", key: "H", group: 0, hint: "Ziehen verschiebt die Ansicht · Leertaste hält das Werkzeug jederzeit" },
  { id: "marquee", title: "Bereich auswählen", icon: "SquareDashed", key: "M", group: 0, hint: "Bereich aufziehen · hineinklicken und ziehen hebt ihn heraus · Entf leert ihn" },
  { id: "crop", title: "Zuschneiden", icon: "Crop", key: "C", group: 0, hint: "Rahmen anpassen · Enter oder Doppelklick schneidet zu · Esc bricht ab" },
  { id: "brush", title: "Pinsel", icon: "Brush", key: "B", group: 1, hint: "Malen · Rechtsklick malt mit der zweiten Farbe · Stiftdruck wird erkannt" },
  { id: "pencil", title: "Stift", icon: "Pencil", key: "P", group: 1, hint: "Harte Pixel wie im klassischen Paint · Shift zieht gerade Linien" },
  { id: "eraser", title: "Radierer", icon: "Eraser", key: "E", group: 1, hint: "Radiert Pixel transparent · Markierungen löscht Entf" },
  { id: "fill", title: "Füllen", icon: "PaintBucket", key: "K", group: 1, hint: "Klick füllt die Fläche · auf einer Form füllt er die Form" },
  { id: "picker", title: "Farbe aufnehmen", icon: "Pipette", key: "I", group: 1, hint: "Klick übernimmt die Farbe · Rechtsklick als zweite Farbe" },
  { id: "text", title: "Text", icon: "Type", key: "T", group: 1, hint: "Klicken und tippen · Strg/⌘+Enter oder Esc beendet" },
  { id: "line", title: "Linie", icon: "lineTool", key: "L", group: 2, hint: "Ziehen zeichnet · Shift rastet in 15°-Schritten ein · mittlerer Griff biegt" },
  { id: "rect", title: "Rechteck", icon: "Square", key: "R", group: 2, hint: "Ziehen zeichnet · Shift für Quadrat · Alt von der Mitte aus" },
  { id: "ellipse", title: "Ellipse", icon: "Circle", key: "O", group: 2, hint: "Ziehen zeichnet · Shift für Kreis · Alt von der Mitte aus" },
  { id: "shape", title: "Formen", icon: "Shapes", key: "U", group: 2, hint: "Form oben wählen · Ziehen zeichnet · Shift hält die Proportionen" },
  { id: "arrow", title: "Pfeil", icon: "MoveUpRight", key: "A", group: 3, hint: "Ziehen zeichnet · Shift rastet Winkel ein · mittleren Griff ziehen biegt den Pfeil" },
  { id: "step", title: "Nummer", icon: "step", key: "N", group: 3, hint: "Jeder Klick setzt die nächste Nummer · ideal für Schritt-für-Schritt-Anleitungen" },
  { id: "highlighter", title: "Textmarker", icon: "Highlighter", key: "G", group: 3, hint: "Über Text ziehen · Shift für eine gerade Linie" },
  { id: "blur", title: "Unkenntlich machen", icon: "blurBox", key: "J", group: 3, hint: "Bereich aufziehen, um Namen, E-Mails oder Passwörter zu verpixeln" },
  { id: "spotlight", title: "Spotlight", icon: "spot", key: "F", group: 3, hint: "Bereich aufziehen · alles andere wird abgedunkelt" },
];

let ui: {
  newDialog: () => void;
  resizeDialog: () => void;
  canvasDialog: () => void;
  palette: () => void;
  shortcuts: () => void;
  toggleTheme: () => void;
  toggleFrame: () => void;
  checkUpdates: () => void;
  about: () => void;
} = null!;

export function bindUi(u: typeof ui) {
  ui = u;
}

export async function openFiles() {
  for (const f of await pickAndOpen()) D.createDoc(f.canvas, f.name, f.path);
}

export const COMMANDS: Command[] = [
  // Datei
  { id: "new", title: "Neue Leinwand …", group: "Datei", keys: ["mod+n"], icon: "FilePlus2", run: () => ui.newDialog() },
  { id: "open", title: "Bild öffnen …", group: "Datei", keys: ["mod+o"], icon: "FolderOpen", run: () => void openFiles() },
  { id: "pasteNew", title: "Als neues Bild einfügen", group: "Datei", keys: ["mod+shift+v"], icon: "ClipboardPaste", run: () => pasteFromSystem(true) },
  { id: "save", title: "Sichern", group: "Datei", keys: ["mod+s"], icon: "Save", run: () => void D.saveDoc(), when: hasDoc },
  { id: "saveAs", title: "Sichern unter …", group: "Datei", keys: ["mod+shift+s"], icon: "Download", run: () => void D.saveDoc(S.doc, false), when: hasDoc },
  { id: "copyImage", title: "Fertiges Bild kopieren", group: "Datei", keys: ["mod+shift+c"], icon: "Copy", run: () => void D.copyImage(), when: hasDoc },
  { id: "closeTab", title: "Bild schließen", group: "Datei", keys: ["mod+w"], icon: "X", run: () => void D.closeDoc(), when: hasDoc },
  { id: "nextTab", title: "Nächstes Bild", group: "Datei", keys: ["ctrl+tab", "mod+alt+arrowright"], run: () => cycleTab(1), when: () => S.docs.length > 1 },
  { id: "prevTab", title: "Vorheriges Bild", group: "Datei", keys: ["ctrl+shift+tab", "mod+alt+arrowleft"], run: () => cycleTab(-1), when: () => S.docs.length > 1 },
  // Bearbeiten
  { id: "undo", title: "Rückgängig", group: "Bearbeiten", keys: ["mod+z"], icon: "Undo2", run: () => D.undo(), when: hasDoc },
  { id: "redo", title: "Wiederholen", group: "Bearbeiten", keys: ["mod+shift+z", "mod+y"], icon: "Redo2", run: () => D.redo(), when: hasDoc },
  { id: "copy", title: "Kopieren", group: "Bearbeiten", keys: ["mod+c"], icon: "Copy", run: () => void (S.marquee ? D.copyMarquee() : hasSel() ? D.copyObjects() : D.copyImage()), when: hasDoc },
  { id: "cut", title: "Ausschneiden", group: "Bearbeiten", keys: ["mod+x"], icon: "Scissors", run: () => void (S.marquee ? D.copyMarquee(true) : D.copyObjects(true)), when: () => hasSel() || !!S.marquee },
  { id: "paste", title: "Einfügen", group: "Bearbeiten", icon: "ClipboardPaste", run: () => pasteFromSystem(false) },
  { id: "duplicate", title: "Duplizieren", group: "Bearbeiten", keys: ["mod+d"], icon: "CopyPlus", run: () => D.duplicateSelection(), when: hasSel },
  { id: "delete", title: "Löschen", group: "Bearbeiten", keys: ["delete", "backspace"], icon: "Trash", run: () => (S.marquee ? D.clearMarquee() : D.deleteSelection()), when: () => hasSel() || !!S.marquee },
  { id: "selectAll", title: "Alles auswählen", group: "Bearbeiten", keys: ["mod+a"], icon: "BoxSelect", run: () => D.selectAll(), when: hasDoc },
  // Bild
  { id: "cropSel", title: "Auf Auswahl zuschneiden", group: "Bild", keys: ["mod+shift+x"], icon: "Crop", run: () => D.cropToMarquee(), when: () => !!S.marquee },
  { id: "resize", title: "Bildgröße …", group: "Bild", keys: ["mod+alt+i"], icon: "Scaling", run: () => ui.resizeDialog(), when: hasDoc },
  { id: "canvas", title: "Zeichenfläche …", group: "Bild", keys: ["mod+alt+c"], icon: "Expand", run: () => ui.canvasDialog(), when: hasDoc },
  { id: "rotCW", title: "Um 90° nach rechts drehen", group: "Bild", icon: "RotateCw", run: () => D.transformImage("cw"), when: hasDoc },
  { id: "rotCCW", title: "Um 90° nach links drehen", group: "Bild", icon: "RotateCcw", run: () => D.transformImage("ccw"), when: hasDoc },
  { id: "rot180", title: "Um 180° drehen", group: "Bild", icon: "RefreshCw", run: () => D.transformImage("180"), when: hasDoc },
  { id: "flipH", title: "Horizontal spiegeln", group: "Bild", icon: "flipH", run: () => D.transformImage("flipH"), when: hasDoc },
  { id: "flipV", title: "Vertikal spiegeln", group: "Bild", icon: "flipV", run: () => D.transformImage("flipV"), when: hasDoc },
  { id: "invert", title: "Farben umkehren", group: "Bild", keys: ["mod+shift+i"], icon: "Contrast", run: () => D.adjustMarquee("invert"), when: hasDoc },
  { id: "gray", title: "Graustufen", group: "Bild", icon: "Droplet", run: () => D.adjustMarquee("grayscale"), when: hasDoc },
  { id: "flatten", title: "Markierungen ins Bild übernehmen", group: "Bild", keys: ["mod+e"], icon: "Layers", run: () => D.flatten(), when: () => !!S.doc?.objects.length },
  { id: "frame", title: "Schmuckrahmen ein/aus", group: "Bild", keys: ["mod+b"], icon: "Sparkles", run: () => ui.toggleFrame(), when: hasDoc },
  // Objekt
  { id: "front", title: "Ganz nach vorn", group: "Objekt", keys: ["mod+shift+bracketright"], icon: "BringToFront", run: () => D.reorder("front"), when: hasSel },
  { id: "forward", title: "Eine Ebene nach vorn", group: "Objekt", keys: ["mod+bracketright"], icon: "ArrowUp", run: () => D.reorder("up"), when: hasSel },
  { id: "backward", title: "Eine Ebene nach hinten", group: "Objekt", keys: ["mod+bracketleft"], icon: "ArrowDown", run: () => D.reorder("down"), when: hasSel },
  { id: "back", title: "Ganz nach hinten", group: "Objekt", keys: ["mod+shift+bracketleft"], icon: "SendToBack", run: () => D.reorder("back"), when: hasSel },
  { id: "merge", title: "Auswahl ins Bild einbrennen", group: "Objekt", icon: "Merge", run: () => D.mergeSelection(), when: hasSel },
  // Ansicht
  { id: "zoomIn", title: "Vergrößern", group: "Ansicht", keys: ["mod+k:+", "mod+k:=", "mod+numpadadd"], icon: "ZoomIn", run: () => D.zoomStep(1), when: hasDoc },
  { id: "zoomOut", title: "Verkleinern", group: "Ansicht", keys: ["mod+k:-", "mod+numpadsubtract"], icon: "ZoomOut", run: () => D.zoomStep(-1), when: hasDoc },
  { id: "fit", title: "Ins Fenster einpassen", group: "Ansicht", keys: ["mod+digit0"], icon: "Maximize", run: () => D.fitView(), when: hasDoc },
  { id: "actual", title: "Originalgröße (100 %)", group: "Ansicht", keys: ["mod+digit1"], icon: "Scan", run: () => D.zoomAt(1), when: hasDoc },
  { id: "theme", title: "Hell/Dunkel wechseln", group: "Ansicht", icon: "SunMoon", run: () => ui.toggleTheme() },
  { id: "palette", title: "Befehlspalette", group: "Hilfe", keys: ["mod+k", "mod+shift+p"], icon: "Command", run: () => ui.palette() },
  { id: "shortcuts", title: "Tastenkürzel", group: "Hilfe", keys: ["k:?", "f1"], icon: "Keyboard", run: () => ui.shortcuts() },
  { id: "updates", title: "Nach Updates suchen", group: "Hilfe", icon: "RefreshCcw", run: () => ui.checkUpdates() },
  { id: "about", title: "Über Klecks", group: "Hilfe", icon: "Info", run: () => ui.about() },
  // Werkzeuge
  ...TOOLS.map((t) => ({ id: `tool.${t.id}`, title: t.title, group: "Werkzeug" as const, keys: [`key${t.key.toLowerCase()}`], icon: t.icon, run: () => setTool(t.id), when: hasDoc })),
  { id: "swap", title: "Farben tauschen", group: "Werkzeug", keys: ["keyx"], icon: "ArrowLeftRight", run: swapColors },
  { id: "lasso", title: "Freie Auswahl (Lasso)", group: "Werkzeug", keys: ["shift+keym"], icon: "Lasso", run: () => { settings.marquee.lasso = !settings.marquee.lasso; saveSettings(); setTool("marquee"); }, when: hasDoc },
  { id: "applyCrop", title: "Zuschneiden anwenden", group: "Werkzeug", keys: ["enter"], hidden: true, run: () => applyCrop(), when: () => !!S.crop },
  { id: "sizeUp", title: "Größer", group: "Werkzeug", keys: ["k:]", "k:+"], hidden: true, run: () => bumpSize(1) },
  { id: "sizeDown", title: "Kleiner", group: "Werkzeug", keys: ["k:[", "k:-"], hidden: true, run: () => bumpSize(-1) },
];

export function swapColors() {
  [settings.color, settings.secondary] = [settings.secondary, settings.color];
  saveSettings();
  emit("settings");
}

function bumpSize(dir: 1 | -1) {
  const f = dir > 0 ? 1.2 : 1 / 1.2;
  const t = S.tool;
  const clamp = (v: number, a: number, b: number) => Math.round(Math.min(b, Math.max(a, v)));
  if (t === "brush") settings.brush.size = clamp(settings.brush.size * f + dir, 1, 300);
  else if (t === "eraser") settings.eraser.size = clamp(settings.eraser.size * f + dir, 1, 400);
  else if (t === "pencil") settings.pencil.size = clamp(settings.pencil.size + dir, 1, 40);
  else if (t === "highlighter") settings.highlighter.width = clamp(settings.highlighter.width * f + dir, 4, 120);
  else return;
  saveSettings();
  emit("settings");
  requestRender();
}

function cycleTab(dir: number) {
  if (!S.doc) return;
  const i = S.docs.indexOf(S.doc);
  D.switchTo(S.docs[(i + dir + S.docs.length) % S.docs.length]);
}

let pasteFallback: ((asNew: boolean) => void) | null = null;
export function registerPaste(fn: (asNew: boolean) => void) {
  pasteFallback = fn;
}
function pasteFromSystem(asNew: boolean) {
  pasteFallback?.(asNew);
}

export function runCommand(id: string) {
  const c = COMMANDS.find((x) => x.id === id);
  if (c && (!c.when || c.when())) c.run();
}

// ---------- key handling ----------

export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) parts.push("mod");
  if (isMac && e.ctrlKey) parts.push("ctrl");
  if (!isMac && e.metaKey) parts.push("meta");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  // Letters follow the layout (German Z/Y), everything else the physical key.
  const letter = /^[a-z]$/i.test(e.key) ? `key${e.key.toLowerCase()}` : null;
  parts.push(letter ?? e.code.toLowerCase());
  return parts.join("+");
}

/** Normalises key combos written with key names ("delete", "enter") to event codes. */
function codeAlias(k: string) {
  return k
    .replace(/(^|\+)delete$/, "$1delete")
    .replace(/(^|\+)enter$/, "$1enter")
    .replace(/(^|\+)ctrl\+tab$/, isMac ? "$1ctrl+tab" : "$1mod+tab")
    .replace(/(^|\+)ctrl\+shift\+tab$/, isMac ? "$1ctrl+shift+tab" : "$1mod+shift+tab");
}

function matchesKey(spec: string, e: KeyboardEvent): boolean {
  const i = spec.indexOf("k:");
  if (i < 0) return false;
  const mods = spec.slice(0, i).split("+").filter(Boolean);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  return mods.includes("mod") === mod && mods.includes("alt") === e.altKey && e.key.toLowerCase() === spec.slice(i + 2).toLowerCase();
}

export function findCommandFor(e: KeyboardEvent): Command | undefined {
  const combo = comboOf(e);
  return COMMANDS.find((c) => c.keys?.some((k) => (k.includes("k:") ? matchesKey(k, e) : codeAlias(k) === combo || (k === "enter" && combo === "numpadenter"))));
}

const KEY_LABELS: Record<string, string> = {
  mod: isMac ? "⌘" : "Strg",
  ctrl: isMac ? "⌃" : "Strg",
  alt: isMac ? "⌥" : "Alt",
  shift: isMac ? "⇧" : "Shift",
  meta: "Win",
  delete: "Entf",
  backspace: "⌫",
  enter: "↵",
  tab: "Tab",
  equal: "+",
  minus: "−",
  slash: "?",
  bracketleft: "[",
  bracketright: "]",
  arrowright: "→",
  arrowleft: "←",
  numpadadd: "+",
  numpadsubtract: "−",
  f1: "F1",
};

export function keyLabel(k: string): string[] {
  const i = k.indexOf("k:");
  if (i >= 0) return [...k.slice(0, i).split("+").filter(Boolean).map((p) => KEY_LABELS[p] ?? p), k.slice(i + 2)];
  return k.split("+").map((p) => KEY_LABELS[p] ?? p.replace(/^key/, "").replace(/^digit/, "").toUpperCase());
}
