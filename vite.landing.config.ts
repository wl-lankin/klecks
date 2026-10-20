import { defineConfig } from "vite";

// The browser demo for wolfgang-linz.de/klecks/: the real interface, started by dev/landing.ts.
// `npm run landing` writes it to dist-landing/, which the website serves from klecks/demo/.
export default defineConfig({
  base: "./",
  build: { target: "es2022", outDir: "dist-landing", emptyOutDir: true },
  plugins: [
    {
      name: "klecks-landing-entry",
      transformIndexHtml: {
        order: "pre",
        handler: (html) => html.replace("/src/main.ts", "/dev/landing.ts"),
      },
    },
  ],
});
