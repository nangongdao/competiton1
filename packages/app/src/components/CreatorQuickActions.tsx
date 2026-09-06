/**
 * CreatorQuickActions —— 创作快捷操作条(v7 创作工作流)。
 *
 * 在编辑区统计条下方提供轻量高频操作:
 * - 复制 Markdown(纯文本到剪贴板);
 * - 导出当前草稿(.md 下载);
 * - v7 Phase 3:导出 HTML(.html 下载,markdown-it 渲染 + 基础阅读样式);
 * - 清空内容(带二次确认);
 * - 保存草稿(手动强制)。
 *
 * 纯展示 + 交互组件:全部通过回调与 App/store 解耦;使用 toast 反馈结果。
 */
import { useRef, useState } from "react";
import { Copy, Download, FileCode2, Eraser, Save, Check } from "lucide-react";
import MarkdownIt from "markdown-it";
import { toast } from "./toast.js";

interface Props {
  /** 当前 Markdown。 */
  markdown: string;
  /** 当前草稿标题(用于导出文件名)。 */
  draftTitle: string;
  /** 手动保存。 */
  onSave: () => void;
  /** 清空内容。 */
  onClear: () => void;
}

function safeDownload(name: string, content: string, mime = "text/markdown"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(title: string, ext = ".md"): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, "_").trim() || "未命名草稿";
  return `${cleaned.slice(0, 60)}${ext}`;
}

/** 用 markdown-it 渲染 HTML 文档(含基础阅读样式)。 */
function renderHtmlDocument(markdown: string, title: string): string {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  const body = md.render(markdown);
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;") || "未命名草稿";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 720px; margin: 0 auto; padding: 24px 16px; line-height: 1.75; color: #1f2328; }
  h1, h2, h3, h4 { line-height: 1.4; margin: 1.2em 0 0.6em; }
  img { max-width: 100%; height: auto; border-radius: 8px; }
  pre { background: #f6f8fa; border-radius: 8px; padding: 12px 16px; overflow-x: auto; }
  code { background: #f6f8fa; border-radius: 4px; padding: 0.1em 0.4em; font-size: 0.92em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #d0d7de; margin: 0; padding: 0 1em; color: #57606a; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d0d7de; padding: 6px 12px; }
  a { color: #0969da; }
</style>
</head>
<body>\n${body}\n</body>
</html>\n`;
}

export function CreatorQuickActions({ markdown, draftTitle, onSave, onClear }: Props) {
  const [confirming, setConfirming] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);

  const doCopy = async () => {
    if (!markdown) {
      toast("没有可复制的内容", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
      toast("已复制 Markdown 到剪贴板", "success");
    } catch {
      toast("复制失败:当前环境不允许访问剪贴板", "error");
    }
  };

  const doExport = () => {
    if (!markdown.trim()) {
      toast("没有可导出的内容", "info");
      return;
    }
    safeDownload(safeFilename(draftTitle), markdown);
    toast("已导出 .md 文件", "success");
  };

  // v7 Phase 3:导出 HTML(markdown-it 渲染 + 基础阅读样式)。
  const doExportHtml = () => {
    if (!markdown.trim()) {
      toast("没有可导出的内容", "info");
      return;
    }
    safeDownload(safeFilename(draftTitle, ".html"), renderHtmlDocument(markdown, draftTitle), "text/html");
    toast("已导出 HTML 文件", "success");
  };

  const doClear = () => {
    if (!confirming) {
      setConfirming(true);
      toast("再次点击「清空」确认清空当前内容", "info");
      return;
    }
    setConfirming(false);
    onClear();
    toast("已清空编辑器内容", "success");
  };

  return (
    <div className="creator-actions" aria-label="创作快捷操作">
      <button type="button" className="ca-btn" onClick={() => void doCopy()} aria-label="复制 Markdown" title="复制 Markdown">
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        {copied ? "已复制" : "复制"}
      </button>
      <button type="button" className="ca-btn" onClick={doExport} aria-label="导出 .md" title="导出当前草稿为 .md 文件">
        <Download size={13} aria-hidden />
        导出
      </button>
      <button type="button" className="ca-btn" onClick={doExportHtml} aria-label="导出 HTML" title="导出为 HTML 阅读页面">
        <FileCode2 size={13} aria-hidden />
        导出 HTML
      </button>
      <button type="button" className="ca-btn" onClick={() => onSave()} aria-label="保存草稿" title="立即保存 (Ctrl/Cmd+S)">
        <Save size={13} aria-hidden />
        保存
      </button>
      <button type="button" className={`ca-btn ca-btn-danger ${confirming ? "ca-btn-confirm" : ""}`} onClick={doClear} aria-label="清空内容" title="清空当前内容">
        <Eraser size={13} aria-hidden />
        {confirming ? "确认清空?" : "清空"}
      </button>
    </div>
  );
}
