import "@fontsource-variable/inter";
import "@fontsource/caveat/700.css";
import "./styles.css";
import { S, emit, on, saveSettings, settings, uid } from "./state";
import { initView, requestRender } from "./render";
import { initTools, setTool, updateCursor, isDragging, layoutEditor } from "./tools";
import { bindUi, findCommandFor, registerPaste } from "./commands";
import { createDoc, fitView, mutate, nudge, pasteCanvas } from "./docs";
import { canvasFromBlob, isMac, isTauri, readClipboardImage } from "./io";
import { buildChrome, setUpdateState, toggleFrame } from "./ui/chrome";
import { initPropbar } from "./ui/propbar";
import { initToasts, toast } from "./ui/toast";
import { choose, initModals, modalOpen } from "./ui/modal";
import { aboutDialog, canvasDialog, newDialog, openMenu, openPalette, resizeDialog, shortcutsDialog } from "./ui/dialogs";
import { closePopover, popoverOpen } from "./ui/controls";
import type { TextObj } from "./types";

const app = document.getElementById("app")!;
document.documentElement.classList.add(isMac ? "os-mac" : "os-win");

// ---------- theme ----------

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
}
function toggleTheme() {
  const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  settings.theme = dark ? "light" : "dark";
  saveSettings();
  applyTheme();
  emit("settings");
}
applyTheme();

// ---------- build ----------

let brandBtn: HTMLElement;
const { stage, view, editor, drop } = buildChrome(app, {
  menu: () => openMenu(brandBtn),
  newDialog: (p) => newDialog(p),
});
brandBtn = app.querySelector(".brand")!;
initView(view);
initTools(view, editor);
initPropbar(stage);
initToasts(app);
initModals(app);

on("doc", requestRender);
on("selection", requestRender);
on("view", () => S.editingText && layoutEditor());
window.addEventListener("resize", () => (S.doc?.view.fit ? fitView() : requestRender()));

// ---------- updates ----------

let manualCheck = false;

