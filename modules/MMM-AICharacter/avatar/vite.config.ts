import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  base: "./",
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
