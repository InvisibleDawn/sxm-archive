# SXM Archive

Gestionnaire d'archives pour Windows 10/11, Fedora et macOS 11+ : **RAR** (extraction), **ZIP**, **7z** et **tar.gz** (extraction et création), chiffrement **AES-256**, conversion entre formats, test d'intégrité. Moteur 7-Zip 25.01 intégré, 100 % hors ligne.

## Installer
Téléchargez le dernier installateur dans l'onglet **Releases** :
- **Windows 10/11** : `.exe` (recommandé) ou `.msi` ;
- **Fedora** : `.rpm`, puis `sudo dnf install ./SXM.Archive-*.x86_64.rpm`. Clic droit « Compresser avec SXM Archive »
  dans Caja (MATE, paquet `caja-actions`) et Nemo (Cinnamon) ;
- **macOS 11+** (Apple Silicon et Intel) : `.dmg`. Application non signée par Apple : au premier lancement,
  clic droit sur l'application → **Ouvrir**, ou Réglages Système → Confidentialité et sécurité → **Ouvrir quand même**.

## Mises à jour
Le bouton **Mises à jour** (et une vérification automatique au démarrage, au plus une fois par jour, désactivable)
interroge `latest.json` dans la dernière release GitHub. La mise à jour est téléchargée puis **sa signature est
vérifiée** avec la clé publique intégrée à l'application : un fichier modifié ou signé par une autre clé est refusé.
Windows : installation silencieuse puis redémarrage. macOS : remplacement de l'application. Fedora : installation
du `.rpm` après saisie du mot de passe administrateur (polkit).

Clé de signature : la même que SXM PDF. Clé publique dans `src-tauri/tauri.conf.json` ; secret GitHub
`TAURI_SIGNING_PRIVATE_KEY` (Settings → Secrets and variables → Actions) = contenu de la clé privée de SXM PDF.
Sans ce secret, la publication est refusée.

## Compiler et publier
Voir `CLAUDE.md` (fiche de reprise) : même organisation que SXM PDF.
- Chaque PR et chaque envoi sur `main` : audit, tests Rust / JavaScript / interface, installateurs Windows,
  Fedora 45 et macOS construits, installés et lancés (onglet **Actions**).
- Publier : version dans `package.json`, `src-tauri/Cargo.toml` et `src-tauri/tauri.conf.json`, première section
  de `CHANGELOG.md`, puis envoi sur la branche `publier`. La publication échoue si la version existe déjà.

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
