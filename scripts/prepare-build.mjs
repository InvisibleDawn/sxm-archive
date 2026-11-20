// Avant `tauri build` sur GitHub : active les fichiers de mise à jour signés si la clé est disponible.
// Une compilation qui publie (branche publier ou tag) sans clé échoue : on ne publie jamais une version
// incapable de recevoir les mises à jour suivantes.
import fs from "node:fs";

const f = "src-tauri/tauri.conf.json";
const c = JSON.parse(fs.readFileSync(f, "utf8"));
const hasKey = process.env.HAS_KEY === "true";
const publish = process.env.PUBLISH === "true";
if (publish && !hasKey) {
  console.error("::error::Publication demandée sans le secret TAURI_SIGNING_PRIVATE_KEY (clé de mise à jour de SXM PDF).");
  process.exit(1);
}
if (hasKey) c.bundle.createUpdaterArtifacts = true;
fs.writeFileSync(f, JSON.stringify(c, null, 2));
console.log(`version ${c.version} — fichiers de mise à jour signés : ${hasKey ? "oui" : "non (clé absente)"}`);
