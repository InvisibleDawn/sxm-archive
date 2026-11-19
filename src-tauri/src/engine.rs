//! Moteur SXM Archive : pilote 7-Zip (7z.exe/7z.dll sous Windows, 7zz sous Linux).
//!
//! Principes de sûreté :
//! - aucun fichier existant n'est écrasé sans demande explicite (compression : fichier temporaire
//!   puis renommage ; extraction : les nouveaux fichiers sont renommés, `-aou`) ;
//! - les chemins dangereux (`..`, absolus, lecteurs) sont détectés avant extraction, en plus de la
//!   protection intégrée à 7-Zip ;
//! - les sorties des processus ne sont jamais conservées en entier en mémoire (seule la fin est
//!   gardée pour les messages d'erreur) et stdout/stderr sont lus en parallèle (pas d'interblocage) ;
//! - toute opération peut être annulée ; les dossiers temporaires sont supprimés automatiquement.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Taille maximale conservée de la sortie d'un processus (pour les messages d'erreur).
const TAIL_MAX: usize = 64 * 1024;
const NO_PW: &str = "-pSXM_NO_PASSWORD";

/// Extensions ouvertes uniquement après confirmation (exécutables, scripts, raccourcis…).
pub const DANGEROUS_EXT: &[&str] = &[
    "exe",
    "com",
    "scr",
    "pif",
    "msi",
    "msp",
    "msix",
    "appx",
    "bat",
    "cmd",
    "ps1",
    "psm1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "hta",
    "cpl",
    "lnk",
    "url",
    "reg",
    "jar",
    "dll",
    "sys",
    "inf",
    "chm",
    "application",
    "gadget",
    "iso",
    "img",
    "vhd",
    "vhdx",
    "sh",
    "run",
    "desktop",
    "appimage",
];

pub type Progress<'a> = &'a (dyn Fn(u32) + Sync);

// ======================= erreurs =======================

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EngineError {
    /// Code stable lu par l'interface (PASSWORD_REQUIRED, PASSWORD_WRONG, EXISTS, DANGEROUS…).
    pub code: String,
    /// Détail lisible (message 7-Zip, nom de fichier…).
    pub detail: String,
}

impl EngineError {
    pub fn new(code: &str, detail: impl Into<String>) -> Self {
        Self { code: code.into(), detail: detail.into() }
    }
}

pub type EResult<T> = Result<T, EngineError>;

#[derive(Debug, Default, Serialize)]
pub struct Done {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out: Option<String>,
    /// Avertissements non bloquants (code 7-Zip 1, chemins neutralisés…).
    pub warnings: Vec<String>,
}

// ======================= exécution des processus =======================

static CANCELLED: AtomicBool = AtomicBool::new(false);
static RUNNING: Mutex<Vec<u32>> = Mutex::new(Vec::new());

/// Annule l'opération en cours : tue les processus 7-Zip lancés par l'application.
pub fn cancel() {
    CANCELLED.store(true, Ordering::SeqCst);
    let pids: Vec<u32> = RUNNING.lock().map(|v| v.clone()).unwrap_or_default();
    for pid in pids {
        kill_pid(pid);
    }
}

fn kill_pid(pid: u32) {
    #[cfg(windows)]
    let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(CREATE_NO_WINDOW).output();
    #[cfg(not(windows))]
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
}

struct Tracked(u32);
impl Tracked {
    fn new(c: &Child) -> Self {
        if let Ok(mut v) = RUNNING.lock() {
            v.push(c.id());
        }
        Tracked(c.id())
    }
}
impl Drop for Tracked {
    fn drop(&mut self) {
        if let Ok(mut v) = RUNNING.lock() {
            v.retain(|p| *p != self.0);
        }
    }
}

/// Début d'une opération utilisateur : remet à zéro l'indicateur d'annulation.
pub fn begin_operation() {
    CANCELLED.store(false, Ordering::SeqCst);
}

fn cancelled() -> bool {
    CANCELLED.load(Ordering::SeqCst)
}

/// Tampon qui ne garde que les derniers octets.
#[derive(Default)]
struct Tail(Vec<u8>);
impl Tail {
    fn push(&mut self, b: &[u8]) {
        self.0.extend_from_slice(b);
        if self.0.len() > TAIL_MAX {
            let cut = self.0.len() - TAIL_MAX;
            self.0.drain(..cut);
        }
    }
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0).into_owned()
    }
}

#[derive(Debug)]
pub struct Out {
    /// Code de sortie ; None si le processus a été tué.
    pub code: Option<i32>,
    pub out: String,
    pub err: String,
}

pub struct Engine {
    pub seven: PathBuf,
}

fn read_tail_thread<R: Read + Send + 'static>(mut r: R) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut tail = Tail::default();
        let mut buf = [0u8; 8192];
        while let Ok(n) = r.read(&mut buf) {
            if n == 0 {
                break;
            }
            tail.push(&buf[..n]);
        }
        tail.text()
    })
}

/// Dernier pourcentage (« 42% ») d'un morceau de sortie de progression.
pub fn last_percent(s: &str) -> Option<u32> {
    let b = s.as_bytes();
    let mut res = None;
    for (i, &c) in b.iter().enumerate() {
        if c == b'%' {
            let mut j = i;
            while j > 0 && b[j - 1].is_ascii_digit() {
                j -= 1;
            }
            if j < i {
                if let Ok(v) = s[j..i].parse::<u32>() {
                    if v <= 100 {
                        res = Some(v);
                    }
                }
            }
        }
    }
    res
}

impl Engine {
    fn cmd(&self, args: &[String], cwd: Option<&Path>) -> Command {
        let mut c = Command::new(&self.seven);
        c.args(args);
        if let Some(d) = cwd {
            c.current_dir(d);
        }
        #[cfg(windows)]
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }

