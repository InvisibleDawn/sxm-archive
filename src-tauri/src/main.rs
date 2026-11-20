// SXM Archive — commandes Tauri. La logique (et ses tests) est dans engine.rs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod files;
mod system;
mod update;

use engine::{begin_operation, cleanup_temp, Done, EResult, Engine, EngineError, Listing};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

static ENGINE: OnceLock<Engine> = OnceLock::new();
/// Une seule opération lourde à la fois.
static BUSY: AtomicBool = AtomicBool::new(false);

fn eng() -> EResult<&'static Engine> {
    ENGINE.get().ok_or_else(|| EngineError::new("ENGINE_MISSING", "7-Zip non initialisé"))
}

/// Réponse envoyée à l'interface : la valeur, ou `{ error, detail }`.
#[derive(Serialize)]
#[serde(untagged)]
enum Res<T: Serialize> {
    Ok(T),
    Err { error: String, detail: String },
}
impl<T: Serialize> From<EResult<T>> for Res<T> {
    fn from(r: EResult<T>) -> Self {
        match r {
            Ok(v) => Res::Ok(v),
            Err(e) => Res::Err { error: e.code, detail: e.detail },
        }
    }
}

struct BusyGuard;
impl BusyGuard {
    fn take() -> EResult<Self> {
        if BUSY.swap(true, Ordering::SeqCst) {
            return Err(EngineError::new("BUSY", ""));
        }
        begin_operation();
        Ok(BusyGuard)
    }
}
impl Drop for BusyGuard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}

/// Exécute une opération lourde hors du fil principal, avec progression vers l'interface.
async fn heavy<T, F>(app: AppHandle, f: F) -> Res<T>
where
    T: Serialize + Send + 'static,
    F: FnOnce(&Engine, &(dyn Fn(u32) + Sync)) -> EResult<T> + Send + 'static,
{
    let r = tauri::async_runtime::spawn_blocking(move || {
        let _g = BusyGuard::take()?;
        let e = eng()?;
        let emit = |v: u32| {
            let _ = app.emit("progress", v.min(100));
        };
        f(e, &emit)
    })
    .await
    .unwrap_or_else(|e| Err(EngineError::new("ENGINE_ERROR", e.to_string())));
    r.into()
}

fn pw(p: &Option<String>) -> Option<&str> {
    p.as_deref().filter(|s| !s.is_empty())
}

// ======================= commandes =======================

#[tauri::command]
async fn list(file: String, password: Option<String>) -> Res<Listing> {
    tauri::async_runtime::spawn_blocking(move || eng().and_then(|e| e.list(&file, pw(&password))))
        .await
        .unwrap_or_else(|e| Err(EngineError::new("ENGINE_ERROR", e.to_string())))
        .into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractReq {
    file: String,
    dest: String,
    #[serde(default)]
    members: Vec<String>,
    password: Option<String>,
    /// « Extraire ici » : crée un dossier libre (« nom », « nom (2) »…) à côté de l'archive.
    #[serde(default)]
    unique_dest: bool,
}

#[tauri::command]
async fn extract(app: AppHandle, req: ExtractReq) -> Res<Done> {
    heavy(app, move |e, p| {
        let mut dest = PathBuf::from(&req.dest);
        if req.unique_dest {
            let parent = dest.parent().map(Path::to_path_buf).unwrap_or_default();
            let stem = dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "archive".into());
            dest = engine::unique_path(&parent, &stem, "");
        }
        e.extract(&req.file, &dest, &req.members, pw(&req.password), Some(p))
    })
    .await
}

#[derive(Deserialize)]
struct TestReq {
    file: String,
    password: Option<String>,
}

#[tauri::command]
async fn test(app: AppHandle, req: TestReq) -> Res<Done> {
    heavy(app, move |e, p| e.test(&req.file, pw(&req.password), Some(p))).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompressReq {
    files: Vec<String>,
    out: String,
    format: String,
    level: u32,
    password: Option<String>,
    #[serde(default)]
    encrypt_names: bool,
    #[serde(default)]
    overwrite: bool,
}

#[tauri::command]
async fn compress(app: AppHandle, req: CompressReq) -> Res<Done> {
    heavy(app, move |e, p| {
        e.compress(&req.files, &req.out, &req.format, req.level, pw(&req.password), req.encrypt_names, req.overwrite, Some(p))
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConvertReq {
    file: String,
    password: Option<String>,
    out: String,
    format: String,
    level: u32,
    new_password: Option<String>,
    #[serde(default)]
    overwrite: bool,
}

#[tauri::command]
async fn convert(app: AppHandle, req: ConvertReq) -> Res<Done> {
    heavy(app, move |e, p| {
        e.convert(&req.file, pw(&req.password), &req.out, &req.format, req.level, pw(&req.new_password), req.overwrite, Some(p))
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemberReq {
    file: String,
    member: String,
    password: Option<String>,
    #[serde(default)]
    allow_dangerous: bool,
}

#[tauri::command]
async fn open_member(app: AppHandle, req: MemberReq) -> Res<Done> {
    heavy(app, move |e, _| {
        let p = e.extract_member(&req.file, &req.member, pw(&req.password), req.allow_dangerous)?;
        system::open_file(&p).map_err(|x| EngineError::new("OPEN_FAILED", x))?;
        Ok(Done { ok: true, out: Some(p.display().to_string()), warnings: vec![] })
    })
    .await
}

#[tauri::command]
fn cancel() {
    engine::cancel();
}

#[derive(Serialize)]
struct Stat {
    dir: bool,
    size: u64,
    exists: bool,
}

#[tauri::command]
fn stat(path: String) -> Stat {
    match std::fs::metadata(&path) {
        Ok(m) => Stat { dir: m.is_dir(), size: m.len(), exists: true },
        Err(_) => Stat { dir: false, size: 0, exists: false },
    }
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    platform: String,
    engine: String,
    publisher: String,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.into(),
        engine: "7-Zip 25.01".into(),
        publisher: "Invisible_Dawn".into(),
    }
}

fn files_from_args(args: &[String]) -> Vec<String> {
    args.iter().skip(1).filter(|a| !a.starts_with('-') && Path::new(a).exists()).cloned().collect()
}

/// Fichiers passés au lancement (double-clic, clic droit « Compresser avec SXM Archive »).
#[tauri::command]
fn startup_args() -> Vec<String> {
    files_from_args(&std::env::args().collect::<Vec<_>>())
}

fn main() {
    // dossiers temporaires de plus de 24 h laissés par une session précédente
    std::thread::spawn(|| cleanup_temp(Duration::from_secs(24 * 3600)));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            let files = files_from_args(&argv);
            if !files.is_empty() {
                let _ = app.emit("sxm-args", files);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let exe = if cfg!(windows) { "7z.exe" } else { "7zz" };
            let mut p = app.path().resource_dir().unwrap_or_default().join("bin").join(exe);
            if !p.exists() && cfg!(debug_assertions) {
                // mode développement uniquement : src-tauri/bin
                p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(exe);
            }
            let _ = ENGINE.set(Engine { seven: p });
            #[cfg(target_os = "macos")]
            system::mac_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list,
            extract,
            test,
            compress,
            convert,
            open_member,
            cancel,
            stat,
            app_info,
            startup_args,
            system::open_dir,
            system::reveal,
            system::open_external,
            system::pin_app,
            update::update_check,
            update::update_install
        ])
        .on_menu_event(|app, ev| {
            if ev.id().as_ref() == "sxm-quit" {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("erreur au démarrage de SXM Archive")
        .run(|_app, ev| {
            if let tauri::RunEvent::Exit = ev {
                engine::cancel();
            }
        });
}
