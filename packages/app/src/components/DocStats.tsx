/**
 * DocStats —— 实时文档统计与平台字数限制预警。
 *
 * 左侧:字数 / 段落 / 图片 / 预估阅读时长;
 * 右侧:对每个已选平台展示「当前字数 / 上限」,超出或接近上限时高亮预警。
 * 新增:字数目标进度条(用户可设定目标字数)与打字机模式开关。
 * 全部为纯展示/偏好组件,不持有业务状态。
 */
import { useMemo, useState } from "react";
import { Type, Pilcrow, Image as ImageIcon, Clock, AlertTriangle, Target, TextCursorInput, ChevronDown, ChevronRight } from "lucide-react";
import { getAdapter } from "@mpp/core";
import { platformColor } from "./platform-meta.js";

interface Props {
  markdown: string;
  selectedPlatforms: string[];
  wordGoal?: number;
  typewriterMode?: boolean;
  onWordGoalChange?: (goal: number) => void;
  onTypewriterModeChange?: (on: boolean) => void;
}

interface Stats {
  chars: number;
  paragraphs: number;
  images: number;
  readMinutes: number;
}

/** 提取纯文本(去掉 markdown 语法)用于字数统计。 */
export function plainTextOf(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .trim();
}

export function deriveDocStats(markdown: string): Stats {
  const text = plainTextOf(markdown);
  const chars = [...text].length;
  const body = text
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0)
    .map((p) => p.trim());
  if (body.length > 0 && /^#{1,6}\s/.test(markdown.trimStart())) body.shift();
  const paragraphs = body.length;
  const images = (markdown.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).length;
  const readMinutes = Math.max(1, Math.round(chars / 400));
  return { chars, paragraphs, images, readMinutes };
}

export function DocStats({ markdown, selectedPlatforms, wordGoal = 0, typewriterMode = false, onWordGoalChange, onTypewriterModeChange }: Props) {
  const stats = useMemo(() => deriveDocStats(markdown), [markdown]);
  const [showPlatformLimits, setShowPlatformLimits] = useState(false);

  const platformRows = useMemo(() => {
    return selectedPlatforms.map((id) => {
      const adapter = getAdapter(id);
      const limit = adapter?.capabilities.limits.bodyMax;
      const titleLimit = adapter?.capabilities.limits.titleMax;
      const countByGrapheme = adapter?.capabilities.countByGrapheme;
      return { id, name: adapter?.name ?? id, limit, titleLimit, countByGrapheme };
    });
  }, [selectedPlatforms]);

  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const nearOrOver = platformRows.filter((r) => r.limit !== undefined && stats.chars >= r.limit * 0.9);

  return (
    <div className="doc-stats" aria-label="文档统计">
      <span className="doc-stat" title="正文字数(不含 Markdown 语法)">
        <Type size={12} aria-hidden />
        {stats.chars} 字
      </span>
      <span className="doc-stat" title="段落数">
        <Pilcrow size={12} aria-hidden />
        {stats.paragraphs} 段
      </span>
      <span className="doc-stat" title="图片数">
        <ImageIcon size={12} aria-hidden />
        {stats.images} 图
      </span>
      <span className="doc-stat" title="预估阅读时长">
        <Clock size={12} aria-hidden />
        约 {stats.readMinutes} 分钟
      </span>

      {wordGoal > 0 ? (
        <span className="doc-stat doc-stat-goal" title="目标字数进度">
          <Target size={12} aria-hidden />
          目标 {Math.min(stats.chars, wordGoal)}/{wordGoal}
          <button
            type="button"
            className="goal-clear"
            onClick={() => onWordGoalChange?.(0)}
            aria-label="清除字数目标"
            title="清除字数目标"
          >
            ×
          </button>
        </span>
      ) : (
        onWordGoalChange && (
          <span className="doc-stat doc-stat-goal-set" title="设定目标字数">
            <Target size={12} aria-hidden />
            <input
              type="number"
              min={0}
              step={100}
              placeholder="目标"
              className="goal-input"
              aria-label="设定目标字数"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = Number.parseInt((e.target as HTMLInputElement).value, 10);
                  if (Number.isFinite(v) && v > 0) onWordGoalChange(v);
                }
              }}
              onBlur={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(v) && v > 0) onWordGoalChange(v);
              }}
            />
          </span>
        )
      )}

      <span className="doc-stat doc-stat-typewriter" title={typewriterMode ? "关闭打字机模式" : "开启打字机模式(当前行居中高亮)"}>
        <label className="typewriter-toggle">
          <input type="checkbox" checked={typewriterMode} onChange={(e) => onTypewriterModeChange?.(e.target.checked)} />
          <TextCursorInput size={12} aria-hidden />
          打字机
        </label>
      </span>

      {/* 平台字数限制：默认折叠，点击展开。有超限/接近超限时显示警示图标。 */}
      {platformRows.length > 0 && (
        <span className="doc-stat doc-stat-platforms">
          <button
            type="button"
            className="platform-limits-toggle"
            onClick={() => setShowPlatformLimits((v) => !v)}
            aria-expanded={showPlatformLimits}
          >
            {showPlatformLimits ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
            平台限制
            {nearOrOver.length > 0 && (
              <span className="platform-limits-warning" title="有平台字数超限或接近上限">
                <AlertTriangle size={11} aria-hidden />
                {nearOrOver.length}
              </span>
            )}
          </button>
          {showPlatformLimits && (
            <span className="platform-limits-list" aria-label="平台字数限制明细">
              {platformRows.map((row) => {
                const isNear = row.limit !== undefined && stats.chars >= row.limit * 0.9;
                const isOver = row.limit !== undefined && stats.chars > row.limit;
                const cls = isOver ? "over" : isNear ? "near" : "";
                const titleLimitNote =
                  row.titleLimit !== undefined && title.length > row.titleLimit
                    ? `,标题 ${title.length}/${row.titleLimit} 超出`
                    : "";
                return (
                  <span
                    key={row.id}
                    className={`doc-platform-limit ${cls}`}
                    style={{ ["--chip-color" as string]: platformColor(row.id) }}
                    title={`${row.name} 字数上限${row.limit ?? "—"}:当前 ${stats.chars}${titleLimitNote}`}
                  >
                    {isOver && <AlertTriangle size={11} aria-hidden />}
                    {row.name} {stats.chars}/{row.limit ?? "∞"}
                  </span>
                );
              })}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