    /// Lance 7-Zip. stdout est traité ligne par ligne (`on_line`) ou pour la progression ;
    /// stderr est lu dans un fil séparé. Seule la fin des sorties est conservée.
    fn run(&self, args: Vec<String>, progress: Option<Progress>, mut on_line: Option<&mut dyn FnMut(&str)>) -> EResult<Out> {
        if cancelled() {
            return Err(EngineError::new("CANCELLED", ""));
        }
        let mut child = self
            .cmd(&args, None)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| EngineError::new("ENGINE_MISSING", format!("{} : {e}", self.seven.display())))?;
        let _t = Tracked::new(&child);
        let err_t = read_tail_thread(child.stderr.take().unwrap());
        let mut stdout = child.stdout.take().unwrap();
        let mut tail = Tail::default();
        let mut line = Vec::<u8>::new();
        let mut buf = [0u8; 16384];
        while let Ok(n) = stdout.read(&mut buf) {
            if n == 0 {
                break;
            }
            let chunk = &buf[..n];
            tail.push(chunk);
            if let Some(p) = progress {
                if let Some(v) = last_percent(&String::from_utf8_lossy(chunk)) {
                    p(v);
                }
            }
            if let Some(cb) = on_line.as_mut() {
                for &b in chunk {
                    if b == b'\n' {
                        let s = String::from_utf8_lossy(&line);
                        cb(s.trim_end_matches('\r'));
                        line.clear();
                    } else {
                        line.push(b);
                    }
                }
            }
        }
        if let Some(cb) = on_line.as_mut() {
            if !line.is_empty() {
                cb(String::from_utf8_lossy(&line).trim_end_matches('\r'));
            }
        }
        let code = child.wait().ok().and_then(|s| s.code());
        let err = err_t.join().unwrap_or_default();
        if cancelled() {
            return Err(EngineError::new("CANCELLED", ""));
        }
        Ok(Out { code, out: tail.text(), err })
    }

    /// `.tar.gz` : `7z x -so archive | 7z <args2> -si -ttar`.
    /// Les quatre flux sont lus dans des fils séparés ; si le second processus échoue,
    /// le premier est arrêté (pas de blocage sur un tube plein).
    fn run_tgz(&self, file: &str, args2: Vec<String>, progress: Option<Progress>, on_line: Option<&mut dyn FnMut(&str)>) -> EResult<Out> {
        if cancelled() {
            return Err(EngineError::new("CANCELLED", ""));
        }
        let mut p1 = self
            .cmd(&s(&["x", "-so", "-bsp2", "-bso0", "-y", "--", file]), None)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| EngineError::new("ENGINE_MISSING", e.to_string()))?;
        let _t1 = Tracked::new(&p1);
        let mut a2 = args2;
        // les options doivent précéder « -- » : on l'insère avant le premier argument non-option
        let pos = a2.iter().position(|a| a == "--").unwrap_or(a2.len());
        let mut k = 0;
        for o in ["-si", "-ttar", "-bb0", "-y", "-sccUTF-8"] {
            // une option en double provoque « Command Line Error » chez 7-Zip
            if !a2[..pos].iter().any(|x| x == o) {
                a2.insert(pos + k, o.to_string());
                k += 1;
            }
        }
        let mut p2 = match self.cmd(&a2, None).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
            Ok(p) => p,
            Err(e) => {
                let _ = p1.kill();
                let _ = p1.wait();
                return Err(EngineError::new("ENGINE_MISSING", e.to_string()));
            }
        };
        let _t2 = Tracked::new(&p2);

        let mut src = p1.stdout.take().unwrap();
        let mut dst = p2.stdin.take().unwrap();
        let pipe = thread::spawn(move || {
            let mut buf = vec![0u8; 1 << 16];
            loop {
                match src.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if dst.write_all(&buf[..n]).is_err() {
                            break; // le second 7z s'est arrêté : on ferme le tube (le premier reçoit EPIPE)
                        }
                    }
                }
            }
        });
        // progression du premier processus (stderr, -bsp2)
        let mut e1 = p1.stderr.take().unwrap();
        let prog: Option<&(dyn Fn(u32) + Sync)> = progress;
        let (tx, rx) = std::sync::mpsc::channel::<u32>();
        let e1_t = thread::spawn(move || {
            let mut tail = Tail::default();
            let mut buf = [0u8; 4096];
            while let Ok(n) = e1.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let s = String::from_utf8_lossy(&buf[..n]).to_string();
                match last_percent(&s) {
                    Some(v) => {
                        let _ = tx.send(v);
                    }
                    None => tail.push(&buf[..n]),
                }
            }
            tail.text()
        });
        let e2_t = read_tail_thread(p2.stderr.take().unwrap());

        // stdout du second processus, ligne par ligne, avec relais de la progression
        let mut stdout = p2.stdout.take().unwrap();
        let mut tail = Tail::default();
        let mut line = Vec::<u8>::new();
        let mut buf = [0u8; 16384];
        let mut on_line = on_line;
        while let Ok(n) = stdout.read(&mut buf) {
            if n == 0 {
                break;
            }
            while let Ok(v) = rx.try_recv() {
                if let Some(p) = prog {
                    p(v);
                }
            }
            tail.push(&buf[..n]);
            if let Some(cb) = on_line.as_mut() {
                for &b in &buf[..n] {
                    if b == b'\n' {
                        cb(String::from_utf8_lossy(&line).trim_end_matches('\r'));
                        line.clear();
                    } else {
                        line.push(b);
                    }
                }
            }
        }
        if let Some(cb) = on_line.as_mut() {
            if !line.is_empty() {
                cb(String::from_utf8_lossy(&line).trim_end_matches('\r'));
            }
        }
        let c2 = p2.wait().ok().and_then(|s| s.code());
        if c2 != Some(0) {
            let _ = p1.kill();
        }
        let _ = pipe.join();
        let c1 = p1.wait().ok().and_then(|s| s.code());
        let err1 = e1_t.join().unwrap_or_default();
        let err2 = e2_t.join().unwrap_or_default();
        if cancelled() {
            return Err(EngineError::new("CANCELLED", ""));
        }
        // si le second processus a échoué, c'est son code qui compte (le premier reçoit EPIPE)
        let code = match (c1, c2) {
            (_, Some(c)) if c != 0 => Some(c),
            (Some(a), Some(b)) => Some(a.max(b)),
            _ => None,
        };
        Ok(Out { code, out: tail.text(), err: format!("{err1}{err2}") })
    }
}

fn s(a: &[&str]) -> Vec<String> {
    a.iter().map(|x| x.to_string()).collect()
}

pub fn is_tgz(f: &str) -> bool {
    let l = f.to_lowercase();
    l.ends_with(".tar.gz") || l.ends_with(".tgz")
}

fn pw_arg(password: Option<&str>) -> String {
    match password {
        Some(p) if !p.is_empty() => format!("-p{p}"),
        _ => NO_PW.into(),
    }
}

/// Traduit la sortie de 7-Zip en erreur exploitable par l'interface.
pub fn classify(o: &Out, password_given: bool) -> EngineError {
    let t = format!("{}\n{}", o.err, o.out);
    let l = t.to_lowercase();
    let detail = t
        .lines()
        .map(str::trim)
        .filter(|x| x.starts_with("ERROR") || x.contains("Error") || x.contains("error") || x.starts_with("WARNING"))
        .take(5)
        .collect::<Vec<_>>()
        .join("\n");
    let detail = if detail.is_empty() { format!("code {:?}", o.code) } else { detail };
    if l.contains("wrong password")
        || l.contains("open encrypted")
        || l.contains("data error in encrypted")
        || l.contains("crc failed in encrypted")
    {
        return EngineError::new(if password_given { "PASSWORD_WRONG" } else { "PASSWORD_REQUIRED" }, detail);
    }
    if l.contains("not enough space") || l.contains("no space left") || l.contains("disk full") {
        return EngineError::new("DISK_FULL", detail);
    }
    if l.contains("cannot open the file as archive") || l.contains("can not open the file as archive") || l.contains("is not archive") {
        return EngineError::new("NOT_ARCHIVE", detail);
    }
    if l.contains("unsupported method") || l.contains("unsupported feature") {
        return EngineError::new("UNSUPPORTED", detail);
    }
    if l.contains("headers error")
        || l.contains("data error")
        || l.contains("crc failed")
        || l.contains("unexpected end")
        || l.contains("there are data after the end")
    {
        return EngineError::new("CORRUPT", detail);
    }
    if l.contains("access is denied")
        || l.contains("permission denied")
        || l.contains("cannot open output file")
        || l.contains("can not open output file")
    {
        return EngineError::new("ACCESS_DENIED", detail);
    }
    match o.code {
        Some(8) => EngineError::new("OUT_OF_MEMORY", detail),
        Some(255) | None => EngineError::new("CANCELLED", detail),
        _ => EngineError::new("ENGINE_ERROR", detail),
    }
}

