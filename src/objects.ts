import type { BoxObj, Dash, FontKey, LineObj, Obj, Rect, ShapeKind, ShapeObj, StepObj, StrokeObj, TextObj } from "./types";
import { sources } from "./state";

export const FONTS: Record<FontKey, { label: string; css: string; weight: number }> = {
  sans: { label: "Inter", css: '"Inter Variable", "Inter", system-ui, sans-serif', weight: 650 },
  hand: { label: "Handschrift", css: '"Caveat", "Segoe Print", "Bradley Hand", cursive', weight: 700 },
  serif: { label: "Serif", css: 'Georgia, "Times New Roman", serif', weight: 600 },
  mono: { label: "Mono", css: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', weight: 600 },
};

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastOn(hex: string) {
  return luminance(hex) > 0.45 ? "#111114" : "#FFFFFF";
}

export function normRect(x: number, y: number, w: number, h: number): Rect {
  return { x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) };
}

export function isBox(o: Obj): o is BoxObj {
  return o.type === "rect" || o.type === "ellipse" || o.type === "shape" || o.type === "blur" || o.type === "spotlight" || o.type === "image";
}

export function isFillable(o: Obj): o is ShapeObj {
  return o.type === "rect" || o.type === "ellipse" || (o.type === "shape" && o.kind !== "check" && o.kind !== "cross");
}

// ---------- line geometry ----------

type P = [number, number];

export function linePoints(o: LineObj): P[] {
  if (o.cx === undefined || o.cy === undefined) return [[o.x1, o.y1], [o.x2, o.y2]];
  const pts: P[] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    pts.push([a * o.x1 + b * o.cx + c * o.x2, a * o.y1 + b * o.cy + c * o.y2]);
  }
  return pts;
}

/** Point on the curve at t=0.5, where the bend handle sits. */
export function lineMid(o: LineObj): P {
  if (o.cx === undefined || o.cy === undefined) return [(o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2];
  return [(o.x1 + 2 * o.cx + o.x2) / 4, (o.y1 + 2 * o.cy + o.y2) / 4];
}

function cumulative(pts: P[]) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

function pointAt(pts: P[], cum: number[], s: number): P {
  if (s <= 0) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] >= s) {
      const seg = cum[i] - cum[i - 1] || 1;
      const t = (s - cum[i - 1]) / seg;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
  }
  return pts[pts.length - 1];
}

/** The part of the polyline between arc lengths a and b, resampled on the original vertices. */
function slice(pts: P[], cum: number[], a: number, b: number): P[] {
  const out: P[] = [pointAt(pts, cum, a)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > a && cum[i] < b) out.push(pts[i]);
  out.push(pointAt(pts, cum, b));
  return out;
}

