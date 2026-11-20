// Dictionnaire anglais : modèles valides, pas de clé vide, pas de texte resté en français.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EN, EN_PATTERNS } from "../src/i18n-en.js";

test("chaque traduction est renseignée et différente du français quand il y a des accents", () => {
  for (const [fr, en] of Object.entries(EN)) {
    assert.ok(en && en.trim(), `traduction vide : ${fr}`);
    assert.ok(!/[éèêàçùôîâûœ«»]/.test(en), `accent dans la traduction de « ${fr} » : ${en}`);
  }
});

test("modèles : mêmes parties variables en français et en anglais", () => {
  for (const [fr, en] of EN_PATTERNS) {
    const a = (fr.match(/\{\d\}/g) || []).sort().join();
    const b = (en.match(/\{\d\}/g) || []).sort().join();
    assert.equal(a, b, `parties variables différentes : ${fr}`);
    assert.ok(!/[éèêàçùôîâûœ«»]/.test(en), `accent dans : ${en}`);
  }
});
