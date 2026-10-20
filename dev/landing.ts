// Entry for the website demo. Runs the app unchanged and adds what an embedded copy needs:
// a dark start, a prepared picture, and talking to the page around it.
import "./landing.css";
import { settings } from "../src/state";

const params = new URLSearchParams(location.search);
const demo = params.get("demo");
const post = (event: string, data: object = {}) => parent.postMessage({ klecks: true, event, ...data }, "*");

// The page is dark, so the demo starts dark too. A choice made in the demo is kept.
if (settings.theme === "system") settings.theme = "dark";
document.documentElement.classList.add("landing");

// Without Ctrl or ⌘ the wheel scrolls the website, not the canvas.
window.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey || e.metaKey) return;
    if (scrollsItself(e.target as Element | null, e.deltaY)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    post("wheel", { dy: e.deltaMode ? e.deltaY * 40 : e.deltaY });
  },
  { capture: true, passive: false },
);

function scrollsItself(el: Element | null, dy: number) {
  for (; el && el !== document.body; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (!/(auto|scroll)/.test(s.overflowY) || el.scrollHeight <= el.clientHeight) continue;
    if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
  }
  return false;
}

await import("../src/main");
const { canvasFromBlob } = await import("../src/io");
const { createDoc, blankDoc, fitView } = await import("../src/docs");
const { S, emit, uid } = await import("../src/state");
const { setTool } = await import("../src/tools");
type Obj = import("../src/types").Obj;

// Images dropped on the website arrive here and open as tabs, just as when dropped on the window.
window.addEventListener("message", async (e) => {
  if (e.source !== parent || !e.data?.klecks || e.data.event !== "files") return;
  for (const f of e.data.files as File[]) {
    try {
      createDoc(await canvasFromBlob(f), f.name);
    } catch {}
  }
});

if (demo === "hero") {
  const blob = await (await fetch("demo/screen.png")).blob();
  createDoc(await canvasFromBlob(blob), "Lumora Sicherheit.png");
  // A finished guide that stays editable: every object can be moved, recoloured or deleted.
  const red = "#FF3B30";
  const objs: Obj[] = [
    { id: uid(), type: "blur", x: 344, y: 288, w: 202, h: 26, mode: "pixelate", strength: 12 },
    { id: uid(), type: "blur", x: 297, y: 449, w: 242, h: 32, mode: "pixelate", strength: 12 },
    { id: uid(), type: "step", x: 188, y: 325, n: 1, size: 40, color: red, shadow: true },
    { id: uid(), type: "step", x: 1008, y: 307, n: 2, size: 40, color: red, shadow: true },
    { id: uid(), type: "text", x: 742, y: 92, text: "Hier einschalten", size: 30, font: "sans", color: red, bg: "pill", shadow: true },
    { id: uid(), type: "line", x1: 1000, y1: 150, x2: 1082, y2: 280, cx: 1102, cy: 178, color: red, width: 8, dash: "solid", arrow: "taper", shadow: true },
  ];
  const doc = S.doc!;
  doc.objects.push(...objs);
  doc.frame = { ...doc.frame, on: true, preset: 0 };
  doc.version++;
  fitView(doc);
  emit("docs", "history", "frame");
} else if (demo === "photo") {
  const blob = await (await fetch("demo/photo.jpg")).blob();
  createDoc(await canvasFromBlob(blob), "Bucht.jpg");
  const red = "#FF3B30";
  const objs: Obj[] = [
    { id: uid(), type: "text", x: 250, y: 150, text: "Hier baden wir morgen!", size: 104, font: "hand", color: red, bg: "pill", shadow: true },
    { id: uid(), type: "line", x1: 1180, y1: 330, x2: 1600, y2: 640, cx: 1560, cy: 320, color: red, width: 20, dash: "solid", arrow: "taper", shadow: true },
    { id: uid(), type: "ellipse", x: 1520, y: 640, w: 330, h: 190, color: red, width: 12, dash: "solid", fill: "none", fillColor: red, radius: 0, kind: "triangle", shadow: true },
  ];
  const doc = S.doc!;
  doc.objects.push(...objs);
  doc.frame = { ...doc.frame, on: true, preset: 0 };
  doc.version++;
  fitView(doc);
} else if (demo === "paint") {
  blankDoc(1600, 1000, "#ffffff", "Skizze");
  setTool("brush");
}

post("ready");