async function restartForUpdate() {
  const dirty = S.docs.filter((d) => d.dirty);
  if (dirty.length) {
    const r = await choose("Neu starten?", `${dirty.length === 1 ? "Ein Bild hat" : `${dirty.length} Bilder haben`} ungesicherte Änderungen, die beim Neustart verloren gehen.`, [
      { id: "cancel", label: "Abbrechen" },
      { id: "go", label: "Trotzdem neu starten", danger: true },
    ]);
    if (r !== "go") return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("update_restart");
}

async function initUpdates() {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  type St = { state: string; version: string | null; message: string | null };
  const show = (s: St) => {
    setUpdateState(s.state, s.version, restartForUpdate);
    if (!manualCheck) return;
    if (s.state === "current") toast("Klecks ist auf dem neuesten Stand", { icon: "Check", tone: "ok" });
    else if (s.state === "error") toast(`Update-Prüfung fehlgeschlagen: ${s.message ?? ""}`, { tone: "err", ms: 5000 });
    else if (s.state === "downloading") toast(`Version ${s.version} wird geladen …`, { icon: "Download" });
    if (s.state !== "checking" && s.state !== "downloading") manualCheck = false;
  };
  await listen<St>("update-state", (e) => show(e.payload));
  show(await invoke<St>("update_status"));

  const { getVersion } = await import("@tauri-apps/api/app");
  const version = await getVersion();
  try {
    const last = localStorage.getItem("klecks.version");
    if (last && last !== version) setTimeout(() => toast(`Klecks wurde auf Version ${version} aktualisiert`, { icon: "Sparkles", tone: "ok", ms: 5000 }), 800);
    localStorage.setItem("klecks.version", version);
  } catch {}
}

async function checkUpdates() {
  if (!isTauri) return toast("Updates gibt es nur in der installierten App");
  manualCheck = true;
  toast("Suche nach Updates …", { icon: "RefreshCcw", ms: 1500 });
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("update_check");
}

bindUi({
  newDialog: () => newDialog(),
  resizeDialog,
  canvasDialog,
  palette: openPalette,
  shortcuts: shortcutsDialog,
  toggleTheme,
  toggleFrame,
  checkUpdates: () => void checkUpdates(),
  about: () => void aboutDialog(),
});

// ---------- paste: only ever on an explicit paste ----------

let pasteTimer = 0;
let pasteAsNew = false;

async function pasteFromClipboard(asNew: boolean) {
  const c = await readClipboardImage();
  if (c) pasteCanvas(c, asNew);
  else toast("In der Zwischenablage liegt kein Bild", { icon: "ClipboardX" });
}
registerPaste((asNew) => void pasteFromClipboard(asNew));

function pasteText(text: string) {
  if (!S.doc) return;
  const { w, h } = { w: view.clientWidth, h: view.clientHeight };
  const d = S.doc;
  const s = settings.text;
  const o: TextObj = {
    id: uid(), type: "text", text: text.slice(0, 2000),
    x: (w / 2 - d.view.panX) / d.view.zoom - 80, y: (h / 2 - d.view.panY) / d.view.zoom - s.size / 2,
    size: s.size, font: s.font, color: settings.color, bg: s.bg, shadow: s.shadow,
  };
  mutate("Text einfügen", (_tx, doc) => doc.objects.push(o));
  setTool("select");
  S.selection = [o.id];
  emit("selection");
}

document.addEventListener("paste", (e) => {
  const t = e.target as HTMLElement;
  if (t.matches?.("input, textarea")) return;
  clearTimeout(pasteTimer);
  e.preventDefault();
  const items = Array.from(e.clipboardData?.items ?? []);
  const img = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
  if (img) {
    const f = img.getAsFile();
    if (f) void canvasFromBlob(f).then((c) => pasteCanvas(c, pasteAsNew));
    return;
  }
  const text = e.clipboardData?.getData("text/plain");
  if (text && S.doc && !pasteAsNew) {
    pasteText(text);
    return;
  }
  void pasteFromClipboard(pasteAsNew);
});

// ---------- keyboard ----------

const isField = (t: EventTarget | null) => (t as HTMLElement)?.matches?.("input, textarea, select, [contenteditable]");

function escape() {
  if (popoverOpen()) return closePopover();
  if (isDragging()) return;
  if (S.crop) return setTool("select");
  if (S.marquee) {
    S.marquee = null;
    emit("marquee");
    requestRender();
    return;
  }
  if (S.selection.length) {
    S.selection = [];
    emit("selection");
    return;
  }
  if (S.tool !== "select") setTool("select");
}

document.addEventListener("keydown", (e) => {
  if (modalOpen() || isField(e.target)) return;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (e.code === "Space") {
    if (!S.spaceDown) {
      S.spaceDown = true;
      updateCursor();
      requestRender();
    }
    e.preventDefault();
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    return escape();
  }
  if (mod && !e.altKey && e.key.toLowerCase() === "v") {
    // Let the native paste event come first; fall back to reading the clipboard if it does not.
    pasteAsNew = e.shiftKey;
    clearTimeout(pasteTimer);
    pasteTimer = window.setTimeout(() => void pasteFromClipboard(pasteAsNew), 180);
    return;
  }
  if (S.doc && S.selection.length && e.key.startsWith("Arrow") && !mod && !e.altKey) {
    const step = e.shiftKey ? 10 : 1;
    nudge(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
    e.preventDefault();
    return;
  }
  const c = findCommandFor(e);
  if (c) {
    e.preventDefault();
    if (!c.when || c.when()) c.run();
    return;
  }
  // Keep the webview from doing browser things (reload, print, find, zoom).
  if (mod && ["r", "p", "f", "g", "j", "u", "l", "h"].includes(e.key.toLowerCase())) e.preventDefault();
  if (e.key === "F5" || e.key === "F3" || e.key === "F7" || e.key === "F12") e.preventDefault();
});

document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    S.spaceDown = false;
    updateCursor();
    requestRender();
  }
});
window.addEventListener("blur", () => {
  S.spaceDown = false;
});

// ---------- drag and drop ----------

let dragDepth = 0;
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  drop.classList.add("in");
});
window.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = "copy";
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) drop.classList.remove("in");
});
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove("in");
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|avif|tiff?|heic)$/i.test(f.name));
  if (!files.length) return toast("Das ist kein Bild, das Klecks öffnen kann", { tone: "err" });
  for (const f of files) {
    try {
      createDoc(await canvasFromBlob(f), f.name);
    } catch {
      toast(`${f.name} konnte nicht geöffnet werden`, { tone: "err" });
    }
  }
});

// ---------- closing ----------

async function initClose() {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { invoke } = await import("@tauri-apps/api/core");
  const win = getCurrentWindow();
  await win.onCloseRequested(async (event) => {
    const dirty = S.docs.filter((d) => d.dirty);
    if (dirty.length) {
      event.preventDefault();
      const r = await choose("Klecks beenden?", `${dirty.length === 1 ? `„${dirty[0].name}“ hat` : `${dirty.length} Bilder haben`} ungesicherte Änderungen.`, [
        { id: "cancel", label: "Abbrechen" },
        { id: "quit", label: "Ohne Sichern beenden", danger: true },
      ]);
      if (r !== "quit") return;
      await invoke("update_on_quit");
      await win.destroy();
      return;
    }
    await invoke("update_on_quit");
  });
}

// ---------- start ----------

void initUpdates();
void initClose();
emit("docs", "tool", "settings");
setTool("select");
requestRender();

if (import.meta.env.DEV) (window as any).__klecks = { S, pasteCanvas, setTool, emit };
