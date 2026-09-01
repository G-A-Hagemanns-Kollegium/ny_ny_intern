import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Builds the site bundles into Django's static dir. Fixed filenames; cache-busting is handled
// by Django/WhiteNoise's ManifestStaticFilesStorage at collectstatic time in production.
//
// Two independent entries:
//   app  -> dist/app.js + dist/app.css   loaded by base.html on EVERY page (Tailwind, Alpine, htmx)
//   spil -> dist/spil.js                 loaded ONLY by templates/spil/spil.html (Ølbuddet)
//
// `spil` imports nothing from `app` (and no CSS — its styling is static/spil/spil.css), so Rollup
// emits two standalone files with no shared chunk and app.js is byte-for-byte unaffected.
export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    outDir: "../app/static/dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: "src/main.ts",
        spil: "src/spil/main.ts",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "app.[ext]",
      },
    },
  },
});
