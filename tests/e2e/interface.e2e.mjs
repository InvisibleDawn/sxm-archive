// Parcours de l'interface dans Chrome sans écran, sous la CSP de production. Lancer : npm run test:e2e
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { start, callsOf } from "./harness.mjs";

const { page, errors, close } = await start();
after(close);
const shots = process.env.SXM_SHOTS; // dossier où enregistrer des captures (facultatif)
const shot = async (n) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: `${shots}/${n}.png` }); } };
const click = (sel) => page.click(sel);
const open = async (file = "/d/Projet.7z") => {
  await page.evaluate(async (f) => (await import("/src/archive.js")).loadArchive(f), file).catch(() => {});
};
// L'interface compilée n'expose pas ses modules : on passe par les actions, comme un utilisateur.
const openViaButton = async (file = "/d/Projet.7z") => {
  await page.evaluate((f) => window.__mock.picks.push(f), file);
  await click('.home-card[data-act="open"]');
  await page.waitForTimeout(300);
};
const rows = () => page.$$eval("#rows tr", (t) => t.map((r) => r.querySelector("td.name span").textContent));

test("accueil : cartes, barre latérale, aucun bouton d'archive actif", async () => {
  await shot("1-accueil");
  assert.equal(await page.$$eval(".home-card", (c) => c.length), 6);
  assert.ok(await page.$eval("body", (b) => b.classList.contains("at-home")));
  assert.ok(await page.$eval('.rib-panel [data-act="test"]', (b) => b.disabled));
  assert.equal(await page.$eval("#app-version", (e) => e.textContent), "v3.0.0");
});

test("ouvrir une archive, naviguer, chercher, trier", async () => {
  await openViaButton();
  assert.ok(!(await page.$eval("body", (b) => b.classList.contains("at-home"))));
  assert.deepEqual(await rows(), ["Projet"]);
  await page.dblclick("#rows tr");
  await page.waitForTimeout(150);
  assert.deepEqual(await rows(), ["Docs", "Photos", "installer.exe", "notes.txt"]);
  assert.match(await page.$eval("#crumbs", (e) => e.textContent), /Projet\.7z.*Projet/);
  await shot("2-archive");
  // taille d'un dossier = somme de son contenu
  const photos = await page.$$eval("#rows tr", (t) => t.find((r) => r.textContent.includes("Photos")).children[1].textContent);
  assert.equal(photos, "5,2 Mo");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(100);
  assert.deepEqual(await rows(), ["Projet"]);
  await page.fill("#filter", "budget");
  await page.waitForTimeout(100);
  assert.deepEqual(await rows(), ["Projet/Docs/budget.xlsx"]);
  await page.fill("#filter", "");
  assert.match(await page.$eval("#status-left", (e) => e.textContent), /3 dossier\(s\) et 6 fichier\(s\)/);
});

test("extraire la sélection : seuls les éléments choisis sont envoyés au moteur", async () => {
  await page.dblclick("#rows tr");
  await page.waitForTimeout(100);
  await page.click("#rows tr:nth-child(1)");
  await page.click("#rows tr:nth-child(4)", { modifiers: ["Control"] });
  await page.evaluate(() => window.__mock.picks.push("/d/sortie"));
  await page.click('[data-rib="archive"]');
  await click('.rib-panel [data-act="extract-sel"]');
  await page.waitForTimeout(300);
  const [req] = (await callsOf(page, "extract")).map((a) => a.req);
  assert.deepEqual(req.members.sort(), ["Projet/Docs", "Projet/notes.txt"]);
  assert.equal(req.dest, "/d/sortie");
  assert.equal(req.uniqueDest, false);
});

test("extraire ici : dossier libre à côté de l'archive", async () => {
  await page.evaluate(() => (window.__calls.length = 0));
  await page.click("#rows tr:nth-child(1)");
  await page.keyboard.press("Escape");
  await click('.rib-panel:not(.hidden) [data-act="extract-here"]');
  await page.waitForTimeout(300);
  const [req] = (await callsOf(page, "extract")).map((a) => a.req);
  assert.equal(req.dest, "/d/Projet");
  assert.equal(req.uniqueDest, true);
});

test("ouvrir un programme contenu dans l'archive demande une confirmation", async () => {
  await page.evaluate(() => (window.__calls.length = 0));
  const exe = await page.$$("#rows tr");
  for (const r of exe) if ((await r.textContent()).includes("installer.exe")) await r.dblclick();
  await page.waitForTimeout(300);
  assert.match(await page.$eval(".modal", (m) => m.textContent), /potentiellement dangereux/);
  await shot("3-programme");
  await page.click(".modal .btn.accent");
  await page.waitForTimeout(300);
  const reqs = (await callsOf(page, "open_member")).map((a) => a.req);
  assert.deepEqual(reqs.map((r) => r.allowDangerous), [false, true]);
});

