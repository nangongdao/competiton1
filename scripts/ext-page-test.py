"""M3 验证:扩展产物 dist-ext 的 dedicated tab 页面能否独立渲染。

扩展页 bundle 用绝对路径 /assets/(在 chrome-extension:// 根下正常);
故用静态 HTTP server 以 dist-ext 为根伺服来模拟扩展根,验证产物自洽。
注意:content script 注入目标平台编辑器需真实登录页面,无法在此自动化。
"""
import sys
import io
import functools
import threading
import http.server
import socketserver
from playwright.sync_api import sync_playwright

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DIST_DIR = "e:/competition1/dist-ext"
PORT = 5188


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIST_DIR)
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    httpd.daemon_threads = True
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


def main():
    httpd = serve()
    url = f"http://127.0.0.1:{PORT}/index.html"
    print("伺服扩展产物:", url)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, channel="msedge")
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            logs = []
            page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
            page.goto(url)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(1000)

            # 扩展页应与 web 同一 UI:标题 + 多平台预览
            h1 = page.locator("h1").inner_text().strip()
            print("页面标题:", h1)
            assert h1 == "多平台内容发布工具", "扩展页标题不符"

            names = page.locator(".preview-name").all_inner_texts()
            print("预览平台:", names)
            for expect in ["微信公众号", "知乎", "B站专栏", "小红书"]:
                assert expect in names, f"扩展页缺少平台预览: {expect}"

            # file:// 模拟根下无 chrome.runtime.id → bridge 仍判为 web,页面应显示模式标识
            mode = page.locator(".mode-badge").inner_text() if page.locator(".mode-badge").count() else "(无标识)"
            print("运行模式标识:", mode)

            page.screenshot(path="e:/competition1/dist/demo/ext-page.png", full_page=True)

            errors = [l for l in logs if "pageerror" in l]
            if errors:
                print("页面错误:")
                for e in errors:
                    print("  ", e)
                fatal = [e for e in errors if "chrome is not defined" not in e]
                assert not fatal, f"扩展页有致命错误: {fatal}"

            print("\n✅ M3 扩展产物页面渲染验证通过")
            browser.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"\n❌ 断言失败: {e}")
        sys.exit(1)
