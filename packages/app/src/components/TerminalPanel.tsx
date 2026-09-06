/**
 * 内置终端面板 —— xterm.js + Tauri Rust 侧 portable-pty。
 *
 * 仅在桌面(Tauri)环境渲染;通过 bridge 的 spawn/write/close 与本地子进程会话通信,
 * stdout/stderr 经 Tauri 事件流逐行推送,由 xterm 实时渲染。
 * 渲染加速:优先 WebglAddon,不可用时(如软件渲染环境)自动回退 Canvas/DOM。
 */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { Square, Play, Loader2, CircleSlash } from "lucide-react";
import type { TauriBridge, DesktopTerminalCommandId } from "../bridge/tauri-bridge.js";

const CMD_OPTIONS = [
  { id: "server", label: "server · 本地服务(图床/公众号)" },
  { id: "runner", label: "runner · Playwright 自动化" },
] as const;

interface Props {
  bridge: TauriBridge;
  /** 明暗主题,用于切换 xterm 配色。 */
  theme: "light" | "dark";
}

export function TerminalPanel({ bridge, theme }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const glRef = useRef<WebglAddon | null>(null);
  const unlistenOutRef = useRef<(() => void) | undefined>(undefined);
  const unlistenExitRef = useRef<(() => void) | undefined>(undefined);
  const sessionRef = useRef<string | null>(null);

  const [running, setRunning] = useState(false);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cmd, setCmd] = useState<DesktopTerminalCommandId>("server");

  // 初始化 xterm(仅一次)。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontSize: 12,
      lineHeight: 1.35,
      fontFamily: '"SF Mono","JetBrains Mono",Consolas,Menlo,monospace',
      cursorBlink: true,
      theme: darkTheme(theme),
      allowProposedApi: true,
      scrollback: 4000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    fit.fit();

    // 渲染加速:WebGL → 失败回退。
    try {
      const gl = new WebglAddon();
      term.loadAddon(gl);
      glRef.current = gl;
    } catch {
      glRef.current = null;
    }

    termRef.current = term;
    fitRef.current = fit;

    // 调整尺寸(窗口缩放 / 面板折叠)。
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* 容器不可见时忽略 */
      }
    });
    ro.observe(container);

    term.onData((data) => {
      const sid = sessionRef.current;
      if (!sid) return;
      void bridge.writeTerminal(sid, data).catch(() => undefined);
    });

    // 订阅输出/退出事件。
    void bridge.onTerminalOutput((line) => {
      term.writeln(line);
    }).then((u) => (unlistenOutRef.current = u));
    void bridge.onTerminalExit((sessionId) => {
      if (sessionRef.current === sessionId) {
        term.writeln("\x1b[90m── 进程已结束 ──\x1b[0m");
        sessionRef.current = null;
        setRunning(false);
      }
    }).then((u) => (unlistenExitRef.current = u));

    return () => {
      ro.disconnect();
      unlistenOutRef.current?.();
      unlistenExitRef.current?.();
      glRef.current?.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题切换时更新配色。
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = darkTheme(theme);
  }, [theme]);

  // 切换会话颜色提示。
  useEffect(() => {
    termRef.current?.writeln("\x1b[90m── 多平台发布工具 · 内置终端 ──\x1b[0m");
  }, []);

  const startSession = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const sid = await bridge.spawnTerminal(cmd);
      sessionRef.current = sid;
      setSessionLabel(cmd);
      setRunning(true);
      termRef.current?.writeln(`\x1b[90m$ 启动 ${cmd} …\x1b[0m`);
    } catch (err) {
      termRef.current?.writeln(`\x1b[31m启动失败:${err instanceof Error ? err.message : String(err)}\x1b[0m`);
    } finally {
      setBusy(false);
    }
  };

  const stopSession = async () => {
    const sid = sessionRef.current;
    if (!sid) return;
    await bridge.closeTerminal(sid);
    sessionRef.current = null;
    setRunning(false);
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <span className="terminal-title">
          <CircleSlash size={13} aria-hidden />
          内置终端
        </span>
        <div className="terminal-actions">
          <select
            className="terminal-cmd-select"
            value={cmd}
            disabled={running}
            onChange={(e) => setCmd(e.target.value as DesktopTerminalCommandId)}
            aria-label="选择要启动的本地服务"
          >
            {CMD_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {running ? (
            <button type="button" className="btn btn-sm" onClick={() => void stopSession()}>
              <Square size={12} aria-hidden />
              停止
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void startSession()}>
              {busy ? <Loader2 size={12} className="spinner" aria-hidden /> : <Play size={12} aria-hidden />}
              启动
            </button>
          )}
        </div>
      </div>
      <div className="terminal-body" ref={containerRef} />
      {sessionLabel && <div className="terminal-status">会话: {sessionLabel}</div>}
    </div>
  );
}

function darkTheme(theme: "light" | "dark") {
  return theme === "dark"
    ? {
        background: "#0d0e12",
        foreground: "#e7e9ec",
        cursor: "#8d8df3",
        selectionBackground: "#4343b0",
      }
    : {
        background: "#ffffff",
        foreground: "#1a1d21",
        cursor: "#4f4fc7",
        selectionBackground: "#c9c9f7",
      };
}
