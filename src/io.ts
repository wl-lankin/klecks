import { invoke } from "@tauri-apps/api/core";
import { newCanvas } from "./state";
import { encodeBmp } from "./raster";

export const isTauri = "__TAURI_INTERNALS__" in window;
export const isMac = /Mac/.test(navigator.userAgent);
export const isWindows = /Windows/.test(navigator.userAgent);
export const MOD = isMac ? "⌘" : "Strg";

export const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "avif", "ico", "tif", "tiff", "heic"];

export async function canvasFromBlob(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const c = newCanvas(bmp.width, bmp.height);
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

function mimeFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  return `image/${ext}`;
}

export function basename(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

export async function pickAndOpen(): Promise<{ canvas: HTMLCanvasElement; name: string; path?: string }[]> {
  if (!isTauri) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.onchange = async () => {
        const out = [];
        for (const f of Array.from(input.files ?? [])) out.push({ canvas: await canvasFromBlob(f), name: f.name });
        resolve(out);
      };
      input.click();
    });
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: true, filters: [{ name: "Bilder", extensions: IMAGE_EXT }] });
  if (!picked) return [];
  const paths = Array.isArray(picked) ? picked : [picked];
  const out = [];
  for (const path of paths) out.push({ canvas: await openPath(path), name: basename(path), path });
  return out;
}

export async function openPath(path: string): Promise<HTMLCanvasElement> {
  const bytes = await invoke<ArrayBuffer>("read_file", { path });
  return canvasFromBlob(new Blob([bytes], { type: mimeFor(path) }));
}

export type Format = "png" | "jpg" | "webp" | "bmp";

export function formatOf(path: string): Format {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "webp") return "webp";
  if (ext === "bmp") return "bmp";
  return "png";
}

export async function encode(canvas: HTMLCanvasElement, fmt: Format, quality = 0.92): Promise<Uint8Array> {
  if (fmt === "bmp") return encodeBmp(canvas);
  const type = fmt === "jpg" ? "image/jpeg" : `image/${fmt}`;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));
  if (!blob) throw new Error("Bild konnte nicht kodiert werden");
  return new Uint8Array(await blob.arrayBuffer());
}

export async function askSavePath(defaultName: string): Promise<string | null> {
  if (!isTauri) return defaultName;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({
    defaultPath: defaultName,
    filters: [
      { name: "PNG", extensions: ["png"] },
      { name: "JPEG", extensions: ["jpg", "jpeg"] },
      { name: "WebP", extensions: ["webp"] },
      { name: "BMP", extensions: ["bmp"] },
    ],
  });
}

export async function writeFile(path: string, bytes: Uint8Array) {
  if (!isTauri) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
    a.download = basename(path);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return;
  }
  await invoke("write_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
}

export async function copyCanvas(canvas: HTMLCanvasElement) {
  const png = await encode(canvas, "png");
  if (isTauri) {
    await invoke("copy_image", png);
    return;
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([png as BlobPart], { type: "image/png" }) })]);
}

/** Reads an image only when the user pasted on purpose. */
export async function readClipboardImage(): Promise<HTMLCanvasElement | null> {
  if (isTauri) {
    try {
      const buf = await invoke<ArrayBuffer>("paste_image");
      const v = new DataView(buf);
      const w = v.getUint32(0, true);
      const h = v.getUint32(4, true);
      const c = newCanvas(w, h);
      c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(buf, 8, w * h * 4), w, h), 0, 0);
      return c;
    } catch {
      return null;
    }
  }
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return canvasFromBlob(await item.getType(type));
    }
  } catch {}
  return null;
}
