import type { Frame, Obj, Rect } from "./types";
import type { Doc } from "./state";

interface Meta {
  objects: Obj[];
  frame: Frame;
  w: number;
  h: number;
}

interface Entry {
  label: string;
  before: Meta;
  after: Meta;
  patch?: { x: number; y: number; before: ImageData; after: ImageData };
  full?: { before: HTMLCanvasElement; after: HTMLCanvasElement };
}

const LIMIT = 120;

function cloneCanvas(c: HTMLCanvasElement) {
  const n = document.createElement("canvas");
  n.width = c.width;
  n.height = c.height;
  n.getContext("2d")!.drawImage(c, 0, 0);
  return n;
}

function meta(doc: Doc): Meta {
  return { objects: structuredClone(doc.objects), frame: { ...doc.frame }, w: doc.w, h: doc.h };
}

function sameMeta(a: Meta, b: Meta) {
  return a.w === b.w && a.h === b.h && JSON.stringify(a.objects) === JSON.stringify(b.objects) && JSON.stringify(a.frame) === JSON.stringify(b.frame);
}

/**
 * Raster changes are stored as before/after patches of the touched rectangle, so a brush stroke on
 * a 4K screenshot costs kilobytes instead of a full copy. Size changes keep full copies.
 */
export class Tx {
  private before: Meta;
  private copy: HTMLCanvasElement | null = null;
  private rect: Rect | null = null;
  private full = false;

  constructor(readonly doc: Doc) {
    this.before = meta(doc);
  }

  touchRaster() {
    if (!this.copy) this.copy = cloneCanvas(this.doc.raster);
  }

  dirty(r: Rect) {
    this.touchRaster();
    if (!this.rect) {
      this.rect = { ...r };
      return;
    }
    const x1 = Math.min(this.rect.x, r.x);
    const y1 = Math.min(this.rect.y, r.y);
    const x2 = Math.max(this.rect.x + this.rect.w, r.x + r.w);
    const y2 = Math.max(this.rect.y + this.rect.h, r.y + r.h);
    this.rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /** For operations that replace or resize the whole raster. Call before changing it. */
  fullRaster() {
    this.touchRaster();
    this.full = true;
  }

  commit(label: string): boolean {
    const doc = this.doc;
    const after = meta(doc);
    const entry: Entry = { label, before: this.before, after };
    if (this.full && this.copy) {
      entry.full = { before: this.copy, after: cloneCanvas(doc.raster) };
    } else if (this.rect && this.copy) {
      const x = Math.max(0, Math.floor(this.rect.x));
      const y = Math.max(0, Math.floor(this.rect.y));
      const x2 = Math.min(doc.w, Math.ceil(this.rect.x + this.rect.w));
      const y2 = Math.min(doc.h, Math.ceil(this.rect.y + this.rect.h));
      if (x2 > x && y2 > y) {
        entry.patch = {
          x,
          y,
          before: this.copy.getContext("2d")!.getImageData(x, y, x2 - x, y2 - y),
          after: doc.raster.getContext("2d")!.getImageData(x, y, x2 - x, y2 - y),
        };
      }
    }
    if (!entry.full && !entry.patch && sameMeta(this.before, after)) return false;
    doc.history.push(entry);
    doc.dirty = true;
    return true;
  }
}

export class History {
  private entries: Entry[] = [];
  private index = 0;

  push(e: Entry) {
    this.entries.length = this.index;
    this.entries.push(e);
    if (this.entries.length > LIMIT) this.entries.shift();
    this.index = this.entries.length;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.entries.length;
  }

  get undoLabel() {
    return this.canUndo ? this.entries[this.index - 1].label : "";
  }

  get redoLabel() {
    return this.canRedo ? this.entries[this.index].label : "";
  }

  undo(doc: Doc): string | null {
    if (!this.canUndo) return null;
    const e = this.entries[--this.index];
    apply(doc, e, false);
    return e.label;
  }

  redo(doc: Doc): string | null {
    if (!this.canRedo) return null;
    const e = this.entries[this.index++];
    apply(doc, e, true);
    return e.label;
  }
}

function apply(doc: Doc, e: Entry, forward: boolean) {
  const m = forward ? e.after : e.before;
  doc.objects = structuredClone(m.objects);
  doc.frame = { ...m.frame };
  doc.w = m.w;
  doc.h = m.h;
  if (e.full) {
    doc.raster = cloneCanvas(forward ? e.full.after : e.full.before);
  } else if (e.patch) {
    doc.raster.getContext("2d")!.putImageData(forward ? e.patch.after : e.patch.before, e.patch.x, e.patch.y);
  }
  doc.dirty = true;
}