test("créer une archive : mots de passe différents refusés, écrasement demandé", async () => {
  await page.evaluate(() => { window.__calls.length = 0; window.__mock.picks.push(["/d/a/un.txt", "/e/b/deux.txt"]); window.__mock.existing.add("/d/a/a.7z"); });
  await click('.top-actions [data-act="compress"]');
  await page.waitForTimeout(300);
  await page.click('.modal .seg button[data-v="7z"]');
  await page.check(".modal input[type=checkbox] >> nth=0");
  await page.fill(".modal input[placeholder='Mot de passe']", "Mot \"de\" passe");
  await page.fill(".modal input[placeholder='Confirmer']", "autre");
  await shot("4-creer");
  await page.click(".modal .btn.accent");
  assert.match(await page.$eval(".modal .err-line", (e) => e.textContent), /ne correspondent pas/);
  await page.fill(".modal input[placeholder='Confirmer']", "Mot \"de\" passe");
  await page.click(".modal .btn.accent");
  await page.waitForTimeout(300);
  assert.match(await page.$eval(".modal", (m) => m.textContent), /existe déjà/);
  await page.click(".modal .btn.accent"); // Remplacer
  await page.waitForTimeout(400);
  const [req] = (await callsOf(page, "compress")).map((a) => a.req);
  assert.deepEqual(req.files, ["/d/a/un.txt", "/e/b/deux.txt"]);
  assert.equal(req.out, "/d/a/a.7z");
  assert.equal(req.format, "7z");
  assert.equal(req.password, "Mot \"de\" passe");
  assert.equal(req.overwrite, true);
});

test("archive protégée : le mot de passe est demandé puis redemandé s'il est faux", async () => {
  await page.evaluate(() => { window.__calls.length = 0; window.__mock.listPassword = "secret"; window.__mock.picks.push("/d/prive.7z"); });
  await click('[data-act="home"]');
  await click('.home-card[data-act="open"]');
  await page.waitForTimeout(300);
  assert.match(await page.$eval(".modal", (m) => m.textContent), /Mot de passe requis/);
  await page.fill(".modal input[type=password]", "faux");
  await page.click(".modal .btn.accent");
  await page.waitForTimeout(300);
  assert.match(await page.$eval(".modal", (m) => m.textContent), /incorrect/);
  await page.fill(".modal input[type=password]", "secret");
  await page.click(".modal .btn.accent");
  await page.waitForTimeout(300);
  assert.equal(await page.$eval("#doc-name", (e) => e.textContent), "prive.7z");
  assert.ok(!(await page.$eval('[data-act="forget-pw"]', (b) => b.disabled)));
  await page.evaluate(() => (window.__mock.listPassword = null));
});

test("carte de mise à jour discrète, sans installation automatique", async () => {
  await page.evaluate(() => { window.__mock.update = { version: "3.1.0", current: "3.0.0", notes: "- Nouveauté" }; });
  await click('.top-actions [data-menu="more"]');
  await click('#menu-more [data-act="updates"]');
  await page.waitForTimeout(400);
  assert.match(await page.$eval(".modal", (m) => m.textContent), /3\.1\.0 est disponible/);
  await shot("5-mise-a-jour");
  assert.equal((await callsOf(page, "update_install")).length, 0);
  await page.keyboard.press("Escape");
});

test("version publiée sans signature : « Télécharger » ouvre la page, rien n'est installé", async () => {
  await page.evaluate(() => { window.__mock.update = { version: "3.1.0", current: "3.0.0", notes: "", manual: true }; });
  await click('.top-actions [data-menu="more"]');
  await click('#menu-more [data-act="updates"]');
  await page.waitForTimeout(400);
  assert.match(await page.$eval(".modal", (m) => m.textContent), /Téléchargez la nouvelle version/);
  await page.click(".modal .btn.accent");
  await page.waitForTimeout(300);
  const urls = (await callsOf(page, "open_external")).map((c) => c.url);
  assert.ok(urls.includes("https://github.com/InvisibleDawn/sxm-archive/releases/tag/v3.1.0"), urls.join(", "));
  assert.equal((await callsOf(page, "update_install")).length, 0);
  await page.evaluate(() => (window.__mock.update = null));
});

test("thème sombre et aucune erreur JavaScript", async () => {
  await click('[data-act="theme"]');
  assert.equal(await page.$eval("html", (h) => h.dataset.theme), "dark");
  await click('[data-act="home"]');
  await shot("6-sombre");
  await click('[data-act="theme"]');
  assert.deepEqual(errors, []);
});
