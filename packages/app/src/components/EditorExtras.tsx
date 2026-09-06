import { type ChangeEvent, useMemo, useEffect, useState, memo } from "react";
import { ImagePlus, Download } from "lucide-react";
import { buildCoverSpec, markdownToIR } from "@mpp/core";
import { renderCoverToDataUrl } from "../render/cover-canvas-renderer.js";
import { platformColor } from "./platform-meta.js";

interface Adapter {
  id: string;
  name: string;
}

/** 本地图片选择器:选图 → FileReader 转 dataURL → 回调插入正文。 */
export function ImagePicker({ onPick }: { onPick: (dataUrl: string, alt: string) => void }) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (dataUrl) onPick(dataUrl, file.name.replace(/\.[^.]+$/, ""));
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  return (
    <label className="btn">
      <ImagePlus size={16} aria-hidden />
      插入本地图片
      <input type="file" accept="image/*" onChange={onChange} hidden />
    </label>
  );
}

/** 平台分类:图文内容平台 vs 短视频内容平台。 */
const TEXT_PLATFORMS = new Set(["wechat", "zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn"]);
const VIDEO_PLATFORMS = new Set(["weibo", "toutiao", "douyin", "kuaishou", "shipinhao"]);

/**
 * 平台多选 chip 行 —— 按「图文平台」与「视频平台」分组,
 * 弱化非选中态色彩饱和度,选中态才突出平台色。
 */
export const PlatformChips = memo(function PlatformChips({
  adapters,
  selected,
  onToggle,
}: {
  adapters: readonly Adapter[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const textPlats = adapters.filter((a) => TEXT_PLATFORMS.has(a.id));
  const videoPlats = adapters.filter((a) => VIDEO_PLATFORMS.has(a.id));

  return (
    <div className="platform-toggles-wrap">
      <div className="platform-group-label">图文平台</div>
      <div className="platform-toggles" role="group" aria-label="选择图文目标平台">
        {textPlats.map((a) => {
          const active = selected.includes(a.id);
          return (
            <label
              key={a.id}
              className={active ? "chip active" : "chip"}
              style={{ ["--chip-color" as string]: platformColor(a.id) }}
            >
              <input type="checkbox" checked={active} onChange={() => onToggle(a.id)} />
              <span className="chip-dot" aria-hidden />
              {a.name}
            </label>
          );
        })}
      </div>
      <div className="platform-group-label">视频/动态平台</div>
      <div className="platform-toggles" role="group" aria-label="选择视频目标平台">
        {videoPlats.map((a) => {
          const active = selected.includes(a.id);
          return (
            <label
              key={a.id}
              className={active ? "chip active" : "chip"}
              style={{ ["--chip-color" as string]: platformColor(a.id) }}
            >
              <input type="checkbox" checked={active} onChange={() => onToggle(a.id)} />
              <span className="chip-dot" aria-hidden />
              {a.name}
            </label>
          );
        })}
      </div>
    </div>
  );
})

/** 小红书封面卡片预览(Canvas 生成)。 */
export function CoverPreview({
  markdown,
  authorName,
  tags,
}: {
  markdown: string;
  authorName: string;
  tags: string[];
}) {
  const tagsKey = tags.join("\u0001");
  const [debounced, setDebounced] = useState(markdown);
  // 封面 Canvas 生成较重:输入期间防抖 300ms 再重算,避免每键触发全量重绘。
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(markdown), 300);
    return () => clearTimeout(timer);
  }, [markdown]);
  const dataUrl = useMemo(() => {
    try {
      const { document } = markdownToIR(markdown, { meta: { authorName, tags } });
      const spec = buildCoverSpec(document, { ratio: "3:4" });
      return renderCoverToDataUrl(spec);
    } catch {
      return "";
    }
    // tags 用 tagsKey 派生稳定依赖,避免数组每次新引用导致缓存失效。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, authorName, tagsKey]);
  if (!dataUrl) return null;
  return (
    <div className="cover-preview">
      <div className="cover-preview-thumb">
        <img src={dataUrl} alt="自动生成的小红书封面预览" />
      </div>
      <div className="cover-preview-info">
        <span className="cover-preview-title">自动封面 · 小红书 3:4</span>
        <a className="btn btn-ghost btn-sm" href={dataUrl} download="cover.png">
          <Download size={14} aria-hidden />
          下载 PNG
        </a>
      </div>
    </div>
  );
}
