// Opérations : compresser, extraire, tester, convertir, informations. Fenêtres d'options et messages.
import * as api from "./api.js";
import { listen } from "@tauri-apps/api/event";
import { $, state, sep, ico } from "./core.js";
import { toast, el, modal, confirmBox } from "./ui.js";
import { basename, defaultArchiveName, dirname, FORMATS, human, join, LEVELS, passwordProblem, safeFileName, stats, stripArchiveExt } from "./util.js";

// ------------------------------------------------------------------ barre d'état et tâches
export const setStatus = (t) => { $("#status-left").textContent = t; };

function progress(on, p = 0) {
  $("#progress").classList.toggle("hidden", !on);
  $("#bar").style.width = p + "%";
  $("#pct").textContent = p + " %";
}
listen("progress", (e) => { if (state.busy) progress(true, e.payload); }).catch(() => {});

/** Exécute une opération longue : barre de progression, bouton Annuler, une seule à la fois. */
export async function task(label, fn) {
  if (state.busy) { toast(api.ERR.BUSY, true); return null; }
  state.busy = true; setStatus(label); progress(true, 0);
  try { return await fn(); }
  catch (e) { return { error: "ENGINE_ERROR", detail: String(e?.message || e) }; }
  finally { state.busy = false; progress(false); }
}

export function initCancel() {
  $("#cancel").addEventListener("click", () => { api.cancel().catch(() => {}); setStatus("Annulation…"); });
}

function showError(r, what) {
  if (r.error === "CANCELLED") { setStatus("Opération annulée"); return toast("Opération annulée.", true); }
  setStatus(what);
  toast(api.errText(r), true);
}

/** Avertissements non bloquants (7-Zip code 1, chemins neutralisés…). */
function showWarnings(r) {
  if (!r?.warnings?.length) return;
  modal((m, close) => m.append(
    head("circle-alert", "#ea580c", "Terminé avec des avertissements"),
    el("div", { class: "warn-box" }, el("ul", {}, ...r.warnings.map((w) => el("li", { "data-no-tr": "" }, w)))),
    el("div", { class: "row end" }, el("button", { class: "btn accent", onclick: () => close() }, "OK"))));
}

const head = (icon, color, title, sub) => el("div", { class: "icon-head" },
  el("span", { class: "ic", style: `--ic:${color}` }, ico(icon)),
  el("div", { style: "flex:1" }, el("h2", {}, title), sub ? el("p", { "data-no-tr": "" }, sub) : null));

function alertBox(icon, color, title, ...body) {
  return modal((m, close) => m.append(head(icon, color, title), ...body,
    el("div", { class: "row end" }, el("button", { class: "btn accent", onclick: () => close() }, "OK"))));
}

// ------------------------------------------------------------------ mot de passe
export function askPassword(name, wrong = false) {
  return modal((m, close) => {
    const input = el("input", { type: "password", style: "flex:1" });
    const show = el("input", { type: "checkbox" });
    show.addEventListener("change", () => (input.type = show.checked ? "text" : "password"));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") close(input.value); });
    m.append(
      head("lock", "#16a34a", "Mot de passe requis", name),
      el("div", { class: "field" }, el("label", {}, "Mot de passe"), input),
      wrong ? el("div", { class: "err-line" }, "Mot de passe incorrect, réessayez.") : null,
      el("label", { class: "chk" }, show, "Afficher le mot de passe"),
      el("div", { class: "row end" },
        el("button", { class: "btn", onclick: () => close(null) }, "Annuler"),
        el("button", { class: "btn accent", onclick: () => close(input.value) }, "Valider")));
    setTimeout(() => input.focus(), 30);
  });
}

// ------------------------------------------------------------------ compression
const seg = (options, value, onChange) => {
  const box = el("div", { class: "seg" });
  const render = () => [...box.children].forEach((b) => b.classList.toggle("on", b.dataset.v === value));
  for (const [v, label] of options) {
    box.append(el("button", { "data-v": v, onclick: () => { value = v; render(); onChange(v); } }, label));
  }
  render();
  return box;
};
const levelSelect = () => {
  const s = el("select", {}, ...LEVELS.map(([l, v]) => el("option", { value: String(v) }, l)));
  s.value = "5";
  return s;
};
const FMT_LABELS = [["zip", "ZIP"], ["7z", "7z"], ["tar.gz", "tar.gz"]];

