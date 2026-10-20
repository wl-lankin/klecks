import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 1430, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: { input: { main: "index.html", snip: "snip.html" } },
  },
});
