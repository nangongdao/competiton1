/**
 * 首屏开场 —— 折射光谱。
 *
 * 极简主义巨幅排印:以「一份内容 · 四重光谱」点题产品核心,
 * 大字号实验性字体 + 光谱渐变 + 字母逐个浮入动画,
 * 点击任意处或等待数秒后以翻卷动画退场,进入创作台。
 */
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

export function IntroOverlay({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const timer = useRef<number | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const dismiss = () => {
    if (leaving) return;
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      setGone(true);
      doneRef.current();
    }, 720);
  };

  useEffect(() => {
    // 尊重 prefers-reduced-motion:用户偏好减弱动效时跳过开场动画。
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      dismiss();
      return;
    }
    const auto = window.setTimeout(dismiss, 4600);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(auto);
      if (timer.current !== null) window.clearTimeout(timer.current);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;

  return (
    <div
      className={leaving ? "intro-overlay leaving" : "intro-overlay"}
      onClick={dismiss}
      role="presentation"
    >
      <div className="intro-skip" aria-hidden>
        <span>点击进入创作台</span>
        <ArrowRight size={16} />
      </div>

      <div className="intro-inner" onClick={(e) => e.stopPropagation()}>
        <div className="intro-kicker">
          <Sparkles size={14} aria-hidden />
          MULTI-PLATFORM PUBLISHING STUDIO
        </div>
        <h1 className="intro-title" aria-label="一份内容，折射四重光谱">
          <span className="intro-line">
            <span className="intro-word">一份内容</span>
          </span>
          <span className="intro-line">
            <span className="intro-word intro-word-accent">折射四重光谱</span>
          </span>
        </h1>
        <p className="intro-sub">
          微信公众号 · 知乎 · B站 · 小红书 · 掘金 · CSDN —— 一次编写，处处绽放
        </p>
        <button type="button" className="btn btn-primary btn-lg intro-cta" onClick={dismiss}>
          进入创作台
          <ArrowRight size={18} aria-hidden />
        </button>
      </div>

      <div className="intro-index" aria-hidden>
        <span>01</span>
        <span>02</span>
        <span>03</span>
        <span>04</span>
      </div>
    </div>
  );
}
