import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  root: "src/renderer-react",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../../out/renderer",
    emptyOutDir: true,
  },
});
