import { defineConfig } from "vite";

export default defineConfig({
  // 前端源码根目录（index.html 位于 src/ 下）
  root: "src",
  // 适配 Tauri：固定端口 + 严格端口
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
