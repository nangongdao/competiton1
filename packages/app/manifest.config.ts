import { defineManifest } from "@crxjs/vite-plugin";

// MV3 manifest 定义(纯数据;@crxjs 出问题时可被手写多入口构建复用)。
export default defineManifest({
  manifest_version: 3,
  name: "多平台内容发布工具",
  version: "0.1.0",
  description: "一份内容自动适配公众号/知乎/B站/小红书并一键发布(默认模拟)",
  // 主界面 = 独立整页(dedicated tab),由 background 打开。
  action: {
    default_title: "打开多平台发布工具",
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  side_panel: {
    default_path: "index.html",
  },
  permissions: ["clipboardWrite", "storage", "sidePanel", "scripting", "activeTab"],
  host_permissions: [
    "https://mp.weixin.qq.com/*",
    "https://zhuanlan.zhihu.com/*",
    "https://member.bilibili.com/*",
    "https://creator.xiaohongshu.com/*",
    // 本机 server(图床/公众号官方 API)与 runner(网页自动化发布)端口。
    // 收窄到实际端口,并优先 127.0.0.1 而非 localhost(后者可被 hosts 文件劫持)。
    "http://127.0.0.1:8787/*",
    "http://127.0.0.1:8790/*",
  ],
  content_scripts: [
    {
      matches: [
        "https://mp.weixin.qq.com/*",
        "https://zhuanlan.zhihu.com/*",
        "https://member.bilibili.com/*",
        "https://creator.xiaohongshu.com/*",
      ],
      js: ["src/content/assisted-handoff.ts"],
      run_at: "document_idle",
    },
  ],
});
