import type { BlurObj, LineObj, Obj, ShapeObj, SpotObj, StepObj, StrokeObj, TextObj, ToolId } from "./types";
import { S, emit, findObj, newCanvas, saveSettings, setSelection, settings, touch, uid } from "./state";
import { bounds, fontString, hitTest, insideShape, isBox, isFillable, normRect, textLayout, translate, contrastOn } from "./objects";
import { boxHandles, composite, handlesFor, live, overlay, requestRender, toDoc, toScreen, type HandleId } from "./render";
import { begin, commit, cropTo, liftMarquee, mutate, nextStepNumber, registerToolSetter, zoomAt } from "./docs";
import { floodFill, pixelLine } from "./raster";
import type { Tx } from "./history";

type Pt = { x: number; y: number };
interface Drag {
  move(p: Pt, e: PointerEvent): void;
  up(p: Pt, e: PointerEvent): void;
}

let canvas: HTMLCanvasElement;
let drag: Drag | null = null;
let prevTool: ToolId = "select";
let editor: HTMLTextAreaElement;
let textTx: Tx | null = null;

const CREATE_TOOLS: ToolId[] = ["arrow", "line", "rect", "ellipse", "shape", "text", "step", "highlighter", "blur", "spotlight"];
export const RASTER_TOOLS: ToolId[] = ["brush", "pencil", "eraser", "fill", "picker"];

export function setTool(t: ToolId, keepMarquee = false) {
  if (S.editingText) finishText();
  if (t === "picker" && S.tool !== "picker") prevTool = S.tool;
  S.tool = t;
  if (!keepMarquee) S.marquee = null;
  S.crop = t === "crop" && S.doc ? { x: 0, y: 0, w: S.doc.w, h: S.doc.h } : null;
  if (t !== "select") S.selection = [];
  S.hover = null;
  emit("tool", "selection", "marquee");
  updateCursor();
  requestRender();
}
registerToolSetter(setTool);

function docPt(e: { clientX: number; clientY: number }): Pt {
  const r = canvas.getBoundingClientRect();
  const [x, y] = toDoc(S.doc!, e.clientX - r.left, e.clientY - r.top);
  return { x, y };
}

function screenPt(e: { clientX: number; clientY: number }): Pt {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

const tol = () => 6 / (S.doc?.view.zoom ?? 1);

function topHit(p: Pt, filter?: (o: Obj) => boolean): Obj | null {
  const objs = S.doc!.objects;
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (filter && !filter(o)) continue;
    if (hitTest(o, p.x, p.y, tol())) return o;
  }
  return null;
}

function hitHandle(sp: Pt): { o: Obj; id: HandleId } | null {
  if (S.selection.length !== 1) return null;
  const o = findObj(S.selection[0]);
  if (!o) return null;
  for (const h of handlesFor(o)) {
    const [x, y] = toScreen(S.doc!, h.x, h.y);
    if (Math.hypot(sp.x - x, sp.y - y) <= 9) return { o, id: h.id };
  }
  return null;
}

function snapAngle(x0: number, y0: number, x: number, y: number): Pt {
  const a = Math.atan2(y - y0, x - x0);
  const step = Math.PI / 12;
  const s = Math.round(a / step) * step;
  const l = Math.hypot(x - x0, y - y0);
  return { x: x0 + Math.cos(s) * l, y: y0 + Math.sin(s) * l };
}

// ---------- generic drags ----------

function startPan(e: PointerEvent): Drag {
  const start = screenPt(e);
  const v = S.doc!.view;
  const px = v.panX, py = v.panY;
  canvas.style.cursor = "grabbing";
  return {
    move(_p, ev) {
      const s = screenPt(ev);
      v.fit = false;
      v.panX = px + s.x - start.x;
      v.panY = py + s.y - start.y;
      emit("view");
      requestRender();
    },
    up() {
      updateCursor();
    },
  };
}

