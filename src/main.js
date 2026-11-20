// Point d'entrée : actions, raccourcis clavier, glisser-déposer, fichiers reçus au lancement.
import "./style.css";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { createIcons } from "lucide";
import * as api from "./api.js";
import { $, $$, state, ICONS } from "./core.js";
import { toast } from "./ui.js";
import { initTooltips } from "./tooltip.js";
import { initI18n, isEn } from "./i18n.js";
import { ARC_RE, useEnglishUnits } from "./util.js";
import { about, initTheme, pinApp, toggleTheme } from "./app.js";
import { closeArchive, enterSelection, initArchiveView, loadArchive, selectAll, showHome, up, viewSelected } from "./archive.js";
import { compressFlow, compressFolder, convertFlow, extractHere, extractSelection, extractTo, forgetPassword, info, initCancel, setStatus, testArchive } from "./ops.js";
import { autoCheck, checkNow } from "./update.js";
import { version as APP_VERSION } from "../package.json";

initI18n(); // anglais : traduit l'interface affichée (sans effet en français)
if (isEn()) useEnglishUnits();

const ACTIONS = {
  home: () => showHome(true),
  back: () => { if (state.arc) showHome(false); },
  open: async () => { const f = await api.pickArchive(); if (f) await loadArchive(f); },
  close: () => closeArchive(),
  compress: () => compressFlow(),
  "compress-folder": () => compressFolder(),
  protect: () => compressFlow(null, { protect: true }),
  extract: () => extractTo(false),
  "extract-here": () => extractHere(),
  "extract-sel": () => extractSelection(),
  test: () => testArchive(),
  info: () => info(),
  convert: () => convertFlow(),
  "forget-pw": () => forgetPassword(),
  up: () => up(),
  view: () => viewSelected(),
  "select-all": () => selectAll(),
  theme: () => toggleTheme(),
  pin: () => pinApp(),
  about: () => about(),
  updates: () => checkNow(),
};
const run = (name) => Promise.resolve(ACTIONS[name]()).catch((err) => toast(String(err?.message || err), true));

document.addEventListener("click", (e) => {
  const menuBtn = e.target.closest("[data-menu]");
  $$(".menu-pop").forEach((p) => { if (!menuBtn || p.id !== "menu-" + menuBtn.dataset.menu) p.classList.remove("open"); });
  if (menuBtn) return $("#menu-" + menuBtn.dataset.menu).classList.toggle("open");
  const act = e.target.closest("[data-act]");
  if (act && !act.disabled && ACTIONS[act.dataset.act]) return run(act.dataset.act);
  const rib = e.target.closest("[data-rib]");
  if (rib) {
    $$("[data-rib]").forEach((b) => b.classList.toggle("on", b === rib));
    $$(".rib-panel").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== rib.dataset.rib));
  }
});

document.addEventListener("keydown", (e) => {
  if (document.querySelector(".modal-bg")) return;
  const typing = e.target.matches("input, textarea, select");
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === "o") { e.preventDefault(); run("open"); }
    else if (k === "n") { e.preventDefault(); run("compress"); }
    else if (k === "e") { e.preventDefault(); run("extract"); }
    else if (k === "w" && state.arc) { e.preventDefault(); run("close"); }
    else if (k === "a" && state.arc && !typing) { e.preventDefault(); selectAll(); }
    return;
  }
  if (typing || !state.arc || document.body.classList.contains("at-home")) return;
  if (e.key === "Backspace") { e.preventDefault(); up(); }
  else if (e.key === "Enter") enterSelection();
});

// Fichiers reçus (glisser-déposer, double-clic, clic droit « Compresser avec SXM Archive ») :
// une archive seule s'ouvre, le reste se compresse. Le clic droit sur plusieurs fichiers lance une
// instance par fichier : les fichiers arrivant en rafale sont regroupés.
let pending = [], timer = null;
function receive(files) {
  pending.push(...files.filter((f) => f && !f.startsWith("-")));
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const list = [...new Set(pending)]; pending = [];
    if (!list.length) return;
    if (list.length === 1 && ARC_RE.test(list[0])) {
      const st = await api.stat(list[0]);
      if (st.exists && !st.dir) return loadArchive(list[0]);
    }
    compressFlow(list);
  }, 400);
}
listen("sxm-args", (e) => receive(e.payload)).catch(() => {});

getCurrentWebview().onDragDropEvent((ev) => {
  const p = ev.payload;
  $("#docs").classList.toggle("dragover", p.type === "over" || p.type === "enter");
  if (p.type === "drop") { $("#docs").classList.remove("dragover"); receive(p.paths || []); }
  if (p.type === "leave") $("#docs").classList.remove("dragover");
}).catch(() => {});

createIcons({ icons: ICONS, attrs: { "stroke-width": 1.8 } });
initTooltips();
initTheme();
initArchiveView();
initCancel();
showHome(true);
{ const v = $("#app-version"); if (v) v.textContent = "v" + APP_VERSION; }
api.appInfo().then((i) => ($("#engine").textContent = "Moteur " + i.engine)).catch(() => {});
setStatus("Prêt — ouvrez une archive ou glissez des fichiers");
autoCheck();
api.startupArgs().then(receive).catch(() => {});
