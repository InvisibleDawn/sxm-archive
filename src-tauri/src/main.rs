// SXM Archive — moteur (Rust) : pilote 7-Zip embarqué (7z.exe + 7z.dll sous Windows, 7zz sous Linux).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static SEVEN: OnceLock<PathBuf> = OnceLock::new();
const NO_PW: &str = "-pSXM_NO_PASSWORD";

fn seven() -> &'static Path {
    SEVEN.get().expect("7-Zip non initialisé")
}

fn cmd(args: &[String], cwd: Option<&Path>) -> Command {
    let mut c = Command::new(seven());
    c.args(args);
    if let Some(d) = cwd {
        c.current_dir(d);
    }
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

struct Out {
    code: i32,
    out: String,
    err: String,
}

/// Lance 7-Zip, remonte la progression (« 42% ») à l'interface.
fn run(app: Option<&AppHandle>, args: Vec<String>, cwd: Option<&Path>, scale: (u32, u32)) -> Out {
    let mut full = args;
    full.extend(["-bsp1", "-bb0", "-y", "-sccUTF-8"].iter().map(|s| s.to_string()));
    let mut child = match cmd(&full, cwd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(c) => c,
        Err(e) => return Out { code: -1, out: String::new(), err: format!("7-Zip introuvable : {e}") },
    };
    let mut stderr = child.stderr.take().unwrap();
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let mut stdout = child.stdout.take().unwrap();
    let mut out = String::new();
    let mut buf = [0u8; 8192];
    while let Ok(n) = stdout.read(&mut buf) {
        if n == 0 {
            break;
        }
        let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
        if let Some(app) = app {
            if let Some(p) = last_percent(&chunk) {
                let _ = app.emit("progress", scale.0 + p * scale.1 / 100);
            }
        }
        out.push_str(&chunk);
    }
    let code = child.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
    Out { code, out, err: err_thread.join().unwrap_or_default() }
}

fn last_percent(s: &str) -> Option<u32> {
    let b = s.as_bytes();
    let mut res = None;
    for (i, &c) in b.iter().enumerate() {
        if c == b'%' {
            let mut j = i;
            while j > 0 && b[j - 1].is_ascii_digit() {
                j -= 1;
            }
            if j < i {
                res = s[j..i].parse().ok();
            }
        }
    }
    res
}

/// .tar.gz : 7z x -so archive | 7z <args> -si -ttar
fn run_tgz(app: Option<&AppHandle>, file: &str, args2: Vec<String>, scale: (u32, u32)) -> Out {
    let p1 = cmd(&["x".into(), "-so".into(), "-bsp2".into(), "-y".into(), file.into()], None)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut p1 = match p1 {
        Ok(p) => p,
        Err(e) => return Out { code: -1, out: String::new(), err: e.to_string() },
    };
    let mut a2 = args2;
    a2.extend(["-si", "-ttar", "-bb0", "-y", "-sccUTF-8"].iter().map(|s| s.to_string()));
    let mut p2 = match cmd(&a2, None).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(p) => p,
        Err(e) => return Out { code: -1, out: String::new(), err: e.to_string() },
    };
    let mut src = p1.stdout.take().unwrap();
    let mut dst = p2.stdin.take().unwrap();
    let pipe = std::thread::spawn(move || {
        let mut buf = vec![0u8; 1 << 16];
        while let Ok(n) = src.read(&mut buf) {
            if n == 0 || dst.write_all(&buf[..n]).is_err() {
                break;
            }
        }
    });
    let mut e1 = p1.stderr.take().unwrap();
    let app2 = app.cloned();
    let prog = std::thread::spawn(move || {
        let mut buf = [0u8; 1024];
        let mut errs = String::new();
        while let Ok(n) = e1.read(&mut buf) {
            if n == 0 {
                break;
            }
            let s = String::from_utf8_lossy(&buf[..n]).to_string();
            match (last_percent(&s), &app2) {
                (Some(p), Some(a)) => {
                    let _ = a.emit("progress", scale.0 + p * scale.1 / 100);
                }
                (None, _) => errs.push_str(&s),
                _ => {}
            }
        }
        errs
    });
    let mut out = String::new();
    let _ = p2.stdout.take().unwrap().read_to_string(&mut out);
    let mut err2 = String::new();
    let _ = p2.stderr.take().unwrap().read_to_string(&mut err2);
    let _ = pipe.join();
    let c1 = p1.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
    let c2 = p2.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
    let errs = prog.join().unwrap_or_default();
    Out { code: c1.max(c2), out, err: errs + &err2 }
}

