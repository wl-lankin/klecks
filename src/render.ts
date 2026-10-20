import type { BlurObj, Frame, Obj, Rect, SpotObj } from "./types";
import { S, newCanvas, settings, type Doc } from "./state";
import { bounds, drawObject, isBox, lineMid, normRect } from "./objects";

export const FRAME_PRESETS: { name: string; stops: string[] }[] = [
  { name: "Aurora", stops: ["#6D4AFF", "#FF4D8D", "#FFA24C"] },
  { name: "Ozean", stops: ["#0EA5E9", "#6366F1"] },
  { name: "Abendrot", stops: ["#F97316", "#DB2777"] },
  { name: "Minze", stops: ["#34D399", "#0EA5E9"] },
  { name: "Pfirsich", stops: ["#FDE68A", "#FCA5A5"] },
  { name: "Lavendel", stops: ["#C4B5FD", "#F0ABFC"] },
  { name: "Graphit", stops: ["#3F3F46", "#111113"] },
  { name: "Papier", stops: ["#F5F5F4", "#E7E5E4"] },
  { name: "Ohne", stops: [] },
];

/** Overlay state owned by the tools module (rubber band, previews). */
export const overlay = {
  band: null as Rect | null,
  snapGuide: null as { x?: number; y?: number } | null,
};

// ---------- compositing ----------

export const live = {
  canvas: null as HTMLCanvasElement | null,
  alpha: 1,
};

const cache = new WeakMap<Doc, { canvas: HTMLCanvasElement; version: number; skip: string | null }>();

function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const x2 = Math.min(w, Math.ceil(r.x + r.w));
  const y2 = Math.min(h, Math.ceil(r.y + r.h));
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

function applyBlur(ctx: CanvasRenderingContext2D, o: BlurObj, W: number, H: number) {
  const r = clipRect(normRect(o.x, o.y, o.w, o.h), W, H);
  if (!r) return;
  const s = Math.max(2, o.strength);
  const sw = Math.max(1, Math.ceil(r.w / s));
  const sh = Math.max(1, Math.ceil(r.h / s));
  const small = newCanvas(sw, sh);
  const sc = small.getContext("2d")!;
  sc.imageSmoothingEnabled = true;
  sc.imageSmoothingQuality = "high";
  sc.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  if (o.mode === "pixelate") {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, sw, sh, r.x, r.y, sw * s, sh * s);
  } else {
    // Two-step upscale gives a soft, even blur without ctx.filter (not everywhere in WebKit).
    const mid = newCanvas(sw * 2, sh * 2);
    const mc = mid.getContext("2d")!;
    mc.imageSmoothingQuality = "high";
    mc.drawImage(small, 0, 0, sw * 2, sh * 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(mid, 0, 0, sw * 2, sh * 2, r.x, r.y, r.w, r.h);
  }
  ctx.restore();
}

function applySpotlights(ctx: CanvasRenderingContext2D, spots: SpotObj[], W: number, H: number) {
  if (!spots.length) return;
  const dim = Math.max(...spots.map((s) => s.dim));
  const tmp = newCanvas(W, H);
  const t = tmp.getContext("2d")!;
  t.fillStyle = `rgba(8,8,12,${dim})`;
  t.fillRect(0, 0, W, H);
  t.globalCompositeOperation = "destination-out";
  t.fillStyle = "#000";
  for (const s of spots) {
    const r = normRect(s.x, s.y, s.w, s.h);
    t.beginPath();
    if (s.ellipse) t.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    else t.roundRect(r.x, r.y, r.w, r.h, Math.min(14, r.w / 4, r.h / 4));
    t.fill();
  }
  ctx.drawImage(tmp, 0, 0);
}

export function composeInto(ctx: CanvasRenderingContext2D, doc: Doc, skip: string | null) {
  ctx.clearRect(0, 0, doc.w, doc.h);
  ctx.drawImage(doc.raster, 0, 0);
  if (live.canvas && doc === S.doc) {
    ctx.save();
    ctx.globalAlpha = live.alpha;
    ctx.drawImage(live.canvas, 0, 0);
    ctx.restore();
  }
  const spots: SpotObj[] = [];
  for (const o of doc.objects) {
    if (o.id === skip) continue;
    if (o.type === "blur") applyBlur(ctx, o, doc.w, doc.h);
    else if (o.type === "spotlight") spots.push(o);
    else drawObject(ctx, o);
  }
  applySpotlights(ctx, spots, doc.w, doc.h);
}

