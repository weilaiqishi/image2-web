import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/app/",
  plugins: [react()],
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    outDir: "dist-site/app",
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
  },
});
