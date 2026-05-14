#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env, fs,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use tauri::{Manager, Window, WindowEvent};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_fs::FsExt;

struct SidecarState(Mutex<Option<Child>>);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDialogFilter {
    name: String,
    extensions: Vec<String>,
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(format!("path does not exist: {}", target.display()));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", target.display()))
            .spawn()
            .map_err(|err| format!("failed to open Explorer: {err}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()
            .map_err(|err| format!("failed to reveal file in Finder: {err}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = target.parent().unwrap_or(&target);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|err| format!("failed to open file directory: {err}"))?;
    }

    Ok(())
}

#[tauri::command]
async fn confirm_desktop_action<R: tauri::Runtime>(
    window: Window<R>,
    message: String,
    title: String,
) -> Result<bool, String> {
    let mut dialog = window
        .dialog()
        .message(message)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "继续".to_string(),
            "取消".to_string(),
        ))
        .kind(MessageDialogKind::Warning);
    #[cfg(desktop)]
    {
        dialog = dialog.parent(&window);
    }
    if !title.trim().is_empty() {
        dialog = dialog.title(title);
    }
    Ok(dialog.blocking_show())
}

#[tauri::command]
async fn pick_save_path<R: tauri::Runtime>(
    window: Window<R>,
    title: String,
    default_path: String,
    filters: Vec<SaveDialogFilter>,
) -> Result<Option<String>, String> {
    let mut dialog_builder = window.dialog().file();
    #[cfg(desktop)]
    {
        dialog_builder = dialog_builder.set_parent(&window);
    }
    if !title.trim().is_empty() {
        dialog_builder = dialog_builder.set_title(title);
    }
    if !default_path.trim().is_empty() {
        dialog_builder = set_save_dialog_default_path(dialog_builder, PathBuf::from(default_path));
    }
    for filter in filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(|s| s.as_str()).collect();
        dialog_builder = dialog_builder.add_filter(filter.name, &extensions);
    }

    let Some(file_path) = dialog_builder.blocking_save_file() else {
        return Ok(None);
    };

    let target_path = file_path
        .into_path()
        .map_err(|err| format!("failed to resolve selected save path: {err}"))?;
    if let Some(scope) = window.try_fs_scope() {
        scope
            .allow_file(&target_path)
            .map_err(|err| format!("failed to grant fs scope for selected path: {err}"))?;
    }
    let tauri_scope = window.state::<tauri::scope::Scopes>();
    tauri_scope
        .allow_file(&target_path)
        .map_err(|err| format!("failed to grant runtime scope for selected path: {err}"))?;
    Ok(Some(target_path.display().to_string()))
}

#[tauri::command]
async fn pick_open_file<R: tauri::Runtime>(
    window: Window<R>,
    title: String,
    filters: Vec<SaveDialogFilter>,
) -> Result<Option<String>, String> {
    let mut dialog_builder = window.dialog().file();
    #[cfg(desktop)]
    {
        dialog_builder = dialog_builder.set_parent(&window);
    }
    if !title.trim().is_empty() {
        dialog_builder = dialog_builder.set_title(title);
    }
    for filter in filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(|s| s.as_str()).collect();
        dialog_builder = dialog_builder.add_filter(filter.name, &extensions);
    }

    let Some(file_path) = dialog_builder.blocking_pick_file() else {
        return Ok(None);
    };

    let selected_path = file_path
        .into_path()
        .map_err(|err| format!("failed to resolve selected file path: {err}"))?;
    if let Some(scope) = window.try_fs_scope() {
        scope
            .allow_file(&selected_path)
            .map_err(|err| format!("failed to grant fs scope for selected file: {err}"))?;
    }
    let tauri_scope = window.state::<tauri::scope::Scopes>();
    tauri_scope
        .allow_file(&selected_path)
        .map_err(|err| format!("failed to grant runtime scope for selected file: {err}"))?;
    Ok(Some(selected_path.display().to_string()))
}