export function composite(doc: Doc): HTMLCanvasElement {
  let c = cache.get(doc);
  const skip = S.editingText;
  if (c && c.version === doc.version && c.skip === skip && c.canvas.width === doc.w && c.canvas.height === doc.h) return c.canvas;
  const canvas = c && c.canvas.width === doc.w && c.canvas.height === doc.h ? c.canvas : newCanvas(doc.w, doc.h);
  composeInto(canvas.getContext("2d")!, doc, skip);
  cache.set(doc, { canvas, version: doc.version, skip });
  return canvas;
}

// ---------- frame (beautify) ----------

function frameBackdrop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, f: Frame) {
  const preset = FRAME_PRESETS[f.preset] ?? FRAME_PRESETS[0];
  if (!preset.stops.length) return;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  preset.stops.forEach((c, i) => g.addColorStop(i / Math.max(1, preset.stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // A soft light from the top left keeps big flat gradients from looking cheap.
  const shine = ctx.createRadialGradient(x + w * 0.2, y, 0, x + w * 0.2, y, Math.max(w, h) * 0.9);
  shine.addColorStop(0, "rgba(255,255,255,0.22)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.fillRect(x, y, w, h);
}

function framePad(doc: Doc) {
  return Math.round(doc.frame.padding * Math.max(1, Math.min(doc.w, doc.h) / 900));
}

export function frameRect(doc: Doc): Rect {
  if (!doc.frame.on) return { x: 0, y: 0, w: doc.w, h: doc.h };
  const p = framePad(doc);
  return { x: -p, y: -p, w: doc.w + p * 2, h: doc.h + p * 2 };
}

function drawDocWithFrame(ctx: CanvasRenderingContext2D, doc: Doc, img: CanvasImageSource, under?: () => void) {
  const f = doc.frame;
  if (f.on) {
    const fr = frameRect(doc);
    frameBackdrop(ctx, fr.x, fr.y, fr.w, fr.h, f);
    const r = f.radius * Math.max(1, Math.min(doc.w, doc.h) / 900);
    ctx.save();
    if (f.shadow > 0) {
      ctx.shadowColor = `rgba(0,0,0,${0.55 * f.shadow})`;
      ctx.shadowBlur = 40 + 60 * f.shadow;
      ctx.shadowOffsetY = 12 + 18 * f.shadow;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.roundRect(0, 0, doc.w, doc.h, r);
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, doc.w, doc.h, r);
    ctx.clip();
    under?.();
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  } else {
    under?.();
    ctx.drawImage(img, 0, 0);
  }
}

/** The final picture: what Copy and Save hand out. */
export function exportCanvas(doc: Doc, opts: { frame?: boolean; flattenAlpha?: string } = {}): HTMLCanvasElement {
  const prev = S.editingText;
  S.editingText = null;
  const img = newCanvas(doc.w, doc.h);
  composeInto(img.getContext("2d")!, doc, null);
  S.editingText = prev;
  const useFrame = opts.frame ?? doc.frame.on;
  const fr = useFrame ? frameRect(doc) : { x: 0, y: 0, w: doc.w, h: doc.h };
  const out = newCanvas(fr.w, fr.h);
  const ctx = out.getContext("2d")!;
  if (opts.flattenAlpha) {
    ctx.fillStyle = opts.flattenAlpha;
    ctx.fillRect(0, 0, fr.w, fr.h);
  }
  ctx.translate(-fr.x, -fr.y);
  if (useFrame) drawDocWithFrame(ctx, doc, img);
  else ctx.drawImage(img, 0, 0);
  return out;
}

// ---------- view ----------

export const ACCENT = "#ff4d7e";

export function toScreen(doc: Doc, x: number, y: number): [number, number] {
  return [x * doc.view.zoom + doc.view.panX, y * doc.view.zoom + doc.view.panY];
}

export function toDoc(doc: Doc, sx: number, sy: number): [number, number] {
  return [(sx - doc.view.panX) / doc.view.zoom, (sy - doc.view.panY) / doc.view.zoom];
}

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "p1" | "p2" | "mid";
export interface Handle {
  id: HandleId;
  x: number;
  y: number;
}

export function boxHandles(r: Rect): Handle[] {
  const { x, y, w, h } = r;
  return [
    { id: "nw", x, y },
    { id: "n", x: x + w / 2, y },
    { id: "ne", x: x + w, y },
    { id: "e", x: x + w, y: y + h / 2 },
    { id: "se", x: x + w, y: y + h },
    { id: "s", x: x + w / 2, y: y + h },
    { id: "sw", x, y: y + h },
    { id: "w", x, y: y + h / 2 },
  ];
}

export function handlesFor(o: Obj): Handle[] {
  if (o.type === "line") {
    const m = lineMid(o);
    return [
      { id: "p1", x: o.x1, y: o.y1 },
      { id: "p2", x: o.x2, y: o.y2 },
      { id: "mid", x: m[0], y: m[1] },
    ];
  }
  if (isBox(o)) return boxHandles(normRect(o.x, o.y, o.w, o.h));
  if (o.type === "text" || o.type === "step") {
    const b = bounds(o);
    return [{ id: "se", x: b.x + b.w, y: b.y + b.h }];
  }
  return [];
}

let checker: HTMLCanvasElement | null = null;
function checkerPattern(ctx: CanvasRenderingContext2D) {
  if (!checker) {
    checker = newCanvas(16, 16);
    const c = checker.getContext("2d")!;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 16, 16);
    c.fillStyle = "#e6e6ea";
    c.fillRect(0, 0, 8, 8);
    c.fillRect(8, 8, 8, 8);
  }
  return ctx.createPattern(checker, "repeat")!;
}

let viewCanvas: HTMLCanvasElement;
let vctx: CanvasRenderingContext2D;
let raf = 0;
let antsOffset = 0;

export function initView(c: HTMLCanvasElement) {
  viewCanvas = c;
  vctx = c.getContext("2d")!;
  new ResizeObserver(() => requestRender()).observe(c);
}

export function requestRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    renderView();
    if (S.marquee) {
      antsOffset = (antsOffset + 0.35) % 16;
      requestRender();
    }
  });
}

