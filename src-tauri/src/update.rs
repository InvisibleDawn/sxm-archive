//! Mises à jour (même fonctionnement que SXM PDF) : canal stable ou bêta, vérification de la signature
//! avec la clé publique de `tauri.conf.json` (clé commune aux logiciels SXM d'Invisible_Dawn),
//! jamais d'installation sans le clic de l'utilisateur.

use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;

const UPDATE_STABLE: &str = "https://github.com/InvisibleDawn/sxm-archive/releases/latest/download/latest.json";
const UPDATE_BETA: &str = "https://github.com/InvisibleDawn/sxm-archive/releases/download/canal-beta/beta.json";

type Vue = std::sync::Arc<std::sync::Mutex<Option<(String, String)>>>;

/// `vue` reçoit la version et les nouveautés du manifeste (utile quand il n'y a pas de fichier signé).
fn updater_for(app: &tauri::AppHandle, beta: bool, vue: Option<Vue>) -> Result<tauri_plugin_updater::Updater, String> {
    let url = tauri::Url::parse(if beta { UPDATE_BETA } else { UPDATE_STABLE }).map_err(|e| e.to_string())?;
    let mut b = app.updater_builder().endpoints(vec![url]).map_err(|e| e.to_string())?;
    if let Some(vue) = vue {
        b = b.version_comparator(move |current, release| {
            if let Ok(mut v) = vue.lock() {
                *v = Some((release.version.to_string(), release.notes.clone().unwrap_or_default()));
            }
            release.version > current
        });
    }
    b.build().map_err(|e| e.to_string())
}

/// Aucun fichier de mise à jour publié : ce n'est pas une panne.
fn aucune_version_publiee(e: &tauri_plugin_updater::Error) -> bool {
    use tauri_plugin_updater::Error as E;
    matches!(e, E::ReleaseNotFound)
        || e.to_string().contains("404")
        || e.to_string().to_lowercase().contains("could not fetch a valid release json")
}

#[derive(Serialize)]
pub(crate) struct UpdateInfo {
    version: String,
    current: String,
    notes: String,
    /// true : version plus récente publiée sans fichier signé pour ce système (secret absent lors de la
    /// publication) ; l'application ouvre alors la page de téléchargement au lieu d'installer.
    manual: bool,
}

/// Le plugin ne cherche le fichier de ce système qu'après avoir constaté une version plus récente :
/// « cible absente » signifie donc « nouvelle version, mais sans installation automatique possible ».
fn version_sans_fichier_signe(e: &tauri_plugin_updater::Error) -> bool {
    use tauri_plugin_updater::Error as E;
    matches!(e, E::TargetNotFound(_) | E::TargetsNotFound(..))
}

/// Cherche une nouvelle version (canal stable ou bêta). Rien en mode développement.
#[tauri::command]
pub(crate) async fn update_check(app: tauri::AppHandle, beta: bool) -> Result<Option<UpdateInfo>, String> {
    if cfg!(debug_assertions) && std::env::var_os("SXM_TEST_UPDATES").is_none() {
        return Ok(None);
    }
    let vue: Vue = Default::default();
    let found = match updater_for(&app, beta, Some(vue.clone()))?.check().await {
        Ok(f) => f,
        Err(e) if version_sans_fichier_signe(&e) => {
            let (version, notes) = vue.lock().ok().and_then(|v| v.clone()).unwrap_or_default();
            let current = app.package_info().version.to_string();
            return Ok(Some(UpdateInfo { version, current, notes, manual: true }));
        }
        Err(e) if aucune_version_publiee(&e) => None,
        Err(e) => return Err(format!("Vérification impossible : {e}")),
    };
    Ok(found.map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().unwrap_or_default(),
        manual: false,
    }))
}

/// Télécharge, vérifie la signature et installe, puis redémarre. Windows : installateur silencieux ;
/// macOS : remplacement de l'application ; Fedora : paquet .rpm installé après le mot de passe
/// administrateur (polkit).
#[tauri::command]
pub(crate) async fn update_install(app: tauri::AppHandle, beta: bool, progress: tauri::ipc::Channel<(u64, u64)>) -> Result<(), String> {
    let Some(update) = updater_for(&app, beta, None)?.check().await.map_err(|e| format!("Vérification impossible : {e}"))? else {
        return Err("Aucune mise à jour disponible.".into());
    };
    let mut done: u64 = 0;
    update
        .download_and_install(
            |chunk, total| {
                done += chunk as u64;
                let _ = progress.send((done, total.unwrap_or(0)));
            },
            || {},
        )
        .await
        .map_err(|e| {
            let s = e.to_string();
            if s.to_lowercase().contains("signature") {
                "SIGNATURE".to_string()
            } else {
                format!("Installation impossible : {s}")
            }
        })?;
    crate::engine::cancel();
    app.restart();
}