export async function compressFlow(files, { protect = false } = {}) {
  if (!files) files = await api.pickFiles();
  if (!files || !files.length) return;
  files = Array.isArray(files) ? files : [files];
  let fmt = protect ? "7z" : "zip";
  const res = await modal((m, close) => {
    const name = el("input", { type: "text", value: defaultArchiveName(files) });
    const level = levelSelect();
    const usePw = el("input", { type: "checkbox" }); usePw.checked = protect;
    const pw1 = el("input", { type: "password", placeholder: "Mot de passe", style: "flex:1" });
    const pw2 = el("input", { type: "password", placeholder: "Confirmer", style: "flex:1" });
    const encNames = el("input", { type: "checkbox" }); encNames.checked = true;
    const encBox = el("label", { class: "chk" }, encNames, "Chiffrer aussi les noms de fichiers (7z uniquement)");
    const pwFields = el("div", { class: "field" }, el("div", { class: "row" }, pw1, pw2), encBox);
    const pwBox = el("div", { class: "field" }, el("label", { class: "chk" }, usePw, "Protéger par mot de passe (AES-256)"), pwFields);
    const tgzHint = el("p", { style: "font-size:12px" }, "Le format tar.gz ne permet pas de mot de passe.");
    const err = el("div", { class: "err-line" });
    const sync = () => {
      pwBox.classList.toggle("hidden", fmt === "tar.gz");
      tgzHint.classList.toggle("hidden", fmt !== "tar.gz");
      encBox.classList.toggle("hidden", fmt !== "7z");
      pwFields.classList.toggle("hidden", !usePw.checked);
    };
    usePw.addEventListener("change", sync);
    const go = () => {
      const n = safeFileName(name.value);
      const wantPw = fmt !== "tar.gz" && usePw.checked;
      if (!n) return (err.textContent = "Indiquez un nom d'archive.");
      if (wantPw && !pw1.value) return (err.textContent = "Saisissez un mot de passe.");
      if (wantPw && pw1.value !== pw2.value) return (err.textContent = "Les mots de passe ne correspondent pas.");
      if (wantPw && passwordProblem(pw1.value)) return (err.textContent = passwordProblem(pw1.value));
      close({ name: n, format: fmt, level: +level.value, password: wantPw ? pw1.value : null, encryptNames: encNames.checked });
    };
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    m.append(
      head(protect ? "lock" : "package-plus", protect ? "#16a34a" : "#0f8f8c", protect ? "Créer une archive protégée" : "Créer une archive", `${files.length} élément(s)`),
      el("div", { class: "files-list", "data-no-tr": "" }, ...files.slice(0, 30).map((f) => el("div", {}, basename(f))), files.length > 30 ? el("div", {}, `… +${files.length - 30}`) : null),
      el("div", { class: "field" }, el("label", {}, "Nom de l'archive"), name),
      el("div", { class: "field" }, el("label", {}, "Format"), seg(FMT_LABELS, fmt, (v) => { fmt = v; sync(); })),
      el("div", { class: "field" }, el("label", {}, "Niveau de compression"), level),
      pwBox, tgzHint, err,
      el("div", { class: "row end" },
        el("button", { class: "btn", onclick: () => close(null) }, "Annuler"),
        el("button", { class: "btn accent", onclick: go }, "Créer l'archive")));
    sync();
    setTimeout(() => (protect ? pw1 : name).focus(), 30);
  });
  if (!res) return;
  const out = join(dirname(files[0]), res.name + FORMATS[res.format], sep());
  let overwrite = false;
  if ((await api.stat(out)).exists) {
    overwrite = (await confirmBox("Le fichier existe déjà", `« ${basename(out)} » existe déjà dans ce dossier. Voulez-vous le remplacer ?`, "Remplacer", "Annuler")) === true;
    if (!overwrite) return setStatus("Compression annulée");
  }
  const r = await task(`Création de ${basename(out)}…`, () => api.compress({ files, out, format: res.format, level: res.level, password: res.password, encryptNames: res.encryptNames, overwrite }));
  if (!r) return;
  if (r.error) return showError(r, "Échec de la compression");
  setStatus("Archive créée : " + basename(out));
  toast(`Archive créée : ${basename(out)}`);
  showWarnings(r);
  const { loadArchive } = await import("./archive.js");
  await loadArchive(out, res.password || undefined);
}

