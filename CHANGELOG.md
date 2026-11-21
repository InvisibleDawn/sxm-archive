# Journal des modifications — SXM Archive

## 3.0.0 — 20/11/2026
Refonte complète sur le modèle de SXM PDF.
- Nouvelle interface de la famille SXM : barre latérale à libellés, accueil illustré, ruban simplifié, thème clair / sombre, info-bulles.
- Interface en français ou en anglais (automatique selon le système, réglable dans À propos).
- Mots de passe transmis au moteur 7-Zip sans passer par la ligne de commande : ils ne sont plus visibles par les autres programmes, et les guillemets sont désormais acceptés (aussi sous Windows).
- Fichiers temporaires dans un dossier privé à l'utilisateur, nettoyés automatiquement.
- Mises à jour signées, comme SXM PDF : petite carte discrète, jamais d'installation sans votre clic, versions de test (bêta) en option. Quand une version n'a pas de fichier signé, la carte propose « Télécharger » et ouvre la page de la version.
- Ouverture d'un programme ou d'un script contenu dans une archive : confirmation demandée.
- Épingler l'application (favoris GNOME, Dock macOS, aide pour Windows et MATE).
- Windows, Fedora et macOS (Intel et Apple Silicon) compilés, installés et testés à chaque version.

## 2.3.0 — 20/11/2026
- Mises à jour intégrées signées, version macOS universelle.

## 2.2.0 — 19/11/2026
- Sécurisation : pas d'écrasement silencieux, contrôle des chemins (Zip Slip), annulation, codes de retour 7-Zip, 7-Zip vérifié par SHA-256, paquet Fedora.

## 2.1.0 — 18/11/2026
- Passage à Tauri, compilation sur une vraie machine Windows.
