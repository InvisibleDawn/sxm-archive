# Composants tiers

## 7-Zip 25.01 (moteur d'archivage)

- Auteur : Igor Pavlov — https://www.7-zip.org
- Licence : GNU LGPL 2.1 ou ultérieure, avec la **restriction unRAR** (le code de décompression RAR
  ne peut pas être utilisé pour développer un compresseur RAR) et la licence BSD pour certaines parties.
  Le texte complet (`License.txt`) est installé avec l'application dans `bin\License.txt`.
- SXM Archive utilise `7z.exe` et `7z.dll` **sans modification**, en tant que programme externe.

### Provenance et intégrité

Les binaires ne sont **pas** stockés dans ce dépôt. À chaque compilation, le workflow :

1. télécharge `7z2501-x64.exe` depuis la release officielle https://github.com/ip7z/7zip/releases/tag/25.01 ;
2. vérifie son empreinte SHA-256 contre `7zip.sha256` ;
3. en extrait `7z.exe`, `7z.dll` et `License.txt`, et vérifie aussi leurs empreintes.

La compilation échoue si une seule empreinte diffère. Il n'y a **aucune mise à jour automatique** :
changer de version de 7-Zip demande de modifier `7zip.sha256` et le workflow, dans une Pull Request.

L'empreinte de l'installateur `7z2501-x64.exe` a été vérifiée le 19/11/2026 auprès de deux sources
indépendantes, qui concordent :

| Source | SHA-256 |
| --- | --- |
| Release GitHub officielle `ip7z/7zip` 25.01 (fichier téléchargé et haché) | `78afa2a1…2b55f` |
| Manifeste winget de Microsoft `7zip.7zip` 25.01 (URL `https://7-zip.org/a/7z2501-x64.exe`) | `78AFA2A1…2B55F` |

Remarque : 7-Zip ne publie pas d'empreintes signées et ses exécutables ne portent pas de signature
Authenticode ; la vérification repose donc sur cette concordance de sources.

L'archive Linux `7z2501-linux-x64.tar.xz` (même release) est intégrée au paquet Fedora (`7zz`) et sert aux tests.

L'archive macOS `7z2501-mac.tar.xz` (binaire universel `7zz`) est vérifiée contre `7zip.sha256` **et** comparée, à
chaque compilation, au fichier téléchargé depuis https://www.7-zip.org/a/7z2501-mac.tar.xz (seconde source
indépendante) ; la compilation macOS échoue si les deux diffèrent.

## Archives RAR de test

`src-tauri/tests/fixtures/*.rar` proviennent du projet rarfile 4.2 (licence ISC, voir
`src-tauri/tests/fixtures/LICENSE-rarfile.txt`). Elles servent uniquement aux tests.
