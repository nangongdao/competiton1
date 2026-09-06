/**
 * UI 沉浸式组件测试(随 Awwwards UI 重构引入)。
 *
 * 覆盖:
 * - platform-meta:七平台品牌颜色与 Lucide 图标映射、未知平台回退;
 * - IntroOverlay:开场动画展示 / 点击进入 / 键盘 Esc 跳过 / reduced-motion 自动跳过;
 * - AuroraCanvas:canvas 元素渲染并声明 aria-hidden;
 * - CursorGlow:辉光元素渲染并声明 aria-hidden,触屏/减少动效时不挂载逻辑。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { IntroOverlay } from "../src/components/IntroOverlay.js";
import { AuroraCanvas } from "../src/components/AuroraCanvas.js";
import { CursorGlow } from "../src/components/CursorGlow.js";
import { platformColor, platformIcon } from "../src/components/platform-meta.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("platform-meta — 平台品牌元数据", () => {
  it("七平台均有颜色 token", () => {
    for (const id of ["wechat", "zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn"]) {
      expect(platformColor(id)).toMatch(/^var\(--brand-/);
    }
  });

  it("未知平台回退 accent", () => {
    expect(platformColor("unknown-platform")).toBe("var(--accent)");
  });

  it("七平台均有 Lucide 图标组件,未知平台回退 Send", () => {
    for (const id of ["wechat", "zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn"]) {
      expect(typeof platformIcon(id)).toBe("object");
    }
    // 未知平台回退为 Send 图标组件(可渲染)。
    const Icon = platformIcon("nope");
    expect(Icon).toBeTruthy();
    expect(() => render(<Icon size={16} />)).not.toThrow();
  });
});

describe("IntroOverlay — 首屏开场", () => {
  it("渲染标题与进入按钮", () => {
    render(<IntroOverlay onDone={() => undefined} />);
    expect(screen.getByText("折射四重光谱")).toBeTruthy();
    expect(screen.getByRole("button", { name: /进入创作台/ })).toBeTruthy();
  });

  it("点击进入按钮触发 onDone 并退场", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<IntroOverlay onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: /进入创作台/ }));
    // 退场动画 720ms 后触发 onDone。
    vi.advanceTimersByTime(800);
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("键盘 Escape 可跳过开场", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<IntroOverlay onDone={onDone} />);
    fireEvent.keyDown(window, { key: "Escape" });
    vi.advanceTimersByTime(800);
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("prefers-reduced-motion 时立即跳过", () => {
    vi.useFakeTimers();
    const mql = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.spyOn(window, "matchMedia").mockReturnValue(mql as unknown as MediaQueryList);
    const onDone = vi.fn();
    render(<IntroOverlay onDone={onDone} />);
    vi.advanceTimersByTime(800);
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("AuroraCanvas — 极光粒子背景", () => {
  it("渲染 canvas 且声明 aria-hidden", () => {
    // jsdom 无真实 canvas 2d context,退化不应抛错。
    render(<AuroraCanvas />);
    const canvas = document.querySelector("canvas.canvas-aurora");
    expect(canvas).toBeTruthy();
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("CursorGlow — 鼠标辉光", () => {
  it("渲染辉光元素且声明 aria-hidden", () => {
    // jsdom matchMedia 默认无 pointer:coarse 匹配,组件应安全挂载。
    render(<CursorGlow />);
    const el = document.querySelector(".cursor-glow");
    expect(el).toBeTruthy();
    expect(el?.getAttribute("aria-hidden")).toBe("true");
  });
});
