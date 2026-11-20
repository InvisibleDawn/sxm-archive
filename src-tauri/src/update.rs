//! Mises à jour intégrées (Windows, macOS, Fedora).
//!
//! Le module officiel tauri-plugin-updater télécharge la nouvelle version depuis la page
//! « Releases » de GitHub (`latest.json`) et **vérifie sa signature** (clé publique intégrée à
//! l'application) avant toute installation. Une mise à jour non signée par la clé de l'éditeur
//! est refusée.
//!
//! Le module n'est activé que si l'application a été compilée avec une clé publique
//! (`plugins.updater.pubkey`, ajoutée par le workflow GitHub). Sinon, l'interface indique que les
//! mises à jour ne sont pas disponibles pour cette version.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

static ENABLED: AtomicBool = AtomicBool::new(false);
static PENDING: Mutex<Option<Update>> = Mutex::new(None);
static INSTALLING: AtomicBool = AtomicBool::new(false);

/// Active le module si la configuration contient une clé publique non vide.
pub fn init<R: Runtime>(app: &tauri::App<R>) {
    let has_key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);
    if has_key && app.handle().plugin(tauri_plugin_updater::Builder::new().build()).is_ok() {
        ENABLED.store(true, Ordering::SeqCst);
    }
}

#[derive(Serialize, Default)]
pub struct UpdateInfo {
    /// Le module de mise à jour est-il actif dans cette version ?
    enabled: bool,
    available: bool,
    current: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn friendly(e: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Reqwest(_) | E::Network(_) => "NETWORK".into(),
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) => "SIGNATURE".into(),
        E::TargetNotFound(_) | E::TargetsNotFound(..) => "NO_PLATFORM".into(),
        E::ReleaseNotFound => "NO_RELEASE".into(),
        other => other.to_string(),
    }
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> UpdateInfo {
    let current = app.package_info().version.to_string();
    if !ENABLED.load(Ordering::SeqCst) {
        return UpdateInfo { enabled: false, current, ..Default::default() };
    }
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return UpdateInfo { enabled: true, current, error: Some(friendly(&e)), ..Default::default() },
    };
    match updater.check().await {
        Ok(Some(u)) => {
            let info = UpdateInfo {
                enabled: true,
                available: true,
                current,
                version: Some(u.version.clone()),
                notes: u.body.clone(),
                date: u.date.map(|d| d.to_string()),
                error: None,
            };
            if let Ok(mut p) = PENDING.lock() {
                *p = Some(u);
            }
            info
        }
        Ok(None) => UpdateInfo { enabled: true, available: false, current, ..Default::default() },
        Err(e) => UpdateInfo { enabled: true, current, error: Some(friendly(&e)), ..Default::default() },
    }
}

/// Télécharge, vérifie la signature, installe, puis redémarre l'application.
/// Sous Windows, l'installateur ferme lui-même l'application. Sous Fedora, le système demande
/// le mot de passe administrateur (polkit) pour installer le paquet .rpm.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("BUSY".into());
    }
    let update = PENDING.lock().ok().and_then(|mut p| p.take());
    let Some(update) = update else {
        INSTALLING.store(false, Ordering::SeqCst);
        return Err("NO_UPDATE".into());
    };
    let mut received: u64 = 0;
    let app2 = app.clone();
    let res = update
        .download_and_install(
            move |chunk, total| {
                received += chunk as u64;
                if let Some(t) = total.filter(|t| *t > 0) {
                    let _ = app2.emit("update-progress", (received * 100 / t).min(100));
                }
            },
            || {},
        )
        .await;
    INSTALLING.store(false, Ordering::SeqCst);
    match res {
        Ok(()) => {
            // fermer proprement les opérations 7-Zip éventuelles, puis relancer la nouvelle version
            crate::engine::cancel();
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.hide();
            }
            app.restart();
        }
        Err(e) => Err(friendly(&e)),
    }
}
