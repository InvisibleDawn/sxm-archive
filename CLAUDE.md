# SXM Archive — fiche de reprise du projet

Gestionnaire d'archives de bureau (Tauri 2 : interface JavaScript + Rust) d'Invisible_Dawn, de la gamme SXM
(même famille que SXM PDF : design, organisation du code, compilation, mises à jour).
Nom public dans l'appli : **Invisible_Dawn** (À propos, copyright, métadonnées). Ne jamais afficher le vrai nom.
Répondre en français. Dépôt : github.com/InvisibleDawn/sxm-archive.

## Fonctions
Ouvrir / parcourir RAR, ZIP, 7z, tar.gz (et tar, gz), extraire tout ou une sélection, extraire ici (dossier
libre), créer ZIP / 7z / tar.gz (plusieurs dossiers sources), mot de passe AES-256 (ZIP, 7z ; noms chiffrés
en 7z), convertir entre formats, tester l'intégrité, informations, ouvrir un fichier de l'archive, annuler une
opération, glisser-déposer, clic droit Explorateur / Caja / Nemo, thème clair/sombre, interface FR/EN,
mises à jour signées (Windows, macOS, Fedora .rpm).

## Organisation du code (même découpage que SXM PDF)
- `index.html` + `src/` (Vite) : `main.js` (actions, raccourcis, glisser-déposer), `archive.js` (vue d'une
  archive), `ops.js` (compresser, extraire, tester, convertir), `api.js` (commandes Rust + messages d'erreur),
  `util.js` (fonctions pures, testées), `update.js`, `app.js` (thème, À propos, langue, épinglage),
  `core.js`, `store.js` ; repris tels quels de SXM PDF : `ui.js`, `tooltip.js`, `i18n.js`.
- `src/style.css` : blocs repris de SXM PDF (design v3), puis règles propres aux archives à la fin.
- Rust `src-tauri/src/` : `engine.rs` (pilote 7-Zip + 17 tests), `main.rs` (commandes), `files.rs` (dossier
  temporaire privé), `system.rs` (ouvrir, afficher, épingler, menu macOS), `update.rs`.
- **Mots de passe transmis à 7-Zip par l'entrée standard** (jamais dans la ligne de commande) : guillemets et
  accents acceptés ; seuls les retours à la ligne sont refusés.
- Aucun écrasement silencieux : compression dans un `.sxmpart` puis renommage ; extraction `-aou`.
- Temporaires : `$XDG_RUNTIME_DIR/sxm-archive` (Linux, 0700) ou `%TEMP%`, nettoyés au démarrage (> 24 h).
- 7-Zip 25.01 n'est pas dans le dépôt : téléchargé et vérifié (SHA-256, `third_party/7zip.sha256`) à chaque
  compilation. Pour tester en local : mettre `7zz` (Linux) dans `src-tauri/bin/`.
- **Tout nouveau texte affiché en français doit être ajouté à `src/i18n-en.js`** (sinon `anglais.e2e.mjs` échoue).

## Tests
- `npm test` (fonctions pures, dictionnaire), `npm run test:e2e` (interface compilée sous la CSP de production,
  Chrome sans écran, faux moteur : `tests/e2e/harness.mjs` ; `SXM_SHOTS=dossier` enregistre des captures),
  `cargo test` dans `src-tauri` (moteur réel avec 7-Zip, archives RAR de test dans `tests/fixtures`).

## Compilation et publication
- Fedora : `npm install && npx tauri build --bundles rpm`.
- GitHub Actions « Compiler SXM Archive » : à chaque PR / envoi sur main, audit + tests + installateurs
  Windows, Fedora 45 (conteneur) et macOS (macos-15-intel, universel), chacun installé et lancé.
- Publier : mettre la version dans `package.json`, `tauri.conf.json`, `Cargo.toml`, écrire la 1re section du
  CHANGELOG, puis `git push -f origin HEAD:publier` (le proxy des sessions Claude refuse la création de tags).
  `vX.Y.Z-beta.N` = version de test (canal bêta, sans .msi). La publication **échoue si la version existe
  déjà** (jamais de suppression de release ni de tag).
- Mises à jour : même clé que SXM PDF. Clé publique dans `tauri.conf.json` ; secret GitHub
  `TAURI_SIGNING_PRIVATE_KEY` = contenu du fichier « SXM-PDF-cle-mises-a-jour.txt » d'Invisible_Dawn.
  Les sessions Claude ne peuvent ni lire ni écrire les secrets : c'est Invisible_Dawn qui l'ajoute.
  **Le secret est facultatif** (choix d'Invisible_Dawn) : sans lui, la publication passe quand même, latest.json
  ne contient que version + nouveautés, et l'appli propose « Télécharger » (ouvre la page de la version) au lieu
  d'installer. Dès que le secret existe, l'installation signée redevient automatique, sans rien changer d'autre.
  Ne pas redemander le secret à Invisible_Dawn.

## Historique
- 1.x : version GTK3 pour MATE. 2.0 : Electron (bloqué par Windows). 2.1–2.3 : Tauri (voir CHANGELOG).
- 3.0.0 (20/11/2026) : refonte complète sur le modèle de SXM PDF.

## Reste à faire
1. Essais réels Windows 10/11, macOS, Fedora MATE (interface, clic droit, mise à jour 3.0.0 → 3.0.1).
2. Signature des installateurs (certificat Windows, compte développeur Apple) — commune à la gamme SXM.