export async function compressFolder() {
  const f = await api.pickFolders();
  if (f) return compressFlow(Array.isArray(f) ? f : [f]);
}

// ------------------------------------------------------------------ extraction
async function ensureArchive() {
  if (state.arc) return true;
  const f = await api.pickArchive();
  if (!f) return false;
  const { loadArchive } = await import("./archive.js");
  return loadArchive(f);
}

async function doExtract(dest, { uniqueDest = false, members = [] } = {}) {
  const { ensurePassword } = await import("./archive.js");
  if (!(await ensurePassword())) return;
  const a = state.arc;
  const r = await task(members.length ? `Extraction de ${members.length} élément(s)…` : "Extraction…",
    () => api.extract({ file: a.file, dest, members, password: a.password, uniqueDest }));
  if (!r) return;
  if (api.isPwErr(r)) {
    a.password = null;
    const pw = await askPassword(basename(a.file), r.error === "PASSWORD_WRONG");
    if (pw === null) return setStatus("Extraction annulée");
    a.password = pw;
    return doExtract(dest, { uniqueDest, members });
  }
  if (r.error) return showError(r, "Échec de l'extraction");
  const where = r.out || dest;
  setStatus("Extrait dans " + where);
  const card = el("div", { class: "toast" }, el("div", {}, "Extraction terminée. Les fichiers déjà présents ont été conservés."),
    el("button", { class: "btn", style: "margin-top:6px", onclick: () => { api.openDir(where).catch(() => {}); card.remove(); } }, "Ouvrir le dossier"));
  $("#toasts").append(card);
  setTimeout(() => card.remove(), 8000);
  showWarnings(r);
}

export async function extractTo(selectionOnly = false) {
  if (!(await ensureArchive())) return;
  const dest = await api.pickDest(dirname(state.arc.file));
  if (dest) await doExtract(dest, { members: selectionOnly ? [...state.sel] : [] });
}

export async function extractHere() {
  if (!(await ensureArchive())) return;
  const a = state.arc;
  await doExtract(join(dirname(a.file), stripArchiveExt(basename(a.file)), sep()), { uniqueDest: true, members: [...state.sel] });
}

export async function extractSelection() {
  if (!state.sel.size) return toast("Sélectionnez d'abord des fichiers ou des dossiers.", true);
  return extractTo(true);
}

// ------------------------------------------------------------------ test, informations
export async function testArchive() {
  if (!(await ensureArchive())) return;
  const { ensurePassword } = await import("./archive.js");
  if (!(await ensurePassword())) return;
  const a = state.arc;
  const r = await task("Test de l'archive…", () => api.test({ file: a.file, password: a.password }));
  if (!r) return;
  if (r.ok && r.warnings?.length) { setStatus("Test terminé avec des avertissements"); return showWarnings(r); }
  if (r.ok) {
    setStatus("Aucune erreur trouvée");
    return alertBox("shield-check", "#16a34a", "Test réussi", el("p", {}, "Aucune erreur n'a été trouvée dans l'archive."));
  }
  if (api.isPwErr(r)) { a.password = null; return toast(api.errText(r), true); }
  if (r.error === "CANCELLED") return showError(r, "");
  setStatus("Archive endommagée");
  alertBox("circle-alert", "#ea580c", "Problème détecté", el("p", {}, api.errText(r)));
}

