/**
 * 平台 fixture 本地 HTTP 服务器(路线图 §6.2)。
 *
 * 之前 platform-fixtures 用 `page.setContent` 注入 HTML,无法覆盖导航、CSP
 * 与页面生命周期。本模块把各平台编辑器 fixture 做成真实 HTTP 页面:
 * - `goto(editorUrl)` 真正发生导航(DOMContentLoaded / load / CSP 响应头);
 * - 可注入 CSP 头验证适配器在受限环境下仍可用;
 * - 页面生命周期(load 事件 / 异步渲染)由 fixture 脚本模拟。
 */
import { createServer, type Server } from "node:http";

export interface FixtureServerHandle {
  readonly server: Server;
  readonly port: number;
  readonly baseUrl: string;
  close(): Promise<void>;
}

export interface FixturePageOptions {
  /** 是否提供保存草稿按钮(默认 true)。 */
  readonly withDraftButton?: boolean;
  /** 点击发布后的结果:true=出现成功证据;unknown=无证据。 */
  readonly publishResult?: "true" | "unknown";
  /** 注入 CSP 响应头(默认不注入)。 */
  readonly csp?: string;
  /** 页面标题(用于验证导航成功)。 */
  readonly title?: string;
}

function fixtureHtml(platformId: string, options: FixturePageOptions): string {
  const draftButton =
    options.withDraftButton === false ? "" : `<button data-mpp-action="save-draft" id="draftBtn">保存草稿</button>`;
  const publishOnClick =
    options.publishResult === "unknown"
      ? ``
      : `onclick="document.querySelector('[data-testid=published]').textContent='true'"`;
  const title = options.title ?? `${platformId} fixture`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; }
    [data-mpp-field] { display: block; margin: 8px 0; }
  </style>
</head>
<body data-platform="${platformId}">
  <h1>${platformId} 编辑器(fixture)</h1>
  <input data-mpp-field="title" placeholder="标题" />
  <div data-mpp-field="body" contenteditable="true"></div>
  <input data-mpp-field="tags" placeholder="标签" />
  <input data-mpp-field="cover" type="file" />
  ${draftButton}
  <button data-mpp-action="publish" ${publishOnClick}>发布</button>
  <span data-testid="published">false</span>
  <script>
    // 模拟异步渲染:延迟挂载编辑区,验证适配器能等待页面生命周期。
    setTimeout(function () {
      var body = document.querySelector('[data-mpp-field="body"]');
      if (body) body.setAttribute('data-ready', 'true');
    }, 50);
  </script>
</body>
</html>`;
}

export interface FixtureServer {
  /** 启动本地 HTTP 服务器,提供 /<platformId> 页面。 */
  start(): Promise<FixtureServerHandle>;
}

/** 创建平台 fixture HTTP 服务器(监听 127.0.0.1 随机端口)。 */
export function createFixtureServer(): FixtureServer {
  let server: Server | undefined;

  const start = (): Promise<FixtureServerHandle> =>
    new Promise((resolveServer) => {
      server = createServer((req, res) => {
        let pathname: string;
        try {
          pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
        } catch {
          res.writeHead(400);
          res.end();
          return;
        }
        const platformId = pathname.replace(/^\//, "").replace(/\/$/, "");
        if (platformId.length === 0) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>mpp platform fixtures</h1>");
          return;
        }
        const options: FixturePageOptions = {
          withDraftButton: req.url?.includes("no-draft") ? false : true,
          publishResult: req.url?.includes("unknown") ? "unknown" : "true",
          csp: req.url?.includes("csp") ? "default-src 'self'" : undefined,
          title: req.url?.includes("title=") ? undefined : undefined,
        };
        const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8" };
        if (options.csp) headers["Content-Security-Policy"] = options.csp;
        res.writeHead(200, headers);
        res.end(fixtureHtml(platformId, options));
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        const port = typeof address === "object" && address !== null ? address.port : 0;
        resolveServer({
          server: server!,
          port,
          baseUrl: `http://127.0.0.1:${port}`,
          close: () =>
            new Promise<void>((res) => {
              server?.close(() => res());
            }),
        });
      });
    });

  return { start };
}
