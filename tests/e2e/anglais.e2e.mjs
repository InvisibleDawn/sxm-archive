// Interface en anglais : parcourt l'accueil, l'archive, le ruban, les menus et les fenêtres principales,
// et vérifie qu'aucun texte français ne reste affiché (sauf noms de fichiers). Lancer : npm run test:e2e
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { start } from "./harness.mjs";

const root = process.cwd();
const { page, errors, close } = await start({ lang: "en" });
after(close);

const FRW = /[éèêàçùôîâûœ«»]|\b(le|la|les|des|du|une|un|pour|avec|sur|dans|vos|votre|est|sont|pas|ou|et|au|aux|ce|cette|à)\b/i;
const { EN } = await import(root + "/src/i18n-en.js");
const enWords = new Set(Object.values(EN).join(" ").toLowerCase().match(/[a-zà-ÿ]{4,}/g) || []);
const frVocab = new Set((Object.keys(EN).join(" ").toLowerCase().match(/[a-zà-ÿ]{4,}/g) || []).filter((w) => !enWords.has(w)));
const isFr = (t) => FRW.test(t) || (t.toLowerCase().match(/[a-zà-ÿ]{4,}/g) || []).some((w) => frVocab.has(w));
const found = new Map();
async function collect(where) {
  const list = await page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const e = n.nodeType === 1 ? n : n.parentElement;
      if (e.closest("[data-no-tr], script, style, pre")) continue;
      if (e.closest(".hidden, [hidden]") || getComputedStyle(e).display === "none") continue;
      if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) out.push(t); }
      else for (const a of ["title", "placeholder", "aria-label", "data-tip"]) { const v = n.getAttribute(a); if (v) out.push("@" + a + ": " + v); }
    }
    return out;
  });
  // les noms de fichiers cités entre guillemets typographiques ne sont pas du texte d'interface
  for (const t of list) if (isFr(t.replace(/^@[\w-]+: /, "").replace(/“[^”]*”/g, "")) && !found.has(t)) found.set(t, where);
}
const esc = async () => { for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(120); } };
const act = async (sel, where) => { await page.click(sel); await page.waitForTimeout(400); await collect(where); await esc(); };

await collect("accueil");
for (const r of ["home", "archive", "security", "tools"]) { await page.click(`[data-rib="${r}"]`); await page.waitForTimeout(100); await collect("ruban " + r); }
await page.click('[data-menu="more"]'); await page.waitForTimeout(150); await collect("menu ⋯"); await esc();
await page.evaluate(() => window.__mock.picks.push(["/d/a/un.txt", "/d/a/deux.txt"]));
await act('.top-actions [data-act="compress"]', "créer");
await page.evaluate(() => window.__mock.picks.push(["/d/a/un.txt"]));
await act('.home-card[data-act="protect"]', "protéger");
await act('[data-act="about"]', "à propos");
await page.evaluate(() => (window.__mock.update = { version: "3.1.0", current: "3.0.0", notes: "x" }));
await page.click('[data-rib="tools"]'); await act('.rib-panel [data-act="updates"]', "mise à jour");
// archive ouverte
await page.evaluate(() => window.__mock.picks.push("/d/Projet.7z"));
await page.click('.home-card[data-act="open"]'); await page.waitForTimeout(400);
await collect("archive");
await page.dblclick("#rows tr"); await page.waitForTimeout(200); await collect("dossier");
for (const r of ["home", "archive", "security", "tools"]) { await page.click(`[data-rib="${r}"]`); await page.waitForTimeout(100); await collect("ruban (archive) " + r); }
await page.click('[data-rib="home"]');
await act('.rib-panel [data-act="info"]', "infos");
await act('.rib-panel [data-act="test"]', "test");
await act('[data-act="convert"]', "convertir");
const rows = await page.$$("#rows tr");
for (const r of rows) if ((await r.textContent()).includes("installer.exe")) { await r.dblclick(); await page.waitForTimeout(400); await collect("programme"); await esc(); }
// mot de passe
await page.evaluate(() => { window.__mock.listPassword = "x"; window.__mock.picks.push("/d/prive.7z"); });
await page.click('.top-actions [data-act="open"]'); await page.waitForTimeout(400); await collect("mot de passe"); await esc();

test("anglais : aucun texte français visible", () => {
  found.delete("Français");
  assert.deepEqual([...found].map(([t, w]) => `${w} → ${t}`), []);
});
test("anglais : aucune erreur JavaScript", () => assert.deepEqual(errors, []));