function startMove(start: Pt, e: PointerEvent, label = "Verschieben"): Drag {
  begin();
  const doc = S.doc!;
  let ids = [...S.selection];
  let originals = new Map(doc.objects.filter((o) => ids.includes(o.id)).map((o) => [o.id, structuredClone(o)]));
  let duplicated = false;
  const b0 = unionBounds(ids);
  return {
    move(p, ev) {
      if (ev.altKey && !duplicated && (e.altKey || ev.altKey)) {
        duplicated = true;
        const copies = [...originals.values()].map((o) => ({ ...structuredClone(o), id: uid() }));
        doc.objects.push(...copies);
        ids = copies.map((c) => c.id);
        originals = new Map(copies.map((c) => [c.id, structuredClone(c)]));
        setSelection(ids);
      }
      let dx = p.x - start.x;
      let dy = p.y - start.y;
      if (ev.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      overlay.snapGuide = null;
      if (b0 && !ev.metaKey && !ev.ctrlKey) {
        const t = tol() * 1.2;
        const guide: { x?: number; y?: number } = {};
        const cx = b0.x + b0.w / 2 + dx;
        const cy = b0.y + b0.h / 2 + dy;
        for (const [pos, target] of [[cx, doc.w / 2], [b0.x + dx, 0], [b0.x + b0.w + dx, doc.w]] as const) {
          if (Math.abs(pos - target) < t) { dx += target - pos; guide.x = target; break; }
        }
        for (const [pos, target] of [[cy, doc.h / 2], [b0.y + dy, 0], [b0.y + b0.h + dy, doc.h]] as const) {
          if (Math.abs(pos - target) < t) { dy += target - pos; guide.y = target; break; }
        }
        if (guide.x !== undefined || guide.y !== undefined) overlay.snapGuide = guide;
      }
      doc.objects = doc.objects.map((o) => {
        const orig = originals.get(o.id);
        if (!orig) return o;
        const c = structuredClone(orig);
        translate(c, dx, dy);
        return c;
      });
      touch(doc);
      requestRender();
    },
    up() {
      overlay.snapGuide = null;
      commit(duplicated ? "Duplizieren" : label);
      requestRender();
    },
  };
}

function unionBounds(ids: string[]) {
  const objs = S.doc!.objects.filter((o) => ids.includes(o.id));
  if (!objs.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const o of objs) {
    const b = bounds(o);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function resizeBox(r0: { x: number; y: number; w: number; h: number }, id: string, p: Pt, aspect: boolean, fromCenter: boolean) {
  let x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
  if (id.includes("w")) x1 = p.x;
  if (id.includes("e")) x2 = p.x;
  if (id.includes("n")) y1 = p.y;
  if (id.includes("s")) y2 = p.y;
  if (fromCenter) {
    const cx = r0.x + r0.w / 2, cy = r0.y + r0.h / 2;
    if (id.includes("w")) x2 = 2 * cx - x1;
    if (id.includes("e")) x1 = 2 * cx - x2;
    if (id.includes("n")) y2 = 2 * cy - y1;
    if (id.includes("s")) y1 = 2 * cy - y2;
  }
  if (aspect && id.length === 2 && r0.w && r0.h) {
    const ar = r0.w / r0.h;
    let w = x2 - x1, h = y2 - y1;
    if (Math.abs(w) / ar > Math.abs(h)) h = Math.sign(h || 1) * (Math.abs(w) / ar);
    else w = Math.sign(w || 1) * Math.abs(h) * ar;
    if (id.includes("w")) x1 = x2 - w; else x2 = x1 + w;
    if (id.includes("n")) y1 = y2 - h; else y2 = y1 + h;
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function startHandle(o: Obj, id: HandleId): Drag {
  begin();
  const doc = S.doc!;
  const orig = structuredClone(o);
  const b0 = bounds(orig);
  return {
    move(p, ev) {
      const cur = doc.objects.find((x) => x.id === o.id);
      if (!cur) return;
      if (cur.type === "line" && orig.type === "line") {
        if (id === "p1") {
          const q = ev.shiftKey ? snapAngle(cur.x2, cur.y2, p.x, p.y) : p;
          cur.x1 = q.x; cur.y1 = q.y;
        } else if (id === "p2") {
          const q = ev.shiftKey ? snapAngle(cur.x1, cur.y1, p.x, p.y) : p;
          cur.x2 = q.x; cur.y2 = q.y;
        } else {
          const mx = (cur.x1 + cur.x2) / 2, my = (cur.y1 + cur.y2) / 2;
          if (Math.hypot(p.x - mx, p.y - my) < tol()) {
            delete cur.cx;
            delete cur.cy;
          } else {
            cur.cx = 2 * p.x - mx;
            cur.cy = 2 * p.y - my;
          }
        }
      } else if (isBox(cur) && isBox(orig)) {
        const keep = cur.type === "image" ? !ev.shiftKey : ev.shiftKey;
        Object.assign(cur, resizeBox(normRect(orig.x, orig.y, orig.w, orig.h), id, p, keep, ev.altKey));
      } else if (cur.type === "text" && orig.type === "text") {
        const f = Math.max(0.1, (p.x - b0.x) / b0.w);
        cur.size = Math.round(Math.min(600, Math.max(8, orig.size * f)));
      } else if (cur.type === "step" && orig.type === "step") {
        const d0 = Math.hypot(b0.w / 2, b0.h / 2);
        const d = Math.hypot(p.x - orig.x, p.y - orig.y);
        cur.size = Math.round(Math.min(400, Math.max(14, (orig.size * d) / d0)));
      }
      touch(doc);
      requestRender();
      emit("selection");
    },
    up() {
      const cur = doc.objects.find((x) => x.id === o.id);
      if (cur && isBox(cur)) Object.assign(cur, normRect(cur.x, cur.y, cur.w, cur.h));
      touch(doc);
      commit("Größe ändern");
    },
  };
}

function startBand(start: Pt, additive: boolean): Drag {
  const base = additive ? [...S.selection] : [];
  return {
    move(p) {
      overlay.band = { x: start.x, y: start.y, w: p.x - start.x, h: p.y - start.y };
      const r = normRect(start.x, start.y, p.x - start.x, p.y - start.y);
      const hit = S.doc!.objects.filter((o) => {
        const b = bounds(o);
        return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
      });
      setSelection([...new Set([...base, ...hit.map((o) => o.id)])]);
      requestRender();
    },
    up() {
      overlay.band = null;
      requestRender();
    },
  };
}

// ---------- creation ----------

function color(e: PointerEvent) {
  return e.button === 2 ? settings.secondary : settings.color;
}

function startCreate(o: Obj, start: Pt, update: (o: Obj, p: Pt, e: PointerEvent) => void, minSize = 3): Drag {
  begin();
  const doc = S.doc!;
  doc.objects.push(o);
  setSelection([o.id]);
  touch(doc);
  requestRender();
  let moved = false;
  return {
    move(p, e) {
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) * doc.view.zoom < 3) return;
      moved = true;
      update(o, p, e);
      touch(doc);
      requestRender();
      emit("selection");
    },
    up() {
      const b = bounds(o);
      if (!moved || (o.type !== "step" && Math.max(b.w, b.h) * doc.view.zoom < minSize)) {
        if (o.type !== "step") {
          doc.objects = doc.objects.filter((x) => x !== o);
          setSelection([]);
        }
      }
      if (isBox(o)) Object.assign(o, normRect(o.x, o.y, o.w, o.h));
      touch(doc);
      commit(LABELS[o.type] ?? "Zeichnen");
      requestRender();
    },
  };
}

const LABELS: Record<string, string> = {
  line: "Linie",
  rect: "Rechteck",
  ellipse: "Ellipse",
  shape: "Form",
  text: "Text",
  step: "Schritt",
  stroke: "Textmarker",
  blur: "Unkenntlich machen",
  spotlight: "Spotlight",
};

function boxUpdate(start: Pt) {
  return (o: Obj, p: Pt, e: PointerEvent) => {
    if (!isBox(o)) return;
    let w = p.x - start.x;
    let h = p.y - start.y;
    if (e.shiftKey) {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * m;
      h = Math.sign(h || 1) * m;
    }
    if (e.altKey) {
      o.x = start.x - w; o.y = start.y - h; o.w = w * 2; o.h = h * 2;
    } else {
      o.x = start.x; o.y = start.y; o.w = w; o.h = h;
    }
  };
}

function createFor(tool: ToolId, p: Pt, e: PointerEvent): Drag | null {
  const doc = S.doc!;
  const c = color(e);
  switch (tool) {
    case "arrow":
    case "line": {
      const s = tool === "arrow" ? settings.arrow : settings.line;
      const o: LineObj = {
        id: uid(), type: "line", x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: c, width: s.width, dash: s.dash,
        arrow: tool === "arrow" ? settings.arrow.arrow : "none", shadow: s.shadow,
      };
      return startCreate(o, p, (obj, q, ev) => {
        const l = obj as LineObj;
        const t = ev.shiftKey ? snapAngle(l.x1, l.y1, q.x, q.y) : q;
        l.x2 = t.x;
        l.y2 = t.y;
      });
    }
    case "rect":
    case "ellipse":
    case "shape": {
      const s = settings[tool];
      const o: ShapeObj = {
        id: uid(), type: tool, x: p.x, y: p.y, w: 0, h: 0, color: c, width: s.width, dash: s.dash, fill: s.fill,
        fillColor: e.button === 2 ? settings.color : settings.secondary, radius: tool === "rect" ? settings.rect.radius : 0,
        kind: settings.shape.kind, shadow: s.shadow,
      };
      return startCreate(o, p, boxUpdate(p));
    }
    case "blur": {
      const o: BlurObj = { id: uid(), type: "blur", x: p.x, y: p.y, w: 0, h: 0, mode: settings.blur.mode, strength: settings.blur.strength };
      return startCreate(o, p, boxUpdate(p));
    }
    case "spotlight": {
      const o: SpotObj = { id: uid(), type: "spotlight", x: p.x, y: p.y, w: 0, h: 0, ellipse: settings.spotlight.ellipse, dim: settings.spotlight.dim };
      return startCreate(o, p, boxUpdate(p));
    }
    case "step": {
      const o: StepObj = { id: uid(), type: "step", x: p.x, y: p.y, n: nextStepNumber(), size: settings.step.size, color: c };
      return startCreate(o, p, (obj, q) => {
        (obj as StepObj).x = q.x;
        (obj as StepObj).y = q.y;
      });
    }
    case "highlighter": {
      const o: StrokeObj = { id: uid(), type: "stroke", pts: [p.x, p.y], color: settings.highlighter.color, width: settings.highlighter.width };
      const start = p;
      return startCreate(o, p, (obj, q, ev) => {
        const s = obj as StrokeObj;
        if (ev.shiftKey) {
          const t = snapAngle(start.x, start.y, q.x, q.y);
          s.pts = [start.x, start.y, t.x, t.y];
          return;
        }
        const n = s.pts.length;
        if (Math.hypot(q.x - s.pts[n - 2], q.y - s.pts[n - 1]) * doc.view.zoom > 1.5) s.pts.push(q.x, q.y);
      }, 0);
    }
    case "text": {
      const s = settings.text;
      const o: TextObj = { id: uid(), type: "text", x: p.x, y: p.y - s.size * 0.7, text: "", size: s.size, font: s.font, color: c, bg: s.bg, shadow: s.shadow };
      textTx = begin();
      doc.objects.push(o);
      setSelection([o.id]);
      openEditor(o);
      return null;
    }
  }
  return null;
}

// ---------- raster painting ----------

let liveCanvas: HTMLCanvasElement | null = null;

function liveLayer(w: number, h: number) {
  if (!liveCanvas || liveCanvas.width !== w || liveCanvas.height !== h) liveCanvas = newCanvas(w, h);
  liveCanvas.getContext("2d")!.clearRect(0, 0, w, h);
  return liveCanvas;
}

function pressure(e: PointerEvent) {
  return e.pointerType === "pen" ? 0.2 + e.pressure * 1.3 : 1;
}

function points(e: PointerEvent): PointerEvent[] {
  const list = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined;
  return list && list.length ? list : [e];
}

function startPaint(tool: ToolId, p: Pt, e: PointerEvent): Drag {
  const doc = S.doc!;
  const tx = begin()!;
  tx.touchRaster();
  const rctx = doc.raster.getContext("2d")!;
  const col = color(e);
  const variant = settings.brush.variant;
  const size = tool === "brush" ? settings.brush.size : tool === "pencil" ? settings.pencil.size : settings.eraser.size;
  let minX = p.x, minY = p.y, maxX = p.x, maxY = p.y;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  let target: CanvasRenderingContext2D = rctx;
  if (tool === "brush") {
    live.canvas = liveLayer(doc.w, doc.h);
    live.alpha = settings.brush.opacity;
    target = live.canvas.getContext("2d")!;
  }
  let last = p;
  let lastMid = p;
  let spray = 0;

  const dab = (x: number, y: number, s: number) => {
    const g = target.createRadialGradient(x, y, 0, x, y, s / 2);
    g.addColorStop(0, rgbaHex(col, 0.32));
    g.addColorStop(1, rgbaHex(col, 0));
    target.fillStyle = g;
    target.fillRect(x - s / 2, y - s / 2, s, s);
  };
  const sprayAt = (x: number, y: number) => {
    target.fillStyle = col;
    const r = size * 1.2;
    const n = Math.max(6, Math.round(size * 0.9));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const dot = Math.max(1, size / 18);
      target.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, dot, dot);
    }
  };

  const segment = (q: Pt, pr: number) => {
    grow(q.x, q.y);
    if (tool === "pencil") {
      rctx.fillStyle = col;
      pixelLine(rctx, last.x, last.y, q.x, q.y, Math.max(1, Math.round(size)));
    } else if (tool === "eraser") {
      rctx.save();
      rctx.globalCompositeOperation = "destination-out";
      rctx.lineCap = "round";
      rctx.lineWidth = size * pr;
      rctx.beginPath();
      rctx.moveTo(last.x, last.y);
      rctx.lineTo(q.x, q.y);
      rctx.stroke();
      rctx.restore();
    } else if (variant === "round") {
      const mid = { x: (last.x + q.x) / 2, y: (last.y + q.y) / 2 };
      target.strokeStyle = col;
      target.lineCap = "round";
      target.lineJoin = "round";
      target.lineWidth = size * pr;
      target.beginPath();
      target.moveTo(lastMid.x, lastMid.y);
      target.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      target.stroke();
      lastMid = mid;
    } else if (variant === "calligraphy") {
      const nx = Math.cos(-Math.PI / 4) * (size * pr) / 2;
      const ny = Math.sin(-Math.PI / 4) * (size * pr) / 2;
      target.fillStyle = col;
      target.beginPath();
      target.moveTo(last.x + nx, last.y + ny);
      target.lineTo(q.x + nx, q.y + ny);
      target.lineTo(q.x - nx, q.y - ny);
      target.lineTo(last.x - nx, last.y - ny);
      target.closePath();
      target.fill();
    } else if (variant === "soft") {
      const s = size * pr * 1.6;
      const dist = Math.hypot(q.x - last.x, q.y - last.y);
      const step = Math.max(1, s / 8);
      for (let d = step; d <= dist; d += step) dab(last.x + ((q.x - last.x) * d) / dist, last.y + ((q.y - last.y) * d) / dist, s);
    } else if (variant === "spray") {
      sprayAt(q.x, q.y);
    }
    last = q;
    touch(doc);
  };

  // first dab
  if (tool === "pencil") {
    rctx.fillStyle = col;
    pixelLine(rctx, p.x, p.y, p.x, p.y, Math.max(1, Math.round(size)));
  } else if (tool === "brush" && variant === "round") {
    target.fillStyle = col;
    target.beginPath();
    target.arc(p.x, p.y, (size * pressure(e)) / 2, 0, Math.PI * 2);
    target.fill();
  } else if (tool === "brush" && variant === "soft") dab(p.x, p.y, size * 1.6);
  else if (tool === "brush" && variant === "spray") {
    sprayAt(p.x, p.y);
    spray = window.setInterval(() => {
      sprayAt(last.x, last.y);
      touch(doc);
      requestRender();
    }, 40);
  } else if (tool === "eraser") segment({ x: p.x + 0.01, y: p.y }, pressure(e));
  touch(doc);
  requestRender();

  let straightFrom: Pt | null = null;
  return {
    move(q, ev) {
      if (ev.shiftKey) {
        // Shift draws a straight line from where the stroke was when Shift went down.
        straightFrom ??= last;
        return;
      }
      straightFrom = null;
      for (const ce of points(ev)) segment(docPt(ce), pressure(ce));
      void q;
      requestRender();
    },
    up(q, ev) {
      if (straightFrom && ev.shiftKey) {
        last = straightFrom;
        lastMid = straightFrom;
        const t = snapAngle(straightFrom.x, straightFrom.y, q.x, q.y);
        const steps = Math.max(1, Math.ceil(Math.hypot(t.x - last.x, t.y - last.y) / 2));
        const from = { ...last };
        for (let i = 1; i <= steps; i++) segment({ x: from.x + ((t.x - from.x) * i) / steps, y: from.y + ((t.y - from.y) * i) / steps }, 1);
      }
      clearInterval(spray);
      if (tool === "brush" && variant === "round") {
        target.beginPath();
        target.moveTo(lastMid.x, lastMid.y);
        target.lineTo(last.x, last.y);
        target.stroke();
      }
      if (live.canvas) {
        rctx.save();
        rctx.globalAlpha = live.alpha;
        rctx.drawImage(live.canvas, 0, 0);
        rctx.restore();
        live.canvas = null;
      }
      const pad = size * 2 + 4;
      tx.dirty({ x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 });
      touch(doc);
      commit(tool === "eraser" ? "Radieren" : tool === "pencil" ? "Stift" : "Pinsel");
      requestRender();
    },
  };
}

function rgbaHex(hex: string, a: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function doFill(p: Pt, e: PointerEvent) {
  const objs = S.doc!.objects;
  let hit: Obj | null = null;
  for (let i = objs.length - 1; i >= 0 && !hit; i--) if (insideShape(objs[i], p.x, p.y)) hit = objs[i];
  if (hit && isFillable(hit)) {
    mutate("Füllen", () => {
      hit.fill = "solid";
      hit.fillColor = color(e);
    });
    return;
  }
  const doc = S.doc!;
  mutate("Füllen", (tx) => {
    tx.touchRaster();
    const r = floodFill(doc.raster, p.x, p.y, color(e), 1, settings.fill.tolerance);
    if (r) tx.dirty(r);
  });
}

function pickColor(p: Pt, e: PointerEvent) {
  const doc = S.doc!;
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
  const d = composite(doc).getContext("2d")!.getImageData(x, y, 1, 1).data;
  const hex = "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  if (e.button === 2) settings.secondary = hex;
  else settings.color = hex;
  saveSettings();
  emit("settings");
  setTool(prevTool === "picker" ? "brush" : prevTool);
}

// ---------- marquee and crop ----------

function inMarquee(p: Pt) {
  const m = S.marquee;
  if (!m) return false;
  if (m.kind === "rect") return p.x >= m.r.x && p.y >= m.r.y && p.x <= m.r.x + m.r.w && p.y <= m.r.y + m.r.h;
  const ctx = newCanvas(1, 1).getContext("2d")!;
  const path = new Path2D();
  for (let i = 0; i < m.pts.length; i += 2) i ? path.lineTo(m.pts[i], m.pts[i + 1]) : path.moveTo(m.pts[i], m.pts[i + 1]);
  path.closePath();
  return ctx.isPointInPath(path, p.x, p.y);
}

function startMarquee(p: Pt, e: PointerEvent): Drag | null {
  if (S.marquee && inMarquee(p)) {
    const o = liftMarquee();
    if (!o) return null;
    S.tool = "select";
    emit("tool");
    updateCursor();
    setSelection([o.id]);
    return startMove(p, e, "Auswahl verschieben");
  }
  const lasso = settings.marquee.lasso;
  S.marquee = null;
  emit("marquee");
  const doc = S.doc!;
  const pts = [p.x, p.y];
  return {
    move(q, ev) {
      const cx = Math.max(0, Math.min(doc.w, q.x));
      const cy = Math.max(0, Math.min(doc.h, q.y));
      if (lasso) {
        pts.push(cx, cy);
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          x1 = Math.min(x1, pts[i]); y1 = Math.min(y1, pts[i + 1]); x2 = Math.max(x2, pts[i]); y2 = Math.max(y2, pts[i + 1]);
        }
        S.marquee = { kind: "lasso", pts: [...pts], r: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } };
      } else {
        let w = cx - p.x, h = cy - p.y;
        if (ev.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m;
          h = Math.sign(h || 1) * m;
        }
        const r = normRect(p.x, p.y, w, h);
        S.marquee = { kind: "rect", r: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } };
      }
      emit("marquee");
      requestRender();
    },
    up() {
      const m = S.marquee;
      if (m && (m.r.w < 2 || m.r.h < 2)) S.marquee = null;
      emit("marquee");
      requestRender();
    },
  };
}

