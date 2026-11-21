// Fichier latest.json lu par SXM Archive pour proposer les mises à jour (signatures incluses).
// Sans signatures (secret absent) : version et nouveautés seulement, l'application ouvre alors la page
// de téléchargement au lieu d'installer.
// Usage : node latest-json.mjs <dossier des fichiers> <tag> <dépôt> <fichier des nouveautés>
import fs from "node:fs";
import path from "node:path";

const [dir, tag, repo, notesFile] = process.argv.slice(2);
const version = tag.replace(/^v/, "");
const base = `https://github.com/${repo}/releases/download/${tag}`;
const files = fs.readdirSync(dir);
const signed = files.some((f) => f.endsWith(".sig"));
const pick = (re) => files.find((f) => re.test(f) && !f.endsWith(".sig"));
const entry = (f) => {
  if (!f) return null;
  const sig = path.join(dir, f + ".sig");
  if (!fs.existsSync(sig)) {
    if (signed) throw new Error(`signature manquante pour ${f}`);
    return null;
  }
  return { url: `${base}/${encodeURIComponent(f)}`, signature: fs.readFileSync(sig, "utf8").trim() };
};
const platforms = {};
const nsis = entry(pick(/-setup\.exe$/i));
if (nsis) Object.assign(platforms, { "windows-x86_64": nsis, "windows-x86_64-nsis": nsis });
const msi = entry(pick(/\.msi$/i));
if (msi) platforms["windows-x86_64-msi"] = msi;
const mac = entry(pick(/\.app\.tar\.gz$/i));
if (mac) for (const a of ["darwin-x86_64", "darwin-aarch64"]) { platforms[a] = mac; platforms[`${a}-app`] = mac; }
const rpm = entry(pick(/\.rpm$/i));
if (rpm) platforms["linux-x86_64-rpm"] = rpm;
const deb = entry(pick(/\.deb$/i));
if (deb) platforms["linux-x86_64-deb"] = deb;
if (signed) for (const need of ["windows-x86_64", "darwin-aarch64", "linux-x86_64-rpm", "linux-x86_64-deb"]) {
  if (!platforms[need]) throw new Error(`plate-forme absente du manifeste : ${need}`);
}
const notes = notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf8").trim() : `SXM Archive ${version}`;
fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2));
console.log("latest.json :", Object.keys(platforms).join(", "));
