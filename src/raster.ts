import type { Rect } from "./types";
import { hexToRgb } from "./objects";
import { newCanvas } from "./state";

/** Scanline flood fill. Returns the filled bounding box, or null when nothing changed. */
export function floodFill(canvas: HTMLCanvasElement, sx: number, sy: number, hex: string, alpha: number, tolerance: number): Rect | null {
  const W = canvas.width;
  const H = canvas.height;
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const [fr, fg, fb] = hexToRgb(hex);
  const fa = Math.round(alpha * 255);
  const i0 = (sy * W + sx) * 4;
  const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3];
  if (tr === fr && tg === fg && tb === fb && ta === fa) return null;
  const tol = (tolerance / 100) * 255 * 2;
  const match = (i: number) => {
    // Fully transparent pixels count as equal, whatever color they carry.
    if (ta === 0 && d[i + 3] === 0) return true;
    const dr = d[i] - tr, dg = d[i + 1] - tg, db = d[i + 2] - tb, da = d[i + 3] - ta;
    return Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= tol;
  };
  const seen = new Uint8Array(W * H);
  const stack: number[] = [sx, sy];
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let p = y * W + x;
    while (x >= 0 && !seen[p] && match(p * 4)) { x--; p--; }
    x++; p++;
    let up = false, down = false;
    while (x < W && !seen[p] && match(p * 4)) {
      seen[p] = 1;
      const i = p * 4;
      d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = fa;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (y > 0) {
        const q = p - W;
        const m = !seen[q] && match(q * 4);
        if (m && !up) { stack.push(x, y - 1); up = true; } else if (!m) up = false;
      }
      if (y < H - 1) {
        const q = p + W;
        const m = !seen[q] && match(q * 4);
        if (m && !down) { stack.push(x, y + 1); down = true; } else if (!m) down = false;
      }
      x++; p++;
    }
  }
  ctx.putImageData(img, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Hard-edged Bresenham line like classic Paint's pencil. */
export function pixelLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, size: number) {
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const off = Math.floor(size / 2);
  for (;;) {
    ctx.fillRect(x0 - off, y0 - off, size, size);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function adjustPixels(canvas: HTMLCanvasElement, r: Rect, kind: "invert" | "grayscale", clip?: Path2D) {
  const ctx = canvas.getContext("2d")!;
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const w = Math.min(canvas.width - x, Math.ceil(r.w));
  const h = Math.min(canvas.height - y, Math.ceil(r.h));
  if (w <= 0 || h <= 0) return;
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (kind === "invert") {
      d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
    } else {
      const g = Math.round(d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722);
      d[i] = d[i + 1] = d[i + 2] = g;
    }
  }
  if (!clip) {
    ctx.putImageData(img, x, y);
    return;
  }
  const tmp = newCanvas(w, h);
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  ctx.save();
  ctx.clip(clip);
  ctx.clearRect(x, y, w, h);
  ctx.drawImage(tmp, x, y);
  ctx.restore();
}

export function transformCanvas(src: HTMLCanvasElement, op: "cw" | "ccw" | "180" | "flipH" | "flipV"): HTMLCanvasElement {
  const swap = op === "cw" || op === "ccw";
  const out = newCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const c = out.getContext("2d")!;
  switch (op) {
    case "cw": c.translate(out.width, 0); c.rotate(Math.PI / 2); break;
    case "ccw": c.translate(0, out.height); c.rotate(-Math.PI / 2); break;
    case "180": c.translate(out.width, out.height); c.rotate(Math.PI); break;
    case "flipH": c.translate(out.width, 0); c.scale(-1, 1); break;
    case "flipV": c.translate(0, out.height); c.scale(1, -1); break;
  }
  c.drawImage(src, 0, 0);
  return out;
}

export function lassoPath(pts: number[], ox = 0, oy = 0): Path2D {
  const p = new Path2D();
  for (let i = 0; i < pts.length; i += 2) i ? p.lineTo(pts[i] - ox, pts[i + 1] - oy) : p.moveTo(pts[i] - ox, pts[i + 1] - oy);
  p.closePath();
  return p;
}

/** A 24-bit BMP with the image flattened onto white, since classic Paint users still ask for it. */
export function encodeBmp(canvas: HTMLCanvasElement): Uint8Array {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext("2d")!.getImageData(0, 0, w, h).data;
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * h;
  const buf = new Uint8Array(size);
  const v = new DataView(buf.buffer);
  buf[0] = 0x42; buf[1] = 0x4d;
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, row * h, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    const o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = src[i + 3] / 255;
      buf[o + x * 3] = Math.round(src[i + 2] * a + 255 * (1 - a));
      buf[o + x * 3 + 1] = Math.round(src[i + 1] * a + 255 * (1 - a));
      buf[o + x * 3 + 2] = Math.round(src[i] * a + 255 * (1 - a));
    }
  }
  return buf;
}