function startCrop(p: Pt, sp: Pt): Drag {
  const doc = S.doc!;
  const r0 = { ...S.crop! };
  const clamp = (r: { x: number; y: number; w: number; h: number }) => {
    const n = normRect(r.x, r.y, r.w, r.h);
    const x = Math.max(0, Math.round(n.x)), y = Math.max(0, Math.round(n.y));
    return { x, y, w: Math.min(doc.w - x, Math.round(n.w)), h: Math.min(doc.h - y, Math.round(n.h)) };
  };
  for (const h of boxHandles(r0)) {
    const [x, y] = toScreen(doc, h.x, h.y);
    if (Math.hypot(sp.x - x, sp.y - y) <= 12) {
      return {
        move(q, ev) {
          S.crop = clamp(resizeBox(r0, h.id, q, ev.shiftKey, ev.altKey));
          emit("crop");
          requestRender();
        },
        up() {},
      };
    }
  }
  const inside = p.x >= r0.x && p.y >= r0.y && p.x <= r0.x + r0.w && p.y <= r0.y + r0.h;
  return {
    move(q, ev) {
      if (inside) {
        const x = Math.max(0, Math.min(doc.w - r0.w, r0.x + q.x - p.x));
        const y = Math.max(0, Math.min(doc.h - r0.h, r0.y + q.y - p.y));
        S.crop = { ...r0, x: Math.round(x), y: Math.round(y) };
      } else {
        let w = q.x - p.x, h = q.y - p.y;
        if (ev.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m;
          h = Math.sign(h || 1) * m;
        }
        S.crop = clamp({ x: p.x, y: p.y, w, h });
      }
      emit("crop");
      requestRender();
    },
    up() {
      if (S.crop && (S.crop.w < 2 || S.crop.h < 2)) S.crop = r0;
      emit("crop");
      requestRender();
    },
  };
}

