/**
 * 极光粒子背景 —— Canvas 实时渲染。
 *
 * 在浏览器画布上漂浮一组柔光粒子,粒子间按距离连线形成星网,
 * 并随鼠标产生轻微的斥力 / 引力扰动,营造沉浸式数字星域。
 * 监听 prefers-reduced-motion 自动降级为静态粒子。
 */
import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
  alpha: number;
  pulse: number;
  pulseSpeed: number;
}

const COLORS = ["124,108,255", "34,211,238", "251,114,153", "251,191,36"];

/**
 * 设备性能粗估:根据硬件并发度与内存推断动画密度系数。
 * 4 核以下 → 0.5;8 核以下 → 0.75;否则 1(封顶,不放大)。
 */
function estimatePerfScore(): number {
  try {
    const hw = navigator.hardwareConcurrency ?? 4;
    if (hw <= 4) return 0.5;
    if (hw <= 8) return 0.75;
    return 1;
  } catch {
    return 0.75;
  }
}

export function AuroraCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let raf = 0;
    let particles: Particle[] = [];
    const mouse = { x: -9999, y: -9999 };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 自适应粒子密度:视口越小、设备越弱,粒子越少,降低低端机 GPU/CPU 负担。
    const perfScore = estimatePerfScore();

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      init();
    };

    const init = () => {
      // 视口面积自适应 + 设备能力修正(弱设备减半,强设备放宽到 80)。
      const area = width * height;
      let count = Math.floor(area / 26000);
      count = Math.min(80, Math.max(24, count));
      count = Math.round(count * perfScore);
      particles = Array.from({ length: count }, () => spawn(true));
    };

    const spawn = (anywhere = false): Particle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      r: anywhere ? 1 + Math.random() * 2.2 : 1 + Math.random() * 2.2,
      hue: Math.floor(Math.random() * COLORS.length),
      alpha: 0.25 + Math.random() * 0.5,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.004 + Math.random() * 0.012,
    });

    const LINK_DIST = 150;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        // 鼠标附近轻微斥力
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist2 = dx * dx + dy * dy;
        const repelR = 140;
        if (dist2 < repelR * repelR && dist2 > 0.01) {
          const d = Math.sqrt(dist2);
          const force = ((repelR - d) / repelR) * 0.6;
          p.vx += (dx / d) * force * 0.08;
          p.vy += (dy / d) * force * 0.08;
        }

        // 物理运动 + 速度阻尼
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.995;
        p.vy *= 0.995;
        p.pulse += p.pulseSpeed;

        // 回绕边界(留出边缘余量)
        const m = 8;
        if (p.x < -m) p.x = width + m;
        if (p.x > width + m) p.x = -m;
        if (p.y < -m) p.y = height + m;
        if (p.y > height + m) p.y = -m;
      }

      // 连线
      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK_DIST) {
            const opacity = (1 - dist / LINK_DIST) * 0.14;
            ctx.strokeStyle = `rgba(150,150,220,${opacity.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // 粒子(呼吸发光)
      for (const p of particles) {
        const breath = 0.7 + Math.sin(p.pulse) * 0.3;
        const a = Math.min(1, p.alpha * breath);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.2);
        grad.addColorStop(0, `rgba(${COLORS[p.hue]},${a.toFixed(3)})`);
        grad.addColorStop(1, `rgba(${COLORS[p.hue]},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);

    resize();

    if (reduceMotion) {
      // 降级:只渲染一帧静态星网
      cancelAnimationFrame(raf);
      draw();
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="canvas-aurora" aria-hidden />;
}