function strokePoly(ctx: CanvasRenderingContext2D, pts: P[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function setDash(ctx: CanvasRenderingContext2D, dash: Dash, w: number) {
  if (dash === "dashed") ctx.setLineDash([w * 2.4, w * 1.8]);
  else if (dash === "dotted") ctx.setLineDash([0.001, w * 2]);
  else ctx.setLineDash([]);
}

function dir(a: P, b: P): P {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

function drawTaper(ctx: CanvasRenderingContext2D, o: LineObj, pts: P[]) {
  const W = o.width;
  const cum = cumulative(pts);
  const L = cum[cum.length - 1];
  if (L < 1) return;
  const Lh = Math.min(W * 3.3 + 10, L * 0.62);
  const hh = Math.max(W * 1.45, Lh * 0.5);
  const base = pointAt(pts, cum, L - Lh);
  const tip = pts[pts.length - 1];
  const d = dir(base, tip);
  const n: P = [-d[1], d[0]];
  const shaftEnd = L - Lh * 0.7;
  const shaft = slice(pts, cum, 0, shaftEnd);
  const sc = cumulative(shaft);
  const left: P[] = [];
  const right: P[] = [];
  for (let i = 0; i < shaft.length; i++) {
    const t = sc[i] / (sc[sc.length - 1] || 1);
    const half = W * (0.14 + 0.36 * t);
    const a = shaft[Math.max(0, i - 1)];
    const b = shaft[Math.min(shaft.length - 1, i + 1)];
    const dd = dir(a, b);
    const nn: P = [-dd[1], dd[0]];
    left.push([shaft[i][0] + nn[0] * half, shaft[i][1] + nn[1] * half]);
    right.push([shaft[i][0] - nn[0] * half, shaft[i][1] - nn[1] * half]);
  }
  const barb: P = [base[0] - d[0] * Lh * 0.1, base[1] - d[1] * Lh * 0.1];
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const p of left) ctx.lineTo(p[0], p[1]);
  ctx.lineTo(barb[0] + n[0] * hh, barb[1] + n[1] * hh);
  ctx.lineTo(tip[0], tip[1]);
  ctx.lineTo(barb[0] - n[0] * hh, barb[1] - n[1] * hh);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = o.color;
  ctx.strokeStyle = o.color;
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, W * 0.14);
  ctx.setLineDash([]);
  ctx.fill();
  ctx.stroke();
}

function arrowHead(ctx: CanvasRenderingContext2D, pts: P[], W: number, open: boolean) {
  const cum = cumulative(pts);
  const L = cum[cum.length - 1];
  const Lh = Math.min(W * 2.8 + 8, L * 0.5);
  const hh = Lh * 0.58;
  const tip = pts[pts.length - 1];
  const base = pointAt(pts, cum, L - Lh);
  const d = dir(base, tip);
  const n: P = [-d[1], d[0]];
  const b: P = [tip[0] - d[0] * Lh, tip[1] - d[1] * Lh];
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(b[0] + n[0] * hh, b[1] + n[1] * hh);
  ctx.lineTo(tip[0], tip[1]);
  ctx.lineTo(b[0] - n[0] * hh, b[1] - n[1] * hh);
  if (open) {
    ctx.stroke();
  } else {
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = Math.max(1, W * 0.5);
    ctx.stroke();
  }
  return L - Lh * 0.85;
}

function drawLine(ctx: CanvasRenderingContext2D, o: LineObj) {
  const pts = linePoints(o);
  if (o.arrow === "taper") return drawTaper(ctx, o, pts);
  const W = o.width;
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = W;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const cum = cumulative(pts);
  const L = cum[cum.length - 1];
  let a = 0;
  let b = L;
  if (o.arrow === "classic" || o.arrow === "double") {
    ctx.save();
    b = arrowHead(ctx, pts, W, false);
    if (o.arrow === "double") a = L - arrowHead(ctx, [...pts].reverse(), W, false);
    ctx.restore();
  } else if (o.arrow === "open") {
    ctx.save();
    ctx.lineWidth = W;
    arrowHead(ctx, pts, W, true);
    ctx.restore();
  }
  setDash(ctx, o.dash, W);
  if (b > a) strokePoly(ctx, slice(pts, cum, a, b));
  ctx.setLineDash([]);
}

// ---------- shapes ----------

function polygon(p: Path2D, pts: P[], x: number, y: number, w: number, h: number) {
  pts.forEach(([u, v], i) => (i ? p.lineTo(x + u * w, y + v * h) : p.moveTo(x + u * w, y + v * h)));
  p.closePath();
}

function regular(n: number, inner = 0): P[] {
  const out: P[] = [];
  const steps = inner ? n * 2 : n;
  for (let i = 0; i < steps; i++) {
    const r = inner && i % 2 ? inner : 0.5;
    const a = -Math.PI / 2 + (i * Math.PI * 2) / steps;
    out.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return out;
}

export function shapePath(kind: ShapeKind, x: number, y: number, w: number, h: number): Path2D {
  const p = new Path2D();
  switch (kind) {
    case "triangle":
      polygon(p, [[0.5, 0], [1, 1], [0, 1]], x, y, w, h);
      break;
    case "rtriangle":
      polygon(p, [[0, 0], [1, 1], [0, 1]], x, y, w, h);
      break;
    case "diamond":
      polygon(p, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], x, y, w, h);
      break;
    case "pentagon":
      polygon(p, regular(5), x, y, w, h);
      break;
    case "hexagon":
      polygon(p, [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]], x, y, w, h);
      break;
    case "star":
      polygon(p, regular(5, 0.2), x, y, w, h);
      break;
    case "blockarrow":
      polygon(p, [[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]], x, y, w, h);
      break;
    case "heart": {
      const X = (u: number) => x + u * w;
      const Y = (v: number) => y + v * h;
      p.moveTo(X(0.5), Y(1));
      p.bezierCurveTo(X(0.12), Y(0.72), X(-0.04), Y(0.42), X(0.08), Y(0.2));
      p.bezierCurveTo(X(0.2), Y(-0.02), X(0.45), Y(0.02), X(0.5), Y(0.24));
      p.bezierCurveTo(X(0.55), Y(0.02), X(0.8), Y(-0.02), X(0.92), Y(0.2));
      p.bezierCurveTo(X(1.04), Y(0.42), X(0.88), Y(0.72), X(0.5), Y(1));
      p.closePath();
      break;
    }
    case "bubble": {
      const bh = h * 0.78;
      const r = Math.min(w, bh) * 0.22;
      p.moveTo(x + r, y);
      p.arcTo(x + w, y, x + w, y + bh, r);
      p.arcTo(x + w, y + bh, x, y + bh, r);
      p.lineTo(x + w * 0.36, y + bh);
      p.lineTo(x + w * 0.18, y + h);
      p.lineTo(x + w * 0.2, y + bh);
      p.arcTo(x, y + bh, x, y, r);
      p.arcTo(x, y, x + w, y, r);
      p.closePath();
      break;
    }
    case "check":
      p.moveTo(x + w * 0.06, y + h * 0.55);
      p.lineTo(x + w * 0.38, y + h * 0.88);
      p.lineTo(x + w * 0.94, y + h * 0.12);
      break;
    case "cross":
      p.moveTo(x + w * 0.1, y + h * 0.1);
      p.lineTo(x + w * 0.9, y + h * 0.9);
      p.moveTo(x + w * 0.9, y + h * 0.1);
      p.lineTo(x + w * 0.1, y + h * 0.9);
      break;
  }
  return p;
}

