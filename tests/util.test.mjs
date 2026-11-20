// Fonctions pures de l'interface (npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { useEnglishUnits, basename, defaultArchiveName, dirname, fmtDate, human, indexEntries, join, passwordProblem, rowsFor, safeFileName, stats, stripArchiveExt, typeOf } from "../src/util.js";

test("chemins Windows et Linux", () => {
  assert.equal(basename("C:\\Users\\Laurent\\Documents\\photos.zip"), "photos.zip");
  assert.equal(dirname("C:\\Users\\Laurent\\photos.zip"), "C:\\Users\\Laurent");
  assert.equal(basename("/home/laurent/Projet/"), "Projet");
  assert.equal(dirname("/home/laurent/a.7z"), "/home/laurent");
  assert.equal(dirname("/a.7z"), "/");
  assert.equal(join("/home/l", "x.zip", "/"), "/home/l/x.zip");
  assert.equal(join("C:\\", "x.zip", "\\"), "C:\\x.zip");
});

test("noms d'archive", () => {
  assert.equal(stripArchiveExt("photos.tar.gz"), "photos");
  assert.equal(stripArchiveExt("Doc.ZIP"), "Doc");
  assert.equal(stripArchiveExt("rapport.pdf"), "rapport.pdf");
  assert.equal(defaultArchiveName(["/d/Été 2026.docx"]), "Été 2026");
  assert.equal(defaultArchiveName(["/d/Vacances/a.jpg", "/d/Vacances/b.jpg"]), "Vacances");
  assert.equal(defaultArchiveName(["/d/Dossier"]), "Dossier");
  assert.equal(safeFileName(' a/b:c*?"<>| . '), "a_b_c______");
  assert.equal(safeFileName("normal"), "normal");
});

test("tailles, dates, types", () => {
  assert.equal(human(0), "0 o");
  assert.equal(human(900), "900 o");
  assert.equal(human(5452595), "5,2 Mo");
  assert.equal(fmtDate("2026-11-20 14:03:11"), "20/11/2026 14:03");
  assert.equal(fmtDate(""), "");
  assert.deepEqual(typeOf("x", true), ["Dossier", "folder", "ic-folder"]);
  assert.equal(typeOf("IMG.JPG", false)[0], "Image");
  assert.equal(typeOf("setup.exe", false)[0], "Programme ou code");
  assert.equal(typeOf("data.bin", false)[0], "Fichier BIN");
  assert.equal(typeOf("LISEZMOI", false)[0], "Fichier");
});

test("dossiers implicites, tailles cumulées, chemins dangereux", () => {
  const e = [
    { path: "A/B/c.txt", size: 10, packed: 5, dir: false },
    { path: "A/d.txt", size: 20, packed: 8, dir: false },
    { path: "../../evil.txt", size: 1, packed: 1, dir: false, unsafe_path: true },
  ];
  const all = indexEntries(e);
  const get = (p) => all.find((x) => x.path === p);
  assert.ok(get("A").dir && get("A/B").dir);
  assert.equal(get("A").size, 30);
  assert.equal(get("A/B").packed, 5);
  assert.equal(all.filter((x) => x.path.startsWith("..")).length, 1, "aucun faux dossier « .. »");
  assert.deepEqual(rowsFor(all, "").map((r) => r.name), ["A", "../../evil.txt"]);
  assert.deepEqual(rowsFor(all, "A").map((r) => r.name), ["B", "d.txt"]);
  assert.deepEqual(rowsFor(all, "", "C.T").map((r) => r.name), ["A/B/c.txt"]);
  assert.deepEqual(rowsFor(all, "A", "", { key: "size", desc: true }).map((r) => r.name), ["B", "d.txt"]);
  assert.deepEqual(stats(all), { files: 3, dirs: 2, size: 31 });
});

test("mots de passe : seul le retour à la ligne est refusé", () => {
  assert.equal(passwordProblem('Mot "de" passe é & ^ %'), "");
  assert.notEqual(passwordProblem("a\nb"), "");
  assert.notEqual(passwordProblem("a\rb"), "");
});

test("unités en anglais", () => {
  useEnglishUnits();
  assert.equal(human(5452595), "5.2 MB");
  assert.equal(human(0), "0 B");
});