export function viewSize() {
  return { w: viewCanvas.clientWidth, h: viewCanvas.clientHeight };
}

function renderView() {
  const dpr = window.devicePixelRatio || 1;
  const cw = viewCanvas.clientWidth;
  const ch = viewCanvas.clientHeight;
  if (viewCanvas.width !== Math.round(cw * dpr) || viewCanvas.height !== Math.round(ch * dpr)) {
    viewCanvas.width = Math.round(cw * dpr);
    viewCanvas.height = Math.round(ch * dpr);
  }
  const ctx = vctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const doc = S.doc;
  if (!doc) return;
  const { zoom, panX, panY } = doc.view;
  const img = composite(doc);

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);
  ctx.imageSmoothingEnabled = zoom < 2;
  ctx.imageSmoothingQuality = "high";
  if (!doc.frame.on) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.38)";
    ctx.shadowBlur = 36 / zoom;
    ctx.shadowOffsetY = 10 / zoom;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, doc.w, doc.h);
    ctx.restore();
  }
  drawDocWithFrame(ctx, doc, img, () => {
    const pat = checkerPattern(ctx);
    pat.setTransform(new DOMMatrix().scale(1 / zoom));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, doc.w, doc.h);
  });
  ctx.restore();

  if (zoom >= 10) drawPixelGrid(ctx, doc, cw, ch);
  drawOverlays(ctx, doc);
}

function drawPixelGrid(ctx: CanvasRenderingContext2D, doc: Doc, cw: number, ch: number) {
  const { zoom, panX, panY } = doc.view;
  const x0 = Math.max(0, Math.floor(-panX / zoom));
  const y0 = Math.max(0, Math.floor(-panY / zoom));
  const x1 = Math.min(doc.w, Math.ceil((cw - panX) / zoom));
  const y1 = Math.min(doc.h, Math.ceil((ch - panY) / zoom));
  ctx.save();
  ctx.strokeStyle = "rgba(128,128,140,0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x <= x1; x++) {
    const sx = Math.round(x * zoom + panX) + 0.5;
    ctx.moveTo(sx, y0 * zoom + panY);
    ctx.lineTo(sx, y1 * zoom + panY);
  }
  for (let y = y0; y <= y1; y++) {
    const sy = Math.round(y * zoom + panY) + 0.5;
    ctx.moveTo(x0 * zoom + panX, sy);
    ctx.lineTo(x1 * zoom + panX, sy);
  }
  ctx.stroke();
  ctx.restore();
}

function screenRect(doc: Doc, r: Rect): Rect {
  const [x, y] = toScreen(doc, r.x, r.y);
  return { x, y, w: r.w * doc.view.zoom, h: r.h * doc.view.zoom };
}

function handle(ctx: CanvasRenderingContext2D, x: number, y: number, round = false, mid = false) {
  ctx.beginPath();
  if (mid) {
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + 6);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
  } else if (round) ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  else ctx.roundRect(x - 4.5, y - 4.5, 9, 9, 2.5);
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 4;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ACCENT;
  ctx.stroke();
}