fn is_tgz(f: &str) -> bool {
    let l = f.to_lowercase();
    l.ends_with(".tar.gz") || l.ends_with(".tgz")
}

fn nice_error(r: &Out) -> String {
    let t = format!("{}\n{}", r.err, r.out);
    let tl = t.to_lowercase();
    if tl.contains("wrong password") || tl.contains("cannot open encrypted") || tl.contains("can not open encrypted") || tl.contains("data error in encrypted") {
        return "PASSWORD".into();
    }
    t.lines()
        .find(|l| l.contains("ERROR") || l.contains("Error"))
        .map(|l| l.trim_start_matches("ERROR:").trim().to_string())
        .unwrap_or_else(|| format!("Erreur inconnue (code {})", r.code))
}

fn pw_arg(password: &Option<String>) -> String {
    match password {
        Some(p) if !p.is_empty() => format!("-p{p}"),
        _ => NO_PW.into(),
    }
}

fn tmp_dir(prefix: &str) -> PathBuf {
    let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let d = std::env::temp_dir().join(format!("{prefix}{n:x}"));
    let _ = fs::create_dir_all(&d);
    d
}

// ================= commandes =================
#[derive(Serialize, Default)]
struct Entry {
    path: String,
    size: u64,
    packed: u64,
    date: String,
    dir: bool,
    encrypted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListResult {
    entries: Vec<Entry>,
    archive_size: u64,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Res<T: Serialize> {
    Ok(T),
    Err { error: String },
}

#[derive(Serialize)]
struct Done {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    out: Option<String>,
}
fn ok() -> Res<Done> {
    Res::Ok(Done { ok: true, out: None })
}
fn fail<T: Serialize>(e: impl Into<String>) -> Res<T> {
    Res::Err { error: e.into() }
}

#[tauri::command]
async fn list(file: String, password: Option<String>) -> Res<ListResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = if is_tgz(&file) {
            run_tgz(None, &file, vec!["l".into(), "-slt".into(), "-ba".into()], (0, 100))
        } else {
            run(None, vec!["l".into(), "-slt".into(), "-ba".into(), file.clone(), pw_arg(&password)], None, (0, 100))
        };
        if r.code != 0 {
            return fail(nice_error(&r));
        }
        let mut entries = Vec::new();
        let mut cur: std::collections::HashMap<String, String> = Default::default();
        let mut push = |cur: &mut std::collections::HashMap<String, String>| {
            if let Some(p) = cur.get("Path") {
                let size = cur.get("Size").and_then(|s| s.parse().ok());
                entries.push(Entry {
                    path: p.replace('\\', "/"),
                    size: size.unwrap_or(0),
                    packed: cur.get("Packed Size").and_then(|s| s.parse().ok()).unwrap_or(0),
                    date: cur.get("Modified").cloned().unwrap_or_default(),
                    dir: cur.get("Folder").map(|f| f == "+").unwrap_or(false)
                        || (cur.get("Attributes").map(|a| a.contains('D')).unwrap_or(false) && size.is_none()),
                    encrypted: cur.get("Encrypted").map(|f| f == "+").unwrap_or(false),
                });
            }
            cur.clear();
        };
        for line in r.out.lines() {
            if line.trim().is_empty() {
                push(&mut cur);
                continue;
            }
            if let Some(i) = line.find(" = ") {
                cur.insert(line[..i].to_string(), line[i + 3..].to_string());
            }
        }
        push(&mut cur);
        let archive_size = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        Res::Ok(ListResult { entries, archive_size })
    })
    .await
    .unwrap_or_else(|e| fail(e.to_string()))
}

