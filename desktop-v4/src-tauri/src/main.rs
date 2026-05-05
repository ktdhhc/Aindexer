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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(SidecarState(Mutex::new(None)));

            if is_dev_runtime() {
                return Ok(());
            }

            let (child, port) = spawn_sidecar().map_err(to_setup_error)?;
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

fn spawn_sidecar() -> Result<(Child, u16), String> {
    let port = pick_unused_port()?;
    let backend_dir = resolve_backend_dir()?;
    let data_dir = resolve_data_dir()?;
    fs::create_dir_all(&data_dir)
        .map_err(|err| format!("failed to create data dir {}: {err}", data_dir.display()))?;

    let python = env::var("AINDEXER_PYTHON").unwrap_or_else(|_| "python".to_string());
    let mut command = Command::new(python);
    command
        .arg("desktop_v4_sidecar.py")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--data-dir")
        .arg(&data_dir)
        .current_dir(&backend_dir)
        .env("APP_HOST", "127.0.0.1")
        .env("APP_PORT", port.to_string())
        .env("AINDEXER_DATA_DIR", &data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let mut child = command.spawn().map_err(|err| {
        format!(
            "failed to start Python sidecar from {}: {err}",
            backend_dir.display()
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

fn resolve_backend_dir() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("AINDEXER_BACKEND_DIR") {
        return Ok(PathBuf::from(path));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "failed to resolve repository root from Cargo manifest".to_string())?;
    Ok(repo_root.join("backend"))
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
