import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// web dev / 普通网页构建配置(主演示路径,无需扩展)。
// PERF-05:manualChunks 拆分 react/vendor/core,消除 >500kB 单 chunk 警告,
// 首屏只加载 react + zustand + 核心预览(经 Worker 独立线程,主 chunk 更轻)。
// Tauri 桌面端启动时(TAURI_ENV_* 由 tauri CLI 注入)不自动开浏览器。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 首屏只用 radix tooltip,其余 radix(抽屉)随动态导入拆分。
          if (id.includes("node_modules/@radix-ui")) return "radix";
          // xterm 终端(仅桌面端懒加载,不进入首屏 vendor)。
          if (id.includes("node_modules/@xterm") || id.includes("node_modules/xterm")) return "xterm";
          // Tauri API(仅桌面端动态 import,不进入首屏 vendor)。
          if (id.includes("node_modules/@tauri-apps")) return "tauri";
          // React 运行时 + 依赖 react 的库(zustand/scheduler),避免 vendor→react 环。
          // 注意:必须用包边界精确匹配,不能用 "react" 子串 —— react-remove-scroll 等
          // radix 依赖路径也含 "react",误匹配会把它们拉进 react-vendor 造成 chunk 循环。
          if (
            /node_modules\/react\//.test(id) ||
            /node_modules\/react-dom\//.test(id) ||
            /node_modules\/scheduler\//.test(id) ||
            /node_modules\/zustand\//.test(id) ||
            /node_modules\/use-sync-external-store\//.test(id) ||
            /node_modules\/react-is\//.test(id) ||
            /node_modules\/loose-envify\//.test(id) ||
            /node_modules\/object-assign\//.test(id) ||
            /node_modules\/prop-types\//.test(id)
          ) {
            return "react-vendor";
          }
          // core 预览管线(纯 TS,与 UI 解耦);连同其直接/间接依赖
          // (markdown-it/sanitize-html 全家)一起并入,避免 vendor → mpp-core → vendor 的 chunk 循环。
          if (
            // @mpp/core 包及其子路径;不用 "/core/" 子串(会误匹配 @floating-ui/core)。
            id.includes("node_modules/@mpp/core") ||
            id.includes("node_modules/markdown-it") ||
            id.includes("node_modules/sanitize-html") ||
            id.includes("node_modules/mdurl") ||
            id.includes("node_modules/uc.micro") ||
            id.includes("node_modules/entities") ||
            id.includes("node_modules/linkify-it") ||
            id.includes("node_modules/punycode.js") ||
            id.includes("node_modules/argparse") ||
            id.includes("node_modules/deepmerge") ||
            id.includes("node_modules/escape-string-regexp") ||
            id.includes("node_modules/is-plain-object") ||
            id.includes("node_modules/parse-srcset") ||
            id.includes("node_modules/launder") ||
            id.includes("node_modules/htmlparser2") ||
            id.includes("node_modules/domutils") ||
            id.includes("node_modules/domhandler") ||
            id.includes("node_modules/domelementtype") ||
            id.includes("node_modules/css-select") ||
            id.includes("node_modules/css-what") ||
            id.includes("node_modules/nth-check") ||
            id.includes("node_modules/source-map-js") ||
            id.includes("node_modules/postcss") ||
            id.includes("node_modules/picocolors") ||
            id.includes("node_modules/nanoid")
          ) {
            return "mpp-core";
          }
          // 其余 node_modules(dompurify 等)。
          if (id.includes("node_modules")) return "vendor";
          return undefined;
        },
      },
    },
    // 拆包后主 chunk 应 <500kB;仍有超限时给出警告(门禁据此失败,见 TEST-02)。
    chunkSizeWarningLimit: 500,
  },
  server: {
    port: 5176,
    // 桌面端(Tauri dev)不弹浏览器;纯 Web 开发自动打开。
    open: !process.env["TAURI_ENV_TARGET_TRIPLE"],
  },
});