#[derive(Deserialize)]
struct ExtractReq {
    file: String,
    dest: String,
    #[serde(default)]
    members: Vec<String>,
    password: Option<String>,
}

#[tauri::command]
async fn extract(app: AppHandle, req: ExtractReq) -> Res<Done> {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = fs::create_dir_all(&req.dest);
        let mut a = vec!["x".to_string()];
        let r = if is_tgz(&req.file) {
            a.push(format!("-o{}", req.dest));
            a.extend(req.members.clone());
            run_tgz(Some(&app), &req.file, a, (0, 100))
        } else {
            a.push(req.file.clone());
            a.push(format!("-o{}", req.dest));
            a.extend(req.members.clone());
            a.push(pw_arg(&req.password));
            run(Some(&app), a, None, (0, 100))
        };
        if r.code <= 1 && r.code >= 0 { Res::Ok(Done { ok: true, out: Some(req.dest) }) } else { fail(nice_error(&r)) }
    })
    .await
    .unwrap_or_else(|e| fail(e.to_string()))
}

#[derive(Deserialize)]
struct TestReq {
    file: String,
    password: Option<String>,
}

#[tauri::command]
async fn test(app: AppHandle, req: TestReq) -> Res<Done> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = if is_tgz(&req.file) {
            run_tgz(Some(&app), &req.file, vec!["t".into()], (0, 100))
        } else {
            run(Some(&app), vec!["t".into(), req.file.clone(), pw_arg(&req.password)], None, (0, 100))
        };
        if r.code == 0 { ok() } else { fail(nice_error(&r)) }
    })
    .await
    .unwrap_or_else(|e| fail(e.to_string()))
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CompressReq {
    files: Vec<String>,
    out: String,
    format: String,
    level: u32,
    password: Option<String>,
    #[serde(default)]
    encrypt_names: bool,
}

fn compress_impl(app: &AppHandle, req: &CompressReq, scale: (u32, u32)) -> Res<Done> {
    if req.files.is_empty() {
        return fail("Aucun fichier à compresser");
    }
    let base = Path::new(&req.files[0]).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let rel: Vec<String> = req
        .files
        .iter()
        .map(|f| Path::new(f).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| f.clone()))
        .collect();
    let _ = fs::remove_file(&req.out);
    let r = if req.format == "tar.gz" {
        let td = tmp_dir("sxm-tar-");
        let name = Path::new(&req.out).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or("archive.tar.gz".into());
        let tar_name = name.trim_end_matches(".gz").trim_end_matches(".tgz").trim_end_matches(".tar").to_string() + ".tar";
        let tar = td.join(tar_name);
        let mut a = vec!["a".to_string(), "-ttar".into(), tar.to_string_lossy().to_string()];
        a.extend(rel.clone());
        let r1 = run(None, a, Some(&base), scale);
        let r = if r1.code == 0 {
            run(
                Some(app),
                vec!["a".into(), "-tgzip".into(), format!("-mx={}", req.level.max(1)), req.out.clone(), tar.to_string_lossy().to_string()],
                None,
                scale,
            )
        } else {
            r1
        };
        let _ = fs::remove_dir_all(&td);
        r
    } else {
        let mut a = vec!["a".to_string(), if req.format == "zip" { "-tzip".into() } else { "-t7z".into() }, format!("-mx={}", req.level), req.out.clone()];
        a.extend(rel);
        if let Some(p) = req.password.as_ref().filter(|p| !p.is_empty()) {
            a.push(format!("-p{p}"));
            if req.format == "zip" {
                a.push("-mem=AES256".into());
            }
            if req.format == "7z" && req.encrypt_names {
                a.push("-mhe=on".into());
            }
        }
        run(Some(app), a, Some(&base), scale)
    };
    if r.code == 0 { Res::Ok(Done { ok: true, out: Some(req.out.clone()) }) } else { fail(nice_error(&r)) }
}

#[tauri::command]
async fn compress(app: AppHandle, req: CompressReq) -> Res<Done> {
    tauri::async_runtime::spawn_blocking(move || compress_impl(&app, &req, (0, 100)))
        .await
        .unwrap_or_else(|e| fail(e.to_string()))
}

