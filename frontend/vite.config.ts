import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Builds a single CSS+JS bundle into Django's static dir. Fixed filenames; cache-busting is handled
// by Django/WhiteNoise's ManifestStaticFilesStorage at collectstatic time in production.
export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    outDir: "../app/static/dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/main.ts",
      output: {
        entryFileNames: "app.js",
        assetFileNames: "app.[ext]",
      },
    },
  },
});
