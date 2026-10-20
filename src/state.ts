import type {
  ArrowStyle,
  BrushVariant,
  Dash,
  FillMode,
  FontKey,
  Frame,
  Marquee,
  Obj,
  Rect,
  ShapeKind,
  TextBg,
  ToolId,
  View,
} from "./types";
import { History } from "./history";

export interface Settings {
  color: string;
  secondary: string;
  recent: string[];
  arrow: { width: number; arrow: ArrowStyle; dash: Dash; shadow: boolean };
  line: { width: number; dash: Dash; shadow: boolean };
  rect: { width: number; dash: Dash; fill: FillMode; radius: number; shadow: boolean };
  ellipse: { width: number; dash: Dash; fill: FillMode; shadow: boolean };
  shape: { width: number; dash: Dash; fill: FillMode; kind: ShapeKind; shadow: boolean };
  text: { size: number; font: FontKey; bg: TextBg; shadow: boolean };
  step: { size: number };
  highlighter: { width: number; color: string };
  blur: { mode: "pixelate" | "blur"; strength: number };
  spotlight: { dim: number; ellipse: boolean };
  brush: { size: number; opacity: number; variant: BrushVariant };
  pencil: { size: number };
  eraser: { size: number };
  fill: { tolerance: number };
  marquee: { lasso: boolean };
  theme: "system" | "dark" | "light";
}

const DEFAULTS: Settings = {
  color: "#FF3B30",
  secondary: "#FFFFFF",
  recent: [],
  arrow: { width: 8, arrow: "taper", dash: "solid", shadow: true },
  line: { width: 5, dash: "solid", shadow: true },
  rect: { width: 5, dash: "solid", fill: "none", radius: 10, shadow: true },
  ellipse: { width: 5, dash: "solid", fill: "none", shadow: true },
  shape: { width: 5, dash: "solid", fill: "none", kind: "star", shadow: true },
  text: { size: 36, font: "sans", bg: "pill", shadow: true },
  step: { size: 40 },
  highlighter: { width: 26, color: "#FFE14D" },
  blur: { mode: "pixelate", strength: 14 },
  spotlight: { dim: 0.62, ellipse: false },
  brush: { size: 10, opacity: 1, variant: "round" },
  pencil: { size: 1 },
  eraser: { size: 28 },
  fill: { tolerance: 28 },
  marquee: { lasso: false },
  theme: "system",
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("klecks.settings");
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw);
    const out = structuredClone(DEFAULTS) as any;
    for (const k of Object.keys(out)) {
      if (saved[k] === undefined) continue;
      out[k] = typeof out[k] === "object" && !Array.isArray(out[k]) ? { ...out[k], ...saved[k] } : saved[k];
    }
    return out;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const settings = loadSettings();

let saveTimer = 0;
export function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem("klecks.settings", JSON.stringify(settings));
    } catch {}
  }, 300);
}

export interface Doc {
  id: string;
  name: string;
  w: number;
  h: number;
  raster: HTMLCanvasElement;
  objects: Obj[];
  frame: Frame;
  history: History;
  view: View;
  dirty: boolean;
  path?: string;
  /** Bumped on every visual change; the renderer caches the composite against it. */
  version: number;
}

export const FRAME_DEFAULT: Frame = { on: false, preset: 0, padding: 64, radius: 14, shadow: 0.5 };

export const S = {
  docs: [] as Doc[],
  doc: null as Doc | null,
  tool: "select" as ToolId,
  selection: [] as string[],
  marquee: null as Marquee | null,
  crop: null as Rect | null,
  editingText: null as string | null,
  hover: null as string | null,
  cursor: null as { x: number; y: number } | null,
  spaceDown: false,
};

/** Pixel sources for image objects. Objects only keep the key, so they stay plain JSON. */
export const sources = new Map<string, HTMLCanvasElement>();

let seq = 0;
export function uid(prefix = "o") {
  return `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
}

export function registerSource(c: HTMLCanvasElement): string {
  const id = uid("src");
  sources.set(id, c);
  return id;
}

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext("2d")!;
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

/** Tiny event bus: "doc" (doc content), "docs" (tabs), "tool", "selection", "view", "settings". */
export function on(ev: string, fn: Listener) {
  if (!listeners.has(ev)) listeners.set(ev, new Set());
  listeners.get(ev)!.add(fn);
}

export function emit(...evs: string[]) {
  for (const ev of evs) listeners.get(ev)?.forEach((fn) => fn());
}

export function touch(doc = S.doc) {
  if (!doc) return;
  doc.version++;
  emit("doc");
}

export function selectedObjects(): Obj[] {
  const d = S.doc;
  if (!d) return [];
  return d.objects.filter((o) => S.selection.includes(o.id));
}

export function setSelection(ids: string[]) {
  S.selection = ids;
  emit("selection");
}

export function findObj(id: string | null): Obj | undefined {
  return id ? S.doc?.objects.find((o) => o.id === id) : undefined;
}
