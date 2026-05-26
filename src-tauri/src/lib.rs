use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct PythonBackend(Mutex<Option<Child>>);

fn project_root() -> String {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let dev_root = std::path::Path::new(manifest_dir).parent().unwrap();
    if dev_root.join("backend").exists() {
        return dev_root.to_string_lossy().to_string();
    }
    std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

fn backend_binary_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;

    let name = if cfg!(windows) {
        "bizsync-backend.exe"
    } else {
        "bizsync-backend"
    };

    // 1. Same directory as Tauri binary (Windows / Linux AppImage)
    let path = exe_dir.join(name);
    if path.exists() {
        return Some(path);
    }

    // 2. ../Resources/ (macOS .app bundle)
    if let Some(resources) = exe_dir.parent().map(|p| p.join("Resources").join(name)) {
        if resources.exists() {
            return Some(resources);
        }
    }

    // 3. Current working directory
    let cwd = std::env::current_dir().ok()?.join(name);
    if cwd.exists() {
        return Some(cwd);
    }

    None
}

fn start_python_backend() -> Option<Child> {
    // Production: use PyInstaller bundle if available
    if let Some(bin) = backend_binary_path() {
        println!("Starting backend from: {}", bin.display());
        match Command::new(&bin)
            .env("BIZSYNC_DESKTOP", "1")
            .spawn()
        {
            Ok(child) => {
                println!("Backend started from bundle (PID: {})", child.id());
                return Some(child);
            }
            Err(e) => {
                eprintln!("Failed to start bundled backend: {}", e);
            }
        }
    }

    // Dev mode: use Python from source tree
    let python = if cfg!(windows) { "python" } else { "python3" };
    let root = project_root();
    println!("Starting Python backend from: {}", root);

    match Command::new(&python)
        .args(["-m", "backend.main"])
        .current_dir(&root)
        .env("BIZSYNC_DESKTOP", "1")
        .spawn()
    {
        Ok(child) => {
            println!("Python backend dev started (PID: {})", child.id());
            Some(child)
        }
        Err(e) => {
            eprintln!("Failed to start Python backend: {}", e);
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let python_child = start_python_backend();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            if let Some(child) = python_child {
                app.manage(PythonBackend(Mutex::new(Some(child))));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<PythonBackend>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(ref mut child) = *guard {
                            let _ = child.kill();
                            println!("Python backend stopped");
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
