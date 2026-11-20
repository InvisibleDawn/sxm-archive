//! Intégration au système : ouvrir un dossier, afficher un fichier, liens externes, épinglage, menu macOS.

use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn spawn_open(p: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let r = Command::new("explorer").arg(p).creation_flags(CREATE_NO_WINDOW).spawn();
    #[cfg(target_os = "macos")]
    let r = Command::new("open").arg(p).spawn();
    #[cfg(target_os = "linux")]
    let r = Command::new("xdg-open").arg(p).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

/// Ouvre un fichier extrait (déjà vérifié par le moteur) avec l'application par défaut.
pub(crate) fn open_file(p: &Path) -> Result<(), String> {
    if !p.is_file() {
        return Err(format!("introuvable : {}", p.display()));
    }
    spawn_open(p)
}

/// Ouvre un dossier dans le gestionnaire de fichiers (jamais un fichier : voir `open_member`).
#[tauri::command]
pub(crate) fn open_dir(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err("Dossier introuvable.".into());
    }
    spawn_open(p)
}

/// Affiche le fichier dans le gestionnaire de fichiers.
#[tauri::command]
pub(crate) fn reveal(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Fichier introuvable.".into());
    }
    #[cfg(windows)]
    {
        Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path.replace('"', "")))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").args(["-R", &path]).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        spawn_open(p.parent().unwrap_or(Path::new("/")))
    }
}

/// Ouvre un lien dans le navigateur (https seulement : pages de téléchargement).
#[tauri::command]
pub(crate) fn open_external(url: String) -> Result<(), String> {
    if !is_safe_url(&url) {
        return Err("Lien non pris en charge.".into());
    }
    #[cfg(windows)]
    let r = Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn();
    #[cfg(target_os = "macos")]
    let r = Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "linux")]
    let r = Command::new("xdg-open").arg(&url).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

pub(crate) fn is_safe_url(url: &str) -> bool {
    url.to_ascii_lowercase().starts_with("https://") && !url.chars().any(|c| c.is_control() || c == '"' || c == ' ') && url.len() < 4096
}

/// Nom du fichier .desktop installé par le paquet (ex. « SXM Archive.desktop »).
#[cfg(target_os = "linux")]
fn find_desktop_id() -> Result<String, String> {
    let home_apps = std::env::var("HOME").map(|h| format!("{h}/.local/share/applications")).unwrap_or_default();
    let dirs = ["/usr/share/applications", "/usr/local/share/applications", home_apps.as_str()];
    dirs.iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flatten()
        .flatten()
        .find(|e| {
            e.path().extension().map(|x| x == "desktop").unwrap_or(false)
                && std::fs::read_to_string(e.path()).map(|c| c.contains("Exec=sxm-archive")).unwrap_or(false)
        })
        .map(|e| e.file_name().to_string_lossy().to_string())
        .ok_or_else(|| "Fichier de lancement introuvable : installez d'abord le paquet .rpm.".to_string())
}

/// Épingle SXM Archive dans les favoris (GNOME) ou le Dock (macOS), avec l'accord de l'utilisateur.
/// Renvoie "ok", "deja", "windows" (épinglage automatique interdit par Windows) ou "bureau"
/// (bureau sans favoris programmables, ex. MATE : l'interface explique la manipulation).
#[tauri::command]
pub(crate) fn pin_app() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let id = find_desktop_id()?;
        let Ok(out) = Command::new("gsettings").args(["get", "org.gnome.shell", "favorite-apps"]).output() else {
            return Ok("bureau".into());
        };
        if !out.status.success() {
            return Ok("bureau".into());
        }
        let cur = String::from_utf8_lossy(&out.stdout).to_string();
        let mut apps: Vec<String> = cur
            .trim()
            .trim_start_matches("@as")
            .trim()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .split(',')
            .map(|s| s.trim().trim_matches('\'').to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if apps.iter().any(|a| a == &id) {
            return Ok("deja".into());
        }
        apps.push(id);
        let list = format!("[{}]", apps.iter().map(|a| format!("'{}'", a.replace('\'', ""))).collect::<Vec<_>>().join(", "));
        let st = Command::new("gsettings").args(["set", "org.gnome.shell", "favorite-apps", &list]).status().map_err(|e| e.to_string())?;
        if st.success() {
            Ok("ok".into())
        } else {
            Ok("bureau".into())
        }
    }
    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let app = exe
            .ancestors()
            .find(|p| p.extension().map(|x| x == "app").unwrap_or(false))
            .ok_or("Lancez SXM Archive depuis le dossier Applications pour l'ajouter au Dock.")?
            .to_string_lossy()
            .to_string();
        let cur = Command::new("defaults")
            .args(["read", "com.apple.dock", "persistent-apps"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();
        if cur.contains(&app) || cur.contains(&app.replace(' ', "%20")) {
            return Ok("deja".into());
        }
        let xml = app.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
        let tile = format!(
            "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>{xml}</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>"
        );
        Command::new("defaults")
            .args(["write", "com.apple.dock", "persistent-apps", "-array-add", &tile])
            .status()
            .map_err(|e| e.to_string())?;
        let _ = Command::new("killall").arg("Dock").status();
        Ok("ok".into())
    }
    #[cfg(windows)]
    {
        Ok("windows".into())
    }
}

/// macOS : menu standard dont l'élément « Quitter » passe par la fermeture de la fenêtre,
/// pour qu'une opération en cours puisse être annulée proprement.
#[cfg(target_os = "macos")]
pub(crate) fn mac_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app.handle())?;
    if let Some(MenuItemKind::Submenu(appmenu)) = menu.items()?.into_iter().next() {
        for it in appmenu.items()? {
            if let MenuItemKind::Predefined(p) = &it {
                let t = p.text().unwrap_or_default();
                if t.starts_with("Quit") || t.starts_with("Quitter") {
                    appmenu.remove(p)?;
                }
            }
        }
        let quit = MenuItem::with_id(app, "sxm-quit", "Quitter SXM Archive", true, Some("CmdOrCtrl+Q"))?;
        appmenu.append(&quit)?;
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert!(is_safe_url("https://github.com/InvisibleDawn/sxm-archive/releases"));
        assert!(!is_safe_url("http://exemple.fr"));
        assert!(!is_safe_url("file:///etc/passwd"));
        assert!(!is_safe_url("https://a.b/\" & calc"));
        assert!(!is_safe_url("javascript:alert(1)"));
    }
}
