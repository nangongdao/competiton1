//! 多平台内容发布工具 — 桌面端 Rust 桥。
//!
//! 职责:
//! - 承载 Tauri 2 桌面窗口(摆脱浏览器启动)。
//! - 通过 `portable-pty` 在应用内启动/管理本地子进程(server / runner / 用户命令),
//!   把 stdout/stderr 以事件流推送前端,由 xterm.js 渲染为终端。
//! - 系统托盘一键入口:单击托盘图标唤起窗口并通知前端打开对应功能面板
//!   (内容日历 / 复盘报告 / AI 自动完成)。
//! - 全局快捷键(CmdOrCtrl+Shift+A 打开 AI 自动完成、CmdOrCtrl+Shift+C 打开内容日历、
//!   CmdOrCtrl+Shift+R 打开复盘报告):任意应用内/外触发同一入口。
//!
//! 安全边界:
//! - 所有命令仅在 `main` 的 `invoke_handler` 中注册,不暴露任意 shell。
//! - 命令名由白名单 `COMMANDS` 限定,拒绝未注册命令。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// 前端可启动的本地命令白名单(命令名 → 可执行文件 + 启动参数)。
/// 复用仓库根脚本(npm run server / npm run runner),会自动完成依赖包编译后常驻。
/// 子进程 cwd 统一设为应用启动时的工作目录(项目根)。
const COMMANDS: &[(&str, &str, &[&str])] = &[
    ("server", "npm", &["run", "server"]),
    ("runner", "npm", &["run", "runner"]),
];

/// 会话状态:持有 Pty 主端 + 写端 + 子进程句柄 + 读取线程退出标记。
struct TermSession {
    _pty: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
    done: Arc<Mutex<bool>>,
}

/// 请求体:启动/关闭一个终端会话。
#[derive(serde::Deserialize)]
struct SpawnRequest {
    /// 命令名,必须是 COMMANDS 白名单之一。
    name: String,
    /// 传递给命令的附加参数(透传,通常为空)。
    args: Vec<String>,
}

/// 单条输出行。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OutputLine {
    line: String,
    stream: &'static str,
}

type Sessions = Arc<Mutex<HashMap<String, TermSession>>>;

/// 读取主端输出并持续推送到前端事件。
fn pump_output(
    mut reader: Box<dyn Read + Send>,
    app: AppHandle,
    session_id: String,
    done: Arc<Mutex<bool>>,
) {
    let mut buf = [0u8; 4096];
    let mut carry: Vec<u8> = Vec::new();
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                carry.extend_from_slice(&buf[..n]);
                while let Some(pos) = carry.iter().position(|&b| b == b'\n') {
                    let raw = String::from_utf8_lossy(&carry[..pos]).to_string();
                    let line = if raw.ends_with('\r') {
                        raw[..raw.len() - 1].to_string()
                    } else {
                        raw
                    };
                    let _ = app.emit(
                        "term://output",
                        OutputLine { line, stream: "stdout" },
                    );
                    carry.drain(..=pos);
                }
            }
            Err(_) => break,
        }
    }
    if !carry.is_empty() {
        let line = String::from_utf8_lossy(&carry).to_string();
        let _ = app.emit("term://output", OutputLine { line, stream: "stdout" });
    }
    *done.lock().unwrap() = true;
    let _ = app.emit("term://exit", session_id);
}

/// 启动一个白名单命令的 Pty 会话。
#[tauri::command]
fn spawn_terminal(
    app: AppHandle,
    sessions: State<'_, Sessions>,
    req: SpawnRequest,
) -> Result<String, String> {
    let Some((_, exe, base_args)) = COMMANDS.iter().find(|(name, _, _)| *name == req.name) else {
        return Err(format!("未知命令: {}", req.name));
    };

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("无法创建 PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(exe);
    for a in base_args {
        cmd.arg(*a);
    }
    for a in &req.args {
        cmd.arg(a);
    }
    // 子进程从应用启动时的工作目录启动(项目根,含 packages/server 等)。
    cmd.cwd(std::env::current_dir().unwrap_or_default());

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("启动命令失败: {e}"))?;
    drop(pair.slave);

    let session_id = format!(
        "{}-{}",
        req.name,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let done = Arc::new(Mutex::new(false));
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("无法读取输出: {e}"))?;
    let writer = pair.master.take_writer().map_err(|e| format!("无法获取写端: {e}"))?;

    sessions
        .lock()
        .unwrap()
        .insert(
            session_id.clone(),
            TermSession {
                _pty: pair.master,
                writer,
                _child: child,
                done: done.clone(),
            },
        );

    // 输出线程:非阻塞,避免阻塞 command 返回。
    let app2 = app.clone();
    let id2 = session_id.clone();
    std::thread::spawn(move || pump_output(reader, app2, id2, done));

    Ok(session_id)
}

