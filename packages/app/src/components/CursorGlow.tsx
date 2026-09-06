/**
 * 鼠标跟随光斑 —— 全局光标辉光。
 *
 * 以 rAF 缓动跟随指针,在编辑 / 预览区上方营造柔和光照氛围,
 * 降低视觉噪感的同时增加纵深。仅在指针激活(非触屏)时启用。
 */
import { useEffect, useRef } from "react";

export function CursorGlow() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 触屏 / 减少动效偏好下不启用
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let x = -200;
    let y = -200;
    let tx = -200;
    let ty = -200;
    let visible = false;

    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!visible) {
        visible = true;
        el.classList.add("visible");
      }
    };
    const onLeave = () => {
      visible = false;
      el.classList.remove("visible");
    };

    const loop = () => {
      x += (tx - x) * 0.09;
      y += (ty - y) * 0.09;
      el.style.transform = `translate(${x - 280}px, ${y - 280}px)`;
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return <div ref={ref} className="cursor-glow" aria-hidden />;
}
