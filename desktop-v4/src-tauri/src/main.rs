use std::{
    env, fs,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, WindowEvent};

struct SidecarState(Mutex<Option<Child>>);

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![reveal_in_folder])
        .setup(|app| {
            app.manage(SidecarState(Mutex::new(None)));

            if is_dev_runtime() {
                return Ok(());
            }

            let (child, port) = spawn_sidecar(app.handle()).map_err(to_setup_error)?;
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
    fs::create_dir_all(&data_dir)
        .map_err(|err| format!("failed to create data dir {}: {err}", data_dir.display()))?;

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
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

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

    let cwd = env::current_dir().map_err(|err| format!("failed to resolve current dir: {err}"))?;
    Ok(cwd.join("data"))
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