/// 向指定会话的 Pty 写一行(供 xterm 输入)。
#[tauri::command]
fn write_terminal(
    sessions: State<'_, Sessions>,
    session_id: String,
    input: String,
) -> Result<(), String> {
    let mut sessions = sessions.lock().unwrap();
    let Some(session) = sessions.get_mut(&session_id) else {
        return Err("会话不存在或已结束".into());
    };
    let _ = session.writer.write_all(input.as_bytes());
    let _ = session.writer.flush();
    Ok(())
}

/// 关闭会话:结束子进程并清理。
#[tauri::command]
fn close_terminal(
    app: AppHandle,
    sessions: State<'_, Sessions>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = sessions.lock().unwrap();
    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session._child.kill();
        drop(session.writer);
        drop(session._pty);
    }
    let _ = app.emit("term://exit", session_id);
    Ok(())
}

/// 获取应用版本(用于 UI 显示)。
#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// 本地共享库文件路径(桌面端 FileSharedStore 接入):`<app_data_dir>/shared-items.json`。
fn shared_store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建应用数据目录: {e}"))?;
    Ok(dir.join("shared-items.json"))
}

/// 读取本地共享库文件(不存在返回空字符串,由前端按空库处理)。
#[tauri::command]
fn shared_local_read(app: AppHandle) -> Result<String, String> {
    let path = shared_store_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => Ok(raw),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("读取本地共享库失败: {e}")),
    }
}

/// 原子写入本地共享库文件(先写临时文件再 rename,崩溃不产生半写文件)。
#[tauri::command]
fn shared_local_write(app: AppHandle, raw: String) -> Result<(), String> {
    let path = shared_store_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, raw).map_err(|e| format!("写入本地共享库失败: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("落盘本地共享库失败: {e}"))?;
    Ok(())
}

/// 系统通知 —— 发布/任务完成时唤起系统级提醒(v6 NOTIFY-01)。
///
/// 实现:跨平台优先调用 `notify-send`(Linux)/`osascript`(macOS)/
/// `powershell`(Windows),失败静默返回(通知是尽力而为,不阻塞业务)。
/// `action` 为可选的桌面面板动作(如 "publish-queue" / "publish-batch"):
/// 在 Linux 通知正文附加跳转提示;桌面端点击跳转由 Web 端 Notification.onclick 分发
/// `mpp:notification-click` 事件、或托盘/快捷键通道完成(不同桌面平台对通知点击回调支持不一,
/// 此处为尽力而为)。
#[tauri::command]
fn show_notification(title: String, body: String, action: Option<String>) -> Result<(), String> {
    let has_action = action.as_deref().map(|a| !a.is_empty()).unwrap_or(false);
    let status = if cfg!(target_os = "macos") {
        // macOS:osascript 弹系统通知。
        std::process::Command::new("osascript")
            .args([
                "-e",
                &format!(
                    "display notification {body:?} with title {title:?}"
                ),
            ])
            .status()
    } else if cfg!(target_os = "windows") {
        // Windows:PowerShell 弹 toast(尽力而为)。
        let script = format!(
            "New-BurntToastNotification -Text '{title}', '{body}'"
        );
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .status()
    } else {
        // Linux:notify-send(不支持点击回调,仅在 action 存在时附加跳转提示)。
        let body_text = if has_action {
            format!("{body}\n(点击通知回到应用查看详情)")
        } else {
            body
        };
        std::process::Command::new("notify-send")
            .args([&title, &body_text])
            .status()
    };
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err("通知发送失败".to_string()),
        Err(e) => Err(format!("通知不可用: {e}")),
    }
}

