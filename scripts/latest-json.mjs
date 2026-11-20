// Construit latest.json (manifeste du module de mise à jour) à partir des installateurs signés.
// Usage : node scripts/latest-json.mjs <dossier> <tag> <dépôt>
// Le dossier contient les fichiers déjà renommés pour la release et leurs « .sig ».
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, tag, repo] = process.argv.slice(2);
const version = tag.replace(/^v/, '');
const files = readdirSync(dir);
const url = (f) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(f)}`;
const entry = (re) => {
  const f = files.find((x) => re.test(x) && !x.endsWith('.sig'));
  if (!f) return null;
  const sig = files.includes(f + '.sig') ? readFileSync(join(dir, f + '.sig'), 'utf8').trim() : null;
  if (!sig) throw new Error(`signature manquante pour ${f}`);
  return { signature: sig, url: url(f) };
};
const nsis = entry(/-setup\.exe$/i);
const msi = entry(/\.msi$/i);
const mac = entry(/\.app\.tar\.gz$/i);
const rpm = entry(/\.rpm$/i);
const platforms = {};
if (nsis) Object.assign(platforms, { 'windows-x86_64': nsis, 'windows-x86_64-nsis': nsis });
if (msi) platforms['windows-x86_64-msi'] = msi;
if (mac) {
  for (const a of ['darwin-aarch64', 'darwin-x86_64']) { platforms[a] = mac; platforms[`${a}-app`] = mac; }
}
if (rpm) platforms['linux-x86_64-rpm'] = rpm;
for (const need of ['windows-x86_64', 'windows-x86_64-msi', 'darwin-aarch64', 'linux-x86_64-rpm']) {
  if (!platforms[need]) throw new Error(`plate-forme absente du manifeste : ${need}`);
}
const notes = process.env.RELEASE_NOTES || `SXM Archive ${version}`;
writeFileSync(join(dir, 'latest.json'), JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2));
console.log(JSON.stringify(Object.keys(platforms)));
