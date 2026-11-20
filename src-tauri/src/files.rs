//! Dossier temporaire privé de SXM Archive (même règle que SXM PDF).
//!
//! - Linux : dossier d'exécution de l'utilisateur ($XDG_RUNTIME_DIR, en mémoire, effacé à la
//!   déconnexion), sinon ~/.cache/com.sxm.archive/tmp — jamais dans /tmp partagé entre utilisateurs.
//! - macOS et Windows : dossier temporaire du système, déjà propre à chaque utilisateur.
//!
//! Le dossier est vérifié : vrai dossier (pas un lien), appartenant à l'utilisateur, privé (0700).
//! En cas de doute, un dossier neuf au nom aléatoire est créé à la place.

use std::path::{Path, PathBuf};

/// Octets aléatoires en hexadécimal (noms de dossiers temporaires imprévisibles).
pub(crate) fn random_hex(n: usize) -> String {
    let mut b = vec![0u8; n];
    if getrandom::fill(&mut b).is_err() {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        b = (t ^ ((std::process::id() as u128) << 64)).to_le_bytes()[..n.min(16)].to_vec();
    }
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub(crate) fn app_temp_dir() -> PathBuf {
    static DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    DIR.get_or_init(|| {
        let preferred = preferred_temp_base().join("sxm-archive");
        if prepare_private_dir(&preferred).is_ok() {
            return preferred;
        }
        let fallback = preferred_temp_base().join(format!("sxm-archive-{}", random_hex(8)));
        let _ = prepare_private_dir(&fallback);
        fallback
    })
    .clone()
}

fn preferred_temp_base() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        if let Some(rt) = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from) {
            if rt.is_absolute() && is_private_dir(&rt) {
                return rt;
            }
        }
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            let c = home.join(".cache").join("com.sxm.archive");
            if std::fs::create_dir_all(&c).is_ok() {
                return c;
            }
        }
    }
    std::env::temp_dir()
}

/// Crée (si besoin) et vérifie un dossier privé : pas un lien symbolique, propriétaire = utilisateur,
/// aucun droit pour les autres.
pub(crate) fn prepare_private_dir(dir: &Path) -> Result<(), String> {
    let mut b = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    match b.create(dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e.to_string()),
    }
    if is_private_dir(dir) {
        Ok(())
    } else {
        Err("dossier temporaire non sûr".into())
    }
}

#[cfg(unix)]
extern "C" {
    fn geteuid() -> u32;
}

pub(crate) fn is_private_dir(dir: &Path) -> bool {
    let Ok(m) = std::fs::symlink_metadata(dir) else { return false };
    if !m.is_dir() || m.file_type().is_symlink() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        m.uid() == unsafe { geteuid() } && m.mode() & 0o077 == 0
    }
    #[cfg(not(unix))]
    {
        true // Windows : %TEMP% est dans le profil de l'utilisateur (droits NTFS du profil)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_dir_is_private() {
        let d = app_temp_dir();
        assert!(d.is_dir());
        assert!(is_private_dir(&d), "{} doit être privé", d.display());
        #[cfg(target_os = "linux")]
        if std::env::var_os("XDG_RUNTIME_DIR").is_some() || std::env::var_os("HOME").is_some() {
            assert!(!d.starts_with("/tmp"), "jamais dans /tmp partagé : {}", d.display());
        }
        assert_eq!(random_hex(8).len(), 16);
        assert_ne!(random_hex(8), random_hex(8));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_shared_dir() {
        use std::os::unix::fs::PermissionsExt;
        let d = app_temp_dir().join(format!("partage-{}", random_hex(4)));
        std::fs::create_dir(&d).unwrap();
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o777)).unwrap();
        assert!(!is_private_dir(&d));
        std::fs::remove_dir(&d).unwrap();
    }
}