#[tauri::command]
fn launch_installer_and_exit(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
    path: String,
) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(format!("installer does not exist: {}", target.display()));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(&target)
            .spawn()
            .map_err(|err| format!("failed to start installer: {err}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|err| format!("failed to start installer: {err}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|err| format!("failed to start installer: {err}"))?;
    }

    stop_sidecar(&state.0);
    app.exit(0);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            confirm_desktop_action,
            get_app_version,
            reveal_in_folder,
            launch_installer_and_exit,
            pick_save_path,
            pick_open_file
        ])
        .setup(|app| {
            app.manage(SidecarState(Mutex::new(None)));

            if is_dev_runtime() {
                return Ok(());
            }

            let (child, port) = match spawn_sidecar(app.handle()) {
                Ok(value) => value,
                Err(message) => {
                    show_startup_error(app.handle(), &message);
                    return Err(Box::new(to_setup_error(message)));
                }
            };
            let state = app.state::<SidecarState>();
            if let Ok(mut guard) = state.0.lock() {
                *guard = Some(child);
            }

            let url = format!("http://127.0.0.1:{port}/v3/workbench");
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| to_setup_error("missing main window"))?;
            window.eval(&format!("window.location.replace({url:?});"))?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::CloseRequested { .. }) {
                let state = window.app_handle().state::<SidecarState>();
                stop_sidecar(&state.0);
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Aindexer V4 desktop shell");
}

fn is_dev_runtime() -> bool {
    cfg!(debug_assertions)
}

fn spawn_sidecar<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(Child, u16), String> {
    let port = pick_unused_port()?;
    let (sidecar_path, sidecar_dir) = resolve_sidecar_path(app)?;
    let backend_dir = resolve_backend_dir(&sidecar_dir);
    let data_dir = resolve_data_dir()?;
    ensure_data_dir_writable(&data_dir)?;

    let mut command = Command::new(&sidecar_path);
    command
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--data-dir")
        .arg(&data_dir)
        .current_dir(&sidecar_dir)
        .env("APP_HOST", "127.0.0.1")
        .env("APP_PORT", port.to_string())
        .env("AINDEXER_DATA_DIR", &data_dir)
        .env("AINDEXER_RUNTIME_ROOT", &sidecar_dir)
        .env("AINDEXER_BACKEND_ROOT", &backend_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn().map_err(|err| {
        format!(
            "failed to start sidecar {} from {}: {err}",
            sidecar_path.display(),
            sidecar_dir.display()
        )
    })?;

    wait_for_port(&mut child, "127.0.0.1", port, Duration::from_secs(30))?;
    Ok((child, port))
}

fn stop_sidecar(state: &Mutex<Option<Child>>) {
    let Ok(mut guard) = state.lock() else {
        return;
    };
    let Some(mut child) = guard.take() else {
        return;
    };
    let _ = child.kill();
    let _ = child.wait();
}

fn wait_for_port(
    child: &mut Child,
    host: &str,
    port: u16,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(status) = child
            .try_wait()
            .map_err(|err| format!("failed to inspect sidecar process: {err}"))?
        {
            return Err(format!("sidecar exited before startup completed: {status}"));
        }

        if TcpStream::connect((host, port)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }

    let _ = child.kill();
    Err(format!(
        "sidecar did not open {host}:{port} within {timeout:?}"
    ))
}

fn pick_unused_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|err| format!("failed to reserve a local port: {err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("failed to read reserved local port: {err}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn resolve_backend_dir(sidecar_dir: &Path) -> PathBuf {
    if let Ok(path) = env::var("AINDEXER_BACKEND_ROOT") {
        return PathBuf::from(path);
    }

    if let Ok(path) = env::var("AINDEXER_BACKEND_DIR") {
        return PathBuf::from(path);
    }

    sidecar_dir.join("_internal").join("backend")
}

fn resolve_sidecar_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(PathBuf, PathBuf), String> {
    if let Ok(path) = env::var("AINDEXER_SIDECAR_PATH") {
        let sidecar_path = PathBuf::from(path);
        let sidecar_dir = sidecar_path.parent().ok_or_else(|| {
            format!(
                "failed to resolve sidecar directory from override path {}",
                sidecar_path.display()
            )
        })?
        .to_path_buf();
        return Ok((sidecar_path, sidecar_dir));
    }

    let sidecar_name = sidecar_binary_name();
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|err| format!("failed to resolve Tauri resource dir: {err}"))?;

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "failed to resolve repository root from Cargo manifest".to_string())?;

    let candidates = [
        resource_dir.join("sidecar").join(sidecar_name),
        repo_root
            .join("dist")
            .join("desktop-v4-sidecar")
            .join("aindexer-sidecar")
            .join(sidecar_name),
    ];

    for candidate in candidates {
        if candidate.exists() {
            let sidecar_dir = candidate
                .parent()
                .ok_or_else(|| format!("failed to resolve sidecar dir for {}", candidate.display()))?
                .to_path_buf();
            return Ok((candidate, sidecar_dir));
        }
    }

    Err(format!(
        "sidecar executable not found; looked under {} and {}",
        resource_dir.join("sidecar").display(),
        repo_root
            .join("dist")
            .join("desktop-v4-sidecar")
            .join("aindexer-sidecar")
            .display()
    ))
}

