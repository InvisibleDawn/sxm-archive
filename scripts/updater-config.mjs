// Prépare la configuration du module de mise à jour pour `tauri build`.
// Si la clé publique (variable de dépôt TAURI_UPDATER_PUBKEY) ET la clé privée (secret
// TAURI_SIGNING_PRIVATE_KEY) sont présentes, écrit updater.conf.json et affiche
// « --config updater.conf.json » ; sinon n'affiche rien (compilation sans mises à jour).
import { writeFileSync } from 'node:fs';

const pubkey = (process.env.TAURI_UPDATER_PUBKEY || '').trim();
const signing = (process.env.TAURI_SIGNING_PRIVATE_KEY || '').trim();
if (!pubkey || !signing) {
  console.error('Mises à jour intégrées : DÉSACTIVÉES (clé publique ou secret de signature absent)');
  process.exit(0);
}
const repo = process.env.GITHUB_REPOSITORY || 'InvisibleDawn/sxm-archive';
writeFileSync('updater.conf.json', JSON.stringify({
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      pubkey,
      endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`],
      windows: { installMode: 'passive' },
    },
  },
}, null, 2));
console.error('Mises à jour intégrées : ACTIVÉES');
console.log('--config updater.conf.json');
