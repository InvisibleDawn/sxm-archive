// Accès au moteur (commandes Rust) et aux fenêtres système. Les erreurs du moteur arrivent sous la
// forme { error: "CODE", detail } ; elles sont traduites en français par errText().
import { invoke, Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export { invoke, Channel };

export const list = (file, password) => invoke("list", { file, password: password || null });
export const extract = (req) => invoke("extract", { req });
export const test = (req) => invoke("test", { req });
export const compress = (req) => invoke("compress", { req });
export const convert = (req) => invoke("convert", { req });
export const openMember = (req) => invoke("open_member", { req });
export const cancel = () => invoke("cancel");
export const stat = (path) => invoke("stat", { path });
export const appInfo = () => invoke("app_info");
export const startupArgs = () => invoke("startup_args");
export const openDir = (path) => invoke("open_dir", { path });
export const reveal = (path) => invoke("reveal", { path });
export const openExternal = (url) => invoke("open_external", { url });
export const pinApp = () => invoke("pin_app");

const ARC = ["zip", "7z", "rar", "gz", "tgz", "tar"];
export const pickArchive = () => open({ title: "Ouvrir une archive", multiple: false,
  filters: [{ name: "Archives", extensions: ARC }, { name: "Tous les fichiers", extensions: ["*"] }] });
export const pickFiles = () => open({ title: "Fichiers à compresser", multiple: true });
export const pickFolders = () => open({ title: "Dossier à compresser", directory: true, multiple: true });
export const pickDest = (defaultPath) => open({ title: "Extraire vers…", directory: true, defaultPath });

export const ERR = {
  PASSWORD_REQUIRED: "Cette archive est protégée : un mot de passe est nécessaire.",
  PASSWORD_WRONG: "Mot de passe incorrect.",
  PASSWORD_CHARS: "Le mot de passe ne doit pas contenir de retour à la ligne.",
  PASSWORD_UNSUPPORTED: "Le format tar.gz ne permet pas de mot de passe : choisissez ZIP ou 7z.",
  EXISTS: "Un fichier portant ce nom existe déjà.",
  DUPLICATE_NAME: "Deux éléments sélectionnés portent le même nom ; renommez-en un ou compressez-les séparément",
  OUTPUT_INSIDE_INPUT: "L'archive ne peut pas être enregistrée à l'intérieur du dossier compressé.",
  NOT_ARCHIVE: "Ce fichier n'est pas une archive reconnue, ou il est endommagé.",
  CORRUPT: "L'archive est endommagée ou incomplète.",
  UNSUPPORTED: "Méthode de compression non prise en charge",
  DISK_FULL: "Espace disque insuffisant.",
  ACCESS_DENIED: "Accès refusé : vérifiez les droits sur le dossier, ou que le fichier n'est pas ouvert ailleurs.",
  OUT_OF_MEMORY: "Mémoire insuffisante pour cette opération.",
  NOT_FOUND: "Fichier introuvable",
  UNSAFE_PATH: "Chemin dangereux refusé",
  IS_DIR: "C'est un dossier.",
  EMPTY: "L'archive est vide.",
  SAME_FILE: "La destination est l'archive d'origine.",
  BUSY: "Une opération est déjà en cours.",
  CANCELLED: "Opération annulée.",
  ENGINE_MISSING: "Moteur 7-Zip introuvable : réinstallez SXM Archive.",
  OPEN_FAILED: "Impossible d'ouvrir le fichier",
  NO_INPUT: "Aucun fichier sélectionné.",
  ENGINE_ERROR: "Erreur 7-Zip",
};

const WITH_DETAIL = new Set(["NOT_FOUND", "UNSAFE_PATH", "DUPLICATE_NAME", "OPEN_FAILED", "ENGINE_ERROR", "UNSUPPORTED"]);

export function errText(r) {
  const base = ERR[r?.error] || ERR.ENGINE_ERROR;
  return (WITH_DETAIL.has(r?.error) || !ERR[r?.error]) && r?.detail ? `${base} : ${r.detail}` : base;
}

export const isPwErr = (r) => r?.error === "PASSWORD_REQUIRED" || r?.error === "PASSWORD_WRONG";