/// Lignes d'avertissement d'une sortie 7-Zip (code 1).
fn warnings_of(o: &Out) -> Vec<String> {
    let t = format!("{}\n{}", o.err, o.out);
    let mut w: Vec<String> = t
        .lines()
        .map(str::trim)
        .filter(|x| x.starts_with("WARNING") || x.starts_with("ERROR") || x.contains("Cannot") || x.contains("Can not"))
        .map(|x| x.to_string())
        .collect();
    w.dedup();
    w.truncate(20);
    if w.is_empty() {
        w.push("7-Zip a signalé des avertissements (code 1) : certains fichiers n'ont peut-être pas été traités.".into());
    }
    w
}

/// 0 = succès, 1 = succès avec avertissements, autre = échec.
fn check(o: Out, password_given: bool) -> EResult<Vec<String>> {
    match o.code {
        Some(0) => Ok(vec![]),
        Some(1) => Ok(warnings_of(&o)),
        _ => Err(classify(&o, password_given)),
    }
}

// ======================= chemins =======================

/// Un chemin interne d'archive est-il sûr à extraire (pas de `..`, pas absolu, pas de lecteur) ?
pub fn is_safe_member(p: &str) -> bool {
    let p = p.replace('\\', "/");
    if p.is_empty() || p.starts_with('/') || p.contains('\0') {
        return false;
    }
    let b = p.as_bytes();
    if b.len() >= 2 && b[1] == b':' {
        return false; // C:...
    }
    !p.split('/').any(|c| c == "..")
}

/// Le chemin `child` est-il (après résolution) à l'intérieur de `root` ?
pub fn is_within(root: &Path, child: &Path) -> bool {
    match (fs::canonicalize(root), fs::canonicalize(child)) {
        (Ok(r), Ok(c)) => c.starts_with(r),
        _ => false,
    }
}