function boxPath(o: ShapeObj): Path2D {
  const r = normRect(o.x, o.y, o.w, o.h);
  if (o.type === "rect") {
    const p = new Path2D();
    p.roundRect(r.x, r.y, r.w, r.h, Math.min(o.radius, r.w / 2, r.h / 2));
    return p;
  }
  if (o.type === "ellipse") {
    const p = new Path2D();
    p.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    return p;
  }
  return shapePath(o.kind, r.x, r.y, r.w, r.h);
}

function shadowOn(ctx: CanvasRenderingContext2D, size: number) {
  ctx.shadowColor = "rgba(0,0,0,0.32)";
  ctx.shadowBlur = 6 + size * 1.1;
  ctx.shadowOffsetY = 2 + size * 0.22;
}

function shadowOff(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawShape(ctx: CanvasRenderingContext2D, o: ShapeObj) {
  const path = boxPath(o);
  const open = o.type === "shape" && (o.kind === "check" || o.kind === "cross");
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (o.fill !== "none" && !open) {
    ctx.fillStyle = o.fill === "tint" ? rgba(o.color, 0.2) : o.fillColor;
    ctx.fill(path);
    shadowOff(ctx);
  }
  if (o.width > 0) {
    ctx.strokeStyle = o.color;
    ctx.lineWidth = open ? o.width * 1.6 : o.width;
    setDash(ctx, o.dash, o.width);
    ctx.stroke(path);
    ctx.setLineDash([]);
  }
}

// ---------- text ----------

const measureCtx = document.createElement("canvas").getContext("2d")!;

export function fontString(o: TextObj) {
  const f = FONTS[o.font];
  return `${f.weight} ${o.size}px ${f.css}`;
}

export function textLayout(o: TextObj) {
  measureCtx.font = fontString(o);
  const lines = (o.text || " ").split("\n");
  const widths = lines.map((l) => measureCtx.measureText(l || " ").width);
  const lh = o.size * 1.22;
  const px = o.bg === "pill" ? o.size * 0.42 : o.size * 0.08;
  const py = o.bg === "pill" ? o.size * 0.2 : o.size * 0.04;
  const w = Math.max(...widths) + px * 2;
  const h = lines.length * lh + py * 2;
  return { lines, widths, lh, px, py, w, h };
}

function drawText(ctx: CanvasRenderingContext2D, o: TextObj) {
  const L = textLayout(o);
  ctx.font = fontString(o);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let fg = o.color;
  if (o.bg === "pill") {
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.roundRect(o.x, o.y, L.w, L.h, Math.min(o.size * 0.38, L.h / 2));
    ctx.fill();
    shadowOff(ctx);
    fg = contrastOn(o.color);
  }
  L.lines.forEach((line, i) => {
    const tx = o.x + L.px;
    const ty = o.y + L.py + L.lh * i + L.lh / 2 + o.size * 0.02;
    if (o.bg === "outline") {
      ctx.save();
      shadowOff(ctx);
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, o.size * 0.2);
      ctx.strokeStyle = contrastOn(o.color);
      ctx.strokeText(line, tx, ty);
      ctx.restore();
    }
    ctx.fillStyle = fg;
    ctx.fillText(line, tx, ty);
  });
}

