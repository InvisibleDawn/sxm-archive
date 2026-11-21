// Avant `tauri build` sur GitHub : active les fichiers de mise à jour signés si la clé est disponible.
// Sans clé, la publication reste possible : l'application signale alors les nouvelles versions et ouvre
// la page de téléchargement (pas d'installation automatique, faute de signature).
import fs from "node:fs";

const f = "src-tauri/tauri.conf.json";
const c = JSON.parse(fs.readFileSync(f, "utf8"));
const hasKey = process.env.HAS_KEY === "true";
if (hasKey) c.bundle.createUpdaterArtifacts = true;
fs.writeFileSync(f, JSON.stringify(c, null, 2));
console.log(`version ${c.version} — fichiers de mise à jour signés : ${hasKey ? "oui" : "non (clé absente)"}`);
