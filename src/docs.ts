import type { ImageObj, Obj, Rect } from "./types";
import { History, Tx } from "./history";
import { FRAME_DEFAULT, S, emit, newCanvas, registerSource, setSelection, sources, touch, uid, type Doc } from "./state";
import { bounds, scaleObject, translate, unionRect } from "./objects";
import { composeInto, exportCanvas, frameRect, requestRender, viewSize } from "./render";
import { askSavePath, basename, copyCanvas, encode, formatOf, stripExt, writeFile } from "./io";
import { adjustPixels, lassoPath, transformCanvas } from "./raster";
import { toast } from "./ui/toast";
import { choose } from "./ui/modal";

// ---------- transactions ----------

let current: Tx | null = null;

export function txOpen() {
  return current !== null;
}

export function begin(): Tx | null {
  if (!S.doc) return null;
  current = new Tx(S.doc);
  return current;
}

export function commit(label: string) {
  if (!current) return;
  const changed = current.commit(label);
  current = null;
  if (changed) emit("history");
}

export function mutate(label: string, fn: (tx: Tx, doc: Doc) => void) {
  const doc = S.doc;
  if (!doc) return;
  if (current) {
    // A longer edit (text, slider drag) is open: fold this change into it.
    fn(current, doc);
    touch(doc);
    requestRender();
    return;
  }
  const tx = begin()!;
  fn(tx, doc);
  touch(doc);
  commit(label);
  requestRender();
}

export function undo() {
  const d = S.doc;
  if (!d) return;
  const label = d.history.undo(d);
  if (!label) return;
  afterHistory(d);
  toast(`Rückgängig: ${label}`, { icon: "Undo2", ms: 1200 });
}

export function redo() {
  const d = S.doc;
  if (!d) return;
  const label = d.history.redo(d);
  if (!label) return;
  afterHistory(d);
  toast(`Wiederholt: ${label}`, { icon: "Redo2", ms: 1200 });
}

function afterHistory(d: Doc) {
  setSelection(S.selection.filter((id) => d.objects.some((o) => o.id === id)));
  S.marquee = null;
  touch(d);
  emit("history", "frame");
  requestRender();
}

// ---------- documents and tabs ----------

let counter = 1;

export function createDoc(raster: HTMLCanvasElement, name?: string, path?: string): Doc {
  const doc: Doc = {
    id: uid("d"),
    name: name ?? `Bild ${counter++}`,
    w: raster.width,
    h: raster.height,
    raster,
    objects: [],
    frame: { ...FRAME_DEFAULT },
    history: new History(),
    view: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    path,
    version: 1,
  };
  S.docs.push(doc);
  switchTo(doc);
  fitView(doc);
  return doc;
}

