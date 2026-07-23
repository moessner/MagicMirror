import { defineConfig } from "vite";
import { voicePreviewPlugin } from "./vite.voicePreviewPlugin";

export default defineConfig({
  root: ".",
  publicDir: "public",
  base: "./",
  plugins: [voicePreviewPlugin()],
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: "../public/avatar-app",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: "es2022",
    rollupOptions: {
      input: {
        main: "index.html",
        embed: "embed.html"
      }
    }
  }
});
