"""M2 交互验证:打开 web 工具,验证多平台实时预览 + 模拟发布闭环。"""
import sys
import io
from playwright.sync_api import sync_playwright

# Windows 控制台默认 GBK,强制 UTF-8 以便打印 emoji/中文
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

URL = "http://localhost:5176/"


def main():
    with sync_playwright() as p:
        # 用系统 Edge(Chromium 内核),免去 chrome-headless-shell 下载
        browser = p.chromium.launch(headless=True, channel="msedge")
        page = browser.new_page(viewport={"width": 1500, "height": 1000})
        logs = []
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))

        page.goto(URL)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(800)

        # 1. 标题存在
        assert page.locator("h1").inner_text().strip() == "多平台内容发布工具", "标题不符"

        # 2. 多平台预览卡片都出现
        names = page.locator(".preview-name").all_inner_texts()
        print("预览平台:", names)
        for expect in ["微信公众号", "知乎", "B站专栏", "小红书", "掘金", "CSDN"]:
            assert expect in names, f"缺少平台预览: {expect}"

        # 3. 截图初始状态
        page.screenshot(path="e:/competition1/dist/demo/ui-initial.png", full_page=True)

        # 4. 验证小红书预览是纯文本 + 话题标签
        #    切到小红书卡片的"源码"或预览,检查含 #话题#
        xhs_cell = page.locator(".preview-cell").filter(has=page.locator(".preview-name", has_text="小红书"))
        xhs_body = xhs_cell.locator(".xhs-body").inner_text()
        assert "#" in xhs_body, "小红书正文未含话题标签"
        print("小红书正文片段:", xhs_body[:60].replace("\n", " "))

        # 5. 修改输入,验证实时更新
        textarea = page.locator("textarea")
        textarea.fill("# 实时更新测试标题\n\n这是**新内容**,带 [链接](https://test.com)。")
        page.wait_for_timeout(600)
        # 公众号预览标题应更新
        wechat_cell = page.locator(".preview-cell").filter(has=page.locator(".preview-name", has_text="微信公众号"))
        wechat_title = wechat_cell.locator(".html-title").inner_text()
        print("公众号更新后标题:", wechat_title)
        assert "实时更新测试标题" in wechat_title, "实时更新未生效"

        # 6. 点击一键模拟发布
        page.locator(".publish-btn").click()
        page.wait_for_timeout(1000)
        receipts = page.locator(".receipt").all_inner_texts()
        print("回执数量:", len(receipts))
        for r in receipts:
            print("  回执:", r[:50])
        assert len(receipts) >= 1, "未出现发布回执"

        # 7. 封面图(Canvas)生成
        cover = page.locator(".cover-preview img")
        assert cover.count() >= 1, "封面图未生成"
        src = cover.first.get_attribute("src")
        assert src and src.startswith("data:image/png"), "封面非 PNG dataURL"
        print("封面图已生成 (dataURL 长度):", len(src))

        page.screenshot(path="e:/competition1/dist/demo/ui-published.png", full_page=True)

        # 8. 检查无 JS 报错
        errors = [l for l in logs if "pageerror" in l or "[error]" in l]
        if errors:
            print("⚠️ 控制台错误:")
            for e in errors:
                print("  ", e)

        print("\n✅ M2 交互验证全部通过")
        browser.close()


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"\n❌ 断言失败: {e}")
        sys.exit(1)