export function applyCrop() {
  if (!S.crop || !S.doc) return;
  const c = S.crop;
  if (c.x === 0 && c.y === 0 && c.w === S.doc.w && c.h === S.doc.h) {
    setTool("select");
    return;
  }
  cropTo(c);
  setTool("select");
}

// ---------- text editing ----------

export function editText(o: TextObj) {
  textTx = begin();
  setSelection([o.id]);
  openEditor(o);
}

function openEditor(o: TextObj) {
  S.editingText = o.id;
  touch();
  editor.value = o.text;
  editor.style.display = "block";
  layoutEditor();
  requestAnimationFrame(() => {
    editor.focus();
    editor.select();
  });
  emit("selection");
}

export function layoutEditor() {
  const o = findObj(S.editingText) as TextObj | undefined;
  const doc = S.doc;
  if (!o || !doc) return;
  const z = doc.view.zoom;
  const L = textLayout({ ...o, text: editor.value || " " });
  const [x, y] = toScreen(doc, o.x, o.y);
  Object.assign(editor.style, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${L.w * z + 24}px`,
    height: `${L.h * z + 4}px`,
    font: fontString({ ...o, size: o.size * z }),
    lineHeight: `${L.lh * z}px`,
    padding: `${L.py * z}px ${L.px * z}px`,
    color: o.bg === "pill" ? contrastOn(o.color) : o.color,
    background: o.bg === "pill" ? o.color : "transparent",
    borderRadius: `${Math.min(o.size * 0.38, L.h / 2) * z}px`,
    webkitTextStroke: o.bg === "outline" ? `${Math.max(1, o.size * 0.06 * z)}px ${contrastOn(o.color)}` : "",
    paintOrder: "stroke fill",
  });
}

export function finishText() {
  const id = S.editingText;
  if (!id) return;
  const doc = S.doc;
  const o = findObj(id) as TextObj | undefined;
  S.editingText = null;
  editor.style.display = "none";
  editor.blur();
  if (doc && o) {
    o.text = editor.value.replace(/\s+$/, "");
    if (!o.text.trim()) {
      doc.objects = doc.objects.filter((x) => x.id !== id);
      setSelection([]);
    }
  }
  touch();
  if (textTx) {
    commit("Text");
    textTx = null;
  }
  requestRender();
}

// ---------- cursor and wiring ----------

const CURSORS: Partial<Record<ToolId, string>> = {
  select: "default",
  hand: "grab",
  text: "text",
  picker: "copy",
  fill: "cell",
  brush: "none",
  eraser: "none",
  pencil: "none",
  highlighter: "none",
};

const RESIZE: Record<string, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", p1: "move", p2: "move", mid: "move",
};

export function updateCursor(e?: PointerEvent) {
  if (!canvas) return;
  if (S.spaceDown) {
    canvas.style.cursor = "grab";
    return;
  }
  let c = CURSORS[S.tool] ?? "crosshair";
  if (e && S.doc && !drag) {
    const sp = screenPt(e);
    const h = hitHandle(sp);
    if (h) c = RESIZE[h.id];
    else if (S.tool === "select" || CREATE_TOOLS.includes(S.tool)) {
      const p = docPt(e);
      const o = S.tool === "select" ? topHit(p) : topHit(p, sameFamily);
      if (o && (S.tool === "select" || S.selection.includes(o.id) || o.type !== "text")) c = S.tool === "text" && o.type === "text" ? "text" : "move";
    } else if (S.tool === "marquee" && inMarquee(docPt(e))) c = "move";
  }
  canvas.style.cursor = c;
}

function sameFamily(o: Obj) {
  const t = S.tool;
  if (t === "arrow" || t === "line") return o.type === "line";
  if (t === "highlighter") return o.type === "stroke";
  return o.type === t;
}

export function initTools(c: HTMLCanvasElement, textarea: HTMLTextAreaElement) {
  canvas = c;
  editor = textarea;

  editor.addEventListener("input", () => {
    const o = findObj(S.editingText) as TextObj | undefined;
    if (o) o.text = editor.value;
    layoutEditor();
    requestRender();
  });
  editor.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      finishText();
    }
  });

  c.addEventListener("contextmenu", (e) => e.preventDefault());

  c.addEventListener("pointerdown", (e) => {
    if (!S.doc) return;
    if (S.editingText) {
      finishText();
      return;
    }
    c.setPointerCapture(e.pointerId);
    const p = docPt(e);
    const sp = screenPt(e);
    if (e.button === 1 || S.spaceDown || S.tool === "hand") {
      drag = startPan(e);
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const t = S.tool;
    if (t === "crop") {
      drag = startCrop(p, sp);
      return;
    }
    if (t === "marquee") {
      drag = startMarquee(p, e);
      return;
    }
    if (t === "fill") return doFill(p, e);
    if (t === "picker") return pickColor(p, e);
    if (t === "brush" || t === "pencil" || t === "eraser") {
      drag = startPaint(t, p, e);
      return;
    }
    const h = hitHandle(sp);
    if (h) {
      drag = startHandle(h.o, h.id);
      return;
    }
    if (t === "select") {
      const o = topHit(p);
      if (o) {
        if (e.shiftKey) {
          setSelection(S.selection.includes(o.id) ? S.selection.filter((id) => id !== o.id) : [...S.selection, o.id]);
          return;
        }
        if (!S.selection.includes(o.id)) setSelection([o.id]);
        drag = startMove(p, e);
      } else {
        if (!e.shiftKey) setSelection([]);
        drag = startBand(p, e.shiftKey);
      }
      requestRender();
      return;
    }
    // Creation tools can grab objects of their own kind, so adjusting never needs a tool switch.
    const own = topHit(p, sameFamily);
    if (own) {
      if (own.type === "text" && t === "text") {
        editText(own);
        return;
      }
      setSelection([own.id]);
      drag = startMove(p, e);
      requestRender();
      return;
    }
    drag = createFor(t, p, e);
  });

  c.addEventListener("pointermove", (e) => {
    if (!S.doc) return;
    const p = docPt(e);
    S.cursor = p;
    emit("cursor");
    if (drag) {
      drag.move(p, e);
      return;
    }
    const prevHover = S.hover;
    if (S.tool === "select" || CREATE_TOOLS.includes(S.tool)) {
      const o = S.tool === "select" ? topHit(p) : topHit(p, sameFamily);
      S.hover = o?.id ?? null;
    } else S.hover = null;
    updateCursor(e);
    if (prevHover !== S.hover || RASTER_TOOLS.includes(S.tool) || S.tool === "highlighter") requestRender();
  });

  const end = (e: PointerEvent) => {
    if (!drag || !S.doc) return;
    const d = drag;
    drag = null;
    d.up(docPt(e), e);
    updateCursor(e);
  };
  c.addEventListener("pointerup", end);
  c.addEventListener("pointercancel", end);
  c.addEventListener("pointerleave", () => {
    if (drag) return;
    S.cursor = null;
    S.hover = null;
    emit("cursor");
    requestRender();
  });

  c.addEventListener("dblclick", (e) => {
    if (!S.doc) return;
    const p = docPt(e);
    if (S.tool === "crop") return applyCrop();
    const h = hitHandle(screenPt(e));
    if (h && h.id === "mid" && h.o.type === "line") {
      mutate("Begradigen", () => {
        delete (h.o as LineObj).cx;
        delete (h.o as LineObj).cy;
      });
      return;
    }
    const o = topHit(p);
    if (o?.type === "text") editText(o);
  });

  c.addEventListener(
    "wheel",
    (e) => {
      if (!S.doc) return;
      e.preventDefault();
      const sp = screenPt(e);
      if (e.ctrlKey || e.metaKey) {
        zoomAt(S.doc.view.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)), sp.x, sp.y);
      } else {
        const k = e.deltaMode ? 40 : 1;
        S.doc.view.fit = false;
        S.doc.view.panX -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
        S.doc.view.panY -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
        emit("view");
        requestRender();
      }
      if (S.editingText) layoutEditor();
    },
    { passive: false },
  );

  // WebKit sends pinch as gesture events rather than ctrl+wheel.
  let gestureZoom = 1;
  c.addEventListener("gesturestart", (e: any) => {
    e.preventDefault();
    gestureZoom = S.doc?.view.zoom ?? 1;
  });
  c.addEventListener("gesturechange", (e: any) => {
    e.preventDefault();
    if (!S.doc) return;
    const sp = screenPt(e);
    zoomAt(gestureZoom * e.scale, sp.x, sp.y);
  });
}

export function isDragging() {
  return drag !== null;
}
