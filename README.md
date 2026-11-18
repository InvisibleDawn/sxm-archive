# SXM Archive

Gestionnaire d'archives pour Windows 10/11 : **RAR** (extraction), **ZIP**, **7z** et **tar.gz** (extraction et création), chiffrement **AES-256**, conversion entre formats, test d'intégrité. Moteur 7-Zip 25.01 intégré, 100 % hors ligne.

## Installer
Téléchargez le dernier installateur dans l'onglet **Releases** (`.exe` recommandé, ou `.msi`).

## Compiler
La compilation se fait automatiquement sur GitHub Actions (machine Windows) :
- chaque envoi sur `main` produit les installateurs dans l'onglet **Actions** (artefact `sxm-archive-windows`) ;
- un tag `vX.Y.Z` publie une version dans **Releases**.

En local : `npm ci`, placer `7z.exe` et `7z.dll` dans `src-tauri/bin/`, puis `npx tauri build`.

## Structure
- `ui/` : interface (HTML/CSS/JS, sans étape de compilation)
- `src-tauri/` : moteur Rust (Tauri 2) qui pilote 7-Zip
- `src-tauri/windows/hooks.nsh` : clic droit « Compresser avec SXM Archive » dans l'Explorateur

7-Zip © Igor Pavlov — licence GNU LGPL + restriction unRAR.
