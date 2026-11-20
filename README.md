# SXM Archive

Gestionnaire d'archives pour Windows 10/11 et Fedora : **RAR** (extraction), **ZIP**, **7z** et **tar.gz** (extraction et création), chiffrement **AES-256**, conversion entre formats, test d'intégrité. Moteur 7-Zip 25.01 intégré, 100 % hors ligne.

## Installer
Téléchargez le dernier installateur dans l'onglet **Releases** :
- **Windows 10/11** : `.exe` (recommandé) ou `.msi` ;
- **Fedora** : `.rpm`, puis `sudo dnf install ./SXM.Archive-*.x86_64.rpm`. Clic droit « Compresser avec SXM Archive »
  dans Caja (MATE, paquet `caja-actions`) et Nemo (Cinnamon).

## Compiler et publier
Tout se fait sur GitHub Actions (`.github/workflows/build.yml`) :
- **chaque Pull Request et chaque envoi sur `main`** : contrôles (format, Clippy, syntaxe JS), tests du moteur
  sous Linux et Windows, compilation des installateurs, installation/désinstallation réelles sous
  `windows-2022` et `windows-2025`. Les installateurs sont disponibles dans l'onglet **Actions** (artefacts) ;
- **publication** : onglet **Actions → Compiler SXM Archive → Run workflow** sur `main`, case « publier » cochée
  (ou tag `vX.Y.Z` égal à la version). La publication n'a lieu qu'après réussite de tous les tests et
  **échoue si la version existe déjà** : aucune release ni aucun tag n'est jamais supprimé.

Pour une nouvelle version : changer `version` dans `package.json`, `src-tauri/Cargo.toml` et
`src-tauri/tauri.conf.json` (le workflow vérifie qu'elles sont identiques).

En local : `npm ci`, placer `7z.exe`, `7z.dll` et `License.txt` (vérifiés avec `third_party/7zip.sha256`)
dans `src-tauri/bin/`, puis `npx tauri build`. Tests : `cd src-tauri && cargo test`.

## Sécurité
- Aucun fichier existant n'est écrasé sans confirmation (compression : écriture dans un fichier temporaire puis
  renommage ; extraction : les fichiers déjà présents sont conservés, les nouveaux renommés).
- Les chemins dangereux des archives (`..`, absolus) sont signalés et ne peuvent pas sortir du dossier de destination.
- Les programmes et scripts contenus dans une archive ne s'ouvrent qu'après confirmation ; sous Windows, la
  « marque du Web » de l'archive est propagée aux fichiers extraits.
- Moteur 7-Zip vérifié par SHA-256 à chaque compilation (voir `third_party/README.md`).
- Les installateurs ne sont pas signés (Authenticode) : SmartScreen peut afficher un avertissement.

## Structure
- `ui/` : interface (HTML/CSS/JS, sans étape de compilation)
- `src-tauri/` : moteur Rust (Tauri 2) qui pilote 7-Zip
- `src-tauri/windows/hooks.nsh` : clic droit « Compresser avec SXM Archive » dans l'Explorateur

Éditeur : **Invisible_Dawn**. 7-Zip © Igor Pavlov — licence GNU LGPL + restriction unRAR (voir `third_party/README.md`).