/// Premier nom libre : « nom », « nom (2) », « nom (3) »…  (`ext` inclut le point, ou "").
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}{ext}"));
    if !first.exists() {
        return first;
    }
    (2..10_000).map(|i| dir.join(format!("{stem} ({i}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

pub fn strip_archive_ext(name: &str) -> String {
    let l = name.to_lowercase();
    for e in [".tar.gz", ".tgz", ".tar", ".zip", ".7z", ".rar", ".gz"] {
        if l.ends_with(e) {
            return name[..name.len() - e.len()].to_string();
        }
    }
    name.to_string()
}

fn ext_of(name: &str) -> String {
    Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

pub fn is_dangerous(name: &str) -> bool {
    DANGEROUS_EXT.contains(&ext_of(name).as_str())
}

// ======================= fichiers temporaires =======================

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn tmp_root() -> PathBuf {
    std::env::temp_dir().join("sxm-archive")
}

/// Dossier temporaire unique, supprimé automatiquement à la fin de sa portée.
pub struct TempDir {
    pub path: PathBuf,
    keep: bool,
}
impl TempDir {
    pub fn new(prefix: &str) -> EResult<Self> {
        let root = tmp_root();
        fs::create_dir_all(&root).map_err(|e| EngineError::new("ACCESS_DENIED", e.to_string()))?;
        for _ in 0..100 {
            let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
            let c = TMP_COUNTER.fetch_add(1, Ordering::SeqCst);
            let p = root.join(format!("{prefix}{}-{n:x}-{c}", std::process::id()));
            if fs::create_dir(&p).is_ok() {
                return Ok(Self { path: p, keep: false });
            }
        }
        Err(EngineError::new("ACCESS_DENIED", "impossible de créer un dossier temporaire"))
    }
    /// Conserver le dossier (fichier ouvert dans une autre application) : il sera nettoyé
    /// au prochain démarrage par `cleanup_temp`.
    pub fn keep(mut self) -> PathBuf {
        self.keep = true;
        self.path.clone()
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        if !self.keep {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

/// Supprime les dossiers temporaires de SXM Archive plus anciens que `max_age`.
pub fn cleanup_temp(max_age: Duration) -> usize {
    let mut n = 0;
    if let Ok(rd) = fs::read_dir(tmp_root()) {
        for e in rd.flatten() {
            let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|a| a >= max_age).unwrap_or(false);
            if old && fs::remove_dir_all(e.path()).is_ok() {
                n += 1;
            }
        }
    }
    n
}

// ======================= opérations =======================

#[derive(Debug, Default, Serialize, Clone)]
pub struct Entry {
    pub path: String,
    pub size: u64,
    pub packed: u64,
    pub date: String,
    pub dir: bool,
    pub encrypted: bool,
    /// Chemin dangereux (`..`, absolu) : 7-Zip le neutralise à l'extraction.
    pub unsafe_path: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub entries: Vec<Entry>,
    pub archive_size: u64,
    pub unsafe_count: usize,
}

fn push_entry(cur: &mut HashMap<String, String>, entries: &mut Vec<Entry>) {
    if let Some(p) = cur.get("Path") {
        let size = cur.get("Size").and_then(|s| s.parse().ok());
        let path = p.replace('\\', "/");
        entries.push(Entry {
            unsafe_path: !is_safe_member(&path),
            path,
            size: size.unwrap_or(0),
            packed: cur.get("Packed Size").and_then(|s| s.parse().ok()).unwrap_or(0),
            date: cur.get("Modified").cloned().unwrap_or_default(),
            // ZIP/TAR/RAR indiquent « Folder = + » ; le format 7z ne donne que les attributs
            // Windows (« D » = dossier) en premier mot, ex. « D drwxr-xr-x ».
            dir: cur.get("Folder").map(|f| f == "+").unwrap_or(false)
                || cur.get("Attributes").and_then(|a| a.split_whitespace().next()).map(|w| w.contains('D')).unwrap_or(false),
            encrypted: cur.get("Encrypted").map(|f| f == "+").unwrap_or(false),
        });
    }
    cur.clear();
}

impl Engine {
    pub fn list(&self, file: &str, password: Option<&str>) -> EResult<Listing> {
        if !Path::new(file).is_file() {
            return Err(EngineError::new("NOT_FOUND", file));
        }
        let mut entries = Vec::new();
        let mut cur: HashMap<String, String> = HashMap::new();
        let o = {
            let mut cb = |line: &str| {
                if line.trim().is_empty() {
                    push_entry(&mut cur, &mut entries);
                } else if let Some(i) = line.find(" = ") {
                    cur.insert(line[..i].to_string(), line[i + 3..].to_string());
                }
            };
            if is_tgz(file) {
                self.run_tgz(file, s(&["l", "-slt", "-ba", "-bsp0"]), None, Some(&mut cb))?
            } else {
                self.run(
                    vec![
                        "l".into(),
                        "-slt".into(),
                        "-ba".into(),
                        "-bsp0".into(),
                        "-sccUTF-8".into(),
                        pw_arg(password),
                        "--".into(),
                        file.into(),
                    ],
                    None,
                    Some(&mut cb),
                )?
            }
        };
        push_entry(&mut cur, &mut entries);
        if o.code != Some(0) {
            return Err(classify(&o, password.is_some()));
        }
        let unsafe_count = entries.iter().filter(|e| e.unsafe_path).count();
        Ok(Listing { archive_size: fs::metadata(file).map(|m| m.len()).unwrap_or(0), entries, unsafe_count })
    }

    /// Extrait `file` (ou seulement `members`) dans `dest`.
    /// Les fichiers déjà présents ne sont jamais écrasés : les nouveaux sont renommés (`-aou`).
    pub fn extract(
        &self,
        file: &str,
        dest: &Path,
        members: &[String],
        password: Option<&str>,
        progress: Option<Progress>,
    ) -> EResult<Done> {
        let mut warnings = Vec::new();
        for m in members {
            if !is_safe_member(m) {
                return Err(EngineError::new("UNSAFE_PATH", m.clone()));
            }
        }
        // contrôle préalable des chemins (défense en profondeur ; 7-Zip les neutralise aussi)
        let listing = self.list(file, password)?;
        if listing.unsafe_count > 0 {
            warnings.push(format!(
                "{} élément(s) avec un chemin dangereux (« .. » ou chemin absolu) ont été ramenés dans le dossier de destination.",
                listing.unsafe_count
            ));
        }
        if !members.is_empty() {
            let known: HashSet<&str> = listing.entries.iter().map(|e| e.path.as_str()).collect();
            for m in members {
                if !known.contains(m.as_str()) && !listing.entries.iter().any(|e| e.path.starts_with(&format!("{m}/"))) {
                    return Err(EngineError::new("NOT_FOUND", m.clone()));
                }
            }
        }
        fs::create_dir_all(dest).map_err(|e| EngineError::new("ACCESS_DENIED", e.to_string()))?;
        let mut a: Vec<String> = s(&["x", "-aou", "-bsp1", "-bb0", "-y", "-sccUTF-8"]);
        #[cfg(windows)]
        a.push("-snz".into()); // propage la « marque du Web » (Zone.Identifier) aux fichiers extraits
        a.push(format!("-o{}", dest.display()));
        let o = if is_tgz(file) {
            a.push("--".into());
            a.extend(members.iter().cloned());
            self.run_tgz(file, a, progress, None)?
        } else {
            a.push(pw_arg(password));
            a.push("--".into());
            a.push(file.into());
            a.extend(members.iter().cloned());
            self.run(a, progress, None)?
        };
        warnings.extend(check(o, password.is_some())?);
        Ok(Done { ok: true, out: Some(dest.display().to_string()), warnings })
    }

    pub fn test(&self, file: &str, password: Option<&str>, progress: Option<Progress>) -> EResult<Done> {
        let o = if is_tgz(file) {
            self.run_tgz(file, s(&["t", "-bsp1"]), progress, None)?
        } else {
            self.run(
                vec![
                    "t".into(),
                    "-bsp1".into(),
                    "-bb0".into(),
                    "-y".into(),
                    "-sccUTF-8".into(),
                    pw_arg(password),
                    "--".into(),
                    file.into(),
                ],
                progress,
                None,
            )?
        };
        let warnings = check(o, password.is_some())?;
        Ok(Done { ok: true, out: None, warnings })
    }

    /// Compresse `files` (de dossiers éventuellement différents) dans `out`.
    /// Chaque élément est stocké sous son propre nom ; deux éléments de même nom sont refusés.
    /// L'archive est d'abord écrite à côté sous un nom temporaire, puis renommée : un échec ou
    /// une annulation ne laisse jamais de fichier partiel, et `out` n'est remplacé que si
    /// `overwrite` est vrai.
    #[allow(clippy::too_many_arguments)]
    pub fn compress(
        &self,
        files: &[String],
        out: &str,
        format: &str,
        level: u32,
        password: Option<&str>,
        encrypt_names: bool,
        overwrite: bool,
        progress: Option<Progress>,
    ) -> EResult<Done> {
        if files.is_empty() {
            return Err(EngineError::new("NO_INPUT", ""));
        }
        let mut names = HashSet::new();
        for f in files {
            let p = Path::new(f);
            if !p.exists() {
                return Err(EngineError::new("NOT_FOUND", f.clone()));
            }
            let n = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if !names.insert(n.clone()) {
                return Err(EngineError::new("DUPLICATE_NAME", n));
            }
        }
        let out_p = PathBuf::from(out);
        if out_p.exists() && !overwrite {
            return Err(EngineError::new("EXISTS", out));
        }
        // l'archive ne doit pas se contenir elle-même
        for f in files {
            if Path::new(f).is_dir() && out_p.parent().map(|d| is_within(Path::new(f), d)).unwrap_or(false) {
                return Err(EngineError::new("OUTPUT_INSIDE_INPUT", out));
            }
        }
        let level = level.min(9);
        let dir = out_p.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
        let fname = out_p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "archive".into());
        let partial = dir.join(format!(".{fname}.{}.sxmpart", std::process::id()));
        let _ = fs::remove_file(&partial);
        struct Cleanup<'a>(&'a Path);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = fs::remove_file(self.0);
            }
        }
        let _c = Cleanup(&partial);

        let pw = password.filter(|p| !p.is_empty());
        let warnings = match format {
            "tar.gz" => {
                if pw.is_some() {
                    return Err(EngineError::new("PASSWORD_UNSUPPORTED", "tar.gz"));
                }
                let td = TempDir::new("tar-")?;
                let tar_name = strip_archive_ext(&fname) + ".tar";
                let tar = td.path.join(tar_name);
                let half = |v: u32| {
                    if let Some(p) = progress {
                        p(v / 2)
                    }
                };
                let mut a = vec![
                    "a".to_string(),
                    "-ttar".into(),
                    "-bsp1".into(),
                    "-bb0".into(),
                    "-y".into(),
                    "-sccUTF-8".into(),
                    "--".into(),
                    tar.display().to_string(),
                ];
                a.extend(files.iter().cloned());
                let mut w = check(self.run(a, Some(&half), None)?, false)?;
                let second = |v: u32| {
                    if let Some(p) = progress {
                        p(50 + v / 2)
                    }
                };
                let a = vec![
                    "a".to_string(),
                    "-tgzip".into(),
                    format!("-mx={}", level.max(1)),
                    "-bsp1".into(),
                    "-bb0".into(),
                    "-y".into(),
                    "--".into(),
                    partial.display().to_string(),
                    tar.display().to_string(),
                ];
                w.extend(check(self.run(a, Some(&second), None)?, false)?);
                w
            }
            "zip" | "7z" => {
                let mut a = vec![
                    "a".to_string(),
                    if format == "zip" { "-tzip".into() } else { "-t7z".into() },
                    format!("-mx={level}"),
                    "-bsp1".into(),
                    "-bb0".into(),
                    "-y".into(),
                    "-sccUTF-8".into(),
                ];
                if let Some(p) = pw {
                    a.push(format!("-p{p}"));
                    if format == "zip" {
                        a.push("-mem=AES256".into());
                    }
                    if format == "7z" && encrypt_names {
                        a.push("-mhe=on".into());
                    }
                }
                a.push("--".into());
                a.push(partial.display().to_string());
                a.extend(files.iter().cloned());
                check(self.run(a, progress, None)?, false)?
            }
            other => return Err(EngineError::new("UNSUPPORTED", other)),
        };
        // 7-Zip ajoute parfois l'extension : retrouver le fichier produit
        let produced = if partial.exists() {
            partial.clone()
        } else {
            let alt = PathBuf::from(format!("{}.{}", partial.display(), if format == "tar.gz" { "gz" } else { format }));
            if alt.exists() {
                alt
            } else {
                return Err(EngineError::new("ENGINE_ERROR", "archive non produite"));
            }
        };
        if out_p.exists() {
            if !overwrite {
                let _ = fs::remove_file(&produced);
                return Err(EngineError::new("EXISTS", out));
            }
            fs::remove_file(&out_p).map_err(|e| EngineError::new("ACCESS_DENIED", e.to_string()))?;
        }
        fs::rename(&produced, &out_p).map_err(|e| EngineError::new("ACCESS_DENIED", e.to_string()))?;
        Ok(Done { ok: true, out: Some(out.to_string()), warnings })
    }

    /// Convertit une archive vers un autre format (la source n'est jamais modifiée).
    #[allow(clippy::too_many_arguments)]
    pub fn convert(
        &self,
        file: &str,
        password: Option<&str>,
        out: &str,
        format: &str,
        level: u32,
        new_password: Option<&str>,
        overwrite: bool,
        progress: Option<Progress>,
    ) -> EResult<Done> {
        if Path::new(out).exists() && !overwrite {
            return Err(EngineError::new("EXISTS", out));
        }
        if fs::canonicalize(file).ok() == fs::canonicalize(out).ok() && Path::new(out).exists() {
            return Err(EngineError::new("SAME_FILE", out));
        }
        let td = TempDir::new("conv-")?;
        let first = |v: u32| {
            if let Some(p) = progress {
                p(v / 2)
            }
        };
        let mut done = self.extract(file, &td.path, &[], password, Some(&first))?;
        let files: Vec<String> = fs::read_dir(&td.path)
            .map_err(|e| EngineError::new("ACCESS_DENIED", e.to_string()))?
            .flatten()
            .map(|e| e.path().display().to_string())
            .collect();
        if files.is_empty() {
            return Err(EngineError::new("EMPTY", file));
        }
        let second = |v: u32| {
            if let Some(p) = progress {
                p(50 + v / 2)
            }
        };
        let mut d = self.compress(&files, out, format, level, new_password, true, overwrite, Some(&second))?;
        done.warnings.append(&mut d.warnings);
        Ok(Done { ok: true, out: Some(out.to_string()), warnings: done.warnings })
    }

    /// Extrait un seul fichier dans un dossier temporaire et renvoie son chemin.
    /// Le fichier doit exister dans l'archive, avoir un chemin sûr et rester dans le dossier
    /// temporaire ; un fichier exécutable n'est ouvert qu'avec `allow_dangerous`.
    pub fn extract_member(&self, file: &str, member: &str, password: Option<&str>, allow_dangerous: bool) -> EResult<PathBuf> {
        if !is_safe_member(member) {
            return Err(EngineError::new("UNSAFE_PATH", member));
        }
        let listing = self.list(file, password)?;
        let entry = listing.entries.iter().find(|e| e.path == member).ok_or_else(|| EngineError::new("NOT_FOUND", member))?;
        if entry.dir {
            return Err(EngineError::new("IS_DIR", member));
        }
        if is_dangerous(member) && !allow_dangerous {
            return Err(EngineError::new("DANGEROUS", member));
        }
        let td = TempDir::new("open-")?;
        let mut a: Vec<String> = s(&["x", "-bsp0", "-bb0", "-y", "-sccUTF-8"]);
        #[cfg(windows)]
        a.push("-snz".into());
        a.push(format!("-o{}", td.path.display()));
        let o = if is_tgz(file) {
            a.push("--".into());
            a.push(member.into());
            self.run_tgz(file, a, None, None)?
        } else {
            a.push(pw_arg(password));
            a.push("--".into());
            a.push(file.into());
            a.push(member.into());
            self.run(a, None, None)?
        };
        check(o, password.is_some())?;
        let target = td.path.join(member);
        if !target.is_file() || !is_within(&td.path, &target) {
            return Err(EngineError::new("UNSAFE_PATH", member));
        }
        let _ = td.keep(); // conservé tant que l'application tierce l'utilise ; nettoyé au prochain démarrage
        Ok(target)
    }
}

// Utilisé par les tests et par l'interface pour vérifier les composants d'un chemin.
#[allow(dead_code)]
pub fn has_parent_component(p: &Path) -> bool {
    p.components().any(|c| matches!(c, Component::ParentDir))
}

// ======================= tests =======================
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    // les tests d'intégration partagent l'indicateur d'annulation : on les exécute un par un
    static SERIAL: StdMutex<()> = StdMutex::new(());

    fn engine() -> Option<Engine> {
        let p = std::env::var("SXM_7Z")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(if cfg!(windows) { "7z.exe" } else { "7zz" }));
        if p.exists() {
            Some(Engine { seven: p })
        } else {
            eprintln!("7-Zip absent ({}), test d'intégration ignoré", p.display());
            None
        }
    }

    fn work() -> TempDir {
        TempDir::new("test-").unwrap()
    }

    fn sample(root: &Path) -> (PathBuf, PathBuf) {
        let a = root.join("dossier A");
        let b = root.join("autre-dossier");
        fs::create_dir_all(a.join("sous dossier")).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("Été à Marigot.txt"), "soleil ".repeat(500)).unwrap();
        fs::write(a.join("sous dossier").join("données.csv"), "1;2;3\n".repeat(1000)).unwrap();
        fs::write(b.join("-commence par tiret.txt"), "tiret").unwrap();
        fs::write(b.join("espaces  et (parenthèses) [1].txt"), "x").unwrap();
        (a, b)
    }

    // ---------- tests unitaires (sans 7-Zip) ----------
    #[test]
    fn percent() {
        assert_eq!(last_percent("  5% 12 - a\x08\x08 42%"), Some(42));
        assert_eq!(last_percent("aucun"), None);
        assert_eq!(last_percent("999%"), None);
    }

    #[test]
    fn safe_members() {
        assert!(is_safe_member("dossier/fichier.txt"));
        assert!(is_safe_member("a..b/c"));
        assert!(!is_safe_member("../evil.txt"));
        assert!(!is_safe_member("a/../../evil"));
        assert!(!is_safe_member("..\\evil"));
        assert!(!is_safe_member("/etc/passwd"));
        assert!(!is_safe_member("C:\\Windows\\x.dll"));
        assert!(!is_safe_member("c:/x"));
        assert!(!is_safe_member(""));
    }

    #[test]
    fn names() {
        assert_eq!(strip_archive_ext("photos.tar.gz"), "photos");
        assert_eq!(strip_archive_ext("Doc.ZIP"), "Doc");
        assert_eq!(strip_archive_ext("x.pdf"), "x.pdf");
        assert!(is_dangerous("setup.EXE"));
        assert!(is_dangerous("a/b/script.ps1"));
        assert!(!is_dangerous("photo.jpg"));
        let t = work();
        fs::write(t.path.join("a.zip"), "").unwrap();
        fs::write(t.path.join("a (2).zip"), "").unwrap();
        assert_eq!(unique_path(&t.path, "a", ".zip"), t.path.join("a (3).zip"));
        assert_eq!(unique_path(&t.path, "b", ".zip"), t.path.join("b.zip"));
    }

    #[test]
    fn classify_errors() {
        let o = |e: &str, c| Out { code: Some(c), out: String::new(), err: e.into() };
        assert_eq!(classify(&o("ERROR: x : Cannot open encrypted archive. Wrong password?", 2), false).code, "PASSWORD_REQUIRED");
        assert_eq!(classify(&o("ERROR: Data Error in encrypted file. Wrong password? : a.txt", 2), true).code, "PASSWORD_WRONG");
        assert_eq!(classify(&o("ERROR: x : Cannot open the file as archive", 2), false).code, "NOT_ARCHIVE");
        assert_eq!(classify(&o("ERROR: There is not enough space on the disk", 2), false).code, "DISK_FULL");
        assert_eq!(classify(&o("ERROR: Headers Error", 2), false).code, "CORRUPT");
        assert_eq!(classify(&o("", 8), false).code, "OUT_OF_MEMORY");
        assert_eq!(classify(&Out { code: None, out: String::new(), err: String::new() }, false).code, "CANCELLED");
    }

    #[test]
    fn temp_dirs_cleaned() {
        let p;
        {
            let t = TempDir::new("drop-").unwrap();
            p = t.path.clone();
            fs::write(p.join("f"), "x").unwrap();
            assert!(p.exists());
        }
        assert!(!p.exists(), "le dossier temporaire doit être supprimé");
        let kept = TempDir::new("keep-").unwrap().keep();
        assert!(kept.exists());
        fs::remove_dir_all(kept).unwrap();
    }

    // ---------- tests d'intégration (avec 7-Zip) ----------
    #[test]
    fn roundtrip_all_formats() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = engine() else { return };
        begin_operation();
        let w = work();
        let (a, b) = sample(&w.path);
        // fichiers de dossiers différents (correction du point 1)
        let inputs = vec![
            a.display().to_string(),
            b.join("-commence par tiret.txt").display().to_string(),
            b.join("espaces  et (parenthèses) [1].txt").display().to_string(),
        ];
        for (fmt, ext) in [("zip", ".zip"), ("7z", ".7z"), ("tar.gz", ".tar.gz")] {
            let out = w.path.join(format!("sortie{ext}"));
            let d = e.compress(&inputs, out.to_str().unwrap(), fmt, 5, None, false, false, None).unwrap();
            assert!(d.warnings.is_empty(), "{fmt}: {:?}", d.warnings);
            let l = e.list(out.to_str().unwrap(), None).unwrap();
            let paths: Vec<&str> = l.entries.iter().map(|x| x.path.as_str()).collect();
            for want in [
                "dossier A/Été à Marigot.txt",
                "dossier A/sous dossier/données.csv",
                "-commence par tiret.txt",
                "espaces  et (parenthèses) [1].txt",
            ] {
                assert!(paths.contains(&want), "{fmt}: {want} absent de {paths:?}");
            }
            assert_eq!(l.unsafe_count, 0);
            e.test(out.to_str().unwrap(), None, None).unwrap();
            let dest = w.path.join(format!("ex-{fmt}"));
            e.extract(out.to_str().unwrap(), &dest, &[], None, None).unwrap();
            assert_eq!(fs::read_to_string(dest.join("dossier A/Été à Marigot.txt")).unwrap(), "soleil ".repeat(500));
            assert_eq!(fs::read_to_string(dest.join("-commence par tiret.txt")).unwrap(), "tiret");
            // extraction partielle d'un dossier
            let dest2 = w.path.join(format!("part-{fmt}"));
            e.extract(out.to_str().unwrap(), &dest2, &["dossier A/sous dossier".into()], None, None).unwrap();
            assert!(dest2.join("dossier A/sous dossier/données.csv").is_file());
            assert!(!dest2.join("-commence par tiret.txt").exists());
            // ouverture d'un fichier
            let p = e.extract_member(out.to_str().unwrap(), "dossier A/Été à Marigot.txt", None, false).unwrap();
            assert!(p.is_file());
            fs::remove_dir_all(p.parent().unwrap().parent().unwrap()).unwrap();
        }
    }

    #[test]
    fn no_overwrite() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = engine() else { return };
        begin_operation();
        let w = work();
        let (a, _) = sample(&w.path);
        let out = w.path.join("x.zip");
        fs::write(&out, "IMPORTANT").unwrap();
        let err = e.compress(&[a.display().to_string()], out.to_str().unwrap(), "zip", 5, None, false, false, None).unwrap_err();
        assert_eq!(err.code, "EXISTS");
        assert_eq!(fs::read_to_string(&out).unwrap(), "IMPORTANT", "le fichier existant ne doit pas être modifié");
        // aucune archive partielle laissée
        assert!(fs::read_dir(&w.path).unwrap().flatten().all(|x| !x.file_name().to_string_lossy().ends_with(".sxmpart")));
        // remplacement explicite
        e.compress(&[a.display().to_string()], out.to_str().unwrap(), "zip", 5, None, false, true, None).unwrap();
        assert!(e.list(out.to_str().unwrap(), None).unwrap().entries.len() > 1);
        // extraction : un fichier existant n'est pas écrasé
        let dest = w.path.join("dest");
        fs::create_dir_all(dest.join("dossier A")).unwrap();
        fs::write(dest.join("dossier A/Été à Marigot.txt"), "ANCIEN").unwrap();
        e.extract(out.to_str().unwrap(), &dest, &[], None, None).unwrap();
        assert_eq!(fs::read_to_string(dest.join("dossier A/Été à Marigot.txt")).unwrap(), "ANCIEN");
        assert!(dest.join("dossier A/Été à Marigot_1.txt").is_file());
        // doublons de noms refusés
        let b2 = w.path.join("autre");
        fs::create_dir_all(b2.join("dossier A")).unwrap();
        let err = e
            .compress(
                &[a.display().to_string(), b2.join("dossier A").display().to_string()],
                w.path.join("d.zip").to_str().unwrap(),
                "zip",
                5,
                None,
                false,
                false,
                None,
            )
            .unwrap_err();
        assert_eq!(err.code, "DUPLICATE_NAME");
        // archive dans le dossier compressé refusée
        let err =
            e.compress(&[a.display().to_string()], a.join("moi.zip").to_str().unwrap(), "zip", 5, None, false, false, None).unwrap_err();
        assert_eq!(err.code, "OUTPUT_INSIDE_INPUT");
    }

    #[test]
    fn passwords() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = engine() else { return };
        begin_operation();
        let w = work();
        let (a, _) = sample(&w.path);
        let inp = [a.display().to_string()];
        // 7z avec noms chiffrés : la liste elle-même exige le mot de passe
        let z7 = w.path.join("secret.7z");
        e.compress(&inp, z7.to_str().unwrap(), "7z", 5, Some("Mot de passe é\"&"), true, false, None).unwrap();
        assert_eq!(e.list(z7.to_str().unwrap(), None).unwrap_err().code, "PASSWORD_REQUIRED");
        assert_eq!(e.list(z7.to_str().unwrap(), Some("faux")).unwrap_err().code, "PASSWORD_WRONG");
        assert!(!e.list(z7.to_str().unwrap(), Some("Mot de passe é\"&")).unwrap().entries.is_empty());
        e.test(z7.to_str().unwrap(), Some("Mot de passe é\"&"), None).unwrap();
        // ZIP AES : liste lisible, extraction protégée
        let zp = w.path.join("secret.zip");
        e.compress(&inp, zp.to_str().unwrap(), "zip", 5, Some("abc"), false, false, None).unwrap();
        let l = e.list(zp.to_str().unwrap(), None).unwrap();
        assert!(l.entries.iter().any(|x| x.encrypted));
        let err = e.extract(zp.to_str().unwrap(), &w.path.join("x1"), &[], None, None).unwrap_err();
        assert_eq!(err.code, "PASSWORD_REQUIRED");
        let err = e.extract(zp.to_str().unwrap(), &w.path.join("x2"), &[], Some("faux"), None).unwrap_err();
        assert_eq!(err.code, "PASSWORD_WRONG");
        e.extract(zp.to_str().unwrap(), &w.path.join("x3"), &[], Some("abc"), None).unwrap();
        assert!(w.path.join("x3/dossier A/Été à Marigot.txt").is_file());
        // tar.gz : mot de passe refusé
        assert_eq!(
            e.compress(&inp, w.path.join("t.tar.gz").to_str().unwrap(), "tar.gz", 5, Some("x"), false, false, None).unwrap_err().code,
            "PASSWORD_UNSUPPORTED"
        );
    }

    #[test]
    fn convert_formats() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = engine() else { return };
        begin_operation();
        let w = work();
        let (a, _) = sample(&w.path);
        let src = w.path.join("src.tar.gz");
        e.compress(&[a.display().to_string()], src.to_str().unwrap(), "tar.gz", 5, None, false, false, None).unwrap();
        let z = w.path.join("conv.7z");
        e.convert(src.to_str().unwrap(), None, z.to_str().unwrap(), "7z", 5, Some("pw"), false, None).unwrap();
        assert!(e.list(z.to_str().unwrap(), Some("pw")).unwrap().entries.iter().any(|x| x.path == "dossier A/Été à Marigot.txt"));
        let zz = w.path.join("conv.zip");
        e.convert(z.to_str().unwrap(), Some("pw"), zz.to_str().unwrap(), "zip", 5, None, false, None).unwrap();
        assert!(e.list(zz.to_str().unwrap(), None).unwrap().entries.iter().any(|x| x.path == "dossier A/sous dossier/données.csv"));
        assert_eq!(
            e.convert(z.to_str().unwrap(), Some("pw"), zz.to_str().unwrap(), "zip", 5, None, false, None).unwrap_err().code,
            "EXISTS"
        );
    }

    #[test]
    fn zip_slip_and_member_safety() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = engine() else { return };
        begin_operation();
        let w = work();
        let evil = w.path.join("evil.zip");
        fs::write(&evil, crafted_zip(&[("../../sxm-evil.txt", b"x"), ("/sxm-abs.txt", b"y"), ("ok/f.txt", b"z"), ("tool.exe", b"MZ")]))
            .unwrap();
        let l = e.list(evil.to_str().unwrap(), None).unwrap();
        // selon la plateforme, 7-Zip peut déjà nettoyer le « / » initial à l'affichage
        assert!(l.unsafe_count >= 1, "{:?}", l.entries);
        let dest = w.path.join("a/b/dest");
        let d = e.extract(evil.to_str().unwrap(), &dest, &[], None, None).unwrap();
        assert!(!d.warnings.is_empty(), "un avertissement doit signaler les chemins neutralisés");
        assert!(!w.path.join("a/sxm-evil.txt").exists() && !w.path.join("sxm-evil.txt").exists());
        assert!(!Path::new("/sxm-abs.txt").exists());
        // tout ce qui a été écrit est sous dest
        for f in walk(&w.path.join("a")) {
            assert!(f.starts_with(&dest), "fichier hors destination : {}", f.display());
        }
        assert_eq!(
            e.extract(evil.to_str().unwrap(), &w.path.join("d2"), &["../../sxm-evil.txt".into()], None, None).unwrap_err().code,
            "UNSAFE_PATH"
        );
        assert_eq!(
            e.extract(evil.to_str().unwrap(), &w.path.join("d3"), &["inexistant.txt".into()], None, None).unwrap_err().code,
            "NOT_FOUND"
        );
        assert_eq!(e.extract_member(evil.to_str().unwrap(), "tool.exe", None, false).unwrap_err().code, "DANGEROUS");
        assert_eq!(e.extract_member(evil.to_str().unwrap(), "../../sxm-evil.txt", None, false).unwrap_err().code, "UNSAFE_PATH");
        let p = e.extract_member(evil.to_str().unwrap(), "tool.exe", None, true).unwrap();
        assert!(p.is_file());
        fs::remove_dir_all(p.parent().unwrap()).unwrap();
    }

    #[test]
    fn corrupt_and_not_archive() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = engine() else { return };
        begin_operation();
        let w = work();
        let f = w.path.join("faux.zip");
        fs::write(&f, b"ceci n'est pas une archive").unwrap();
        assert_eq!(e.list(f.to_str().unwrap(), None).unwrap_err().code, "NOT_ARCHIVE");
        let (a, _) = sample(&w.path);
        let z = w.path.join("c.7z");
        e.compress(&[a.display().to_string()], z.to_str().unwrap(), "7z", 0, None, false, false, None).unwrap();
        let mut bytes = fs::read(&z).unwrap();
        let mid = bytes.len() / 2;
        for b in &mut bytes[mid..mid + 64] {
            *b ^= 0xFF;
        }
        fs::write(&z, &bytes).unwrap();
        let err = e.test(z.to_str().unwrap(), None, None).unwrap_err();
        assert!(["CORRUPT", "ENGINE_ERROR"].contains(&err.code.as_str()), "{err:?}");
        assert_eq!(e.list(w.path.join("absent.zip").to_str().unwrap(), None).unwrap_err().code, "NOT_FOUND");
    }

    #[test]
    fn large_archive_and_cancel() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = engine() else { return };
        begin_operation();
        let w = work();
        // 3 000 petits fichiers + un fichier de 64 Mio peu compressible
        let many = w.path.join("beaucoup");
        for i in 0..30 {
            let d = many.join(format!("niveau {i}/sous {i}"));
            fs::create_dir_all(&d).unwrap();
            for j in 0..100 {
                fs::write(d.join(format!("f{j}.txt")), format!("{i}-{j}")).unwrap();
            }
        }
        let mut big = vec![0u8; 64 << 20];
        let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
        for b in big.iter_mut() {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            *b = x as u8;
        }
        fs::write(many.join("gros.bin"), &big).unwrap();
        drop(big);
        let out = w.path.join("gros.7z");
        let last = std::sync::atomic::AtomicU32::new(0);
        let prog = |v: u32| last.store(v, Ordering::SeqCst);
        e.compress(&[many.display().to_string()], out.to_str().unwrap(), "7z", 1, None, false, false, Some(&prog)).unwrap();
        let l = e.list(out.to_str().unwrap(), None).unwrap();
        assert_eq!(l.entries.iter().filter(|x| !x.dir).count(), 3001);
        let tg = w.path.join("gros.tar.gz");
        e.compress(&[many.display().to_string()], tg.to_str().unwrap(), "tar.gz", 1, None, false, false, None).unwrap();
        assert_eq!(e.list(tg.to_str().unwrap(), None).unwrap().entries.iter().filter(|x| !x.dir).count(), 3001);
        e.test(tg.to_str().unwrap(), None, None).unwrap();
        e.extract(tg.to_str().unwrap(), &w.path.join("ex"), &[], None, None).unwrap();
        assert_eq!(fs::metadata(w.path.join("ex/beaucoup/gros.bin")).unwrap().len(), 64 << 20);

        // annulation pendant une compression : pas de fichier partiel
        let out2 = w.path.join("annule.7z");
        let h = thread::spawn(|| {
            thread::sleep(Duration::from_millis(300));
            cancel();
        });
        let r = e.compress(&[many.display().to_string()], out2.to_str().unwrap(), "7z", 9, None, false, false, None);
        h.join().unwrap();
        begin_operation();
        assert_eq!(r.unwrap_err().code, "CANCELLED");
        assert!(!out2.exists());
        assert!(fs::read_dir(&w.path).unwrap().flatten().all(|x| !x.file_name().to_string_lossy().ends_with(".sxmpart")));
    }

    #[test]
    fn nested_archive() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = engine() else { return };
        begin_operation();
        let w = work();
        let (a, _) = sample(&w.path);
        let inner = w.path.join("interne.zip");
        e.compress(&[a.display().to_string()], inner.to_str().unwrap(), "zip", 5, None, false, false, None).unwrap();
        let outer = w.path.join("externe.7z");
        e.compress(&[inner.display().to_string()], outer.to_str().unwrap(), "7z", 5, None, false, false, None).unwrap();
        let p = e.extract_member(outer.to_str().unwrap(), "interne.zip", None, false).unwrap();
        assert!(e.list(p.to_str().unwrap(), None).unwrap().entries.iter().any(|x| x.path == "dossier A/Été à Marigot.txt"));
        fs::remove_dir_all(p.parent().unwrap()).unwrap();
    }

    #[test]
    fn rar_fixture() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = engine() else { return };
        begin_operation();
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures");
        let mut n = 0;
        for f in fs::read_dir(&dir).into_iter().flatten().flatten() {
            let p = f.path();
            if p.extension().map(|x| x == "rar").unwrap_or(false) {
                let name = p.file_name().unwrap().to_string_lossy().to_string();
                let pw = if name.contains("pw-") { Some("password") } else { None };
                let l = e.list(p.to_str().unwrap(), pw).unwrap_or_else(|err| panic!("{name}: {err:?}"));
                assert!(!l.entries.is_empty(), "{name}");
                e.test(p.to_str().unwrap(), pw, None).unwrap_or_else(|err| panic!("{name}: {err:?}"));
                let w = work();
                e.extract(p.to_str().unwrap(), &w.path, &[], pw, None).unwrap_or_else(|err| panic!("{name}: {err:?}"));
                n += 1;
            }
        }
        eprintln!("{n} archive(s) RAR testée(s)");
    }

    fn walk(p: &Path) -> Vec<PathBuf> {
        let mut v = vec![];
        if let Ok(rd) = fs::read_dir(p) {
            for e in rd.flatten() {
                let q = e.path();
                if q.is_dir() {
                    v.extend(walk(&q));
                } else {
                    v.push(q);
                }
            }
        }
        v
    }

    /// Fabrique un ZIP « stocké » minimal avec des noms arbitraires (pour simuler une attaque Zip Slip).
    fn crafted_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        fn crc32(d: &[u8]) -> u32 {
            let mut c = 0xFFFF_FFFFu32;
            for &b in d {
                c ^= b as u32;
                for _ in 0..8 {
                    c = if c & 1 != 0 { (c >> 1) ^ 0xEDB8_8320 } else { c >> 1 };
                }
            }
            !c
        }
        let (mut out, mut central) = (Vec::new(), Vec::new());
        for (name, data) in files {
            let off = out.len() as u32;
            let crc = crc32(data);
            let n = name.as_bytes();
            let le16 = |v: u16| v.to_le_bytes();
            let le32 = |v: u32| v.to_le_bytes();
            out.extend(le32(0x0403_4b50));
            out.extend(le16(20));
            out.extend(le16(0));
            out.extend(le16(0));
            out.extend(le32(0));
            out.extend(le32(crc));
            out.extend(le32(data.len() as u32));
            out.extend(le32(data.len() as u32));
            out.extend(le16(n.len() as u16));
            out.extend(le16(0));
            out.extend(n);
            out.extend(*data);
            central.extend(le32(0x0201_4b50));
            central.extend(le16(20));
            central.extend(le16(20));
            central.extend(le16(0));
            central.extend(le16(0));
            central.extend(le32(0));
            central.extend(le32(crc));
            central.extend(le32(data.len() as u32));
            central.extend(le32(data.len() as u32));
            central.extend(le16(n.len() as u16));
            central.extend([0u8; 12]);
            central.extend(le32(off));
            central.extend(n);
        }
        let cd_off = out.len() as u32;
        let cd_len = central.len() as u32;
        out.extend(central);
        out.extend(0x0605_4b50u32.to_le_bytes());
        out.extend([0u8; 4]);
        out.extend((files.len() as u16).to_le_bytes());
        out.extend((files.len() as u16).to_le_bytes());
        out.extend(cd_len.to_le_bytes());
        out.extend(cd_off.to_le_bytes());
        out.extend([0u8; 2]);
        out
    }
}