/// 唤起主窗口并聚焦(托盘/快捷键共用)。
fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 前端功能面板动作(与前端 TauriBridge 的 DesktopEvent 动作一一对应)。
#[derive(Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum AppEventAction {
    /// 打开「AI 自动完成」面板。
    AiAgent,
    /// 打开「内容日历」面板。
    Calendar,
    /// 打开「复盘报告」面板。
    Report,
    /// 打开「命令面板」面板。
    CommandPalette,
    /// v4:打开「账号管理」面板。
    Accounts,
    /// v4 Phase 3:打开「协作共享」面板。
    Collab,
    /// v5:打开「发布队列」面板(托盘一键排入队列入口)。
    PublishQueue,
    /// v6 Phase 2:打开「发布批次」面板(托盘一键入口)。
    PublishBatch,
    /// v7 Phase 2:创作快捷操作 —— 复制 Markdown。
    CreatorCopy,
    /// v7 Phase 2:创作快捷操作 —— 导出 .md。
    CreatorExport,
    /// v7 Phase 2:创作快捷操作 —— 保存草稿。
    CreatorSave,
    /// v7 Phase 2:创作快捷操作 —— 清空内容。
    CreatorClear,
}

impl AppEventAction {
    fn as_str(self) -> &'static str {
        match self {
            AppEventAction::AiAgent => "ai-agent",
            AppEventAction::Calendar => "calendar",
            AppEventAction::Report => "report",
            AppEventAction::CommandPalette => "command-palette",
            AppEventAction::Accounts => "accounts",
            AppEventAction::Collab => "collab",
            AppEventAction::PublishQueue => "publish-queue",
            AppEventAction::PublishBatch => "publish-batch",
            AppEventAction::CreatorCopy => "creator-copy",
            AppEventAction::CreatorExport => "creator-export",
            AppEventAction::CreatorSave => "creator-save",
            AppEventAction::CreatorClear => "creator-clear",
        }
    }
}

/// 托盘/快捷键统一入口:唤起窗口并通知前端打开指定功能面板。
///
/// 事件名统一为 `desktop://app-event`,载荷为动作字符串,由前端 TauriBridge 订阅分发。
fn open_app_panel(app: &AppHandle, action: AppEventAction) {
    show_main_window(app);
    let _ = app.emit("desktop://app-event", action.as_str());
}

/// 注册系统托盘图标(单左键唤起 + v3/v4 功能中心菜单项)。
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开主窗口", true, None::<&str>)?;
    // v3 功能中心:与前端抽屉一一对应。
    let ai = MenuItem::with_id(app, "ai-agent", "AI 自动完成", true, None::<&str>)?;
    let calendar = MenuItem::with_id(app, "calendar", "内容日历", true, None::<&str>)?;
    let report = MenuItem::with_id(app, "report", "发布复盘报告", true, None::<&str>)?;
    let palette = MenuItem::with_id(app, "command-palette", "命令面板", true, None::<&str>)?;
    // v4 功能中心:账号管理(多账号平台管理)。
    let accounts = MenuItem::with_id(app, "accounts", "账号管理", true, None::<&str>)?;
    // v4 Phase 3:协作共享(局域网共享 / 共享包)。
    let collab = MenuItem::with_id(app, "collab", "协作共享", true, None::<&str>)?;
    // v5:发布队列(一键把当前草稿排入队列,复用 AI 自动排期建议)。
    let publish_queue = MenuItem::with_id(app, "publish-queue", "发布队列", true, None::<&str>)?;
    // v6 Phase 2:发布批次(托盘一键入口)。
    let publish_batch = MenuItem::with_id(app, "publish-batch", "发布批次", true, None::<&str>)?;
    // v7 Phase 2:创作快捷操作(与创作快捷操作条 CreatorQuickActions 对齐)。
    let creator_copy = MenuItem::with_id(app, "creator-copy", "复制 Markdown", true, None::<&str>)?;
    let creator_export = MenuItem::with_id(app, "creator-export", "导出 .md", true, None::<&str>)?;
    let creator_save = MenuItem::with_id(app, "creator-save", "保存草稿", true, None::<&str>)?;
    let creator_clear = MenuItem::with_id(app, "creator-clear", "清空内容", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("退出"))?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &sep,
            &ai,
            &calendar,
            &report,
            &palette,
            &accounts,
            &collab,
            &publish_queue,
            &publish_batch,
            &sep2,
            &creator_copy,
            &creator_export,
            &creator_save,
            &creator_clear,
            &sep,
            &quit,
        ],
    )?;

    let mut tray_builder = TrayIconBuilder::with_id("mpp-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "ai-agent" => open_app_panel(app, AppEventAction::AiAgent),
            "calendar" => open_app_panel(app, AppEventAction::Calendar),
            "report" => open_app_panel(app, AppEventAction::Report),
            "command-palette" => open_app_panel(app, AppEventAction::CommandPalette),
            "accounts" => open_app_panel(app, AppEventAction::Accounts),
            "collab" => open_app_panel(app, AppEventAction::Collab),
            "publish-queue" => open_app_panel(app, AppEventAction::PublishQueue),
            "publish-batch" => open_app_panel(app, AppEventAction::PublishBatch),
            // v7 Phase 2:创作快捷操作 —— 唤起窗口并通知前端执行对应动作。
            "creator-copy" => open_app_panel(app, AppEventAction::CreatorCopy),
            "creator-export" => open_app_panel(app, AppEventAction::CreatorExport),
            "creator-save" => open_app_panel(app, AppEventAction::CreatorSave),
            "creator-clear" => open_app_panel(app, AppEventAction::CreatorClear),
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            // 左键单击:唤起窗口;右键:弹出菜单(默认行为)。
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_app_panel(tray.app_handle(), AppEventAction::AiAgent);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }
    let _tray = tray_builder.build(app)?;

    // 保持托盘实例存活(生命周期与 App 一致)。
    app.manage(TrayKeepAlive(_tray));
    Ok(())
}

