// Fonctions pures (sans interface ni Tauri) : testées par `npm test`.

export const ARC_RE = /\.(zip|7z|rar|tar\.gz|tgz|tar|gz)$/i;
export const FORMATS = { zip: ".zip", "7z": ".7z", "tar.gz": ".tar.gz" };
/** Niveaux proposés (valeur 7-Zip -mx). */
export const LEVELS = [["Stockage (aucune compression)", 0], ["Très rapide", 1], ["Rapide", 3], ["Normale", 5], ["Maximale", 7], ["Ultra", 9]];

export const basename = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || "";
export const dirname = (p) => {
  const s = String(p);
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  return i <= 0 ? (i === 0 ? s.slice(0, 1) : "") : s.slice(0, i);
};
export const join = (dir, name, sep) => (dir.endsWith(sep) ? dir + name : dir + sep + name);

/** « photos.tar.gz » → « photos » ; « doc.pdf » reste « doc.pdf ». */
export function stripArchiveExt(name) {
  const m = String(name).match(ARC_RE);
  return m ? name.slice(0, -m[0].length) : name;
}

/** Nom proposé pour une archive : nom du fichier unique (sans extension) ou du dossier parent. */
export function defaultArchiveName(files) {
  if (files.length === 1) {
    const b = basename(files[0]);
    const noExt = b.replace(/\.[^.]+$/, "");
    return noExt || b || "archive";
  }
  return basename(dirname(files[0])) || "archive";
}

/** Caractères interdits dans un nom de fichier Windows (et donc partout pour rester portable). */
export const safeFileName = (s) => String(s).trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/, "");

let UNITS = ["o", "Ko", "Mo", "Go", "To"], DEC = ",";
/** Interface en anglais : B, KB, MB… et point décimal. */
export function useEnglishUnits() { UNITS = ["B", "KB", "MB", "GB", "TB"]; DEC = "."; }

export function human(n) {
  if (!n) return "0 " + UNITS[0];
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(1).replace(".", DEC) : String(n)) + " " + UNITS[i];
}

/** « 2026-11-20 14:03:11 » (7-Zip) → « 20/11/2026 14:03 ». */
export function fmtDate(d) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/.exec(d || "");
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : "";
}

const TYPES = [
  [/\.(jpe?g|png|gif|bmp|webp|svg|heic|tiff?)$/i, "Image", "file-image", "ic-img"],
  [/\.(mp3|wav|flac|ogg|m4a|aac|wma)$/i, "Audio", "file-music", "ic-audio"],
  [/\.(mp4|mkv|avi|mov|wmv|webm)$/i, "Vidéo", "file-video", "ic-video"],
  [/\.pdf$/i, "Document PDF", "file-text", "ic-arc"],
  [/\.(docx?|odt|rtf|txt|md|xlsx?|ods|csv|pptx?|odp)$/i, "Document", "file-text", "ic-doc"],
  [/\.(js|ts|py|sh|bat|cmd|ps1|html?|css|json|xml|c|cpp|h|java|rs|go|php|exe|dll|msi)$/i, "Programme ou code", "file-code", "ic-code"],
  [/\.(zip|7z|rar|gz|tgz|tar|xz|bz2)$/i, "Archive", "file-archive", "ic-arc"],
];
/** [libellé, icône lucide, classe de couleur] */
export function typeOf(name, dir) {
  if (dir) return ["Dossier", "folder", "ic-folder"];
  for (const [re, t, i, c] of TYPES) if (re.test(name)) return [t, i, c];
  const ext = name.includes(".") ? name.split(".").pop().toUpperCase() : "";
  return [ext ? `Fichier ${ext}` : "Fichier", "file", "ic-file"];
}

/**
 * Prépare la liste renvoyée par le moteur : ajoute les dossiers implicites (archives ZIP sans
 * entrées de dossier) et calcule une fois pour toutes la taille de chaque dossier.
 * Les chemins dangereux (« .. », absolus) ne créent pas de faux dossiers : ils restent à la racine.
 */
export function indexEntries(entries) {
  const all = entries.map((e) => ({ ...e }));
  const seen = new Set(all.map((e) => e.path));
  for (const e of entries) {
    if (e.unsafe_path) continue;
    const parts = e.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join("/");
      if (!seen.has(d)) { seen.add(d); all.push({ path: d, size: 0, packed: 0, date: "", dir: true, encrypted: false }); }
    }
  }
  const agg = new Map();
  for (const e of all) {
    if (e.dir || e.unsafe_path) continue;
    let i = e.path.lastIndexOf("/");
    while (i > 0) {
      const d = e.path.slice(0, i);
      const g = agg.get(d) || { size: 0, packed: 0 };
      g.size += e.size; g.packed += e.packed; agg.set(d, g);
      i = d.lastIndexOf("/");
    }
  }
  for (const e of all) if (e.dir) { const g = agg.get(e.path); e.size = g?.size || 0; e.packed = g?.packed || 0; }
  return all;
}

/** Éléments à afficher dans le dossier `cwd` (ou résultats de recherche si `filter`). */
export function rowsFor(all, cwd, filter = "", sort = { key: "name", desc: false }) {
  const prefix = cwd ? cwd + "/" : "";
  const q = filter.trim().toLowerCase();
  let rows;
  if (q) rows = all.filter((e) => basename(e.path).toLowerCase().includes(q)).map((e) => ({ ...e, name: e.path }));
  else rows = all.filter((e) => (e.unsafe_path ? !prefix
    : e.path.startsWith(prefix) && e.path.length > prefix.length && !e.path.slice(prefix.length).includes("/")))
    .map((e) => ({ ...e, name: e.unsafe_path ? e.path : e.path.slice(prefix.length) }));
  const { key, desc } = sort;
  rows.sort((x, y) => {
    if (x.dir !== y.dir) return x.dir ? -1 : 1;
    const v = key === "type" ? typeOf(x.name, x.dir)[0].localeCompare(typeOf(y.name, y.dir)[0])
      : key === "name" || key === "date" ? String(x[key]).localeCompare(String(y[key]), "fr", { numeric: true })
      : x[key] - y[key];
    return desc ? -v : v;
  });
  return rows;
}

export function stats(all) {
  const files = all.filter((e) => !e.dir);
  return { files: files.length, dirs: all.length - files.length, size: files.reduce((s, e) => s + e.size, 0) };
}

/** Mot de passe acceptable pour 7-Zip (transmis par l'entrée standard) : pas de retour à la ligne. */
export const passwordProblem = (p) => (/[\r\n\u0000]/.test(p) ? "Le mot de passe ne doit pas contenir de retour à la ligne." : "");