fn resolve_data_dir() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("AINDEXER_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }

    if let Some(base) = env::var_os("LOCALAPPDATA") {
        return Ok(PathBuf::from(base).join("Aindexer").join("v4").join("data"));
    }

    if let Some(base) = env::var_os("APPDATA") {
        return Ok(PathBuf::from(base).join("Aindexer").join("v4").join("data"));
    }

    if let Some(home) = env::var_os("HOME") {
        return Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("aindexer-v4")
            .join("data"));
    }

    Err("failed to resolve a default desktop data directory".to_string())
}

fn ensure_data_dir_writable(data_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|err| {
        format_data_dir_error(
            data_dir,
            format!("无法创建数据目录：{err}"),
        )
    })?;

    let probe_path = data_dir.join(".aindexer-write-test");
    fs::write(&probe_path, b"ok").map_err(|err| {
        format_data_dir_error(
            data_dir,
            format!("无法写入数据目录：{err}"),
        )
    })?;
    let _ = fs::remove_file(&probe_path);
    Ok(())
}

fn set_save_dialog_default_path<R: tauri::Runtime>(
    mut dialog_builder: FileDialogBuilder<R>,
    default_path: PathBuf,
) -> FileDialogBuilder<R> {
    if default_path.is_file() || !default_path.exists() {
        if let (Some(parent), Some(file_name)) = (default_path.parent(), default_path.file_name()) {
            if parent.components().count() > 0 {
                dialog_builder = dialog_builder.set_directory(parent);
            }
            dialog_builder.set_file_name(file_name.to_string_lossy())
        } else {
            dialog_builder.set_directory(default_path)
        }
    } else {
        dialog_builder.set_directory(default_path)
    }
}

fn format_data_dir_error(data_dir: &Path, detail: String) -> String {
    format!(
        "Aindexer 无法启动，因为桌面版默认数据目录不可写：{}\n\n{}\n\n当前安装版默认把数据保存在用户本地数据目录中（Windows 下通常为 LOCALAPPDATA\\Aindexer\\v4\\data）。请确认当前账号对该目录有写权限，或显式设置 AINDEXER_DATA_DIR 到一个可写路径。",
        data_dir.display(),
        detail,
    )
}

fn show_startup_error<R: tauri::Runtime>(app: &tauri::AppHandle<R>, message: &str) {
    app.dialog()
        .message(message)
        .title("Aindexer 启动失败")
        .kind(MessageDialogKind::Error)
        .blocking_show();
}

fn to_setup_error(message: impl Into<String>) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Other, message.into())
}

#[cfg(target_os = "windows")]
fn sidecar_binary_name() -> &'static str {
    "aindexer-sidecar.exe"
}

#[cfg(not(target_os = "windows"))]
fn sidecar_binary_name() -> &'static str {
    "aindexer-sidecar"
}
