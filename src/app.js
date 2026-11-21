// Thème, À propos, langue, épinglage (comme SXM PDF).
import * as api from "./api.js";
import * as db from "./store.js";
import { toast, el, modal } from "./ui.js";
import { isEn, langSetting, setLangSetting } from "./i18n.js";
import { checkNow, settingsBlock } from "./update.js";

export function applyTheme(th) {
  document.documentElement.dataset.theme = th;
  db.set("sxm.theme", th);
}
export function initTheme() {
  const th = db.get("sxm.theme", null);
  applyTheme(th || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
}
export const toggleTheme = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

const PIN_PLACE = navigator.userAgent.includes("Mac") ? (isEn() ? "your Dock" : "votre Dock")
  : navigator.userAgent.includes("Windows") ? (isEn() ? "your taskbar" : "votre barre des tâches") : (isEn() ? "your favorites" : "vos favoris");

export async function pinApp() {
  try {
    const r = await api.pinApp();
    if (r === "windows") return pinHelp("Windows ne permet pas l'épinglage automatique. Ouvrez le menu Démarrer, faites un clic droit sur SXM Archive, puis « Épingler à la barre des tâches ».");
    if (r === "bureau") return pinHelp("Votre bureau ne permet pas l'épinglage automatique. Ouvrez le menu des applications, faites un clic droit sur SXM Archive, puis « Ajouter ce lanceur au tableau de bord » (MATE) ou « Ajouter aux favoris ».");
    if (r === "deja") return toast(`SXM Archive est déjà dans ${PIN_PLACE}.`);
    toast(`SXM Archive est maintenant dans ${PIN_PLACE}.`);
  } catch (e) { toast(String(e?.message || e), true); }
}

function pinHelp(text) {
  return modal((m, close) => m.append(el("h2", {}, "Épingler SXM Archive"), el("p", {}, text),
    el("div", { class: "row end" }, el("button", { class: "btn accent", onclick: () => close() }, "Compris"))));
}

export async function about() {
  let i = { version: "", engine: "7-Zip 25.01", publisher: "Invisible_Dawn" };
  try { i = await api.appInfo(); } catch { /* aperçu hors application */ }
  modal((m, close) => m.append(
    el("img", { src: "/banniere.jpg", alt: "", style: "width:100%;border-radius:12px;display:block" }),
    el("h2", {}, `SXM Archive ${i.version}`),
    el("p", {}, "Ouvrir, extraire, créer et protéger des archives RAR, ZIP, 7z et tar.gz."),
    el("p", {}, `© 2026 ${i.publisher}.`),
    el("p", {}, `Moteur ${i.engine} © Igor Pavlov, licence GNU LGPL avec restriction unRAR (le code de décompression RAR ne peut pas servir à recréer l'algorithme de compression RAR). Tauri (MIT / Apache 2.0), Lucide (ISC). Détail : THIRD-PARTY-NOTICES.md.`),
    settingsBlock(),
    langBlock(),
    el("div", { class: "row end" },
      el("button", { class: "btn", onclick: () => { close(); checkNow(); } }, "Rechercher les mises à jour"),
      el("button", { class: "btn accent", onclick: () => close() }, "Fermer"))));
}

/** Choix de la langue de l'interface (appliqué au prochain démarrage). */
function langBlock() {
  const sel = el("select", { style: "width:auto" },
    ...[["auto", "Automatique (langue du système)"], ["fr", "Français"], ["en", "English"]].map(([v, l]) => {
      const o = el("option", { value: v }, l);
      if (v === langSetting()) o.selected = true;
      return o;
    }));
  sel.addEventListener("change", () => { setLangSetting(sel.value); toast("La langue sera appliquée au prochain démarrage de SXM Archive."); });
  return el("div", { style: "display:flex;flex-direction:column;gap:6px" }, el("b", {}, "Langue"), sel);
}
