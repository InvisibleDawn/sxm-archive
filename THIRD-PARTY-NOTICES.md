# Composants tiers — SXM Archive

SXM Archive © 2026 Invisible_Dawn. L'application intègre ou utilise les composants libres suivants.

## 7-Zip 25.01 (moteur d'archivage)
- Auteur : Igor Pavlov — https://www.7-zip.org
- Licence : GNU LGPL 2.1 ou ultérieure, avec la **restriction unRAR** (le code de décompression RAR ne peut
  pas être utilisé pour développer un logiciel capable de recréer l'algorithme de compression RAR), et
  licence BSD pour certaines parties. Texte complet installé avec l'application : `bin/License.txt`
  (Fedora : `/usr/share/licenses/sxm-archive/7-Zip-License.txt`).
- Utilisé sans modification, comme programme externe (`7z.exe` + `7z.dll` sous Windows, `7zz` sous Linux
  et macOS). Provenance et empreintes SHA-256 vérifiées : voir `third_party/README.md` du dépôt.

## Tauri 2 et ses modules (dialog, single-instance, updater)
- https://tauri.app — licences MIT ou Apache 2.0.

## Lucide (icônes)
- https://lucide.dev — licence ISC.

## Vite (outil de compilation de l'interface, non distribué)
- https://vitejs.dev — licence MIT.