#[derive(Deserialize)]
struct ConvertReq {
    file: String,
    password: Option<String>,
    out: String,
    format: String,
    level: u32,
}

#[tauri::command]
async fn convert(app: AppHandle, req: ConvertReq) -> Res<Done> {
    tauri::async_runtime::spawn_blocking(move || {
        let tmp = tmp_dir("sxm-conv-");
        let dest = format!("-o{}", tmp.to_string_lossy());
        let r = if is_tgz(&req.file) {
            run_tgz(Some(&app), &req.file, vec!["x".into(), dest], (0, 50))
        } else {
            run(Some(&app), vec!["x".into(), req.file.clone(), dest, pw_arg(&req.password)], None, (0, 50))
        };
        if !(0..=1).contains(&r.code) {
            let _ = fs::remove_dir_all(&tmp);
            return fail(nice_error(&r));
        }
        let files: Vec<String> = fs::read_dir(&tmp)
            .map(|rd| rd.flatten().map(|e| e.path().to_string_lossy().to_string()).collect())
            .unwrap_or_default();
        let res = if files.is_empty() {
            fail("Archive vide")
        } else {
            compress_impl(&app, &CompressReq { files, out: req.out, format: req.format, level: req.level, password: None, encrypt_names: false }, (50, 50))
        };
        let _ = fs::remove_dir_all(&tmp);
        res
    })
    .await
    .unwrap_or_else(|e| fail(e.to_string()))
}

#[derive(Deserialize)]
struct MemberReq {
    file: String,
    member: String,
    password: Option<String>,
}

#[tauri::command]
async fn open_member(req: MemberReq) -> Res<Done> {
    tauri::async_runtime::spawn_blocking(move || {
        let tmp = tmp_dir("sxm-");
        let dest = format!("-o{}", tmp.to_string_lossy());
        let r = if is_tgz(&req.file) {
            run_tgz(None, &req.file, vec!["x".into(), dest, req.member.clone()], (0, 100))
        } else {
            run(None, vec!["x".into(), req.file.clone(), dest, req.member.clone(), pw_arg(&req.password)], None, (0, 100))
        };
        if r.code != 0 {
            return fail(nice_error(&r));
        }
        match open_path_impl(&tmp.join(&req.member)) {
            Ok(_) => ok(),
            Err(e) => fail(e),
        }
    })
    .await
    .unwrap_or_else(|e| fail(e.to_string()))
}

fn open_path_impl(p: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let r = Command::new("explorer").arg(p).creation_flags(CREATE_NO_WINDOW).spawn();
    #[cfg(target_os = "macos")]
    let r = Command::new("open").arg(p).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = Command::new("xdg-open").arg(p).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    open_path_impl(Path::new(&path))
}

#[tauri::command]
fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let parent = Path::new(&path).parent().unwrap_or(Path::new("/"));
        open_path_impl(parent)
    }
}

#[derive(Serialize)]
struct Stat {
    dir: bool,
    size: u64,
}

#[tauri::command]
fn stat(path: String) -> Option<Stat> {
    fs::metadata(&path).ok().map(|m| Stat { dir: m.is_dir(), size: m.len() })
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    platform: String,
    engine: String,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo { version: app.package_info().version.to_string(), platform: std::env::consts::OS.into(), engine: "7-Zip 25.01".into() }
}

fn files_from_args(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-') && Path::new(a).exists())
        .cloned()
        .collect()
}

#[tauri::command]
fn start_files() -> Vec<String> {
    files_from_args(&std::env::args().collect::<Vec<_>>())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            let files = files_from_args(&argv);
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let res = app.path().resource_dir().unwrap_or_default().join("bin");
            let exe = if cfg!(windows) { "7z.exe" } else { "7zz" };
            let mut p = res.join(exe);
            if !p.exists() {
                // mode développement : src-tauri/bin
                p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(exe);
            }
            let _ = SEVEN.set(p);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list, extract, test, compress, convert, open_member, open_path, show_in_folder, stat, app_info, start_files
        ])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de SXM Archive");
}