/// 注册全局快捷键(与前端快捷键一致):
/// - Cmd/Ctrl+Shift+A → AI 自动完成
/// - Cmd/Ctrl+Shift+C → 内容日历
/// - Cmd/Ctrl+Shift+R → 复盘报告
fn setup_global_shortcut(app: &AppHandle) -> tauri::Result<()> {
    // macOS 用 Cmd(SUPER),其余平台用 Ctrl,与前端 Ctrl/Cmd+Shift+* 语义对齐。
    let mods = if cfg!(target_os = "macos") {
        Modifiers::SUPER | Modifiers::SHIFT
    } else {
        Modifiers::CONTROL | Modifiers::SHIFT
    };

    let bindings: &[(&str, Code, AppEventAction)] = &[
        ("mpp-ai-agent", Code::KeyA, AppEventAction::AiAgent),
        ("mpp-calendar", Code::KeyC, AppEventAction::Calendar),
        ("mpp-report", Code::KeyR, AppEventAction::Report),
        ("mpp-accounts", Code::KeyM, AppEventAction::Accounts),
        ("mpp-collab", Code::KeyS, AppEventAction::Collab),
        ("mpp-publish-queue", Code::KeyQ, AppEventAction::PublishQueue),
        // v6 Phase 2:发布批次(托盘一键入口 + 全局快捷键)。
        ("mpp-publish-batch", Code::KeyB, AppEventAction::PublishBatch),
    ];
    for (id, code, action) in bindings {
        let shortcut = Shortcut::new(Some(mods), *code);
        let action = *action;
        app.global_shortcut().on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                open_app_panel(app, action);
            }
        })?;
        // 注册成功则记录(便于排查;注册失败不阻塞其它键位)。
        let _ = id;
    }
    Ok(())
}

/// 托盘实例持有者(防被 Drop 后托盘消失)。
struct TrayKeepAlive(tauri::tray::TrayIcon);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sessions: Sessions = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(sessions)
        .setup(|app| {
            // 系统托盘(左键唤起 + 一键 AI 自动完成菜单)。
            let _ = setup_tray(app.handle());
            // 全局快捷键:Cmd/Ctrl+Shift+A → AI 自动完成。
            let _ = setup_global_shortcut(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            spawn_terminal,
            write_terminal,
            close_terminal,
            app_version,
            shared_local_read,
            shared_local_write,
            show_notification
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
