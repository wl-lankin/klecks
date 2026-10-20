import "@fontsource-variable/inter";
import { invoke } from "@tauri-apps/api/core";

// The picker window lies over one monitor and shows its frozen picture; the user drags a frame.
const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const shot = document.createElement("canvas");

let start: { x: number; y: number } | null = null;
let cur: { x: number; y: number } | null = null;
let mouse = { x: -1, y: -1 };

const PINK = "#ff4d7e";

function rect() {
  if (!start || !cur) return null;
  return { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  if (canvas.width !== Math.round(W * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(shot, 0, 0, W, H);
  const r = rect();
  ctx.fillStyle = "rgba(8, 8, 14, 0.5)";
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  if (r && r.w > 0 && r.h > 0) ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill("evenodd");
  if (r && r.w > 0 && r.h > 0) {
    ctx.strokeStyle = PINK;
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    const sx = shot.width / W;
    const label = `${Math.round(r.w * sx)} × ${Math.round(r.h * sx)}`;
    ctx.font = '600 12px "Inter Variable", system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 16;
    const ly = r.y + r.h + 30 > H ? r.y + r.h - 32 : r.y + r.h + 8;
    ctx.fillStyle = PINK;
    ctx.beginPath();
    ctx.roundRect(r.x, ly, tw, 24, 7);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + 8, ly + 12.5);
  } else if (mouse.x >= 0) {
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mouse.x + 0.5, 0);
    ctx.lineTo(mouse.x + 0.5, H);
    ctx.moveTo(0, mouse.y + 0.5);
    ctx.lineTo(W, mouse.y + 0.5);
    ctx.stroke();
  }
  if (!start) hint(W);
}

function hint(W: number) {
  const text = "Bereich aufziehen · Klick nimmt den ganzen Bildschirm · Esc bricht ab";
  ctx.font = '600 13px "Inter Variable", system-ui, sans-serif';
  const tw = ctx.measureText(text).width + 32;
  const x = (W - tw) / 2;
  ctx.fillStyle = "rgba(20, 20, 26, 0.88)";
  ctx.beginPath();
  ctx.roundRect(x, 24, tw, 38, 12);
  ctx.fill();
  ctx.fillStyle = "#ededf2";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 16, 43.5);
}

async function finish() {
  const r = rect();
  const W = window.innerWidth;
  const s = shot.width / W;
  const area = r && r.w >= 3 && r.h >= 3 ? r : { x: 0, y: 0, w: W, h: window.innerHeight };
  await invoke("snip_finish", {
    x: Math.round(area.x * s),
    y: Math.round(area.y * s),
    width: Math.max(1, Math.round(area.w * s)),
    height: Math.max(1, Math.round(area.h * s)),
  });
}

const cancel = () => void invoke("snip_cancel");

window.addEventListener("pointerdown", (e) => {
  if (e.button === 2) return cancel();
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  cur = { ...start };
  canvas.setPointerCapture(e.pointerId);
  draw();
});
window.addEventListener("pointermove", (e) => {
  mouse = { x: e.clientX, y: e.clientY };
  if (start) cur = { x: Math.max(0, Math.min(window.innerWidth, e.clientX)), y: Math.max(0, Math.min(window.innerHeight, e.clientY)) };
  requestAnimationFrame(draw);
});
window.addEventListener("pointerup", () => {
  if (start) void finish();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cancel();
  if (e.key === "Enter") void finish();
});
window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("resize", draw);

(async () => {
  const buf = await invoke<ArrayBuffer>("snip_shot");
  const v = new DataView(buf);
  const w = v.getUint32(0, true);
  const h = v.getUint32(4, true);
  shot.width = w;
  shot.height = h;
  shot.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(buf, 8, w * h * 4), w, h), 0, 0);
  await document.fonts.ready;
  draw();
  await invoke("snip_show");
})();