export function blankDoc(w: number, h: number, bg: string | null, name?: string) {
  const c = newCanvas(w, h);
  if (bg) {
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  const d = createDoc(c, name);
  setTool("brush");
  return d;
}

export function switchTo(doc: Doc | null) {
  if (S.doc === doc) return;
  S.doc = doc;
  S.selection = [];
  S.marquee = null;
  S.crop = null;
  S.hover = null;
  emit("docs", "selection", "history", "frame", "doc", "view");
  requestRender();
}

export async function closeDoc(doc: Doc | null = S.doc) {
  if (!doc) return;
  if (doc.dirty) {
    switchTo(doc);
    const r = await choose("Ungesicherte Änderungen", `„${doc.name}“ wurde geändert und weder gesichert noch kopiert.`, [
      { id: "cancel", label: "Abbrechen" },
      { id: "discard", label: "Verwerfen", danger: true },
      { id: "save", label: "Sichern …", primary: true },
    ]);
    if (r === "cancel" || r === null) return;
    if (r === "save" && !(await saveDoc(doc, false))) return;
  }
  const i = S.docs.indexOf(doc);
  S.docs.splice(i, 1);
  for (const o of doc.objects) if (o.type === "image") sources.delete(o.src);
  if (S.doc === doc) switchTo(S.docs[Math.min(i, S.docs.length - 1)] ?? null);
  else emit("docs");
}

export function fitView(doc = S.doc) {
  if (!doc) return;
  const { w, h } = viewSize();
  const fr = frameRect(doc);
  const left = 92, right = 32, top = 76, bottom = 64;
  const z = Math.min(1, (w - left - right) / fr.w, (h - top - bottom) / fr.h);
  doc.view.zoom = Math.max(0.02, z);
  doc.view.panX = left + (w - left - right - fr.w * doc.view.zoom) / 2 - fr.x * doc.view.zoom;
  doc.view.panY = top + (h - top - bottom - fr.h * doc.view.zoom) / 2 - fr.y * doc.view.zoom;
  doc.view.fit = true;
  emit("view");
  requestRender();
}

export function zoomAt(z: number, sx?: number, sy?: number) {
  const d = S.doc;
  if (!d) return;
  const { w, h } = viewSize();
  sx ??= w / 2;
  sy ??= h / 2;
  z = Math.min(64, Math.max(0.02, z));
  const px = (sx - d.view.panX) / d.view.zoom;
  const py = (sy - d.view.panY) / d.view.zoom;
  d.view.zoom = z;
  d.view.fit = false;
  d.view.panX = sx - px * z;
  d.view.panY = sy - py * z;
  emit("view");
  requestRender();
}

const STEPS = [0.05, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

export function zoomStep(dir: 1 | -1) {
  const z = S.doc?.view.zoom ?? 1;
  const next = dir > 0 ? STEPS.find((s) => s > z + 1e-6) : [...STEPS].reverse().find((s) => s < z - 1e-6);
  zoomAt(next ?? z);
}

// ---------- paste ----------

/** What Klecks itself last put on the clipboard as objects, recognised again by the picture size. */
let objectClip: { objects: Obj[]; w: number; h: number } | null = null;

export function pasteCanvas(c: HTMLCanvasElement, asNew = false) {
  if (!S.doc || asNew) {
    const t = new Date();
    const name = `Screenshot ${t.getHours().toString().padStart(2, "0")}.${t.getMinutes().toString().padStart(2, "0")}`;
    createDoc(c, name);
    toast(`${c.width} × ${c.height} eingefügt`, { icon: "ClipboardPaste", tone: "ok" });
    return;
  }
  if (objectClip && objectClip.w === c.width && objectClip.h === c.height) {
    pasteObjects(objectClip.objects);
    return;
  }
  insertImage(c);
}

export function insertImage(c: HTMLCanvasElement, at?: { x: number; y: number }) {
  mutate("Einfügen", (tx, doc) => {
    if (c.width > doc.w || c.height > doc.h) {
      tx.fullRaster();
      resizeRaster(doc, Math.max(doc.w, c.width), Math.max(doc.h, c.height), 0, 0);
      toast("Zeichenfläche an das eingefügte Bild angepasst", { icon: "Expand" });
    }
    let x: number, y: number;
    if (at) {
      x = at.x - c.width / 2;
      y = at.y - c.height / 2;
    } else {
      const { w, h } = viewSize();
      x = ((w / 2 - doc.view.panX) / doc.view.zoom) - c.width / 2;
      y = ((h / 2 - doc.view.panY) / doc.view.zoom) - c.height / 2;
    }
    x = Math.round(Math.max(0, Math.min(doc.w - c.width, x)));
    y = Math.round(Math.max(0, Math.min(doc.h - c.height, y)));
    const o: ImageObj = { id: uid(), type: "image", x, y, w: c.width, h: c.height, src: registerSource(c) };
    doc.objects.push(o);
    S.selection = [o.id];
  });
  setTool("select");
  emit("selection");
}

function pasteObjects(objs: Obj[]) {
  mutate("Einfügen", (_tx, doc) => {
    const copies = structuredClone(objs).map((o) => {
      o.id = uid();
      translate(o, 24, 24);
      return o;
    });
    doc.objects.push(...copies);
    S.selection = copies.map((o) => o.id);
    objectClip = { ...objectClip!, objects: structuredClone(copies) };
  });
  setTool("select");
  emit("selection");
}

// ---------- copy ----------

export async function copyObjects(cut = false) {
  const d = S.doc;
  if (!d) return;
  const objs = d.objects.filter((o) => S.selection.includes(o.id));
  if (!objs.length) return;
  const r = unionRect(objs.map(bounds))!;
  const img = newCanvas(Math.max(1, Math.ceil(r.w)), Math.max(1, Math.ceil(r.h)));
  const ctx = img.getContext("2d")!;
  ctx.translate(-r.x, -r.y);
  const tmp: Doc = { ...d, objects: objs, raster: newCanvas(1, 1), w: d.w, h: d.h };
  composeInto(ctx, tmp, null);
  objectClip = { objects: structuredClone(objs), w: img.width, h: img.height };
  try {
    await copyCanvas(img);
  } catch {}
  if (cut) deleteSelection();
  toast(cut ? "Ausgeschnitten" : "Kopiert", { icon: cut ? "Scissors" : "Copy", ms: 1400 });
}

export async function copyMarquee(cut = false) {
  const d = S.doc;
  const m = S.marquee;
  if (!d || !m) return;
  if (!cut && marqueeIsWholeDoc(d)) return copyImage();
  const c = marqueePixels(d, true);
  if (!c) return;
  objectClip = null;
  await copyCanvas(c);
  if (cut) clearMarquee();
  toast(cut ? "Auswahl ausgeschnitten" : "Auswahl kopiert", { icon: cut ? "Scissors" : "Copy", ms: 1400 });
}

/** The main share action: the finished picture, frame included, onto the clipboard. */
export async function copyImage() {
  const d = S.doc;
  if (!d) return;
  try {
    const c = exportCanvas(d);
    await copyCanvas(c);
    objectClip = null;
    d.dirty = false;
    emit("docs");
    toast(`Bild kopiert, bereit zum Einfügen (${c.width} × ${c.height})`, { icon: "Check", tone: "ok" });
  } catch (e) {
    toast(`Kopieren fehlgeschlagen: ${e}`, { tone: "err" });
  }
}

// ---------- save ----------

export async function saveDoc(doc = S.doc, reuse = true): Promise<boolean> {
  if (!doc) return false;
  let path = reuse ? doc.path : undefined;
  if (!path) {
    path = (await askSavePath(`${stripExt(doc.name)}.png`)) ?? undefined;
    if (!path) return false;
  }
  try {
    const fmt = formatOf(path);
    const c = exportCanvas(doc, { flattenAlpha: fmt === "jpg" || fmt === "bmp" ? "#ffffff" : undefined });
    await writeFile(path, await encode(c, fmt));
    doc.path = path;
    doc.name = basename(path);
    doc.dirty = false;
    emit("docs");
    toast(`Gesichert: ${basename(path)}`, { icon: "Check", tone: "ok" });
    return true;
  } catch (e) {
    toast(`Sichern fehlgeschlagen: ${e}`, { tone: "err" });
    return false;
  }
}

// ---------- selection of objects ----------

export function deleteSelection() {
  if (!S.selection.length) return;
  mutate("Löschen", (_tx, doc) => {
    doc.objects = doc.objects.filter((o) => !S.selection.includes(o.id));
  });
  setSelection([]);
}

export function duplicateSelection() {
  const d = S.doc;
  if (!d || !S.selection.length) return;
  mutate("Duplizieren", (_tx, doc) => {
    const copies = doc.objects.filter((o) => S.selection.includes(o.id)).map((o) => {
      const c = structuredClone(o);
      c.id = uid();
      translate(c, 20, 20);
      return c;
    });
    doc.objects.push(...copies);
    S.selection = copies.map((o) => o.id);
  });
  emit("selection");
}

export function reorder(where: "front" | "back" | "up" | "down") {
  if (!S.selection.length) return;
  mutate("Reihenfolge", (_tx, doc) => {
    const sel = doc.objects.filter((o) => S.selection.includes(o.id));
    const rest = doc.objects.filter((o) => !S.selection.includes(o.id));
    if (where === "front") doc.objects = [...rest, ...sel];
    else if (where === "back") doc.objects = [...sel, ...rest];
    else {
      const arr = doc.objects;
      const idx = sel.map((o) => arr.indexOf(o));
      if (where === "up") {
        for (let k = idx.length - 1; k >= 0; k--) {
          const i = idx[k];
          if (i < arr.length - 1 && !S.selection.includes(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
        }
      } else {
        for (const i of idx) if (i > 0 && !S.selection.includes(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
      }
    }
  });
}

export function selectAll() {
  const d = S.doc;
  if (!d) return;
  // Like Paint: the whole picture, annotations included.
  setTool("marquee");
  S.marquee = { kind: "rect", r: { x: 0, y: 0, w: d.w, h: d.h } };
  S.selection = d.objects.map((o) => o.id);
  emit("marquee", "selection");
  requestRender();
}

export function nudge(dx: number, dy: number) {
  if (!S.selection.length) return;
  mutate("Verschieben", (_tx, doc) => {
    for (const o of doc.objects) if (S.selection.includes(o.id)) translate(o, dx, dy);
  });
}

// ---------- raster selection (marquee) ----------

export function marqueePath(): Path2D | undefined {
  return S.marquee?.kind === "lasso" ? lassoPath(S.marquee.pts) : undefined;
}

function marqueeRect(d: Doc): Rect | null {
  const m = S.marquee;
  if (!m) return null;
  const x = Math.max(0, Math.floor(m.r.x));
  const y = Math.max(0, Math.floor(m.r.y));
  const x2 = Math.min(d.w, Math.ceil(m.r.x + m.r.w));
  const y2 = Math.min(d.h, Math.ceil(m.r.y + m.r.h));
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

function marqueeIsWholeDoc(d: Doc) {
  const r = marqueeRect(d);
  return S.marquee?.kind === "rect" && !!r && r.x === 0 && r.y === 0 && r.w === d.w && r.h === d.h;
}

/** visible: what the user sees, annotations included; otherwise only the painted pixels. */
function marqueePixels(d: Doc, visible = false): HTMLCanvasElement | null {
  const r = marqueeRect(d);
  if (!r) return null;
  const c = newCanvas(r.w, r.h);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(visible ? exportCanvas(d, { frame: false }) : d.raster, -r.x, -r.y);
  if (S.marquee?.kind === "lasso") {
    ctx.globalCompositeOperation = "destination-in";
    ctx.fill(lassoPath(S.marquee.pts, r.x, r.y));
  }
  return c;
}

function clearRegion(tx: Tx, d: Doc) {
  const r = marqueeRect(d);
  if (!r) return;
  tx.dirty(r);
  const ctx = d.raster.getContext("2d")!;
  const path = marqueePath();
  if (path) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill(path);
    ctx.restore();
  } else ctx.clearRect(r.x, r.y, r.w, r.h);
}

export function clearMarquee() {
  if (!S.marquee) return;
  mutate("Auswahl löschen", (tx, doc) => {
    clearRegion(tx, doc);
    // Annotations chosen together with the area (Select All) go as well.
    doc.objects = doc.objects.filter((o) => !S.selection.includes(o.id));
  });
  setSelection([]);
}

/** Cuts the selected pixels out into a movable image object. */
export function liftMarquee(): ImageObj | null {
  const d = S.doc;
  if (!d || !S.marquee) return null;
  const c = marqueePixels(d);
  const r = marqueeRect(d);
  if (!c || !r) return null;
  let o: ImageObj | null = null;
  mutate("Auswahl verschieben", (tx, doc) => {
    clearRegion(tx, doc);
    o = { id: uid(), type: "image", x: r.x, y: r.y, w: r.w, h: r.h, src: registerSource(c) };
    doc.objects.push(o);
  });
  S.marquee = null;
  emit("marquee");
  return o;
}

export function adjustMarquee(kind: "invert" | "grayscale") {
  const d = S.doc;
  if (!d) return;
  const r = marqueeRect(d) ?? { x: 0, y: 0, w: d.w, h: d.h };
  mutate(kind === "invert" ? "Farben umkehren" : "Graustufen", (tx, doc) => {
    tx.dirty(r);
    adjustPixels(doc.raster, r, kind, marqueePath());
  });
}

// ---------- whole-image operations ----------

function resizeRaster(doc: Doc, w: number, h: number, ox: number, oy: number) {
  const c = newCanvas(w, h);
  c.getContext("2d")!.drawImage(doc.raster, ox, oy);
  doc.raster = c;
  doc.w = w;
  doc.h = h;
}

export function cropTo(r: Rect) {
  const x = Math.round(r.x), y = Math.round(r.y);
  const w = Math.round(r.w), h = Math.round(r.h);
  if (w < 1 || h < 1) return;
  mutate("Zuschneiden", (tx, doc) => {
    tx.fullRaster();
    resizeRaster(doc, w, h, -x, -y);
    for (const o of doc.objects) translate(o, -x, -y);
  });
  S.marquee = null;
  S.crop = null;
  emit("marquee");
  fitView();
}

export function cropToMarquee() {
  const d = S.doc;
  if (!d || !S.marquee) return;
  const r = marqueeRect(d);
  if (r) cropTo(r);
}

export function canvasSize(w: number, h: number, ax: number, ay: number, fill: string | null) {
  mutate("Zeichenfläche", (tx, doc) => {
    tx.fullRaster();
    const ox = Math.round((w - doc.w) * ax);
    const oy = Math.round((h - doc.h) * ay);
    const c = newCanvas(w, h);
    const ctx = c.getContext("2d")!;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(doc.raster, ox, oy);
    doc.raster = c;
    doc.w = w;
    doc.h = h;
    for (const o of doc.objects) translate(o, ox, oy);
  });
  fitView();
}

export function resizeImage(w: number, h: number) {
  mutate("Bildgröße", (tx, doc) => {
    tx.fullRaster();
    const fx = w / doc.w, fy = h / doc.h;
    const c = newCanvas(w, h);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(doc.raster, 0, 0, w, h);
    doc.raster = c;
    doc.w = w;
    doc.h = h;
    for (const o of doc.objects) scaleObject(o, fx, fy);
  });
  fitView();
}

/** Annotations are merged first: they cannot rotate on their own. */
export function transformImage(op: "cw" | "ccw" | "180" | "flipH" | "flipV") {
  const d = S.doc;
  if (!d) return;
  const merged = d.objects.length > 0;
  mutate(op.startsWith("flip") ? "Spiegeln" : "Drehen", (tx, doc) => {
    tx.fullRaster();
    flattenInto(doc);
    doc.raster = transformCanvas(doc.raster, op);
    doc.w = doc.raster.width;
    doc.h = doc.raster.height;
  });
  setSelection([]);
  if (merged) toast("Markierungen wurden dafür ins Bild übernommen", { icon: "Layers" });
  fitView();
}

function flattenInto(doc: Doc) {
  if (!doc.objects.length) return;
  const c = newCanvas(doc.w, doc.h);
  composeInto(c.getContext("2d")!, doc, null);
  doc.raster = c;
  doc.objects = [];
}

export function flatten() {
  const d = S.doc;
  if (!d || !d.objects.length) return;
  mutate("Zusammenfügen", (tx, doc) => {
    tx.fullRaster();
    flattenInto(doc);
  });
  setSelection([]);
  toast("Alle Markierungen ins Bild übernommen", { icon: "Layers", tone: "ok" });
}

export function transformSelectedImage(op: "flipH" | "flipV" | "cw" | "ccw") {
  const imgs = S.doc?.objects.filter((o): o is ImageObj => o.type === "image" && S.selection.includes(o.id)) ?? [];
  if (!imgs.length) return;
  mutate("Objekt drehen", () => {
    for (const o of imgs) {
      if (op === "flipH") o.flipX = !o.flipX;
      else if (op === "flipV") o.flipY = !o.flipY;
      else {
        const src = sources.get(o.src)!;
        o.src = registerSource(transformCanvas(src, op));
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        [o.w, o.h] = [o.h, o.w];
        o.x = cx - o.w / 2;
        o.y = cy - o.h / 2;
      }
    }
  });
}

/** Merges the selected image objects back into the picture. */
export function mergeSelection() {
  const d = S.doc;
  if (!d || !S.selection.length) return;
  mutate("Einbrennen", (tx, doc) => {
    const sel = doc.objects.filter((o) => S.selection.includes(o.id));
    tx.dirty({ x: 0, y: 0, w: doc.w, h: doc.h });
    const tmp: Doc = { ...doc, objects: sel, raster: doc.raster };
    const c = newCanvas(doc.w, doc.h);
    composeInto(c.getContext("2d")!, tmp, null);
    doc.raster.getContext("2d")!.clearRect(0, 0, doc.w, doc.h);
    doc.raster.getContext("2d")!.drawImage(c, 0, 0);
    doc.objects = doc.objects.filter((o) => !S.selection.includes(o.id));
  });
  setSelection([]);
}

// ---------- tools hook ----------

let toolSetter: (t: any, keep?: boolean) => void = () => {};
export function registerToolSetter(fn: typeof toolSetter) {
  toolSetter = fn;
}
export function setTool(t: string, keepMarquee = false) {
  toolSetter(t, keepMarquee);
}

export function nextStepNumber(): number {
  const steps = S.doc?.objects.filter((o) => o.type === "step") ?? [];
  return steps.length ? Math.max(...steps.map((o) => (o as { n: number }).n)) + 1 : 1;
}