export function info() {
  const a = state.arc;
  if (!a) return;
  const s = stats(a.entries);
  const ratio = s.size ? Math.min(100, Math.round((a.size / s.size) * 100)) : 100;
  const row = (k, v, noTr) => [el("dt", {}, k), el("dd", noTr ? { "data-no-tr": "" } : {}, v)];
  alertBox("info", "#1867d8", "Informations sur l'archive",
    el("dl", {},
      ...row("Nom", basename(a.file), true),
      ...row("Emplacement", dirname(a.file), true),
      ...row("Fichiers", String(s.files)),
      ...row("Dossiers", String(s.dirs)),
      ...row("Taille d'origine", human(s.size)),
      ...row("Taille de l'archive", human(a.size)),
      el("dt", {}, "Taux de compression"), el("dd", {}, `${ratio} %`, el("div", { class: "ratio" }, el("i", { style: `width:${ratio}%` }))),
      ...row("Protection", a.encrypted ? "Mot de passe (AES)" : "Aucune")));
}

export function forgetPassword() {
  if (!state.arc) return;
  state.arc.password = null;
  toast("Mot de passe oublié pour cette archive.");
  import("./archive.js").then((m) => m.refreshButtons());
}

// ------------------------------------------------------------------ conversion
export async function convertFlow() {
  if (!(await ensureArchive())) return;
  const { ensurePassword, loadArchive } = await import("./archive.js");
  if (!(await ensurePassword())) return;
  const a = state.arc;
  let fmt = /\.zip$/i.test(a.file) ? "7z" : "zip";
  const res = await modal((m, close) => {
    const level = levelSelect();
    const np = el("input", { type: "password", placeholder: "Laisser vide pour ne pas protéger" });
    const npBox = el("div", { class: "field" }, el("label", {}, "Mot de passe de la nouvelle archive (facultatif)"), np);
    const err = el("div", { class: "err-line" });
    const sync = () => npBox.classList.toggle("hidden", fmt === "tar.gz");
    m.append(
      head("repeat", "#0891b2", "Convertir l'archive", basename(a.file)),
      el("div", { class: "field" }, el("label", {}, "Nouveau format"), seg(FMT_LABELS, fmt, (v) => { fmt = v; sync(); })),
      el("div", { class: "field" }, el("label", {}, "Niveau de compression"), level),
      npBox,
      a.encrypted ? el("div", { class: "warn-box" }, "L'archive d'origine est protégée : sans nouveau mot de passe, la nouvelle archive ne le sera pas.") : null,
      el("p", { style: "font-size:12px" }, "L'archive d'origine est conservée. La nouvelle est créée dans le même dossier."),
      err,
      el("div", { class: "row end" },
        el("button", { class: "btn", onclick: () => close(null) }, "Annuler"),
        el("button", { class: "btn accent", onclick: () => {
          const p = fmt === "tar.gz" ? "" : np.value;
          if (p && passwordProblem(p)) return (err.textContent = passwordProblem(p));
          close({ format: fmt, level: +level.value, newPassword: p || null });
        } }, "Convertir")));
    sync();
  });
  if (!res) return;
  const out = join(dirname(a.file), stripArchiveExt(basename(a.file)) + FORMATS[res.format], sep());
  if (out === a.file) return toast("L'archive est déjà dans ce format.", true);
  let overwrite = false;
  if ((await api.stat(out)).exists) {
    overwrite = (await confirmBox("Le fichier existe déjà", `« ${basename(out)} » existe déjà. Voulez-vous le remplacer ?`, "Remplacer", "Annuler")) === true;
    if (!overwrite) return setStatus("Conversion annulée");
  }
  const r = await task(`Conversion vers ${res.format}…`, () => api.convert({ file: a.file, password: a.password, out, format: res.format, level: res.level, newPassword: res.newPassword, overwrite }));
  if (!r) return;
  if (api.isPwErr(r)) { a.password = null; return showError(r, "Mot de passe incorrect"); }
  if (r.error) return showError(r, "Échec de la conversion");
  toast(`Converti : ${basename(out)}`);
  showWarnings(r);
  await loadArchive(out, res.newPassword || undefined);
}