function drawOverlays(ctx: CanvasRenderingContext2D, doc: Doc) {
  ctx.save();
  // hover
  if (S.hover && !S.selection.includes(S.hover)) {
    const o = doc.objects.find((x) => x.id === S.hover);
    if (o) {
      const r = screenRect(doc, bounds(o));
      ctx.strokeStyle = "rgba(255, 77, 126,0.75)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    }
  }
  // selection
  const sel = doc.objects.filter((o) => S.selection.includes(o.id) && o.id !== S.editingText);
  for (const o of sel) {
    const r = screenRect(doc, bounds(o));
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(o.type === "line" ? [4, 4] : []);
    if (o.type !== "line") ctx.strokeRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
    ctx.setLineDash([]);
  }
  if (sel.length === 1) {
    const o = sel[0];
    if (o.type === "line") {
      const [ax, ay] = toScreen(doc, o.x1, o.y1);
      const [bx, by] = toScreen(doc, o.x2, o.y2);
      const m = lineMid(o);
      const [mx, my] = toScreen(doc, m[0], m[1]);
      handle(ctx, ax, ay, true);
      handle(ctx, bx, by, true);
      handle(ctx, mx, my, false, true);
    } else {
      for (const h of handlesFor(o)) {
        const [x, y] = toScreen(doc, h.x, h.y);
        handle(ctx, x, y);
      }
    }
  }
  // rubber band
  if (overlay.band) {
    const r = screenRect(doc, normRect(overlay.band.x, overlay.band.y, overlay.band.w, overlay.band.h));
    ctx.fillStyle = "rgba(255, 77, 126,0.10)";
    ctx.strokeStyle = "rgba(255, 77, 126,0.9)";
    ctx.lineWidth = 1;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
  }
  if (overlay.snapGuide) {
    const g = overlay.snapGuide;
    ctx.strokeStyle = "#FF4D8D";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (g.x !== undefined) {
      const [x, y0] = toScreen(doc, g.x, 0);
      ctx.moveTo(Math.round(x) + 0.5, y0);
      ctx.lineTo(Math.round(x) + 0.5, y0 + doc.h * doc.view.zoom);
    }
    if (g.y !== undefined) {
      const [x0, y] = toScreen(doc, 0, g.y);
      ctx.moveTo(x0, Math.round(y) + 0.5);
      ctx.lineTo(x0 + doc.w * doc.view.zoom, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // marquee
  if (S.marquee) {
    ctx.beginPath();
    if (S.marquee.kind === "rect") {
      const r = screenRect(doc, S.marquee.r);
      ctx.rect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    } else {
      const p = S.marquee.pts;
      for (let i = 0; i < p.length; i += 2) {
        const [x, y] = toScreen(doc, p[i], p[i + 1]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#fff";
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.strokeStyle = "#111";
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -antsOffset;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // crop
  if (S.crop) {
    const r = screenRect(doc, S.crop);
    const all = screenRect(doc, { x: 0, y: 0, w: doc.w, h: doc.h });
    ctx.fillStyle = "rgba(6,6,10,0.6)";
    ctx.beginPath();
    ctx.rect(all.x, all.y, all.w, all.h);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill("evenodd");
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(r.x + (r.w * i) / 3, r.y);
      ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
      ctx.moveTo(r.x, r.y + (r.h * i) / 3);
      ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
    }
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    // corner brackets
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    const L = Math.min(22, r.w / 3, r.h / 3);
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [
      [r.x, r.y, 1, 1],
      [r.x + r.w, r.y, -1, 1],
      [r.x, r.y + r.h, 1, -1],
      [r.x + r.w, r.y + r.h, -1, -1],
    ]) {
      ctx.moveTo(cx + dx * L, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * L);
    }
    ctx.stroke();
  }
  // brush cursor
  const c = S.cursor;
  const sizeTool = S.tool === "brush" ? settings.brush.size : S.tool === "eraser" ? settings.eraser.size : S.tool === "highlighter" ? settings.highlighter.width : S.tool === "pencil" ? settings.pencil.size : 0;
  if (c && sizeTool && !S.spaceDown) {
    const [x, y] = toScreen(doc, c.x, c.y);
    const r = Math.max(1.5, (sizeTool * doc.view.zoom) / 2);
    ctx.beginPath();
    if (S.tool === "pencil") ctx.rect(x - r, y - r, r * 2, r * 2);
    else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
  ctx.restore();
}