// ---------- step badge ----------

function drawStep(ctx: CanvasRenderingContext2D, o: StepObj) {
  const r = o.size / 2;
  ctx.beginPath();
  ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
  ctx.fillStyle = o.color;
  ctx.fill();
  shadowOff(ctx);
  ctx.lineWidth = Math.max(2, o.size * 0.08);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.stroke();
  ctx.fillStyle = contrastOn(o.color);
  const label = String(o.n);
  ctx.font = `750 ${o.size * (label.length > 1 ? 0.46 : 0.54)}px ${FONTS.sans.css}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, o.x, o.y + o.size * 0.03);
}

function drawStroke(ctx: CanvasRenderingContext2D, o: StrokeObj) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = o.color;
  ctx.lineWidth = o.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const p = o.pts;
  ctx.moveTo(p[0], p[1]);
  if (p.length === 2) ctx.lineTo(p[0] + 0.01, p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
  ctx.restore();
}

/** Draws one object. Blur and spotlight are applied by the compositor, not here. */
export function drawObject(ctx: CanvasRenderingContext2D, o: Obj) {
  ctx.save();
  if (o.shadow) shadowOn(ctx, "width" in o ? o.width : "size" in o ? o.size / 8 : 4);
  switch (o.type) {
    case "line":
      drawLine(ctx, o);
      break;
    case "rect":
    case "ellipse":
    case "shape":
      drawShape(ctx, o);
      break;
    case "text":
      drawText(ctx, o);
      break;
    case "step":
      shadowOn(ctx, 4);
      drawStep(ctx, o);
      break;
    case "stroke":
      drawStroke(ctx, o);
      break;
    case "image": {
      const src = sources.get(o.src);
      if (!src) break;
      const r = normRect(o.x, o.y, o.w, o.h);
      ctx.translate(r.x + (o.flipX ? r.w : 0), r.y + (o.flipY ? r.h : 0));
      ctx.scale(o.flipX ? -1 : 1, o.flipY ? -1 : 1);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0, r.w, r.h);
      break;
    }
  }
  ctx.restore();
}

// ---------- bounds and hit testing ----------

export function bounds(o: Obj): Rect {
  switch (o.type) {
    case "line": {
      const pts = linePoints(o);
      const pad = o.arrow === "none" ? o.width / 2 : o.width * 2;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const [x, y] of pts) {
        x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
      }
      return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
    }
    case "text": {
      const L = textLayout(o);
      return { x: o.x, y: o.y, w: L.w, h: L.h };
    }
    case "step":
      return { x: o.x - o.size / 2, y: o.y - o.size / 2, w: o.size, h: o.size };
    case "stroke": {
      const p = o.pts;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        x1 = Math.min(x1, p[i]); y1 = Math.min(y1, p[i + 1]); x2 = Math.max(x2, p[i]); y2 = Math.max(y2, p[i + 1]);
      }
      const pad = o.width / 2;
      return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
    }
    default:
      return normRect(o.x, o.y, o.w, o.h);
  }
}

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distPoly(px: number, py: number, pts: P[]) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distSeg(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return d;
}

export function hitTest(o: Obj, x: number, y: number, tol: number): boolean {
  switch (o.type) {
    case "line":
      return distPoly(x, y, linePoints(o)) <= Math.max(o.width, o.arrow === "taper" ? o.width * 1.2 : 0) / 2 + tol;
    case "stroke": {
      const pts: P[] = [];
      for (let i = 0; i < o.pts.length; i += 2) pts.push([o.pts[i], o.pts[i + 1]]);
      if (pts.length === 1) pts.push(pts[0]);
      return distPoly(x, y, pts) <= o.width / 2 + tol;
    }
    case "step":
      return Math.hypot(x - o.x, y - o.y) <= o.size / 2 + tol;
    case "rect":
    case "ellipse":
    case "shape": {
      const path = boxPath(o);
      if (o.fill !== "none" && measureCtx.isPointInPath(path, x, y)) return true;
      measureCtx.lineWidth = o.width + tol * 2;
      return measureCtx.isPointInStroke(path, x, y);
    }
    default: {
      const b = bounds(o);
      return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
    }
  }
}

/** Point inside the shape's area, whether or not it is filled yet. */
export function insideShape(o: Obj, x: number, y: number): boolean {
  if (!isFillable(o)) return false;
  return measureCtx.isPointInPath(boxPath(o), x, y) || hitTest(o, x, y, 0);
}

export function translate(o: Obj, dx: number, dy: number) {
  switch (o.type) {
    case "line":
      o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy;
      if (o.cx !== undefined && o.cy !== undefined) { o.cx += dx; o.cy += dy; }
      break;
    case "stroke":
      for (let i = 0; i < o.pts.length; i += 2) { o.pts[i] += dx; o.pts[i + 1] += dy; }
      break;
    default:
      o.x += dx;
      o.y += dy;
  }
}

/** Scales positions and sizes around the origin, used when the whole image is resized. */
export function scaleObject(o: Obj, fx: number, fy: number) {
  const f = Math.sqrt(fx * fy);
  switch (o.type) {
    case "line":
      o.x1 *= fx; o.y1 *= fy; o.x2 *= fx; o.y2 *= fy; o.width *= f;
      if (o.cx !== undefined && o.cy !== undefined) { o.cx *= fx; o.cy *= fy; }
      break;
    case "stroke":
      for (let i = 0; i < o.pts.length; i += 2) { o.pts[i] *= fx; o.pts[i + 1] *= fy; }
      o.width *= f;
      break;
    case "text":
      o.x *= fx; o.y *= fy; o.size *= f;
      break;
    case "step":
      o.x *= fx; o.y *= fy; o.size *= f;
      break;
    default:
      o.x *= fx; o.y *= fy; o.w *= fx; o.h *= fy;
      if ("width" in o) o.width *= f;
  }
}

export function unionRect(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rs) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function rectsIntersect(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
